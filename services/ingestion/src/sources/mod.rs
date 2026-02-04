//! Data sources for ingestion
//!
//! Each source implements the `Source` trait for unified harvesting.

pub mod nadfun;
pub mod monad;
pub mod newsapi;
pub mod cryptopanic;
pub mod x_api;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::schemas::IngestionEvent;

/// Metadata about a source
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceMetadata {
    /// Unique identifier for the source
    pub id: String,
    /// Human-readable name
    pub name: String,
    /// Description
    pub description: String,
    /// Default rate limit (requests per minute)
    pub default_rate_limit: u32,
    /// Whether the source supports pagination
    pub supports_pagination: bool,
    /// Whether the source supports --since parameter
    pub supports_since: bool,
}

/// Result of a fetch operation
#[derive(Debug)]
pub struct FetchResult {
    /// Ingestion events produced
    pub events: Vec<IngestionEvent>,
    /// Cursor for next page (if paginated)
    pub next_cursor: Option<String>,
    /// Whether there are more results
    pub has_more: bool,
    /// Raw response for append-only log
    pub raw_payload: Option<serde_json::Value>,
}

impl FetchResult {
    /// Creates an empty result
    pub fn empty() -> Self {
        Self {
            events: vec![],
            next_cursor: None,
            has_more: false,
            raw_payload: None,
        }
    }

    /// Creates a result with events
    pub fn with_events(events: Vec<IngestionEvent>) -> Self {
        Self {
            events,
            next_cursor: None,
            has_more: false,
            raw_payload: None,
        }
    }
}

/// Options for fetching data
#[derive(Debug, Clone, Default)]
pub struct FetchOptions {
    /// Fetch items since this time
    pub since: Option<DateTime<Utc>>,
    /// Maximum number of items to fetch
    pub limit: Option<u32>,
    /// Pagination cursor
    pub cursor: Option<String>,
    /// Query/search term
    pub query: Option<String>,
    /// Additional filters as key-value pairs
    pub filters: std::collections::HashMap<String, String>,
}

impl FetchOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn since(mut self, since: DateTime<Utc>) -> Self {
        self.since = Some(since);
        self
    }

    pub fn limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }

    pub fn cursor(mut self, cursor: impl Into<String>) -> Self {
        self.cursor = Some(cursor.into());
        self
    }

    pub fn query(mut self, query: impl Into<String>) -> Self {
        self.query = Some(query.into());
        self
    }
}

/// Trait for all data sources
#[async_trait]
pub trait Source: Send + Sync {
    /// Gets metadata about this source
    fn metadata(&self) -> &SourceMetadata;

    /// Fetches data from the source
    async fn fetch(&self, options: FetchOptions) -> Result<FetchResult>;

    /// Checks if the source is healthy/available
    async fn health_check(&self) -> Result<bool>;

    /// Gets the source ID
    fn id(&self) -> &str {
        &self.metadata().id
    }

    /// Gets the source name
    fn name(&self) -> &str {
        &self.metadata().name
    }
}

/// Re-export source types
pub use nadfun::NadFunSource;
pub use monad::MonadSource;
pub use newsapi::NewsApiSource;
pub use cryptopanic::CryptoPanicSource;
pub use x_api::{XApiSource, XApiAdapter};
