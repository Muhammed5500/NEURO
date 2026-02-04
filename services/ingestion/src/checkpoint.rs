//! Checkpoint Module
//!
//! Manages --since parameter and state persistence for resumable harvesting.
//! Supports filesystem and S3-compatible storage for checkpoint files.
//!
//! Turkish: "Graceful Shutdown: Sistem kapanırken yarıda kalan veri çekme
//! işlemlerini güvenli bir şekilde tamamlayıp checkpoint'i öyle kaydet."

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tracing::{debug, info, warn, error};

/// Checkpoint data for a single source
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCheckpoint {
    /// Source identifier
    pub source_id: String,
    /// Last successful fetch timestamp
    pub last_fetch_at: DateTime<Utc>,
    /// Last cursor/page token (for paginated APIs)
    pub cursor: Option<String>,
    /// Number of items fetched in last batch
    pub last_batch_count: u32,
    /// Total items fetched since checkpoint start
    pub total_items_fetched: u64,
    /// Last error (if any)
    pub last_error: Option<String>,
    /// Number of consecutive errors
    pub error_count: u32,
    /// Custom metadata
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

impl SourceCheckpoint {
    pub fn new(source_id: &str) -> Self {
        Self {
            source_id: source_id.to_string(),
            last_fetch_at: Utc::now(),
            cursor: None,
            last_batch_count: 0,
            total_items_fetched: 0,
            last_error: None,
            error_count: 0,
            metadata: HashMap::new(),
        }
    }

    /// Records a successful fetch
    pub fn record_success(&mut self, batch_count: u32, cursor: Option<String>) {
        self.last_fetch_at = Utc::now();
        self.last_batch_count = batch_count;
        self.total_items_fetched += batch_count as u64;
        self.cursor = cursor;
        self.last_error = None;
        self.error_count = 0;
    }

    /// Records a failed fetch
    pub fn record_error(&mut self, error: &str) {
        self.last_error = Some(error.to_string());
        self.error_count += 1;
    }
}

/// Global checkpoint state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointState {
    /// Schema version for forward compatibility
    pub version: String,
    /// When this checkpoint was created
    pub created_at: DateTime<Utc>,
    /// When this checkpoint was last updated
    pub updated_at: DateTime<Utc>,
    /// Per-source checkpoints
    pub sources: HashMap<String, SourceCheckpoint>,
    /// Global correlation ID for the harvest session
    pub session_id: String,
}

impl Default for CheckpointState {
    fn default() -> Self {
        Self {
            version: "1.0.0".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            sources: HashMap::new(),
            session_id: uuid::Uuid::new_v4().to_string(),
        }
    }
}

impl CheckpointState {
    /// Gets or creates a checkpoint for a source
    pub fn get_or_create(&mut self, source_id: &str) -> &mut SourceCheckpoint {
        self.sources
            .entry(source_id.to_string())
            .or_insert_with(|| SourceCheckpoint::new(source_id))
    }

    /// Updates the checkpoint for a source
    pub fn update(&mut self, checkpoint: SourceCheckpoint) {
        self.updated_at = Utc::now();
        self.sources.insert(checkpoint.source_id.clone(), checkpoint);
    }

    /// Gets the fetch start time for a source
    pub fn get_since(&self, source_id: &str) -> Option<DateTime<Utc>> {
        self.sources.get(source_id).map(|c| c.last_fetch_at)
    }
}

/// Checkpoint manager handles persistence
pub struct CheckpointManager {
    /// Path to checkpoint file (local filesystem)
    file_path: PathBuf,
    /// Current state
    state: CheckpointState,
    /// Auto-save interval
    auto_save_interval: Duration,
    /// Last save time
    last_save: DateTime<Utc>,
    /// Dirty flag (unsaved changes)
    dirty: bool,
}

impl CheckpointManager {
    /// Creates a new checkpoint manager with file-based storage
    pub async fn new(checkpoint_dir: &Path) -> anyhow::Result<Self> {
        // Ensure directory exists
        fs::create_dir_all(checkpoint_dir).await?;
        
        let file_path = checkpoint_dir.join("checkpoint.json");
        
        // Try to load existing checkpoint
        let state = if file_path.exists() {
            match Self::load_from_file(&file_path).await {
                Ok(state) => {
                    info!(
                        session_id = %state.session_id,
                        sources = state.sources.len(),
                        "Loaded existing checkpoint"
                    );
                    state
                }
                Err(e) => {
                    warn!(error = %e, "Failed to load checkpoint, starting fresh");
                    CheckpointState::default()
                }
            }
        } else {
            info!("No existing checkpoint, starting fresh");
            CheckpointState::default()
        };
        
        Ok(Self {
            file_path,
            state,
            auto_save_interval: Duration::seconds(30),
            last_save: Utc::now(),
            dirty: false,
        })
    }

    /// Loads checkpoint from file
    async fn load_from_file(path: &Path) -> anyhow::Result<CheckpointState> {
        let mut file = fs::File::open(path).await?;
        let mut contents = String::new();
        file.read_to_string(&mut contents).await?;
        let state: CheckpointState = serde_json::from_str(&contents)?;
        Ok(state)
    }

    /// Saves checkpoint to file
    async fn save_to_file(&self) -> anyhow::Result<()> {
        let json = serde_json::to_string_pretty(&self.state)?;
        
        // Write to temp file first, then rename (atomic on most filesystems)
        let temp_path = self.file_path.with_extension("json.tmp");
        let mut file = fs::File::create(&temp_path).await?;
        file.write_all(json.as_bytes()).await?;
        file.sync_all().await?;
        
        fs::rename(&temp_path, &self.file_path).await?;
        
        debug!(path = %self.file_path.display(), "Checkpoint saved");
        Ok(())
    }

    /// Gets the current session ID
    pub fn session_id(&self) -> &str {
        &self.state.session_id
    }

    /// Gets the fetch start time for a source, or calculates from --since duration
    pub fn get_since(&self, source_id: &str, default_since: Duration) -> DateTime<Utc> {
        self.state
            .get_since(source_id)
            .unwrap_or_else(|| Utc::now() - default_since)
    }

    /// Records a successful fetch for a source
    pub fn record_success(&mut self, source_id: &str, batch_count: u32, cursor: Option<String>) {
        let checkpoint = self.state.get_or_create(source_id);
        checkpoint.record_success(batch_count, cursor);
        self.state.updated_at = Utc::now();
        self.dirty = true;
    }

    /// Records a failed fetch for a source
    pub fn record_error(&mut self, source_id: &str, error: &str) {
        let checkpoint = self.state.get_or_create(source_id);
        checkpoint.record_error(error);
        self.state.updated_at = Utc::now();
        self.dirty = true;
    }

    /// Gets checkpoint for a source
    pub fn get_checkpoint(&self, source_id: &str) -> Option<&SourceCheckpoint> {
        self.state.sources.get(source_id)
    }

    /// Auto-saves if interval has passed and there are unsaved changes
    pub async fn maybe_save(&mut self) -> anyhow::Result<()> {
        if self.dirty && (Utc::now() - self.last_save) >= self.auto_save_interval {
            self.save().await?;
        }
        Ok(())
    }

    /// Forces a save
    pub async fn save(&mut self) -> anyhow::Result<()> {
        if let Err(e) = self.save_to_file().await {
            error!(error = %e, "Failed to save checkpoint");
            return Err(e);
        }
        self.last_save = Utc::now();
        self.dirty = false;
        Ok(())
    }

    /// Saves checkpoint on shutdown (called during graceful shutdown)
    pub async fn save_on_shutdown(&mut self) -> anyhow::Result<()> {
        if self.dirty {
            info!("Saving checkpoint on shutdown...");
            self.save().await?;
            info!("Checkpoint saved successfully");
        }
        Ok(())
    }

    /// Gets all source checkpoints
    pub fn all_checkpoints(&self) -> &HashMap<String, SourceCheckpoint> {
        &self.state.sources
    }

    /// Resets checkpoint for a specific source
    pub fn reset_source(&mut self, source_id: &str) {
        self.state.sources.remove(source_id);
        self.dirty = true;
    }

    /// Resets all checkpoints
    pub fn reset_all(&mut self) {
        self.state = CheckpointState::default();
        self.dirty = true;
    }
}

/// Parses a human-readable duration string (e.g., "1h", "30m", "2d")
pub fn parse_since(since_str: &str) -> anyhow::Result<Duration> {
    let since_str = since_str.trim().to_lowercase();
    
    if since_str.is_empty() {
        return Err(anyhow::anyhow!("Empty duration string"));
    }
    
    // Try humantime first for complex formats
    if let Ok(std_duration) = humantime::parse_duration(&since_str) {
        return Ok(Duration::from_std(std_duration)?);
    }
    
    // Parse simple formats like "1h", "30m", "2d"
    let (value_str, unit) = since_str.split_at(since_str.len() - 1);
    let value: i64 = value_str.parse()?;
    
    match unit {
        "s" => Ok(Duration::seconds(value)),
        "m" => Ok(Duration::minutes(value)),
        "h" => Ok(Duration::hours(value)),
        "d" => Ok(Duration::days(value)),
        "w" => Ok(Duration::weeks(value)),
        _ => Err(anyhow::anyhow!("Unknown duration unit: {}", unit)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_since() {
        assert_eq!(parse_since("1h").unwrap(), Duration::hours(1));
        assert_eq!(parse_since("30m").unwrap(), Duration::minutes(30));
        assert_eq!(parse_since("2d").unwrap(), Duration::days(2));
        assert_eq!(parse_since("1w").unwrap(), Duration::weeks(1));
        assert_eq!(parse_since("60s").unwrap(), Duration::seconds(60));
    }

    #[test]
    fn test_source_checkpoint() {
        let mut checkpoint = SourceCheckpoint::new("test");
        
        checkpoint.record_success(10, Some("cursor123".to_string()));
        assert_eq!(checkpoint.last_batch_count, 10);
        assert_eq!(checkpoint.total_items_fetched, 10);
        assert_eq!(checkpoint.cursor, Some("cursor123".to_string()));
        assert_eq!(checkpoint.error_count, 0);
        
        checkpoint.record_error("connection timeout");
        assert_eq!(checkpoint.error_count, 1);
        assert!(checkpoint.last_error.is_some());
        
        checkpoint.record_success(5, None);
        assert_eq!(checkpoint.error_count, 0);
        assert!(checkpoint.last_error.is_none());
        assert_eq!(checkpoint.total_items_fetched, 15);
    }

    #[tokio::test]
    async fn test_checkpoint_manager() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mut manager = CheckpointManager::new(temp_dir.path()).await.unwrap();
        
        // Record some checkpoints
        manager.record_success("newsapi", 50, None);
        manager.record_success("cryptopanic", 25, Some("page2".to_string()));
        
        // Save
        manager.save().await.unwrap();
        
        // Load fresh
        let loaded = CheckpointManager::new(temp_dir.path()).await.unwrap();
        
        assert!(loaded.get_checkpoint("newsapi").is_some());
        assert_eq!(loaded.get_checkpoint("newsapi").unwrap().total_items_fetched, 50);
        assert_eq!(loaded.get_checkpoint("cryptopanic").unwrap().cursor, Some("page2".to_string()));
    }
}
