//! Main harvester orchestration
//!
//! Coordinates all data sources with:
//! - Circuit breakers for failing sources
//! - Deduplication across sources
//! - Checkpointing for resumable harvests
//! - Append-only logging for raw payloads
//! - Graceful shutdown support

use anyhow::Result;
use chrono::{Duration as ChronoDuration, Utc};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{interval, Duration};
use tracing::{info, warn, error, debug, Span, instrument};

use crate::append_log::{AppendLogStorage, LogEntry, LogEntryType, create_append_log, FileSystemAppendLog};
use crate::checkpoint::CheckpointManager;
use crate::circuit_breaker::{CircuitBreaker, CircuitBreakerConfig};
use crate::config::Config;
use crate::dedup::DedupStore;
use crate::error::{IngestionError, Result as IngestionResult};
use crate::http_client::{ResilientHttpClient, HttpClientConfig};
use crate::schemas::IngestionEvent;
use crate::sources::{Source, SourceMetadata, FetchOptions, FetchResult};
use crate::sources::nadfun::NadFunSource;
use crate::sources::monad::MonadSource;
use crate::sources::newsapi::NewsApiSource;
use crate::sources::cryptopanic::CryptoPanicSource;
use crate::sources::x_api::{XApiSource, OfficialXApiAdapter};
use crate::storage::Storage;

/// Market data harvester with all protection mechanisms
pub struct Harvester {
    config: Config,
    correlation_id: String,
    
    // HTTP client with semaphore
    http_client: Arc<ResilientHttpClient>,
    
    // Circuit breakers per source
    circuit_breakers: HashMap<String, Arc<CircuitBreaker>>,
    
    // Data sources
    sources: HashMap<String, Arc<dyn Source>>,
    
    // Deduplication
    dedup: Arc<DedupStore>,
    
    // Checkpoint manager
    checkpoint: Arc<RwLock<CheckpointManager>>,
    
    // Append-only log
    append_log: Arc<dyn AppendLogStorage>,
    
    // Legacy storage (DB + Redis)
    storage: Option<Storage>,
    
    // Shutdown flag
    running: Arc<RwLock<bool>>,
}

impl Harvester {
    /// Creates a new harvester instance
    #[instrument(skip(config), fields(correlation_id = %correlation_id))]
    pub async fn new(config: Config, correlation_id: String) -> Result<Self> {
        info!("Initializing harvester...");

        // Create HTTP client with semaphore limiting
        let http_config = HttpClientConfig {
            max_concurrent_requests: config.max_concurrent_requests,
            ..Default::default()
        };
        let http_client = Arc::new(ResilientHttpClient::new(http_config)?);

        // Create circuit breaker config
        let cb_config = CircuitBreakerConfig {
            failure_threshold: config.circuit_breaker_failure_threshold,
            open_duration: Duration::from_secs(config.circuit_breaker_open_duration_secs),
            ..Default::default()
        };

        // Create circuit breakers
        let mut circuit_breakers = HashMap::new();
        for source_id in ["nadfun", "monad", "newsapi", "cryptopanic", "x_api"] {
            circuit_breakers.insert(
                source_id.to_string(),
                Arc::new(CircuitBreaker::new(source_id, cb_config.clone())),
            );
        }

        // Create sources
        let mut sources: HashMap<String, Arc<dyn Source>> = HashMap::new();

        // nad.fun source (always available)
        let nadfun = NadFunSource::new(
            &config.nadfun_api_url,
            config.nadfun_api_key.as_deref(),
            config.nadfun_rate_limit_rpm,
        );
        // Note: NadFunSource doesn't implement Source trait yet, we'll use it directly

        // Monad RPC source (always available)
        let monad = MonadSource::new(
            &config.monad_rpc_url,
            config.rpc_rate_limit_rpm,
        );
        // Note: MonadSource doesn't implement Source trait yet, we'll use it directly

        // NewsAPI source (if configured)
        if let Some(ref api_key) = config.news_api_key {
            let newsapi = NewsApiSource::new(
                http_client.clone(),
                api_key.clone(),
                config.newsapi_rate_limit_rpm,
                circuit_breakers.get("newsapi").unwrap().clone(),
            );
            sources.insert("newsapi".to_string(), Arc::new(newsapi));
            info!("NewsAPI source initialized");
        }

        // CryptoPanic source (if configured)
        if let Some(ref api_key) = config.cryptopanic_api_key {
            let cryptopanic = CryptoPanicSource::new(
                http_client.clone(),
                api_key.clone(),
                config.cryptopanic_rate_limit_rpm,
                circuit_breakers.get("cryptopanic").unwrap().clone(),
            );
            sources.insert("cryptopanic".to_string(), Arc::new(cryptopanic));
            info!("CryptoPanic source initialized");
        }

        // X API source (if configured)
        if let Some(ref bearer_token) = config.twitter_bearer_token {
            let adapter = Arc::new(OfficialXApiAdapter::new(
                http_client.clone(),
                bearer_token.clone(),
                config.x_api_rate_limit_rpm,
                circuit_breakers.get("x_api").unwrap().clone(),
            ));
            let x_api = XApiSource::new(adapter, config.x_api_rate_limit_rpm);
            sources.insert("x_api".to_string(), Arc::new(x_api));
            info!("X API source initialized");
        }

        // Initialize deduplication store
        let dedup = Arc::new(DedupStore::new(config.dedup_cache_size));
        info!(cache_size = config.dedup_cache_size, "Dedup store initialized");

        // Initialize checkpoint manager
        let checkpoint = Arc::new(RwLock::new(
            CheckpointManager::new(&config.checkpoint_dir).await?
        ));
        info!(dir = %config.checkpoint_dir.display(), "Checkpoint manager initialized");

        // Initialize append-only log
        let append_log: Arc<dyn AppendLogStorage> = Arc::from(create_append_log(
            &config.storage_type,
            Some(&config.data_dir),
            config.s3_bucket.as_deref(),
            config.s3_prefix.as_deref(),
            config.s3_endpoint_url.as_deref(),
        ).await?);
        info!(storage_type = %config.storage_type, "Append log initialized");

        // Initialize legacy storage if database URL is provided
        let storage = if let Some(ref db_url) = config.database_url {
            Some(Storage::new(db_url, config.redis_url.as_deref()).await?)
        } else {
            warn!("No database URL configured - running without DB storage");
            None
        };

        Ok(Self {
            config,
            correlation_id,
            http_client,
            circuit_breakers,
            sources,
            dedup,
            checkpoint,
            append_log,
            storage,
            running: Arc::new(RwLock::new(true)),
        })
    }

    /// Runs the harvester continuously
    #[instrument(skip(self))]
    pub async fn run_continuous(&self) -> Result<()> {
        info!("Starting continuous harvesting...");

        // Spawn all harvester tasks
        let mut handles = Vec::new();

        // News harvester
        if self.sources.contains_key("newsapi") || self.sources.contains_key("cryptopanic") {
            handles.push(self.spawn_news_harvester());
        }

        // Social harvester
        if self.sources.contains_key("x_api") {
            handles.push(self.spawn_social_harvester());
        }

        // Checkpoint auto-save
        handles.push(self.spawn_checkpoint_saver());

        // Wait for any task to complete (or error)
        for handle in handles {
            if let Err(e) = handle.await {
                error!(error = %e, "Harvester task failed");
            }
        }

        Ok(())
    }

    /// Runs a single harvest cycle
    #[instrument(skip(self))]
    pub async fn run_once(&self) -> Result<()> {
        info!("Running single harvest cycle...");

        let options = FetchOptions::new()
            .since(Utc::now() - ChronoDuration::hours(1))
            .limit(100);

        // Fetch from all configured sources
        for (source_id, source) in &self.sources {
            match self.harvest_source(source_id, source.as_ref(), options.clone()).await {
                Ok(count) => {
                    info!(source = %source_id, events = count, "Harvest completed");
                }
                Err(e) => {
                    warn!(source = %source_id, error = %e, "Harvest failed");
                }
            }
        }

        // Save checkpoint
        self.checkpoint.write().await.save().await?;

        Ok(())
    }

    /// Fetches data from a specific source (for CLI)
    pub async fn fetch_from_source(
        &self,
        source_id: &str,
        options: FetchOptions,
    ) -> IngestionResult<Vec<IngestionEvent>> {
        if source_id == "all" {
            let mut all_events = Vec::new();
            for (id, source) in &self.sources {
                match source.fetch(options.clone()).await {
                    Ok(result) => {
                        all_events.extend(result.events);
                    }
                    Err(e) => {
                        warn!(source = %id, error = %e, "Failed to fetch");
                    }
                }
            }
            return Ok(all_events);
        }

        if let Some(source) = self.sources.get(source_id) {
            let result = source.fetch(options).await?;
            Ok(result.events)
        } else {
            Err(IngestionError::SourceNotConfigured(source_id.to_string()))
        }
    }

    /// Harvests from a single source with all protections
    async fn harvest_source(
        &self,
        source_id: &str,
        source: &dyn Source,
        options: FetchOptions,
    ) -> IngestionResult<usize> {
        // Check circuit breaker
        if let Some(cb) = self.circuit_breakers.get(source_id) {
            if !cb.allow_request() {
                warn!(source = %source_id, "Circuit breaker open, skipping");
                return Ok(0);
            }
        }

        // Get checkpoint for since time
        let since = {
            let checkpoint = self.checkpoint.read().await;
            checkpoint.get_since(source_id, ChronoDuration::hours(1))
        };

        let fetch_options = FetchOptions {
            since: Some(since),
            ..options
        };

        // Fetch data
        let result = source.fetch(fetch_options).await?;
        let event_count = result.events.len();

        // Process events
        let mut stored_count = 0;
        for event in &result.events {
            // Check for duplicates
            if let Some(ref dedup_key) = event.deduplication_key {
                let key = crate::dedup::DedupKey::from_content(source_id, dedup_key);
                if self.dedup.check_and_mark(&key).await {
                    debug!(event_id = %event.id, "Duplicate event, skipping");
                    continue;
                }
            }

            // Store in append log
            let log_entry = LogEntry {
                id: event.id.clone(),
                timestamp: Utc::now(),
                source_id: source_id.to_string(),
                correlation_id: self.correlation_id.clone(),
                session_id: self.checkpoint.read().await.session_id().to_string(),
                entry_type: LogEntryType::NormalizedEvent,
                payload: serde_json::to_value(event).unwrap_or_default(),
                payload_size: event.payload_size,
                content_hash: event.payload_hash.clone().unwrap_or_default(),
            };

            if let Err(e) = self.append_log.append(&log_entry).await {
                warn!(error = %e, "Failed to append to log");
            }

            stored_count += 1;
        }

        // Update checkpoint
        {
            let mut checkpoint = self.checkpoint.write().await;
            checkpoint.record_success(source_id, event_count as u32, result.next_cursor);
        }

        // Record success in circuit breaker
        if let Some(cb) = self.circuit_breakers.get(source_id) {
            cb.record_success();
        }

        info!(
            source = %source_id,
            fetched = event_count,
            stored = stored_count,
            "Harvest completed"
        );

        Ok(stored_count)
    }

    /// Spawns the news harvester task
    fn spawn_news_harvester(&self) -> tokio::task::JoinHandle<()> {
        let sources = self.sources.clone();
        let dedup = self.dedup.clone();
        let checkpoint = self.checkpoint.clone();
        let append_log = self.append_log.clone();
        let correlation_id = self.correlation_id.clone();
        let circuit_breakers = self.circuit_breakers.clone();
        let interval_ms = self.config.news_interval_ms;
        let running = self.running.clone();

        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_millis(interval_ms));

            loop {
                ticker.tick().await;

                if !*running.read().await {
                    info!("News harvester stopped");
                    break;
                }

                for source_id in ["newsapi", "cryptopanic"] {
                    if let Some(source) = sources.get(source_id) {
                        // Check circuit breaker
                        if let Some(cb) = circuit_breakers.get(source_id) {
                            if !cb.allow_request() {
                                debug!(source = %source_id, "Circuit breaker open");
                                continue;
                            }
                        }

                        let since = {
                            let cp = checkpoint.read().await;
                            cp.get_since(source_id, ChronoDuration::hours(1))
                        };

                        let options = FetchOptions::new()
                            .since(since)
                            .limit(100);

                        match source.fetch(options).await {
                            Ok(result) => {
                                debug!(
                                    source = %source_id,
                                    events = result.events.len(),
                                    "Fetched news"
                                );

                                // Process events with dedup
                                for event in &result.events {
                                    if let Some(ref key) = event.deduplication_key {
                                        let dedup_key = crate::dedup::DedupKey::from_content(source_id, key);
                                        if dedup.check_and_mark(&dedup_key).await {
                                            continue;
                                        }
                                    }

                                    // Log to append log
                                    let log_entry = LogEntry {
                                        id: event.id.clone(),
                                        timestamp: Utc::now(),
                                        source_id: source_id.to_string(),
                                        correlation_id: correlation_id.clone(),
                                        session_id: checkpoint.read().await.session_id().to_string(),
                                        entry_type: LogEntryType::NormalizedEvent,
                                        payload: serde_json::to_value(event).unwrap_or_default(),
                                        payload_size: event.payload_size,
                                        content_hash: event.payload_hash.clone().unwrap_or_default(),
                                    };

                                    if let Err(e) = append_log.append(&log_entry).await {
                                        warn!(error = %e, "Failed to append to log");
                                    }
                                }

                                // Update checkpoint
                                checkpoint.write().await.record_success(
                                    source_id,
                                    result.events.len() as u32,
                                    result.next_cursor,
                                );

                                if let Some(cb) = circuit_breakers.get(source_id) {
                                    cb.record_success();
                                }
                            }
                            Err(e) => {
                                warn!(source = %source_id, error = %e, "News fetch failed");
                                checkpoint.write().await.record_error(source_id, &e.to_string());
                                if let Some(cb) = circuit_breakers.get(source_id) {
                                    cb.record_failure();
                                }
                            }
                        }
                    }
                }
            }
        })
    }

    /// Spawns the social media harvester task
    fn spawn_social_harvester(&self) -> tokio::task::JoinHandle<()> {
        let sources = self.sources.clone();
        let dedup = self.dedup.clone();
        let checkpoint = self.checkpoint.clone();
        let append_log = self.append_log.clone();
        let correlation_id = self.correlation_id.clone();
        let circuit_breakers = self.circuit_breakers.clone();
        let interval_ms = self.config.social_interval_ms;
        let running = self.running.clone();

        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_millis(interval_ms));

            loop {
                ticker.tick().await;

                if !*running.read().await {
                    info!("Social harvester stopped");
                    break;
                }

                if let Some(source) = sources.get("x_api") {
                    let source_id = "x_api";

                    // Check circuit breaker
                    if let Some(cb) = circuit_breakers.get(source_id) {
                        if !cb.allow_request() {
                            debug!(source = %source_id, "Circuit breaker open");
                            continue;
                        }
                    }

                    let since = {
                        let cp = checkpoint.read().await;
                        cp.get_since(source_id, ChronoDuration::hours(1))
                    };

                    let options = FetchOptions::new()
                        .since(since)
                        .limit(100);

                    match source.fetch(options).await {
                        Ok(result) => {
                            debug!(
                                source = %source_id,
                                events = result.events.len(),
                                "Fetched social posts"
                            );

                            for event in &result.events {
                                if let Some(ref key) = event.deduplication_key {
                                    let dedup_key = crate::dedup::DedupKey::from_content(source_id, key);
                                    if dedup.check_and_mark(&dedup_key).await {
                                        continue;
                                    }
                                }

                                let log_entry = LogEntry {
                                    id: event.id.clone(),
                                    timestamp: Utc::now(),
                                    source_id: source_id.to_string(),
                                    correlation_id: correlation_id.clone(),
                                    session_id: checkpoint.read().await.session_id().to_string(),
                                    entry_type: LogEntryType::NormalizedEvent,
                                    payload: serde_json::to_value(event).unwrap_or_default(),
                                    payload_size: event.payload_size,
                                    content_hash: event.payload_hash.clone().unwrap_or_default(),
                                };

                                if let Err(e) = append_log.append(&log_entry).await {
                                    warn!(error = %e, "Failed to append to log");
                                }
                            }

                            checkpoint.write().await.record_success(
                                source_id,
                                result.events.len() as u32,
                                result.next_cursor,
                            );

                            if let Some(cb) = circuit_breakers.get(source_id) {
                                cb.record_success();
                            }
                        }
                        Err(e) => {
                            warn!(source = %source_id, error = %e, "Social fetch failed");
                            checkpoint.write().await.record_error(source_id, &e.to_string());
                            if let Some(cb) = circuit_breakers.get(source_id) {
                                cb.record_failure();
                            }
                        }
                    }
                }
            }
        })
    }

    /// Spawns checkpoint auto-save task
    fn spawn_checkpoint_saver(&self) -> tokio::task::JoinHandle<()> {
        let checkpoint = self.checkpoint.clone();
        let interval_secs = self.config.checkpoint_interval_secs;
        let running = self.running.clone();

        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(interval_secs));

            loop {
                ticker.tick().await;

                if !*running.read().await {
                    info!("Checkpoint saver stopped");
                    break;
                }

                if let Err(e) = checkpoint.write().await.maybe_save().await {
                    warn!(error = %e, "Failed to auto-save checkpoint");
                }
            }
        })
    }

    /// Graceful shutdown
    /// Turkish: "Sistem kapanırken yarıda kalan işlemleri güvenli şekilde tamamla"
    pub async fn shutdown(&self) {
        info!("Initiating graceful shutdown...");

        // Signal all tasks to stop
        {
            let mut running = self.running.write().await;
            *running = false;
        }

        // Wait a bit for tasks to finish current work
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Save final checkpoint
        info!("Saving final checkpoint...");
        if let Err(e) = self.checkpoint.write().await.save_on_shutdown().await {
            error!(error = %e, "Failed to save checkpoint on shutdown");
        }

        info!("Graceful shutdown complete");
    }

    /// Gets circuit breaker status for all sources
    pub fn circuit_breaker_status(&self) -> HashMap<String, crate::circuit_breaker::CircuitBreakerStats> {
        self.circuit_breakers
            .iter()
            .map(|(k, v)| (k.clone(), v.stats()))
            .collect()
    }

    /// Gets dedup statistics
    pub fn dedup_stats(&self) -> (usize, bool) {
        (self.dedup.len(), self.dedup.is_empty())
    }
}
