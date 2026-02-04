/**
 * Execution Types
 * 
 * Types for execution plan generation and simulation.
 */

import { z } from "zod";

// ============================================
// MONAD CONSTANTS
// ============================================

export const MONAD_CONSTANTS = {
  CHAIN_ID: 143,
  CHAIN_NAME: "Monad Mainnet",
  BLOCK_TIME_MS: 400, // 400ms per block
  FINALITY_BLOCKS: 2,
  FINALITY_TIME_MS: 800,
  
  // Turkish: "simülasyonun yapıldığı blok numarası ile planın oluşturulduğu an
  // arasındaki zaman farkını takip et. Eğer Monad'da 3 blok (1.2 saniye) geçtiyse
  // simülasyonu bayat (stale) kabul et"
  STALE_SIMULATION_BLOCKS: 3,
  STALE_SIMULATION_MS: 1200, // 3 blocks * 400ms
  
  // Turkish: "gas_limit değerine otomatik olarak %15 güvenlik marjı ekle"
  GAS_BUFFER_PERCENT: 15,
  
  // Default max slippage
  DEFAULT_MAX_SLIPPAGE_PERCENT: 2.5,
};

// ============================================
// EXECUTION STEP TYPES
// ============================================

export const executionStepTypeSchema = z.enum([
  "createToken",
  "addLiquidity",
  "initialSwap",
  "approve",
  "swap",
  "transfer",
  "custom",
]);

export type ExecutionStepType = z.infer<typeof executionStepTypeSchema>;

export interface ExecutionStep {
  id: string;
  index: number;
  type: ExecutionStepType;
  description: string;
  
  // Transaction data
  to: string;
  value: string; // Wei
  data: string; // Calldata
  
  // Gas estimation
  estimatedGas: bigint;
  estimatedGasWithBuffer: bigint;
  
  // Expected results
  expectedResult?: {
    tokenAddress?: string;
    tokenAmount?: string;
    monAmount?: string;
  };
  
  // Dependencies
  dependsOn?: string[]; // Step IDs this step depends on
  
  // Failure handling
  failureMode: "abort_all" | "skip_and_continue" | "retry";
  maxRetries: number;
}

// ============================================
// ATOMIC BUNDLE
// ============================================

export interface AtomicBundle {
  id: string;
  version: string;
  
  // Chain info
  chainId: number;
  chainName: string;
  
  // Steps
  steps: ExecutionStep[];
  totalSteps: number;
  
  // Gas totals
  totalEstimatedGas: bigint;
  totalEstimatedGasWithBuffer: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  
  // Cost estimation
  estimatedCostWei: string;
  estimatedCostMon: number;
  maxCostWei: string;
  maxCostMon: number;
  
  // Budget constraints
  maxBudgetWei: string;
  maxBudgetMon: number;
  
  // Timing
  createdAt: string;
  expiresAt: string;
  
  // Metadata
  consensusDecisionId?: string;
  targetTokenAddress?: string;
  targetTokenSymbol?: string;
  
  // Status
  isAtomic: boolean; // If true, all steps must succeed or all revert
  requiresApproval: boolean;
}

// ============================================
// SIMULATION TYPES
// ============================================

/**
 * State diff for a single address
 * Turkish: "cüzdanın MON bakiyesi ve hedeflenen token bakiyesindeki net değişimi"
 */
export interface AddressStateDiff {
  address: string;
  
  // MON balance change
  monBalanceBefore: string;
  monBalanceAfter: string;
  monBalanceChange: string;
  monBalanceChangeMon: number;
  
  // Token balance changes (if applicable)
  tokenChanges: Array<{
    tokenAddress: string;
    tokenSymbol?: string;
    balanceBefore: string;
    balanceAfter: string;
    balanceChange: string;
    balanceChangeFormatted: string;
  }>;
  
  // Nonce change
  nonceBefore: number;
  nonceAfter: number;
}

/**
 * Simulation result for a single step
 */
export interface StepSimulationResult {
  stepId: string;
  stepIndex: number;
  
  // Execution result
  success: boolean;
  revertReason?: string;
  
  // Gas used
  gasUsed: bigint;
  
  // Return data
  returnData?: string;
  
  // Logs/events
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
    decoded?: {
      name: string;
      args: Record<string, unknown>;
    };
  }>;
  
  // State changes for this step
  stateDiffs: AddressStateDiff[];
}

/**
 * Bundle simulation receipt
 * Turkish: "bundle receipt with expected state diffs"
 */
export interface BundleSimulationReceipt {
  id: string;
  bundleId: string;
  
  // Simulation context
  simulatedAt: string;
  simulationBlockNumber: bigint;
  simulationBlockTimestamp: number;
  
  // Overall result
  success: boolean;
  allStepsSucceeded: boolean;
  failedStepIndex?: number;
  failedStepReason?: string;
  
  // Per-step results
  stepResults: StepSimulationResult[];
  
  // Aggregated state diffs
  // Turkish: "işlem sonrasında cüzdanın MON bakiyesi ve hedeflenen token bakiyesindeki net değişimi"
  aggregatedStateDiffs: AddressStateDiff[];
  
  // Gas totals
  totalGasUsed: bigint;
  totalGasEstimated: bigint;
  gasEfficiency: number; // gasUsed / gasEstimated
  
  // Cost analysis
  actualCostWei: string;
  actualCostMon: number;
  
  // Price impact analysis
  // Turkish: "fiyat kayması (price impact)"
  priceImpact?: {
    impactPercent: number;
    impactBps: number;
    expectedPrice: number;
    actualPrice: number;
  };
  
  // Slippage check
  // Turkish: "belirlenen %2.5 limitini aşarsa planı anında iptal et"
  slippageCheck: {
    passed: boolean;
    actualSlippage: number;
    maxAllowedSlippage: number;
    breachedBy?: number;
  };
  
  // Staleness check
  // Turkish: "3 blok (1.2 saniye) geçtiyse simülasyonu bayat (stale) kabul et"
  stalenessCheck: {
    isStale: boolean;
    blocksSinceSimulation: number;
    timeSinceSimulationMs: number;
    threshold: {
      maxBlocks: number;
      maxMs: number;
    };
  };
  
  // Warnings and recommendations
  warnings: string[];
  recommendations: string[];
}

// ============================================
// CONSTRAINT TYPES
// ============================================

export interface ExecutionConstraints {
  // Slippage
  // Turkish: "%2.5 limitini aşarsa planı anında iptal et"
  maxSlippagePercent: number;
  
  // Budget
  maxBudgetMon: number;
  maxBudgetWei: string;
  
  // Risk
  maxRiskScore: number; // 0-1, deny if higher
  
  // Gas
  maxGasPriceGwei: number;
  
  // Timing
  maxExecutionTimeMs: number;
  
  // Approval
  requireManualApproval: boolean;
}

export const DEFAULT_CONSTRAINTS: ExecutionConstraints = {
  maxSlippagePercent: 2.5, // Turkish requirement
  maxBudgetMon: 1.0,
  maxBudgetWei: "1000000000000000000", // 1 MON
  maxRiskScore: 0.7,
  maxGasPriceGwei: 100,
  maxExecutionTimeMs: 30000,
  requireManualApproval: true, // Acceptance criteria: No tx unless manual approval
};

// ============================================
// CONSTRAINT VIOLATION TYPES
// ============================================

export type ConstraintViolationType = 
  | "slippage_breach"
  | "budget_exceeded"
  | "risk_too_high"
  | "gas_price_too_high"
  | "simulation_stale"
  | "simulation_failed";

export interface ConstraintViolation {
  type: ConstraintViolationType;
  message: string;
  actual: number | string;
  limit: number | string;
  severity: "warning" | "error" | "critical";
}

// ============================================
// EXECUTION PLAN OUTPUT
// ============================================

export interface ExecutionPlanOutput {
  // Plan
  bundle: AtomicBundle;
  
  // Simulation
  simulation: BundleSimulationReceipt;
  
  // Constraint check
  constraintsChecked: boolean;
  constraintsPassed: boolean;
  violations: ConstraintViolation[];
  
  // Approval status
  requiresApproval: boolean;
  canExecute: boolean;
  blockingReasons: string[];
  
  // Metadata
  generatedAt: string;
  consensusDecisionId?: string;
}
