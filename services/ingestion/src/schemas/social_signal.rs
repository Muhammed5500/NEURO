//! SocialSignal Schema
//! 
//! Represents social media signals and engagement metrics
//! Compatible with TypeScript SocialSignal schema

use serde::{Deserialize, Serialize};
use super::common::{Sentiment, Address, Uuid, Timestamp, SchemaVersion};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SocialPlatform {
    Twitter,
    Discord,
    Telegram,
    Reddit,
    Farcaster,
    Lens,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SignalType {
    Mention,
    Post,
    Comment,
    Retweet,
    Like,
    Follow,
    WhaleActivity,
    InfluencerMention,
    Trending,
    SentimentShift,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InfluencerTier {
    Micro,
    Mid,
    Macro,
    Mega,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialSignal {
    // Base fields
    pub schema_version: SchemaVersion,
    pub id: Uuid,
    pub created_at: Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<Timestamp>,
    
    // Platform info
    pub platform: SocialPlatform,
    pub signal_type: SignalType,
    
    // Content
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_url: Option<String>,
    
    // Author info
    pub author_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_followers: Option<u64>,
    #[serde(default)]
    pub author_verified: bool,
    #[serde(default)]
    pub is_influencer: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub influencer_tier: Option<InfluencerTier>,
    
    // Engagement metrics
    #[serde(default)]
    pub likes: u64,
    #[serde(default)]
    pub retweets: u64,
    #[serde(default)]
    pub replies: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub views: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engagement_rate: Option<f64>,
    
    // Token/Address context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_address: Option<Address>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_symbol: Option<String>,
    #[serde(default)]
    pub mentioned_addresses: Vec<Address>,
    
    // Analysis
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sentiment: Option<Sentiment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sentiment_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relevance_score: Option<f64>,
    
    // Metrics
    #[serde(default = "default_signal_strength")]
    pub signal_strength: f64,
    #[serde(default = "default_confidence")]
    pub confidence: f64,
    
    // Timing
    pub posted_at: Timestamp,
    pub fetched_at: Timestamp,
    
    // Processing
    #[serde(default)]
    pub processed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_id: Option<Uuid>,
}

fn default_signal_strength() -> f64 {
    0.5
}

fn default_confidence() -> f64 {
    0.5
}

impl SocialSignal {
    pub fn new(
        platform: SocialPlatform,
        signal_type: SignalType,
        author_id: String,
        posted_at: Timestamp,
        fetched_at: Timestamp,
    ) -> Self {
        Self {
            schema_version: super::CURRENT_SCHEMA_VERSION.to_string(),
            id: uuid::Uuid::new_v4().to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: None,
            platform,
            signal_type,
            content: None,
            content_url: None,
            author_id,
            author_username: None,
            author_followers: None,
            author_verified: false,
            is_influencer: false,
            influencer_tier: None,
            likes: 0,
            retweets: 0,
            replies: 0,
            views: None,
            engagement_rate: None,
            token_address: None,
            token_symbol: None,
            mentioned_addresses: vec![],
            sentiment: None,
            sentiment_score: None,
            relevance_score: None,
            signal_strength: 0.5,
            confidence: 0.5,
            posted_at,
            fetched_at,
            processed: false,
            embedding_id: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_social_signal_serialization() {
        let signal = SocialSignal::new(
            SocialPlatform::Twitter,
            SignalType::InfluencerMention,
            "12345".to_string(),
            "2024-01-15T10:00:00Z".to_string(),
            "2024-01-15T10:30:00Z".to_string(),
        );

        let json = serde_json::to_string_pretty(&signal).unwrap();
        println!("{}", json);
        
        assert!(json.contains("signalType"));
        assert!(json.contains("authorId"));
    }

    #[test]
    fn test_typescript_compatibility() {
        let ts_json = r#"{
            "schemaVersion": "1.0.0",
            "id": "550e8400-e29b-41d4-a716-446655440010",
            "createdAt": "2024-01-15T11:00:00Z",
            "platform": "twitter",
            "signalType": "influencer_mention",
            "authorId": "12345678",
            "authorUsername": "cryptoinfluencer",
            "authorFollowers": 500000,
            "authorVerified": true,
            "isInfluencer": true,
            "influencerTier": "macro",
            "likes": 5000,
            "retweets": 1200,
            "replies": 300,
            "sentiment": "bullish",
            "sentimentScore": 0.92,
            "signalStrength": 0.85,
            "confidence": 0.78,
            "postedAt": "2024-01-15T10:45:00Z",
            "fetchedAt": "2024-01-15T11:00:00Z",
            "processed": true
        }"#;

        let parsed: SocialSignal = serde_json::from_str(ts_json).unwrap();
        assert_eq!(parsed.author_followers, Some(500000));
        assert_eq!(parsed.sentiment, Some(Sentiment::Bullish));
        assert_eq!(parsed.influencer_tier, Some(InfluencerTier::Macro));
    }
}
