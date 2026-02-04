//! Prometheus Metrics for Pipeline Stages
//!
//! Turkish: "Mainnet'te sistemin nerede tıkandığını görmek için
//! her aşama (stage) için Prometheus metrikleri ekle"
//!
//! Metrics include:
//! - events/sec per stage
//! - latency per stage (histogram)
//! - queue depth per channel
//! - error counts
//! - memory usage

use once_cell::sync::Lazy;
use prometheus::{
    register_counter_vec, register_gauge_vec, register_histogram_vec,
    register_int_counter_vec, register_int_gauge_vec,
    CounterVec, GaugeVec, HistogramVec, IntCounterVec, IntGaugeVec,
    Encoder, TextEncoder, Registry, Opts, HistogramOpts,
};
use std::sync::Arc;
use tracing::{info, error};

// ============================================
// METRIC DEFINITIONS
// ============================================

/// Stages in the ingestion pipeline
pub const STAGE_FETCH: &str = "fetch";
pub const STAGE_NORMALIZE: &str = "normalize";
pub const STAGE_ENRICH: &str = "enrich";
pub const STAGE_EMBED: &str = "embed";
pub const STAGE_PUBLISH: &str = "publish";

/// All stages for iteration
pub const ALL_STAGES: &[&str] = &[
    STAGE_FETCH,
    STAGE_NORMALIZE,
    STAGE_ENRICH,
    STAGE_EMBED,
    STAGE_PUBLISH,
];

// Events processed counter
static EVENTS_PROCESSED: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "ingestion_events_processed_total",
        "Total number of events processed by each stage",
        &["stage", "source"]
    ).expect("Failed to create events_processed metric")
});

// Events per second (rate, calculated from counter)
static EVENTS_RATE: Lazy<GaugeVec> = Lazy::new(|| {
    register_gauge_vec!(
        "ingestion_events_per_second",
        "Events processed per second by each stage",
        &["stage"]
    ).expect("Failed to create events_rate metric")
});

// Latency histogram (in seconds)
static STAGE_LATENCY: Lazy<HistogramVec> = Lazy::new(|| {
    let buckets = vec![
        0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
    ];
    register_histogram_vec!(
        HistogramOpts::new(
            "ingestion_stage_latency_seconds",
            "Latency of each pipeline stage in seconds"
        ).buckets(buckets),
        &["stage"]
    ).expect("Failed to create stage_latency metric")
});

// Queue depth (items waiting in channel)
static QUEUE_DEPTH: Lazy<IntGaugeVec> = Lazy::new(|| {
    register_int_gauge_vec!(
        "ingestion_queue_depth",
        "Number of items waiting in each queue",
        &["stage"]
    ).expect("Failed to create queue_depth metric")
});

// Queue capacity
static QUEUE_CAPACITY: Lazy<IntGaugeVec> = Lazy::new(|| {
    register_int_gauge_vec!(
        "ingestion_queue_capacity",
        "Maximum capacity of each queue",
        &["stage"]
    ).expect("Failed to create queue_capacity metric")
});

// Worker count per stage
static WORKER_COUNT: Lazy<IntGaugeVec> = Lazy::new(|| {
    register_int_gauge_vec!(
        "ingestion_worker_count",
        "Number of workers per stage",
        &["stage"]
    ).expect("Failed to create worker_count metric")
});

// Active workers (currently processing)
static ACTIVE_WORKERS: Lazy<IntGaugeVec> = Lazy::new(|| {
    register_int_gauge_vec!(
        "ingestion_active_workers",
        "Number of workers currently processing",
        &["stage"]
    ).expect("Failed to create active_workers metric")
});

// Error counter
static ERRORS: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "ingestion_errors_total",
        "Total number of errors by stage and type",
        &["stage", "error_type"]
    ).expect("Failed to create errors metric")
});

// Backpressure events (when producer is slowed)
static BACKPRESSURE_EVENTS: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "ingestion_backpressure_events_total",
        "Number of times backpressure was applied",
        &["stage"]
    ).expect("Failed to create backpressure_events metric")
});

// Message bus publish latency
static PUBLISH_LATENCY: Lazy<HistogramVec> = Lazy::new(|| {
    let buckets = vec![0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0];
    register_histogram_vec!(
        HistogramOpts::new(
            "ingestion_publish_latency_seconds",
            "Latency of publishing to message bus"
        ).buckets(buckets),
        &["bus_type"]
    ).expect("Failed to create publish_latency metric")
});

// Publish success/failure
static PUBLISH_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "ingestion_publish_total",
        "Total number of publish operations",
        &["bus_type", "status"]
    ).expect("Failed to create publish_total metric")
});

// Memory usage (RSS in bytes)
static MEMORY_USAGE: Lazy<IntGaugeVec> = Lazy::new(|| {
    register_int_gauge_vec!(
        "ingestion_memory_bytes",
        "Memory usage in bytes",
        &["type"]
    ).expect("Failed to create memory_usage metric")
});

// Deduplication stats
static DEDUP_HITS: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "ingestion_dedup_hits_total",
        "Number of duplicate items detected",
        &["source"]
    ).expect("Failed to create dedup_hits metric")
});

// ============================================
// METRICS API
// ============================================

/// Records an event processed by a stage
pub fn record_event_processed(stage: &str, source: &str) {
    EVENTS_PROCESSED.with_label_values(&[stage, source]).inc();
}

/// Records multiple events processed
pub fn record_events_processed(stage: &str, source: &str, count: u64) {
    EVENTS_PROCESSED.with_label_values(&[stage, source]).inc_by(count);
}

/// Records stage latency
pub fn record_stage_latency(stage: &str, latency_secs: f64) {
    STAGE_LATENCY.with_label_values(&[stage]).observe(latency_secs);
}

/// Updates queue depth
pub fn set_queue_depth(stage: &str, depth: i64) {
    QUEUE_DEPTH.with_label_values(&[stage]).set(depth);
}

/// Sets queue capacity
pub fn set_queue_capacity(stage: &str, capacity: i64) {
    QUEUE_CAPACITY.with_label_values(&[stage]).set(capacity);
}

/// Sets worker count for a stage
pub fn set_worker_count(stage: &str, count: i64) {
    WORKER_COUNT.with_label_values(&[stage]).set(count);
}

/// Increments active worker count
pub fn inc_active_workers(stage: &str) {
    ACTIVE_WORKERS.with_label_values(&[stage]).inc();
}

/// Decrements active worker count
pub fn dec_active_workers(stage: &str) {
    ACTIVE_WORKERS.with_label_values(&[stage]).dec();
}

/// Records an error
pub fn record_error(stage: &str, error_type: &str) {
    ERRORS.with_label_values(&[stage, error_type]).inc();
}

/// Records backpressure event
pub fn record_backpressure(stage: &str) {
    BACKPRESSURE_EVENTS.with_label_values(&[stage]).inc();
}

/// Records publish latency
pub fn record_publish_latency(bus_type: &str, latency_secs: f64) {
    PUBLISH_LATENCY.with_label_values(&[bus_type]).observe(latency_secs);
}

/// Records publish success
pub fn record_publish_success(bus_type: &str) {
    PUBLISH_TOTAL.with_label_values(&[bus_type, "success"]).inc();
}

/// Records publish failure
pub fn record_publish_failure(bus_type: &str) {
    PUBLISH_TOTAL.with_label_values(&[bus_type, "failure"]).inc();
}

/// Records memory usage
pub fn set_memory_usage(memory_type: &str, bytes: i64) {
    MEMORY_USAGE.with_label_values(&[memory_type]).set(bytes);
}

/// Records deduplication hit
pub fn record_dedup_hit(source: &str) {
    DEDUP_HITS.with_label_values(&[source]).inc();
}

/// Updates events per second rate (call periodically)
pub fn update_events_rate(stage: &str, rate: f64) {
    EVENTS_RATE.with_label_values(&[stage]).set(rate);
}

// ============================================
// METRICS COLLECTION
// ============================================

/// Collects all metrics as Prometheus text format
pub fn gather_metrics() -> String {
    let encoder = TextEncoder::new();
    let metric_families = prometheus::gather();
    
    let mut buffer = Vec::new();
    if let Err(e) = encoder.encode(&metric_families, &mut buffer) {
        error!(error = %e, "Failed to encode metrics");
        return String::new();
    }
    
    String::from_utf8(buffer).unwrap_or_default()
}

/// A timer for measuring stage latency
pub struct StageTimer {
    stage: &'static str,
    start: std::time::Instant,
}

impl StageTimer {
    pub fn new(stage: &'static str) -> Self {
        Self {
            stage,
            start: std::time::Instant::now(),
        }
    }
}

impl Drop for StageTimer {
    fn drop(&mut self) {
        let elapsed = self.start.elapsed().as_secs_f64();
        record_stage_latency(self.stage, elapsed);
    }
}

/// Macro for timing a stage
#[macro_export]
macro_rules! time_stage {
    ($stage:expr, $block:expr) => {{
        let _timer = $crate::metrics::StageTimer::new($stage);
        $block
    }};
}

// ============================================
// METRICS SERVER
// ============================================

use hyper::{body::Incoming, server::conn::http1, service::service_fn, Request, Response};
use hyper_util::rt::TokioIo;
use http_body_util::Full;
use hyper::body::Bytes;
use std::convert::Infallible;
use std::net::SocketAddr;
use tokio::net::TcpListener;

/// Handles metrics HTTP requests
async fn handle_metrics(_req: Request<Incoming>) -> Result<Response<Full<Bytes>>, Infallible> {
    let metrics = gather_metrics();
    Ok(Response::new(Full::new(Bytes::from(metrics))))
}

/// Starts the metrics HTTP server
pub async fn start_metrics_server(addr: SocketAddr) -> anyhow::Result<()> {
    let listener = TcpListener::bind(addr).await?;
    info!(address = %addr, "Metrics server listening");

    loop {
        let (stream, _) = listener.accept().await?;
        let io = TokioIo::new(stream);

        tokio::spawn(async move {
            if let Err(e) = http1::Builder::new()
                .serve_connection(io, service_fn(handle_metrics))
                .await
            {
                error!(error = %e, "Error serving metrics connection");
            }
        });
    }
}

// ============================================
// METRICS REPORTER
// ============================================

/// Periodically reports metrics summary to logs
pub struct MetricsReporter {
    interval: std::time::Duration,
    running: Arc<std::sync::atomic::AtomicBool>,
}

impl MetricsReporter {
    pub fn new(interval_secs: u64) -> Self {
        Self {
            interval: std::time::Duration::from_secs(interval_secs),
            running: Arc::new(std::sync::atomic::AtomicBool::new(true)),
        }
    }

    /// Starts the metrics reporter in background
    pub fn start(&self) -> tokio::task::JoinHandle<()> {
        let interval = self.interval;
        let running = self.running.clone();

        tokio::spawn(async move {
            let mut prev_counts: std::collections::HashMap<String, u64> = std::collections::HashMap::new();

            while running.load(std::sync::atomic::Ordering::Relaxed) {
                tokio::time::sleep(interval).await;

                // Calculate rates
                for stage in ALL_STAGES {
                    let metric = EVENTS_PROCESSED.with_label_values(&[stage, "all"]);
                    let current = metric.get();
                    let key = stage.to_string();
                    
                    let prev = prev_counts.get(&key).copied().unwrap_or(0);
                    let rate = (current - prev) as f64 / interval.as_secs_f64();
                    
                    update_events_rate(stage, rate);
                    prev_counts.insert(key, current);
                }

                // Log summary
                info!(
                    target: "metrics",
                    "Pipeline metrics - check /metrics endpoint for details"
                );
            }
        })
    }

    /// Stops the reporter
    pub fn stop(&self) {
        self.running.store(false, std::sync::atomic::Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_record_metrics() {
        record_event_processed(STAGE_FETCH, "newsapi");
        record_stage_latency(STAGE_FETCH, 0.05);
        set_queue_depth(STAGE_NORMALIZE, 10);
        record_error(STAGE_PUBLISH, "connection_error");
        
        let metrics = gather_metrics();
        assert!(metrics.contains("ingestion_events_processed_total"));
        assert!(metrics.contains("ingestion_stage_latency_seconds"));
        assert!(metrics.contains("ingestion_queue_depth"));
        assert!(metrics.contains("ingestion_errors_total"));
    }

    #[test]
    fn test_stage_timer() {
        {
            let _timer = StageTimer::new(STAGE_ENRICH);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        
        let metrics = gather_metrics();
        assert!(metrics.contains("ingestion_stage_latency_seconds"));
    }
}
