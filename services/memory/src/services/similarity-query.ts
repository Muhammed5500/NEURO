/**
 * Similarity Query Service
 * 
 * Implements "Given new item, find top K similar historical items"
 * Returns summary stats: avg price impact direction, time-to-impact distribution
 */

import { logger } from "@neuro/shared";
import type { QdrantAdapter, SearchResult, SearchOptions } from "../adapters/qdrant-adapter.js";
import type { IEmbeddingProvider } from "../providers/embedding-provider.js";
import type { VectorMetadata, QueryMetadata, QueryStats } from "../schemas/metadata.js";
import type { Schemas } from "@qdrant/js-client-rest";

const log = logger.child({ module: "similarity-query" });

// ============================================
// TYPES
// ============================================

export interface SimilarityQueryResult {
  query: string;
  results: SimilarItem[];
  stats: QueryStats;
  processingTimeMs: number;
}

export interface SimilarItem {
  id: string;
  score: number;
  content: string;
  metadata: VectorMetadata;
}

export interface SimilarityQueryOptions {
  limit?: number;
  minScore?: number;
  metadata?: QueryMetadata;
  includeStats?: boolean;
}

// ============================================
// SIMILARITY QUERY SERVICE
// ============================================

export class SimilarityQueryService {
  private adapter: QdrantAdapter;
  private embeddingProvider: IEmbeddingProvider;

  constructor(adapter: QdrantAdapter, embeddingProvider: IEmbeddingProvider) {
    this.adapter = adapter;
    this.embeddingProvider = embeddingProvider;
  }

  /**
   * Find top K similar items for a given query text
   */
  async findSimilar(
    query: string,
    options: SimilarityQueryOptions = {}
  ): Promise<SimilarityQueryResult> {
    const startTime = Date.now();
    const {
      limit = 10,
      minScore = 0.7,
      metadata,
      includeStats = true,
    } = options;

    // Generate embedding for query
    const embeddingResult = await this.embeddingProvider.embed(query);
    
    // Build filter from metadata
    const filter = metadata ? this.buildFilter(metadata) : undefined;

    // Search for similar vectors
    const searchResults = await this.adapter.search(embeddingResult.embedding, {
      limit,
      scoreThreshold: minScore,
      filter,
    });

    // Convert to SimilarItem format
    const results: SimilarItem[] = searchResults.map((r) => ({
      id: r.id,
      score: r.score,
      content: r.payload.content,
      metadata: r.payload as unknown as VectorMetadata,
    }));

    // Calculate statistics
    const stats = includeStats 
      ? this.calculateStats(results)
      : this.emptyStats(results.length);

    log.debug(
      { 
        query: query.substring(0, 50), 
        resultsCount: results.length,
        avgScore: stats.avgScore,
      },
      "Similarity query completed"
    );

    return {
      query,
      results,
      stats,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Find similar items for a given vector (bypass embedding generation)
   */
  async findSimilarByVector(
    vector: number[],
    options: SimilarityQueryOptions = {}
  ): Promise<Omit<SimilarityQueryResult, "query">> {
    const startTime = Date.now();
    const {
      limit = 10,
      minScore = 0.7,
      metadata,
      includeStats = true,
    } = options;

    const filter = metadata ? this.buildFilter(metadata) : undefined;

    const searchResults = await this.adapter.search(vector, {
      limit,
      scoreThreshold: minScore,
      filter,
    });

    const results: SimilarItem[] = searchResults.map((r) => ({
      id: r.id,
      score: r.score,
      content: r.payload.content,
      metadata: r.payload as unknown as VectorMetadata,
    }));

    const stats = includeStats 
      ? this.calculateStats(results)
      : this.emptyStats(results.length);

    return {
      results,
      stats,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Build Qdrant filter from QueryMetadata
   */
  private buildFilter(metadata: QueryMetadata): Schemas["Filter"] {
    const must: Schemas["Condition"][] = [];

    if (metadata.sourceType) {
      must.push({
        key: "sourceType",
        match: { value: metadata.sourceType },
      });
    }

    if (metadata.source) {
      must.push({
        key: "source",
        match: { value: metadata.source },
      });
    }

    if (metadata.contentType) {
      must.push({
        key: "contentType",
        match: { value: metadata.contentType },
      });
    }

    if (metadata.language) {
      must.push({
        key: "language",
        match: { value: metadata.language },
      });
    }

    if (metadata.sentiment) {
      must.push({
        key: "sentiment",
        match: { value: metadata.sentiment },
      });
    }

    if (metadata.category) {
      must.push({
        key: "category",
        match: { value: metadata.category },
      });
    }

    if (metadata.priority) {
      must.push({
        key: "priority",
        match: { value: metadata.priority },
      });
    }

    if (metadata.tickers && metadata.tickers.length > 0) {
      // Match any of the tickers
      must.push({
        key: "tickers",
        match: { any: metadata.tickers },
      });
    }

    if (metadata.tags && metadata.tags.length > 0) {
      must.push({
        key: "tags",
        match: { any: metadata.tags },
      });
    }

    // Time range filter
    if (metadata.timestampFrom || metadata.timestampTo) {
      const rangeCondition: any = { key: "timestamp" };
      if (metadata.timestampFrom) {
        rangeCondition.range = { ...rangeCondition.range, gte: metadata.timestampFrom };
      }
      if (metadata.timestampTo) {
        rangeCondition.range = { ...rangeCondition.range, lte: metadata.timestampTo };
      }
      must.push(rangeCondition);
    }

    // Market outcome filter
    if (metadata.hasMarketOutcome !== undefined) {
      must.push({
        key: "marketOutcome.labeled",
        match: { value: metadata.hasMarketOutcome },
      });
    }

    if (metadata.priceImpactDirection) {
      must.push({
        key: "marketOutcome.priceImpactDirection",
        match: { value: metadata.priceImpactDirection },
      });
    }

    return must.length > 0 ? { must } : {};
  }

  /**
   * Calculate query statistics from results
   */
  private calculateStats(results: SimilarItem[]): QueryStats {
    if (results.length === 0) {
      return this.emptyStats(0);
    }

    // Average score
    const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

    // Price impact statistics
    const labeledItems = results.filter((r) => r.metadata.marketOutcome?.labeled);
    const priceImpactStats = this.calculatePriceImpactStats(labeledItems);

    // Sentiment distribution
    const sentimentDistribution = this.calculateSentimentDistribution(results);

    // Time distribution
    const timeDistribution = this.calculateTimeDistribution(results);

    return {
      totalResults: results.length,
      avgScore,
      priceImpactStats,
      sentimentDistribution,
      timeDistribution,
    };
  }

  /**
   * Calculate price impact statistics
   */
  private calculatePriceImpactStats(labeledItems: SimilarItem[]): QueryStats["priceImpactStats"] {
    if (labeledItems.length === 0) {
      return {
        hasLabels: false,
        totalLabeled: 0,
        upCount: 0,
        downCount: 0,
        neutralCount: 0,
      };
    }

    let upCount = 0;
    let downCount = 0;
    let neutralCount = 0;
    let totalImpactPercent = 0;
    let totalTimeToImpact = 0;
    let impactCount = 0;
    let timeCount = 0;

    for (const item of labeledItems) {
      const outcome = item.metadata.marketOutcome;
      if (!outcome) continue;

      switch (outcome.priceImpactDirection) {
        case "up":
          upCount++;
          break;
        case "down":
          downCount++;
          break;
        case "neutral":
          neutralCount++;
          break;
      }

      if (outcome.priceImpactPercent !== undefined) {
        totalImpactPercent += outcome.priceImpactPercent;
        impactCount++;
      }

      if (outcome.timeToImpactMs !== undefined) {
        totalTimeToImpact += outcome.timeToImpactMs;
        timeCount++;
      }
    }

    return {
      hasLabels: true,
      totalLabeled: labeledItems.length,
      upCount,
      downCount,
      neutralCount,
      avgPriceImpactPercent: impactCount > 0 ? totalImpactPercent / impactCount : undefined,
      avgTimeToImpactMs: timeCount > 0 ? totalTimeToImpact / timeCount : undefined,
    };
  }

  /**
   * Calculate sentiment distribution
   */
  private calculateSentimentDistribution(results: SimilarItem[]): QueryStats["sentimentDistribution"] {
    let bullish = 0;
    let bearish = 0;
    let neutral = 0;

    for (const item of results) {
      switch (item.metadata.sentiment) {
        case "bullish":
          bullish++;
          break;
        case "bearish":
          bearish++;
          break;
        case "neutral":
          neutral++;
          break;
      }
    }

    return { bullish, bearish, neutral };
  }

  /**
   * Calculate time distribution
   */
  private calculateTimeDistribution(results: SimilarItem[]): QueryStats["timeDistribution"] {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * oneHour;
    const oneWeek = 7 * oneDay;

    let last1h = 0;
    let last24h = 0;
    let last7d = 0;
    let older = 0;

    for (const item of results) {
      const timestamp = new Date(item.metadata.timestamp).getTime();
      const age = now - timestamp;

      if (age <= oneHour) {
        last1h++;
      } else if (age <= oneDay) {
        last24h++;
      } else if (age <= oneWeek) {
        last7d++;
      } else {
        older++;
      }
    }

    return { last1h, last24h, last7d, older };
  }

  /**
   * Empty stats helper
   */
  private emptyStats(totalResults: number): QueryStats {
    return {
      totalResults,
      avgScore: 0,
    };
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createSimilarityQueryService(
  adapter: QdrantAdapter,
  embeddingProvider: IEmbeddingProvider
): SimilarityQueryService {
  return new SimilarityQueryService(adapter, embeddingProvider);
}
