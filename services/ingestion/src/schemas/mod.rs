//! Shared Schemas for NEURO
//! 
//! These Rust structs are compatible with the TypeScript Zod schemas.
//! All structs use `serde(rename_all = "camelCase")` for JSON compatibility.
//! 
//! CRITICAL: Amount fields use String type to prevent precision loss (Wei values)

pub mod common;
pub mod news_item;
pub mod social_signal;
pub mod ingestion_event;
pub mod embedding_record;
pub mod agent_opinion;
pub mod consensus_decision;
pub mod execution_plan;
pub mod audit_log_event;

pub use common::*;
pub use news_item::*;
pub use social_signal::*;
pub use ingestion_event::*;
pub use embedding_record::*;
pub use agent_opinion::*;
pub use consensus_decision::*;
pub use execution_plan::*;
pub use audit_log_event::*;

/// Current schema version for all types
pub const CURRENT_SCHEMA_VERSION: &str = "1.0.0";

/// Monad Mainnet Chain ID
pub const MONAD_MAINNET_CHAIN_ID: u64 = 143;
