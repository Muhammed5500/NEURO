//! Monad RPC data source

use governor::{Quota, RateLimiter, state::NotKeyed, clock::DefaultClock, middleware::NoOpMiddleware};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::num::NonZeroU32;
use std::sync::Arc;
use tracing::debug;

use crate::error::{IngestionError, Result};

/// Chain statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainStats {
    pub block_number: u64,
    pub gas_price_gwei: f64,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

/// Monad RPC client
#[derive(Clone)]
pub struct MonadSource {
    client: Client,
    rpc_url: String,
    rate_limiter: Arc<RateLimiter<NotKeyed, governor::state::InMemoryState, DefaultClock, NoOpMiddleware>>,
}

impl MonadSource {
    /// Creates a new Monad RPC source
    pub fn new(rpc_url: &str, rate_limit_rpm: u32) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");
        
        let quota = Quota::per_minute(NonZeroU32::new(rate_limit_rpm).unwrap());
        let rate_limiter = Arc::new(RateLimiter::direct(quota));
        
        Self {
            client,
            rpc_url: rpc_url.to_string(),
            rate_limiter,
        }
    }
    
    /// Waits for rate limit if necessary
    async fn wait_for_rate_limit(&self) -> Result<()> {
        self.rate_limiter.until_ready().await;
        Ok(())
    }
    
    /// Makes a JSON-RPC call
    async fn rpc_call<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<T> {
        self.wait_for_rate_limit().await?;
        
        let request = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": 1
        });
        
        debug!(method = %method, "Making RPC call");
        
        let response = self.client
            .post(&self.rpc_url)
            .json(&request)
            .send()
            .await?;
        
        if !response.status().is_success() {
            return Err(IngestionError::ApiError {
                code: response.status().to_string(),
                message: "RPC request failed".to_string(),
            });
        }
        
        let rpc_response: RpcResponse<T> = response.json().await?;
        
        match rpc_response.result {
            Some(result) => Ok(result),
            None => {
                let error = rpc_response.error.unwrap_or_else(|| RpcError {
                    code: -1,
                    message: "Unknown error".to_string(),
                });
                Err(IngestionError::ApiError {
                    code: error.code.to_string(),
                    message: error.message,
                })
            }
        }
    }
    
    /// Fetches current chain statistics
    pub async fn fetch_chain_stats(&self) -> Result<ChainStats> {
        // Get block number
        let block_hex: String = self.rpc_call("eth_blockNumber", json!([])).await?;
        let block_number = u64::from_str_radix(block_hex.trim_start_matches("0x"), 16)
            .map_err(|e| IngestionError::ValidationError(e.to_string()))?;
        
        // Get gas price
        let gas_hex: String = self.rpc_call("eth_gasPrice", json!([])).await?;
        let gas_wei = u128::from_str_radix(gas_hex.trim_start_matches("0x"), 16)
            .map_err(|e| IngestionError::ValidationError(e.to_string()))?;
        let gas_price_gwei = gas_wei as f64 / 1_000_000_000.0;
        
        Ok(ChainStats {
            block_number,
            gas_price_gwei,
            timestamp: chrono::Utc::now(),
        })
    }
    
    /// Gets the balance of an address in MON
    pub async fn get_balance(&self, address: &str) -> Result<f64> {
        let balance_hex: String = self.rpc_call(
            "eth_getBalance",
            json!([address, "latest"]),
        ).await?;
        
        let balance_wei = u128::from_str_radix(balance_hex.trim_start_matches("0x"), 16)
            .map_err(|e| IngestionError::ValidationError(e.to_string()))?;
        
        // Convert wei to MON (18 decimals)
        let balance_mon = balance_wei as f64 / 1e18;
        
        Ok(balance_mon)
    }
    
    /// Gets the current chain ID
    pub async fn get_chain_id(&self) -> Result<u64> {
        let chain_id_hex: String = self.rpc_call("eth_chainId", json!([])).await?;
        let chain_id = u64::from_str_radix(chain_id_hex.trim_start_matches("0x"), 16)
            .map_err(|e| IngestionError::ValidationError(e.to_string()))?;
        
        Ok(chain_id)
    }
}

/// JSON-RPC response
#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    result: Option<T>,
    error: Option<RpcError>,
}

/// JSON-RPC error
#[derive(Debug, Deserialize)]
struct RpcError {
    code: i32,
    message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_source_creation() {
        let source = MonadSource::new("https://rpc.monad.xyz", 300);
        assert_eq!(source.rpc_url, "https://rpc.monad.xyz");
    }
}
