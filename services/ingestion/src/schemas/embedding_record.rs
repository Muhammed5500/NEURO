//! EmbeddingRecord Schema
//!
//! Represents vector embeddings for AI memory
//! Compatible with TypeScript EmbeddingRecord schema

use serde::{Deserialize, Serialize};
use super::common::{Uuid, Timestamp, SchemaVersion};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmbeddingSourceType {
    NewsItem,
    SocialSignal,
    MarketAnalysis,
    AgentDecision,
    Transaction,
    UserQuery,
    Document,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EmbeddingModel {
    #[serde(rename = "text-embedding-ada-002")]
    TextEmbeddingAda002,
    #[serde(rename = "text-embedding-3-small")]
    TextEmbedding3Small,
    #[serde(rename = "text-embedding-3-large")]
    TextEmbedding3Large,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingRecord {
    // Base fields
    pub schema_version: SchemaVersion,
    pub id: Uuid,
    pub created_at: Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<Timestamp>,
    
    // Source reference
    pub source_type: EmbeddingSourceType,
    pub source_id: Uuid,
    
    // Content
    pub content: String,
    pub content_hash: String,
    pub content_length: u64,
    
    // Embedding
    pub embedding: Vec<f64>,
    pub embedding_dimension: u32,
    pub embedding_model: EmbeddingModel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_model_version: Option<String>,
    
    // Vector store info
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vector_store_id: Option<String>,
    #[serde(default = "default_collection")]
    pub collection_name: String,
    
    // Metadata for retrieval
    #[serde(default)]
    pub metadata: std::collections::HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub tags: Vec<String>,
    
    // Chunking info
    #[serde(default)]
    pub is_chunked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_chunks: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<Uuid>,
    
    // Quality
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality_score: Option<f64>,
    
    // TTL
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<Timestamp>,
    
    // Processing
    pub generated_at: Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processing_time_ms: Option<u64>,
}

fn default_collection() -> String {
    "neuro_memories".to_string()
}

impl EmbeddingRecord {
    pub fn new(
        source_type: EmbeddingSourceType,
        source_id: Uuid,
        content: String,
        embedding: Vec<f64>,
        model: EmbeddingModel,
    ) -> Self {
        let content_hash = {
            use sha2::{Sha256, Digest};
            let mut hasher = Sha256::new();
            hasher.update(content.as_bytes());
            format!("sha256:{:x}", hasher.finalize())
        };
        let content_length = content.len() as u64;
        let embedding_dimension = embedding.len() as u32;
        let now = chrono::Utc::now().to_rfc3339();
        
        Self {
            schema_version: super::CURRENT_SCHEMA_VERSION.to_string(),
            id: uuid::Uuid::new_v4().to_string(),
            created_at: now.clone(),
            updated_at: None,
            source_type,
            source_id,
            content,
            content_hash,
            content_length,
            embedding,
            embedding_dimension,
            embedding_model: model,
            embedding_model_version: None,
            vector_store_id: None,
            collection_name: "neuro_memories".to_string(),
            metadata: std::collections::HashMap::new(),
            tags: vec![],
            is_chunked: false,
            chunk_index: None,
            total_chunks: None,
            parent_id: None,
            token_count: None,
            quality_score: None,
            expires_at: None,
            generated_at: now,
            processing_time_ms: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_embedding_record_serialization() {
        let record = EmbeddingRecord::new(
            EmbeddingSourceType::NewsItem,
            "550e8400-e29b-41d4-a716-446655440001".to_string(),
            "Test content".to_string(),
            vec![0.1, 0.2, 0.3],
            EmbeddingModel::TextEmbeddingAda002,
        );

        let json = serde_json::to_string_pretty(&record).unwrap();
        println!("{}", json);
        
        assert!(json.contains("embeddingModel"));
        assert!(json.contains("text-embedding-ada-002"));
    }
}
