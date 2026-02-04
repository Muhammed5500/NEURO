/**
 * Treasury Ledger Service
 * 
 * Main service orchestrating all treasury operations:
 * - PnL event recording
 * - Bucket allocation
 * - Invariant enforcement
 * - Withdrawal management
 * - Balance reconciliation
 * - Monthly reporting
 * 
 * Acceptance criteria:
 * - Ledger totals always match
 * - Allocation is deterministic and tested
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as crypto from "crypto";
import type {
  PnlEvent,
  PnlEventType,
  BucketType,
  BucketBalances,
  TreasuryState,
  TreasuryConfig,
  WithdrawalRequest,
  MonthlyRollupReport,
  InvariantCheckResult,
} from "./types.js";
import { DEFAULT_TREASURY_CONFIG } from "./types.js";
import { BucketManager, createBucketManager } from "./bucket-manager.js";
import { InvariantChecker, createInvariantChecker } from "./invariant-checker.js";
import { WithdrawalQueue, createWithdrawalQueue } from "./withdrawal-queue.js";
import {
  BalanceReconciler,
  OnChainBalanceProvider,
  MockOnChainBalanceProvider,
  createBalanceReconciler,
} from "./balance-reconciler.js";
import { RollupReporter, createRollupReporter } from "./rollup-reporter.js";

const treasuryLogger = logger.child({ component: "treasury-ledger" });

// ============================================
// TREASURY LEDGER
// ============================================

export class TreasuryLedger {
  private readonly config: TreasuryConfig;
  
  // Components
  private readonly bucketManager: BucketManager;
  private readonly invariantChecker: InvariantChecker;
  private readonly withdrawalQueue: WithdrawalQueue;
  private readonly reconciler: BalanceReconciler;
  private readonly reporter: RollupReporter;
  
  // State
  private totalBalance: bigint = 0n;
  private readonly events: PnlEvent[] = [];
  private readonly maxEventsSize = 10000;
  
  // Timestamps
  private createdAt: number;
  private lastUpdated: number;
  
  // Kill switch callback
  private killSwitchCallback?: () => boolean;

  constructor(
    onChainProvider?: OnChainBalanceProvider,
    config?: Partial<TreasuryConfig>
  ) {
    this.config = { ...DEFAULT_TREASURY_CONFIG, ...config };
    this.createdAt = Date.now();
    this.lastUpdated = this.createdAt;

    // Initialize components
    this.bucketManager = createBucketManager(this.config);
    this.invariantChecker = createInvariantChecker(this.config);
    this.withdrawalQueue = createWithdrawalQueue(this.config.timelock);
    this.reconciler = createBalanceReconciler(
      onChainProvider || new MockOnChainBalanceProvider(),
      this.config
    );
    this.reporter = createRollupReporter();

    // Connect kill switch to withdrawal queue
    if (this.config.killSwitchEnabled) {
      this.withdrawalQueue.setKillSwitchCallback(() => {
        return this.killSwitchCallback ? this.killSwitchCallback() : false;
      });
    }

    treasuryLogger.info({
      allocations: this.config.allocationPercentages,
      timelockMinMs: this.config.timelock.minTimelockMs,
    }, "TreasuryLedger initialized");
  }

  /**
   * Set kill switch callback
   */
  setKillSwitchCallback(callback: () => boolean): void {
    this.killSwitchCallback = callback;
  }

  /**
   * Set treasury on-chain address
   */
  setTreasuryAddress(address: string): void {
    this.reconciler.setTreasuryAddress(address);
  }

  /**
   * Record a PnL event
   * Acceptance criteria: "Ledger totals always match"
   */
  recordPnlEvent(
    type: PnlEventType,
    grossAmount: bigint,
    fees: bigint,
    description: string,
    context?: {
      tokenAddress?: string;
      tokenSymbol?: string;
      txHash?: string;
    }
  ): PnlEvent {
    const eventId = crypto.randomUUID();
    const now = Date.now();
    const netAmount = grossAmount - fees;

    // Pre-operation invariant check
    // Turkish: "her işlemden önce kontrol"
    this.invariantChecker.enforce(
      this.totalBalance,
      this.bucketManager.getBalances(),
      "pre_operation",
      eventId
    );

    // Calculate previous balance
    const previousTotalBalance = this.totalBalance;

    // Allocate to buckets (only for positive amounts)
    let allocations: BucketBalances;
    if (netAmount > 0n) {
      // Profit/income - allocate according to percentages
      const result = this.bucketManager.allocate(netAmount);
      allocations = result.allocations;
      this.bucketManager.applyAllocation(allocations);
      this.totalBalance += netAmount;
    } else if (netAmount < 0n) {
      // Loss/expense - deduct from appropriate bucket
      const absAmount = -netAmount;
      allocations = this.deductFromBucket(type, absAmount);
      this.totalBalance -= absAmount;
    } else {
      allocations = { liquidity_reserve: 0n, launch_reserve: 0n, gas_reserve: 0n };
    }

    // Create event
    const event: PnlEvent = {
      id: eventId,
      type,
      grossAmount,
      fees,
      netAmount,
      tokenAddress: context?.tokenAddress,
      tokenSymbol: context?.tokenSymbol,
      txHash: context?.txHash,
      allocations,
      description,
      createdAt: now,
      previousTotalBalance,
      newTotalBalance: this.totalBalance,
      invariantCheckPassed: true,
    };

    // Post-operation invariant check
    // Turkish: "her işlemden sonra kontrol"
    const checkResult = this.invariantChecker.checkWithRecovery(
      this.totalBalance,
      this.bucketManager.getBalances(),
      "post_operation",
      eventId,
      (adjustment) => {
        this.bucketManager.adjustGasReserve(adjustment);
      }
    );

    event.invariantCheckPassed = checkResult.passed || checkResult.autoRecovered === true;

    // Store event
    this.events.push(event);
    if (this.events.length > this.maxEventsSize) {
      this.events.splice(0, this.events.length - this.maxEventsSize);
    }

    // Update reconciler virtual balance
    this.reconciler.updateVirtualBalance(this.totalBalance);

    this.lastUpdated = now;

    treasuryLogger.info({
      eventId,
      type,
      netAmount: netAmount.toString(),
      newTotal: this.totalBalance.toString(),
    }, "PnL event recorded");

    return event;
  }

  /**
   * Request a withdrawal
   * Turkish: "minimum 24 saatlik withdrawal_queue"
   */
  requestWithdrawal(
    amount: bigint,
    fromBucket: BucketType,
    destinationAddress: string,
    customTimelockMs?: number
  ): WithdrawalRequest {
    // Check bucket has sufficient balance
    const available = this.bucketManager.getBucketBalance(fromBucket);
    const pending = this.withdrawalQueue.getPendingAmountByBucket(fromBucket);
    
    if (available - pending < amount) {
      throw new Error(
        `Insufficient balance in ${fromBucket}: available=${available}, pending=${pending}, requested=${amount}`
      );
    }

    return this.withdrawalQueue.requestWithdrawal(
      amount,
      fromBucket,
      destinationAddress,
      customTimelockMs
    );
  }

  /**
   * Approve a withdrawal (for multisig)
   */
  approveWithdrawal(requestId: string, approver: string, signature?: string): WithdrawalRequest {
    return this.withdrawalQueue.approveWithdrawal(requestId, approver, signature);
  }

  /**
   * Execute a withdrawal
   */
  executeWithdrawal(requestId: string, txHash: string): WithdrawalRequest {
    const request = this.withdrawalQueue.getRequest(requestId);
    if (!request) {
      throw new Error(`Withdrawal request not found: ${requestId}`);
    }

    // Deduct from bucket
    this.bucketManager.deduct(request.fromBucket, request.amount);
    this.totalBalance -= request.amount;

    // Record as PnL event
    this.recordPnlEvent(
      "ADJUSTMENT",
      0n,
      0n,
      `Withdrawal executed: ${request.amount} from ${request.fromBucket}`,
      { txHash }
    );

    // Mark as executed
    return this.withdrawalQueue.executeWithdrawal(requestId, txHash);
  }

  /**
   * Cancel a withdrawal
   */
  cancelWithdrawal(requestId: string, cancelledBy: string, reason: string): WithdrawalRequest {
    return this.withdrawalQueue.cancelWithdrawal(requestId, cancelledBy, reason);
  }

  /**
   * Trigger kill switch - cancel all pending withdrawals
   * Turkish: "Kill Switch ile müdahale"
   */
  activateKillSwitch(activatedBy: string, reason: string): number {
    return this.withdrawalQueue.cancelAllPending(activatedBy, reason);
  }

  /**
   * Reconcile virtual and on-chain balances
   * Turkish: "Sanal Defter ve Gerçek Zincir Üstü Bakiye"
   */
  async reconcileBalances(
    expectedGasCosts: bigint = 0n,
    expectedSlippage: bigint = 0n
  ): Promise<ReturnType<BalanceReconciler["reconcile"]>> {
    return this.reconciler.reconcile(
      expectedGasCosts,
      expectedSlippage,
      (adjustment) => {
        this.bucketManager.adjustGasReserve(adjustment);
        this.totalBalance += adjustment;
      }
    );
  }

  /**
   * Generate monthly rollup report
   * Turkish: "Deterministic Rollup"
   */
  generateMonthlyReport(
    periodStart: number,
    periodEnd: number,
    openingBalance: bigint,
    openingBuckets: BucketBalances
  ): MonthlyRollupReport {
    return this.reporter.generateReport(
      periodStart,
      periodEnd,
      openingBalance,
      this.totalBalance,
      openingBuckets,
      this.bucketManager.getBalances(),
      this.events,
      Array.from(this.withdrawalQueue.getPendingRequests()),
      this.invariantChecker.getHistory()
    );
  }

  /**
   * Export monthly report as JSON
   */
  exportMonthlyReportJson(report: MonthlyRollupReport): string {
    return this.reporter.exportAsJson(report);
  }

  /**
   * Get current treasury state
   */
  getState(): TreasuryState {
    const lastCheck = this.invariantChecker.getHistory(1)[0];
    const stats = this.invariantChecker.getStatistics();

    return {
      totalBalance: this.totalBalance,
      buckets: this.bucketManager.getBalances(),
      virtualBalance: this.reconciler.getVirtualBalance(),
      onchainBalance: this.reconciler.getOnChainBalance(),
      lastReconciliation: Date.now(),
      pendingWithdrawals: this.withdrawalQueue.getPendingRequests(),
      totalPendingAmount: this.withdrawalQueue.getTotalPendingAmount(),
      lastInvariantCheck: lastCheck || {
        passed: true,
        totalBalance: this.totalBalance,
        bucketSum: this.totalBalance,
        buckets: this.bucketManager.getBalances(),
        discrepancy: 0n,
        discrepancyPercent: 0,
        checkType: "periodic",
        timestamp: Date.now(),
      },
      healthScore: stats.healthScore,
      createdAt: this.createdAt,
      lastUpdated: this.lastUpdated,
    };
  }

  /**
   * Get total balance
   */
  getTotalBalance(): bigint {
    return this.totalBalance;
  }

  /**
   * Get bucket balances
   */
  getBucketBalances(): BucketBalances {
    return this.bucketManager.getBalances();
  }

  /**
   * Get specific bucket balance
   */
  getBucketBalance(bucket: BucketType): bigint {
    return this.bucketManager.getBucketBalance(bucket);
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit = 100): PnlEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * Get events by type
   */
  getEventsByType(type: PnlEventType, limit = 100): PnlEvent[] {
    return this.events
      .filter(e => e.type === type)
      .slice(-limit);
  }

  /**
   * Get invariant checker statistics
   */
  getInvariantStatistics(): ReturnType<InvariantChecker["getStatistics"]> {
    return this.invariantChecker.getStatistics();
  }

  /**
   * Get withdrawal statistics
   */
  getWithdrawalStatistics(): ReturnType<WithdrawalQueue["getStatistics"]> {
    return this.withdrawalQueue.getStatistics();
  }

  /**
   * Get reconciliation statistics
   */
  getReconciliationStatistics(): ReturnType<BalanceReconciler["getCumulativeStats"]> {
    return this.reconciler.getCumulativeStats();
  }

  /**
   * Rebalance buckets to target percentages
   */
  rebalanceBuckets(): BucketBalances {
    // Pre-check
    this.invariantChecker.enforce(
      this.totalBalance,
      this.bucketManager.getBalances(),
      "pre_operation",
      "rebalance"
    );

    const changes = this.bucketManager.rebalance();

    // Post-check
    this.invariantChecker.enforce(
      this.totalBalance,
      this.bucketManager.getBalances(),
      "post_operation",
      "rebalance"
    );

    // Record as event
    this.recordPnlEvent(
      "REBALANCE",
      0n,
      0n,
      "Bucket rebalancing",
      {}
    );

    return changes;
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  /**
   * Deduct loss/expense from appropriate bucket
   */
  private deductFromBucket(type: PnlEventType, amount: bigint): BucketBalances {
    const allocations: BucketBalances = {
      liquidity_reserve: 0n,
      launch_reserve: 0n,
      gas_reserve: 0n,
    };

    // Determine which bucket to deduct from based on event type
    let targetBucket: BucketType;
    switch (type) {
      case "GAS_EXPENSE":
        targetBucket = "gas_reserve";
        break;
      case "LAUNCH_EXPENSE":
        targetBucket = "launch_reserve";
        break;
      case "LIQUIDITY_PROVISION":
      case "LIQUIDITY_REMOVAL":
        targetBucket = "liquidity_reserve";
        break;
      case "TRADE_LOSS":
      default:
        // Default to liquidity reserve for trading losses
        targetBucket = "liquidity_reserve";
        break;
    }

    // Try to deduct from target bucket, fall back to others if needed
    const targetBalance = this.bucketManager.getBucketBalance(targetBucket);
    
    if (targetBalance >= amount) {
      this.bucketManager.deduct(targetBucket, amount);
      allocations[targetBucket] = -amount;
    } else {
      // Deduct what we can from target, then others
      let remaining = amount;
      
      if (targetBalance > 0n) {
        this.bucketManager.deduct(targetBucket, targetBalance);
        allocations[targetBucket] = -targetBalance;
        remaining -= targetBalance;
      }

      // Try other buckets
      const otherBuckets: BucketType[] = ["liquidity_reserve", "launch_reserve", "gas_reserve"]
        .filter(b => b !== targetBucket) as BucketType[];

      for (const bucket of otherBuckets) {
        if (remaining <= 0n) break;
        
        const balance = this.bucketManager.getBucketBalance(bucket);
        const deductAmount = balance < remaining ? balance : remaining;
        
        if (deductAmount > 0n) {
          this.bucketManager.deduct(bucket, deductAmount);
          allocations[bucket] = -deductAmount;
          remaining -= deductAmount;
        }
      }

      if (remaining > 0n) {
        treasuryLogger.error({
          type,
          requested: amount.toString(),
          remaining: remaining.toString(),
        }, "Insufficient funds across all buckets");
      }
    }

    return allocations;
  }
}

/**
 * Factory function
 */
export function createTreasuryLedger(
  onChainProvider?: OnChainBalanceProvider,
  config?: Partial<TreasuryConfig>
): TreasuryLedger {
  return new TreasuryLedger(onChainProvider, config);
}
