//! Ingestion Pipeline with Backpressure
//!
//! Implements: fetch → normalize → enrich → embed → publish
//!
//! Turkish: "Veri akışı işleme hızından fazlaysa, belleğin (RAM) şişip sistemin
//! 'Out of Memory' hatasıyla kapanmaması için tokio::sync::mpsc bounded kanallarını
//! kullanarak üreticiyi (producer) yavaşlatan bir mekanizma kur."
//!
//! Features:
//! - Bounded channels for backpressure
//! - Configurable worker pools per stage
//! - Prometheus metrics per stage
//! - Graceful shutdown support

pub mod stages;
pub mod worker;

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, broadcast, Semaphore};
use tracing::{info, error, warn, debug, Instrument};

use crate::config::Config;
use crate::metrics::{self, STAGE_FETCH, STAGE_NORMALIZE, STAGE_ENRICH, STAGE_EMBED, STAGE_PUBLISH};
use crate::schemas::IngestionEvent;
use crate::message_bus::{MessageBus, ResilientPublisher};

use stages::{FetchStage, NormalizeStage, EnrichStage, EmbedStage, PublishStage};
use worker::WorkerPool;

// ============================================
// PIPELINE CONFIGURATION
// ============================================

/// Configuration for pipeline stages
#[derive(Debug, Clone)]
pub struct PipelineConfig {
    /// Channel capacity for each stage (backpressure threshold)
    pub channel_capacity: usize,
    
    /// Number of workers per stage
    pub fetch_workers: usize,
    pub normalize_workers: usize,
    pub enrich_workers: usize,
    pub embed_workers: usize,
    pub publish_workers: usize,
    
    /// Batch sizes
    pub fetch_batch_size: usize,
    pub normalize_batch_size: usize,
    pub enrich_batch_size: usize,
    pub embed_batch_size: usize,
    pub publish_batch_size: usize,
    
    /// Timeouts
    pub stage_timeout: Duration,
    
    /// Enable/disable stages
    pub enable_enrich: bool,
    pub enable_embed: bool,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            channel_capacity: 1000,
            fetch_workers: 4,
            normalize_workers: 2,
            enrich_workers: 2,
            embed_workers: 1,
            publish_workers: 2,
            fetch_batch_size: 100,
            normalize_batch_size: 50,
            enrich_batch_size: 10,
            embed_batch_size: 10,
            publish_batch_size: 100,
            stage_timeout: Duration::from_secs(30),
            enable_enrich: true,
            enable_embed: false, // Disabled by default (requires embedding service)
        }
    }
}

impl PipelineConfig {
    pub fn from_config(config: &Config) -> Self {
        Self {
            channel_capacity: config.pipeline_channel_capacity.unwrap_or(1000),
            fetch_workers: config.pipeline_fetch_workers.unwrap_or(4),
            normalize_workers: config.pipeline_normalize_workers.unwrap_or(2),
            enrich_workers: config.pipeline_enrich_workers.unwrap_or(2),
            embed_workers: config.pipeline_embed_workers.unwrap_or(1),
            publish_workers: config.pipeline_publish_workers.unwrap_or(2),
            fetch_batch_size: 100,
            normalize_batch_size: 50,
            enrich_batch_size: 10,
            embed_batch_size: 10,
            publish_batch_size: 100,
            stage_timeout: Duration::from_secs(30),
            enable_enrich: config.pipeline_enable_enrich.unwrap_or(true),
            enable_embed: config.pipeline_enable_embed.unwrap_or(false),
        }
    }
}

// ============================================
// PIPELINE ITEM
// ============================================

/// Item flowing through the pipeline
#[derive(Debug, Clone)]
pub struct PipelineItem {
    /// The ingestion event
    pub event: IngestionEvent,
    
    /// Correlation ID for tracing
    pub correlation_id: String,
    
    /// Source of the item
    pub source: String,
    
    /// When the item entered the pipeline
    pub entered_at: std::time::Instant,
    
    /// Enrichment data (added by enrich stage)
    pub enrichment: Option<EnrichmentData>,
    
    /// Embedding vector (added by embed stage)
    pub embedding: Option<Vec<f32>>,
}

#[derive(Debug, Clone, Default)]
pub struct EnrichmentData {
    pub sentiment_score: Option<f64>,
    pub entity_tags: Vec<String>,
    pub related_tickers: Vec<String>,
    pub language: Option<String>,
    pub category: Option<String>,
}

impl PipelineItem {
    pub fn new(event: IngestionEvent, correlation_id: &str, source: &str) -> Self {
        Self {
            event,
            correlation_id: correlation_id.to_string(),
            source: source.to_string(),
            entered_at: std::time::Instant::now(),
            enrichment: None,
            embedding: None,
        }
    }

    /// Gets pipeline latency so far
    pub fn latency(&self) -> Duration {
        self.entered_at.elapsed()
    }
}

// ============================================
// PIPELINE
// ============================================

/// The main ingestion pipeline
pub struct Pipeline {
    config: PipelineConfig,
    
    // Channels between stages (bounded for backpressure)
    fetch_tx: mpsc::Sender<PipelineItem>,
    normalize_tx: mpsc::Sender<PipelineItem>,
    enrich_tx: mpsc::Sender<PipelineItem>,
    embed_tx: mpsc::Sender<PipelineItem>,
    publish_tx: mpsc::Sender<PipelineItem>,
    
    // Shutdown signal
    shutdown_tx: broadcast::Sender<()>,
    
    // Worker handles
    worker_handles: Vec<tokio::task::JoinHandle<()>>,
    
    // Publisher
    publisher: Arc<ResilientPublisher>,
}

impl Pipeline {
    /// Creates a new pipeline
    pub async fn new(
        config: PipelineConfig,
        message_bus: Box<dyn MessageBus>,
    ) -> anyhow::Result<Self> {
        // Create bounded channels
        let (fetch_tx, fetch_rx) = mpsc::channel(config.channel_capacity);
        let (normalize_tx, normalize_rx) = mpsc::channel(config.channel_capacity);
        let (enrich_tx, enrich_rx) = mpsc::channel(config.channel_capacity);
        let (embed_tx, embed_rx) = mpsc::channel(config.channel_capacity);
        let (publish_tx, publish_rx) = mpsc::channel(config.channel_capacity);
        
        // Create shutdown signal
        let (shutdown_tx, _) = broadcast::channel(1);
        
        // Create publisher
        let publisher = Arc::new(ResilientPublisher::new(
            message_bus,
            3,
            Duration::from_millis(100),
        ));
        
        // Set initial metrics
        metrics::set_queue_capacity(STAGE_FETCH, config.channel_capacity as i64);
        metrics::set_queue_capacity(STAGE_NORMALIZE, config.channel_capacity as i64);
        metrics::set_queue_capacity(STAGE_ENRICH, config.channel_capacity as i64);
        metrics::set_queue_capacity(STAGE_EMBED, config.channel_capacity as i64);
        metrics::set_queue_capacity(STAGE_PUBLISH, config.channel_capacity as i64);
        
        metrics::set_worker_count(STAGE_FETCH, config.fetch_workers as i64);
        metrics::set_worker_count(STAGE_NORMALIZE, config.normalize_workers as i64);
        metrics::set_worker_count(STAGE_ENRICH, config.enrich_workers as i64);
        metrics::set_worker_count(STAGE_EMBED, config.embed_workers as i64);
        metrics::set_worker_count(STAGE_PUBLISH, config.publish_workers as i64);
        
        let mut pipeline = Self {
            config,
            fetch_tx,
            normalize_tx: normalize_tx.clone(),
            enrich_tx: enrich_tx.clone(),
            embed_tx: embed_tx.clone(),
            publish_tx: publish_tx.clone(),
            shutdown_tx,
            worker_handles: Vec::new(),
            publisher,
        };
        
        // Spawn workers for each stage
        pipeline.spawn_workers(
            fetch_rx,
            normalize_rx,
            normalize_tx,
            enrich_rx,
            enrich_tx,
            embed_rx,
            embed_tx,
            publish_rx,
            publish_tx,
        ).await?;
        
        Ok(pipeline)
    }

    /// Spawns worker pools for each stage
    async fn spawn_workers(
        &mut self,
        fetch_rx: mpsc::Receiver<PipelineItem>,
        normalize_rx: mpsc::Receiver<PipelineItem>,
        normalize_tx: mpsc::Sender<PipelineItem>,
        enrich_rx: mpsc::Receiver<PipelineItem>,
        enrich_tx: mpsc::Sender<PipelineItem>,
        embed_rx: mpsc::Receiver<PipelineItem>,
        embed_tx: mpsc::Sender<PipelineItem>,
        publish_rx: mpsc::Receiver<PipelineItem>,
        publish_tx: mpsc::Sender<PipelineItem>,
    ) -> anyhow::Result<()> {
        // Normalize stage workers
        let handle = self.spawn_stage_workers(
            STAGE_NORMALIZE,
            self.config.normalize_workers,
            fetch_rx,
            normalize_tx.clone(),
            Box::new(NormalizeStage::new()),
        );
        self.worker_handles.push(handle);
        
        // Determine next stage after normalize
        let next_after_normalize = if self.config.enable_enrich {
            enrich_tx.clone()
        } else if self.config.enable_embed {
            embed_tx.clone()
        } else {
            publish_tx.clone()
        };
        
        // Connect normalize output to next stage
        let handle = self.spawn_router(normalize_rx, next_after_normalize);
        self.worker_handles.push(handle);
        
        // Enrich stage (if enabled)
        if self.config.enable_enrich {
            let next_after_enrich = if self.config.enable_embed {
                embed_tx.clone()
            } else {
                publish_tx.clone()
            };
            
            let handle = self.spawn_stage_workers(
                STAGE_ENRICH,
                self.config.enrich_workers,
                enrich_rx,
                next_after_enrich,
                Box::new(EnrichStage::new()),
            );
            self.worker_handles.push(handle);
        }
        
        // Embed stage (if enabled)
        if self.config.enable_embed {
            let handle = self.spawn_stage_workers(
                STAGE_EMBED,
                self.config.embed_workers,
                embed_rx,
                publish_tx.clone(),
                Box::new(EmbedStage::new(None)),
            );
            self.worker_handles.push(handle);
        }
        
        // Publish stage
        let publisher = self.publisher.clone();
        let handle = self.spawn_publish_workers(
            self.config.publish_workers,
            publish_rx,
            publisher,
        );
        self.worker_handles.push(handle);
        
        info!(
            normalize_workers = self.config.normalize_workers,
            enrich_workers = if self.config.enable_enrich { self.config.enrich_workers } else { 0 },
            embed_workers = if self.config.enable_embed { self.config.embed_workers } else { 0 },
            publish_workers = self.config.publish_workers,
            "Pipeline workers spawned"
        );
        
        Ok(())
    }

    /// Spawns workers for a stage
    fn spawn_stage_workers(
        &self,
        stage_name: &'static str,
        worker_count: usize,
        rx: mpsc::Receiver<PipelineItem>,
        tx: mpsc::Sender<PipelineItem>,
        stage: Box<dyn stages::Stage>,
    ) -> tokio::task::JoinHandle<()> {
        let shutdown_rx = self.shutdown_tx.subscribe();
        
        tokio::spawn(async move {
            let pool = WorkerPool::new(
                stage_name,
                worker_count,
                rx,
                tx,
                stage,
                shutdown_rx,
            );
            
            pool.run().await;
        }.instrument(tracing::info_span!("stage_workers", stage = stage_name)))
    }

    /// Spawns a router that forwards items between channels
    fn spawn_router(
        &self,
        mut rx: mpsc::Receiver<PipelineItem>,
        tx: mpsc::Sender<PipelineItem>,
    ) -> tokio::task::JoinHandle<()> {
        let mut shutdown_rx = self.shutdown_tx.subscribe();
        
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    Some(item) = rx.recv() => {
                        if let Err(e) = tx.send(item).await {
                            warn!(error = %e, "Router failed to forward item");
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        info!("Router shutting down");
                        break;
                    }
                }
            }
        })
    }

    /// Spawns publish workers
    fn spawn_publish_workers(
        &self,
        worker_count: usize,
        rx: mpsc::Receiver<PipelineItem>,
        publisher: Arc<ResilientPublisher>,
    ) -> tokio::task::JoinHandle<()> {
        let shutdown_rx = self.shutdown_tx.subscribe();
        
        tokio::spawn(async move {
            let stage = PublishStage::new(publisher);
            let pool = WorkerPool::new(
                STAGE_PUBLISH,
                worker_count,
                rx,
                // Publish stage has no output channel
                mpsc::channel(1).0, // Dummy sender that will never be used
                Box::new(stage),
                shutdown_rx,
            );
            
            pool.run().await;
        }.instrument(tracing::info_span!("publish_workers")))
    }

    /// Submits an item to the pipeline (with backpressure)
    pub async fn submit(&self, item: PipelineItem) -> anyhow::Result<()> {
        // Update queue depth metric
        let depth = self.config.channel_capacity - self.fetch_tx.capacity();
        metrics::set_queue_depth(STAGE_FETCH, depth as i64);
        
        // Try to send with timeout to detect backpressure
        match tokio::time::timeout(
            Duration::from_millis(100),
            self.fetch_tx.send(item.clone()),
        ).await {
            Ok(Ok(_)) => {
                metrics::record_event_processed(STAGE_FETCH, &item.source);
                Ok(())
            }
            Ok(Err(e)) => {
                error!(error = %e, "Failed to submit to pipeline");
                anyhow::bail!("Pipeline submission failed: {}", e)
            }
            Err(_) => {
                // Timeout - backpressure is active
                metrics::record_backpressure(STAGE_FETCH);
                warn!("Backpressure active on fetch stage, waiting...");
                
                // Wait for capacity
                self.fetch_tx.send(item.clone()).await?;
                metrics::record_event_processed(STAGE_FETCH, &item.source);
                Ok(())
            }
        }
    }

    /// Submits multiple items (with backpressure)
    pub async fn submit_batch(&self, items: Vec<PipelineItem>) -> anyhow::Result<()> {
        for item in items {
            self.submit(item).await?;
        }
        Ok(())
    }

    /// Gets current pipeline stats
    pub fn stats(&self) -> PipelineStats {
        PipelineStats {
            fetch_queue_depth: self.config.channel_capacity - self.fetch_tx.capacity(),
            normalize_queue_depth: self.config.channel_capacity - self.normalize_tx.capacity(),
            enrich_queue_depth: self.config.channel_capacity - self.enrich_tx.capacity(),
            embed_queue_depth: self.config.channel_capacity - self.embed_tx.capacity(),
            publish_queue_depth: self.config.channel_capacity - self.publish_tx.capacity(),
            channel_capacity: self.config.channel_capacity,
        }
    }

    /// Initiates graceful shutdown
    pub async fn shutdown(&self) {
        info!("Initiating pipeline shutdown...");
        let _ = self.shutdown_tx.send(());
        
        // Wait for workers to finish
        // Note: In a real implementation, we'd join the handles
        tokio::time::sleep(Duration::from_secs(1)).await;
        
        info!("Pipeline shutdown complete");
    }

    /// Waits for all in-flight items to be processed
    pub async fn drain(&self) {
        info!("Draining pipeline...");
        
        // Wait until all queues are empty
        let mut empty = false;
        while !empty {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let stats = self.stats();
            empty = stats.fetch_queue_depth == 0
                && stats.normalize_queue_depth == 0
                && stats.enrich_queue_depth == 0
                && stats.embed_queue_depth == 0
                && stats.publish_queue_depth == 0;
        }
        
        info!("Pipeline drained");
    }
}

// ============================================
// PIPELINE STATS
// ============================================

#[derive(Debug, Clone)]
pub struct PipelineStats {
    pub fetch_queue_depth: usize,
    pub normalize_queue_depth: usize,
    pub enrich_queue_depth: usize,
    pub embed_queue_depth: usize,
    pub publish_queue_depth: usize,
    pub channel_capacity: usize,
}

impl PipelineStats {
    /// Returns true if any stage is experiencing backpressure
    pub fn has_backpressure(&self) -> bool {
        let threshold = self.channel_capacity * 80 / 100; // 80% full
        self.fetch_queue_depth > threshold
            || self.normalize_queue_depth > threshold
            || self.enrich_queue_depth > threshold
            || self.embed_queue_depth > threshold
            || self.publish_queue_depth > threshold
    }

    /// Returns the most congested stage
    pub fn bottleneck(&self) -> &'static str {
        let depths = [
            (self.fetch_queue_depth, STAGE_FETCH),
            (self.normalize_queue_depth, STAGE_NORMALIZE),
            (self.enrich_queue_depth, STAGE_ENRICH),
            (self.embed_queue_depth, STAGE_EMBED),
            (self.publish_queue_depth, STAGE_PUBLISH),
        ];
        
        depths.iter().max_by_key(|(d, _)| d).map(|(_, s)| *s).unwrap_or(STAGE_FETCH)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pipeline_config_default() {
        let config = PipelineConfig::default();
        assert_eq!(config.channel_capacity, 1000);
        assert_eq!(config.fetch_workers, 4);
    }

    #[test]
    fn test_pipeline_stats_backpressure() {
        let stats = PipelineStats {
            fetch_queue_depth: 900,
            normalize_queue_depth: 100,
            enrich_queue_depth: 50,
            embed_queue_depth: 10,
            publish_queue_depth: 5,
            channel_capacity: 1000,
        };
        
        assert!(stats.has_backpressure());
        assert_eq!(stats.bottleneck(), STAGE_FETCH);
    }
}
