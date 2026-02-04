/**
 * Metadata Pipeline Types
 * 
 * Types for token metadata management with:
 * - Content-addressable integrity (SHA-256)
 * - Milestone-based triggers
 * - JSON Patch diffs (RFC 6902)
 * - Multi-provider IPFS pinning
 */

import { z } from "zod";

// ============================================
// TOKEN METADATA SCHEMA
// ============================================

/**
 * ERC-721/ERC-1155 compatible metadata schema
 */
export const tokenMetadataSchema = z.object({
  // Core fields
  name: z.string(),
  symbol: z.string(),
  description: z.string(),
  
  // Media
  image: z.string().url().optional(),
  animation_url: z.string().url().optional(),
  external_url: z.string().url().optional(),
  
  // Attributes (OpenSea standard)
  attributes: z.array(z.object({
    trait_type: z.string(),
    value: z.union([z.string(), z.number()]),
    display_type: z.enum(["number", "boost_number", "boost_percentage", "date"]).optional(),
  })).optional(),
  
  // Extended fields for NEURO
  neuro: z.object({
    // Token info
    tokenAddress: z.string(),
    chainId: z.number(),
    createdAt: z.string(),
    
    // Creator info
    creatorAddress: z.string().optional(),
    
    // Launch status
    status: z.enum(["pending", "active", "graduated", "failed"]),
    graduatedAt: z.string().optional(),
    
    // On-chain metrics at snapshot
    poolFillPercent: z.number().optional(),
    holderCount: z.number().optional(),
    totalVolume: z.string().optional(),
    
    // NEURO analysis
    analysisConfidence: z.number().optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
  
  // Content-addressable integrity
  // Turkish: "SHA-256 hash'ini al ve metadata'nın içine bir integrity alanı olarak ekle"
  integrity: z.object({
    algorithm: z.literal("sha256"),
    hash: z.string(),
    computedAt: z.string(),
  }).optional(),
  
  // Version info
  version: z.number().int().min(1),
  previousCid: z.string().optional(),
});

export type TokenMetadata = z.infer<typeof tokenMetadataSchema>;

// ============================================
// IPFS TYPES
// ============================================

/**
 * IPFS CID (Content Identifier)
 */
export interface IpfsCid {
  cid: string;
  version: 0 | 1;
  codec: string;
}

/**
 * Pin result from a single provider
 */
export interface PinResult {
  success: boolean;
  provider: string;
  cid?: string;
  error?: string;
  timestamp: number;
  responseTimeMs: number;
}

/**
 * Multi-provider pin result
 * Turkish: "birden fazla pinning servisini destekleyen bir MultiPinProvider"
 */
export interface MultiPinResult {
  cid: string;
  results: PinResult[];
  successCount: number;
  totalProviders: number;
  allSucceeded: boolean;
}

/**
 * IPFS provider capabilities
 */
export interface IpfsProviderCapabilities {
  supportsPin: boolean;
  supportsUnpin: boolean;
  supportsListPins: boolean;
  supportsGateway: boolean;
  maxFileSize: number;
  rateLimitPerMinute: number;
}

// ============================================
// MILESTONE TRIGGER TYPES
// ============================================

/**
 * Milestone events that can trigger metadata refresh
 * Turkish: "on-chain olaylara bağla"
 */
export type MilestoneEventType =
  | "pool_fill_threshold"     // Pool reaches X% fill
  | "holder_count_threshold"  // Holder count reaches X
  | "volume_threshold"        // 24h volume reaches X
  | "token_graduated"         // Token graduates from bonding curve
  | "price_milestone"         // Price reaches milestone
  | "time_elapsed"            // Time-based refresh
  | "manual_request";         // Manual update request

/**
 * Milestone event definition
 */
export interface MilestoneEvent {
  type: MilestoneEventType;
  tokenAddress: string;
  chainId: number;
  
  // Threshold that was crossed
  threshold?: number;
  currentValue?: number;
  
  // What to update
  updateFields: MetadataUpdateField[];
  
  // Event metadata
  blockNumber?: number;
  txHash?: string;
  timestamp: number;
}

/**
 * Fields that can be updated on milestone
 */
export type MetadataUpdateField =
  | "description"
  | "external_url"
  | "attributes"
  | "status"
  | "image"
  | "animation_url";

/**
 * Milestone configuration
 * Turkish: "Havuzun %50 doluluğa ulaşması -> description güncellemesi"
 */
export interface MilestoneConfig {
  type: MilestoneEventType;
  threshold?: number;
  updateFields: MetadataUpdateField[];
  descriptionTemplate?: string;
  enabled: boolean;
}

// ============================================
// VERSION HISTORY TYPES
// ============================================

/**
 * JSON Patch operation (RFC 6902)
 * Turkish: "JSON Patch (RFC 6902) formatında sakla"
 */
export interface JsonPatchOperation {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  value?: unknown;
  from?: string;
}

/**
 * Metadata version record
 */
export interface MetadataVersion {
  version: number;
  cid: string;
  
  // Content hash for integrity
  contentHash: string;
  
  // Diff from previous version
  // Turkish: "eski versiyon ile yeni versiyon arasındaki farkı sakla"
  diff?: JsonPatchOperation[];
  previousVersion?: number;
  previousCid?: string;
  
  // Trigger info
  triggeredBy: MilestoneEventType;
  milestoneEvent?: MilestoneEvent;
  
  // Timestamps
  createdAt: number;
  pinnedAt?: number;
  
  // Pin status
  pinResults?: PinResult[];
}

/**
 * Version history for a token
 */
export interface MetadataHistory {
  tokenAddress: string;
  chainId: number;
  
  currentVersion: number;
  currentCid: string;
  
  versions: MetadataVersion[];
  
  // Stats
  totalUpdates: number;
  lastUpdatedAt: number;
}

// ============================================
// RATE LIMITING TYPES
// ============================================

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  // Per-token limits
  maxUpdatesPerHour: number;
  maxUpdatesPerDay: number;
  
  // Global limits
  globalMaxUpdatesPerMinute: number;
  
  // Cooldown
  minSecondsBetweenUpdates: number;
}

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  
  // Current usage
  updatesThisHour: number;
  updatesThisDay: number;
  
  // Retry info
  retryAfterSeconds?: number;
}

// ============================================
// AUDIT TYPES
// ============================================

/**
 * Metadata update audit entry
 */
export interface MetadataAuditEntry {
  id: string;
  tokenAddress: string;
  chainId: number;
  
  // Version info
  fromVersion: number;
  toVersion: number;
  fromCid?: string;
  toCid: string;
  
  // What changed
  // Turkish: "'NEURO neyi değiştirdi?' sorusuna net cevap"
  diff: JsonPatchOperation[];
  changedFields: string[];
  
  // Trigger
  triggeredBy: MilestoneEventType;
  milestoneEvent?: MilestoneEvent;
  
  // Rate limiting
  rateLimitCheck: RateLimitResult;
  
  // Timing
  requestedAt: number;
  completedAt: number;
  durationMs: number;
  
  // Pin results
  pinResults: PinResult[];
}

// ============================================
// ERROR TYPES
// ============================================

export class MetadataValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[]
  ) {
    super(message);
    this.name = "MetadataValidationError";
  }
}

export class IpfsPinError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cid?: string
  ) {
    super(message);
    this.name = "IpfsPinError";
  }
}

export class RateLimitExceededError extends Error {
  constructor(
    message: string,
    public readonly tokenAddress: string,
    public readonly retryAfterSeconds: number
  ) {
    super(message);
    this.name = "RateLimitExceededError";
  }
}

// ============================================
// DEFAULT CONFIGURATIONS
// ============================================

/**
 * Default milestone configurations
 * Turkish: Examples from requirements
 */
export const DEFAULT_MILESTONE_CONFIGS: MilestoneConfig[] = [
  {
    // Turkish: "Havuzun %50 doluluğa ulaşması -> description güncellemesi"
    type: "pool_fill_threshold",
    threshold: 50,
    updateFields: ["description", "attributes"],
    descriptionTemplate: "🎉 Pool is now {percent}% filled! Getting closer to graduation.",
    enabled: true,
  },
  {
    type: "pool_fill_threshold",
    threshold: 75,
    updateFields: ["description", "attributes"],
    descriptionTemplate: "🔥 Pool is {percent}% filled! Graduation approaching.",
    enabled: true,
  },
  {
    type: "pool_fill_threshold",
    threshold: 100,
    updateFields: ["description", "attributes", "status"],
    descriptionTemplate: "✅ Pool is fully funded! Awaiting graduation.",
    enabled: true,
  },
  {
    // Turkish: "Tokenın mezun olması -> external_url eklenmesi"
    type: "token_graduated",
    updateFields: ["description", "external_url", "status", "attributes"],
    descriptionTemplate: "🎓 Token has graduated! Now trading on DEX.",
    enabled: true,
  },
  {
    type: "holder_count_threshold",
    threshold: 100,
    updateFields: ["description", "attributes"],
    descriptionTemplate: "👥 100+ holders milestone reached!",
    enabled: true,
  },
  {
    type: "holder_count_threshold",
    threshold: 1000,
    updateFields: ["description", "attributes"],
    descriptionTemplate: "🌟 1,000+ holders! Strong community growth.",
    enabled: true,
  },
];

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxUpdatesPerHour: 5,
  maxUpdatesPerDay: 20,
  globalMaxUpdatesPerMinute: 10,
  minSecondsBetweenUpdates: 60, // 1 minute cooldown
};
