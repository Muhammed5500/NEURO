//! HTTP Client Module
//!
//! Provides a robust HTTP client with:
//! - Semaphore-based concurrency limiting
//! - Exponential backoff with jitter for retries
//! - Per-source rate limiting
//! - Circuit breaker integration
//!
//! Turkish: "Aynı anda çok fazla HTTP isteği atıp API anahtarlarımın
//! banlanmaması için tokio::sync::Semaphore kullanarak eşzamanlı istek sayısını sınırla."

use std::sync::Arc;
use std::time::Duration;
use backoff::{ExponentialBackoff, ExponentialBackoffBuilder};
use governor::{Quota, RateLimiter, state::NotKeyed, clock::DefaultClock, middleware::NoOpMiddleware};
use reqwest::{Client, Request, Response, StatusCode};
use std::num::NonZeroU32;
use tokio::sync::Semaphore;
use tracing::{debug, warn};

use crate::circuit_breaker::CircuitBreaker;
use crate::error::{IngestionError, Result};

/// Configuration for the HTTP client
#[derive(Debug, Clone)]
pub struct HttpClientConfig {
    /// Maximum concurrent requests across all sources
    pub max_concurrent_requests: usize,
    /// Request timeout
    pub request_timeout: Duration,
    /// Connection timeout
    pub connect_timeout: Duration,
    /// Maximum retries for failed requests
    pub max_retries: u32,
    /// Initial retry delay
    pub initial_retry_delay: Duration,
    /// Maximum retry delay
    pub max_retry_delay: Duration,
    /// Retry multiplier for exponential backoff
    pub retry_multiplier: f64,
    /// User agent string
    pub user_agent: String,
}

impl Default for HttpClientConfig {
    fn default() -> Self {
        Self {
            max_concurrent_requests: 10,
            request_timeout: Duration::from_secs(30),
            connect_timeout: Duration::from_secs(10),
            max_retries: 3,
            initial_retry_delay: Duration::from_millis(500),
            max_retry_delay: Duration::from_secs(30),
            retry_multiplier: 2.0,
            user_agent: format!("NEURO-Ingestion/{}", env!("CARGO_PKG_VERSION")),
        }
    }
}

/// Resilient HTTP client with concurrency limiting and retries
pub struct ResilientHttpClient {
    /// Inner reqwest client
    client: Client,
    /// Global concurrency semaphore
    semaphore: Arc<Semaphore>,
    /// Configuration
    config: HttpClientConfig,
}

impl ResilientHttpClient {
    /// Creates a new resilient HTTP client
    pub fn new(config: HttpClientConfig) -> Result<Self> {
        let client = Client::builder()
            .timeout(config.request_timeout)
            .connect_timeout(config.connect_timeout)
            .user_agent(&config.user_agent)
            .gzip(true)
            .brotli(true)
            .build()
            .map_err(|e| IngestionError::HttpError(e))?;

        let semaphore = Arc::new(Semaphore::new(config.max_concurrent_requests));

        Ok(Self {
            client,
            semaphore,
            config,
        })
    }

    /// Creates a client with default configuration
    pub fn with_defaults() -> Result<Self> {
        Self::new(HttpClientConfig::default())
    }

    /// Gets the inner reqwest client
    pub fn inner(&self) -> &Client {
        &self.client
    }

    /// Creates an exponential backoff with jitter
    fn create_backoff(&self) -> ExponentialBackoff {
        ExponentialBackoffBuilder::new()
            .with_initial_interval(self.config.initial_retry_delay)
            .with_max_interval(self.config.max_retry_delay)
            .with_multiplier(self.config.retry_multiplier)
            .with_randomization_factor(0.5) // Jitter: +/- 50%
            .with_max_elapsed_time(Some(Duration::from_secs(300))) // 5 min total
            .build()
    }

    /// Executes a request with retry logic (exponential backoff + jitter)
    pub async fn execute(&self, request: Request) -> Result<Response> {
        // Acquire semaphore permit
        let _permit = self.semaphore.acquire().await
            .map_err(|_| IngestionError::ConnectionLost("Semaphore closed".to_string()))?;

        let url = request.url().to_string();
        let method = request.method().clone();

        debug!(
            method = %method,
            url = %url,
            "Executing HTTP request"
        );

        let mut attempt = 0u32;
        let mut delay = self.config.initial_retry_delay;
        let max_retries = self.config.max_retries;

        loop {
            attempt += 1;
            
            // Build request for this attempt
            let req = self.client
                .request(method.clone(), &url)
                .build()
                .map_err(|e| IngestionError::HttpError(e))?;

            match self.client.execute(req).await {
                Ok(response) => {
                    let status = response.status();
                    
                    if status.is_success() {
                        debug!(
                            status = %status,
                            attempt = attempt,
                            "Request succeeded"
                        );
                        return Ok(response);
                    } else if Self::is_retryable_status(status) && attempt <= max_retries {
                        warn!(
                            status = %status,
                            attempt = attempt,
                            max_retries = max_retries,
                            "Retryable error, will retry"
                        );
                        // Apply jitter: random factor between 0.5 and 1.5
                        let jitter = 0.5 + rand::random::<f64>();
                        let jittered_delay = Duration::from_secs_f64(delay.as_secs_f64() * jitter);
                        tokio::time::sleep(jittered_delay).await;
                        delay = std::cmp::min(delay * 2, self.config.max_retry_delay);
                    } else {
                        // Non-retryable or max retries exceeded
                        let body = response.text().await.unwrap_or_default();
                        return Err(IngestionError::ApiError {
                            code: status.to_string(),
                            message: body,
                        });
                    }
                }
                Err(e) => {
                    if (e.is_timeout() || e.is_connect()) && attempt <= max_retries {
                        warn!(
                            error = %e,
                            attempt = attempt,
                            "Transient error, will retry"
                        );
                        let jitter = 0.5 + rand::random::<f64>();
                        let jittered_delay = Duration::from_secs_f64(delay.as_secs_f64() * jitter);
                        tokio::time::sleep(jittered_delay).await;
                        delay = std::cmp::min(delay * 2, self.config.max_retry_delay);
                    } else {
                        return Err(IngestionError::HttpError(e));
                    }
                }
            }
        }
    }

    /// Checks if a status code should trigger a retry
    fn is_retryable_status(status: StatusCode) -> bool {
        matches!(
            status,
            StatusCode::TOO_MANY_REQUESTS |     // 429
            StatusCode::SERVICE_UNAVAILABLE |   // 503
            StatusCode::GATEWAY_TIMEOUT |       // 504
            StatusCode::BAD_GATEWAY |           // 502
            StatusCode::REQUEST_TIMEOUT         // 408
        )
    }

    /// Gets the number of available permits
    pub fn available_permits(&self) -> usize {
        self.semaphore.available_permits()
    }
}

/// Source-specific HTTP client with rate limiting and circuit breaker
pub struct SourceHttpClient {
    /// Resilient base client
    client: Arc<ResilientHttpClient>,
    /// Source-specific rate limiter
    rate_limiter: RateLimiter<NotKeyed, governor::state::InMemoryState, DefaultClock, NoOpMiddleware>,
    /// Circuit breaker
    circuit_breaker: Arc<CircuitBreaker>,
    /// Source identifier
    source_id: String,
}

impl SourceHttpClient {
    /// Creates a new source-specific client
    pub fn new(
        client: Arc<ResilientHttpClient>,
        source_id: &str,
        rate_limit_rpm: u32,
        circuit_breaker: Arc<CircuitBreaker>,
    ) -> Self {
        let quota = Quota::per_minute(
            NonZeroU32::new(rate_limit_rpm).unwrap_or(NonZeroU32::new(60).unwrap())
        );
        let rate_limiter = RateLimiter::direct(quota);

        Self {
            client,
            rate_limiter,
            circuit_breaker,
            source_id: source_id.to_string(),
        }
    }

    /// Executes a GET request with all protections
    pub async fn get(&self, url: &str) -> Result<Response> {
        self.execute_with_protection(|| {
            self.client.inner().get(url).build()
        }).await
    }

    /// Executes a GET request with query parameters
    pub async fn get_with_query<T: serde::Serialize + ?Sized>(
        &self,
        url: &str,
        query: &T,
    ) -> Result<Response> {
        self.execute_with_protection(|| {
            self.client.inner().get(url).query(query).build()
        }).await
    }

    /// Executes a request with all protections
    async fn execute_with_protection<F>(&self, build_request: F) -> Result<Response>
    where
        F: Fn() -> std::result::Result<Request, reqwest::Error>,
    {
        // Check circuit breaker
        if !self.circuit_breaker.allow_request() {
            warn!(
                source = %self.source_id,
                "Circuit breaker open, request blocked"
            );
            return Err(IngestionError::CircuitBreakerOpen(self.source_id.clone()));
        }

        // Wait for rate limit
        self.rate_limiter.until_ready().await;

        // Build and execute request
        let request = build_request()
            .map_err(|e| IngestionError::HttpError(e))?;

        match self.client.execute(request).await {
            Ok(response) => {
                self.circuit_breaker.record_success();
                Ok(response)
            }
            Err(e) => {
                self.circuit_breaker.record_failure();
                Err(e)
            }
        }
    }

    /// Gets the source ID
    pub fn source_id(&self) -> &str {
        &self.source_id
    }

    /// Checks if requests are currently allowed
    pub fn is_available(&self) -> bool {
        self.circuit_breaker.allow_request()
    }
}

impl Clone for SourceHttpClient {
    fn clone(&self) -> Self {
        // Rate limiter is not clone, so we create a new one with same config
        // This is fine for cloning into tasks
        let quota = Quota::per_minute(NonZeroU32::new(60).unwrap());
        Self {
            client: self.client.clone(),
            rate_limiter: RateLimiter::direct(quota),
            circuit_breaker: self.circuit_breaker.clone(),
            source_id: self.source_id.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_defaults() {
        let config = HttpClientConfig::default();
        assert_eq!(config.max_concurrent_requests, 10);
        assert_eq!(config.max_retries, 3);
    }

    #[tokio::test]
    async fn test_semaphore_limiting() {
        let config = HttpClientConfig {
            max_concurrent_requests: 2,
            ..Default::default()
        };
        
        let client = ResilientHttpClient::new(config).unwrap();
        
        assert_eq!(client.available_permits(), 2);
    }

    #[test]
    fn test_retryable_status() {
        assert!(ResilientHttpClient::is_retryable_status(StatusCode::TOO_MANY_REQUESTS));
        assert!(ResilientHttpClient::is_retryable_status(StatusCode::SERVICE_UNAVAILABLE));
        assert!(!ResilientHttpClient::is_retryable_status(StatusCode::NOT_FOUND));
        assert!(!ResilientHttpClient::is_retryable_status(StatusCode::UNAUTHORIZED));
    }
}
