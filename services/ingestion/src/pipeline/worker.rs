//! Worker Pool Implementation
//!
//! Manages a pool of workers that process items from a channel.
//! Supports graceful shutdown and metrics collection.

use std::sync::Arc;
use tokio::sync::{mpsc, broadcast, Semaphore};
use tracing::{debug, error, info, warn, Instrument};

use crate::metrics;
use super::PipelineItem;
use super::stages::Stage;

// ============================================
// WORKER POOL
// ============================================

pub struct WorkerPool {
    stage_name: &'static str,
    worker_count: usize,
    rx: mpsc::Receiver<PipelineItem>,
    tx: mpsc::Sender<PipelineItem>,
    stage: Arc<Box<dyn Stage>>,
    shutdown_rx: broadcast::Receiver<()>,
}

impl WorkerPool {
    pub fn new(
        stage_name: &'static str,
        worker_count: usize,
        rx: mpsc::Receiver<PipelineItem>,
        tx: mpsc::Sender<PipelineItem>,
        stage: Box<dyn Stage>,
        shutdown_rx: broadcast::Receiver<()>,
    ) -> Self {
        Self {
            stage_name,
            worker_count,
            rx,
            tx,
            stage: Arc::new(stage),
            shutdown_rx,
        }
    }

    /// Runs the worker pool
    pub async fn run(mut self) {
        info!(
            stage = self.stage_name,
            workers = self.worker_count,
            "Starting worker pool"
        );

        // Use semaphore to limit concurrent workers
        let semaphore = Arc::new(Semaphore::new(self.worker_count));
        let mut handles = Vec::new();

        loop {
            tokio::select! {
                // Check for shutdown
                _ = self.shutdown_rx.recv() => {
                    info!(stage = self.stage_name, "Worker pool received shutdown signal");
                    break;
                }
                
                // Process items
                Some(item) = self.rx.recv() => {
                    // Acquire semaphore permit
                    let permit = semaphore.clone().acquire_owned().await;
                    
                    if permit.is_err() {
                        warn!(stage = self.stage_name, "Failed to acquire worker permit");
                        continue;
                    }
                    
                    let permit = permit.unwrap();
                    let stage = self.stage.clone();
                    let tx = self.tx.clone();
                    let stage_name = self.stage_name;
                    
                    // Update queue depth
                    metrics::set_queue_depth(stage_name, self.rx.len() as i64);
                    
                    // Spawn worker task
                    let handle = tokio::spawn(async move {
                        metrics::inc_active_workers(stage_name);
                        
                        let result = stage.process(item.clone()).await;
                        
                        match result {
                            Ok(processed) => {
                                // Send to next stage if stage has output
                                if stage.has_output() {
                                    if let Err(e) = tx.send(processed).await {
                                        warn!(
                                            stage = stage_name,
                                            error = %e,
                                            "Failed to send to next stage"
                                        );
                                    }
                                }
                                
                                metrics::record_event_processed(stage_name, &item.source);
                            }
                            Err(e) => {
                                error!(
                                    stage = stage_name,
                                    event_id = %item.event.id,
                                    error = %e,
                                    "Failed to process item"
                                );
                                metrics::record_error(stage_name, "processing_error");
                            }
                        }
                        
                        metrics::dec_active_workers(stage_name);
                        drop(permit);
                    }.instrument(tracing::debug_span!("worker", stage = stage_name)));
                    
                    handles.push(handle);
                    
                    // Clean up completed handles periodically
                    handles.retain(|h| !h.is_finished());
                }
            }
        }

        // Wait for remaining workers to complete
        info!(
            stage = self.stage_name,
            pending = handles.len(),
            "Waiting for workers to complete"
        );
        
        for handle in handles {
            let _ = handle.await;
        }
        
        info!(stage = self.stage_name, "Worker pool stopped");
    }
}

// ============================================
// BATCH WORKER
// ============================================

/// Worker that processes items in batches for efficiency
pub struct BatchWorker {
    stage_name: &'static str,
    batch_size: usize,
    batch_timeout: std::time::Duration,
    rx: mpsc::Receiver<PipelineItem>,
    tx: mpsc::Sender<PipelineItem>,
    stage: Arc<Box<dyn Stage>>,
    shutdown_rx: broadcast::Receiver<()>,
}

impl BatchWorker {
    pub fn new(
        stage_name: &'static str,
        batch_size: usize,
        batch_timeout: std::time::Duration,
        rx: mpsc::Receiver<PipelineItem>,
        tx: mpsc::Sender<PipelineItem>,
        stage: Box<dyn Stage>,
        shutdown_rx: broadcast::Receiver<()>,
    ) -> Self {
        Self {
            stage_name,
            batch_size,
            batch_timeout,
            rx,
            tx,
            stage: Arc::new(stage),
            shutdown_rx,
        }
    }

    /// Runs the batch worker
    pub async fn run(mut self) {
        info!(
            stage = self.stage_name,
            batch_size = self.batch_size,
            "Starting batch worker"
        );

        let mut batch = Vec::with_capacity(self.batch_size);
        let mut timeout = tokio::time::interval(self.batch_timeout);

        loop {
            tokio::select! {
                // Check for shutdown
                _ = self.shutdown_rx.recv() => {
                    // Process remaining batch
                    if !batch.is_empty() {
                        self.process_batch(&mut batch).await;
                    }
                    break;
                }
                
                // Collect items into batch
                Some(item) = self.rx.recv() => {
                    batch.push(item);
                    
                    if batch.len() >= self.batch_size {
                        self.process_batch(&mut batch).await;
                    }
                }
                
                // Process batch on timeout
                _ = timeout.tick() => {
                    if !batch.is_empty() {
                        self.process_batch(&mut batch).await;
                    }
                }
            }
        }

        info!(stage = self.stage_name, "Batch worker stopped");
    }

    async fn process_batch(&self, batch: &mut Vec<PipelineItem>) {
        let batch_size = batch.len();
        debug!(stage = self.stage_name, batch_size, "Processing batch");

        metrics::inc_active_workers(self.stage_name);

        for item in batch.drain(..) {
            match self.stage.process(item.clone()).await {
                Ok(processed) => {
                    if self.stage.has_output() {
                        if let Err(e) = self.tx.send(processed).await {
                            warn!(
                                stage = self.stage_name,
                                error = %e,
                                "Failed to send to next stage"
                            );
                        }
                    }
                    metrics::record_event_processed(self.stage_name, &item.source);
                }
                Err(e) => {
                    error!(
                        stage = self.stage_name,
                        event_id = %item.event.id,
                        error = %e,
                        "Failed to process item in batch"
                    );
                    metrics::record_error(self.stage_name, "batch_processing_error");
                }
            }
        }

        metrics::dec_active_workers(self.stage_name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::stages::NormalizeStage;
    use crate::schemas::{IngestionEvent, IngestionSourceType, IngestionDataType};
    use std::collections::HashMap;

    fn create_test_item() -> PipelineItem {
        let event = IngestionEvent::new(
            IngestionSourceType::NewsApi,
            "test".to_string(),
            "Test".to_string(),
            IngestionDataType::News,
            HashMap::new(),
        );
        PipelineItem::new(event, "test-corr", "test")
    }

    #[tokio::test]
    async fn test_worker_pool_processes_items() {
        let (tx_in, rx_in) = mpsc::channel(10);
        let (tx_out, mut rx_out) = mpsc::channel(10);
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        
        let pool = WorkerPool::new(
            "test",
            2,
            rx_in,
            tx_out,
            Box::new(NormalizeStage::new()),
            shutdown_rx,
        );
        
        let handle = tokio::spawn(async move {
            pool.run().await;
        });
        
        // Send test item
        tx_in.send(create_test_item()).await.unwrap();
        
        // Wait for processing
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            rx_out.recv(),
        ).await;
        
        assert!(result.is_ok());
        let processed = result.unwrap().unwrap();
        assert!(processed.event.payload_hash.is_some());
        
        // Shutdown
        shutdown_tx.send(()).unwrap();
        handle.await.unwrap();
    }
}
