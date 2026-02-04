/**
 * Balance Reconciler
 * 
 * Reconciles virtual (accounting) and real (on-chain) balances:
 * - Detects discrepancies from gas, slippage, etc.
 * - Auto-adjusts via gas reserve
 * 
 * Turkish: "Hazineyi 'Sanal Defter' ve 'Gerçek Zincir Üstü Bakiye' olarak ikiye ayır.
 * Aradaki farkı otomatik olarak Gas Reserve üzerinden dengele."
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  BalanceDiscrepancy,
  TreasuryConfig,
} from "./types.js";
import { DEFAULT_TREASURY_CONFIG } from "./types.js";

const reconcilerLogger = logger.child({ component: "balance-reconciler" });

// ============================================
// ON-CHAIN BALANCE PROVIDER INTERFACE
// ============================================

export interface OnChainBalanceProvider {
  /**
   * Get current on-chain balance
   */
  getBalance(address: string): Promise<bigint>;
}

/**
 * Mock provider for development
 */
export class MockOnChainBalanceProvider implements OnChainBalanceProvider {
  private balance: bigint = 0n;
  private variance = 0; // Percentage variance to simulate

  setBalance(balance: bigint): void {
    this.balance = balance;
  }

  setVariance(percent: number): void {
    this.variance = percent;
  }

  async getBalance(_address: string): Promise<bigint> {
    // Apply variance to simulate real-world discrepancies
    if (this.variance > 0) {
      const varianceAmount = (this.balance * BigInt(Math.floor(this.variance * 100))) / 10000n;
      // Randomly add or subtract
      const sign = Math.random() > 0.5 ? 1n : -1n;
      return this.balance + (varianceAmount * sign);
    }
    return this.balance;
  }
}

// ============================================
// BALANCE RECONCILER
// ============================================

export class BalanceReconciler {
  private readonly config: TreasuryConfig;
  private readonly provider: OnChainBalanceProvider;
  
  // Treasury address
  private treasuryAddress: string = "";
  
  // Current states
  private virtualBalance: bigint = 0n;
  private lastOnChainBalance: bigint = 0n;
  private lastReconciliation: number = 0;
  
  // Discrepancy history
  private readonly discrepancies: BalanceDiscrepancy[] = [];
  private readonly maxHistorySize = 500;
  
  // Cumulative tracking
  private totalGasAdjustments: bigint = 0n;
  private totalSlippageAdjustments: bigint = 0n;
  private totalUnexplainedAdjustments: bigint = 0n;

  constructor(
    provider: OnChainBalanceProvider,
    config?: Partial<TreasuryConfig>
  ) {
    this.provider = provider;
    this.config = { ...DEFAULT_TREASURY_CONFIG, ...config };

    reconcilerLogger.info({
      maxDiscrepancyPercent: this.config.maxDiscrepancyPercent,
      reconciliationInterval: this.config.reconciliationIntervalMs,
    }, "BalanceReconciler initialized");
  }

  /**
   * Set treasury address
   */
  setTreasuryAddress(address: string): void {
    this.treasuryAddress = address;
  }

  /**
   * Update virtual balance
   */
  updateVirtualBalance(balance: bigint): void {
    this.virtualBalance = balance;
  }

  /**
   * Reconcile balances
   * Turkish: "Aradaki farkı otomatik olarak Gas Reserve üzerinden dengele"
   */
  async reconcile(
    expectedGasCosts: bigint = 0n,
    expectedSlippage: bigint = 0n,
    adjustCallback?: (adjustment: bigint) => void
  ): Promise<BalanceDiscrepancy> {
    const now = Date.now();

    // Fetch on-chain balance
    let onchainBalance: bigint;
    try {
      onchainBalance = await this.provider.getBalance(this.treasuryAddress);
    } catch (error) {
      reconcilerLogger.error({ error }, "Failed to fetch on-chain balance");
      throw error;
    }

    this.lastOnChainBalance = onchainBalance;

    // Calculate discrepancy
    // Turkish: "Sanal Defter ve Gerçek Zincir Üstü Bakiye"
    const discrepancy = this.virtualBalance - onchainBalance;
    const absDiscrepancy = discrepancy < 0n ? -discrepancy : discrepancy;
    
    const discrepancyPercent = this.virtualBalance > 0n
      ? Number((absDiscrepancy * 10000n) / this.virtualBalance) / 100
      : 0;

    // Analyze the discrepancy
    // Turkish: "slippage, gas fees"
    const estimatedGasCosts = expectedGasCosts > 0n ? expectedGasCosts : this.estimateGasCosts(absDiscrepancy);
    const estimatedSlippage = expectedSlippage > 0n ? expectedSlippage : this.estimateSlippage(absDiscrepancy);
    
    // Unexplained is the remainder
    let unexplained = absDiscrepancy;
    if (discrepancy > 0n) {
      // Virtual > On-chain (we think we have more than we do)
      unexplained = absDiscrepancy - estimatedGasCosts - estimatedSlippage;
      if (unexplained < 0n) unexplained = 0n;
    }

    // Determine if we should auto-adjust
    let adjustedFromGasReserve = false;
    let adjustmentAmount = 0n;

    if (absDiscrepancy > 0n && discrepancyPercent <= this.config.maxDiscrepancyPercent) {
      // Auto-adjust via gas reserve
      // Turkish: "Gas Reserve üzerinden dengele"
      adjustmentAmount = -discrepancy; // Negative to reduce virtual balance
      
      if (adjustCallback) {
        adjustCallback(adjustmentAmount);
        adjustedFromGasReserve = true;

        // Track adjustments
        this.totalGasAdjustments += estimatedGasCosts;
        this.totalSlippageAdjustments += estimatedSlippage;
        this.totalUnexplainedAdjustments += unexplained;

        reconcilerLogger.info({
          discrepancy: discrepancy.toString(),
          adjustmentAmount: adjustmentAmount.toString(),
          estimatedGasCosts: estimatedGasCosts.toString(),
          estimatedSlippage: estimatedSlippage.toString(),
        }, "Balance auto-adjusted via gas reserve");
      }
    } else if (discrepancyPercent > this.config.maxDiscrepancyPercent) {
      reconcilerLogger.error({
        discrepancyPercent,
        maxAllowed: this.config.maxDiscrepancyPercent,
        virtualBalance: this.virtualBalance.toString(),
        onchainBalance: onchainBalance.toString(),
      }, "Discrepancy exceeds maximum allowed - manual intervention required");
    }

    const result: BalanceDiscrepancy = {
      virtualBalance: this.virtualBalance,
      onchainBalance,
      discrepancy,
      discrepancyPercent,
      estimatedGasCosts,
      estimatedSlippage,
      unexplained,
      adjustedFromGasReserve,
      adjustmentAmount,
      detectedAt: now,
    };

    // Store in history
    this.addToHistory(result);
    this.lastReconciliation = now;

    return result;
  }

  /**
   * Get current virtual balance
   */
  getVirtualBalance(): bigint {
    return this.virtualBalance;
  }

  /**
   * Get last known on-chain balance
   */
  getOnChainBalance(): bigint {
    return this.lastOnChainBalance;
  }

  /**
   * Get current discrepancy
   */
  getCurrentDiscrepancy(): bigint {
    return this.virtualBalance - this.lastOnChainBalance;
  }

  /**
   * Check if reconciliation is needed
   */
  needsReconciliation(): boolean {
    const now = Date.now();
    return now - this.lastReconciliation >= this.config.reconciliationIntervalMs;
  }

  /**
   * Get reconciliation history
   */
  getHistory(limit = 100): BalanceDiscrepancy[] {
    return this.discrepancies.slice(-limit);
  }

  /**
   * Get cumulative adjustment statistics
   */
  getCumulativeStats(): {
    totalGasAdjustments: bigint;
    totalSlippageAdjustments: bigint;
    totalUnexplainedAdjustments: bigint;
    totalAdjustments: bigint;
    reconciliationCount: number;
  } {
    return {
      totalGasAdjustments: this.totalGasAdjustments,
      totalSlippageAdjustments: this.totalSlippageAdjustments,
      totalUnexplainedAdjustments: this.totalUnexplainedAdjustments,
      totalAdjustments: this.totalGasAdjustments + this.totalSlippageAdjustments + this.totalUnexplainedAdjustments,
      reconciliationCount: this.discrepancies.length,
    };
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private estimateGasCosts(totalDiscrepancy: bigint): bigint {
    // Assume 60% of unexplained discrepancy is gas
    return (totalDiscrepancy * 60n) / 100n;
  }

  private estimateSlippage(totalDiscrepancy: bigint): bigint {
    // Assume 30% of unexplained discrepancy is slippage
    return (totalDiscrepancy * 30n) / 100n;
  }

  private addToHistory(discrepancy: BalanceDiscrepancy): void {
    this.discrepancies.push(discrepancy);
    
    if (this.discrepancies.length > this.maxHistorySize) {
      this.discrepancies.splice(0, this.discrepancies.length - this.maxHistorySize);
    }
  }
}

/**
 * Factory function
 */
export function createBalanceReconciler(
  provider: OnChainBalanceProvider,
  config?: Partial<TreasuryConfig>
): BalanceReconciler {
  return new BalanceReconciler(provider, config);
}
