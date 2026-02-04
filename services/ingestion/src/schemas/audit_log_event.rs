//! AuditLogEvent Schema
//!
//! Comprehensive audit logging for security and compliance
//! Compatible with TypeScript AuditLogEvent schema

use serde::{Deserialize, Serialize};
use super::common::{Address, TxHash, Uuid, Timestamp, SchemaVersion, Severity};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuditAction {
    // System actions
    SystemStart,
    SystemStop,
    ConfigChange,
    KillSwitchActivate,
    KillSwitchDeactivate,
    ExecutionModeChange,
    
    // Authentication/Authorization
    Login,
    Logout,
    PermissionGrant,
    PermissionRevoke,
    
    // Decision workflow
    DecisionCreated,
    DecisionApproved,
    DecisionRejected,
    DecisionExpired,
    
    // Execution
    ExecutionPlanned,
    ExecutionApproved,
    ExecutionRejected,
    ExecutionSubmitted,
    ExecutionConfirmed,
    ExecutionFailed,
    ExecutionCancelled,
    
    // Data operations
    DataIngested,
    DataProcessed,
    DataDeleted,
    
    // Wallet operations
    WalletConnected,
    WalletDisconnected,
    BalanceChecked,
    
    // Agent actions
    AgentOpinionCreated,
    ConsensusReached,
    
    // Security events
    SecurityAlert,
    RateLimitExceeded,
    ValidationFailed,
    SuspiciousActivity,
    
    // Custom
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AuditCategory {
    System,
    Security,
    Authentication,
    Decision,
    Execution,
    Data,
    Wallet,
    Agent,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ActorType {
    System,
    User,
    Agent,
    Api,
    Scheduler,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RelatedIds {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_plan_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transaction_hash: Option<TxHash>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogEvent {
    // Base fields
    pub schema_version: SchemaVersion,
    pub id: Uuid,
    pub created_at: Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<Timestamp>,
    
    // Action classification
    pub action: AuditAction,
    pub category: AuditCategory,
    
    // Actor information
    pub actor_type: ActorType,
    pub actor_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_address: Option<Address>,
    
    // Target information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_name: Option<String>,
    
    // Event details
    pub description: String,
    #[serde(default)]
    pub details: std::collections::HashMap<String, serde_json::Value>,
    
    // Related entities
    #[serde(default)]
    pub related_ids: RelatedIds,
    
    // Result
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    
    // Risk/Severity
    pub severity: Severity,
    
    // Client information
    #[serde(default)]
    pub client_info: ClientInfo,
    
    // Chain information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_number: Option<u64>,
    
    // Timing
    pub event_timestamp: Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processing_timestamp: Option<Timestamp>,
    
    // Retention
    #[serde(default = "default_retention")]
    pub retention_days: u32,
    
    // Tags
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_retention() -> u32 {
    90
}

impl AuditLogEvent {
    pub fn system_event(action: AuditAction, description: String) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        
        Self {
            schema_version: super::CURRENT_SCHEMA_VERSION.to_string(),
            id: uuid::Uuid::new_v4().to_string(),
            created_at: now.clone(),
            updated_at: None,
            action,
            category: AuditCategory::System,
            actor_type: ActorType::System,
            actor_id: "neuro-system".to_string(),
            actor_name: None,
            actor_address: None,
            target_type: None,
            target_id: None,
            target_name: None,
            description,
            details: std::collections::HashMap::new(),
            related_ids: RelatedIds::default(),
            success: true,
            error_message: None,
            error_code: None,
            severity: Severity::Low,
            client_info: ClientInfo::default(),
            chain_id: None,
            block_number: None,
            event_timestamp: now,
            processing_timestamp: None,
            retention_days: 90,
            tags: vec![],
        }
    }
    
    pub fn security_event(action: AuditAction, description: String, severity: Severity) -> Self {
        let mut event = Self::system_event(action, description);
        event.category = AuditCategory::Security;
        event.severity = severity;
        event.tags.push("security".to_string());
        event
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audit_log_event_typescript_compatibility() {
        let ts_json = r#"{
            "schemaVersion": "1.0.0",
            "id": "550e8400-e29b-41d4-a716-446655440070",
            "createdAt": "2024-01-15T14:15:00Z",
            "action": "execution_approved",
            "category": "execution",
            "actorType": "user",
            "actorId": "admin-001",
            "actorName": "Admin User",
            "targetType": "execution_plan",
            "targetId": "550e8400-e29b-41d4-a716-446655440060",
            "description": "Manual approval granted",
            "details": {
                "tokenSymbol": "PEPE",
                "valueMon": 0.1
            },
            "relatedIds": {
                "executionPlanId": "550e8400-e29b-41d4-a716-446655440060"
            },
            "success": true,
            "severity": "medium",
            "clientInfo": {
                "ipAddress": "192.168.1.100"
            },
            "chainId": 143,
            "eventTimestamp": "2024-01-15T14:15:00Z",
            "retentionDays": 90,
            "tags": ["execution", "approval"]
        }"#;

        let parsed: AuditLogEvent = serde_json::from_str(ts_json).unwrap();
        
        assert_eq!(parsed.action, AuditAction::ExecutionApproved);
        assert_eq!(parsed.category, AuditCategory::Execution);
        assert_eq!(parsed.chain_id, Some(143));
        assert!(parsed.success);
    }

    #[test]
    fn test_factory_methods() {
        let event = AuditLogEvent::system_event(
            AuditAction::SystemStart,
            "NEURO system started".to_string(),
        );
        
        assert_eq!(event.category, AuditCategory::System);
        assert!(event.success);
        
        let security_event = AuditLogEvent::security_event(
            AuditAction::KillSwitchActivate,
            "Kill switch activated".to_string(),
            Severity::Critical,
        );
        
        assert_eq!(security_event.category, AuditCategory::Security);
        assert_eq!(security_event.severity, Severity::Critical);
        assert!(security_event.tags.contains(&"security".to_string()));
    }
}
