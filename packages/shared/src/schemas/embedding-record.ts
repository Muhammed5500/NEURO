/**
 * EmbeddingRecord Schema
 * Represents vector embeddings for AI memory
 * 
 * @version 1.0.0
 * @backward-compatibility
 * - v1.0.0: Initial schema
 */

import { z } from "zod";
import {
  createVersionedSchema,
  uuidSchema,
  CURRENT_SCHEMA_VERSION,
} from "./common.js";

// ============================================
// SCHEMA DEFINITION
// ============================================

export const embeddingSourceTypeSchema = z.enum([
  "news_item",
  "social_signal",
  "market_analysis",
  "agent_decision",
  "transaction",
  "user_query",
  "document",
  "custom",
]);

export type EmbeddingSourceType = z.infer<typeof embeddingSourceTypeSchema>;

export const embeddingModelSchema = z.enum([
  "text-embedding-ada-002",
  "text-embedding-3-small",
  "text-embedding-3-large",
  "custom",
]);

export type EmbeddingModel = z.infer<typeof embeddingModelSchema>;

export const embeddingRecordSchema = createVersionedSchema({
  // Source reference
  sourceType: embeddingSourceTypeSchema,
  sourceId: uuidSchema,
  
  // Content
  content: z.string().min(1).max(100000),
  contentHash: z.string(),
  contentLength: z.number().int().min(1),
  
  // Embedding
  embedding: z.array(z.number()).min(1),
  embeddingDimension: z.number().int().positive(),
  embeddingModel: embeddingModelSchema,
  embeddingModelVersion: z.string().optional(),
  
  // Vector store info
  vectorStoreId: z.string().optional(),
  collectionName: z.string().default("neuro_memories"),
  
  // Metadata for retrieval
  metadata: z.record(z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
  
  // Chunking info (if content was chunked)
  isChunked: z.boolean().default(false),
  chunkIndex: z.number().int().min(0).optional(),
  totalChunks: z.number().int().min(1).optional(),
  parentId: uuidSchema.optional(),
  
  // Quality
  tokenCount: z.number().int().min(1).optional(),
  qualityScore: z.number().min(0).max(1).optional(),
  
  // TTL
  expiresAt: z.string().datetime().optional(),
  
  // Processing
  generatedAt: z.string().datetime(),
  processingTimeMs: z.number().int().min(0).optional(),
});

export type EmbeddingRecord = z.infer<typeof embeddingRecordSchema>;

// ============================================
// FACTORY FUNCTIONS
// ============================================

export function createEmbeddingRecord(
  data: Omit<EmbeddingRecord, "id" | "schemaVersion" | "createdAt">
): EmbeddingRecord {
  return embeddingRecordSchema.parse({
    ...data,
    id: crypto.randomUUID(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
  });
}

// ============================================
// EXAMPLES & FIXTURES
// ============================================

// Note: Embedding array truncated for readability
export const embeddingRecordExamples: EmbeddingRecord[] = [
  {
    schemaVersion: "1.0.0",
    id: "550e8400-e29b-41d4-a716-446655440030",
    createdAt: "2024-01-15T13:00:00Z",
    sourceType: "news_item",
    sourceId: "550e8400-e29b-41d4-a716-446655440001",
    content: "Monad mainnet launch announcement with expected high throughput...",
    contentHash: "sha256:abcdef1234567890",
    contentLength: 500,
    embedding: [0.1, 0.2, 0.3, 0.4, 0.5], // Truncated for example
    embeddingDimension: 1536,
    embeddingModel: "text-embedding-ada-002",
    embeddingModelVersion: "2024-01",
    vectorStoreId: "qdrant-main",
    collectionName: "neuro_memories",
    metadata: {
      category: "protocol",
      importance: "high",
    },
    tags: ["monad", "mainnet", "launch"],
    isChunked: false,
    tokenCount: 125,
    qualityScore: 0.95,
    generatedAt: "2024-01-15T13:00:00Z",
    processingTimeMs: 250,
  },
];
