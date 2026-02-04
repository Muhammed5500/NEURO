//! Message Bus Abstraction
//!
//! Supports multiple backends:
//! - Redis Streams (development)
//! - NATS JetStream (production)
//! - Kafka (future)
//!
//! Turkish: "Mesaj kuyruğuna (Redis/NATS) yazarken işlemin atomik olduğundan
//! ve veri kaybı yaşanmadığından emin ol."

mod redis_streams;
mod nats_adapter;

pub use redis_streams::RedisStreamsBus;
pub use nats_adapter::NatsBus;

use async_trait::async_trait;
use serde::{Serialize, de::DeserializeOwned};
use std::time::Duration;
use crate::schemas::IngestionEvent;
use crate::metrics;

// ============================================
// MESSAGE BUS TRAIT
// ============================================

/// Message envelope with metadata
#[derive(Debug, Clone, Serialize)]
pub struct Message<T> {
    pub id: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub correlation_id: String,
    pub source: String,
    pub payload: T,
    pub retry_count: u32,
}

impl<T: Serialize> Message<T> {
    pub fn new(payload: T, source: &str, correlation_id: &str) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now(),
            correlation_id: correlation_id.to_string(),
            source: source.to_string(),
            payload,
            retry_count: 0,
        }
    }
}

/// Result of a publish operation
#[derive(Debug)]
pub struct PublishResult {
    pub message_id: String,
    pub stream_id: Option<String>,
    pub success: bool,
    pub error: Option<String>,
}

/// Configuration for message bus
#[derive(Debug, Clone)]
pub struct MessageBusConfig {
    pub stream_name: String,
    pub max_len: Option<u64>,
    pub ack_timeout: Duration,
    pub max_retries: u32,
    pub batch_size: usize,
}

impl Default for MessageBusConfig {
    fn default() -> Self {
        Self {
            stream_name: "neuro:ingestion".to_string(),
            max_len: Some(100_000),
            ack_timeout: Duration::from_secs(30),
            max_retries: 3,
            batch_size: 100,
        }
    }
}

/// Message bus interface
#[async_trait]
pub trait MessageBus: Send + Sync {
    /// Publishes a single message atomically
    async fn publish(&self, event: &IngestionEvent) -> anyhow::Result<PublishResult>;

    /// Publishes a batch of messages atomically
    async fn publish_batch(&self, events: &[IngestionEvent]) -> anyhow::Result<Vec<PublishResult>>;

    /// Creates a consumer for reading messages
    async fn subscribe(&self, consumer_group: &str, consumer_name: &str) -> anyhow::Result<Box<dyn MessageConsumer>>;

    /// Health check
    async fn is_healthy(&self) -> bool;

    /// Get bus type for metrics
    fn bus_type(&self) -> &'static str;

    /// Close connection
    async fn close(&self) -> anyhow::Result<()>;
}

/// Consumer interface for reading messages
#[async_trait]
pub trait MessageConsumer: Send + Sync {
    /// Reads next batch of messages
    async fn read(&mut self, count: usize, timeout: Duration) -> anyhow::Result<Vec<Message<IngestionEvent>>>;

    /// Acknowledges a message
    async fn ack(&self, message_id: &str) -> anyhow::Result<()>;

    /// Negative acknowledge (retry)
    async fn nack(&self, message_id: &str) -> anyhow::Result<()>;
}

// ============================================
// MESSAGE BUS FACTORY
// ============================================

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MessageBusType {
    Redis,
    Nats,
}

impl std::str::FromStr for MessageBusType {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "redis" | "redis_streams" => Ok(Self::Redis),
            "nats" | "nats_jetstream" => Ok(Self::Nats),
            _ => anyhow::bail!("Unknown message bus type: {}", s),
        }
    }
}

/// Creates a message bus based on configuration
pub async fn create_message_bus(
    bus_type: MessageBusType,
    connection_url: &str,
    config: MessageBusConfig,
) -> anyhow::Result<Box<dyn MessageBus>> {
    match bus_type {
        MessageBusType::Redis => {
            let bus = RedisStreamsBus::connect(connection_url, config).await?;
            Ok(Box::new(bus))
        }
        MessageBusType::Nats => {
            let bus = NatsBus::connect(connection_url, config).await?;
            Ok(Box::new(bus))
        }
    }
}

// ============================================
// RESILIENT PUBLISHER
// ============================================

/// Publisher with retry logic and metrics
pub struct ResilientPublisher {
    bus: Box<dyn MessageBus>,
    max_retries: u32,
    retry_delay: Duration,
}

impl ResilientPublisher {
    pub fn new(bus: Box<dyn MessageBus>, max_retries: u32, retry_delay: Duration) -> Self {
        Self {
            bus,
            max_retries,
            retry_delay,
        }
    }

    /// Publishes with automatic retry
    pub async fn publish(&self, event: &IngestionEvent) -> anyhow::Result<PublishResult> {
        let mut last_error = None;
        let bus_type = self.bus.bus_type();

        for attempt in 0..=self.max_retries {
            let start = std::time::Instant::now();

            match self.bus.publish(event).await {
                Ok(result) if result.success => {
                    metrics::record_publish_latency(bus_type, start.elapsed().as_secs_f64());
                    metrics::record_publish_success(bus_type);
                    return Ok(result);
                }
                Ok(result) => {
                    last_error = result.error;
                }
                Err(e) => {
                    last_error = Some(e.to_string());
                }
            }

            if attempt < self.max_retries {
                let delay = self.retry_delay * (attempt + 1);
                tokio::time::sleep(delay).await;
            }
        }

        metrics::record_publish_failure(bus_type);
        anyhow::bail!("Publish failed after {} retries: {:?}", self.max_retries, last_error)
    }

    /// Publishes batch with per-item retry
    pub async fn publish_batch(&self, events: &[IngestionEvent]) -> anyhow::Result<Vec<PublishResult>> {
        let bus_type = self.bus.bus_type();
        let start = std::time::Instant::now();

        // Try batch publish first
        match self.bus.publish_batch(events).await {
            Ok(results) => {
                let success_count = results.iter().filter(|r| r.success).count();
                metrics::record_publish_latency(bus_type, start.elapsed().as_secs_f64());
                
                for result in &results {
                    if result.success {
                        metrics::record_publish_success(bus_type);
                    } else {
                        metrics::record_publish_failure(bus_type);
                    }
                }

                if success_count == events.len() {
                    return Ok(results);
                }

                // Retry failed items individually
                let mut final_results = results;
                for (i, result) in final_results.iter_mut().enumerate() {
                    if !result.success {
                        if let Ok(retry_result) = self.publish(&events[i]).await {
                            *result = retry_result;
                        }
                    }
                }

                Ok(final_results)
            }
            Err(e) => {
                // Fall back to individual publishes
                let mut results = Vec::with_capacity(events.len());
                for event in events {
                    results.push(self.publish(event).await?);
                }
                Ok(results)
            }
        }
    }

    /// Checks if the bus is healthy
    pub async fn is_healthy(&self) -> bool {
        self.bus.is_healthy().await
    }

    /// Closes the publisher
    pub async fn close(&self) -> anyhow::Result<()> {
        self.bus.close().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_bus_type_parsing() {
        assert_eq!("redis".parse::<MessageBusType>().unwrap(), MessageBusType::Redis);
        assert_eq!("nats".parse::<MessageBusType>().unwrap(), MessageBusType::Nats);
        assert!("unknown".parse::<MessageBusType>().is_err());
    }
}
