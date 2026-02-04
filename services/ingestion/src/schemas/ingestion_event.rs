//! IngestionEvent Schema
//! 
//! Represents data ingestion events from various sources
//! Compatible with TypeScript IngestionEvent schema

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use super::common::{Status, Severity, Uuid, Timestamp, SchemaVersion};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IngestionSourceType {
    NadfunApi,
    MonadRpc,
    SocialApi,
    NewsApi,
    Websocket,
    Webhook,
    Scraper,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IngestionDataType {
    TokenData,
    MarketData,
    Transaction,
    Block,
    News,
    Social,
    Price,
    Liquidity,
    HolderData,
    ContractEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestionEvent {
    // Base fields
    pub schema_version: SchemaVersion,
    pub id: Uuid,
    pub created_at: Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<Timestamp>,
    
    // Source information
    pub source_type: IngestionSourceType,
    pub source_id: String,
    pub source_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    
    // Data classification
    pub data_type: IngestionDataType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_subtype: Option<String>,
    
    // Payload
    pub payload: HashMap<String, serde_json::Value>,
    pub payload_size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload_hash: Option<String>,
    
    // Processing
    pub status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processing_started_at: Option<Timestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processing_completed_at: Option<Timestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processing_duration_ms: Option<u64>,
    
    // Error handling
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default)]
    pub retry_count: u32,
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    
    // Quality metrics
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_quality_score: Option<f64>,
    #[serde(default = "default_true")]
    pub is_valid: bool,
    #[serde(default)]
    pub validation_errors: Vec<String>,
    
    // Priority
    #[serde(default = "default_priority")]
    pub priority: Severity,
    
    // Deduplication
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deduplication_key: Option<String>,
    #[serde(default)]
    pub is_duplicate: bool,
    
    // Batch info
    #[serde(skip_serializing_if = "Option::is_none")]
    pub batch_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub batch_index: Option<u32>,
    
    // Timestamps
    pub ingested_at: Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_timestamp: Option<Timestamp>,
}

fn default_max_retries() -> u32 {
    3
}

fn default_true() -> bool {
    true
}

fn default_priority() -> Severity {
    Severity::Medium
}

impl IngestionEvent {
    pub fn new(
        source_type: IngestionSourceType,
        source_id: String,
        source_name: String,
        data_type: IngestionDataType,
        payload: HashMap<String, serde_json::Value>,
    ) -> Self {
        let payload_json = serde_json::to_string(&payload).unwrap_or_default();
        let payload_size = payload_json.len() as u64;
        let now = chrono::Utc::now().to_rfc3339();
        
        Self {
            schema_version: super::CURRENT_SCHEMA_VERSION.to_string(),
            id: uuid::Uuid::new_v4().to_string(),
            created_at: now.clone(),
            updated_at: None,
            source_type,
            source_id,
            source_name,
            source_url: None,
            data_type,
            data_subtype: None,
            payload,
            payload_size,
            payload_hash: None,
            status: Status::Pending,
            processing_started_at: None,
            processing_completed_at: None,
            processing_duration_ms: None,
            error_message: None,
            error_code: None,
            retry_count: 0,
            max_retries: 3,
            data_quality_score: None,
            is_valid: true,
            validation_errors: vec![],
            priority: Severity::Medium,
            deduplication_key: None,
            is_duplicate: false,
            batch_id: None,
            batch_index: None,
            ingested_at: now,
            data_timestamp: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ingestion_event_serialization() {
        let mut payload = HashMap::new();
        payload.insert("key".to_string(), serde_json::json!("value"));
        
        let event = IngestionEvent::new(
            IngestionSourceType::NadfunApi,
            "nadfun-trending".to_string(),
            "nad.fun Trending API".to_string(),
            IngestionDataType::MarketData,
            payload,
        );

        let json = serde_json::to_string_pretty(&event).unwrap();
        println!("{}", json);
        
        assert!(json.contains("sourceType"));
        assert!(json.contains("dataType"));
    }
}
