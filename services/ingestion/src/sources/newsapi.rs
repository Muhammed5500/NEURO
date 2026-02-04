//! NewsAPI Data Source
//!
//! Fetches crypto-related news from NewsAPI.org
//! https://newsapi.org/docs/endpoints/everything

use async_trait::async_trait;
use chrono::Utc;
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

const NEWSAPI_BASE_URL: &str = "https://newsapi.org/v2";

/// NewsAPI response structures
#[derive(Debug, Deserialize)]
struct NewsApiResponse {
    status: String,
    #[serde(rename = "totalResults")]
    total_results: Option<u32>,
    articles: Option<Vec<NewsArticle>>,
    code: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewsArticle {
    pub source: ArticleSource,
    pub author: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub url: String,
    #[serde(rename = "urlToImage")]
    pub url_to_image: Option<String>,
    #[serde(rename = "publishedAt")]
    pub published_at: String,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArticleSource {
    pub id: Option<String>,
    pub name: String,
}

/// NewsAPI data source
pub struct NewsApiSource {
    client: SourceHttpClient,
    api_key: String,
    metadata: SourceMetadata,
    /// Default search queries for crypto news
    default_queries: Vec<String>,
}

impl NewsApiSource {
    /// Creates a new NewsAPI source
    pub fn new(
        http_client: Arc<ResilientHttpClient>,
        api_key: String,
        rate_limit_rpm: u32,
        circuit_breaker: Arc<CircuitBreaker>,
    ) -> Self {
        let client = SourceHttpClient::new(
            http_client,
            "newsapi",
            rate_limit_rpm,
            circuit_breaker,
        );

        let metadata = SourceMetadata {
            id: "newsapi".to_string(),
            name: "NewsAPI".to_string(),
            description: "Global news aggregator with crypto coverage".to_string(),
            default_rate_limit: rate_limit_rpm,
            supports_pagination: true,
            supports_since: true,
        };

        Self {
            client,
            api_key,
            metadata,
            default_queries: vec![
                "cryptocurrency".to_string(),
                "bitcoin OR ethereum".to_string(),
                "blockchain".to_string(),
                "defi OR \"decentralized finance\"".to_string(),
                "monad blockchain".to_string(),
            ],
        }
    }

    /// Fetches news for a specific query
    pub async fn fetch_query(&self, query: &str, options: &FetchOptions) -> Result<Vec<NewsArticle>> {
        let mut params: Vec<(&str, String)> = vec![
            ("q", query.to_string()),
            ("language", "en".to_string()),
            ("sortBy", "publishedAt".to_string()),
            ("pageSize", options.limit.unwrap_or(100).to_string()),
        ];

        if let Some(since) = options.since {
            params.push(("from", since.format("%Y-%m-%dT%H:%M:%SZ").to_string()));
        }

        if let Some(ref cursor) = options.cursor {
            // NewsAPI uses page numbers
            params.push(("page", cursor.clone()));
        }

        let url = format!("{}/everything", NEWSAPI_BASE_URL);
        
        // Note: API key should be passed via header in production
        // For now, params include it in query string
        let response = self.client.get_with_query(&url, &params).await?;
        let text = response.text().await
            .map_err(|e| IngestionError::HttpError(e))?;

        let api_response: NewsApiResponse = serde_json::from_str(&text)
            .map_err(|e| IngestionError::JsonError(e))?;

        if api_response.status != "ok" {
            return Err(IngestionError::ApiError {
                code: api_response.code.unwrap_or_else(|| "unknown".to_string()),
                message: api_response.message.unwrap_or_else(|| "Unknown error".to_string()),
            });
        }

        Ok(api_response.articles.unwrap_or_default())
    }

    /// Converts a NewsAPI article to an IngestionEvent
    fn article_to_event(&self, article: &NewsArticle, query: &str) -> IngestionEvent {
        let mut payload = HashMap::new();
        payload.insert("title".to_string(), serde_json::json!(article.title));
        payload.insert("url".to_string(), serde_json::json!(article.url));
        payload.insert("source".to_string(), serde_json::json!(article.source.name));
        payload.insert("publishedAt".to_string(), serde_json::json!(article.published_at));
        payload.insert("query".to_string(), serde_json::json!(query));
        
        if let Some(ref desc) = article.description {
            payload.insert("description".to_string(), serde_json::json!(desc));
        }
        if let Some(ref author) = article.author {
            payload.insert("author".to_string(), serde_json::json!(author));
        }
        if let Some(ref content) = article.content {
            payload.insert("content".to_string(), serde_json::json!(content));
        }
        if let Some(ref image) = article.url_to_image {
            payload.insert("imageUrl".to_string(), serde_json::json!(image));
        }

        let payload_json = serde_json::to_string(&payload).unwrap_or_default();
        let payload_size = payload_json.len() as u64;
        let now = Utc::now().to_rfc3339();

        // Create dedup key
        let dedup_key = news_dedup_key(
            "newsapi",
            &article.title,
            Some(&article.url),
            Some(&article.published_at),
        );
        let content_hash = dedup_key.content_hash.clone();
        let combined_key = dedup_key.combined_key();

        IngestionEvent {
            schema_version: CURRENT_SCHEMA_VERSION.to_string(),
            id: uuid::Uuid::new_v4().to_string(),
            created_at: now.clone(),
            updated_at: None,
            source_type: IngestionSourceType::NewsApi,
            source_id: "newsapi".to_string(),
            source_name: "NewsAPI".to_string(),
            source_url: Some(article.url.clone()),
            data_type: IngestionDataType::News,
            data_subtype: Some("crypto_news".to_string()),
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
            priority: Severity::Medium,
            deduplication_key: Some(combined_key),
            is_duplicate: false,
            batch_id: None,
            batch_index: None,
            ingested_at: now,
            data_timestamp: Some(article.published_at.clone()),
        }
    }

    /// Internal fetch with query
    async fn fetch_internal(&self, options: FetchOptions) -> Result<FetchResult> {
        let query = options.query.clone()
            .unwrap_or_else(|| self.default_queries[0].clone());

        debug!(
            source = "newsapi",
            query = %query,
            since = ?options.since,
            "Fetching news"
        );

        let articles = self.fetch_query(&query, &options).await?;
        let article_count = articles.len();

        let events: Vec<IngestionEvent> = articles
            .iter()
            .map(|a| self.article_to_event(a, &query))
            .collect();

        // Calculate next cursor (page number)
        let current_page: u32 = options.cursor
            .as_ref()
            .and_then(|c| c.parse().ok())
            .unwrap_or(1);
        
        let limit = options.limit.unwrap_or(100);
        let has_more = article_count as u32 >= limit;
        let next_cursor = if has_more {
            Some((current_page + 1).to_string())
        } else {
            None
        };

        info!(
            source = "newsapi",
            articles = article_count,
            has_more = has_more,
            "Fetched news articles"
        );

        Ok(FetchResult {
            events,
            next_cursor,
            has_more,
            raw_payload: Some(serde_json::json!({
                "query": query,
                "count": article_count,
            })),
        })
    }
}

#[async_trait]
impl Source for NewsApiSource {
    fn metadata(&self) -> &SourceMetadata {
        &self.metadata
    }

    async fn fetch(&self, options: FetchOptions) -> Result<FetchResult> {
        self.fetch_internal(options).await
    }

    async fn health_check(&self) -> Result<bool> {
        // NewsAPI doesn't have a dedicated health endpoint
        // We do a minimal query to check connectivity
        let options = FetchOptions::new().limit(1);
        match self.fetch_query("bitcoin", &options).await {
            Ok(_) => Ok(true),
            Err(e) => {
                warn!(error = %e, "NewsAPI health check failed");
                Ok(false)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_article_parsing() {
        let json = r#"{
            "source": {"id": null, "name": "CoinDesk"},
            "author": "John Doe",
            "title": "Bitcoin Hits New High",
            "description": "Bitcoin reached a new all-time high today",
            "url": "https://coindesk.com/bitcoin-high",
            "urlToImage": "https://coindesk.com/image.jpg",
            "publishedAt": "2024-01-15T10:00:00Z",
            "content": "Full article content here..."
        }"#;

        let article: NewsArticle = serde_json::from_str(json).unwrap();
        assert_eq!(article.title, "Bitcoin Hits New High");
        assert_eq!(article.source.name, "CoinDesk");
    }
}
