//! Pipeline Benchmarks
//!
//! Measures throughput and latency of pipeline stages.
//! Run with: cargo bench

use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::runtime::Runtime;
use tokio::sync::mpsc;

/// Benchmark channel throughput with different capacities
fn bench_channel_throughput(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    
    let mut group = c.benchmark_group("channel_throughput");
    group.throughput(Throughput::Elements(10_000));
    
    for capacity in [100, 1000, 10_000].iter() {
        group.bench_with_input(
            format!("capacity_{}", capacity),
            capacity,
            |b, &capacity| {
                b.iter(|| {
                    rt.block_on(async {
                        let (tx, mut rx) = mpsc::channel::<u64>(capacity);
                        
                        let producer = tokio::spawn(async move {
                            for i in 0..10_000u64 {
                                tx.send(i).await.unwrap();
                            }
                        });
                        
                        let consumer = tokio::spawn(async move {
                            let mut count = 0u64;
                            while let Some(_) = rx.recv().await {
                                count += 1;
                            }
                            count
                        });
                        
                        producer.await.unwrap();
                        black_box(consumer.await.unwrap())
                    })
                })
            },
        );
    }
    
    group.finish();
}

/// Benchmark hash computation for deduplication
fn bench_hash_computation(c: &mut Criterion) {
    use sha2::{Sha256, Digest};
    
    let mut group = c.benchmark_group("hash_computation");
    
    // Different payload sizes
    for size in [100, 1000, 10_000].iter() {
        let payload = "x".repeat(*size);
        
        group.throughput(Throughput::Bytes(*size as u64));
        group.bench_with_input(
            format!("payload_{}b", size),
            &payload,
            |b, payload| {
                b.iter(|| {
                    let mut hasher = Sha256::new();
                    hasher.update(payload.as_bytes());
                    black_box(hex::encode(hasher.finalize()))
                })
            },
        );
    }
    
    group.finish();
}

/// Benchmark JSON serialization
fn bench_json_serialization(c: &mut Criterion) {
    let mut group = c.benchmark_group("json_serialization");
    
    let mut payload = HashMap::new();
    payload.insert("id", serde_json::json!("test-id-12345"));
    payload.insert("content", serde_json::json!("This is test content for benchmarking"));
    payload.insert("timestamp", serde_json::json!("2024-01-15T10:00:00Z"));
    payload.insert("tags", serde_json::json!(["tag1", "tag2", "tag3"]));
    
    group.bench_function("serialize", |b| {
        b.iter(|| {
            black_box(serde_json::to_string(&payload).unwrap())
        })
    });
    
    let json_str = serde_json::to_string(&payload).unwrap();
    group.bench_function("deserialize", |b| {
        b.iter(|| {
            black_box(serde_json::from_str::<HashMap<&str, serde_json::Value>>(&json_str).unwrap())
        })
    });
    
    group.finish();
}

/// Benchmark ticker extraction
fn bench_ticker_extraction(c: &mut Criterion) {
    let mut group = c.benchmark_group("ticker_extraction");
    
    let text = "Breaking: $BTC pumps to new ATH! $ETH and $SOL also rising. \
                Analysts predict $DOGE and $SHIB will follow. \
                Meanwhile $XRP and $ADA show mixed signals.";
    
    group.bench_function("extract_tickers", |b| {
        b.iter(|| {
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
            black_box(tickers)
        })
    });
    
    group.finish();
}

/// Benchmark worker pool with different worker counts
fn bench_worker_scaling(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    
    let mut group = c.benchmark_group("worker_scaling");
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(5));
    
    for workers in [1, 2, 4, 8].iter() {
        group.throughput(Throughput::Elements(1000));
        group.bench_with_input(
            format!("{}_workers", workers),
            workers,
            |b, &workers| {
                b.iter(|| {
                    rt.block_on(async {
                        let (tx, rx) = mpsc::channel::<u64>(1000);
                        let (out_tx, mut out_rx) = mpsc::channel::<u64>(1000);
                        
                        let rx = Arc::new(tokio::sync::Mutex::new(rx));
                        let mut handles = Vec::new();
                        
                        for _ in 0..workers {
                            let rx = rx.clone();
                            let out_tx = out_tx.clone();
                            
                            handles.push(tokio::spawn(async move {
                                loop {
                                    let item = {
                                        let mut guard = rx.lock().await;
                                        guard.recv().await
                                    };
                                    
                                    match item {
                                        Some(v) => {
                                            // Simulate work
                                            tokio::task::yield_now().await;
                                            out_tx.send(v).await.ok();
                                        }
                                        None => break,
                                    }
                                }
                            }));
                        }
                        
                        // Send items
                        for i in 0..1000u64 {
                            tx.send(i).await.unwrap();
                        }
                        drop(tx);
                        drop(out_tx);
                        
                        // Collect
                        let mut count = 0;
                        while let Some(_) = out_rx.recv().await {
                            count += 1;
                        }
                        
                        for handle in handles {
                            handle.await.ok();
                        }
                        
                        black_box(count)
                    })
                })
            },
        );
    }
    
    group.finish();
}

criterion_group!(
    benches,
    bench_channel_throughput,
    bench_hash_computation,
    bench_json_serialization,
    bench_ticker_extraction,
    bench_worker_scaling,
);

criterion_main!(benches);
