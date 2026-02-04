# neuro-ingestion

High-speed market data and news harvesting service for NEURO (Rust/Tokio).

## Features

- **High Performance**: Async Rust with Tokio runtime
- **Pipeline Architecture**: fetch → normalize → enrich → embed → publish
- **Backpressure**: Bounded channels prevent memory blowup
- **Worker Pools**: Configurable workers per stage
- **Prometheus Metrics**: Per-stage latency, throughput, queue depth
- **Message Bus**: Redis Streams (dev) / NATS JetStream (prod)
- **Rate Limiting**: Governor-based rate limiting for APIs
- **Circuit Breaker**: Automatic failover for unreliable sources
- **Deduplication**: Content hash + URL-based dedup
- **Checkpointing**: Resume from last position

## Prerequisites

- Rust 1.75+
- Docker (for Redis/NATS)

## Quick Start

```bash
# Start infrastructure
docker compose up -d

# Build
cargo build --release

# Run pipeline (set REDIS_URL for Redis Streams)
REDIS_URL=redis://localhost:6379 cargo run -- pipeline --channel-capacity 1000 --enrich true
```

### Restarting on Windows

If you get **"Erişim engellendi" (Access denied)** when running `cargo run -- pipeline` again, the previous process is still running and locking the `.exe`. Stop it first:

```powershell
# Stop the running ingestion process
Get-Process -Name "neuro-ingestion" -ErrorAction SilentlyContinue | Stop-Process -Force
```

Then run `cargo run -- pipeline` again.

## Commands

```bash
# Start pipeline service (recommended)
cargo run -- pipeline [OPTIONS]

# Start legacy harvester
cargo run -- run --daemon true

# Single harvest
cargo run -- harvest --source newsapi --since 1h

# Show status
cargo run -- status

# Reset checkpoints
cargo run -- reset --source all

# Run tests
cargo test

# Run benchmarks
cargo bench
```

## Pipeline Architecture

```
┌─────────┐    ┌───────────┐    ┌────────┐    ┌───────┐    ┌─────────┐
│  Fetch  │───▶│ Normalize │───▶│ Enrich │───▶│ Embed │───▶│ Publish │
└─────────┘    └───────────┘    └────────┘    └───────┘    └─────────┘
     │              │               │             │             │
     ▼              ▼               ▼             ▼             ▼
  [bounded]     [bounded]       [bounded]     [bounded]    [message bus]
  channel       channel         channel       channel      Redis/NATS
```

### Stages

| Stage | Workers | Description |
|-------|---------|-------------|
| Fetch | 4 | Receives data from external sources |
| Normalize | 2 | Validates, computes hash, standardizes format |
| Enrich | 2 | Extracts tickers, sentiment, language |
| Embed | 1 | Generates vector embeddings (optional) |
| Publish | 2 | Sends to message bus atomically |

### Backpressure

Turkish: "Veri akışı işleme hızından fazlaysa, belleğin şişip 'Out of Memory' hatasıyla kapanmaması için bounded kanallarını kullanarak üreticiyi yavaşlatan bir mekanizma."

- Channel capacity configurable (default: 1000)
- When channel is full, producers block
- Prevents memory exhaustion under load
- Metrics track backpressure events

## Configuration

```env
# Network
MONAD_RPC_URL=https://rpc.monad.xyz
NADFUN_API_URL=https://api.nadapp.net

# Message Bus
MESSAGE_BUS_TYPE=redis  # or "nats"
REDIS_URL=redis://localhost:6379
NATS_URL=nats://localhost:4222
MESSAGE_BUS_STREAM=neuro:ingestion

# Pipeline
PIPELINE_CHANNEL_CAPACITY=1000
PIPELINE_FETCH_WORKERS=4
PIPELINE_NORMALIZE_WORKERS=2
PIPELINE_ENRICH_WORKERS=2
PIPELINE_EMBED_WORKERS=1
PIPELINE_PUBLISH_WORKERS=2
PIPELINE_ENABLE_ENRICH=true
PIPELINE_ENABLE_EMBED=false

# Metrics
METRICS_ENABLED=true
METRICS_PORT=9090

# External APIs
NEWS_API_KEY=your-key
CRYPTOPANIC_API_KEY=your-key
TWITTER_BEARER_TOKEN=your-token
```

## Metrics

Prometheus metrics available at `http://localhost:9090/metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `ingestion_events_processed_total` | Counter | Events processed by stage |
| `ingestion_stage_latency_seconds` | Histogram | Latency per stage |
| `ingestion_queue_depth` | Gauge | Items waiting in queue |
| `ingestion_queue_capacity` | Gauge | Max queue capacity |
| `ingestion_worker_count` | Gauge | Workers per stage |
| `ingestion_active_workers` | Gauge | Currently processing |
| `ingestion_errors_total` | Counter | Errors by stage/type |
| `ingestion_backpressure_events_total` | Counter | Backpressure activations |
| `ingestion_publish_latency_seconds` | Histogram | Message bus publish time |
| `ingestion_dedup_hits_total` | Counter | Duplicates detected |

## Message Bus

### Redis Streams (Development)

```bash
# View stream
redis-cli XINFO STREAM neuro:ingestion

# Read messages
redis-cli XREAD COUNT 10 STREAMS neuro:ingestion 0
```

### NATS JetStream (Production)

```bash
# View stream
nats stream info neuro:ingestion

# Read messages
nats consumer sub neuro:ingestion consumer-name
```

## Testing

```bash
# Unit tests
cargo test

# Integration tests
cargo test --test integration_tests

# Benchmarks
cargo bench
```

### Acceptance Criteria

1. **Memory Stability**: Process thousands of items without OOM
2. **Metrics Endpoint**: Shows stage latencies at `/metrics`
3. **Atomic Publish**: No data loss to message bus

## Architecture

```
services/ingestion/
├── Cargo.toml
├── benches/
│   └── pipeline_benchmark.rs
├── tests/
│   └── integration_tests.rs
└── src/
    ├── main.rs              # Entry point, CLI
    ├── config.rs            # Configuration
    ├── error.rs             # Error types
    ├── metrics.rs           # Prometheus metrics
    ├── harvester.rs         # Legacy harvester
    ├── pipeline/
    │   ├── mod.rs           # Pipeline orchestration
    │   ├── stages.rs        # Stage implementations
    │   └── worker.rs        # Worker pool
    ├── message_bus/
    │   ├── mod.rs           # Bus trait & factory
    │   ├── redis_streams.rs # Redis implementation
    │   └── nats_adapter.rs  # NATS implementation
    ├── sources/
    │   ├── mod.rs           # Source trait
    │   ├── newsapi.rs       # NewsAPI connector
    │   ├── cryptopanic.rs   # CryptoPanic connector
    │   ├── x_api.rs         # X/Twitter connector
    │   ├── nadfun.rs        # nad.fun connector
    │   └── monad.rs         # Monad RPC connector
    ├── schemas/             # Data schemas (aligned with shared/)
    ├── checkpoint.rs        # State persistence
    ├── dedup.rs             # Deduplication
    ├── circuit_breaker.rs   # Failure handling
    ├── http_client.rs       # Resilient HTTP
    ├── append_log.rs        # Audit log
    └── storage/             # DB/Redis storage
```

## Performance

Benchmarks on M1 MacBook Pro:

| Metric | Value |
|--------|-------|
| Throughput | > 50,000 events/sec |
| P99 Latency | < 10ms |
| Memory (1M events) | < 500MB |

Run benchmarks:
```bash
cargo bench
```

## License

MIT
