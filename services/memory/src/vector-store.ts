/**
 * Qdrant Vector Store Adapter
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import { logger } from "@neuro/shared";

const memoryLogger = logger.child({ service: "memory" });

export interface VectorDocument {
  id: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export interface SearchResult {
  id: string;
  score: number;
  content: string;
  metadata: Record<string, unknown>;
}

export interface VectorStoreConfig {
  url: string;
  apiKey?: string;
  collectionName?: string;
}

export class VectorStore {
  private client: QdrantClient;
  private collectionName: string;
  private readonly vectorSize = 1536; // OpenAI ada-002 dimensions

  constructor(config: VectorStoreConfig) {
    this.client = new QdrantClient({
      url: config.url,
      apiKey: config.apiKey,
    });
    this.collectionName = config.collectionName || "neuro_memories";
  }

  async initialize(): Promise<void> {
    try {
      // Check if collection exists
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(
        (c) => c.name === this.collectionName
      );

      if (!exists) {
        // Create collection
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: this.vectorSize,
            distance: "Cosine",
          },
        });
        memoryLogger.info({ collection: this.collectionName }, "Created vector collection");
      }

      memoryLogger.info({ collection: this.collectionName }, "Vector store initialized");
    } catch (error) {
      memoryLogger.error({ error }, "Failed to initialize vector store");
      throw error;
    }
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    if (documents.length === 0) return;

    const points = documents.map((doc) => ({
      id: doc.id,
      vector: doc.embedding!,
      payload: {
        content: doc.content,
        ...doc.metadata,
        timestamp: doc.timestamp.toISOString(),
      },
    }));

    await this.client.upsert(this.collectionName, {
      wait: true,
      points,
    });

    memoryLogger.debug({ count: documents.length }, "Upserted documents");
  }

  async search(
    embedding: number[],
    limit: number = 10,
    filter?: Record<string, unknown>
  ): Promise<SearchResult[]> {
    const results = await this.client.search(this.collectionName, {
      vector: embedding,
      limit,
      with_payload: true,
      filter: filter as any,
    });

    return results.map((result) => ({
      id: result.id as string,
      score: result.score,
      content: (result.payload?.content as string) || "",
      metadata: result.payload as Record<string, unknown>,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    await this.client.delete(this.collectionName, {
      wait: true,
      points: ids,
    });
  }

  async getCollectionInfo(): Promise<{
    vectorsCount: number;
    pointsCount: number;
  }> {
    const info = await this.client.getCollection(this.collectionName);
    return {
      vectorsCount: info.vectors_count || 0,
      pointsCount: info.points_count || 0,
    };
  }
}
