/**
 * SocialSignal Schema
 * Represents social media signals and engagement metrics
 * 
 * @version 1.0.0
 * @backward-compatibility
 * - v1.0.0: Initial schema
 */

import { z } from "zod";
import {
  createVersionedSchema,
  sentimentSchema,
  addressSchema,
  CURRENT_SCHEMA_VERSION,
} from "./common.js";

// ============================================
// SCHEMA DEFINITION
// ============================================

export const socialPlatformSchema = z.enum([
  "twitter",
  "discord",
  "telegram",
  "reddit",
  "farcaster",
  "lens",
  "other",
]);

export type SocialPlatform = z.infer<typeof socialPlatformSchema>;

export const signalTypeSchema = z.enum([
  "mention",
  "post",
  "comment",
  "retweet",
  "like",
  "follow",
  "whale_activity",
  "influencer_mention",
  "trending",
  "sentiment_shift",
]);

export type SignalType = z.infer<typeof signalTypeSchema>;

export const socialSignalSchema = createVersionedSchema({
  // Platform info
  platform: socialPlatformSchema,
  signalType: signalTypeSchema,
  
  // Content
  content: z.string().max(10000).optional(),
  contentUrl: z.string().url().optional(),
  
  // Author info
  authorId: z.string(),
  authorUsername: z.string().optional(),
  authorFollowers: z.number().int().min(0).optional(),
  authorVerified: z.boolean().default(false),
  isInfluencer: z.boolean().default(false),
  influencerTier: z.enum(["micro", "mid", "macro", "mega"]).optional(),
  
  // Engagement metrics
  likes: z.number().int().min(0).default(0),
  retweets: z.number().int().min(0).default(0),
  replies: z.number().int().min(0).default(0),
  views: z.number().int().min(0).optional(),
  engagementRate: z.number().min(0).max(100).optional(),
  
  // Token/Address context
  tokenAddress: addressSchema.optional(),
  tokenSymbol: z.string().optional(),
  mentionedAddresses: z.array(addressSchema).default([]),
  
  // Analysis
  sentiment: sentimentSchema.optional(),
  sentimentScore: z.number().min(-1).max(1).optional(),
  relevanceScore: z.number().min(0).max(1).optional(),
  
  // Metrics
  signalStrength: z.number().min(0).max(1).default(0.5),
  confidence: z.number().min(0).max(1).default(0.5),
  
  // Timing
  postedAt: z.string().datetime(),
  fetchedAt: z.string().datetime(),
  
  // Processing
  processed: z.boolean().default(false),
  embeddingId: z.string().uuid().optional(),
});

export type SocialSignal = z.infer<typeof socialSignalSchema>;

// ============================================
// FACTORY FUNCTIONS
// ============================================

export function createSocialSignal(
  data: Omit<SocialSignal, "id" | "schemaVersion" | "createdAt">
): SocialSignal {
  return socialSignalSchema.parse({
    ...data,
    id: crypto.randomUUID(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
  });
}

// ============================================
// EXAMPLES & FIXTURES
// ============================================

export const socialSignalExamples: SocialSignal[] = [
  {
    schemaVersion: "1.0.0",
    id: "550e8400-e29b-41d4-a716-446655440010",
    createdAt: "2024-01-15T11:00:00Z",
    platform: "twitter",
    signalType: "influencer_mention",
    content: "Just aped into $PEPE on nad.fun 🚀 This is going to be huge!",
    contentUrl: "https://twitter.com/cryptoinfluencer/status/987654321",
    authorId: "12345678",
    authorUsername: "cryptoinfluencer",
    authorFollowers: 500000,
    authorVerified: true,
    isInfluencer: true,
    influencerTier: "macro",
    likes: 5000,
    retweets: 1200,
    replies: 300,
    views: 150000,
    engagementRate: 4.3,
    tokenAddress: "0x1234567890123456789012345678901234567890",
    tokenSymbol: "PEPE",
    mentionedAddresses: [],
    sentiment: "bullish",
    sentimentScore: 0.92,
    relevanceScore: 0.88,
    signalStrength: 0.85,
    confidence: 0.78,
    postedAt: "2024-01-15T10:45:00Z",
    fetchedAt: "2024-01-15T11:00:00Z",
    processed: true,
    embeddingId: "550e8400-e29b-41d4-a716-446655440011",
  },
];
