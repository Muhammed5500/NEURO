# NEURO Memory Service

Vector database adapter and embedding service for AI context memory.

## Features

- **Embedding Provider Interface**: OpenAI-compatible with automatic local model fallback
- **Vector DB Adapter**: Qdrant integration with indexed metadata queries
- **Similarity Query**: Find top K similar items with statistics (price impact, time-to-impact)
- **Async Indexing**: Background task processing that doesn't block ingestion pipeline
- **Deduplication**: 99% similarity threshold prevents memory bloat
- **Market Labeler**: Placeholder for offline market outcome labeling pipeline

## Quick Start

### Prerequisites

1. Start infrastructure:

```bash
# From project root
docker compose up -d
```

This starts:
- PostgreSQL on port 5432
- Redis on port 6379  
- **Qdrant on port 6333** (vector database)

2. Configure environment:

```bash
# .env
QDRANT_URL=http://localhost:6333
OPENAI_API_KEY=sk-your-key-here  # Optional, falls back to local model
REDIS_URL=redis://localhost:6379 # Optional
```

### Running the Service

```bash
# Development
pnpm dev

# Production
pnpm build && pnpm start
```

## Usage Examples

### Basic Memory Operations

```typescript
import { MemoryManager } from "@neuro/memory";

const manager = new MemoryManager({
  qdrantUrl: "http://localhost:6333",
  openaiApiKey: process.env.OPENAI_API_KEY,
  enableLocalFallback: true,
});

await manager.initialize();

// Index a document (async, non-blocking)
const result = await manager.index({
  content: "Monad mainnet launches with 10k TPS",
  metadata: {
    sourceType: "news_item",
    source: "twitter",
    contentType: "news",
    tickers: ["MON"],
    sentiment: "bullish",
    sentimentScore: 0.85,
  },
});

console.log(result);
// { id: "abc-123", success: true, isDuplicate: false, processingTimeMs: 250 }

// Find similar items
const similar = await manager.findSimilar(
  "Monad network performance update",
  { limit: 5, minScore: 0.7 }
);

console.log(similar.stats);
// {
//   totalResults: 5,
//   avgScore: 0.82,
//   priceImpactStats: { hasLabels: false, ... },
//   sentimentDistribution: { bullish: 3, neutral: 2, bearish: 0 }
// }
```

### Index Ingestion Events

```typescript
// Index from NewsItem
await manager.indexNewsItem(
  {
    id: "news-123",
    source: "twitter",
    publishedAt: new Date().toISOString(),
    mentionedTokens: ["MON", "PEPE"],
    sentiment: "bullish",
    sentimentScore: 0.9,
  },
  "Breaking: Monad announces major partnership with..."
);

// Index from SocialSignal  
await manager.indexSocialSignal(
  {
    id: "signal-456",
    platform: "twitter",
    postedAt: new Date().toISOString(),
    tokenSymbol: "MON",
    sentiment: "bullish",
    isInfluencer: true,
  },
  "Just bought more $MON, this is going to be huge!"
);
```

### Similarity Query with Stats

```typescript
const result = await manager.findSimilar(
  "New token launch on nad.fun",
  {
    limit: 10,
    minScore: 0.75,
    metadata: {
      contentType: "news",
      tickers: ["MON"],
      sentiment: "bullish",
    },
    includeStats: true,
  }
);

// Access price impact statistics (if labels exist)
if (result.stats.priceImpactStats?.hasLabels) {
  console.log("Avg price impact:", result.stats.priceImpactStats.avgPriceImpactPercent);
  console.log("Avg time to impact:", result.stats.priceImpactStats.avgTimeToImpactMs);
}
```

### Market Outcome Labeling

```typescript
// Start automatic labeling job
const jobId = await manager.startLabelingJob(
  { contentType: "news", tickers: ["MON"] },
  { impactWindowMs: 24 * 60 * 60 * 1000 } // 24 hours
);

// Check job status
const job = manager.getLabelingJobStatus(jobId);
console.log(job?.status); // "running" | "completed" | "failed"

// Manual labeling
await manager.manualLabel("item-id", {
  priceImpactDirection: "up",
  priceImpactPercent: 15.5,
  timeToImpactMs: 3600000,
  confidenceScore: 0.95,
});
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Memory Manager                           │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Embedding  │  │   Qdrant    │  │   Similarity        │  │
│  │  Provider   │  │   Adapter   │  │   Query Service     │  │
│  │ (OpenAI +   │  │             │  │                     │  │
│  │  Local)     │  │             │  │                     │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                    │             │
│         │     ┌──────────┴──────────┐         │             │
│         │     │                     │         │             │
│  ┌──────┴─────┴────────┐  ┌─────────┴─────────┴───────────┐ │
│  │   Async Indexer     │  │    Market Outcome Labeler     │ │
│  │  (Background Task)  │  │       (Offline Pipeline)      │ │
│  └─────────────────────┘  └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │     Qdrant      │
                    │  (Vector DB)    │
                    └─────────────────┘
```

## Metadata Schema

The metadata schema is aligned with `packages/shared` Zod schemas:

| Field | Type | Description |
|-------|------|-------------|
| `sourceType` | `EmbeddingSourceType` | news_item, social_signal, etc. |
| `source` | `string` | Original source (twitter, newsapi) |
| `timestamp` | `ISO8601` | Content creation time |
| `tickers` | `string[]` | Mentioned token symbols |
| `sentiment` | `Sentiment` | bullish, bearish, neutral |
| `sentimentScore` | `number` | -1 to 1 |
| `language` | `string` | ISO language code |
| `priority` | `Severity` | low, medium, high, critical |
| `marketOutcome` | `object` | Price impact labels |

## Configuration

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `QDRANT_URL` | `http://localhost:6333` | Qdrant server URL |
| `QDRANT_API_KEY` | - | Qdrant API key (if needed) |
| `QDRANT_COLLECTION` | `neuro_memories` | Collection name |
| `OPENAI_API_KEY` | - | OpenAI API key |
| `EMBEDDING_MODEL` | `text-embedding-ada-002` | OpenAI model |
| `ENABLE_LOCAL_FALLBACK` | `true` | Use local model on OpenAI failure |
| `INDEXER_CONCURRENCY` | `3` | Parallel indexing tasks |
| `INDEXER_BATCH_SIZE` | `10` | Items per batch |
| `DEDUP_THRESHOLD` | `0.99` | Similarity threshold for dedup |
| `ENABLE_DEDUP` | `true` | Enable memory deduplication |

## Error Resilience

The embedding provider implements automatic fallback:

1. **Primary**: OpenAI API with exponential backoff + retry
2. **Fallback**: Local model (`@xenova/transformers`) after 3 consecutive failures
3. **Recovery**: Automatic switch back to OpenAI when healthy

```typescript
// Force manual switch
const provider = manager.getEmbeddingProvider() as ResilientEmbeddingProvider;
provider.switchProvider("local"); // Use local model
provider.resetFailureCounter();   // Reset after manual intervention
```

## Development

```bash
# Type check
pnpm typecheck

# Run tests
pnpm test

# Build
pnpm build
```

## License

MIT
