/**
 * Qdrant Vector Database Adapter
 * 
 * Provides a clean interface for vector operations with Qdrant.
 * Supports indexed metadata queries and payload filtering.
 */

import { QdrantClient, Schemas } from "@qdrant/js-client-rest";
import { logger } from "@neuro/shared";
import type { VectorMetadata } from "../schemas/metadata.js";

const log = logger.child({ module: "qdrant-adapter" });

// ============================================
// TYPES
// ============================================

export interface QdrantConfig {
  url: string;
  apiKey?: string;
  collectionName?: string;
  vectorSize?: number;
}

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: VectorMetadata & { content: string };
}

export interface SearchOptions {
  limit?: number;
  scoreThreshold?: number;
  filter?: Schemas["Filter"];
  withPayload?: boolean;
  withVector?: boolean;
}

export interface SearchResult {
  id: string;
  score: number;
  payload: VectorMetadata & { content: string };
  vector?: number[];
}

export interface CollectionInfo {
  vectorsCount: number;
  pointsCount: number;
  segmentsCount: number;
  status: string;
}

// ============================================
// QDRANT ADAPTER
// ============================================

export class QdrantAdapter {
  private client: QdrantClient;
  private collectionName: string;
  private vectorSize: number;
  private initialized = false;

  constructor(config: QdrantConfig) {
    this.client = new QdrantClient({
      url: config.url,
      apiKey: config.apiKey,
    });
    this.collectionName = config.collectionName || "neuro_memories";
    this.vectorSize = config.vectorSize || 1536;
  }

  /**
   * Initialize the collection with proper schema
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(
        (c) => c.name === this.collectionName
      );

      if (!exists) {
        await this.createCollection();
      }

      this.initialized = true;
      log.info({ collection: this.collectionName }, "Qdrant adapter initialized");
    } catch (error) {
      log.error({ error }, "Failed to initialize Qdrant adapter");
      throw error;
    }
  }

  /**
   * Create collection with indexed metadata fields
   */
  private async createCollection(): Promise<void> {
    await this.client.createCollection(this.collectionName, {
      vectors: {
        size: this.vectorSize,
        distance: "Cosine",
      },
      // Optimized for metadata filtering
      optimizers_config: {
        indexing_threshold: 10000,
      },
    });

    // Create payload indexes for efficient filtering
    await this.createPayloadIndexes();

    log.info({ collection: this.collectionName }, "Created vector collection");
  }

  /**
   * Create indexes on frequently queried metadata fields
   */
  private async createPayloadIndexes(): Promise<void> {
    const indexedFields = [
      { field: "sourceType", type: "keyword" as const },
      { field: "source", type: "keyword" as const },
      { field: "sentiment", type: "keyword" as const },
      { field: "language", type: "keyword" as const },
      { field: "timestamp", type: "datetime" as const },
    ];

    for (const { field, type } of indexedFields) {
      try {
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: field,
          field_schema: type,
        });
      } catch (error) {
        // Index might already exist
        log.debug({ field }, "Payload index creation skipped (may exist)");
      }
    }

    log.info("Created payload indexes for metadata filtering");
  }

  /**
   * Upsert vectors with metadata
   */
  async upsert(points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;

    await this.client.upsert(this.collectionName, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      })),
    });

    log.debug({ count: points.length }, "Upserted vectors");
  }

  /**
   * Search for similar vectors
   */
  async search(
    vector: number[],
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const {
      limit = 10,
      scoreThreshold = 0.0,
      filter,
      withPayload = true,
      withVector = false,
    } = options;

    const results = await this.client.search(this.collectionName, {
      vector,
      limit,
      score_threshold: scoreThreshold,
      filter,
      with_payload: withPayload,
      with_vector: withVector,
    });

    return results.map((r) => ({
      id: r.id as string,
      score: r.score,
      payload: r.payload as VectorMetadata & { content: string },
      vector: withVector ? (r.vector as number[]) : undefined,
    }));
  }

  /**
   * Check if a similar vector already exists (for deduplication)
   * 
   * Turkish: "Sadece Ingestion'da değil, vektör tabanında da benzerlik skoru
   * %99 olan içerikleri kaydederek hafızayı şişirme."
   */
  async findDuplicates(
    vector: number[],
    threshold: number = 0.99
  ): Promise<SearchResult[]> {
    const results = await this.search(vector, {
      limit: 5,
      scoreThreshold: threshold,
    });

    return results.filter((r) => r.score >= threshold);
  }

  /**
   * Delete vectors by IDs
   */
  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.client.delete(this.collectionName, {
      wait: true,
      points: ids,
    });

    log.debug({ count: ids.length }, "Deleted vectors");
  }

  /**
   * Delete vectors by filter
   */
  async deleteByFilter(filter: Schemas["Filter"]): Promise<void> {
    await this.client.delete(this.collectionName, {
      wait: true,
      filter,
    });

    log.debug({ filter }, "Deleted vectors by filter");
  }

  /**
   * Get collection info
   */
  async getCollectionInfo(): Promise<CollectionInfo> {
    const info = await this.client.getCollection(this.collectionName);
    
    return {
      vectorsCount: info.vectors_count || 0,
      pointsCount: info.points_count || 0,
      segmentsCount: info.segments_count || 0,
      status: info.status,
    };
  }

  /**
   * Get a specific vector by ID
   */
  async getById(id: string): Promise<SearchResult | null> {
    try {
      const points = await this.client.retrieve(this.collectionName, {
        ids: [id],
        with_payload: true,
        with_vector: true,
      });

      if (points.length === 0) return null;

      const point = points[0];
      return {
        id: point.id as string,
        score: 1.0,
        payload: point.payload as VectorMetadata & { content: string },
        vector: point.vector as number[],
      };
    } catch {
      return null;
    }
  }

  /**
   * Scroll through all points (for batch operations)
   */
  async scroll(
    options: {
      limit?: number;
      offset?: string | null;
      filter?: Schemas["Filter"];
    } = {}
  ): Promise<{
    points: SearchResult[];
    nextOffset: string | null;
  }> {
    const { limit = 100, offset = null, filter } = options;

    const result = await this.client.scroll(this.collectionName, {
      limit,
      offset: offset || undefined,
      filter,
      with_payload: true,
      with_vector: false,
    });

    return {
      points: result.points.map((p) => ({
        id: p.id as string,
        score: 1.0,
        payload: p.payload as VectorMetadata & { content: string },
      })),
      nextOffset: result.next_page_offset as string | null,
    };
  }

  /**
   * Count points matching a filter
   */
  async count(filter?: Schemas["Filter"]): Promise<number> {
    const result = await this.client.count(this.collectionName, {
      filter,
      exact: true,
    });

    return result.count;
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close connection (cleanup)
   */
  async close(): Promise<void> {
    // QdrantClient doesn't require explicit close
    log.info("Qdrant adapter closed");
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createQdrantAdapter(config: QdrantConfig): QdrantAdapter {
  return new QdrantAdapter(config);
}
