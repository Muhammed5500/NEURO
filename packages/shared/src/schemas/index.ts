/**
 * NEURO Zod Schemas
 * Validation schemas for all data structures
 * 
 * @version 1.0.0
 * Schema versioning enables backward compatibility tracking
 */

import { z } from "zod";
import {
  EXECUTION_MODES,
  TX_TYPES,
  APPROVAL_STATUS,
  RISK_LEVELS,
} from "../constants/index.js";

// ============================================
// RE-EXPORT ALL SCHEMAS
// ============================================

// Common primitives
export * from "./common.js";

// Domain schemas
export * from "./news-item.js";
export * from "./social-signal.js";
export * from "./ingestion-event.js";
export * from "./embedding-record.js";
export * from "./agent-opinion.js";
export * from "./consensus-decision.js";
export * from "./execution-plan.js";
export * from "./audit-log-event.js";

// Test fixtures
export * from "./fixtures.js";

// ============================================
// PRIMITIVE SCHEMAS
// ============================================

// Ethereum address validation
export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address");

// Transaction hash validation
export const txHashSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "Invalid transaction hash");

// Hex string validation
export const hexSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]*$/, "Invalid hex string");

// BigInt string (for JSON serialization)
export const bigIntSchema = z.union([
  z.bigint(),
  z.string().transform((val) => BigInt(val)),
  z.number().transform((val) => BigInt(val)),
]);

// ============================================
// ENVIRONMENT SCHEMAS
// ============================================

export const envSchema = z.object({
  // Network
  MONAD_CHAIN_ID: z.string().transform(Number).default("143"),
  MONAD_RPC_URL: z.string().url().default("https://rpc.monad.xyz"),
  MONAD_RPC_URL_WS: z.string().default("wss://rpc.monad.xyz/ws"),
  
  // nad.fun API
  NADFUN_API_URL: z.string().url().default("https://api.nadapp.net"),
  NADFUN_API_KEY: z.string().optional(),
  
  // Security
  EXECUTION_MODE: z.enum(["READ_ONLY", "WRITE_ENABLED"]).default("READ_ONLY"),
  MANUAL_APPROVAL: z.string().transform((v) => v === "true").default("true"),
  KILL_SWITCH_ENABLED: z.string().transform((v) => v === "true").default("false"),
  MAX_SINGLE_TX_VALUE: z.string().transform(Number).default("1.0"),
  
  // Wallets
  OPERATOR_WALLET_ADDRESS: addressSchema.optional(),
  OPERATOR_PRIVATE_KEY: z.string().optional(),
  TREASURY_WALLET_ADDRESS: addressSchema.optional(),
  
  // Gas
  GAS_BUFFER_PERCENTAGE: z.string().transform(Number).default("15"),
  MAX_GAS_PRICE_GWEI: z.string().transform(Number).default("100"),
  
  // Finality
  FINALITY_WAIT_MS: z.string().transform(Number).default("800"),
  FINALITY_BLOCKS: z.string().transform(Number).default("2"),
  
  // Database
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().optional(),
  QDRANT_URL: z.string().url().optional(),
  
  // AI
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_PROVIDER: z.enum(["openai", "anthropic"]).default("openai"),
  LLM_MODEL: z.string().default("gpt-4-turbo"),
  
  // Logging
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOG_FORMAT: z.enum(["json", "pretty"]).default("json"),
  
  // Node
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
});

export type EnvConfig = z.infer<typeof envSchema>;

// ============================================
// TOKEN SCHEMAS
// ============================================

export const tokenSchema = z.object({
  id: z.string().uuid(),
  address: addressSchema,
  name: z.string().min(1).max(255),
  symbol: z.string().min(1).max(32),
  decimals: z.number().int().min(0).max(18).default(18),
  totalSupply: bigIntSchema,
  creatorAddress: addressSchema.optional(),
  nadfunUrl: z.string().url().optional(),
  createdAt: z.date(),
  metadata: z.record(z.unknown()).optional(),
});

export const tokenLaunchParamsSchema = z.object({
  name: z.string().min(1).max(255),
  symbol: z.string().min(1).max(32).regex(/^[A-Z0-9]+$/, "Symbol must be uppercase alphanumeric"),
  description: z.string().min(1).max(5000),
  totalSupply: bigIntSchema,
  decimals: z.number().int().min(0).max(18).default(18),
  imageUrl: z.string().url().optional(),
  websiteUrl: z.string().url().optional(),
  twitterUrl: z.string().url().optional(),
  telegramUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ============================================
// TRANSACTION SCHEMAS
// ============================================

export const transactionTypeSchema = z.enum([
  TX_TYPES.TOKEN_LAUNCH,
  TX_TYPES.TOKEN_BUY,
  TX_TYPES.TOKEN_SELL,
  TX_TYPES.TRANSFER,
  TX_TYPES.APPROVE,
  TX_TYPES.CUSTOM,
]);

export const transactionRequestSchema = z.object({
  id: z.string().uuid(),
  type: transactionTypeSchema,
  from: addressSchema,
  to: addressSchema,
  value: bigIntSchema,
  data: hexSchema.optional(),
  gasLimit: bigIntSchema,
  gasPrice: bigIntSchema.optional(),
  maxFeePerGas: bigIntSchema.optional(),
  maxPriorityFeePerGas: bigIntSchema.optional(),
  nonce: z.number().int().min(0).optional(),
});

export const transactionResultSchema = z.object({
  id: z.string().uuid(),
  hash: txHashSchema,
  blockNumber: bigIntSchema.optional(),
  status: z.enum(["pending", "confirmed", "failed"]),
  gasUsed: bigIntSchema.optional(),
  effectiveGasPrice: bigIntSchema.optional(),
  error: z.string().optional(),
  confirmedAt: z.date().optional(),
});

// ============================================
// APPROVAL SCHEMAS
// ============================================

export const approvalStatusSchema = z.enum([
  APPROVAL_STATUS.PENDING,
  APPROVAL_STATUS.APPROVED,
  APPROVAL_STATUS.REJECTED,
  APPROVAL_STATUS.EXPIRED,
  APPROVAL_STATUS.EXECUTED,
]);

export const riskLevelSchema = z.enum([
  RISK_LEVELS.LOW,
  RISK_LEVELS.MEDIUM,
  RISK_LEVELS.HIGH,
  RISK_LEVELS.CRITICAL,
]);

export const approvalRequestSchema = z.object({
  id: z.string().uuid(),
  transactionId: z.string().uuid().optional(),
  actionType: transactionTypeSchema,
  description: z.string().min(1),
  riskLevel: riskLevelSchema,
  estimatedGas: bigIntSchema,
  estimatedCostMon: z.number().min(0),
  payload: z.record(z.unknown()),
  status: approvalStatusSchema,
  createdAt: z.date(),
  expiresAt: z.date(),
});

export const approvalDecisionSchema = z.object({
  approvalId: z.string().uuid(),
  approved: z.boolean(),
  approvedBy: z.string().min(1),
  reason: z.string().optional(),
  timestamp: z.date(),
});

// ============================================
// AI DECISION SCHEMAS
// ============================================

export const aiDecisionSchema = z.object({
  id: z.string().uuid(),
  decisionType: z.string().min(1),
  inputContext: z.record(z.unknown()),
  reasoning: z.string().min(1),
  outputAction: z.record(z.unknown()),
  confidenceScore: z.number().min(0).max(1),
  modelUsed: z.string().min(1),
  approvalId: z.string().uuid().optional(),
  executed: z.boolean().default(false),
  createdAt: z.date(),
});

// ============================================
// SECURITY SCHEMAS
// ============================================

export const executionModeSchema = z.enum([
  EXECUTION_MODES.READ_ONLY,
  EXECUTION_MODES.WRITE_ENABLED,
]);

export const securityConfigSchema = z.object({
  executionMode: executionModeSchema,
  manualApprovalRequired: z.boolean(),
  killSwitchEnabled: z.boolean(),
  maxSingleTxValueMon: z.number().min(0),
  operatorWallet: z.object({
    address: addressSchema,
    type: z.literal("operator"),
    label: z.string(),
  }).optional(),
  treasuryWallet: z.object({
    address: addressSchema,
    type: z.literal("treasury"),
    label: z.string(),
  }).optional(),
});

export const killSwitchStateSchema = z.object({
  enabled: z.boolean(),
  enabledBy: z.string().optional(),
  enabledAt: z.date().optional(),
  reason: z.string().optional(),
});

// ============================================
// GAS ESTIMATION SCHEMAS
// ============================================

export const gasEstimateSchema = z.object({
  gasLimit: bigIntSchema,
  gasLimitWithBuffer: bigIntSchema,
  bufferPercentage: z.number().min(0).max(100),
  estimatedCostWei: bigIntSchema,
  estimatedCostMon: z.number().min(0),
  maxCostWei: bigIntSchema,
  maxCostMon: z.number().min(0),
});

// ============================================
// API SCHEMAS
// ============================================

export const apiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }).optional(),
    timestamp: z.date(),
  });

export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    hasMore: z.boolean(),
  });

// ============================================
// MARKET DATA SCHEMAS
// ============================================

export const marketDataSchema = z.object({
  tokenId: z.string().uuid(),
  tokenAddress: addressSchema,
  priceMon: z.number().min(0),
  priceUsd: z.number().min(0),
  volume24h: z.number().min(0),
  marketCap: z.number().min(0),
  holdersCount: z.number().int().min(0),
  liquidity: z.number().min(0),
  timestamp: z.date(),
});

export const trendingTokenSchema = z.object({
  token: tokenSchema,
  marketData: marketDataSchema,
  rank: z.number().int().min(1),
  priceChange24h: z.number(),
  volumeChange24h: z.number(),
});

// ============================================
// SCHEMA TYPE EXPORTS
// ============================================

export type Token = z.infer<typeof tokenSchema>;
export type TokenLaunchParams = z.infer<typeof tokenLaunchParamsSchema>;
export type TransactionRequest = z.infer<typeof transactionRequestSchema>;
export type TransactionResult = z.infer<typeof transactionResultSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
export type AIDecision = z.infer<typeof aiDecisionSchema>;
export type SecurityConfig = z.infer<typeof securityConfigSchema>;
export type KillSwitchState = z.infer<typeof killSwitchStateSchema>;
export type GasEstimate = z.infer<typeof gasEstimateSchema>;
export type MarketData = z.infer<typeof marketDataSchema>;
export type TrendingToken = z.infer<typeof trendingTokenSchema>;
