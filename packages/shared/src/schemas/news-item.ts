/**
 * NewsItem Schema
 * Represents a news article or update from various sources
 * 
 * @version 1.0.0
 * @backward-compatibility
 * - v1.0.0: Initial schema
 */

import { z } from "zod";
import {
  createVersionedSchema,
  sentimentSchema,
  severitySchema,
  CURRENT_SCHEMA_VERSION,
} from "./common.js";

// ============================================
// SCHEMA DEFINITION
// ============================================

export const newsSourceSchema = z.enum([
  "twitter",
  "discord",
  "telegram",
  "reddit",
  "medium",
  "mirror",
  "rss",
  "api",
  "scraper",
  "other",
]);

export type NewsSource = z.infer<typeof newsSourceSchema>;

export const newsCategorySchema = z.enum([
  "market",
  "protocol",
  "regulatory",
  "technical",
  "social",
  "security",
  "partnership",
  "listing",
  "other",
]);

export type NewsCategory = z.infer<typeof newsCategorySchema>;

export const newsItemSchema = createVersionedSchema({
  // Content
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(50000),
  summary: z.string().max(1000).optional(),
  
  // Source information
  source: newsSourceSchema,
  sourceUrl: z.string().url().optional(),
  sourceId: z.string().optional(),
  author: z.string().optional(),
  
  // Classification
  category: newsCategorySchema,
  tags: z.array(z.string()).default([]),
  
  // Analysis
  sentiment: sentimentSchema.optional(),
  sentimentScore: z.number().min(-1).max(1).optional(),
  relevanceScore: z.number().min(0).max(1).optional(),
  importance: severitySchema.default("medium"),
  
  // Related entities
  mentionedTokens: z.array(z.string()).default([]),
  mentionedAddresses: z.array(z.string()).default([]),
  
  // Metadata
  language: z.string().default("en"),
  publishedAt: z.string().datetime(),
  fetchedAt: z.string().datetime(),
  
  // Processing status
  processed: z.boolean().default(false),
  embeddingId: z.string().uuid().optional(),
});

export type NewsItem = z.infer<typeof newsItemSchema>;

// ============================================
// FACTORY FUNCTIONS
// ============================================

export function createNewsItem(
  data: Omit<NewsItem, "id" | "schemaVersion" | "createdAt">
): NewsItem {
  return newsItemSchema.parse({
    ...data,
    id: crypto.randomUUID(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
  });
}

// ============================================
// EXAMPLES & FIXTURES
// ============================================

export const newsItemExamples: NewsItem[] = [
  {
    schemaVersion: "1.0.0",
    id: "550e8400-e29b-41d4-a716-446655440001",
    createdAt: "2024-01-15T10:30:00Z",
    title: "Monad Mainnet Launch Announcement",
    content: "The Monad team has announced the mainnet launch date for Q1 2024...",
    summary: "Monad mainnet launching Q1 2024",
    source: "twitter",
    sourceUrl: "https://twitter.com/moaborz/status/123456789",
    author: "moaborz",
    category: "protocol",
    tags: ["monad", "mainnet", "launch"],
    sentiment: "bullish",
    sentimentScore: 0.85,
    relevanceScore: 0.95,
    importance: "high",
    mentionedTokens: ["MON"],
    mentionedAddresses: [],
    language: "en",
    publishedAt: "2024-01-15T10:00:00Z",
    fetchedAt: "2024-01-15T10:30:00Z",
    processed: true,
    embeddingId: "550e8400-e29b-41d4-a716-446655440002",
  },
];
