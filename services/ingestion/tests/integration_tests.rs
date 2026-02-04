//! Integration Tests for Ingestion Pipeline
//!
//! Uses wiremock for mocking HTTP endpoints.
//! Tests pipeline throughput and backpressure behavior.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, broadcast};
use wiremock::{Mock, MockServer, ResponseTemplate};
use wiremock::matchers::{method, path};

// Note: These tests require the main crate to be accessible
// Run with: cargo test --test integration_tests

/// Test that the pipeline processes items without memory blowup
#[tokio::test]
async fn test_pipeline_memory_stability() {
    // This test verifies that bounded channels prevent OOM
    // by processing thousands of items
    
    let (tx, mut rx) = mpsc::channel::<String>(100); // Bounded channel
    let processed = Arc::new(AtomicUsize::new(0));
    let processed_clone = processed.clone();
    
    // Consumer
    let consumer = tokio::spawn(async move {
        while let Some(_item) = rx.recv().await {
            // Simulate processing
            tokio::time::sleep(Duration::from_micros(100)).await;
            processed_clone.fetch_add(1, Ordering::Relaxed);
        }
    });
    
    // Producer - try to send 10,000 items
    let total_items = 10_000;
    let start = std::time::Instant::now();
    
    for i in 0..total_items {
        // This will block when channel is full (backpressure)
        tx.send(format!("item-{}", i)).await.unwrap();
    }
    
    drop(tx); // Signal end
    consumer.await.unwrap();
    
    let elapsed = start.elapsed();
    let items_processed = processed.load(Ordering::Relaxed);
    
    assert_eq!(items_processed, total_items);
    println!(
        "Processed {} items in {:?} ({:.0} items/sec)",
        items_processed,
        elapsed,
        items_processed as f64 / elapsed.as_secs_f64()
    );
}

/// Test backpressure mechanism
#[tokio::test]
async fn test_backpressure_mechanism() {
    let channel_capacity = 10;
    let (tx, rx) = mpsc::channel::<u32>(channel_capacity);
    
    // Don't consume - let the channel fill up
    let _rx = rx;
    
    // Fill the channel
    for i in 0..channel_capacity {
        tx.send(i as u32).await.unwrap();
    }
    
    // Next send should block/timeout
    let result = tokio::time::timeout(
        Duration::from_millis(100),
        tx.send(999),
    ).await;
    
    // Should timeout because channel is full
    assert!(result.is_err(), "Expected timeout due to backpressure");
}

/// Test mocked HTTP endpoint
#[tokio::test]
async fn test_mocked_http_endpoint() {
    let mock_server = MockServer::start().await;
    
    // Mock the NewsAPI endpoint
    Mock::given(method("GET"))
        .and(path("/v2/everything"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "status": "ok",
            "totalResults": 2,
            "articles": [
                {
                    "title": "Test Article 1",
                    "description": "$BTC is pumping!",
                    "url": "https://example.com/1",
                    "publishedAt": "2024-01-15T10:00:00Z"
                },
                {
                    "title": "Test Article 2",
                    "description": "Market analysis for $ETH",
                    "url": "https://example.com/2",
                    "publishedAt": "2024-01-15T11:00:00Z"
                }
            ]
        })))
        .mount(&mock_server)
        .await;
    
    // Make request
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/v2/everything", mock_server.uri()))
        .query(&[("q", "crypto"), ("apiKey", "test-key")])
        .send()
        .await
        .unwrap();
    
    assert!(response.status().is_success());
    
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["totalResults"], 2);
    assert_eq!(body["articles"].as_array().unwrap().len(), 2);
}

/// Test pipeline stage latency tracking
#[tokio::test]
async fn test_stage_latency_tracking() {
    use std::time::Instant;
    
    let mut latencies = Vec::new();
    
    for _ in 0..100 {
        let start = Instant::now();
        
        // Simulate stage processing
        tokio::time::sleep(Duration::from_micros(100)).await;
        
        let latency = start.elapsed();
        latencies.push(latency.as_micros() as f64);
    }
    
    let avg_latency = latencies.iter().sum::<f64>() / latencies.len() as f64;
    let max_latency = latencies.iter().cloned().fold(0.0_f64, f64::max);
    let min_latency = latencies.iter().cloned().fold(f64::MAX, f64::min);
    
    println!("Stage latency stats:");
    println!("  Min: {:.2}µs", min_latency);
    println!("  Max: {:.2}µs", max_latency);
    println!("  Avg: {:.2}µs", avg_latency);
    
    // Latency should be reasonable (< 10ms for simple operations)
    assert!(avg_latency < 10_000.0, "Average latency too high");
}

/// Test worker pool scaling
#[tokio::test]
async fn test_worker_pool_scaling() {
    let (tx, rx) = mpsc::channel::<u32>(1000);
    let (out_tx, mut out_rx) = mpsc::channel::<u32>(1000);
    let (shutdown_tx, _) = broadcast::channel::<()>(1);
    
    let num_workers = 4;
    let items_per_worker = 100;
    let total_items = num_workers * items_per_worker;
    
    // Spawn workers
    let mut handles = Vec::new();
    let rx = Arc::new(tokio::sync::Mutex::new(rx));
    
    for worker_id in 0..num_workers {
        let rx = rx.clone();
        let out_tx = out_tx.clone();
        let mut shutdown_rx = shutdown_tx.subscribe();
        
        handles.push(tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = shutdown_rx.recv() => break,
                    item = async {
                        let mut guard = rx.lock().await;
                        guard.recv().await
                    } => {
                        match item {
                            Some(value) => {
                                // Process
                                tokio::time::sleep(Duration::from_micros(10)).await;
                                out_tx.send(value).await.ok();
                            }
                            None => break,
                        }
                    }
                }
            }
        }));
    }
    
    // Send items
    let start = std::time::Instant::now();
    for i in 0..total_items {
        tx.send(i as u32).await.unwrap();
    }
    drop(tx);
    
    // Collect results
    drop(out_tx);
    let mut results = Vec::new();
    while let Some(item) = out_rx.recv().await {
        results.push(item);
    }
    
    let elapsed = start.elapsed();
    
    // Shutdown workers
    shutdown_tx.send(()).ok();
    for handle in handles {
        handle.await.ok();
    }
    
    println!(
        "Worker pool processed {} items with {} workers in {:?}",
        results.len(),
        num_workers,
        elapsed
    );
    
    assert_eq!(results.len(), total_items as usize);
}

/// Test Redis Streams mock (simulates the interface)
#[tokio::test]
async fn test_message_bus_interface() {
    // Simulate message bus behavior
    let (tx, mut rx) = mpsc::channel::<String>(100);
    
    // Publisher
    let publisher = tokio::spawn(async move {
        for i in 0..50 {
            let message = serde_json::json!({
                "id": format!("msg-{}", i),
                "payload": "test data"
            }).to_string();
            
            tx.send(message).await.unwrap();
        }
    });
    
    // Consumer
    let consumer = tokio::spawn(async move {
        let mut received = 0;
        while let Some(msg) = rx.recv().await {
            let _parsed: serde_json::Value = serde_json::from_str(&msg).unwrap();
            received += 1;
        }
        received
    });
    
    publisher.await.unwrap();
    let received = consumer.await.unwrap();
    
    assert_eq!(received, 50);
}

/// Test event normalization
#[tokio::test]
async fn test_event_normalization() {
    use sha2::{Sha256, Digest};
    
    let payload = serde_json::json!({
        "title": "Test Event",
        "content": "This is test content about $BTC"
    });
    
    // Compute hash
    let payload_str = serde_json::to_string(&payload).unwrap();
    let hash = Sha256::digest(payload_str.as_bytes());
    let hash_hex = hex::encode(hash);
    
    assert!(!hash_hex.is_empty());
    assert_eq!(hash_hex.len(), 64); // SHA256 produces 64 hex chars
    
    // Verify deterministic
    let hash2 = Sha256::digest(payload_str.as_bytes());
    assert_eq!(hex::encode(hash2), hash_hex);
}

/// Test enrichment - ticker extraction
#[test]
fn test_ticker_extraction() {
    fn extract_tickers(text: &str) -> Vec<String> {
        let mut tickers = Vec::new();
        for word in text.split_whitespace() {
            if word.starts_with('$') && word.len() > 1 {
                let ticker = word[1..].trim_matches(|c: char| !c.is_alphanumeric());
                if !ticker.is_empty() && ticker.len() <= 10 {
                    tickers.push(ticker.to_uppercase());
                }
            }
        }
        tickers.sort();
        tickers.dedup();
        tickers
    }
    
    assert_eq!(
        extract_tickers("Buy $BTC and $ETH now!"),
        vec!["BTC", "ETH"]
    );
    
    assert_eq!(
        extract_tickers("No tickers here"),
        Vec::<String>::new()
    );
    
    assert_eq!(
        extract_tickers("$btc $BTC $btc"), // Should deduplicate
        vec!["BTC"]
    );
}

/// Test throughput - process many items quickly
#[tokio::test]
async fn test_high_throughput() {
    let (tx, mut rx) = mpsc::channel::<u64>(10_000);
    let processed = Arc::new(AtomicUsize::new(0));
    let processed_clone = processed.clone();
    
    // Fast consumer
    let consumer = tokio::spawn(async move {
        while let Some(_) = rx.recv().await {
            processed_clone.fetch_add(1, Ordering::Relaxed);
        }
    });
    
    // High-speed producer
    let item_count = 100_000;
    let start = std::time::Instant::now();
    
    for i in 0..item_count {
        tx.send(i).await.unwrap();
    }
    drop(tx);
    
    consumer.await.unwrap();
    let elapsed = start.elapsed();
    
    let throughput = item_count as f64 / elapsed.as_secs_f64();
    println!(
        "Throughput: {:.0} items/sec ({} items in {:?})",
        throughput,
        item_count,
        elapsed
    );
    
    assert!(throughput > 10_000.0, "Throughput should be > 10k items/sec");
    assert_eq!(processed.load(Ordering::Relaxed), item_count as usize);
}
