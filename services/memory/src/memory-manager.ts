/**
 * Memory Manager
 * 
 * Unified interface for vector storage, embedding, similarity queries,
 * and async indexing. Integrates all memory service components.
 */

import { logger } from "@neuro/shared";
import Redis, { type Redis as RedisClient } from "ioredis";

import { createQdrantAdapter } from "./adapters/qdrant-adapter.js";
import { 
  createEmbeddingProvider,
  type IEmbeddingProvider,
} from "./providers/embedding-provider.js";
import { 
  createSimilarityQueryService,
  type SimilarityQueryResult,
  type SimilarityQueryOptions 
} from "./services/similarity-query.js";
import { 
  createAsyncIndexer,
  type IndexItem,
  type IndexResult,
  type IndexerStats 
} from "./services/async-indexer.js";
import { 
  createMarketLabeler,
  type IMarketDataProvider,
  type LabelingConfig 
} from "./services/market-labeler.js";
import {
  type VectorMetadata,
  type QueryMetadata,
  type QueryStats,
  metadataFromNewsItem,
  metadataFromSocialSignal,
  metadataFromIngestionEvent,
} from "./schemas/metadata.js";

const log = logger.child({ module: "memory-manager" });

// ============================================
// TYPES
// ============================================

export interface MemoryManagerConfig {
  // Qdrant
  qdrantUrl: string;
  qdrantApiKey?: string;
  collectionName?: string;
  
  // Embeddings
  openaiApiKey?: string;
  openaiModel?: string;
  enableLocalFallback?: boolean;
  localModelName?: string;
  
  // Redis (optional, for caching)
  redisUrl?: string;
  
  // Indexer
  indexerConcurrency?: number;
  indexerBatchSize?: number;
  
  // Deduplication
  deduplicationThreshold?: number;
  enableDeduplication?: boolean;
  
  // Market Labeler
  marketDataProvider?: IMarketDataProvider;
  labelingConfig?: LabelingConfig;
}

export interface MemoryItem {
  id?: string;
  content: string;
  metadata: Partial<VectorMetadata>;
}

export interface MemoryStats {
  vectorStore: {
    vectorsCount: number;
    pointsCount: number;
    status: string;
  };
  indexer: IndexerStats;
  embeddingProvider: "openai" | "local";
  healthy: boolean;
}

// ============================================
// MEMORY MANAGER
// ============================================

export class MemoryManager {
  private config: MemoryManagerConfig;
  private adapter: QdrantAdapter;
  private embeddingProvider: IEmbeddingProvider;
  private similarityQuery: SimilarityQueryService;
  private indexer: AsyncIndexerService;
  private labeler: MarketOutcomeLabeler;
  private redis?: RedisClient;
  private initialized = false;

  constructor(config: MemoryManagerConfig) {
    this.config = config;

    // Initialize Qdrant adapter
    this.adapter = createQdrantAdapter({
      url: config.qdrantUrl,
      apiKey: config.qdrantApiKey,
      collectionName: config.collectionName,
    });

    // Initialize embedding provider
    this.embeddingProvider = createEmbeddingProvider({
      openaiApiKey: config.openaiApiKey,
      openaiModel: config.openaiModel as any,
      enableLocalFallback: config.enableLocalFallback ?? true,
      localModelName: config.localModelName,
    });

    // Initialize similarity query service
    this.similarityQuery = createSimilarityQueryService(
      this.adapter,
      this.embeddingProvider
    );

    // Initialize async indexer
    this.indexer = createAsyncIndexer(this.adapter, this.embeddingProvider, {
      concurrency: config.indexerConcurrency,
      batchSize: config.indexerBatchSize,
      deduplicationThreshold: config.deduplicationThreshold ?? 0.99,
      enableDeduplication: config.enableDeduplication ?? true,
    });

    // Initialize market labeler
    this.labeler = createMarketLabeler(
      this.adapter,
      config.marketDataProvider,
      config.labelingConfig
    );

    // Initialize Redis if URL provided
    if (config.redisUrl) {
      this.redis = new Redis(config.redisUrl);
    }
  }

  /**
   * Initialize all components
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.adapter.initialize();
    this.initialized = true;

    log.info("Memory Manager initialized");
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    // Drain indexer queue
    await this.indexer.drain();

    // Close Redis
    if (this.redis) {
      await this.redis.quit();
    }

    // Close adapter
    await this.adapter.close();

    log.info("Memory Manager closed");
  }

  // ============================================
  // INDEXING OPERATIONS
  // ============================================

  /**
   * Index a single item (async, non-blocking)
   */
  async index(item: MemoryItem): Promise<IndexResult> {
    const indexItem: IndexItem = {
      id: item.id,
      content: item.content,
      metadata: this.prepareMetadata(item.metadata),
    };

    return this.indexer.index(indexItem);
  }

  /**
   * Index multiple items (async, non-blocking)
   */
  async indexMany(items: MemoryItem[]): Promise<IndexResult[]> {
    const indexItems: IndexItem[] = items.map((item) => ({
      id: item.id,
      content: item.content,
      metadata: this.prepareMetadata(item.metadata),
    }));

    return this.indexer.indexMany(indexItems);
  }

  /**
   * Index a NewsItem
   */
  async indexNewsItem(
    newsItem: Parameters<typeof metadataFromNewsItem>[0],
    content: string
  ): Promise<IndexResult> {
    const provider = this.embeddingProvider.getProvider();
    const metadata = metadataFromNewsItem(newsItem, {
      model: provider === "openai" ? "text-embedding-ada-002" : "all-MiniLM-L6-v2",
      provider,
    });

    return this.index({
      id: newsItem.id,
      content,
      metadata,
    });
  }

  /**
   * Index a SocialSignal
   */
  async indexSocialSignal(
    signal: Parameters<typeof metadataFromSocialSignal>[0],
    content: string
  ): Promise<IndexResult> {
    const provider = this.embeddingProvider.getProvider();
    const metadata = metadataFromSocialSignal(signal, {
      model: provider === "openai" ? "text-embedding-ada-002" : "all-MiniLM-L6-v2",
      provider,
    });

    return this.index({
      id: signal.id,
      content,
      metadata,
    });
  }

  /**
   * Index an IngestionEvent
   */
  async indexIngestionEvent(
    event: Parameters<typeof metadataFromIngestionEvent>[0],
    content: string
  ): Promise<IndexResult> {
    const provider = this.embeddingProvider.getProvider();
    const metadata = metadataFromIngestionEvent(event, {
      model: provider === "openai" ? "text-embedding-ada-002" : "all-MiniLM-L6-v2",
      provider,
    });

    return this.index({
      id: event.id,
      content,
      metadata,
    });
  }

  /**
   * Wait for all pending indexing to complete
   */
  async drainIndexer(): Promise<void> {
    await this.indexer.drain();
  }

  // ============================================
  // SIMILARITY QUERY OPERATIONS
  // ============================================

  /**
   * Find similar items for a query text
   */
  async findSimilar(
    query: string,
    options?: SimilarityQueryOptions
  ): Promise<SimilarityQueryResult> {
    return this.similarityQuery.findSimilar(query, options);
  }

  /**
   * Find similar items for a given vector
   */
  async findSimilarByVector(
    vector: number[],
    options?: SimilarityQueryOptions
  ): Promise<Omit<SimilarityQueryResult, "query">> {
    return this.similarityQuery.findSimilarByVector(vector, options);
  }

  /**
   * Find similar items with specific metadata filter
   */
  async findSimilarWithFilter(
    query: string,
    filter: QueryMetadata,
    options?: Omit<SimilarityQueryOptions, "metadata">
  ): Promise<SimilarityQueryResult> {
    return this.similarityQuery.findSimilar(query, {
      ...options,
      metadata: filter,
    });
  }

  // ============================================
  // DIRECT STORE OPERATIONS
  // ============================================

  /**
   * Get an item by ID
   */
  async getById(id: string): Promise<{ content: string; metadata: VectorMetadata } | null> {
    const result = await this.adapter.getById(id);
    if (!result) return null;

    return {
      content: result.payload.content,
      metadata: result.payload as unknown as VectorMetadata,
    };
  }

  /**
   * Delete items by IDs
   */
  async delete(ids: string[]): Promise<void> {
    await this.adapter.delete(ids);
  }

  /**
   * Check for duplicates before indexing
   */
  async checkDuplicate(content: string): Promise<{ isDuplicate: boolean; duplicateId?: string }> {
    const embedding = await this.embeddingProvider.embed(content);
    const duplicates = await this.adapter.findDuplicates(
      embedding.embedding,
      this.config.deduplicationThreshold ?? 0.99
    );

    if (duplicates.length > 0) {
      return { isDuplicate: true, duplicateId: duplicates[0].id };
    }

    return { isDuplicate: false };
  }

  // ============================================
  // MARKET LABELING OPERATIONS
  // ============================================

  /**
   * Start a market labeling job
   */
  async startLabelingJob(
    filter?: {
      contentType?: string;
      tickers?: string[];
      timestampFrom?: string;
      timestampTo?: string;
    },
    config?: Partial<LabelingConfig>
  ): Promise<string> {
    return this.labeler.startLabelingJob(filter, config);
  }

  /**
   * Get labeling job status
   */
  getLabelingJobStatus(jobId: string) {
    return this.labeler.getJobStatus(jobId);
  }

  /**
   * Manually label an item
   */
  async manualLabel(
    id: string,
    outcome: {
      priceImpactDirection: "up" | "down" | "neutral";
      priceImpactPercent: number;
      timeToImpactMs: number;
      confidenceScore: number;
    }
  ): Promise<void> {
    await this.labeler.manualLabel(id, outcome);
  }

  /**
   * Get labeling statistics
   */
  async getLabelingStats() {
    return this.labeler.getStats();
  }

  // ============================================
  // UTILITY OPERATIONS
  // ============================================

  /**
   * Get memory service statistics
   */
  async getStats(): Promise<MemoryStats> {
    const collectionInfo = await this.adapter.getCollectionInfo();
    const indexerStats = this.indexer.getStats();
    const healthy = await this.isHealthy();

    return {
      vectorStore: {
        vectorsCount: collectionInfo.vectorsCount,
        pointsCount: collectionInfo.pointsCount,
        status: collectionInfo.status,
      },
      indexer: indexerStats,
      embeddingProvider: this.embeddingProvider.getProvider(),
      healthy,
    };
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    const adapterHealthy = await this.adapter.isHealthy();
    const embeddingHealthy = await this.embeddingProvider.isHealthy();

    return adapterHealthy && embeddingHealthy;
  }

  /**
   * Pause indexer
   */
  pauseIndexer(): void {
    this.indexer.pause();
  }

  /**
   * Resume indexer
   */
  resumeIndexer(): void {
    this.indexer.resume();
  }

  /**
   * Clear indexer queue
   */
  clearIndexerQueue(): void {
    this.indexer.clear();
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  /**
   * Prepare metadata with defaults
   */
  private prepareMetadata(
    partial: Partial<VectorMetadata>
  ): Omit<VectorMetadata, "contentHash" | "indexedAt"> {
    const provider = this.embeddingProvider.getProvider();
    
    return {
      sourceType: partial.sourceType || "custom",
      source: partial.source || "unknown",
      timestamp: partial.timestamp || new Date().toISOString(),
      contentType: partial.contentType || "document",
      tickers: partial.tickers || [],
      mentionedAddresses: partial.mentionedAddresses || [],
      language: partial.language || "en",
      sentiment: partial.sentiment,
      sentimentScore: partial.sentimentScore,
      entityTags: partial.entityTags || [],
      category: partial.category,
      tags: partial.tags || [],
      priority: partial.priority || "medium",
      relevanceScore: partial.relevanceScore,
      qualityScore: partial.qualityScore,
      marketOutcome: partial.marketOutcome || { labeled: false },
      isDuplicate: false,
      embeddingModel: provider === "openai" ? "text-embedding-ada-002" : "all-MiniLM-L6-v2",
      embeddingProvider: provider,
      processingTimeMs: partial.processingTimeMs,
      expiresAt: partial.expiresAt,
      sourceId: partial.sourceId,
      sourceUrl: partial.sourceUrl,
      duplicateOf: partial.duplicateOf,
    };
  }

  // ============================================
  // ACCESSORS
  // ============================================

  /**
   * Get the underlying Qdrant adapter
   */
  getAdapter(): QdrantAdapter {
    return this.adapter;
  }

  /**
   * Get the embedding provider
   */
  getEmbeddingProvider(): IEmbeddingProvider {
    return this.embeddingProvider;
  }

  /**
   * Get the similarity query service
   */
  getSimilarityQueryService(): SimilarityQueryService {
    return this.similarityQuery;
  }

  /**
   * Get the async indexer
   */
  getIndexer(): AsyncIndexerService {
    return this.indexer;
  }

  /**
   * Get the market labeler
   */
  getLabeler(): MarketOutcomeLabeler {
    return this.labeler;
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createMemoryManager(config: MemoryManagerConfig): MemoryManager {
  return new MemoryManager(config);
}

// Re-export types for convenience
export type { 
  VectorMetadata, 
  QueryMetadata, 
  QueryStats,
  SimilarityQueryResult,
  SimilarityQueryOptions,
  IndexItem,
  IndexResult,
  IndexerStats,
};
