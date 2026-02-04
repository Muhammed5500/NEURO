//! Append-Only Log Storage
//!
//! Stores raw payloads in an append-only format for audit and replay.
//! Supports:
//! - Local filesystem (development)
//! - S3-compatible storage (production)

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs::{self, OpenOptions};
use tokio::io::AsyncWriteExt;
use tracing::{debug, info, warn, error};

use crate::error::{IngestionError, Result};

/// Entry in the append-only log
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// Unique entry ID
    pub id: String,
    /// Timestamp when entry was written
    pub timestamp: DateTime<Utc>,
    /// Source identifier
    pub source_id: String,
    /// Correlation ID for tracing
    pub correlation_id: String,
    /// Session ID for batch tracking
    pub session_id: String,
    /// Entry type
    pub entry_type: LogEntryType,
    /// Raw payload (JSON)
    pub payload: serde_json::Value,
    /// Payload size in bytes
    pub payload_size: u64,
    /// Content hash for verification
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogEntryType {
    RawResponse,
    NormalizedEvent,
    Error,
    Checkpoint,
}

/// Trait for append-only log storage backends
#[async_trait::async_trait]
pub trait AppendLogStorage: Send + Sync {
    /// Appends an entry to the log
    async fn append(&self, entry: &LogEntry) -> Result<()>;

    /// Lists entries (for replay)
    async fn list_entries(
        &self,
        source_id: Option<&str>,
        since: Option<DateTime<Utc>>,
        limit: usize,
    ) -> Result<Vec<LogEntry>>;

    /// Gets storage statistics
    async fn stats(&self) -> Result<StorageStats>;
}

/// Storage statistics
#[derive(Debug, Clone, Default)]
pub struct StorageStats {
    pub total_entries: u64,
    pub total_bytes: u64,
    pub oldest_entry: Option<DateTime<Utc>>,
    pub newest_entry: Option<DateTime<Utc>>,
}

/// Filesystem-based append log (for local development)
pub struct FileSystemAppendLog {
    base_path: PathBuf,
    /// Current log file for today
    current_date: parking_lot::RwLock<String>,
}

impl FileSystemAppendLog {
    /// Creates a new filesystem append log
    pub async fn new(base_path: &Path) -> Result<Self> {
        // Create base directory if it doesn't exist
        fs::create_dir_all(base_path).await
            .map_err(|e| IngestionError::StorageError(format!("Failed to create log dir: {}", e)))?;

        let today = Utc::now().format("%Y-%m-%d").to_string();

        info!(path = %base_path.display(), "Initialized filesystem append log");

        Ok(Self {
            base_path: base_path.to_path_buf(),
            current_date: parking_lot::RwLock::new(today),
        })
    }

    /// Gets the log file path for a given date and source
    fn get_log_path(&self, date: &str, source_id: &str) -> PathBuf {
        let source_dir = self.base_path.join(source_id);
        source_dir.join(format!("{}.jsonl", date))
    }

    /// Ensures the directory exists for a log file
    async fn ensure_dir(&self, source_id: &str) -> Result<()> {
        let dir = self.base_path.join(source_id);
        fs::create_dir_all(&dir).await
            .map_err(|e| IngestionError::StorageError(format!("Failed to create source dir: {}", e)))?;
        Ok(())
    }
}

#[async_trait::async_trait]
impl AppendLogStorage for FileSystemAppendLog {
    async fn append(&self, entry: &LogEntry) -> Result<()> {
        let date = entry.timestamp.format("%Y-%m-%d").to_string();
        
        // Ensure directory exists
        self.ensure_dir(&entry.source_id).await?;

        let log_path = self.get_log_path(&date, &entry.source_id);

        // Serialize entry to JSON line
        let json = serde_json::to_string(entry)
            .map_err(|e| IngestionError::JsonError(e))?;
        let line = format!("{}\n", json);

        // Append to file
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .await
            .map_err(|e| IngestionError::StorageError(format!("Failed to open log file: {}", e)))?;

        file.write_all(line.as_bytes()).await
            .map_err(|e| IngestionError::StorageError(format!("Failed to write to log: {}", e)))?;

        file.flush().await
            .map_err(|e| IngestionError::StorageError(format!("Failed to flush log: {}", e)))?;

        debug!(
            source = %entry.source_id,
            entry_id = %entry.id,
            path = %log_path.display(),
            "Appended entry to log"
        );

        Ok(())
    }

    async fn list_entries(
        &self,
        source_id: Option<&str>,
        since: Option<DateTime<Utc>>,
        limit: usize,
    ) -> Result<Vec<LogEntry>> {
        let mut entries = Vec::new();

        // List source directories
        let sources: Vec<String> = if let Some(source) = source_id {
            vec![source.to_string()]
        } else {
            let mut sources = Vec::new();
            let mut dir = fs::read_dir(&self.base_path).await
                .map_err(|e| IngestionError::StorageError(format!("Failed to read log dir: {}", e)))?;
            
            while let Some(entry) = dir.next_entry().await
                .map_err(|e| IngestionError::StorageError(format!("Failed to read dir entry: {}", e)))? {
                if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                    if let Some(name) = entry.file_name().to_str() {
                        sources.push(name.to_string());
                    }
                }
            }
            sources
        };

        for source in sources {
            let source_dir = self.base_path.join(&source);
            if !source_dir.exists() {
                continue;
            }

            let mut files: Vec<_> = Vec::new();
            let mut dir = fs::read_dir(&source_dir).await
                .map_err(|e| IngestionError::StorageError(format!("Failed to read source dir: {}", e)))?;

            while let Some(entry) = dir.next_entry().await
                .map_err(|e| IngestionError::StorageError(format!("Failed to read dir entry: {}", e)))? {
                if let Some(name) = entry.file_name().to_str() {
                    if name.ends_with(".jsonl") {
                        files.push(entry.path());
                    }
                }
            }

            // Sort by filename (date)
            files.sort();

            for file_path in files {
                if entries.len() >= limit {
                    break;
                }

                let content = fs::read_to_string(&file_path).await
                    .map_err(|e| IngestionError::StorageError(format!("Failed to read log file: {}", e)))?;

                for line in content.lines() {
                    if entries.len() >= limit {
                        break;
                    }

                    if let Ok(entry) = serde_json::from_str::<LogEntry>(line) {
                        // Filter by since
                        if let Some(since_time) = since {
                            if entry.timestamp < since_time {
                                continue;
                            }
                        }
                        entries.push(entry);
                    }
                }
            }
        }

        // Sort by timestamp
        entries.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

        Ok(entries)
    }

    async fn stats(&self) -> Result<StorageStats> {
        let mut stats = StorageStats::default();

        let mut dir = fs::read_dir(&self.base_path).await
            .map_err(|e| IngestionError::StorageError(format!("Failed to read log dir: {}", e)))?;

        while let Some(entry) = dir.next_entry().await
            .map_err(|e| IngestionError::StorageError(format!("Failed to read dir entry: {}", e)))? {
            if !entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }

            let source_dir = entry.path();
            let mut source_dir_iter = fs::read_dir(&source_dir).await
                .map_err(|e| IngestionError::StorageError(format!("Failed to read source dir: {}", e)))?;

            while let Some(file_entry) = source_dir_iter.next_entry().await
                .map_err(|e| IngestionError::StorageError(format!("Failed to read file entry: {}", e)))? {
                let metadata = file_entry.metadata().await
                    .map_err(|e| IngestionError::StorageError(format!("Failed to get file metadata: {}", e)))?;
                stats.total_bytes += metadata.len();

                // Count lines (entries)
                let content = fs::read_to_string(file_entry.path()).await.unwrap_or_default();
                stats.total_entries += content.lines().count() as u64;
            }
        }

        Ok(stats)
    }
}

/// S3-compatible append log (for production)
pub struct S3AppendLog {
    client: aws_sdk_s3::Client,
    bucket: String,
    prefix: String,
}

impl S3AppendLog {
    /// Creates a new S3 append log
    pub async fn new(bucket: &str, prefix: &str, endpoint_url: Option<&str>) -> Result<Self> {
        let config_loader = aws_config::from_env();
        
        let config = if let Some(endpoint) = endpoint_url {
            // Custom endpoint for S3-compatible services (MinIO, etc.)
            let config = config_loader.load().await;
            aws_sdk_s3::config::Builder::from(&config)
                .endpoint_url(endpoint)
                .force_path_style(true)
                .build()
        } else {
            let config = config_loader.load().await;
            aws_sdk_s3::config::Builder::from(&config).build()
        };

        let client = aws_sdk_s3::Client::from_conf(config);

        info!(bucket = %bucket, prefix = %prefix, "Initialized S3 append log");

        Ok(Self {
            client,
            bucket: bucket.to_string(),
            prefix: prefix.to_string(),
        })
    }

    /// Gets the S3 key for an entry
    fn get_key(&self, entry: &LogEntry) -> String {
        let date = entry.timestamp.format("%Y/%m/%d").to_string();
        let hour = entry.timestamp.format("%H").to_string();
        format!(
            "{}/{}/{}/{}-{}.json",
            self.prefix,
            entry.source_id,
            date,
            hour,
            entry.id
        )
    }
}

#[async_trait::async_trait]
impl AppendLogStorage for S3AppendLog {
    async fn append(&self, entry: &LogEntry) -> Result<()> {
        let key = self.get_key(entry);
        let body = serde_json::to_vec(entry)
            .map_err(|e| IngestionError::JsonError(e))?;

        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(&key)
            .body(body.into())
            .content_type("application/json")
            .send()
            .await
            .map_err(|e| IngestionError::StorageError(format!("S3 put failed: {}", e)))?;

        debug!(
            bucket = %self.bucket,
            key = %key,
            "Appended entry to S3"
        );

        Ok(())
    }

    async fn list_entries(
        &self,
        source_id: Option<&str>,
        since: Option<DateTime<Utc>>,
        limit: usize,
    ) -> Result<Vec<LogEntry>> {
        let prefix = match source_id {
            Some(source) => format!("{}/{}/", self.prefix, source),
            None => format!("{}/", self.prefix),
        };

        let mut entries = Vec::new();
        let mut continuation_token: Option<String> = None;

        loop {
            let mut request = self.client
                .list_objects_v2()
                .bucket(&self.bucket)
                .prefix(&prefix)
                .max_keys(1000);

            if let Some(token) = continuation_token {
                request = request.continuation_token(token);
            }

            let response = request.send().await
                .map_err(|e| IngestionError::StorageError(format!("S3 list failed: {}", e)))?;

            for object in response.contents() {
                if entries.len() >= limit {
                    return Ok(entries);
                }

                if let Some(key) = object.key() {
                    let get_response = self.client
                        .get_object()
                        .bucket(&self.bucket)
                        .key(key)
                        .send()
                        .await
                        .map_err(|e| IngestionError::StorageError(format!("S3 get failed: {}", e)))?;

                    let body = get_response.body.collect().await
                        .map_err(|e| IngestionError::StorageError(format!("S3 read body failed: {}", e)))?;

                    if let Ok(entry) = serde_json::from_slice::<LogEntry>(&body.into_bytes()) {
                        if let Some(since_time) = since {
                            if entry.timestamp < since_time {
                                continue;
                            }
                        }
                        entries.push(entry);
                    }
                }
            }

            if response.is_truncated() == Some(true) {
                continuation_token = response.next_continuation_token().map(String::from);
            } else {
                break;
            }
        }

        Ok(entries)
    }

    async fn stats(&self) -> Result<StorageStats> {
        let mut stats = StorageStats::default();

        let mut continuation_token: Option<String> = None;

        loop {
            let mut request = self.client
                .list_objects_v2()
                .bucket(&self.bucket)
                .prefix(&self.prefix)
                .max_keys(1000);

            if let Some(token) = continuation_token {
                request = request.continuation_token(token);
            }

            let response = request.send().await
                .map_err(|e| IngestionError::StorageError(format!("S3 list failed: {}", e)))?;

            for object in response.contents() {
                stats.total_entries += 1;
                if let Some(size) = object.size() {
                    stats.total_bytes += size as u64;
                }
            }

            if response.is_truncated() == Some(true) {
                continuation_token = response.next_continuation_token().map(String::from);
            } else {
                break;
            }
        }

        Ok(stats)
    }
}

/// Factory function to create appropriate storage backend
pub async fn create_append_log(
    storage_type: &str,
    local_path: Option<&Path>,
    s3_bucket: Option<&str>,
    s3_prefix: Option<&str>,
    s3_endpoint: Option<&str>,
) -> Result<Box<dyn AppendLogStorage>> {
    match storage_type {
        "filesystem" | "local" => {
            let path = local_path.unwrap_or(Path::new("./data/append_log"));
            Ok(Box::new(FileSystemAppendLog::new(path).await?))
        }
        "s3" => {
            let bucket = s3_bucket
                .ok_or_else(|| IngestionError::StorageError("S3 bucket not configured".to_string()))?;
            let prefix = s3_prefix.unwrap_or("ingestion");
            Ok(Box::new(S3AppendLog::new(bucket, prefix, s3_endpoint).await?))
        }
        _ => Err(IngestionError::StorageError(format!("Unknown storage type: {}", storage_type))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_filesystem_append_log() {
        let temp_dir = tempdir().unwrap();
        let log = FileSystemAppendLog::new(temp_dir.path()).await.unwrap();

        let entry = LogEntry {
            id: "test-123".to_string(),
            timestamp: Utc::now(),
            source_id: "newsapi".to_string(),
            correlation_id: "corr-456".to_string(),
            session_id: "sess-789".to_string(),
            entry_type: LogEntryType::RawResponse,
            payload: serde_json::json!({"test": "data"}),
            payload_size: 15,
            content_hash: "abc123".to_string(),
        };

        // Append entry
        log.append(&entry).await.unwrap();

        // List entries
        let entries = log.list_entries(Some("newsapi"), None, 100).await.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "test-123");
    }
}
