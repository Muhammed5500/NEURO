/**
 * ExecutionPlan Schema
 * Represents a blockchain execution plan for Monad Mainnet (Chain ID: 143)
 * 
 * @version 1.0.0
 * @backward-compatibility
 * - v1.0.0: Initial schema
 * 
 * CRITICAL NOTES:
 * - All amounts are in Wei (string) to prevent precision loss
 * - Gas fields are required for Monad which charges by GAS LIMIT, not gas used
 * - Chain ID 143 (Monad Mainnet) specific
 */

import { z } from "zod";
import {
  createVersionedSchema,
  addressSchema,
  txHashSchema,
  hexSchema,
  weiAmountSchema,
  uuidSchema,
  statusSchema,
  severitySchema,
  MONAD_MAINNET_CHAIN_ID,
  CURRENT_SCHEMA_VERSION,
} from "./common.js";

// ============================================
// SCHEMA DEFINITION
// ============================================

export const executionTypeSchema = z.enum([
  "token_buy",
  "token_sell",
  "token_launch",
  "token_transfer",
  "approve",
  "swap",
  "add_liquidity",
  "remove_liquidity",
  "custom",
]);

export type ExecutionType = z.infer<typeof executionTypeSchema>;

export const executionStatusSchema = z.enum([
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "queued",
  "broadcasting",
  "pending_confirmation",
  "confirming",
  "confirmed",
  "failed",
  "cancelled",
  "expired",
]);

export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

/**
 * Gas configuration for Monad Mainnet
 * CRITICAL: Monad charges by gas LIMIT, not gas used
 */
export const gasConfigSchema = z.object({
  /** Gas limit for the transaction (string to prevent precision loss) */
  gasLimit: weiAmountSchema,
  
  /** Maximum fee per gas in Wei (EIP-1559) */
  maxFeePerGas: weiAmountSchema,
  
  /** Maximum priority fee per gas in Wei (EIP-1559) */
  maxPriorityFeePerGas: weiAmountSchema,
  
  /** Buffer percentage applied (10-15% recommended for Monad) */
  gasBufferPercent: z.number().min(0).max(50).default(15),
  
  /** Estimated gas cost in Wei */
  estimatedGasCostWei: weiAmountSchema,
  
  /** Estimated gas cost in MON */
  estimatedGasCostMon: z.number().min(0),
  
  /** Maximum gas cost in Wei (with buffer) */
  maxGasCostWei: weiAmountSchema,
  
  /** Maximum gas cost in MON (with buffer) */
  maxGasCostMon: z.number().min(0),
});

export type GasConfig = z.infer<typeof gasConfigSchema>;

export const executionPlanSchema = createVersionedSchema({
  // Chain configuration
  chainId: z.number().int().default(MONAD_MAINNET_CHAIN_ID),
  chainName: z.string().default("Monad Mainnet"),
  
  // Execution type
  executionType: executionTypeSchema,
  description: z.string(),
  
  // Transaction parameters
  from: addressSchema,
  to: addressSchema,
  
  /** Value in Wei (string for precision) */
  value: weiAmountSchema,
  
  /** Value in MON (for display only) */
  valueMon: z.number().min(0),
  
  /** Calldata */
  data: hexSchema.optional(),
  
  /** Nonce (optional, will be fetched if not provided) */
  nonce: z.number().int().min(0).optional(),
  
  // Gas configuration (Monad-specific)
  gasConfig: gasConfigSchema,
  
  // Token details (if applicable)
  tokenAddress: addressSchema.optional(),
  tokenSymbol: z.string().optional(),
  tokenAmount: weiAmountSchema.optional(),
  tokenAmountFormatted: z.string().optional(),
  
  // Trade parameters (if applicable)
  minAmountOut: weiAmountSchema.optional(),
  slippagePercent: z.number().min(0).max(100).optional(),
  deadline: z.number().int().optional(),
  
  // Risk assessment
  riskLevel: severitySchema,
  riskFactors: z.array(z.string()).default([]),
  
  // Approval workflow
  requiresApproval: z.boolean().default(true),
  approvalId: uuidSchema.optional(),
  approvedBy: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
  
  // Decision reference
  consensusDecisionId: uuidSchema.optional(),
  
  // Execution status
  status: executionStatusSchema,
  
  // Transaction result
  txHash: txHashSchema.optional(),
  blockNumber: z.number().int().positive().optional(),
  
  /** Actual gas used (after confirmation) */
  gasUsed: weiAmountSchema.optional(),
  
  /** Effective gas price (after confirmation) */
  effectiveGasPrice: weiAmountSchema.optional(),
  
  /** Actual transaction cost in Wei */
  actualCostWei: weiAmountSchema.optional(),
  
  /** Actual transaction cost in MON */
  actualCostMon: z.number().min(0).optional(),
  
  // Error handling
  errorMessage: z.string().optional(),
  errorCode: z.string().optional(),
  retryCount: z.number().int().min(0).default(0),
  maxRetries: z.number().int().min(0).default(3),
  
  // Timing
  plannedAt: z.string().datetime(),
  submittedAt: z.string().datetime().optional(),
  confirmedAt: z.string().datetime().optional(),
  
  /** Time waited for finality (Monad: 800ms / 2 blocks) */
  finalityWaitMs: z.number().int().min(0).optional(),
  
  expiresAt: z.string().datetime(),
  
  // Simulation
  simulated: z.boolean().default(false),
  simulationSuccess: z.boolean().optional(),
  simulationError: z.string().optional(),
});

export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

// ============================================
// FACTORY FUNCTIONS
// ============================================

export function createExecutionPlan(
  data: Omit<ExecutionPlan, "id" | "schemaVersion" | "createdAt">
): ExecutionPlan {
  return executionPlanSchema.parse({
    ...data,
    id: crypto.randomUUID(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
  });
}

// ============================================
// EXAMPLES & FIXTURES
// ============================================

export const executionPlanExamples: ExecutionPlan[] = [
  {
    schemaVersion: "1.0.0",
    id: "550e8400-e29b-41d4-a716-446655440060",
    createdAt: "2024-01-15T14:10:00Z",
    chainId: 143,
    chainName: "Monad Mainnet",
    executionType: "token_buy",
    description: "Buy PEPE token on nad.fun",
    from: "0xOperatorWalletAddress1234567890123456789a",
    to: "0xNadFunRouterAddress12345678901234567890ab",
    value: "100000000000000000", // 0.1 MON in Wei
    valueMon: 0.1,
    data: "0xabcdef...",
    gasConfig: {
      gasLimit: "250000",
      maxFeePerGas: "50000000000", // 50 gwei
      maxPriorityFeePerGas: "2000000000", // 2 gwei
      gasBufferPercent: 15,
      estimatedGasCostWei: "10875000000000000", // ~0.011 MON
      estimatedGasCostMon: 0.010875,
      maxGasCostWei: "12506250000000000", // ~0.013 MON
      maxGasCostMon: 0.01250625,
    },
    tokenAddress: "0x1234567890123456789012345678901234567890",
    tokenSymbol: "PEPE",
    minAmountOut: "1000000000000000000000", // Minimum tokens expected
    slippagePercent: 2.5,
    deadline: 1705330200, // Unix timestamp
    riskLevel: "medium",
    riskFactors: ["High volatility", "New token"],
    requiresApproval: true,
    approvalId: "550e8400-e29b-41d4-a716-446655440061",
    consensusDecisionId: "550e8400-e29b-41d4-a716-446655440050",
    status: "pending_approval",
    retryCount: 0,
    maxRetries: 3,
    plannedAt: "2024-01-15T14:10:00Z",
    expiresAt: "2024-01-15T14:40:00Z",
    simulated: true,
    simulationSuccess: true,
  },
];
