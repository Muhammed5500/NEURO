//! NewsItem Schema
//! 
//! Represents a news article or update from various sources
//! Compatible with TypeScript NewsItem schema

use serde::{Deserialize, Serialize};
use super::common::{Sentiment, Severity, Uuid, Timestamp, SchemaVersion};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NewsSource {
    Twitter,
    Discord,
    Telegram,
    Reddit,
    Medium,
    Mirror,
    Rss,
    Api,
    Scraper,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NewsCategory {
    Market,
    Protocol,
    Regulatory,
    Technical,
    Social,
    Security,
    Partnership,
    Listing,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem {
    // Base fields
    pub schema_version: SchemaVersion,
    pub id: Uuid,
    pub created_at: Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<Timestamp>,
    
    // Content
    pub title: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    
    // Source information
    pub source: NewsSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    
    // Classification
    pub category: NewsCategory,
    #[serde(default)]
    pub tags: Vec<String>,
    
    // Analysis
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sentiment: Option<Sentiment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sentiment_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relevance_score: Option<f64>,
    #[serde(default = "default_importance")]
    pub importance: Severity,
    
    // Related entities
    #[serde(default)]
    pub mentioned_tokens: Vec<String>,
    #[serde(default)]
    pub mentioned_addresses: Vec<String>,
    
    // Metadata
    #[serde(default = "default_language")]
    pub language: String,
    pub published_at: Timestamp,
    pub fetched_at: Timestamp,
    
    // Processing status
    #[serde(default)]
    pub processed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_id: Option<Uuid>,
}

fn default_importance() -> Severity {
    Severity::Medium
}

fn default_language() -> String {
    "en".to_string()
}

impl NewsItem {
    pub fn new(
        title: String,
        content: String,
        source: NewsSource,
        category: NewsCategory,
        published_at: Timestamp,
        fetched_at: Timestamp,
    ) -> Self {
        Self {
            schema_version: super::CURRENT_SCHEMA_VERSION.to_string(),
            id: uuid::Uuid::new_v4().to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: None,
            title,
            content,
            summary: None,
            source,
            source_url: None,
            source_id: None,
            author: None,
            category,
            tags: vec![],
            sentiment: None,
            sentiment_score: None,
            relevance_score: None,
            importance: Severity::Medium,
            mentioned_tokens: vec![],
            mentioned_addresses: vec![],
            language: "en".to_string(),
            published_at,
            fetched_at,
            processed: false,
            embedding_id: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_news_item_serialization() {
        let item = NewsItem::new(
            "Test Title".to_string(),
            "Test content".to_string(),
            NewsSource::Twitter,
            NewsCategory::Protocol,
            "2024-01-15T10:00:00Z".to_string(),
            "2024-01-15T10:30:00Z".to_string(),
        );

        let json = serde_json::to_string_pretty(&item).unwrap();
        println!("{}", json);
        
        // Verify camelCase
        assert!(json.contains("schemaVersion"));
        assert!(json.contains("createdAt"));
        assert!(json.contains("sourceUrl")); // Should not appear if None, but field name is camelCase
        
        // Deserialize back
        let parsed: NewsItem = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.title, item.title);
    }

    #[test]
    fn test_typescript_compatibility() {
        // JSON from TypeScript
        let ts_json = r#"{
            "schemaVersion": "1.0.0",
            "id": "550e8400-e29b-41d4-a716-446655440001",
            "createdAt": "2024-01-15T10:30:00Z",
            "title": "Monad Mainnet Launch",
            "content": "The Monad team has announced...",
            "source": "twitter",
            "category": "protocol",
            "tags": ["monad", "mainnet"],
            "sentiment": "bullish",
            "sentimentScore": 0.85,
            "importance": "high",
            "mentionedTokens": ["MON"],
            "mentionedAddresses": [],
            "language": "en",
            "publishedAt": "2024-01-15T10:00:00Z",
            "fetchedAt": "2024-01-15T10:30:00Z",
            "processed": true
        }"#;

        let parsed: NewsItem = serde_json::from_str(ts_json).unwrap();
        assert_eq!(parsed.title, "Monad Mainnet Launch");
        assert_eq!(parsed.sentiment, Some(Sentiment::Bullish));
        assert_eq!(parsed.importance, Severity::High);
    }
}
