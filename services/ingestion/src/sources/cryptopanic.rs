//! CryptoPanic Data Source
//!
//! Fetches crypto news and social signals from CryptoPanic.com
//! https://cryptopanic.com/developers/api/

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{debug, warn, info};

use super::{Source, SourceMetadata, FetchOptions, FetchResult};
use crate::circuit_breaker::CircuitBreaker;
use crate::dedup::news_dedup_key;
use crate::error::{IngestionError, Result};
use crate::http_client::{ResilientHttpClient, SourceHttpClient};
use crate::schemas::{IngestionEvent, IngestionSourceType, IngestionDataType, Status, Severity, CURRENT_SCHEMA_VERSION};

const CRYPTOPANIC_BASE_URL: &str = "https://cryptopanic.com/api/v1";

/// CryptoPanic API response
#[derive(Debug, Deserialize)]
struct CryptoPanicResponse {
    count: Option<u32>,
    next: Option<String>,
    previous: Option<String>,
    results: Option<Vec<CryptoPanicPost>>,
}

/// A single post from CryptoPanic
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CryptoPanicPost {
    pub kind: String,
    pub domain: Option<String>,
    pub source: CryptoPanicSourceInfo,
    pub title: String,
    pub published_at: String,
    pub slug: String,
    pub id: u64,
    pub url: String,
    #[serde(default)]
    pub currencies: Vec<CryptoPanicCurrency>,
    pub votes: Option<CryptoPanicVotes>,
    pub metadata: Option<CryptoPanicMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CryptoPanicSourceInfo {
    pub title: String,
    pub region: String,
    pub domain: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CryptoPanicCurrency {
    pub code: String,
    pub title: String,
    pub slug: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CryptoPanicVotes {
    pub negative: u32,
    pub positive: u32,
    pub important: u32,
    pub liked: u32,
    pub disliked: u32,
    pub lol: u32,
    pub toxic: u32,
    pub saved: u32,
    pub comments: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CryptoPanicMetadata {
    pub image: Option<String>,
    pub description: Option<String>,
}

/// CryptoPanic data source
pub struct CryptoPanicSource {
    client: SourceHttpClient,
    api_key: String,
    metadata: SourceMetadata,
}

impl CryptoPanicSource {
    /// Creates a new CryptoPanic source
    pub fn new(
        http_client: Arc<ResilientHttpClient>,
        api_key: String,
        rate_limit_rpm: u32,
        circuit_breaker: Arc<CircuitBreaker>,
    ) -> Self {
        let client = SourceHttpClient::new(
            http_client,
            "cryptopanic",
            rate_limit_rpm,
            circuit_breaker,
        );

        let metadata = SourceMetadata {
            id: "cryptopanic".to_string(),
            name: "CryptoPanic".to_string(),
            description: "Crypto news aggregator with sentiment voting".to_string(),
            default_rate_limit: rate_limit_rpm,
            supports_pagination: true,
            supports_since: true,
        };

        Self {
            client,
            api_key,
            metadata,
        }
    }

    /// Builds the API URL with parameters
    fn build_url(&self, options: &FetchOptions) -> String {
        let mut params = vec![
            ("auth_token", self.api_key.clone()),
            ("public", "true".to_string()),
        ];

        // Filter by currencies if specified
        if let Some(ref query) = options.query {
            params.push(("currencies", query.clone()));
        }

        // Pagination cursor
        if let Some(ref cursor) = options.cursor {
            return cursor.clone(); // CryptoPanic provides full URL for next page
        }

        let query_string: String = params
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join("&");

        format!("{}/posts/?{}", CRYPTOPANIC_BASE_URL, query_string)
    }

    /// Fetches posts from the API
    async fn fetch_posts(&self, options: &FetchOptions) -> Result<(Vec<CryptoPanicPost>, Option<String>)> {
        let url = self.build_url(options);

        debug!(
            source = "cryptopanic",
            url = %url,
            "Fetching posts"
        );

        let response = self.client.get(&url).await?;
        let text = response.text().await
            .map_err(|e| IngestionError::HttpError(e))?;

        let api_response: CryptoPanicResponse = serde_json::from_str(&text)
            .map_err(|e| IngestionError::JsonError(e))?;

        let posts = api_response.results.unwrap_or_default();
        let next_cursor = api_response.next;

        // Filter by since timestamp if provided
        let filtered_posts: Vec<CryptoPanicPost> = if let Some(since) = options.since {
            posts.into_iter()
                .filter(|p| {
                    DateTime::parse_from_rfc3339(&p.published_at)
                        .map(|dt| dt.with_timezone(&Utc) >= since)
                        .unwrap_or(true)
                })
                .collect()
        } else {
            posts
        };

        Ok((filtered_posts, next_cursor))
    }

    /// Converts a CryptoPanic post to an IngestionEvent
    fn post_to_event(&self, post: &CryptoPanicPost) -> IngestionEvent {
        let mut payload = HashMap::new();
        payload.insert("id".to_string(), serde_json::json!(post.id));
        payload.insert("title".to_string(), serde_json::json!(post.title));
        payload.insert("url".to_string(), serde_json::json!(post.url));
        payload.insert("kind".to_string(), serde_json::json!(post.kind));
        payload.insert("source".to_string(), serde_json::json!(post.source.title));
        payload.insert("publishedAt".to_string(), serde_json::json!(post.published_at));
        payload.insert("slug".to_string(), serde_json::json!(post.slug));

        // Add currencies
        if !post.currencies.is_empty() {
            let currency_codes: Vec<String> = post.currencies.iter()
                .map(|c| c.code.clone())
                .collect();
            payload.insert("currencies".to_string(), serde_json::json!(currency_codes));
        }

        // Add votes if available
        if let Some(ref votes) = post.votes {
            payload.insert("votes".to_string(), serde_json::json!({
                "positive": votes.positive,
                "negative": votes.negative,
                "important": votes.important,
                "comments": votes.comments,
            }));

            // Calculate sentiment score
            let total_votes = votes.positive + votes.negative;
            if total_votes > 0 {
                let sentiment_score = (votes.positive as f64 - votes.negative as f64) / total_votes as f64;
                payload.insert("sentimentScore".to_string(), serde_json::json!(sentiment_score));
            }
        }

        // Add metadata
        if let Some(ref meta) = post.metadata {
            if let Some(ref desc) = meta.description {
                payload.insert("description".to_string(), serde_json::json!(desc));
            }
            if let Some(ref image) = meta.image {
                payload.insert("imageUrl".to_string(), serde_json::json!(image));
            }
        }

        let payload_json = serde_json::to_string(&payload).unwrap_or_default();
        let payload_size = payload_json.len() as u64;
        let now = Utc::now().to_rfc3339();

        // Create dedup key
        let dedup_key = news_dedup_key(
            "cryptopanic",
            &post.title,
            Some(&post.url),
            Some(&post.published_at),
        );
        let content_hash = dedup_key.content_hash.clone();
        let combined_key = dedup_key.combined_key();

        // Determine priority based on votes
        let priority = if let Some(ref votes) = post.votes {
            if votes.important > 10 || votes.positive > 50 {
                Severity::High
            } else if votes.important > 5 || votes.positive > 20 {
                Severity::Medium
            } else {
                Severity::Low
            }
        } else {
            Severity::Medium
        };

        IngestionEvent {
            schema_version: CURRENT_SCHEMA_VERSION.to_string(),
            id: uuid::Uuid::new_v4().to_string(),
            created_at: now.clone(),
            updated_at: None,
            source_type: IngestionSourceType::NewsApi,
            source_id: "cryptopanic".to_string(),
            source_name: "CryptoPanic".to_string(),
            source_url: Some(post.url.clone()),
            data_type: IngestionDataType::News,
            data_subtype: Some(post.kind.clone()),
            payload,
            payload_size,
            payload_hash: Some(content_hash),
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
            priority,
            deduplication_key: Some(combined_key),
            is_duplicate: false,
            batch_id: None,
            batch_index: None,
            ingested_at: now,
            data_timestamp: Some(post.published_at.clone()),
        }
    }
}

#[async_trait]
impl Source for CryptoPanicSource {
    fn metadata(&self) -> &SourceMetadata {
        &self.metadata
    }

    async fn fetch(&self, options: FetchOptions) -> Result<FetchResult> {
        debug!(
            source = "cryptopanic",
            since = ?options.since,
            cursor = ?options.cursor,
            "Fetching crypto news"
        );

        let (posts, next_cursor) = self.fetch_posts(&options).await?;
        let post_count = posts.len();

        let events: Vec<IngestionEvent> = posts
            .iter()
            .map(|p| self.post_to_event(p))
            .collect();

        let has_more = next_cursor.is_some();

        info!(
            source = "cryptopanic",
            posts = post_count,
            has_more = has_more,
            "Fetched crypto news"
        );

        Ok(FetchResult {
            events,
            next_cursor,
            has_more,
            raw_payload: Some(serde_json::json!({
                "count": post_count,
            })),
        })
    }

    async fn health_check(&self) -> Result<bool> {
        let options = FetchOptions::new().limit(1);
        match self.fetch_posts(&options).await {
            Ok(_) => Ok(true),
            Err(e) => {
                warn!(error = %e, "CryptoPanic health check failed");
                Ok(false)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_post_parsing() {
        let json = r#"{
            "kind": "news",
            "domain": "coindesk.com",
            "source": {
                "title": "CoinDesk",
                "region": "en",
                "domain": "coindesk.com",
                "path": null
            },
            "title": "Bitcoin Surges Past $50K",
            "published_at": "2024-01-15T10:00:00Z",
            "slug": "bitcoin-surges",
            "id": 123456,
            "url": "https://cryptopanic.com/news/123456",
            "currencies": [
                {"code": "BTC", "title": "Bitcoin", "slug": "bitcoin", "url": "https://cryptopanic.com/news/bitcoin/"}
            ],
            "votes": {
                "negative": 5,
                "positive": 50,
                "important": 10,
                "liked": 30,
                "disliked": 5,
                "lol": 2,
                "toxic": 0,
                "saved": 15,
                "comments": 25
            }
        }"#;

        let post: CryptoPanicPost = serde_json::from_str(json).unwrap();
        assert_eq!(post.id, 123456);
        assert_eq!(post.currencies.len(), 1);
        assert_eq!(post.currencies[0].code, "BTC");
        assert!(post.votes.is_some());
    }
}
