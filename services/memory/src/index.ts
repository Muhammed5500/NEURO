/**
 * NEURO Memory Service
 * Vector DB Adapter + Embedding for AI context with async indexing
 * 
 * Features:
 * - Embedding provider interface (OpenAI + local fallback)
 * - Qdrant vector database adapter
 * - Similarity query with statistics
 * - Async background indexing
 * - Deduplication at memory layer (99% threshold)
 * - Market outcome labeling pipeline
 */

import "dotenv/config";

// Core exports
export * from "./memory-manager.js";

// Legacy exports (for backward compatibility)
export * from "./vector-store.js";
export * from "./embeddings.js";

// New modular exports
export * from "./providers/index.js";
export * from "./adapters/index.js";
export * from "./schemas/index.js";
export * from "./services/index.js";

import { MemoryManager } from "./memory-manager.js";
import { logger } from "@neuro/shared";

const memoryLogger = logger.child({ service: "memory" });

async function main(): Promise<void> {
  memoryLogger.info("Starting NEURO Memory Service...");

  const manager = new MemoryManager({
    // Qdrant config
    qdrantUrl: process.env.QDRANT_URL || "http://localhost:6333",
    qdrantApiKey: process.env.QDRANT_API_KEY,
    collectionName: process.env.QDRANT_COLLECTION || "neuro_memories",
    
    // Embedding config
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.EMBEDDING_MODEL || "text-embedding-ada-002",
    enableLocalFallback: process.env.ENABLE_LOCAL_FALLBACK !== "false",
    
    // Redis config
    redisUrl: process.env.REDIS_URL,
    
    // Indexer config
    indexerConcurrency: parseInt(process.env.INDEXER_CONCURRENCY || "3"),
    indexerBatchSize: parseInt(process.env.INDEXER_BATCH_SIZE || "10"),
    
    // Deduplication config
    deduplicationThreshold: parseFloat(process.env.DEDUP_THRESHOLD || "0.99"),
    enableDeduplication: process.env.ENABLE_DEDUP !== "false",
  });

  await manager.initialize();

  // Log initial stats
  const stats = await manager.getStats();
  memoryLogger.info(
    { 
      vectorsCount: stats.vectorStore.vectorsCount,
      embeddingProvider: stats.embeddingProvider,
      healthy: stats.healthy,
    },
    "NEURO Memory Service started successfully"
  );

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    memoryLogger.info({ signal }, "Shutting down NEURO Memory Service...");
    
    // Pause indexer to stop accepting new items
    manager.pauseIndexer();
    
    // Drain remaining items
    await manager.drainIndexer();
    
    // Close connections
    await manager.close();
    
    memoryLogger.info("NEURO Memory Service shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Keep alive
  await new Promise(() => {});
}

// Check if this is the main module
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isMainModule) {
  main().catch((error) => {
    memoryLogger.fatal({ error }, "Failed to start NEURO Memory Service");
    process.exit(1);
  });
}
