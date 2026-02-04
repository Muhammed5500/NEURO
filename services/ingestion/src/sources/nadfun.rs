//! nad.fun API data source

use governor::{Quota, RateLimiter, state::NotKeyed, clock::DefaultClock, middleware::NoOpMiddleware};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::num::NonZeroU32;
use std::sync::Arc;
use tracing::debug;

use crate::error::{IngestionError, Result};

/// Token data from nad.fun
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenData {
    pub address: String,
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub total_supply: String,
    pub creator_address: String,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub website_url: Option<String>,
    pub twitter_url: Option<String>,
    pub telegram_url: Option<String>,
    pub created_at: String,
    pub market_cap: Option<f64>,
    pub volume_24h: Option<f64>,
    pub price_usd: Option<f64>,
    pub price_mon: Option<f64>,
    pub holders_count: Option<u64>,
    pub liquidity_mon: Option<f64>,
}

/// nad.fun API client
#[derive(Clone)]
pub struct NadFunSource {
    client: Client,
    base_url: String,
    api_key: Option<String>,
    rate_limiter: Arc<RateLimiter<NotKeyed, governor::state::InMemoryState, DefaultClock, NoOpMiddleware>>,
}

impl NadFunSource {
    /// Creates a new nad.fun source
    pub fn new(base_url: &str, api_key: Option<&str>, rate_limit_rpm: u32) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .gzip(true)
            .brotli(true)
            .build()
            .expect("Failed to create HTTP client");
        
        // Rate limiter: requests per minute
        let quota = Quota::per_minute(NonZeroU32::new(rate_limit_rpm).unwrap());
        let rate_limiter = Arc::new(RateLimiter::direct(quota));
        
        Self {
            client,
            base_url: base_url.to_string(),
            api_key: api_key.map(String::from),
            rate_limiter,
        }
    }
    
    /// Waits for rate limit if necessary
    async fn wait_for_rate_limit(&self) -> Result<()> {
        self.rate_limiter.until_ready().await;
        Ok(())
    }
    
    /// Makes an authenticated request
    async fn get<T: for<'de> Deserialize<'de>>(&self, endpoint: &str) -> Result<T> {
        self.wait_for_rate_limit().await?;
        
        let url = format!("{}{}", self.base_url, endpoint);
        debug!(url = %url, "Fetching from nad.fun");
        
        let mut request = self.client.get(&url);
        
        if let Some(ref api_key) = self.api_key {
            request = request.header("X-API-Key", api_key);
        }
        
        let response = request.send().await?;
        
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            
            if status.as_u16() == 429 {
                return Err(IngestionError::RateLimitExceeded);
            }
            
            return Err(IngestionError::ApiError {
                code: status.to_string(),
                message: body,
            });
        }
        
        let data = response.json::<ApiResponse<T>>().await?;
        
        match data.data {
            Some(d) => Ok(d),
            None => Err(IngestionError::ApiError {
                code: "NO_DATA".to_string(),
                message: data.error.unwrap_or_else(|| "No data returned".to_string()),
            }),
        }
    }
    
    /// Fetches trending tokens
    pub async fn fetch_trending(&self, limit: u32) -> Result<Vec<TokenData>> {
        let endpoint = format!("/api/v1/market/trending?limit={}", limit);
        self.get(&endpoint).await
    }
    
    /// Fetches newly launched tokens
    pub async fn fetch_new_tokens(&self, limit: u32) -> Result<Vec<TokenData>> {
        let endpoint = format!("/api/v1/market/new?limit={}", limit);
        self.get(&endpoint).await
    }
    
    /// Fetches a specific token by address
    pub async fn fetch_token(&self, address: &str) -> Result<TokenData> {
        let endpoint = format!("/api/v1/tokens/address/{}", address);
        self.get(&endpoint).await
    }
    
    /// Searches tokens
    pub async fn search_tokens(&self, query: &str, limit: u32) -> Result<Vec<TokenData>> {
        let endpoint = format!("/api/v1/tokens/search?q={}&limit={}", query, limit);
        self.get(&endpoint).await
    }
}

/// API response wrapper
#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
    data: Option<T>,
    error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_source_creation() {
        let source = NadFunSource::new(
            "https://api.nadapp.net",
            Some("test-key"),
            60,
        );
        assert_eq!(source.base_url, "https://api.nadapp.net");
    }
}
