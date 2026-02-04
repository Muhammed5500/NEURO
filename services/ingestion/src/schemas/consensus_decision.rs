//! ConsensusDecision Schema
//!
//! Represents the aggregated decision from multiple agent opinions
//! Compatible with TypeScript ConsensusDecision schema

use serde::{Deserialize, Serialize};
use super::common::{Sentiment, Severity, Address, WeiAmount, Uuid, Timestamp, SchemaVersion};
use super::agent_opinion::RecommendedAction;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConsensusMethod {
    MajorityVote,
    WeightedAverage,
    Unanimous,
    ConfidenceWeighted,
    Hierarchical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Rejected,
    Expired,
    AutoApproved,
    AutoRejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DissentingView {
    pub agent_id: String,
    pub view: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsensusDecision {
    // Base fields
    pub schema_version: SchemaVersion,
    pub id: Uuid,
    pub created_at: Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<Timestamp>,
    
    // Context
    pub context_description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_address: Option<Address>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_symbol: Option<String>,
    
    // Contributing opinions
    pub opinion_ids: Vec<Uuid>,
    pub opinion_count: u32,
    
    // Consensus method
    pub consensus_method: ConsensusMethod,
    #[serde(default = "default_threshold")]
    pub consensus_threshold: f64,
    pub consensus_reached: bool,
    
    // Final decision
    pub final_recommendation: RecommendedAction,
    pub final_sentiment: Sentiment,
    
    // Aggregated scores
    pub aggregated_confidence: f64,
    pub aggregated_risk_score: f64,
    pub agreement_score: f64,
    
    // Risk assessment
    pub risk_level: Severity,
    pub risk_summary: String,
    
    // Reasoning
    pub consolidated_reasoning: String,
    #[serde(default)]
    pub key_factors: Vec<String>,
    #[serde(default)]
    pub disssenting_views: Vec<DissentingView>,
    
    // Recommended execution parameters
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommended_amount: Option<WeiAmount>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommended_amount_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommended_slippage: Option<f64>,
    
    // Approval workflow
    pub requires_manual_approval: bool,
    #[serde(default = "default_approval_status")]
    pub approval_status: ApprovalStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<Timestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rejection_reason: Option<String>,
    
    // Execution link
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_plan_id: Option<Uuid>,
    
    // Timing
    pub decision_made_at: Timestamp,
    pub expires_at: Timestamp,
}

fn default_threshold() -> f64 {
    0.6
}

fn default_approval_status() -> ApprovalStatus {
    ApprovalStatus::Pending
}

impl ConsensusDecision {
    pub fn is_actionable(&self) -> bool {
        self.consensus_reached 
            && matches!(self.approval_status, ApprovalStatus::Approved | ApprovalStatus::AutoApproved)
            && !matches!(self.final_recommendation, RecommendedAction::Hold | RecommendedAction::Avoid)
    }
    
    pub fn is_expired(&self) -> bool {
        let now = chrono::Utc::now();
        if let Ok(expires) = chrono::DateTime::parse_from_rfc3339(&self.expires_at) {
            now > expires
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_consensus_decision_typescript_compatibility() {
        let ts_json = r#"{
            "schemaVersion": "1.0.0",
            "id": "550e8400-e29b-41d4-a716-446655440050",
            "createdAt": "2024-01-15T14:05:00Z",
            "contextDescription": "Buy decision for PEPE token",
            "tokenAddress": "0x1234567890123456789012345678901234567890",
            "tokenSymbol": "PEPE",
            "opinionIds": ["550e8400-e29b-41d4-a716-446655440040"],
            "opinionCount": 3,
            "consensusMethod": "confidence_weighted",
            "consensusThreshold": 0.6,
            "consensusReached": true,
            "finalRecommendation": "buy",
            "finalSentiment": "bullish",
            "aggregatedConfidence": 0.78,
            "aggregatedRiskScore": 0.38,
            "agreementScore": 0.85,
            "riskLevel": "medium",
            "riskSummary": "Moderate risk due to volatility",
            "consolidatedReasoning": "Three agents agree on bullish outlook.",
            "keyFactors": ["Strong influencer activity"],
            "disssentingViews": [],
            "recommendedAmount": "100000000000000000",
            "requiresManualApproval": true,
            "approvalStatus": "pending",
            "decisionMadeAt": "2024-01-15T14:05:00Z",
            "expiresAt": "2024-01-15T14:35:00Z"
        }"#;

        let parsed: ConsensusDecision = serde_json::from_str(ts_json).unwrap();
        
        assert_eq!(parsed.consensus_method, ConsensusMethod::ConfidenceWeighted);
        assert_eq!(parsed.final_recommendation, RecommendedAction::Buy);
        assert!(parsed.consensus_reached);
        assert!(!parsed.is_actionable()); // pending approval
    }
}
