/**
 * Vector Metadata Schema
 * 
 * Aligned with packages/shared Zod schemas for consistency.
 * 
 * Turkish: "Metadata alanlarının (tickers, sentiment, source) bizim
 * packages/shared içinde tanımladığımız Zod şemalarıyla birebir uyumlu
 * olduğundan emin ol."
 */

import { z } from "zod";
import {
  sentimentSchema,
  severitySchema,
  ingestionSourceTypeSchema,
  embeddingSourceTypeSchema,
  timestampSchema,
  uuidSchema,
  addressSchema,
} from "@neuro/shared";

// ============================================
// VECTOR METADATA SCHEMA
// ============================================

/**
 * Base metadata for all vector entries
 * Matches the shared schema types
 */
export const vectorMetadataSchema = z.object({
  // Source information (aligned with IngestionEvent)
  sourceType: embeddingSourceTypeSchema,
  source: z.string(), // Original source (e.g., "newsapi", "twitter")
  sourceId: uuidSchema.optional(), // Reference to original item
  sourceUrl: z.string().url().optional(),
  
  // Timestamps
  timestamp: timestampSchema, // When the original content was created
  indexedAt: timestampSchema, // When it was indexed in vector DB
  
  // Content classification
  contentType: z.enum([
    "news",
    "social",
    "market_analysis",
    "transaction",
    "agent_decision",
    "user_query",
    "document",
  ]),
  
  // Tokens/Tickers mentioned (aligned with NewsItem.mentionedTokens)
  tickers: z.array(z.string()).default([]),
  mentionedAddresses: z.array(addressSchema).default([]),
  
  // Language
  language: z.string().default("en"),
  
  // Sentiment analysis (aligned with common.ts sentimentSchema)
  sentiment: sentimentSchema.optional(),
  sentimentScore: z.number().min(-1).max(1).optional(),
  
  // Entity tags for retrieval
  entityTags: z.array(z.string()).default([]),
  
  // Category/Topic
  category: z.string().optional(),
  tags: z.array(z.string()).default([]),
  
  // Importance/Priority (aligned with severitySchema)
  priority: severitySchema.default("medium"),
  relevanceScore: z.number().min(0).max(1).optional(),
  
  // Quality metrics
  qualityScore: z.number().min(0).max(1).optional(),
  
  // Market outcome labels (for labeling pipeline)
  marketOutcome: z.object({
    labeled: z.boolean().default(false),
    labeledAt: timestampSchema.optional(),
    priceImpactDirection: z.enum(["up", "down", "neutral"]).optional(),
    priceImpactPercent: z.number().optional(),
    timeToImpactMs: z.number().int().optional(),
    confidenceScore: z.number().min(0).max(1).optional(),
  }).default({ labeled: false }),
  
  // Deduplication
  contentHash: z.string().optional(),
  isDuplicate: z.boolean().default(false),
  duplicateOf: uuidSchema.optional(),
  
  // Processing metadata
  embeddingModel: z.string(),
  embeddingProvider: z.enum(["openai", "local"]),
  processingTimeMs: z.number().int().optional(),
  
  // TTL for expiration
  expiresAt: timestampSchema.optional(),
});

export type VectorMetadata = z.infer<typeof vectorMetadataSchema>;

// ============================================
// QUERY METADATA SCHEMA
// ============================================

/**
 * Metadata schema for similarity queries
 */
export const queryMetadataSchema = z.object({
  sourceType: embeddingSourceTypeSchema.optional(),
  source: z.string().optional(),
  contentType: vectorMetadataSchema.shape.contentType.optional(),
  tickers: z.array(z.string()).optional(),
  language: z.string().optional(),
  sentiment: sentimentSchema.optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  priority: severitySchema.optional(),
  
  // Time range
  timestampFrom: timestampSchema.optional(),
  timestampTo: timestampSchema.optional(),
  
  // Market outcome filter
  hasMarketOutcome: z.boolean().optional(),
  priceImpactDirection: z.enum(["up", "down", "neutral"]).optional(),
});

export type QueryMetadata = z.infer<typeof queryMetadataSchema>;

// ============================================
// STATISTICS SCHEMA
// ============================================

/**
 * Schema for query result statistics
 */
export const queryStatsSchema = z.object({
  totalResults: z.number().int().min(0),
  avgScore: z.number().min(0).max(1),
  
  // Price impact statistics (if market labels exist)
  priceImpactStats: z.object({
    hasLabels: z.boolean(),
    totalLabeled: z.number().int(),
    upCount: z.number().int(),
    downCount: z.number().int(),
    neutralCount: z.number().int(),
    avgPriceImpactPercent: z.number().optional(),
    avgTimeToImpactMs: z.number().optional(),
  }).optional(),
  
  // Sentiment distribution
  sentimentDistribution: z.object({
    bullish: z.number().int(),
    bearish: z.number().int(),
    neutral: z.number().int(),
  }).optional(),
  
  // Time distribution
  timeDistribution: z.object({
    last1h: z.number().int(),
    last24h: z.number().int(),
    last7d: z.number().int(),
    older: z.number().int(),
  }).optional(),
});

export type QueryStats = z.infer<typeof queryStatsSchema>;

// ============================================
// FACTORY FUNCTIONS
// ============================================

/**
 * Create vector metadata from various source types
 */
export function createVectorMetadata(
  data: Partial<VectorMetadata> & Pick<VectorMetadata, 
    "sourceType" | "source" | "timestamp" | "contentType" | "embeddingModel" | "embeddingProvider"
  >
): VectorMetadata {
  return vectorMetadataSchema.parse({
    indexedAt: new Date().toISOString(),
    ...data,
  });
}

/**
 * Create metadata from NewsItem
 */
export function metadataFromNewsItem(newsItem: {
  id: string;
  source: string;
  sourceUrl?: string;
  publishedAt: string;
  mentionedTokens?: string[];
  language?: string;
  sentiment?: string;
  sentimentScore?: number;
  category?: string;
  tags?: string[];
  importance?: string;
  relevanceScore?: number;
}, embeddingInfo: { model: string; provider: "openai" | "local" }): Partial<VectorMetadata> {
  return {
    sourceType: "news_item",
    source: newsItem.source,
    sourceId: newsItem.id,
    sourceUrl: newsItem.sourceUrl,
    timestamp: newsItem.publishedAt,
    contentType: "news",
    tickers: newsItem.mentionedTokens || [],
    language: newsItem.language || "en",
    sentiment: newsItem.sentiment as any,
    sentimentScore: newsItem.sentimentScore,
    category: newsItem.category,
    tags: newsItem.tags || [],
    priority: newsItem.importance as any || "medium",
    relevanceScore: newsItem.relevanceScore,
    embeddingModel: embeddingInfo.model,
    embeddingProvider: embeddingInfo.provider,
  };
}

/**
 * Create metadata from SocialSignal
 */
export function metadataFromSocialSignal(signal: {
  id: string;
  platform: string;
  contentUrl?: string;
  postedAt: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  sentiment?: string;
  sentimentScore?: number;
  signalStrength?: number;
  isInfluencer?: boolean;
}, embeddingInfo: { model: string; provider: "openai" | "local" }): Partial<VectorMetadata> {
  return {
    sourceType: "social_signal",
    source: signal.platform,
    sourceId: signal.id,
    sourceUrl: signal.contentUrl,
    timestamp: signal.postedAt,
    contentType: "social",
    tickers: signal.tokenSymbol ? [signal.tokenSymbol] : [],
    mentionedAddresses: signal.tokenAddress ? [signal.tokenAddress] : [],
    sentiment: signal.sentiment as any,
    sentimentScore: signal.sentimentScore,
    priority: signal.isInfluencer ? "high" : "medium",
    relevanceScore: signal.signalStrength,
    embeddingModel: embeddingInfo.model,
    embeddingProvider: embeddingInfo.provider,
  };
}

/**
 * Create metadata from IngestionEvent
 */
export function metadataFromIngestionEvent(event: {
  id: string;
  sourceType: string;
  sourceName: string;
  sourceUrl?: string;
  dataType: string;
  dataTimestamp?: string;
  priority?: string;
  payload?: Record<string, unknown>;
}, embeddingInfo: { model: string; provider: "openai" | "local" }): Partial<VectorMetadata> {
  // Extract tickers from payload if available
  const tickers: string[] = [];
  if (event.payload?.tokenSymbol) {
    tickers.push(event.payload.tokenSymbol as string);
  }
  if (event.payload?.tokens && Array.isArray(event.payload.tokens)) {
    for (const token of event.payload.tokens) {
      if (typeof token === "object" && token && "symbol" in token) {
        tickers.push((token as any).symbol);
      }
    }
  }

  // Map dataType to contentType
  const contentTypeMap: Record<string, VectorMetadata["contentType"]> = {
    news: "news",
    social: "social",
    market_data: "market_analysis",
    transaction: "transaction",
  };

  return {
    sourceType: event.sourceType as any,
    source: event.sourceName,
    sourceId: event.id,
    sourceUrl: event.sourceUrl,
    timestamp: event.dataTimestamp || new Date().toISOString(),
    contentType: contentTypeMap[event.dataType] || "document",
    tickers,
    priority: event.priority as any || "medium",
    embeddingModel: embeddingInfo.model,
    embeddingProvider: embeddingInfo.provider,
  };
}
