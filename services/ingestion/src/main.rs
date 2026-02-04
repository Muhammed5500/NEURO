//! NEURO Ingestion Service
//! High-speed market data and news harvesting for Monad ecosystem
//!
//! Features:
//! - Multiple data sources (NewsAPI, CryptoPanic, X/Twitter, nad.fun, Monad RPC)
//! - Exponential backoff with jitter for retries
//! - Circuit breaker pattern for failing sources
//! - Semaphore-based concurrency limiting
//! - Content-hash and URL-based deduplication
//! - Append-only log storage (filesystem/S3)
//! - Checkpointing with --since parameter
//! - Graceful shutdown with SIGTERM handling
//! - Correlation IDs for distributed tracing
//! - Pipeline with backpressure (bounded channels)
//! - Prometheus metrics per stage
//! - Message bus output (Redis Streams / NATS)

mod append_log;
mod checkpoint;
mod circuit_breaker;
mod config;
mod dedup;
mod error;
mod harvester;
mod http_client;
pub mod message_bus;
pub mod metrics;
pub mod pipeline;
pub mod schemas;
mod sources;
mod storage;

use anyhow::Result;
use clap::{Parser, Subcommand};
use std::sync::Arc;
use tokio::signal;
use tokio::sync::broadcast;
use tracing::{info, error};
use tracing_subscriber::{fmt, EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

use crate::checkpoint::parse_since;
use crate::config::Config;
use crate::harvester::Harvester;

/// NEURO Ingestion Service - High-speed market data harvesting
#[derive(Parser, Debug)]
#[command(name = "neuro-ingestion")]
#[command(author = "NEURO Team")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "High-speed market data and news harvesting for Monad ecosystem")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Log level (trace, debug, info, warn, error)
    #[arg(short, long, default_value = "info", global = true)]
    log_level: String,

    /// Output logs as JSON
    #[arg(long, default_value = "false", global = true)]
    json_logs: bool,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Start the harvester service
    Run {
        /// Run continuously (daemon mode)
        #[arg(short, long, default_value = "true")]
        daemon: bool,
    },

    /// Start the pipeline service (fetch → normalize → enrich → embed → publish)
    Pipeline {
        /// Channel capacity for backpressure
        #[arg(long, default_value = "1000")]
        channel_capacity: usize,

        /// Enable enrichment stage
        #[arg(long, default_value = "true")]
        enrich: bool,

        /// Enable embedding stage
        #[arg(long, default_value = "false")]
        embed: bool,
    },

    /// Harvest data from specific sources
    Harvest {
        /// Source to harvest from (newsapi, cryptopanic, x_api, nadfun, monad, all)
        #[arg(short, long, default_value = "all")]
        source: String,

        /// Fetch data since this duration ago (e.g., "1h", "30m", "2d")
        #[arg(long)]
        since: Option<String>,

        /// Maximum number of items to fetch
        #[arg(short = 'n', long)]
        limit: Option<u32>,

        /// Search query (for news/social sources)
        #[arg(short, long)]
        query: Option<String>,

        /// Output format (json, table, summary)
        #[arg(short, long, default_value = "summary")]
        output: String,
    },

    /// Show status of sources and checkpoints
    Status,

    /// Reset checkpoints for a source
    Reset {
        /// Source to reset (or "all")
        #[arg(short, long)]
        source: String,
    },
}

/// Generates a new correlation ID for the session
fn generate_correlation_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Sets up structured logging with tracing
fn setup_logging(log_level: &str, json_output: bool) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(log_level));

    if json_output {
        tracing_subscriber::registry()
            .with(filter)
            .with(fmt::layer().json())
            .init();
    } else {
        tracing_subscriber::registry()
            .with(filter)
            .with(fmt::layer().with_target(true).with_thread_ids(true))
            .init();
    }
}

/// Handles graceful shutdown on SIGTERM/SIGINT
/// Turkish: "Sistem kapanırken yarıda kalan veri çekme işlemlerini güvenli bir şekilde tamamla"
async fn shutdown_signal(shutdown_tx: broadcast::Sender<()>) {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("Failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            info!("Received Ctrl+C, initiating graceful shutdown...");
        }
        _ = terminate => {
            info!("Received SIGTERM, initiating graceful shutdown...");
        }
    }

    // Signal all tasks to shutdown
    let _ = shutdown_tx.send(());
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Setup logging
    setup_logging(&cli.log_level, cli.json_logs);

    // Generate session correlation ID
    let correlation_id = generate_correlation_id();
    
    info!(
        version = env!("CARGO_PKG_VERSION"),
        correlation_id = %correlation_id,
        "Starting NEURO Ingestion Service"
    );

    // Load configuration
    let config = Config::load()?;
    config.validate()?;
    
    info!(
        nadfun_api = %config.nadfun_api_url,
        monad_rpc = %config.monad_rpc_url,
        max_concurrent = config.max_concurrent_requests,
        storage_type = %config.storage_type,
        "Configuration loaded"
    );

    // Create shutdown channel
    let (shutdown_tx, _) = broadcast::channel::<()>(1);

    match cli.command {
        Commands::Run { daemon } => {
            run_daemon(config, correlation_id, shutdown_tx, daemon).await?;
        }

        Commands::Pipeline { channel_capacity, enrich, embed } => {
            run_pipeline(config, correlation_id, shutdown_tx, channel_capacity, enrich, embed).await?;
        }

        Commands::Harvest { source, since, limit, query, output } => {
            harvest_once(config, correlation_id, &source, since, limit, query, &output).await?;
        }

        Commands::Status => {
            show_status(config).await?;
        }

        Commands::Reset { source } => {
            reset_checkpoint(config, &source).await?;
        }
    }

    Ok(())
}

/// Runs the harvester in daemon mode
async fn run_daemon(
    config: Config,
    correlation_id: String,
    shutdown_tx: broadcast::Sender<()>,
    daemon: bool,
) -> Result<()> {
    // Initialize harvester
    let harvester = Arc::new(Harvester::new(config, correlation_id.clone()).await?);
    
    info!("NEURO Ingestion Service initialized");

    // Spawn shutdown handler
    let shutdown_harvester = harvester.clone();
    let shutdown_handle = tokio::spawn(async move {
        shutdown_signal(shutdown_tx).await;
        
        info!("Shutting down harvester...");
        shutdown_harvester.shutdown().await;
        info!("Harvester shutdown complete");
    });

    // Run harvester
    if daemon {
        info!("Running in daemon mode (continuous harvesting)");
        if let Err(e) = harvester.run_continuous().await {
            error!(error = %e, "Harvester failed");
            return Err(e);
        }
    } else {
        info!("Running single harvest cycle");
        if let Err(e) = harvester.run_once().await {
            error!(error = %e, "Harvest cycle failed");
            return Err(e);
        }
    }

    // Wait for shutdown handler
    let _ = shutdown_handle.await;

    info!("NEURO Ingestion Service stopped");
    Ok(())
}

/// Runs a single harvest from command line
async fn harvest_once(
    config: Config,
    correlation_id: String,
    source: &str,
    since: Option<String>,
    limit: Option<u32>,
    query: Option<String>,
    output_format: &str,
) -> Result<()> {
    use crate::sources::FetchOptions;
    use chrono::{Duration, Utc};

    info!(
        source = %source,
        since = ?since,
        limit = ?limit,
        query = ?query,
        "Starting harvest"
    );

    // Parse --since duration
    let since_time = if let Some(since_str) = since {
        let duration = parse_since(&since_str)?;
        Some(Utc::now() - duration)
    } else {
        // Default: last 1 hour
        Some(Utc::now() - Duration::hours(1))
    };

    // Create harvester
    let harvester = Harvester::new(config, correlation_id).await?;

    // Build fetch options
    let options = FetchOptions {
        since: since_time,
        limit,
        cursor: None,
        query,
        filters: std::collections::HashMap::new(),
    };

    // Fetch from source(s)
    let results = harvester.fetch_from_source(source, options).await?;

    // Output results
    match output_format {
        "json" => {
            let json = serde_json::to_string_pretty(&results)?;
            println!("{}", json);
        }
        "table" => {
            println!("\n{:<40} {:<15} {:<20} {:<10}", "ID", "Source", "Type", "Priority");
            println!("{}", "-".repeat(85));
            for event in &results {
                println!(
                    "{:<40} {:<15} {:<20} {:?}",
                    &event.id[..8],
                    event.source_id,
                    format!("{:?}", event.data_type),
                    event.priority
                );
            }
            println!("\nTotal: {} events", results.len());
        }
        _ => {
            // Summary
            println!("\n📊 Harvest Summary");
            println!("==================");
            println!("Source: {}", source);
            println!("Events: {}", results.len());
            
            if !results.is_empty() {
                let first = &results[0];
                let last = &results[results.len() - 1];
                println!("First: {} ({})", &first.id[..8], first.source_id);
                println!("Last:  {} ({})", &last.id[..8], last.source_id);
            }
            
            // Count by type
            let mut by_type: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
            for event in &results {
                *by_type.entry(format!("{:?}", event.data_type)).or_insert(0) += 1;
            }
            
            println!("\nBy Type:");
            for (data_type, count) in by_type {
                println!("  - {}: {}", data_type, count);
            }
        }
    }

    Ok(())
}

/// Shows status of sources and checkpoints
async fn show_status(config: Config) -> Result<()> {
    use crate::checkpoint::CheckpointManager;

    println!("\n📡 NEURO Ingestion Service Status");
    println!("==================================\n");

    // Show configured sources
    println!("Configured Sources:");
    println!("  - nad.fun API: ✅ ({})", config.nadfun_api_url);
    println!("  - Monad RPC:   ✅ ({})", config.monad_rpc_url);
    println!("  - NewsAPI:     {}", if config.has_newsapi() { "✅" } else { "❌ (no API key)" });
    println!("  - CryptoPanic: {}", if config.has_cryptopanic() { "✅" } else { "❌ (no API key)" });
    println!("  - X/Twitter:   {}", if config.has_x_api() { "✅" } else { "❌ (no bearer token)" });

    // Show checkpoints
    println!("\nCheckpoints:");
    let checkpoint_mgr = CheckpointManager::new(&config.checkpoint_dir).await?;
    
    let checkpoints = checkpoint_mgr.all_checkpoints();
    if checkpoints.is_empty() {
        println!("  No checkpoints yet");
    } else {
        for (source_id, checkpoint) in checkpoints {
            println!(
                "  - {}: last fetch {}, {} items total",
                source_id,
                checkpoint.last_fetch_at.format("%Y-%m-%d %H:%M:%S"),
                checkpoint.total_items_fetched
            );
        }
    }

    // Show storage info
    println!("\nStorage:");
    println!("  Type: {}", config.storage_type);
    println!("  Path: {}", config.data_dir.display());

    Ok(())
}

/// Resets checkpoint for a source
async fn reset_checkpoint(config: Config, source: &str) -> Result<()> {
    use crate::checkpoint::CheckpointManager;

    let mut checkpoint_mgr = CheckpointManager::new(&config.checkpoint_dir).await?;
    
    if source == "all" {
        checkpoint_mgr.reset_all();
        println!("✅ Reset all checkpoints");
    } else {
        checkpoint_mgr.reset_source(source);
        println!("✅ Reset checkpoint for source: {}", source);
    }

    checkpoint_mgr.save().await?;
    Ok(())
}

/// Runs the pipeline service
async fn run_pipeline(
    config: Config,
    correlation_id: String,
    shutdown_tx: broadcast::Sender<()>,
    channel_capacity: usize,
    enable_enrich: bool,
    enable_embed: bool,
) -> Result<()> {
    use crate::message_bus::{MessageBusType, MessageBusConfig, create_message_bus};
    use crate::pipeline::{Pipeline, PipelineConfig, PipelineItem};
    use crate::metrics::{start_metrics_server, MetricsReporter};
    use std::net::SocketAddr;

    info!(
        channel_capacity,
        enable_enrich,
        enable_embed,
        "Starting pipeline service"
    );

    // Check for message bus configuration
    let bus_url = config.message_bus_url()
        .ok_or_else(|| anyhow::anyhow!("Message bus URL not configured (set REDIS_URL or NATS_URL)"))?;
    
    let bus_type: MessageBusType = config.message_bus_type.parse()?;
    
    info!(
        bus_type = ?bus_type,
        stream = %config.message_bus_stream,
        "Connecting to message bus"
    );

    // Create message bus
    let bus_config = MessageBusConfig {
        stream_name: config.message_bus_stream.clone(),
        max_len: Some(100_000),
        ..Default::default()
    };
    
    let message_bus = create_message_bus(bus_type, bus_url, bus_config).await?;

    // Create pipeline config
    let pipeline_config = PipelineConfig {
        channel_capacity,
        enable_enrich,
        enable_embed,
        ..PipelineConfig::from_config(&config)
    };

    // Create pipeline
    let pipeline = Pipeline::new(pipeline_config, message_bus).await?;
    let pipeline = Arc::new(pipeline);

    // Start metrics server
    if config.metrics_enabled {
        let metrics_addr: SocketAddr = format!("0.0.0.0:{}", config.metrics_port).parse()?;
        let metrics_handle = tokio::spawn(async move {
            if let Err(e) = start_metrics_server(metrics_addr).await {
                error!(error = %e, "Metrics server failed");
            }
        });
        info!(port = config.metrics_port, "Metrics server started at /metrics");
    }

    // Start metrics reporter
    let reporter = MetricsReporter::new(30); // Log every 30 seconds
    let reporter_handle = reporter.start();

    // Initialize harvester for data source
    let harvester = Arc::new(Harvester::new(config.clone(), correlation_id.clone()).await?);

    info!("Pipeline service initialized, starting data flow...");

    // Spawn shutdown handler
    let shutdown_pipeline = pipeline.clone();
    let shutdown_harvester = harvester.clone();
    let shutdown_reporter = reporter;
    tokio::spawn(async move {
        shutdown_signal(shutdown_tx).await;
        
        info!("Shutting down pipeline...");
        shutdown_pipeline.shutdown().await;
        shutdown_harvester.shutdown().await;
        shutdown_reporter.stop();
        info!("Pipeline shutdown complete");
    });

    // Main loop: fetch from harvester and submit to pipeline
    let mut interval = tokio::time::interval(std::time::Duration::from_millis(
        config.trending_interval_ms,
    ));

    loop {
        interval.tick().await;

        // Fetch from all sources
        let fetch_options = crate::sources::FetchOptions {
            since: Some(chrono::Utc::now() - chrono::Duration::minutes(5)),
            limit: Some(100),
            cursor: None,
            query: None,
            filters: std::collections::HashMap::new(),
        };

        match harvester.fetch_from_source("all", fetch_options).await {
            Ok(events) => {
                let event_count = events.len();
                if event_count > 0 {
                    info!(count = event_count, "Fetched events from sources");

                    // Submit to pipeline
                    for event in events {
                        let item = PipelineItem::new(
                            event,
                            &correlation_id,
                            "harvester",
                        );
                        
                        if let Err(e) = pipeline.submit(item).await {
                            error!(error = %e, "Failed to submit to pipeline");
                        }
                    }
                }
            }
            Err(e) => {
                error!(error = %e, "Failed to fetch from sources");
            }
        }

        // Log pipeline stats
        let stats = pipeline.stats();
        if stats.has_backpressure() {
            warn!(
                bottleneck = stats.bottleneck(),
                fetch_depth = stats.fetch_queue_depth,
                normalize_depth = stats.normalize_queue_depth,
                "Pipeline backpressure detected"
            );
        }
    }
}
