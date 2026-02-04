/**
 * Memory Client
 * 
 * Client for querying the Qdrant-based Memory Service.
 * Retrieves similar historical events for context.
 * 
 * Turkish: "Qdrant vektör veritabanından benzer geçmiş olayları çek"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { MemorySimilarity } from "../graph/state.js";
import { ConnectionError } from "./ingestion-bridge.js";

const memoryLogger = logger.child({ component: "memory-client" });

// ============================================
// TYPES
// ============================================

export interface MemoryClientConfig {
  qdrantUrl: string;
  qdrantApiKey?: string;
  collectionName?: string;
  openaiApiKey?: string;
  embeddingModel?: string;
  timeout?: number;
}

interface QdrantSearchResult {
  id: string;
  score: number;
  payload: {
    content: string;
    source: string;
    timestamp: string;
    marketOutcome?: {
      labeled: boolean;
      priceImpactDirection?: "up" | "down" | "neutral";
      priceImpactPercent?: number;
      timeToImpactMs?: number;
    };
    [key: string]: unknown;
  };
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

// ============================================
// MEMORY CLIENT
// ============================================

export class MemoryClient {
  private config: Required<MemoryClientConfig>;
  private healthy = false;

  constructor(config: MemoryClientConfig) {
    this.config = {
      qdrantUrl: config.qdrantUrl,
      qdrantApiKey: config.qdrantApiKey || "",
      collectionName: config.collectionName || "neuro_memories",
      openaiApiKey: config.openaiApiKey || "",
      embeddingModel: config.embeddingModel || "text-embedding-ada-002",
      timeout: config.timeout || 10000,
    };
  }

  /**
   * Initialize and verify connection
   */
  async initialize(): Promise<void> {
    try {
      // Check Qdrant health
      const response = await this.fetch(`${this.config.qdrantUrl}/healthz`);
      
      if (!response.ok) {
        throw new Error(`Qdrant health check failed: ${response.status}`);
      }

      // Check collection exists
      const collectionResponse = await this.fetch(
        `${this.config.qdrantUrl}/collections/${this.config.collectionName}`
      );

      if (!collectionResponse.ok && collectionResponse.status !== 404) {
        throw new Error(`Failed to check collection: ${collectionResponse.status}`);
      }

      this.healthy = true;
      memoryLogger.info(
        { qdrantUrl: this.config.qdrantUrl, collection: this.config.collectionName },
        "Memory client initialized"
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.healthy = false;
      throw new ConnectionError(
        "MEMORY_CLIENT",
        "QDRANT_CONNECTION_FAILED",
        `Failed to connect to Qdrant: ${error.message}`,
        error
      );
    }
  }

  /**
   * Find similar memories for a query
   */
  async findSimilar(
    query: string,
    options: {
      limit?: number;
      minScore?: number;
      filter?: Record<string, unknown>;
    } = {}
  ): Promise<MemorySimilarity[]> {
    const { limit = 5, minScore = 0.7, filter } = options;

    if (!this.healthy) {
      throw new ConnectionError(
        "MEMORY_CLIENT",
        "NOT_INITIALIZED",
        "Memory client not initialized. Call initialize() first."
      );
    }

    try {
      // Get embedding for query
      const embedding = await this.getEmbedding(query);

      // Search Qdrant
      const searchResponse = await this.fetch(
        `${this.config.qdrantUrl}/collections/${this.config.collectionName}/points/search`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vector: embedding,
            limit,
            score_threshold: minScore,
            with_payload: true,
            filter: filter ? { must: this.buildFilter(filter) } : undefined,
          }),
        }
      );

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        throw new Error(`Qdrant search failed: ${searchResponse.status} - ${errorText}`);
      }

      const data = await searchResponse.json() as { result: QdrantSearchResult[] };
      
      // Convert to MemorySimilarity format
      return data.result.map((r) => this.convertToMemorySimilarity(r));
    } catch (err) {
      if (err instanceof ConnectionError) throw err;
      
      const error = err instanceof Error ? err : new Error(String(err));
      memoryLogger.error({ error, query }, "Failed to find similar memories");
      throw new ConnectionError(
        "MEMORY_CLIENT",
        "SEARCH_FAILED",
        `Failed to search memories: ${error.message}`,
        error
      );
    }
  }

  /**
   * Find similar memories for news context
   */
  async findSimilarForNews(
    newsTitle: string,
    newsContent: string,
    tickers: string[],
    limit = 5
  ): Promise<MemorySimilarity[]> {
    // Combine title and content for better context
    const query = `${newsTitle}\n\n${newsContent.slice(0, 500)}`;

    // Filter by tickers if available
    const filter = tickers.length > 0 
      ? { tickers: { $in: tickers } }
      : undefined;

    return this.findSimilar(query, { limit, filter });
  }

  /**
   * Find similar memories for social context
   */
  async findSimilarForSocial(
    content: string,
    tickers: string[],
    limit = 3
  ): Promise<MemorySimilarity[]> {
    const filter = tickers.length > 0 
      ? { tickers: { $in: tickers } }
      : undefined;

    return this.findSimilar(content, { limit, filter });
  }

  /**
   * Check if client is healthy
   */
  async isHealthy(): Promise<boolean> {
    if (!this.healthy) return false;

    try {
      const response = await this.fetch(`${this.config.qdrantUrl}/healthz`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      this.healthy = false;
      return false;
    }
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private async getEmbedding(text: string): Promise<number[]> {
    if (!this.config.openaiApiKey) {
      throw new ConnectionError(
        "MEMORY_CLIENT",
        "NO_EMBEDDING_KEY",
        "OpenAI API key not configured for embeddings"
      );
    }

    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: this.config.embeddingModel,
          input: text.slice(0, 8000), // Limit text length
        }),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as EmbeddingResponse;
      return data.data[0].embedding;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new ConnectionError(
        "MEMORY_CLIENT",
        "EMBEDDING_FAILED",
        `Failed to get embedding: ${error.message}`,
        error
      );
    }
  }

  private convertToMemorySimilarity(result: QdrantSearchResult): MemorySimilarity {
    const outcome = result.payload.marketOutcome;

    return {
      id: String(result.id),
      score: result.score,
      content: result.payload.content || "",
      source: result.payload.source || "unknown",
      timestamp: result.payload.timestamp || new Date().toISOString(),
      marketOutcome: outcome?.labeled
        ? {
            priceImpactDirection: outcome.priceImpactDirection || "neutral",
            priceImpactPercent: outcome.priceImpactPercent || 0,
            timeToImpactMs: outcome.timeToImpactMs || 0,
          }
        : undefined,
    };
  }

  private buildFilter(filter: Record<string, unknown>): Array<Record<string, unknown>> {
    const conditions: Array<Record<string, unknown>> = [];

    for (const [key, value] of Object.entries(filter)) {
      if (typeof value === "object" && value !== null) {
        // Handle operators like $in
        const op = value as Record<string, unknown>;
        if ("$in" in op) {
          conditions.push({
            key,
            match: { any: op.$in },
          });
        }
      } else {
        conditions.push({
          key,
          match: { value },
        });
      }
    }

    return conditions;
  }

  private async fetch(url: string, options?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      ...(options?.headers as Record<string, string>),
    };

    if (this.config.qdrantApiKey) {
      headers["api-key"] = this.config.qdrantApiKey;
    }

    return fetch(url, {
      ...options,
      headers,
      signal: options?.signal || AbortSignal.timeout(this.config.timeout),
    });
  }
}

// ============================================
// FACTORY
// ============================================

export function createMemoryClient(config: MemoryClientConfig): MemoryClient {
  return new MemoryClient(config);
}
