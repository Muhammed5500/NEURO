//! Common Schema Primitives
//! 
//! Shared types used across all schemas

use serde::{Deserialize, Serialize};
use chrono::Utc;

/// Schema version in semver format
pub type SchemaVersion = String;

/// Ethereum address (0x-prefixed, 40 hex chars)
pub type Address = String;

/// Transaction hash (0x-prefixed, 64 hex chars)
pub type TxHash = String;

/// Hex string (0x-prefixed)
pub type HexString = String;

/// Wei amount as string for precision preservation
/// CRITICAL: Monad Mainnet requires exact Wei amounts
pub type WeiAmount = String;

/// UUID string
pub type Uuid = String;

/// ISO 8601 timestamp string
pub type Timestamp = String;

// ============================================
// COMMON ENUMS
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Sentiment {
    Bullish,
    Bearish,
    Neutral,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Pending,
    Processing,
    Completed,
    Failed,
    Cancelled,
}

// ============================================
// BASE SCHEMA FIELDS
// ============================================

/// Common fields present in all versioned schemas
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseFields {
    pub schema_version: SchemaVersion,
    pub id: Uuid,
    pub created_at: Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<Timestamp>,
}

impl Default for BaseFields {
    fn default() -> Self {
        Self {
            schema_version: super::CURRENT_SCHEMA_VERSION.to_string(),
            id: uuid::Uuid::new_v4().to_string(),
            created_at: Utc::now().to_rfc3339(),
            updated_at: None,
        }
    }
}

// ============================================
// VALIDATION HELPERS
// ============================================

/// Validates Ethereum address format
pub fn is_valid_address(address: &str) -> bool {
    if !address.starts_with("0x") {
        return false;
    }
    let hex_part = &address[2..];
    hex_part.len() == 40 && hex_part.chars().all(|c| c.is_ascii_hexdigit())
}

/// Validates transaction hash format
pub fn is_valid_tx_hash(hash: &str) -> bool {
    if !hash.starts_with("0x") {
        return false;
    }
    let hex_part = &hash[2..];
    hex_part.len() == 64 && hex_part.chars().all(|c| c.is_ascii_hexdigit())
}

/// Validates Wei amount (numeric string)
pub fn is_valid_wei_amount(amount: &str) -> bool {
    amount.chars().all(|c| c.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_address() {
        assert!(is_valid_address("0x1234567890123456789012345678901234567890"));
        assert!(!is_valid_address("1234567890123456789012345678901234567890"));
        assert!(!is_valid_address("0x123")); // Too short
    }

    #[test]
    fn test_valid_tx_hash() {
        let hash = format!("0x{}", "a".repeat(64));
        assert!(is_valid_tx_hash(&hash));
        assert!(!is_valid_tx_hash("0x123"));
    }

    #[test]
    fn test_valid_wei_amount() {
        assert!(is_valid_wei_amount("1000000000000000000"));
        assert!(!is_valid_wei_amount("1.5"));
        assert!(!is_valid_wei_amount("-100"));
    }

    #[test]
    fn test_sentiment_serialization() {
        let bullish = Sentiment::Bullish;
        let json = serde_json::to_string(&bullish).unwrap();
        assert_eq!(json, "\"bullish\"");
    }
}
