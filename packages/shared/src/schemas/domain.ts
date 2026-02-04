/**
 * NEURO Domain Schemas
 * Shared data structures for cross-service communication
 * 
 * IMPORTANT: These schemas must stay in sync with Rust structs in
 * services/ingestion/src/schemas/mod.rs
 * 
 * Schema Version: 1.0.0
 * Monad Mainnet: Chain ID 143
 */

import { z } from "zod";

// ============================================
// SCHEMA VERSION
// ============================================

export const SCHEMA_VERSION = "1.0.0";

/**
 * Schema versioning for backward compatibility
 */
export const versionedSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({
    schemaVersion: z.string().default(SCHEMA_VERSION),
    data: schema,
  });

// ============================================
// COMMON PRIMITIVES
// ============================================

/** Ethereum address (0x + 40 hex chars) */
export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address");

/** Transaction hash (0x + 64 hex chars) */
export const txHashSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "Invalid transaction hash");

/** 
 * Wei amount as string to avoid precision loss
 * CRITICAL: Always use strings for blockchain amounts on Mainnet
 */
export const weiAmountSchema = z
  .string()
  .regex(/^\d+$/, "Wei amount must be a numeric string");

/** ISO 8601 timestamp */
export const timestampSchema = z.string().datetime();

/** UUID v4 */
export const uuidSchema = z.string().uuid();

// ============================================
// 1. NEWS ITEM
// ============================================

/**
 * NewsItem - External news/article data for AI analysis
 * 
 * Backward Compatibility:
 * - v1.0.0: Initial schema
 */
export const newsItemSchema = z.object({
  /** Unique identifier */
  id: uuidSchema,
  
  /** Schema version for compatibility */
  schemaVersion: z.string().default(SCHEMA_VERSION),
  
  /** News source (e.g., "coindesk", "twitter", "telegram") */
  source: z.string().min(1),
  
  /** Source-specific identifier */
  sourceId: z.string().optional(),
  
  /** Article/post title */
  title: z.string().min(1),
  
  /** Full content text */
  content: z.string(),
  
  /** Summary (AI-generated or excerpt) */
  summary: z.string().optional(),
  
  /** Original URL */
  url: z.string().url().optional(),
  
  /** Author name or handle */
  author: z.string().optional(),
  
  /** Publication timestamp */
  publishedAt: timestampSchema,
  
  /** Ingestion timestamp */
  ingestedAt: timestampSchema,
  
  /** Detected language (ISO 639-1) */
  language: z.string().length(2).default("en"),
  
  /** Relevance score (0.0 - 1.0) */
  relevanceScore: z.number().min(0).max(1).optional(),
  
  /** Sentiment score (-1.0 to 1.0) */
  sentimentScore: z.number().min(-1).max(1).optional(),
  
  /** Related token addresses */
  relatedTokens: z.array(addressSchema).default([]),
  
  /** Tags/categories */
  tags: z.array(z.string()).default([]),
  
  /** Additional metadata */
  metadata: z.record(z.unknown()).default({}),
});

export type NewsItem = z.infer<typeof newsItemSchema>;

// ============================================
// 2. SOCIAL SIGNAL
// ============================================

/**
 * SocialSignal - Social media activity signals
 * 
 * Backward Compatibility:
 * - v1.0.0: Initial schema
 */
export const socialSignalSchema = z.object({
  /** Unique identifier */
  id: uuidSchema,
  
  /** Schema version */
  schemaVersion: z.string().default(SCHEMA_VERSION),
  
  /** Platform (twitter, telegram, discord, etc.) */
  platform: z.enum(["twitter", "telegram", "discord", "reddit", "farcaster", "other"]),
  
  /** Signal type */
  signalType: z.enum([
    "mention",
    "sentiment",
    "volume_spike",
    "influencer_post",
    "trending",
    "whale_alert",
  ]),
  
  /** Related token address */
  tokenAddress: addressSchema.optional(),
  
  /** Token symbol */
  tokenSymbol: z.string().optional(),
  
  /** Signal strength (0.0 - 1.0) */
  strength: z.number().min(0).max(1),
  
  /** Sentiment (-1.0 to 1.0) */
  sentiment: z.number().min(-1).max(1).optional(),
  
  /** Mention/interaction count */
  count: z.number().int().min(0).default(0),
  
  /** Unique users involved */
  uniqueUsers: z.number().int().min(0).optional(),
  
  /** Influencer score if applicable */
  influencerScore: z.number().min(0).max(1).optional(),
  
  /** Sample content that triggered signal */
  sampleContent: z.string().optional(),
  
  /** Time window (seconds) */
  timeWindowSeconds: z.number().int().positive(),
  
  /** Detection timestamp */
  detectedAt: timestampSchema,
  
  /** Expiry timestamp */
  expiresAt: timestampSchema.optional(),
  
  /** Additional data */
  metadata: z.record(z.unknown()).default({}),
});

export type SocialSignal = z.infer<typeof socialSignalSchema>;

// ============================================
// 3. INGESTION EVENT
// ============================================

/**
 * IngestionEvent - Data ingestion tracking
 * 
 * Backward Compatibility:
 * - v1.0.0: Initial schema
 */
export const ingestionEventSchema = z.object({
  /** Unique identifier */
  id: uuidSchema,
  
  /** Schema version */
  schemaVersion: z.string().default(SCHEMA_VERSION),
  
  /** Event type */
  eventType: z.enum([
    "news_fetched",
    "social_scanned",
    "market_data_updated",
    "token_discovered",
    "chain_event",
    "error",
  ]),
  
  /** Data source */
  source: z.string().min(1),
  
  /** Number of items processed */
  itemsProcessed: z.number().int().min(0),
  
  /** Number of items failed */
  itemsFailed: z.number().int().min(0).default(0),
  
  /** Processing duration (milliseconds) */
  durationMs: z.number().int().min(0),
  
  /** Start timestamp */
  startedAt: timestampSchema,
  
  /** Completion timestamp */
  completedAt: timestampSchema,
  
  /** Error message if failed */
  errorMessage: z.string().optional(),
  
  /** Error details */
  errorDetails: z.record(z.unknown()).optional(),
  
  /** Related entity IDs */
  relatedIds: z.array(z.string()).default([]),
  
  /** Additional metadata */
  metadata: z.record(z.unknown()).default({}),
});

export type IngestionEvent = z.infer<typeof ingestionEventSchema>;

// ============================================
// 4. EMBEDDING RECORD
// ============================================

/**
 * EmbeddingRecord - Vector embedding storage
 * 
 * Backward Compatibility:
 * - v1.0.0: Initial schema
 */
export const embeddingRecordSchema = z.object({
  /** Unique identifier */
  id: uuidSchema,
  
  /** Schema version */
  schemaVersion: z.string().default(SCHEMA_VERSION),
  
  /** Content type being embedded */
  contentType: z.enum([
    "news",
    "social",
    "market_analysis",
    "decision",
    "transaction",
    "token_info",
  ]),
  
  /** Reference to source document */
  sourceId: z.string(),
  
  /** Original text that was embedded */
  originalText: z.string(),
  
  /** Truncated/processed text if different */
  processedText: z.string().optional(),
  
  /** Embedding vector (array of floats) */
  embedding: z.array(z.number()),
  
  /** Embedding model used */
  model: z.string().default("text-embedding-ada-002"),
  
  /** Vector dimensions */
  dimensions: z.number().int().positive().default(1536),
  
  /** Creation timestamp */
  createdAt: timestampSchema,
  
  /** Token address if related to specific token */
  tokenAddress: addressSchema.optional(),
  
  /** Additional searchable metadata */
  metadata: z.record(z.unknown()).default({}),
});

export type EmbeddingRecord = z.infer<typeof embeddingRecordSchema>;

// ============================================
// 5. AGENT OPINION
// ============================================

/**
 * AgentOpinion - Individual AI agent's assessment
 * 
 * Backward Compatibility:
 * - v1.0.0: Initial schema
 */
export const agentOpinionSchema = z.object({
  /** Unique identifier */
  id: uuidSchema,
  
  /** Schema version */
  schemaVersion: z.string().default(SCHEMA_VERSION),
  
  /** Agent identifier */
  agentId: z.string().min(1),
  
  /** Agent type/role */
  agentType: z.enum([
    "market_analyst",
    "sentiment_analyst",
    "risk_assessor",
    "technical_analyst",
    "news_analyst",
    "arbitrage_hunter",
  ]),
  
  /** Topic being analyzed */
  topic: z.string().min(1),
  
  /** Related token address */
  tokenAddress: addressSchema.optional(),
  
  /** Recommended action */
  recommendedAction: z.enum(["buy", "sell", "hold", "launch", "avoid", "monitor"]),
  
  /** Confidence level (0.0 - 1.0) */
  confidence: z.number().min(0).max(1),
  
  /** Detailed reasoning */
  reasoning: z.string().min(1),
  
  /** Supporting evidence IDs */
  evidenceIds: z.array(z.string()).default([]),
  
  /** Risk assessment */
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  
  /** Expected timeframe */
  timeframe: z.enum(["immediate", "short_term", "medium_term", "long_term"]).optional(),
  
  /** Price target if applicable (as string for precision) */
  priceTarget: z.string().optional(),
  
  /** Stop loss if applicable (as string for precision) */
  stopLoss: z.string().optional(),
  
  /** Model used for analysis */
  modelUsed: z.string().optional(),
  
  /** Creation timestamp */
  createdAt: timestampSchema,
  
  /** Expiry timestamp */
  expiresAt: timestampSchema.optional(),
  
  /** Additional metadata */
  metadata: z.record(z.unknown()).default({}),
});

export type AgentOpinion = z.infer<typeof agentOpinionSchema>;

// ============================================
// 6. CONSENSUS DECISION
// ============================================

/**
 * ConsensusDecision - Aggregated decision from multiple agents
 * 
 * Backward Compatibility:
 * - v1.0.0: Initial schema
 */
export const consensusDecisionSchema = z.object({
  /** Unique identifier */
  id: uuidSchema,
  
  /** Schema version */
  schemaVersion: z.string().default(SCHEMA_VERSION),
  
  /** Related token address */
  tokenAddress: addressSchema.optional(),
  
  /** Token symbol */
  tokenSymbol: z.string().optional(),
  
  /** Final recommended action */
  action: z.enum(["buy", "sell", "hold", "launch", "avoid", "monitor"]),
  
  /** Aggregated confidence (0.0 - 1.0) */
  confidence: z.number().min(0).max(1),
  
  /** Consensus level (0.0 - 1.0) - how much agents agree */
  consensusLevel: z.number().min(0).max(1),
  
  /** Number of agents that participated */
  participatingAgents: z.number().int().positive(),
  
  /** Individual agent opinions */
  agentOpinions: z.array(agentOpinionSchema),
  
  /** Aggregated reasoning */
  reasoning: z.string().min(1),
  
  /** Overall risk level */
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  
  /** Suggested amount in Wei (string for precision) */
  suggestedAmountWei: weiAmountSchema.optional(),
  
  /** Suggested amount in human-readable form */
  suggestedAmountFormatted: z.string().optional(),
  
  /** Requires manual approval */
  requiresApproval: z.boolean().default(true),
  
  /** Creation timestamp */
  createdAt: timestampSchema,
  
  /** Valid until timestamp */
  validUntil: timestampSchema,
  
  /** Execution plan ID if approved */
  executionPlanId: uuidSchema.optional(),
  
  /** Additional metadata */
  metadata: z.record(z.unknown()).default({}),
});

export type ConsensusDecision = z.infer<typeof consensusDecisionSchema>;

// ============================================
// 7. EXECUTION PLAN
// ============================================

/**
 * ExecutionPlan - Detailed blockchain execution plan
 * 
 * CRITICAL: All amounts are in Wei as strings to prevent precision loss
 * Chain: Monad Mainnet (Chain ID: 143)
 * 
 * Backward Compatibility:
 * - v1.0.0: Initial schema
 */
export const executionPlanSchema = z.object({
  /** Unique identifier */
  id: uuidSchema,
  
  /** Schema version */
  schemaVersion: z.string().default(SCHEMA_VERSION),
  
  /** Chain ID (143 for Monad Mainnet) */
  chainId: z.number().int().default(143),
  
  /** Plan status */
  status: z.enum([
    "draft",
    "pending_approval",
    "approved",
    "executing",
    "completed",
    "failed",
    "cancelled",
  ]),
  
  /** Action type */
  actionType: z.enum([
    "token_launch",
    "token_buy",
    "token_sell",
    "transfer",
    "approve",
    "custom",
  ]),
  
  /** Related consensus decision */
  consensusDecisionId: uuidSchema.optional(),
  
  /** Target contract address */
  targetAddress: addressSchema,
  
  /** Sender address */
  fromAddress: addressSchema,
  
  /** 
   * Value in Wei (as string for precision)
   * CRITICAL: Never use number for mainnet amounts
   */
  valueWei: weiAmountSchema,
  
  /** Calldata (hex encoded) */
  calldata: z.string().regex(/^0x[a-fA-F0-9]*$/).optional(),
  
  // ============================================
  // MONAD GAS PARAMETERS
  // ============================================
  
  /** 
   * Gas limit (as string)
   * IMPORTANT: Monad charges by gas LIMIT, not gas used
   * Include 10-15% buffer
   */
  gasLimit: z.string().regex(/^\d+$/, "Gas limit must be numeric string"),
  
  /** Max fee per gas in Wei (EIP-1559) */
  maxFeePerGas: weiAmountSchema,
  
  /** Max priority fee per gas in Wei (EIP-1559) */
  maxPriorityFeePerGas: weiAmountSchema,
  
  /** Gas buffer percentage applied */
  gasBufferPercent: z.number().int().min(0).max(50).default(15),
  
  // ============================================
  // EXECUTION DETAILS
  // ============================================
  
  /** Nonce (if pre-determined) */
  nonce: z.number().int().min(0).optional(),
  
  /** Token address (for token operations) */
  tokenAddress: addressSchema.optional(),
  
  /** Token symbol */
  tokenSymbol: z.string().optional(),
  
  /** Token amount in smallest unit (as string) */
  tokenAmountRaw: z.string().optional(),
  
  /** Token decimals */
  tokenDecimals: z.number().int().min(0).max(18).optional(),
  
  /** Slippage tolerance (basis points, e.g., 50 = 0.5%) */
  slippageBps: z.number().int().min(0).max(10000).default(100),
  
  /** Deadline timestamp */
  deadline: z.number().int().positive().optional(),
  
  // ============================================
  // RISK & APPROVAL
  // ============================================
  
  /** Risk level */
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  
  /** Estimated cost in MON */
  estimatedCostMon: z.string(),
  
  /** Maximum cost in MON */
  maxCostMon: z.string(),
  
  /** Approval status */
  approvalStatus: z.enum(["not_required", "pending", "approved", "rejected"]).default("pending"),
  
  /** Approved by */
  approvedBy: z.string().optional(),
  
  /** Approval timestamp */
  approvedAt: timestampSchema.optional(),
  
  /** Rejection reason */
  rejectionReason: z.string().optional(),
  
  // ============================================
  // EXECUTION RESULT
  // ============================================
  
  /** Transaction hash */
  txHash: txHashSchema.optional(),
  
  /** Block number */
  blockNumber: z.number().int().positive().optional(),
  
  /** Actual gas used */
  gasUsed: z.string().optional(),
  
  /** Effective gas price */
  effectiveGasPrice: z.string().optional(),
  
  /** Execution error */
  executionError: z.string().optional(),
  
  // ============================================
  // TIMESTAMPS
  // ============================================
  
  /** Creation timestamp */
  createdAt: timestampSchema,
  
  /** Last update timestamp */
  updatedAt: timestampSchema,
  
  /** Execution start timestamp */
  executionStartedAt: timestampSchema.optional(),
  
  /** Execution completion timestamp */
  executionCompletedAt: timestampSchema.optional(),
  
  /** Plan expiry timestamp */
  expiresAt: timestampSchema,
  
  /** Additional metadata */
  metadata: z.record(z.unknown()).default({}),
});

export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

// ============================================
// 8. AUDIT LOG EVENT
// ============================================

/**
 * AuditLogEvent - Comprehensive audit trail
 * 
 * Backward Compatibility:
 * - v1.0.0: Initial schema
 */
export const auditLogEventSchema = z.object({
  /** Unique identifier */
  id: uuidSchema,
  
  /** Schema version */
  schemaVersion: z.string().default(SCHEMA_VERSION),
  
  /** Event timestamp */
  timestamp: timestampSchema,
  
  /** Event category */
  category: z.enum([
    "security",
    "execution",
    "approval",
    "ai_decision",
    "system",
    "user_action",
    "error",
  ]),
  
  /** Specific action */
  action: z.string().min(1),
  
  /** Actor (user, system, agent) */
  actor: z.string().min(1),
  
  /** Actor type */
  actorType: z.enum(["user", "system", "agent", "contract"]),
  
  /** Affected entity type */
  entityType: z.string().optional(),
  
  /** Affected entity ID */
  entityId: z.string().optional(),
  
  /** Severity level */
  severity: z.enum(["debug", "info", "warning", "error", "critical"]),
  
  /** Human-readable description */
  description: z.string().min(1),
  
  /** State before action */
  previousState: z.record(z.unknown()).optional(),
  
  /** State after action */
  newState: z.record(z.unknown()).optional(),
  
  /** Changes made */
  changes: z.array(z.object({
    field: z.string(),
    oldValue: z.unknown(),
    newValue: z.unknown(),
  })).optional(),
  
  /** Related transaction hash */
  txHash: txHashSchema.optional(),
  
  /** IP address (for user actions) */
  ipAddress: z.string().optional(),
  
  /** User agent (for user actions) */
  userAgent: z.string().optional(),
  
  /** Request ID for tracing */
  requestId: z.string().optional(),
  
  /** Correlation ID for related events */
  correlationId: z.string().optional(),
  
  /** Additional metadata */
  metadata: z.record(z.unknown()).default({}),
});

export type AuditLogEvent = z.infer<typeof auditLogEventSchema>;

// ============================================
// VERSIONED WRAPPERS
// ============================================

export const versionedNewsItem = versionedSchema(newsItemSchema);
export const versionedSocialSignal = versionedSchema(socialSignalSchema);
export const versionedIngestionEvent = versionedSchema(ingestionEventSchema);
export const versionedEmbeddingRecord = versionedSchema(embeddingRecordSchema);
export const versionedAgentOpinion = versionedSchema(agentOpinionSchema);
export const versionedConsensusDecision = versionedSchema(consensusDecisionSchema);
export const versionedExecutionPlan = versionedSchema(executionPlanSchema);
export const versionedAuditLogEvent = versionedSchema(auditLogEventSchema);

// ============================================
// SCHEMA REGISTRY
// ============================================

export const schemaRegistry = {
  version: SCHEMA_VERSION,
  schemas: {
    NewsItem: newsItemSchema,
    SocialSignal: socialSignalSchema,
    IngestionEvent: ingestionEventSchema,
    EmbeddingRecord: embeddingRecordSchema,
    AgentOpinion: agentOpinionSchema,
    ConsensusDecision: consensusDecisionSchema,
    ExecutionPlan: executionPlanSchema,
    AuditLogEvent: auditLogEventSchema,
  },
} as const;
