/**
 * Treasury Ledger Types
 * 
 * Types for treasury management:
 * - Allocation buckets (40% liquidity, 30% launch, 30% gas)
 * - PnL event recording
 * - Invariant checks
 * - Withdrawal timelock
 * - Monthly rollup reports
 */

import { z } from "zod";

// ============================================
// ALLOCATION BUCKETS
// ============================================

/**
 * Allocation bucket types
 */
export type BucketType = "liquidity_reserve" | "launch_reserve" | "gas_reserve";

/**
 * Allocation percentages (must sum to 100)
 */
export const ALLOCATION_PERCENTAGES: Record<BucketType, number> = {
  liquidity_reserve: 40, // 40% for liquidity operations
  launch_reserve: 30,    // 30% for next token launches
  gas_reserve: 30,       // 30% for gas costs
};

/**
 * Bucket balance
 */
export interface BucketBalance {
  bucketType: BucketType;
  balance: bigint;
  allocatedAt: number;
  lastUpdated: number;
}

/**
 * All bucket balances
 */
export interface BucketBalances {
  liquidity_reserve: bigint;
  launch_reserve: bigint;
  gas_reserve: bigint;
}

// ============================================
// PNL EVENTS
// ============================================

/**
 * PnL event types
 */
export type PnlEventType =
  | "TRADE_PROFIT"        // Profit from trading
  | "TRADE_LOSS"          // Loss from trading
  | "GAS_EXPENSE"         // Gas costs
  | "LAUNCH_EXPENSE"      // Token launch costs
  | "LIQUIDITY_PROVISION" // Adding liquidity
  | "LIQUIDITY_REMOVAL"   // Removing liquidity
  | "FEE_INCOME"          // Fee earnings
  | "ADJUSTMENT"          // Manual adjustment
  | "REBALANCE";          // Bucket rebalancing

/**
 * Realized PnL event
 */
export interface PnlEvent {
  id: string;
  type: PnlEventType;
  
  // Amounts
  grossAmount: bigint;      // Before fees
  fees: bigint;             // Fees paid
  netAmount: bigint;        // After fees (can be negative for losses)
  
  // Context
  tokenAddress?: string;
  tokenSymbol?: string;
  txHash?: string;
  
  // Allocation
  allocations: {
    liquidity_reserve: bigint;
    launch_reserve: bigint;
    gas_reserve: bigint;
  };
  
  // Metadata
  description: string;
  createdAt: number;
  
  // Audit
  previousTotalBalance: bigint;
  newTotalBalance: bigint;
  invariantCheckPassed: boolean;
}

// ============================================
// VIRTUAL VS REAL BALANCES
// ============================================

/**
 * Ledger type
 * Turkish: "Hazineyi 'Sanal Defter' ve 'Gerçek Zincir Üstü Bakiye' olarak ikiye ayır"
 */
export type LedgerType = "virtual" | "onchain";

/**
 * Balance discrepancy
 * Turkish: "Aradaki farkı otomatik olarak Gas Reserve üzerinden dengele"
 */
export interface BalanceDiscrepancy {
  virtualBalance: bigint;
  onchainBalance: bigint;
  discrepancy: bigint;
  discrepancyPercent: number;
  
  // What caused it
  estimatedGasCosts: bigint;
  estimatedSlippage: bigint;
  unexplained: bigint;
  
  // Action taken
  adjustedFromGasReserve: boolean;
  adjustmentAmount: bigint;
  
  detectedAt: number;
}

// ============================================
// WITHDRAWAL QUEUE (TIMELOCK)
// ============================================

/**
 * Withdrawal request status
 */
export type WithdrawalStatus =
  | "pending"    // In queue, waiting for timelock
  | "ready"      // Timelock passed, can be executed
  | "executed"   // Successfully executed
  | "cancelled"  // Cancelled (e.g., by kill switch)
  | "expired";   // Expired without execution

/**
 * Withdrawal request
 * Turkish: "Her çekim işlemi için minimum 24 saatlik withdrawal_queue yapısı"
 */
export interface WithdrawalRequest {
  id: string;
  
  // Amount and destination
  amount: bigint;
  fromBucket: BucketType;
  destinationAddress: string;
  
  // Timelock
  // Turkish: "minimum 24 saatlik"
  requestedAt: number;
  timelockExpiresAt: number;
  executionDeadline: number;
  
  // Status
  status: WithdrawalStatus;
  
  // Approval (for multisig compatibility)
  requiredApprovals: number;
  approvals: Array<{
    approver: string;
    approvedAt: number;
    signature?: string;
  }>;
  
  // Execution
  executedAt?: number;
  txHash?: string;
  
  // Cancellation
  cancelledAt?: number;
  cancelledBy?: string;
  cancellationReason?: string;
}

/**
 * Timelock configuration
 */
export interface TimelockConfig {
  // Turkish: "minimum 24 saatlik"
  minTimelockMs: number;
  maxTimelockMs: number;
  executionWindowMs: number;
  
  // Multisig
  requiredApprovals: number;
  approvers: string[];
}

export const DEFAULT_TIMELOCK_CONFIG: TimelockConfig = {
  minTimelockMs: 24 * 60 * 60 * 1000,      // 24 hours
  maxTimelockMs: 7 * 24 * 60 * 60 * 1000,  // 7 days
  executionWindowMs: 48 * 60 * 60 * 1000,  // 48 hour window after timelock
  requiredApprovals: 1,
  approvers: [],
};

// ============================================
// INVARIANT CHECKS
// ============================================

/**
 * Invariant check result
 * Turkish: "Sum(Buckets) == Total her işlemden önce ve sonra kontrol eden sanity_check"
 */
export interface InvariantCheckResult {
  passed: boolean;
  
  // Balances
  totalBalance: bigint;
  bucketSum: bigint;
  
  // Individual buckets
  buckets: BucketBalances;
  
  // Discrepancy (if any)
  discrepancy: bigint;
  discrepancyPercent: number;
  
  // Context
  checkType: "pre_operation" | "post_operation" | "periodic";
  operationId?: string;
  timestamp: number;
  
  // If failed
  errorMessage?: string;
  autoRecovered?: boolean;
}

// ============================================
// MONTHLY ROLLUP REPORTS
// ============================================

/**
 * Monthly rollup report
 * Turkish: "Deterministic Rollup - JSON çıktısı"
 */
export interface MonthlyRollupReport {
  // Period
  periodStart: number;
  periodEnd: number;
  monthYear: string; // e.g., "2026-02"
  
  // Opening/Closing balances
  openingBalance: bigint;
  closingBalance: bigint;
  netChange: bigint;
  netChangePercent: number;
  
  // PnL Summary
  pnlSummary: {
    totalProfit: bigint;
    totalLoss: bigint;
    netPnl: bigint;
    totalFees: bigint;
    totalGasSpent: bigint;
    
    // By type
    profitByType: Record<PnlEventType, bigint>;
    lossByType: Record<PnlEventType, bigint>;
  };
  
  // Bucket balances
  bucketBalances: {
    opening: BucketBalances;
    closing: BucketBalances;
    changes: BucketBalances;
  };
  
  // Activity metrics
  activityMetrics: {
    totalEvents: number;
    eventsByType: Record<PnlEventType, number>;
    totalWithdrawals: number;
    totalDeposits: number;
    averageEventSize: bigint;
  };
  
  // Turkish: "Harcama Verimliliği (Gas efficiency)"
  gasEfficiency: {
    totalGasSpent: bigint;
    totalTransactions: number;
    averageGasPerTx: bigint;
    gasPerProfitUnit: number; // Gas spent per unit of profit
    monthOverMonthChange: number;
  };
  
  // Turkish: "Büyüme Hızı"
  growthMetrics: {
    absoluteGrowth: bigint;
    percentageGrowth: number;
    compoundedAnnualRate: number;
    projectedYearEndBalance: bigint;
  };
  
  // Invariant health
  invariantHealth: {
    checksPerformed: number;
    checksPassed: number;
    checksFailedAndRecovered: number;
    checksFailedUnrecovered: number;
    healthScore: number; // 0-100
  };
  
  // Withdrawal activity
  withdrawalActivity: {
    requested: number;
    executed: number;
    cancelled: number;
    totalAmountWithdrawn: bigint;
    averageTimelockUsed: number;
  };
  
  // Generated at
  generatedAt: number;
  reportVersion: string;
}

// ============================================
// TREASURY STATE
// ============================================

/**
 * Complete treasury state
 */
export interface TreasuryState {
  // Balances
  totalBalance: bigint;
  buckets: BucketBalances;
  
  // Virtual vs Real
  // Turkish: "Sanal Defter ve Gerçek Zincir Üstü Bakiye"
  virtualBalance: bigint;
  onchainBalance: bigint;
  lastReconciliation: number;
  
  // Pending withdrawals
  pendingWithdrawals: WithdrawalRequest[];
  totalPendingAmount: bigint;
  
  // Health
  lastInvariantCheck: InvariantCheckResult;
  healthScore: number;
  
  // Timestamps
  createdAt: number;
  lastUpdated: number;
}

// ============================================
// CONFIGURATION
// ============================================

export interface TreasuryConfig {
  // Allocation
  allocationPercentages: Record<BucketType, number>;
  
  // Timelock
  timelock: TimelockConfig;
  
  // Invariant checks
  invariantCheckIntervalMs: number;
  autoRecoverDiscrepancy: boolean;
  maxAutoRecoverAmount: bigint;
  
  // Reconciliation
  reconciliationIntervalMs: number;
  maxDiscrepancyPercent: number;
  
  // Kill switch integration
  killSwitchEnabled: boolean;
}

export const DEFAULT_TREASURY_CONFIG: TreasuryConfig = {
  allocationPercentages: ALLOCATION_PERCENTAGES,
  timelock: DEFAULT_TIMELOCK_CONFIG,
  invariantCheckIntervalMs: 60000, // 1 minute
  autoRecoverDiscrepancy: true,
  maxAutoRecoverAmount: BigInt(1e18), // 1 MON max auto-recover
  reconciliationIntervalMs: 300000, // 5 minutes
  maxDiscrepancyPercent: 5, // 5% max discrepancy
  killSwitchEnabled: true,
};

// ============================================
// ERRORS
// ============================================

export class InvariantViolationError extends Error {
  constructor(
    message: string,
    public readonly totalBalance: bigint,
    public readonly bucketSum: bigint,
    public readonly discrepancy: bigint
  ) {
    super(message);
    this.name = "InvariantViolationError";
  }
}

export class InsufficientBucketBalanceError extends Error {
  constructor(
    message: string,
    public readonly bucket: BucketType,
    public readonly requested: bigint,
    public readonly available: bigint
  ) {
    super(message);
    this.name = "InsufficientBucketBalanceError";
  }
}

export class TimelockNotExpiredError extends Error {
  constructor(
    message: string,
    public readonly requestId: string,
    public readonly expiresAt: number,
    public readonly currentTime: number
  ) {
    super(message);
    this.name = "TimelockNotExpiredError";
  }
}

export class WithdrawalCancelledError extends Error {
  constructor(
    message: string,
    public readonly requestId: string,
    public readonly reason: string
  ) {
    super(message);
    this.name = "WithdrawalCancelledError";
  }
}
