/**
 * IngestionEvent Schema
 * Represents data ingestion events from various sources
 * 
 * @version 1.0.0
 * @backward-compatibility
 * - v1.0.0: Initial schema
 */

import { z } from "zod";
import {
  createVersionedSchema,
  statusSchema,
  severitySchema,
  CURRENT_SCHEMA_VERSION,
} from "./common.js";

// ============================================
// SCHEMA DEFINITION
// ============================================

export const ingestionSourceTypeSchema = z.enum([
  "nadfun_api",
  "monad_rpc",
  "social_api",
  "news_api",
  "websocket",
  "webhook",
  "scraper",
  "manual",
]);

export type IngestionSourceType = z.infer<typeof ingestionSourceTypeSchema>;

export const ingestionDataTypeSchema = z.enum([
  "token_data",
  "market_data",
  "transaction",
  "block",
  "news",
  "social",
  "price",
  "liquidity",
  "holder_data",
  "contract_event",
]);

export type IngestionDataType = z.infer<typeof ingestionDataTypeSchema>;

export const ingestionEventSchema = createVersionedSchema({
  // Source information
  sourceType: ingestionSourceTypeSchema,
  sourceId: z.string(),
  sourceName: z.string(),
  sourceUrl: z.string().url().optional(),
  
  // Data classification
  dataType: ingestionDataTypeSchema,
  dataSubtype: z.string().optional(),
  
  // Payload
  payload: z.record(z.unknown()),
  payloadSize: z.number().int().min(0),
  payloadHash: z.string().optional(),
  
  // Processing
  status: statusSchema,
  processingStartedAt: z.string().datetime().optional(),
  processingCompletedAt: z.string().datetime().optional(),
  processingDurationMs: z.number().int().min(0).optional(),
  
  // Error handling
  errorMessage: z.string().optional(),
  errorCode: z.string().optional(),
  retryCount: z.number().int().min(0).default(0),
  maxRetries: z.number().int().min(0).default(3),
  
  // Quality metrics
  dataQualityScore: z.number().min(0).max(1).optional(),
  isValid: z.boolean().default(true),
  validationErrors: z.array(z.string()).default([]),
  
  // Priority
  priority: severitySchema.default("medium"),
  
  // Deduplication
  deduplicationKey: z.string().optional(),
  isDuplicate: z.boolean().default(false),
  
  // Batch info
  batchId: z.string().uuid().optional(),
  batchIndex: z.number().int().min(0).optional(),
  
  // Timestamps
  ingestedAt: z.string().datetime(),
  dataTimestamp: z.string().datetime().optional(),
});

export type IngestionEvent = z.infer<typeof ingestionEventSchema>;

// ============================================
// FACTORY FUNCTIONS
// ============================================

export function createIngestionEvent(
  data: Omit<IngestionEvent, "id" | "schemaVersion" | "createdAt">
): IngestionEvent {
  return ingestionEventSchema.parse({
    ...data,
    id: crypto.randomUUID(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
  });
}

// ============================================
// EXAMPLES & FIXTURES
// ============================================

export const ingestionEventExamples: IngestionEvent[] = [
  {
    schemaVersion: "1.0.0",
    id: "550e8400-e29b-41d4-a716-446655440020",
    createdAt: "2024-01-15T12:00:00Z",
    sourceType: "nadfun_api",
    sourceId: "nadfun-trending",
    sourceName: "nad.fun Trending API",
    sourceUrl: "https://api.nadapp.net/api/v1/market/trending",
    dataType: "market_data",
    dataSubtype: "trending_tokens",
    payload: {
      tokens: [
        { symbol: "PEPE", price: 0.00001234, volume24h: 125000 },
        { symbol: "DOGE", price: 0.00005678, volume24h: 89000 },
      ],
    },
    payloadSize: 256,
    payloadHash: "0xabcdef1234567890",
    status: "completed",
    processingStartedAt: "2024-01-15T12:00:00Z",
    processingCompletedAt: "2024-01-15T12:00:01Z",
    processingDurationMs: 1000,
    retryCount: 0,
    maxRetries: 3,
    dataQualityScore: 0.98,
    isValid: true,
    validationErrors: [],
    priority: "high",
    isDuplicate: false,
    ingestedAt: "2024-01-15T12:00:00Z",
    dataTimestamp: "2024-01-15T11:59:55Z",
  },
];
