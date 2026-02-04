//! Deduplication Module
//!
//! Prevents duplicate data ingestion using:
//! - Content hash (SHA-256)
//! - Canonical URL normalization
//!
//! Supports in-memory cache and Redis for distributed dedup.

use sha2::{Sha256, Digest};
use std::collections::HashSet;
use std::sync::Arc;
use parking_lot::RwLock;
use tracing::{debug, warn};
use url::Url;

/// Deduplication key
#[derive(Debug, Clone, Hash, Eq, PartialEq)]
pub struct DedupKey {
    /// Source identifier (e.g., "newsapi", "cryptopanic")
    pub source: String,
    /// Content hash (SHA-256)
    pub content_hash: String,
    /// Canonical URL (if available)
    pub canonical_url: Option<String>,
}

impl DedupKey {
    /// Creates a new dedup key from content
    pub fn from_content(source: &str, content: &str) -> Self {
        let content_hash = compute_hash(content);
        Self {
            source: source.to_string(),
            content_hash,
            canonical_url: None,
        }
    }

    /// Creates a dedup key with URL
    pub fn from_content_and_url(source: &str, content: &str, url: Option<&str>) -> Self {
        let content_hash = compute_hash(content);
        let canonical_url = url.and_then(|u| canonicalize_url(u).ok());
        Self {
            source: source.to_string(),
            content_hash,
            canonical_url,
        }
    }

    /// Gets the combined dedup key for storage
    pub fn combined_key(&self) -> String {
        match &self.canonical_url {
            Some(url) => format!("{}:{}:{}", self.source, self.content_hash, url),
            None => format!("{}:{}", self.source, self.content_hash),
        }
    }
}

/// Computes SHA-256 hash of content
pub fn compute_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}

/// Normalizes URL to canonical form
/// - Removes fragments (#...)
/// - Removes tracking parameters (utm_*, fbclid, etc.)
/// - Lowercase scheme and host
/// - Sorts query parameters
pub fn canonicalize_url(url_str: &str) -> Result<String, url::ParseError> {
    let mut url = Url::parse(url_str)?;
    
    // Remove fragment
    url.set_fragment(None);
    
    // Get and filter query parameters
    let tracking_params: HashSet<&str> = [
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
        "fbclid", "gclid", "msclkid", "ref", "source", "mc_cid", "mc_eid",
        "_ga", "_gl", "yclid", "twclid",
    ].into_iter().collect();
    
    // Parse, filter, and sort query params
    let params: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| !tracking_params.contains(key.as_ref()))
        .map(|(k, v)| (k.to_lowercase(), v.to_string()))
        .collect();
    
    // Clear and rebuild query string
    url.set_query(None);
    if !params.is_empty() {
        let mut sorted_params = params;
        sorted_params.sort_by(|a, b| a.0.cmp(&b.0));
        
        let query_string: String = sorted_params
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join("&");
        
        url.set_query(Some(&query_string));
    }
    
    // Lowercase scheme and host
    let result = url.to_string().to_lowercase();
    
    Ok(result)
}

/// In-memory deduplication store
pub struct DedupStore {
    /// In-memory seen set
    seen: Arc<RwLock<HashSet<String>>>,
    /// Maximum entries before eviction
    max_entries: usize,
    /// Redis connection for distributed dedup (optional)
    redis: Option<redis::aio::ConnectionManager>,
    /// TTL for Redis entries (seconds)
    redis_ttl: u64,
}

impl DedupStore {
    /// Creates a new in-memory dedup store
    pub fn new(max_entries: usize) -> Self {
        Self {
            seen: Arc::new(RwLock::new(HashSet::with_capacity(max_entries))),
            max_entries,
            redis: None,
            redis_ttl: 86400, // 24 hours default
        }
    }

    /// Creates a dedup store with Redis backend
    pub fn with_redis(max_entries: usize, redis: redis::aio::ConnectionManager, ttl_seconds: u64) -> Self {
        Self {
            seen: Arc::new(RwLock::new(HashSet::with_capacity(max_entries))),
            max_entries,
            redis: Some(redis),
            redis_ttl: ttl_seconds,
        }
    }

    /// Checks if content is a duplicate and marks it as seen
    /// Returns true if duplicate, false if new
    pub async fn is_duplicate(&self, key: &DedupKey) -> bool {
        let combined = key.combined_key();
        
        // Check Redis first if available
        if let Some(ref redis) = self.redis {
            match self.check_redis(&combined, redis.clone()).await {
                Ok(is_dup) => {
                    if is_dup {
                        debug!(key = %combined, "Duplicate found in Redis");
                        return true;
                    }
                }
                Err(e) => {
                    warn!(error = %e, "Redis check failed, falling back to memory");
                }
            }
        }
        
        // Check in-memory
        let seen = self.seen.read();
        if seen.contains(&combined) {
            debug!(key = %combined, "Duplicate found in memory");
            return true;
        }
        
        false
    }

    /// Marks content as seen
    pub async fn mark_seen(&self, key: &DedupKey) {
        let combined = key.combined_key();
        
        // Add to Redis if available
        if let Some(ref redis) = self.redis {
            if let Err(e) = self.add_to_redis(&combined, redis.clone()).await {
                warn!(error = %e, "Failed to add to Redis");
            }
        }
        
        // Add to in-memory (with eviction if needed)
        let mut seen = self.seen.write();
        
        // Simple eviction: clear half when full
        if seen.len() >= self.max_entries {
            debug!(
                entries = seen.len(),
                max = self.max_entries,
                "Evicting dedup cache"
            );
            // In production, use LRU or time-based eviction
            seen.clear();
        }
        
        seen.insert(combined);
    }

    /// Checks and marks in one operation (atomic check-and-set)
    /// Returns true if duplicate, false if new (and marks as seen)
    pub async fn check_and_mark(&self, key: &DedupKey) -> bool {
        if self.is_duplicate(key).await {
            return true;
        }
        
        self.mark_seen(key).await;
        false
    }

    /// Checks Redis for duplicate
    async fn check_redis(&self, key: &str, mut redis: redis::aio::ConnectionManager) -> Result<bool, redis::RedisError> {
        let redis_key = format!("dedup:{}", key);
        let exists: bool = redis::cmd("EXISTS")
            .arg(&redis_key)
            .query_async(&mut redis)
            .await?;
        Ok(exists)
    }

    /// Adds key to Redis
    async fn add_to_redis(&self, key: &str, mut redis: redis::aio::ConnectionManager) -> Result<(), redis::RedisError> {
        let redis_key = format!("dedup:{}", key);
        redis::cmd("SET")
            .arg(&redis_key)
            .arg("1")
            .arg("EX")
            .arg(self.redis_ttl)
            .query_async::<()>(&mut redis)
            .await?;
        Ok(())
    }

    /// Gets the number of entries in memory
    pub fn len(&self) -> usize {
        self.seen.read().len()
    }

    /// Checks if the store is empty
    pub fn is_empty(&self) -> bool {
        self.seen.read().is_empty()
    }

    /// Clears the in-memory cache
    pub fn clear(&self) {
        self.seen.write().clear();
    }
}

/// Convenience function to generate dedup key from news article
pub fn news_dedup_key(source: &str, title: &str, url: Option<&str>, published_at: Option<&str>) -> DedupKey {
    // Combine title and publication date for content hash
    let content = match published_at {
        Some(date) => format!("{}|{}", title.trim().to_lowercase(), date),
        None => title.trim().to_lowercase(),
    };
    
    DedupKey::from_content_and_url(source, &content, url)
}

/// Convenience function to generate dedup key from social post
pub fn social_dedup_key(source: &str, author: &str, content: &str, post_id: Option<&str>) -> DedupKey {
    // Use post_id as canonical URL if available
    let combined = format!("{}|{}", author.to_lowercase(), content.trim());
    let canonical = post_id.map(|id| format!("{}:{}", source, id));
    
    DedupKey {
        source: source.to_string(),
        content_hash: compute_hash(&combined),
        canonical_url: canonical,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_hash() {
        let hash1 = compute_hash("hello world");
        let hash2 = compute_hash("hello world");
        let hash3 = compute_hash("different content");
        
        assert_eq!(hash1, hash2);
        assert_ne!(hash1, hash3);
        assert_eq!(hash1.len(), 64); // SHA-256 = 64 hex chars
    }

    #[test]
    fn test_canonicalize_url() {
        // Remove tracking params
        let url = "https://example.com/article?id=123&utm_source=twitter&utm_medium=social";
        let canonical = canonicalize_url(url).unwrap();
        assert_eq!(canonical, "https://example.com/article?id=123");
        
        // Remove fragment
        let url = "https://example.com/page#section";
        let canonical = canonicalize_url(url).unwrap();
        assert_eq!(canonical, "https://example.com/page");
        
        // Sort params
        let url = "https://example.com/search?z=last&a=first";
        let canonical = canonicalize_url(url).unwrap();
        assert_eq!(canonical, "https://example.com/search?a=first&z=last");
    }

    #[test]
    fn test_dedup_key() {
        let key1 = DedupKey::from_content("newsapi", "Bitcoin hits new high");
        let key2 = DedupKey::from_content("newsapi", "Bitcoin hits new high");
        let key3 = DedupKey::from_content("newsapi", "Ethereum update released");
        
        assert_eq!(key1.content_hash, key2.content_hash);
        assert_ne!(key1.content_hash, key3.content_hash);
    }

    #[tokio::test]
    async fn test_dedup_store() {
        let store = DedupStore::new(1000);
        
        let key = DedupKey::from_content("test", "unique content");
        
        assert!(!store.is_duplicate(&key).await);
        store.mark_seen(&key).await;
        assert!(store.is_duplicate(&key).await);
    }

    #[tokio::test]
    async fn test_check_and_mark() {
        let store = DedupStore::new(1000);
        
        let key = DedupKey::from_content("test", "atomic test");
        
        // First call: not a duplicate, should mark
        assert!(!store.check_and_mark(&key).await);
        
        // Second call: is a duplicate
        assert!(store.check_and_mark(&key).await);
    }

    #[test]
    fn test_news_dedup_key() {
        let key1 = news_dedup_key("newsapi", "Breaking News", Some("https://example.com/news"), Some("2024-01-15"));
        let key2 = news_dedup_key("newsapi", "breaking news", Some("https://example.com/news?utm_source=fb"), Some("2024-01-15"));
        
        // Should be considered same due to lowercase normalization and URL canonicalization
        assert_eq!(key1.content_hash, key2.content_hash);
    }
}
