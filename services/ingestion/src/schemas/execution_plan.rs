//! ExecutionPlan Schema
//! 
//! Represents a blockchain execution plan for Monad Mainnet (Chain ID: 143)
//! Compatible with TypeScript ExecutionPlan schema
//!
//! CRITICAL NOTES:
//! - All amounts are in Wei (String) to prevent precision loss
//! - Gas fields are required for Monad which charges by GAS LIMIT, not gas used
//! - Chain ID 143 (Monad Mainnet) specific

use serde::{Deserialize, Serialize};
use super::common::{Address, TxHash, HexString, WeiAmount, Uuid, Timestamp, SchemaVersion, Severity};
use super::MONAD_MAINNET_CHAIN_ID;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionType {
    TokenBuy,
    TokenSell,
    TokenLaunch,
    TokenTransfer,
    Approve,
    Swap,
    AddLiquidity,
    RemoveLiquidity,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionStatus {
    Draft,
    PendingApproval,
    Approved,
    Rejected,
    Queued,
    Broadcasting,
    PendingConfirmation,
    Confirming,
    Confirmed,
    Failed,
    Cancelled,
    Expired,
}

/// Gas configuration for Monad Mainnet
/// CRITICAL: Monad charges by gas LIMIT, not gas used
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GasConfig {
    /// Gas limit for the transaction (string to prevent precision loss)
    pub gas_limit: WeiAmount,
    
    /// Maximum fee per gas in Wei (EIP-1559)
    pub max_fee_per_gas: WeiAmount,
    
    /// Maximum priority fee per gas in Wei (EIP-1559)
    pub max_priority_fee_per_gas: WeiAmount,
    
    /// Buffer percentage applied (10-15% recommended for Monad)
    #[serde(default = "default_gas_buffer")]
    pub gas_buffer_percent: f64,
    
    /// Estimated gas cost in Wei
    pub estimated_gas_cost_wei: WeiAmount,
    
    /// Estimated gas cost in MON
    pub estimated_gas_cost_mon: f64,
    
    /// Maximum gas cost in Wei (with buffer)
    pub max_gas_cost_wei: WeiAmount,
    
    /// Maximum gas cost in MON (with buffer)
    pub max_gas_cost_mon: f64,
}

fn default_gas_buffer() -> f64 {
    15.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPlan {
    // Base fields
    pub schema_version: SchemaVersion,
    pub id: Uuid,
    pub created_at: Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<Timestamp>,
    
    // Chain configuration
    #[serde(default = "default_chain_id")]
    pub chain_id: u64,
    #[serde(default = "default_chain_name")]
    pub chain_name: String,
    
    // Execution type
    pub execution_type: ExecutionType,
    pub description: String,
    
    // Transaction parameters
    pub from: Address,
    pub to: Address,
    
    /// Value in Wei (string for precision)
    pub value: WeiAmount,
    
    /// Value in MON (for display only)
    pub value_mon: f64,
    
    /// Calldata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<HexString>,
    
    /// Nonce (optional, will be fetched if not provided)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nonce: Option<u64>,
    
    // Gas configuration (Monad-specific)
    pub gas_config: GasConfig,
    
    // Token details (if applicable)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_address: Option<Address>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_amount: Option<WeiAmount>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_amount_formatted: Option<String>,
    
    // Trade parameters (if applicable)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_amount_out: Option<WeiAmount>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slippage_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<u64>,
    
    // Risk assessment
    pub risk_level: Severity,
    #[serde(default)]
    pub risk_factors: Vec<String>,
    
    // Approval workflow
    #[serde(default = "default_true")]
    pub requires_approval: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<Timestamp>,
    
    // Decision reference
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consensus_decision_id: Option<Uuid>,
    
    // Execution status
    pub status: ExecutionStatus,
    
    // Transaction result
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<TxHash>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_number: Option<u64>,
    
    /// Actual gas used (after confirmation)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gas_used: Option<WeiAmount>,
    
    /// Effective gas price (after confirmation)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_gas_price: Option<WeiAmount>,
    
    /// Actual transaction cost in Wei
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_cost_wei: Option<WeiAmount>,
    
    /// Actual transaction cost in MON
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_cost_mon: Option<f64>,
    
    // Error handling
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default)]
    pub retry_count: u32,
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    
    // Timing
    pub planned_at: Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submitted_at: Option<Timestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmed_at: Option<Timestamp>,
    
    /// Time waited for finality (Monad: 800ms / 2 blocks)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finality_wait_ms: Option<u64>,
    
    pub expires_at: Timestamp,
    
    // Simulation
    #[serde(default)]
    pub simulated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub simulation_success: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub simulation_error: Option<String>,
}

fn default_chain_id() -> u64 {
    MONAD_MAINNET_CHAIN_ID
}

fn default_chain_name() -> String {
    "Monad Mainnet".to_string()
}

fn default_true() -> bool {
    true
}

fn default_max_retries() -> u32 {
    3
}

impl ExecutionPlan {
    /// Calculate gas with buffer (Monad-specific)
    pub fn calculate_gas_with_buffer(estimated_gas: u64, buffer_percent: f64) -> u64 {
        let buffer = (estimated_gas as f64 * buffer_percent / 100.0).ceil() as u64;
        estimated_gas + buffer
    }
    
    /// Verify chain ID is Monad Mainnet
    pub fn is_monad_mainnet(&self) -> bool {
        self.chain_id == MONAD_MAINNET_CHAIN_ID
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_execution_plan_typescript_compatibility() {
        let ts_json = r#"{
            "schemaVersion": "1.0.0",
            "id": "550e8400-e29b-41d4-a716-446655440060",
            "createdAt": "2024-01-15T14:10:00Z",
            "chainId": 143,
            "chainName": "Monad Mainnet",
            "executionType": "token_buy",
            "description": "Buy PEPE token on nad.fun",
            "from": "0xOperatorWalletAddress1234567890123456789a",
            "to": "0xNadFunRouterAddress12345678901234567890ab",
            "value": "100000000000000000",
            "valueMon": 0.1,
            "gasConfig": {
                "gasLimit": "250000",
                "maxFeePerGas": "50000000000",
                "maxPriorityFeePerGas": "2000000000",
                "gasBufferPercent": 15,
                "estimatedGasCostWei": "10875000000000000",
                "estimatedGasCostMon": 0.010875,
                "maxGasCostWei": "12506250000000000",
                "maxGasCostMon": 0.01250625
            },
            "tokenAddress": "0x1234567890123456789012345678901234567890",
            "tokenSymbol": "PEPE",
            "slippagePercent": 2.5,
            "riskLevel": "medium",
            "riskFactors": ["High volatility", "New token"],
            "requiresApproval": true,
            "status": "pending_approval",
            "retryCount": 0,
            "maxRetries": 3,
            "plannedAt": "2024-01-15T14:10:00Z",
            "expiresAt": "2024-01-15T14:40:00Z",
            "simulated": true,
            "simulationSuccess": true
        }"#;

        let parsed: ExecutionPlan = serde_json::from_str(ts_json).unwrap();
        
        assert_eq!(parsed.chain_id, 143);
        assert_eq!(parsed.value, "100000000000000000");
        assert_eq!(parsed.gas_config.gas_limit, "250000");
        assert_eq!(parsed.gas_config.max_fee_per_gas, "50000000000");
        assert_eq!(parsed.execution_type, ExecutionType::TokenBuy);
        assert_eq!(parsed.status, ExecutionStatus::PendingApproval);
        
        // Re-serialize and check camelCase
        let json = serde_json::to_string_pretty(&parsed).unwrap();
        println!("{}", json);
        assert!(json.contains("gasConfig"));
        assert!(json.contains("maxFeePerGas"));
        assert!(json.contains("maxPriorityFeePerGas"));
    }

    #[test]
    fn test_gas_buffer_calculation() {
        let gas_with_buffer = ExecutionPlan::calculate_gas_with_buffer(100000, 15.0);
        assert_eq!(gas_with_buffer, 115000);
    }
}
