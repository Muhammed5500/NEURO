//! Configuration for the Ingestion Service

use anyhow::Result;
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    // Network
    #[serde(default = "default_monad_rpc")]
    pub monad_rpc_url: String,
    #[serde(default = "default_monad_ws")]
    pub monad_rpc_url_ws: String,
    
    // nad.fun API
    #[serde(default = "default_nadfun_api")]
    pub nadfun_api_url: String,
    pub nadfun_api_key: Option<String>,
    
    // Database
    pub database_url: Option<String>,
    pub redis_url: Option<String>,
    
    // Rate limiting (requests per minute)
    #[serde(default = "default_rate_limit")]
    pub nadfun_rate_limit_rpm: u32,
    #[serde(default = "default_rpc_rate_limit")]
    pub rpc_rate_limit_rpm: u32,
    #[serde(default = "default_news_rate_limit")]
    pub newsapi_rate_limit_rpm: u32,
    #[serde(default = "default_news_rate_limit")]
    pub cryptopanic_rate_limit_rpm: u32,
    #[serde(default = "default_social_rate_limit")]
    pub x_api_rate_limit_rpm: u32,
    
    // Harvesting intervals (milliseconds)
    #[serde(default = "default_trending_interval")]
    pub trending_interval_ms: u64,
    #[serde(default = "default_new_tokens_interval")]
    pub new_tokens_interval_ms: u64,
    #[serde(default = "default_market_data_interval")]
    pub market_data_interval_ms: u64,
    #[serde(default = "default_news_interval")]
    pub news_interval_ms: u64,
    #[serde(default = "default_social_interval")]
    pub social_interval_ms: u64,
    
    // External APIs
    pub news_api_key: Option<String>,
    pub cryptopanic_api_key: Option<String>,
    pub coingecko_api_key: Option<String>,
    pub twitter_bearer_token: Option<String>,
    
    // Concurrency
    #[serde(default = "default_max_concurrent_requests")]
    pub max_concurrent_requests: usize,
    
    // Circuit breaker
    #[serde(default = "default_circuit_breaker_threshold")]
    pub circuit_breaker_failure_threshold: u32,
    #[serde(default = "default_circuit_breaker_timeout")]
    pub circuit_breaker_open_duration_secs: u64,
    
    // Storage
    #[serde(default = "default_storage_type")]
    pub storage_type: String,
    #[serde(default = "default_data_dir")]
    pub data_dir: PathBuf,
    pub s3_bucket: Option<String>,
    pub s3_prefix: Option<String>,
    pub s3_endpoint_url: Option<String>,
    
    // Deduplication
    #[serde(default = "default_dedup_cache_size")]
    pub dedup_cache_size: usize,
    #[serde(default = "default_dedup_ttl")]
    pub dedup_ttl_seconds: u64,
    
    // Checkpointing
    #[serde(default = "default_checkpoint_dir")]
    pub checkpoint_dir: PathBuf,
    #[serde(default = "default_checkpoint_interval")]
    pub checkpoint_interval_secs: u64,
    
    // Pipeline configuration
    pub pipeline_channel_capacity: Option<usize>,
    pub pipeline_fetch_workers: Option<usize>,
    pub pipeline_normalize_workers: Option<usize>,
    pub pipeline_enrich_workers: Option<usize>,
    pub pipeline_embed_workers: Option<usize>,
    pub pipeline_publish_workers: Option<usize>,
    pub pipeline_enable_enrich: Option<bool>,
    pub pipeline_enable_embed: Option<bool>,
    
    // Message bus configuration
    #[serde(default = "default_message_bus_type")]
    pub message_bus_type: String,
    pub nats_url: Option<String>,
    #[serde(default = "default_message_bus_stream")]
    pub message_bus_stream: String,
    
    // Metrics server
    #[serde(default = "default_metrics_port")]
    pub metrics_port: u16,
    #[serde(default = "default_metrics_enabled")]
    pub metrics_enabled: bool,
}

fn default_monad_rpc() -> String {
    "https://rpc.monad.xyz".to_string()
}

fn default_monad_ws() -> String {
    "wss://rpc.monad.xyz/ws".to_string()
}

fn default_nadfun_api() -> String {
    "https://api.nadapp.net".to_string()
}

fn default_rate_limit() -> u32 {
    60
}

fn default_rpc_rate_limit() -> u32 {
    300
}

fn default_news_rate_limit() -> u32 {
    30 // NewsAPI free tier: 100 requests/day
}

fn default_social_rate_limit() -> u32 {
    15 // X API basic: 15 requests per 15 min window
}

fn default_trending_interval() -> u64 {
    30000 // 30 seconds
}

fn default_new_tokens_interval() -> u64 {
    10000 // 10 seconds
}

fn default_market_data_interval() -> u64 {
    5000 // 5 seconds
}

fn default_news_interval() -> u64 {
    300000 // 5 minutes
}

fn default_social_interval() -> u64 {
    60000 // 1 minute
}

fn default_max_concurrent_requests() -> usize {
    10
}

fn default_circuit_breaker_threshold() -> u32 {
    5
}

fn default_circuit_breaker_timeout() -> u64 {
    30
}

fn default_storage_type() -> String {
    "filesystem".to_string()
}

fn default_data_dir() -> PathBuf {
    PathBuf::from("./data/append_log")
}

fn default_dedup_cache_size() -> usize {
    100_000
}

fn default_dedup_ttl() -> u64 {
    86400 // 24 hours
}

fn default_checkpoint_dir() -> PathBuf {
    PathBuf::from("./data/checkpoints")
}

fn default_checkpoint_interval() -> u64 {
    30
}

fn default_message_bus_type() -> String {
    "redis".to_string()
}

fn default_message_bus_stream() -> String {
    "neuro:ingestion".to_string()
}

fn default_metrics_port() -> u16 {
    9090
}

fn default_metrics_enabled() -> bool {
    true
}

impl Config {
    pub fn load() -> Result<Self> {
        // Load .env file
        dotenvy::dotenv().ok();
        
        // Build config from environment
        let config = config::Config::builder()
            .add_source(
                config::Environment::default()
                    .separator("__")
                    .try_parsing(true)
            )
            .build()?;
        
        let cfg: Config = config.try_deserialize()?;
        Ok(cfg)
    }

    /// Validates the configuration
    pub fn validate(&self) -> Result<()> {
        // Check for required API keys based on enabled sources
        // (We'll make these optional for now and validate at runtime)
        Ok(())
    }

    /// Checks if NewsAPI is configured
    pub fn has_newsapi(&self) -> bool {
        self.news_api_key.is_some()
    }

    /// Checks if CryptoPanic is configured
    pub fn has_cryptopanic(&self) -> bool {
        self.cryptopanic_api_key.is_some()
    }

    /// Checks if X API is configured
    pub fn has_x_api(&self) -> bool {
        self.twitter_bearer_token.is_some()
    }

    /// Gets the message bus connection URL
    pub fn message_bus_url(&self) -> Option<&str> {
        match self.message_bus_type.as_str() {
            "redis" | "redis_streams" => self.redis_url.as_deref(),
            "nats" | "nats_jetstream" => self.nats_url.as_deref(),
            _ => None,
        }
    }

    /// Checks if message bus is configured
    pub fn has_message_bus(&self) -> bool {
        self.message_bus_url().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_values() {
        let config = Config {
            monad_rpc_url: default_monad_rpc(),
            monad_rpc_url_ws: default_monad_ws(),
            nadfun_api_url: default_nadfun_api(),
            nadfun_api_key: None,
            database_url: None,
            redis_url: None,
            nadfun_rate_limit_rpm: default_rate_limit(),
            rpc_rate_limit_rpm: default_rpc_rate_limit(),
            newsapi_rate_limit_rpm: default_news_rate_limit(),
            cryptopanic_rate_limit_rpm: default_news_rate_limit(),
            x_api_rate_limit_rpm: default_social_rate_limit(),
            trending_interval_ms: default_trending_interval(),
            new_tokens_interval_ms: default_new_tokens_interval(),
            market_data_interval_ms: default_market_data_interval(),
            news_interval_ms: default_news_interval(),
            social_interval_ms: default_social_interval(),
            news_api_key: None,
            cryptopanic_api_key: None,
            coingecko_api_key: None,
            twitter_bearer_token: None,
            max_concurrent_requests: default_max_concurrent_requests(),
            circuit_breaker_failure_threshold: default_circuit_breaker_threshold(),
            circuit_breaker_open_duration_secs: default_circuit_breaker_timeout(),
            storage_type: default_storage_type(),
            data_dir: default_data_dir(),
            s3_bucket: None,
            s3_prefix: None,
            s3_endpoint_url: None,
            dedup_cache_size: default_dedup_cache_size(),
            dedup_ttl_seconds: default_dedup_ttl(),
            checkpoint_dir: default_checkpoint_dir(),
            checkpoint_interval_secs: default_checkpoint_interval(),
        };
        
        assert_eq!(config.monad_rpc_url, "https://rpc.monad.xyz");
        assert_eq!(config.nadfun_rate_limit_rpm, 60);
        assert_eq!(config.max_concurrent_requests, 10);
    }
}
