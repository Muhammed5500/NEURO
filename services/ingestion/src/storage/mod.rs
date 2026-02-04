//! Storage layer for ingested data

use anyhow::Result;
use redis::aio::ConnectionManager;
use sqlx::PgPool;
use tracing::{info, debug};

use crate::sources::nadfun::TokenData;
use crate::sources::monad::ChainStats;

/// Storage manager for persisting ingested data
#[derive(Clone)]
pub struct Storage {
    db: PgPool,
    redis: Option<ConnectionManager>,
}

impl Storage {
    /// Creates a new storage instance
    pub async fn new(database_url: &str, redis_url: Option<&str>) -> Result<Self> {
        info!("Connecting to database...");
        
        let db = PgPool::connect(database_url).await?;
        
        let redis = if let Some(url) = redis_url {
            info!("Connecting to Redis...");
            let client = redis::Client::open(url)?;
            Some(ConnectionManager::new(client).await?)
        } else {
            None
        };
        
        info!("Storage initialized");
        
        Ok(Self { db, redis })
    }
    
    /// Stores trending tokens data
    pub async fn store_trending_tokens(&self, tokens: &[TokenData]) -> Result<()> {
        debug!(count = tokens.len(), "Storing trending tokens");
        
        for token in tokens {
            // Upsert token data (using runtime query to avoid compile-time DB requirement)
            sqlx::query(
                r#"
                INSERT INTO tokens (address, name, symbol, decimals, total_supply, creator_address, metadata, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, NOW(), NOW())
                ON CONFLICT (address) DO UPDATE SET
                    name = EXCLUDED.name,
                    symbol = EXCLUDED.symbol,
                    total_supply = EXCLUDED.total_supply,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
                "#
            )
            .bind(&token.address)
            .bind(&token.name)
            .bind(&token.symbol)
            .bind(token.decimals as i16)
            .bind(&token.total_supply)
            .bind(&token.creator_address)
            .bind(serde_json::to_value(token)?)
            .execute(&self.db)
            .await?;
        }
        
        // Cache in Redis if available
        if let Some(ref mut redis) = self.redis.clone() {
            let data = serde_json::to_string(tokens)?;
            redis::cmd("SET")
                .arg("trending_tokens")
                .arg(&data)
                .arg("EX")
                .arg(60) // 60 second TTL
                .query_async::<()>(redis)
                .await?;
        }
        
        Ok(())
    }
    
    /// Stores new tokens data
    pub async fn store_new_tokens(&self, tokens: &[TokenData]) -> Result<()> {
        debug!(count = tokens.len(), "Storing new tokens");
        
        for token in tokens {
            // Upsert token data (using runtime query to avoid compile-time DB requirement)
            sqlx::query(
                r#"
                INSERT INTO tokens (address, name, symbol, decimals, total_supply, creator_address, metadata, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, NOW(), NOW())
                ON CONFLICT (address) DO UPDATE SET
                    name = EXCLUDED.name,
                    symbol = EXCLUDED.symbol,
                    total_supply = EXCLUDED.total_supply,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
                "#
            )
            .bind(&token.address)
            .bind(&token.name)
            .bind(&token.symbol)
            .bind(token.decimals as i16)
            .bind(&token.total_supply)
            .bind(&token.creator_address)
            .bind(serde_json::to_value(token)?)
            .execute(&self.db)
            .await?;
        }
        
        // Cache in Redis if available
        if let Some(ref mut redis) = self.redis.clone() {
            let data = serde_json::to_string(tokens)?;
            redis::cmd("SET")
                .arg("new_tokens")
                .arg(&data)
                .arg("EX")
                .arg(30) // 30 second TTL
                .query_async::<()>(redis)
                .await?;
        }
        
        Ok(())
    }
    
    /// Stores chain statistics
    pub async fn store_chain_stats(&self, stats: &ChainStats) -> Result<()> {
        debug!(
            block = stats.block_number,
            gas = %stats.gas_price_gwei,
            "Storing chain stats"
        );
        
        // Cache in Redis (real-time data)
        if let Some(ref mut redis) = self.redis.clone() {
            let data = serde_json::to_string(stats)?;
            redis::cmd("SET")
                .arg("chain_stats")
                .arg(&data)
                .arg("EX")
                .arg(10) // 10 second TTL
                .query_async::<()>(redis)
                .await?;
        }
        
        Ok(())
    }
    
    /// Gets cached trending tokens
    pub async fn get_cached_trending(&self) -> Result<Option<Vec<TokenData>>> {
        if let Some(ref mut redis) = self.redis.clone() {
            let data: Option<String> = redis::cmd("GET")
                .arg("trending_tokens")
                .query_async(redis)
                .await?;
            
            if let Some(json) = data {
                let tokens: Vec<TokenData> = serde_json::from_str(&json)?;
                return Ok(Some(tokens));
            }
        }
        
        Ok(None)
    }
    
    /// Gets cached chain stats
    pub async fn get_cached_chain_stats(&self) -> Result<Option<ChainStats>> {
        if let Some(ref mut redis) = self.redis.clone() {
            let data: Option<String> = redis::cmd("GET")
                .arg("chain_stats")
                .query_async(redis)
                .await?;
            
            if let Some(json) = data {
                let stats: ChainStats = serde_json::from_str(&json)?;
                return Ok(Some(stats));
            }
        }
        
        Ok(None)
    }
}
