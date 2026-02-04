/**
 * Async Indexer Service
 * 
 * Background task for indexing vectors without blocking the ingestion pipeline.
 * 
 * Turkish: "Vektör indeksleme işleminin, veri toplama akışını (ingestion pipeline)
 * kilitlememesi için asenkron (background task) çalıştığından emin ol."
 */

import { logger } from "@neuro/shared";
import PQueue from "p-queue";
import type { QdrantAdapter, VectorPoint } from "../adapters/qdrant-adapter.js";
import type { IEmbeddingProvider, EmbeddingResult } from "../providers/embedding-provider.js";
import type { VectorMetadata } from "../schemas/metadata.js";
import crypto from "crypto";

const log = logger.child({ module: "async-indexer" });

// ============================================
// TYPES
// ============================================

export interface IndexItem {
  id?: string;
  content: string;
  metadata: Omit<VectorMetadata, "contentHash" | "indexedAt">;
}

export interface IndexResult {
  id: string;
  success: boolean;
  error?: string;
  isDuplicate?: boolean;
  duplicateOf?: string;
  processingTimeMs: number;
}

export interface AsyncIndexerConfig {
  concurrency?: number;
  batchSize?: number;
  deduplicationThreshold?: number;
  enableDeduplication?: boolean;
  onIndexComplete?: (result: IndexResult) => void;
  onBatchComplete?: (results: IndexResult[]) => void;
}

export interface IndexerStats {
  queueSize: number;
  pending: number;
  processed: number;
  duplicates: number;
  errors: number;
  avgProcessingTimeMs: number;
}

// ============================================
// ASYNC INDEXER SERVICE
// ============================================

export class AsyncIndexerService {
  private adapter: QdrantAdapter;
  private embeddingProvider: IEmbeddingProvider;
  private queue: PQueue;
  private config: Required<AsyncIndexerConfig>;
  
  // Stats
  private processed = 0;
  private duplicates = 0;
  private errors = 0;
  private totalProcessingTime = 0;
  
  // Batch accumulator
  private batchBuffer: { item: IndexItem; resolve: (result: IndexResult) => void }[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;

  constructor(
    adapter: QdrantAdapter,
    embeddingProvider: IEmbeddingProvider,
    config: AsyncIndexerConfig = {}
  ) {
    this.adapter = adapter;
    this.embeddingProvider = embeddingProvider;
    
    this.config = {
      concurrency: config.concurrency ?? 3,
      batchSize: config.batchSize ?? 10,
      deduplicationThreshold: config.deduplicationThreshold ?? 0.99,
      enableDeduplication: config.enableDeduplication ?? true,
      onIndexComplete: config.onIndexComplete ?? (() => {}),
      onBatchComplete: config.onBatchComplete ?? (() => {}),
    };

    // Initialize priority queue with concurrency limit
    this.queue = new PQueue({ concurrency: this.config.concurrency });

    log.info(
      { 
        concurrency: this.config.concurrency, 
        batchSize: this.config.batchSize,
        deduplicationThreshold: this.config.deduplicationThreshold,
      },
      "Async indexer initialized"
    );
  }

  /**
   * Queue an item for indexing (non-blocking)
   */
  async index(item: IndexItem): Promise<IndexResult> {
    return new Promise((resolve) => {
      this.batchBuffer.push({ item, resolve });
      
      // Process batch when buffer is full
      if (this.batchBuffer.length >= this.config.batchSize) {
        this.processBatch();
      } else {
        // Set timeout to process partial batch
        this.scheduleBatchTimeout();
      }
    });
  }

  /**
   * Queue multiple items for indexing
   */
  async indexMany(items: IndexItem[]): Promise<IndexResult[]> {
    return Promise.all(items.map((item) => this.index(item)));
  }

  /**
   * Schedule batch processing timeout
   */
  private scheduleBatchTimeout(): void {
    if (this.batchTimeout) return;

    this.batchTimeout = setTimeout(() => {
      this.processBatch();
    }, 100); // Process after 100ms of inactivity
  }

  /**
   * Process accumulated batch
   */
  private processBatch(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    if (this.batchBuffer.length === 0) return;

    const batch = this.batchBuffer.splice(0, this.config.batchSize);
    
    this.queue.add(async () => {
      const results = await this.processBatchInternal(batch.map((b) => b.item));
      
      // Resolve promises
      for (let i = 0; i < batch.length; i++) {
        batch[i].resolve(results[i]);
        this.config.onIndexComplete(results[i]);
      }

      this.config.onBatchComplete(results);
    });
  }

  /**
   * Internal batch processing
   */
  private async processBatchInternal(items: IndexItem[]): Promise<IndexResult[]> {
    const results: IndexResult[] = [];

    try {
      // Generate embeddings in batch
      const contents = items.map((item) => item.content);
      const embeddings = await this.embeddingProvider.embedBatch(contents);

      // Process each item
      const points: VectorPoint[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const embeddingResult = embeddings[i];
        const startTime = Date.now();

        try {
          const id = item.id || crypto.randomUUID();
          const contentHash = this.hashContent(item.content);

          // Check for duplicates if enabled
          if (this.config.enableDeduplication) {
            const duplicates = await this.adapter.findDuplicates(
              embeddingResult.embedding,
              this.config.deduplicationThreshold
            );

            if (duplicates.length > 0) {
              this.duplicates++;
              results.push({
                id,
                success: true,
                isDuplicate: true,
                duplicateOf: duplicates[0].id,
                processingTimeMs: Date.now() - startTime,
              });
              continue;
            }
          }

          // Prepare vector point
          const point: VectorPoint = {
            id,
            vector: embeddingResult.embedding,
            payload: {
              content: item.content,
              ...item.metadata,
              contentHash,
              indexedAt: new Date().toISOString(),
              embeddingModel: embeddingResult.model,
              embeddingProvider: embeddingResult.provider,
              processingTimeMs: embeddingResult.processingTimeMs,
            } as VectorMetadata & { content: string },
          };

          points.push(point);

          const processingTime = Date.now() - startTime;
          this.processed++;
          this.totalProcessingTime += processingTime;

          results.push({
            id,
            success: true,
            processingTimeMs: processingTime,
          });
        } catch (error) {
          this.errors++;
          results.push({
            id: item.id || "unknown",
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            processingTimeMs: Date.now() - startTime,
          });
        }
      }

      // Batch upsert to vector store
      if (points.length > 0) {
        await this.adapter.upsert(points);
      }
    } catch (error) {
      // If batch embedding fails, mark all as errors
      for (const item of items) {
        this.errors++;
        results.push({
          id: item.id || "unknown",
          success: false,
          error: error instanceof Error ? error.message : "Batch processing failed",
          processingTimeMs: 0,
        });
      }
    }

    return results;
  }

  /**
   * Hash content for deduplication
   */
  private hashContent(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  /**
   * Get indexer statistics
   */
  getStats(): IndexerStats {
    return {
      queueSize: this.queue.size,
      pending: this.queue.pending,
      processed: this.processed,
      duplicates: this.duplicates,
      errors: this.errors,
      avgProcessingTimeMs: this.processed > 0 
        ? this.totalProcessingTime / this.processed 
        : 0,
    };
  }

  /**
   * Wait for all pending items to be processed
   */
  async drain(): Promise<void> {
    // Process any remaining items in buffer
    this.processBatch();
    
    // Wait for queue to empty
    await this.queue.onIdle();
  }

  /**
   * Clear the queue (cancel pending items)
   */
  clear(): void {
    this.queue.clear();
    
    // Resolve pending buffer items with cancelled status
    for (const { resolve } of this.batchBuffer) {
      resolve({
        id: "cancelled",
        success: false,
        error: "Indexer cleared",
        processingTimeMs: 0,
      });
    }
    this.batchBuffer = [];

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
  }

  /**
   * Pause indexing
   */
  pause(): void {
    this.queue.pause();
    log.info("Async indexer paused");
  }

  /**
   * Resume indexing
   */
  resume(): void {
    this.queue.start();
    log.info("Async indexer resumed");
  }

  /**
   * Check if indexer is idle
   */
  isIdle(): boolean {
    return this.queue.size === 0 && this.queue.pending === 0 && this.batchBuffer.length === 0;
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createAsyncIndexer(
  adapter: QdrantAdapter,
  embeddingProvider: IEmbeddingProvider,
  config?: AsyncIndexerConfig
): AsyncIndexerService {
  return new AsyncIndexerService(adapter, embeddingProvider, config);
}
