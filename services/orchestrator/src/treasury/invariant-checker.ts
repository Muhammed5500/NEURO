/**
 * Invariant Checker
 * 
 * Ensures treasury invariants are maintained:
 * - Sum(Buckets) == Total before and after every operation
 * - Auto-recovery for small discrepancies
 * 
 * Turkish: "Sum(Buckets) == Total her işlemden önce ve sonra kontrol eden sanity_check"
 * Acceptance criteria: "Ledger totals always match"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  BucketBalances,
  InvariantCheckResult,
  TreasuryConfig,
} from "./types.js";
import {
  DEFAULT_TREASURY_CONFIG,
  InvariantViolationError,
} from "./types.js";

const invariantLogger = logger.child({ component: "invariant-checker" });

// ============================================
// INVARIANT CHECKER
// ============================================

export class InvariantChecker {
  private readonly config: TreasuryConfig;
  
  // Check history
  private readonly checkHistory: InvariantCheckResult[] = [];
  private readonly maxHistorySize = 1000;
  
  // Statistics
  private totalChecks = 0;
  private passedChecks = 0;
  private failedAndRecovered = 0;
  private failedUnrecovered = 0;

  constructor(config?: Partial<TreasuryConfig>) {
    this.config = { ...DEFAULT_TREASURY_CONFIG, ...config };

    invariantLogger.info({
      autoRecover: this.config.autoRecoverDiscrepancy,
      maxAutoRecover: this.config.maxAutoRecoverAmount.toString(),
    }, "InvariantChecker initialized");
  }

  /**
   * Check invariant: Sum(Buckets) == Total
   * Turkish: "sanity_check mekanizması"
   */
  check(
    totalBalance: bigint,
    buckets: BucketBalances,
    checkType: InvariantCheckResult["checkType"],
    operationId?: string
  ): InvariantCheckResult {
    const now = Date.now();
    this.totalChecks++;

    // Calculate bucket sum
    const bucketSum = 
      buckets.liquidity_reserve +
      buckets.launch_reserve +
      buckets.gas_reserve;

    // Calculate discrepancy
    const discrepancy = totalBalance - bucketSum;
    const absDiscrepancy = discrepancy < 0n ? -discrepancy : discrepancy;
    
    // Calculate percentage
    const discrepancyPercent = totalBalance > 0n
      ? Number((absDiscrepancy * 10000n) / totalBalance) / 100
      : 0;

    // Check if passed
    const passed = discrepancy === 0n;

    const result: InvariantCheckResult = {
      passed,
      totalBalance,
      bucketSum,
      buckets: { ...buckets },
      discrepancy,
      discrepancyPercent,
      checkType,
      operationId,
      timestamp: now,
    };

    if (passed) {
      this.passedChecks++;
      invariantLogger.debug({
        checkType,
        operationId,
        totalBalance: totalBalance.toString(),
      }, "Invariant check passed");
    } else {
      invariantLogger.warn({
        checkType,
        operationId,
        totalBalance: totalBalance.toString(),
        bucketSum: bucketSum.toString(),
        discrepancy: discrepancy.toString(),
        discrepancyPercent,
      }, "Invariant check FAILED");

      result.errorMessage = `Invariant violation: total=${totalBalance}, buckets=${bucketSum}, diff=${discrepancy}`;
    }

    // Store in history
    this.addToHistory(result);

    return result;
  }

  /**
   * Check and throw if invariant is violated
   * Acceptance criteria: "Ledger totals always match"
   */
  enforce(
    totalBalance: bigint,
    buckets: BucketBalances,
    checkType: InvariantCheckResult["checkType"],
    operationId?: string
  ): void {
    const result = this.check(totalBalance, buckets, checkType, operationId);

    if (!result.passed) {
      throw new InvariantViolationError(
        result.errorMessage || "Invariant violation",
        totalBalance,
        result.bucketSum,
        result.discrepancy
      );
    }
  }

  /**
   * Check with auto-recovery attempt
   * Turkish: "otomatik olarak dengele"
   */
  checkWithRecovery(
    totalBalance: bigint,
    buckets: BucketBalances,
    checkType: InvariantCheckResult["checkType"],
    operationId?: string,
    recoverCallback?: (adjustment: bigint) => void
  ): InvariantCheckResult {
    const result = this.check(totalBalance, buckets, checkType, operationId);

    if (!result.passed && this.config.autoRecoverDiscrepancy) {
      const absDiscrepancy = result.discrepancy < 0n ? -result.discrepancy : result.discrepancy;

      // Only auto-recover small discrepancies
      if (absDiscrepancy <= this.config.maxAutoRecoverAmount) {
        // Adjust gas reserve to match
        // Turkish: "Gas Reserve üzerinden dengele"
        if (recoverCallback) {
          recoverCallback(result.discrepancy);
          result.autoRecovered = true;
          this.failedAndRecovered++;

          invariantLogger.info({
            discrepancy: result.discrepancy.toString(),
            operationId,
          }, "Invariant violation auto-recovered via gas reserve");
        }
      } else {
        this.failedUnrecovered++;
        invariantLogger.error({
          discrepancy: result.discrepancy.toString(),
          maxAutoRecover: this.config.maxAutoRecoverAmount.toString(),
        }, "Discrepancy too large for auto-recovery");
      }
    } else if (!result.passed) {
      this.failedUnrecovered++;
    }

    return result;
  }

  /**
   * Validate buckets have non-negative balances
   */
  validateNonNegative(buckets: BucketBalances): boolean {
    return (
      buckets.liquidity_reserve >= 0n &&
      buckets.launch_reserve >= 0n &&
      buckets.gas_reserve >= 0n
    );
  }

  /**
   * Get check statistics
   */
  getStatistics(): {
    totalChecks: number;
    passedChecks: number;
    failedAndRecovered: number;
    failedUnrecovered: number;
    successRate: number;
    healthScore: number;
  } {
    const successRate = this.totalChecks > 0
      ? (this.passedChecks + this.failedAndRecovered) / this.totalChecks
      : 1;

    // Health score penalizes unrecovered failures heavily
    const healthScore = Math.max(0, 100 - (this.failedUnrecovered * 10));

    return {
      totalChecks: this.totalChecks,
      passedChecks: this.passedChecks,
      failedAndRecovered: this.failedAndRecovered,
      failedUnrecovered: this.failedUnrecovered,
      successRate,
      healthScore,
    };
  }

  /**
   * Get recent check history
   */
  getHistory(limit = 100): InvariantCheckResult[] {
    return this.checkHistory.slice(-limit);
  }

  /**
   * Get failed checks from history
   */
  getFailedChecks(limit = 50): InvariantCheckResult[] {
    return this.checkHistory
      .filter(c => !c.passed)
      .slice(-limit);
  }

  /**
   * Reset statistics (for testing)
   */
  resetStatistics(): void {
    this.totalChecks = 0;
    this.passedChecks = 0;
    this.failedAndRecovered = 0;
    this.failedUnrecovered = 0;
    this.checkHistory.length = 0;
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private addToHistory(result: InvariantCheckResult): void {
    this.checkHistory.push(result);
    
    // Trim history if needed
    if (this.checkHistory.length > this.maxHistorySize) {
      this.checkHistory.splice(0, this.checkHistory.length - this.maxHistorySize);
    }
  }
}

/**
 * Factory function
 */
export function createInvariantChecker(
  config?: Partial<TreasuryConfig>
): InvariantChecker {
  return new InvariantChecker(config);
}
