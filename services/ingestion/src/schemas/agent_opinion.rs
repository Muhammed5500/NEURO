//! AgentOpinion Schema
//!
//! Represents an individual AI agent's opinion/analysis
//! Compatible with TypeScript AgentOpinion schema

use serde::{Deserialize, Serialize};
use super::common::{Sentiment, Severity, Address, WeiAmount, Uuid, Timestamp, SchemaVersion};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    MarketAnalyzer,
    SentimentAnalyzer,
    RiskAssessor,
    TechnicalAnalyzer,
    NewsAnalyzer,
    SocialAnalyzer,
    ExecutionPlanner,
    VerificationAgent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RecommendedAction {
    Buy,
    Sell,
    Hold,
    Launch,
    Avoid,
    Monitor,
    Investigate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskFactor {
    pub factor: String,
    pub severity: Severity,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportingEvidence {
    #[serde(rename = "type")]
    pub evidence_type: String,
    pub source: String,
    pub relevance: f64,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOpinion {
    // Base fields
    pub schema_version: SchemaVersion,
    pub id: Uuid,
    pub created_at: Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<Timestamp>,
    
    // Agent identification
    pub agent_type: AgentType,
    pub agent_id: String,
    pub agent_version: String,
    
    // Context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_address: Option<Address>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_symbol: Option<String>,
    
    // Opinion
    pub recommendation: RecommendedAction,
    pub sentiment: Sentiment,
    
    // Scores
    pub confidence_score: f64,
    pub risk_score: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opportunity_score: Option<f64>,
    
    // Risk assessment
    pub risk_level: Severity,
    #[serde(default)]
    pub risk_factors: Vec<RiskFactor>,
    
    // Analysis details
    pub reasoning: String,
    #[serde(default)]
    pub key_insights: Vec<String>,
    #[serde(default)]
    pub supporting_evidence: Vec<SupportingEvidence>,
    
    // Suggested parameters
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_amount: Option<WeiAmount>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_amount_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_slippage: Option<f64>,
    
    // Model info
    pub model_used: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_tokens: Option<u32>,
    
    // Timing
    pub analysis_started_at: Timestamp,
    pub analysis_completed_at: Timestamp,
    pub analysis_duration_ms: u64,
    
    // Validity
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<Timestamp>,
    #[serde(default)]
    pub is_stale: bool,
}

impl AgentOpinion {
    pub fn is_confident(&self, threshold: f64) -> bool {
        self.confidence_score >= threshold
    }
    
    pub fn is_high_risk(&self) -> bool {
        matches!(self.risk_level, Severity::High | Severity::Critical)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_opinion_typescript_compatibility() {
        let ts_json = r#"{
            "schemaVersion": "1.0.0",
            "id": "550e8400-e29b-41d4-a716-446655440040",
            "createdAt": "2024-01-15T14:00:00Z",
            "agentType": "market_analyzer",
            "agentId": "market-analyzer-v1",
            "agentVersion": "1.2.0",
            "tokenAddress": "0x1234567890123456789012345678901234567890",
            "tokenSymbol": "PEPE",
            "recommendation": "buy",
            "sentiment": "bullish",
            "confidenceScore": 0.82,
            "riskScore": 0.35,
            "opportunityScore": 0.78,
            "riskLevel": "medium",
            "riskFactors": [
                {
                    "factor": "liquidity",
                    "severity": "low",
                    "description": "Adequate liquidity for position size"
                }
            ],
            "reasoning": "Based on social signal analysis...",
            "keyInsights": ["3 macro influencers mentioned"],
            "supportingEvidence": [],
            "suggestedAmount": "100000000000000000",
            "modelUsed": "gpt-4-turbo",
            "analysisStartedAt": "2024-01-15T13:59:50Z",
            "analysisCompletedAt": "2024-01-15T14:00:00Z",
            "analysisDurationMs": 10000,
            "isStale": false
        }"#;

        let parsed: AgentOpinion = serde_json::from_str(ts_json).unwrap();
        
        assert_eq!(parsed.agent_type, AgentType::MarketAnalyzer);
        assert_eq!(parsed.recommendation, RecommendedAction::Buy);
        assert_eq!(parsed.sentiment, Sentiment::Bullish);
        assert!(parsed.is_confident(0.8));
        assert!(!parsed.is_high_risk());
    }
}
