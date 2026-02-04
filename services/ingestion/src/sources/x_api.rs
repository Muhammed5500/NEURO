//! X (Twitter) API Adapter
//!
//! Provides an adapter interface for X/Twitter API integration.
//! Does NOT hardcode vendor-specific implementation - uses trait-based adapter pattern.
//!
//! This allows swapping between:
//! - Official X API v2
//! - Third-party providers (Nitter, etc.)
//! - Mock implementations for testing

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{debug, info};

use super::{Source, SourceMetadata, FetchOptions, FetchResult};
use crate::circuit_breaker::CircuitBreaker;
use crate::dedup::social_dedup_key;
use crate::error::{IngestionError, Result};
use crate::http_client::{ResilientHttpClient, SourceHttpClient};
use crate::schemas::{IngestionEvent, IngestionSourceType, IngestionDataType, Status, Severity, CURRENT_SCHEMA_VERSION};

/// Normalized tweet/post structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialPost {
    /// Unique post ID from the platform
    pub id: String,
    /// Author information
    pub author: SocialAuthor,
    /// Post text content
    pub text: String,
    /// When the post was created
    pub created_at: DateTime<Utc>,
    /// Engagement metrics
    pub metrics: PostMetrics,
    /// Referenced entities (hashtags, mentions, URLs)
    pub entities: PostEntities,
    /// Original platform URL
    pub url: String,
    /// Language code
    pub language: Option<String>,
    /// Raw payload for storage
    pub raw: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialAuthor {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub followers_count: Option<u64>,
    pub verified: bool,
    pub profile_image_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PostMetrics {
    pub likes: u64,
    pub reposts: u64,
    pub replies: u64,
    pub quotes: u64,
    pub views: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PostEntities {
    pub hashtags: Vec<String>,
    pub mentions: Vec<String>,
    pub urls: Vec<String>,
    pub cashtags: Vec<String>,
}

/// Search parameters for social posts
#[derive(Debug, Clone)]
pub struct SocialSearchParams {
    /// Search query
    pub query: String,
    /// Maximum results per request
    pub max_results: u32,
    /// Start time filter
    pub start_time: Option<DateTime<Utc>>,
    /// End time filter
    pub end_time: Option<DateTime<Utc>>,
    /// Pagination token
    pub next_token: Option<String>,
}

impl Default for SocialSearchParams {
    fn default() -> Self {
        Self {
            query: String::new(),
            max_results: 100,
            start_time: None,
            end_time: None,
            next_token: None,
        }
    }
}

/// Search result from social API
#[derive(Debug)]
pub struct SocialSearchResult {
    pub posts: Vec<SocialPost>,
    pub next_token: Option<String>,
    pub result_count: u32,
}

/// Adapter trait for X/Twitter API implementations
/// 
/// Implement this trait to support different API providers.
/// The XApiSource will use this adapter to fetch data.
#[async_trait]
pub trait XApiAdapter: Send + Sync {
    /// Gets the adapter name
    fn name(&self) -> &str;

    /// Searches for posts matching a query
    async fn search(&self, params: SocialSearchParams) -> Result<SocialSearchResult>;

    /// Gets posts from a specific user
    async fn user_timeline(&self, user_id: &str, params: SocialSearchParams) -> Result<SocialSearchResult>;

    /// Checks if the adapter is healthy
    async fn health_check(&self) -> Result<bool>;
}

/// Official X API v2 adapter
pub struct OfficialXApiAdapter {
    client: SourceHttpClient,
    bearer_token: String,
}

impl OfficialXApiAdapter {
    const BASE_URL: &'static str = "https://api.twitter.com/2";

    pub fn new(
        http_client: Arc<ResilientHttpClient>,
        bearer_token: String,
        rate_limit_rpm: u32,
        circuit_breaker: Arc<CircuitBreaker>,
    ) -> Self {
        let client = SourceHttpClient::new(
            http_client,
            "x_api",
            rate_limit_rpm,
            circuit_breaker,
        );

        Self {
            client,
            bearer_token,
        }
    }

    /// Parses X API v2 response into normalized posts
    fn parse_response(&self, data: serde_json::Value) -> Result<SocialSearchResult> {
        let posts: Vec<SocialPost> = vec![]; // TODO: Parse actual X API response structure
        let next_token = data.get("meta")
            .and_then(|m| m.get("next_token"))
            .and_then(|t| t.as_str())
            .map(String::from);
        let result_count = data.get("meta")
            .and_then(|m| m.get("result_count"))
            .and_then(|c| c.as_u64())
            .unwrap_or(0) as u32;

        // Parse tweets from response
        // This is a simplified parser - real implementation would handle includes, etc.
        let tweets = data.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();

        let posts: Vec<SocialPost> = tweets.iter()
            .filter_map(|tweet| self.parse_tweet(tweet))
            .collect();

        Ok(SocialSearchResult {
            posts,
            next_token,
            result_count,
        })
    }

    fn parse_tweet(&self, tweet: &serde_json::Value) -> Option<SocialPost> {
        let id = tweet.get("id")?.as_str()?.to_string();
        let text = tweet.get("text")?.as_str()?.to_string();
        let created_at_str = tweet.get("created_at")?.as_str()?;
        let created_at = DateTime::parse_from_rfc3339(created_at_str)
            .ok()?
            .with_timezone(&Utc);

        // Parse author (simplified)
        let author_id = tweet.get("author_id")
            .and_then(|a| a.as_str())
            .unwrap_or("unknown")
            .to_string();

        Some(SocialPost {
            id: id.clone(),
            author: SocialAuthor {
                id: author_id.clone(),
                username: author_id, // Would be populated from includes
                display_name: "Unknown".to_string(),
                followers_count: None,
                verified: false,
                profile_image_url: None,
            },
            text,
            created_at,
            metrics: PostMetrics::default(),
            entities: PostEntities::default(),
            url: format!("https://x.com/i/status/{}", id),
            language: tweet.get("lang").and_then(|l| l.as_str()).map(String::from),
            raw: Some(tweet.clone()),
        })
    }
}

#[async_trait]
impl XApiAdapter for OfficialXApiAdapter {
    fn name(&self) -> &str {
        "X API v2 (Official)"
    }

    async fn search(&self, params: SocialSearchParams) -> Result<SocialSearchResult> {
        let mut query_params = vec![
            ("query", params.query),
            ("max_results", params.max_results.to_string()),
            ("tweet.fields", "created_at,author_id,public_metrics,entities,lang".to_string()),
            ("expansions", "author_id".to_string()),
            ("user.fields", "username,name,verified,public_metrics,profile_image_url".to_string()),
        ];

        if let Some(start) = params.start_time {
            query_params.push(("start_time", start.to_rfc3339()));
        }
        if let Some(end) = params.end_time {
            query_params.push(("end_time", end.to_rfc3339()));
        }
        if let Some(token) = params.next_token {
            query_params.push(("next_token", token));
        }

        let url = format!("{}/tweets/search/recent", Self::BASE_URL);
        
        // Note: In production, you'd add the Bearer token header
        let response = self.client.get_with_query(&url, &query_params).await?;
        let data: serde_json::Value = response.json().await
            .map_err(|e| IngestionError::HttpError(e))?;

        self.parse_response(data)
    }

    async fn user_timeline(&self, user_id: &str, params: SocialSearchParams) -> Result<SocialSearchResult> {
        let mut query_params = vec![
            ("max_results", params.max_results.to_string()),
            ("tweet.fields", "created_at,author_id,public_metrics,entities,lang".to_string()),
        ];

        if let Some(start) = params.start_time {
            query_params.push(("start_time", start.to_rfc3339()));
        }
        if let Some(token) = params.next_token {
            query_params.push(("pagination_token", token));
        }

        let url = format!("{}/users/{}/tweets", Self::BASE_URL, user_id);
        let response = self.client.get_with_query(&url, &query_params).await?;
        let data: serde_json::Value = response.json().await
            .map_err(|e| IngestionError::HttpError(e))?;

        self.parse_response(data)
    }

    async fn health_check(&self) -> Result<bool> {
        // X API doesn't have a dedicated health endpoint
        // We could check rate limit status or do a minimal search
        Ok(true)
    }
}

/// Mock adapter for testing
pub struct MockXApiAdapter {
    posts: Vec<SocialPost>,
}

impl MockXApiAdapter {
    pub fn new() -> Self {
        Self { posts: vec![] }
    }

    pub fn with_posts(posts: Vec<SocialPost>) -> Self {
        Self { posts }
    }
}

#[async_trait]
impl XApiAdapter for MockXApiAdapter {
    fn name(&self) -> &str {
        "Mock X API"
    }

    async fn search(&self, _params: SocialSearchParams) -> Result<SocialSearchResult> {
        Ok(SocialSearchResult {
            posts: self.posts.clone(),
            next_token: None,
            result_count: self.posts.len() as u32,
        })
    }

    async fn user_timeline(&self, _user_id: &str, _params: SocialSearchParams) -> Result<SocialSearchResult> {
        Ok(SocialSearchResult {
            posts: self.posts.clone(),
            next_token: None,
            result_count: self.posts.len() as u32,
        })
    }

    async fn health_check(&self) -> Result<bool> {
        Ok(true)
    }
}

/// X API Source that uses an adapter
pub struct XApiSource {
    adapter: Arc<dyn XApiAdapter>,
    metadata: SourceMetadata,
    /// Default search queries for crypto
    default_queries: Vec<String>,
}

impl XApiSource {
    pub fn new(adapter: Arc<dyn XApiAdapter>, rate_limit_rpm: u32) -> Self {
        let metadata = SourceMetadata {
            id: "x_api".to_string(),
            name: format!("X API ({})", adapter.name()),
            description: "Social media posts from X/Twitter".to_string(),
            default_rate_limit: rate_limit_rpm,
            supports_pagination: true,
            supports_since: true,
        };

        Self {
            adapter,
            metadata,
            default_queries: vec![
                "$MON OR #Monad".to_string(),
                "monad blockchain".to_string(),
                "$BTC -is:retweet".to_string(),
                "$ETH crypto -is:retweet".to_string(),
                "nad.fun OR nadfun".to_string(),
            ],
        }
    }

    /// Converts a social post to an IngestionEvent
    fn post_to_event(&self, post: &SocialPost) -> IngestionEvent {
        let mut payload = HashMap::new();
        payload.insert("postId".to_string(), serde_json::json!(post.id));
        payload.insert("text".to_string(), serde_json::json!(post.text));
        payload.insert("authorId".to_string(), serde_json::json!(post.author.id));
        payload.insert("authorUsername".to_string(), serde_json::json!(post.author.username));
        payload.insert("authorDisplayName".to_string(), serde_json::json!(post.author.display_name));
        payload.insert("authorVerified".to_string(), serde_json::json!(post.author.verified));
        payload.insert("createdAt".to_string(), serde_json::json!(post.created_at.to_rfc3339()));
        payload.insert("url".to_string(), serde_json::json!(post.url));

        // Metrics
        payload.insert("metrics".to_string(), serde_json::json!({
            "likes": post.metrics.likes,
            "reposts": post.metrics.reposts,
            "replies": post.metrics.replies,
            "quotes": post.metrics.quotes,
            "views": post.metrics.views,
        }));

        // Entities
        if !post.entities.hashtags.is_empty() {
            payload.insert("hashtags".to_string(), serde_json::json!(post.entities.hashtags));
        }
        if !post.entities.mentions.is_empty() {
            payload.insert("mentions".to_string(), serde_json::json!(post.entities.mentions));
        }
        if !post.entities.cashtags.is_empty() {
            payload.insert("cashtags".to_string(), serde_json::json!(post.entities.cashtags));
        }

        if let Some(ref followers) = post.author.followers_count {
            payload.insert("authorFollowers".to_string(), serde_json::json!(followers));
        }

        let payload_json = serde_json::to_string(&payload).unwrap_or_default();
        let payload_size = payload_json.len() as u64;
        let now = Utc::now().to_rfc3339();

        // Create dedup key
        let dedup_key = social_dedup_key(
            "x_api",
            &post.author.username,
            &post.text,
            Some(&post.id),
        );
        let content_hash = dedup_key.content_hash.clone();
        let combined_key = dedup_key.combined_key();

        // Determine priority based on engagement and author
        let priority = if post.author.verified || post.author.followers_count.unwrap_or(0) > 100_000 {
            Severity::High
        } else if post.metrics.likes > 100 || post.metrics.reposts > 50 {
            Severity::Medium
        } else {
            Severity::Low
        };

        IngestionEvent {
            schema_version: CURRENT_SCHEMA_VERSION.to_string(),
            id: uuid::Uuid::new_v4().to_string(),
            created_at: now.clone(),
            updated_at: None,
            source_type: IngestionSourceType::SocialApi,
            source_id: "x_api".to_string(),
            source_name: "X/Twitter".to_string(),
            source_url: Some(post.url.clone()),
            data_type: IngestionDataType::Social,
            data_subtype: Some("tweet".to_string()),
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
            data_timestamp: Some(post.created_at.to_rfc3339()),
        }
    }
}

#[async_trait]
impl Source for XApiSource {
    fn metadata(&self) -> &SourceMetadata {
        &self.metadata
    }

    async fn fetch(&self, options: FetchOptions) -> Result<FetchResult> {
        let query = options.query.clone()
            .unwrap_or_else(|| self.default_queries[0].clone());

        debug!(
            source = "x_api",
            query = %query,
            since = ?options.since,
            "Fetching social posts"
        );

        let params = SocialSearchParams {
            query,
            max_results: options.limit.unwrap_or(100),
            start_time: options.since,
            end_time: None,
            next_token: options.cursor,
        };

        let result = self.adapter.search(params).await?;
        let post_count = result.posts.len();

        let events: Vec<IngestionEvent> = result.posts
            .iter()
            .map(|p| self.post_to_event(p))
            .collect();

        let has_more = result.next_token.is_some();
        
        info!(
            source = "x_api",
            posts = post_count,
            has_more = has_more,
            "Fetched social posts"
        );

        Ok(FetchResult {
            events,
            next_cursor: result.next_token,
            has_more,
            raw_payload: Some(serde_json::json!({
                "result_count": result.result_count,
            })),
        })
    }

    async fn health_check(&self) -> Result<bool> {
        self.adapter.health_check().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_mock_adapter() {
        let posts = vec![
            SocialPost {
                id: "123".to_string(),
                author: SocialAuthor {
                    id: "456".to_string(),
                    username: "cryptowhale".to_string(),
                    display_name: "Crypto Whale".to_string(),
                    followers_count: Some(500_000),
                    verified: true,
                    profile_image_url: None,
                },
                text: "Bitcoin looking bullish! 🚀".to_string(),
                created_at: Utc::now(),
                metrics: PostMetrics {
                    likes: 1000,
                    reposts: 500,
                    replies: 200,
                    quotes: 50,
                    views: Some(100_000),
                },
                entities: PostEntities {
                    hashtags: vec!["bitcoin".to_string()],
                    cashtags: vec!["BTC".to_string()],
                    ..Default::default()
                },
                url: "https://x.com/cryptowhale/status/123".to_string(),
                language: Some("en".to_string()),
                raw: None,
            },
        ];

        let adapter = Arc::new(MockXApiAdapter::with_posts(posts));
        let source = XApiSource::new(adapter, 60);

        let result = source.fetch(FetchOptions::new()).await.unwrap();
        assert_eq!(result.events.len(), 1);
        assert_eq!(result.events[0].priority, Severity::High); // Verified author
    }
}
