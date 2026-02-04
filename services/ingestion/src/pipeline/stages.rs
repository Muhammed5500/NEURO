//! Pipeline Stage Implementations
//!
//! Each stage processes items and passes them to the next stage.
//! Stages are composable and can be enabled/disabled via config.

use async_trait::async_trait;
use std::sync::Arc;
use std::time::Instant;
use tracing::{debug, error, info, warn};

use crate::metrics::{self, StageTimer};
use crate::schemas::{IngestionEvent, Status};
use crate::message_bus::ResilientPublisher;
use super::{PipelineItem, EnrichmentData};

// ============================================
// STAGE TRAIT
// ============================================

#[async_trait]
pub trait Stage: Send + Sync {
    /// Process a single item
    async fn process(&self, item: PipelineItem) -> anyhow::Result<PipelineItem>;
    
    /// Stage name for metrics
    fn name(&self) -> &'static str;
    
    /// Whether this stage produces output
    fn has_output(&self) -> bool {
        true
    }
}

// ============================================
// FETCH STAGE
// ============================================

/// Fetch stage - receives raw data from sources
/// (This stage is actually external - items are submitted directly)
pub struct FetchStage;

impl FetchStage {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Stage for FetchStage {
    async fn process(&self, item: PipelineItem) -> anyhow::Result<PipelineItem> {
        // Fetch stage is a passthrough - items come from external sources
        Ok(item)
    }
    
    fn name(&self) -> &'static str {
        metrics::STAGE_FETCH
    }
}

// ============================================
// NORMALIZE STAGE
// ============================================

/// Normalize stage - standardizes data format and validates
pub struct NormalizeStage {
    // Add any normalization rules here
}

impl NormalizeStage {
    pub fn new() -> Self {
        Self {}
    }
    
    fn normalize_event(&self, event: &mut IngestionEvent) {
        // Ensure required fields are present
        if event.payload_hash.is_none() {
            use sha2::{Sha256, Digest};
            let payload_json = serde_json::to_string(&event.payload).unwrap_or_default();
            let hash = Sha256::digest(payload_json.as_bytes());
            event.payload_hash = Some(format!("sha256:{}", hex::encode(hash)));
        }
        
        // Normalize status
        if event.status == Status::Pending {
            event.status = Status::Processing;
            event.processing_started_at = Some(chrono::Utc::now().to_rfc3339());
        }
        
        // Calculate payload size if not set
        if event.payload_size == 0 {
            let size = serde_json::to_string(&event.payload)
                .map(|s| s.len() as u64)
                .unwrap_or(0);
            event.payload_size = size;
        }
    }
    
    fn validate_event(&self, event: &IngestionEvent) -> Vec<String> {
        let mut errors = Vec::new();
        
        if event.id.is_empty() {
            errors.push("Missing event ID".to_string());
        }
        
        if event.source_id.is_empty() {
            errors.push("Missing source ID".to_string());
        }
        
        if event.payload.is_empty() {
            errors.push("Empty payload".to_string());
        }
        
        errors
    }
}

#[async_trait]
impl Stage for NormalizeStage {
    async fn process(&self, mut item: PipelineItem) -> anyhow::Result<PipelineItem> {
        let _timer = StageTimer::new(self.name());
        
        // Normalize the event
        self.normalize_event(&mut item.event);
        
        // Validate
        let errors = self.validate_event(&item.event);
        if !errors.is_empty() {
            item.event.validation_errors = errors.clone();
            item.event.is_valid = false;
            warn!(
                event_id = %item.event.id,
                errors = ?errors,
                "Validation errors in event"
            );
        }
        
        debug!(
            event_id = %item.event.id,
            source = %item.source,
            "Normalized event"
        );
        
        Ok(item)
    }
    
    fn name(&self) -> &'static str {
        metrics::STAGE_NORMALIZE
    }
}

// ============================================
// ENRICH STAGE
// ============================================

/// Enrich stage - adds metadata, sentiment, entity extraction
pub struct EnrichStage {
    // Add enrichment services here (e.g., NLP, entity extraction)
}

impl EnrichStage {
    pub fn new() -> Self {
        Self {}
    }
    
    fn extract_tickers(&self, text: &str) -> Vec<String> {
        // Simple ticker extraction (symbols starting with $)
        let mut tickers = Vec::new();
        for word in text.split_whitespace() {
            if word.starts_with('$') && word.len() > 1 {
                let ticker = word[1..].trim_matches(|c: char| !c.is_alphanumeric());
                if !ticker.is_empty() && ticker.len() <= 10 {
                    tickers.push(ticker.to_uppercase());
                }
            }
        }
        tickers.sort();
        tickers.dedup();
        tickers
    }
    
    fn detect_language(&self, text: &str) -> String {
        // Simple heuristic - check for common English words
        let lower = text.to_lowercase();
        let english_words = ["the", "is", "at", "which", "on", "for", "and", "to"];
        let count: usize = english_words.iter().filter(|w| lower.contains(*w)).count();
        
        if count >= 2 {
            "en".to_string()
        } else {
            "unknown".to_string()
        }
    }
    
    fn simple_sentiment(&self, text: &str) -> f64 {
        // Very simple sentiment heuristic
        let lower = text.to_lowercase();
        
        let positive = ["good", "great", "excellent", "bullish", "moon", "pump", "up", "buy", "long"];
        let negative = ["bad", "terrible", "bearish", "dump", "down", "sell", "short", "crash"];
        
        let pos_count: i32 = positive.iter().filter(|w| lower.contains(*w)).count() as i32;
        let neg_count: i32 = negative.iter().filter(|w| lower.contains(*w)).count() as i32;
        
        let total = pos_count + neg_count;
        if total == 0 {
            0.0
        } else {
            (pos_count - neg_count) as f64 / total as f64
        }
    }
    
    fn categorize(&self, event: &IngestionEvent) -> String {
        match &event.data_type {
            crate::schemas::IngestionDataType::News => "news".to_string(),
            crate::schemas::IngestionDataType::Social => "social".to_string(),
            crate::schemas::IngestionDataType::MarketData => "market".to_string(),
            crate::schemas::IngestionDataType::TokenData => "token".to_string(),
            crate::schemas::IngestionDataType::Transaction => "transaction".to_string(),
            _ => "other".to_string(),
        }
    }
}

#[async_trait]
impl Stage for EnrichStage {
    async fn process(&self, mut item: PipelineItem) -> anyhow::Result<PipelineItem> {
        let _timer = StageTimer::new(self.name());
        
        // Extract text content from payload
        let text = item.event.payload
            .get("content")
            .or_else(|| item.event.payload.get("title"))
            .or_else(|| item.event.payload.get("description"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        
        // Enrich with extracted data
        let enrichment = EnrichmentData {
            sentiment_score: Some(self.simple_sentiment(text)),
            entity_tags: vec![],
            related_tickers: self.extract_tickers(text),
            language: Some(self.detect_language(text)),
            category: Some(self.categorize(&item.event)),
        };
        
        // Store enrichment data
        item.enrichment = Some(enrichment.clone());
        
        // Also add to payload for persistence
        item.event.payload.insert(
            "enrichment".to_string(),
            serde_json::json!({
                "sentiment_score": enrichment.sentiment_score,
                "tickers": enrichment.related_tickers,
                "language": enrichment.language,
                "category": enrichment.category,
            }),
        );
        
        // Update quality score based on enrichment
        let quality = if enrichment.related_tickers.is_empty() && text.len() < 50 {
            0.3
        } else if !enrichment.related_tickers.is_empty() {
            0.8
        } else {
            0.5
        };
        item.event.data_quality_score = Some(quality);
        
        debug!(
            event_id = %item.event.id,
            tickers = ?enrichment.related_tickers,
            sentiment = ?enrichment.sentiment_score,
            "Enriched event"
        );
        
        Ok(item)
    }
    
    fn name(&self) -> &'static str {
        metrics::STAGE_ENRICH
    }
}

// ============================================
// EMBED STAGE
// ============================================

/// Embed stage - generates vector embeddings
pub struct EmbedStage {
    embedding_service_url: Option<String>,
}

impl EmbedStage {
    pub fn new(embedding_service_url: Option<String>) -> Self {
        Self { embedding_service_url }
    }
    
    async fn generate_embedding(&self, text: &str) -> anyhow::Result<Vec<f32>> {
        // TODO: Call actual embedding service
        // For now, return a placeholder embedding
        
        // Simple hash-based "embedding" for testing
        use sha2::{Sha256, Digest};
        let hash = Sha256::digest(text.as_bytes());
        let embedding: Vec<f32> = hash.iter()
            .map(|b| (*b as f32) / 255.0)
            .take(16) // Short embedding for testing
            .collect();
        
        Ok(embedding)
    }
}

#[async_trait]
impl Stage for EmbedStage {
    async fn process(&self, mut item: PipelineItem) -> anyhow::Result<PipelineItem> {
        let _timer = StageTimer::new(self.name());
        
        // Extract text for embedding
        let text = item.event.payload
            .get("content")
            .or_else(|| item.event.payload.get("title"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        
        if text.is_empty() {
            debug!(event_id = %item.event.id, "Skipping embedding - no text content");
            return Ok(item);
        }
        
        // Generate embedding
        match self.generate_embedding(text).await {
            Ok(embedding) => {
                item.embedding = Some(embedding);
                debug!(event_id = %item.event.id, "Generated embedding");
            }
            Err(e) => {
                warn!(
                    event_id = %item.event.id,
                    error = %e,
                    "Failed to generate embedding"
                );
            }
        }
        
        Ok(item)
    }
    
    fn name(&self) -> &'static str {
        metrics::STAGE_EMBED
    }
}

// ============================================
// PUBLISH STAGE
// ============================================

/// Publish stage - sends events to message bus
pub struct PublishStage {
    publisher: Arc<ResilientPublisher>,
}

impl PublishStage {
    pub fn new(publisher: Arc<ResilientPublisher>) -> Self {
        Self { publisher }
    }
}

#[async_trait]
impl Stage for PublishStage {
    async fn process(&self, mut item: PipelineItem) -> anyhow::Result<PipelineItem> {
        let _timer = StageTimer::new(self.name());
        
        // Mark as completed
        item.event.status = Status::Completed;
        item.event.processing_completed_at = Some(chrono::Utc::now().to_rfc3339());
        item.event.processing_duration_ms = Some(item.latency().as_millis() as u64);
        
        // Publish to message bus
        match self.publisher.publish(&item.event).await {
            Ok(result) => {
                debug!(
                    event_id = %item.event.id,
                    stream_id = ?result.stream_id,
                    latency_ms = item.latency().as_millis(),
                    "Published event"
                );
            }
            Err(e) => {
                error!(
                    event_id = %item.event.id,
                    error = %e,
                    "Failed to publish event"
                );
                item.event.status = Status::Failed;
                item.event.error_message = Some(e.to_string());
                metrics::record_error(self.name(), "publish_failed");
            }
        }
        
        Ok(item)
    }
    
    fn name(&self) -> &'static str {
        metrics::STAGE_PUBLISH
    }
    
    fn has_output(&self) -> bool {
        false // Publish is the terminal stage
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn create_test_event() -> IngestionEvent {
        IngestionEvent::new(
            crate::schemas::IngestionSourceType::NewsApi,
            "test-source".to_string(),
            "Test Source".to_string(),
            crate::schemas::IngestionDataType::News,
            {
                let mut payload = HashMap::new();
                payload.insert(
                    "content".to_string(),
                    serde_json::json!("Breaking: $BTC and $ETH are pumping! Great news for crypto."),
                );
                payload
            },
        )
    }

    #[tokio::test]
    async fn test_normalize_stage() {
        let stage = NormalizeStage::new();
        let item = PipelineItem::new(create_test_event(), "test-corr", "test");
        
        let result = stage.process(item).await.unwrap();
        
        assert!(result.event.payload_hash.is_some());
        assert!(result.event.validation_errors.is_empty());
    }

    #[tokio::test]
    async fn test_enrich_stage() {
        let stage = EnrichStage::new();
        let item = PipelineItem::new(create_test_event(), "test-corr", "test");
        
        let result = stage.process(item).await.unwrap();
        
        assert!(result.enrichment.is_some());
        let enrichment = result.enrichment.unwrap();
        assert!(enrichment.related_tickers.contains(&"BTC".to_string()));
        assert!(enrichment.related_tickers.contains(&"ETH".to_string()));
        assert!(enrichment.sentiment_score.unwrap() > 0.0); // "pumping", "great" are positive
    }

    #[test]
    fn test_ticker_extraction() {
        let stage = EnrichStage::new();
        
        let tickers = stage.extract_tickers("Buy $BTC and $ETH now! Also $DOGE.");
        assert_eq!(tickers, vec!["BTC", "DOGE", "ETH"]);
        
        let empty = stage.extract_tickers("No tickers here");
        assert!(empty.is_empty());
    }
}
