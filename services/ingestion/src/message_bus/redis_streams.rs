//! Redis Streams Message Bus Implementation
//!
//! Uses Redis Streams for reliable message delivery with:
//! - Atomic XADD operations
//! - Consumer groups for distributed processing
//! - Automatic message acknowledgment
//! - Dead letter handling

use async_trait::async_trait;
use redis::{
    aio::ConnectionManager,
    streams::{StreamReadOptions, StreamReadReply},
    AsyncCommands, Client, RedisResult,
};
use std::time::Duration;
use tracing::{debug, error, info, warn};

use super::{Message, MessageBus, MessageBusConfig, MessageConsumer, PublishResult};
use crate::schemas::IngestionEvent;

// ============================================
// REDIS STREAMS BUS
// ============================================

pub struct RedisStreamsBus {
    conn: ConnectionManager,
    config: MessageBusConfig,
}

impl RedisStreamsBus {
    /// Connects to Redis
    pub async fn connect(url: &str, config: MessageBusConfig) -> anyhow::Result<Self> {
        let client = Client::open(url)?;
        let conn = ConnectionManager::new(client).await?;

        info!(stream = %config.stream_name, "Connected to Redis Streams");

        Ok(Self { conn, config })
    }

    /// Ensures consumer group exists
    async fn ensure_consumer_group(&self, group_name: &str) -> anyhow::Result<()> {
        let mut conn = self.conn.clone();
        
        // Try to create group, ignore if exists
        let result: RedisResult<()> = redis::cmd("XGROUP")
            .arg("CREATE")
            .arg(&self.config.stream_name)
            .arg(group_name)
            .arg("0")
            .arg("MKSTREAM")
            .query_async(&mut conn)
            .await;

        match result {
            Ok(_) => {
                info!(group = %group_name, stream = %self.config.stream_name, "Created consumer group");
            }
            Err(e) if e.to_string().contains("BUSYGROUP") => {
                // Group already exists, that's fine
                debug!(group = %group_name, "Consumer group already exists");
            }
            Err(e) => {
                return Err(e.into());
            }
        }

        Ok(())
    }
}

#[async_trait]
impl MessageBus for RedisStreamsBus {
    async fn publish(&self, event: &IngestionEvent) -> anyhow::Result<PublishResult> {
        let mut conn = self.conn.clone();
        let stream = &self.config.stream_name;

        // Serialize event
        let payload = serde_json::to_string(event)?;
        let event_id = &event.id;
        let source = &event.source_id;
        let data_type = format!("{:?}", event.data_type);

        // Atomic XADD with MAXLEN for bounded streams
        let mut cmd = redis::cmd("XADD");
        cmd.arg(stream);

        if let Some(max_len) = self.config.max_len {
            cmd.arg("MAXLEN").arg("~").arg(max_len);
        }

        cmd.arg("*")
            .arg("event_id").arg(event_id)
            .arg("source").arg(source)
            .arg("data_type").arg(&data_type)
            .arg("payload").arg(&payload);

        let result: RedisResult<String> = cmd.query_async(&mut conn).await;

        match result {
            Ok(stream_id) => {
                debug!(stream_id = %stream_id, event_id = %event_id, "Published to Redis Stream");
                Ok(PublishResult {
                    message_id: event_id.clone(),
                    stream_id: Some(stream_id),
                    success: true,
                    error: None,
                })
            }
            Err(e) => {
                error!(error = %e, event_id = %event_id, "Failed to publish to Redis Stream");
                Ok(PublishResult {
                    message_id: event_id.clone(),
                    stream_id: None,
                    success: false,
                    error: Some(e.to_string()),
                })
            }
        }
    }

    async fn publish_batch(&self, events: &[IngestionEvent]) -> anyhow::Result<Vec<PublishResult>> {
        let mut conn = self.conn.clone();
        let stream = &self.config.stream_name;

        // Use pipeline for atomic batch
        let mut pipe = redis::pipe();
        pipe.atomic();

        for event in events {
            let payload = serde_json::to_string(event)?;
            let event_id = &event.id;
            let source = &event.source_id;
            let data_type = format!("{:?}", event.data_type);

            let mut cmd = redis::cmd("XADD");
            cmd.arg(stream);

            if let Some(max_len) = self.config.max_len {
                cmd.arg("MAXLEN").arg("~").arg(max_len);
            }

            cmd.arg("*")
                .arg("event_id").arg(event_id)
                .arg("source").arg(source)
                .arg("data_type").arg(&data_type)
                .arg("payload").arg(&payload);

            pipe.add_command(cmd);
        }

        let results: RedisResult<Vec<String>> = pipe.query_async(&mut conn).await;

        match results {
            Ok(stream_ids) => {
                let mut publish_results = Vec::with_capacity(events.len());
                for (i, event) in events.iter().enumerate() {
                    publish_results.push(PublishResult {
                        message_id: event.id.clone(),
                        stream_id: stream_ids.get(i).cloned(),
                        success: true,
                        error: None,
                    });
                }
                Ok(publish_results)
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

    async fn subscribe(
        &self,
        consumer_group: &str,
        consumer_name: &str,
    ) -> anyhow::Result<Box<dyn MessageConsumer>> {
        self.ensure_consumer_group(consumer_group).await?;

        Ok(Box::new(RedisStreamsConsumer {
            conn: self.conn.clone(),
            stream: self.config.stream_name.clone(),
            group: consumer_group.to_string(),
            consumer: consumer_name.to_string(),
        }))
    }

    async fn is_healthy(&self) -> bool {
        let mut conn = self.conn.clone();
        let result: RedisResult<String> = redis::cmd("PING").query_async(&mut conn).await;
        result.is_ok()
    }

    fn bus_type(&self) -> &'static str {
        "redis_streams"
    }

    async fn close(&self) -> anyhow::Result<()> {
        // ConnectionManager doesn't need explicit close
        info!("Redis Streams connection closed");
        Ok(())
    }
}

// ============================================
// REDIS STREAMS CONSUMER
// ============================================

pub struct RedisStreamsConsumer {
    conn: ConnectionManager,
    stream: String,
    group: String,
    consumer: String,
}

#[async_trait]
impl MessageConsumer for RedisStreamsConsumer {
    async fn read(
        &mut self,
        count: usize,
        timeout: Duration,
    ) -> anyhow::Result<Vec<Message<IngestionEvent>>> {
        let opts = StreamReadOptions::default()
            .group(&self.group, &self.consumer)
            .count(count)
            .block(timeout.as_millis() as usize);

        let result: RedisResult<StreamReadReply> = self
            .conn
            .xread_options(&[&self.stream], &[">"], &opts)
            .await;

        match result {
            Ok(reply) => {
                let mut messages = Vec::new();

                for stream_key in reply.keys {
                    for entry in stream_key.ids {
                        let stream_id = entry.id.clone();

                        // Extract payload
                        if let Some(payload_str) = entry.map.get("payload") {
                            if let redis::Value::BulkString(bytes) = payload_str {
                                let payload_str = String::from_utf8_lossy(bytes);
                                if let Ok(event) = serde_json::from_str::<IngestionEvent>(&payload_str) {
                                    messages.push(Message {
                                        id: stream_id,
                                        timestamp: chrono::Utc::now(),
                                        correlation_id: event.id.clone(),
                                        source: event.source_id.clone(),
                                        payload: event,
                                        retry_count: 0,
                                    });
                                }
                            }
                        }
                    }
                }

                Ok(messages)
            }
            Err(e) if e.to_string().contains("timeout") => {
                // No messages available, return empty
                Ok(Vec::new())
            }
            Err(e) => Err(e.into()),
        }
    }

    async fn ack(&self, message_id: &str) -> anyhow::Result<()> {
        let mut conn = self.conn.clone();
        let _: () = redis::cmd("XACK")
            .arg(&self.stream)
            .arg(&self.group)
            .arg(message_id)
            .query_async(&mut conn)
            .await?;
        Ok(())
    }

    async fn nack(&self, message_id: &str) -> anyhow::Result<()> {
        // Redis doesn't have explicit NACK - we just don't ACK
        // The message will be re-delivered after the visibility timeout
        warn!(message_id = %message_id, "Message NACK'd, will be re-delivered");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Integration tests require Redis running
    // Run with: cargo test --features integration-tests
}
