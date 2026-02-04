//! Error types for the Ingestion Service

use thiserror::Error;

#[derive(Error, Debug)]
pub enum IngestionError {
    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),
    
    #[error("JSON parsing failed: {0}")]
    JsonError(#[from] serde_json::Error),
    
    #[error("Database error: {0}")]
    DatabaseError(#[from] sqlx::Error),
    
    #[error("Redis error: {0}")]
    RedisError(#[from] redis::RedisError),
    
    #[error("WebSocket error: {0}")]
    WebSocketError(#[from] tokio_tungstenite::tungstenite::Error),
    
    #[error("Configuration error: {0}")]
    ConfigError(#[from] config::ConfigError),
    
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    
    #[error("Rate limit exceeded")]
    RateLimitExceeded,
    
    #[error("Circuit breaker open for source: {0}")]
    CircuitBreakerOpen(String),
    
    #[error("API error: {code} - {message}")]
    ApiError {
        code: String,
        message: String,
    },
    
    #[error("Invalid data: {0}")]
    ValidationError(String),
    
    #[error("Connection lost: {0}")]
    ConnectionLost(String),
    
    #[error("Source not configured: {0}")]
    SourceNotConfigured(String),
    
    #[error("Duplicate content detected")]
    DuplicateContent,
    
    #[error("Checkpoint error: {0}")]
    CheckpointError(String),
    
    #[error("Storage error: {0}")]
    StorageError(String),
    
    #[error("Parse error: {0}")]
    ParseError(String),
    
    #[error("Shutdown requested")]
    ShutdownRequested,
}

pub type Result<T> = std::result::Result<T, IngestionError>;
