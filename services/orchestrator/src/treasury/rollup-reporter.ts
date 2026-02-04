/**
 * Monthly Rollup Report Generator
 * 
 * Generates comprehensive monthly reports:
 * - PnL summaries
 * - Gas efficiency metrics
 * - Growth rate calculations
 * - Invariant health statistics
 * 
 * Turkish: "Aylık raporlarda 'Harcama Verimliliği' (Gas efficiency) ve 'Büyüme Hızı'
 * gibi metrikleri özetleyen bir JSON çıktısı sağla."
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  MonthlyRollupReport,
  PnlEvent,
  PnlEventType,
  BucketBalances,
  WithdrawalRequest,
  InvariantCheckResult,
} from "./types.js";

const reportLogger = logger.child({ component: "rollup-reporter" });

// ============================================
// ROLLUP REPORTER
// ============================================

export class RollupReporter {
  private readonly reportVersion = "1.0.0";
  
  // Historical data for comparison
  private previousMonthGrowth?: number;
  private previousMonthGasEfficiency?: number;

  constructor() {
    reportLogger.info("RollupReporter initialized");
  }

  /**
   * Generate monthly rollup report
   * Turkish: "Deterministic Rollup - JSON çıktısı"
   */
  generateReport(
    periodStart: number,
    periodEnd: number,
    openingBalance: bigint,
    closingBalance: bigint,
    openingBuckets: BucketBalances,
    closingBuckets: BucketBalances,
    events: PnlEvent[],
    withdrawals: WithdrawalRequest[],
    invariantChecks: InvariantCheckResult[]
  ): MonthlyRollupReport {
    const now = Date.now();

    // Filter events for this period
    const periodEvents = events.filter(
      e => e.createdAt >= periodStart && e.createdAt < periodEnd
    );

    // Calculate month/year string
    const startDate = new Date(periodStart);
    const monthYear = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;

    // Calculate net change
    const netChange = closingBalance - openingBalance;
    const netChangePercent = openingBalance > 0n
      ? Number((netChange * 10000n) / openingBalance) / 100
      : 0;

    // Generate report sections
    const pnlSummary = this.calculatePnlSummary(periodEvents);
    const bucketBalances = this.calculateBucketChanges(openingBuckets, closingBuckets);
    const activityMetrics = this.calculateActivityMetrics(periodEvents);
    const gasEfficiency = this.calculateGasEfficiency(periodEvents, pnlSummary.netPnl);
    const growthMetrics = this.calculateGrowthMetrics(
      openingBalance,
      closingBalance,
      periodStart,
      periodEnd
    );
    const invariantHealth = this.calculateInvariantHealth(invariantChecks);
    const withdrawalActivity = this.calculateWithdrawalActivity(
      withdrawals.filter(w => w.requestedAt >= periodStart && w.requestedAt < periodEnd)
    );

    const report: MonthlyRollupReport = {
      periodStart,
      periodEnd,
      monthYear,
      openingBalance,
      closingBalance,
      netChange,
      netChangePercent,
      pnlSummary,
      bucketBalances,
      activityMetrics,
      gasEfficiency,
      growthMetrics,
      invariantHealth,
      withdrawalActivity,
      generatedAt: now,
      reportVersion: this.reportVersion,
    };

    // Store for next month comparison
    this.previousMonthGrowth = growthMetrics.percentageGrowth;
    this.previousMonthGasEfficiency = gasEfficiency.gasPerProfitUnit;

    reportLogger.info({
      monthYear,
      netChange: netChange.toString(),
      growthPercent: growthMetrics.percentageGrowth.toFixed(2),
      gasEfficiency: gasEfficiency.gasPerProfitUnit.toFixed(4),
    }, "Monthly rollup report generated");

    return report;
  }

  /**
   * Export report as JSON
   * Turkish: "JSON çıktısı sağla"
   */
  exportAsJson(report: MonthlyRollupReport): string {
    // Convert BigInt to string for JSON serialization
    const jsonSafe = this.convertBigIntToString(report);
    return JSON.stringify(jsonSafe, null, 2);
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private calculatePnlSummary(events: PnlEvent[]): MonthlyRollupReport["pnlSummary"] {
    let totalProfit = 0n;
    let totalLoss = 0n;
    let totalFees = 0n;
    let totalGasSpent = 0n;

    const profitByType: Record<PnlEventType, bigint> = {} as any;
    const lossByType: Record<PnlEventType, bigint> = {} as any;

    for (const event of events) {
      // Accumulate fees
      totalFees += event.fees;

      // Track gas expenses
      if (event.type === "GAS_EXPENSE") {
        totalGasSpent += event.netAmount < 0n ? -event.netAmount : event.netAmount;
      }

      // Categorize profit/loss
      if (event.netAmount > 0n) {
        totalProfit += event.netAmount;
        profitByType[event.type] = (profitByType[event.type] || 0n) + event.netAmount;
      } else if (event.netAmount < 0n) {
        totalLoss += -event.netAmount;
        lossByType[event.type] = (lossByType[event.type] || 0n) + (-event.netAmount);
      }
    }

    return {
      totalProfit,
      totalLoss,
      netPnl: totalProfit - totalLoss,
      totalFees,
      totalGasSpent,
      profitByType,
      lossByType,
    };
  }

  private calculateBucketChanges(
    opening: BucketBalances,
    closing: BucketBalances
  ): MonthlyRollupReport["bucketBalances"] {
    return {
      opening: { ...opening },
      closing: { ...closing },
      changes: {
        liquidity_reserve: closing.liquidity_reserve - opening.liquidity_reserve,
        launch_reserve: closing.launch_reserve - opening.launch_reserve,
        gas_reserve: closing.gas_reserve - opening.gas_reserve,
      },
    };
  }

  private calculateActivityMetrics(events: PnlEvent[]): MonthlyRollupReport["activityMetrics"] {
    const eventsByType: Record<PnlEventType, number> = {} as any;
    let totalDeposits = 0;
    let totalWithdrawals = 0;
    let totalAmount = 0n;

    for (const event of events) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;

      if (event.netAmount > 0n) {
        totalDeposits++;
      } else if (event.netAmount < 0n) {
        totalWithdrawals++;
      }

      const absAmount = event.netAmount < 0n ? -event.netAmount : event.netAmount;
      totalAmount += absAmount;
    }

    const averageEventSize = events.length > 0
      ? totalAmount / BigInt(events.length)
      : 0n;

    return {
      totalEvents: events.length,
      eventsByType,
      totalWithdrawals,
      totalDeposits,
      averageEventSize,
    };
  }

  /**
   * Calculate gas efficiency metrics
   * Turkish: "Harcama Verimliliği (Gas efficiency)"
   */
  private calculateGasEfficiency(
    events: PnlEvent[],
    netPnl: bigint
  ): MonthlyRollupReport["gasEfficiency"] {
    // Sum gas expenses
    let totalGasSpent = 0n;
    let totalTransactions = 0;

    for (const event of events) {
      if (event.type === "GAS_EXPENSE") {
        totalGasSpent += event.netAmount < 0n ? -event.netAmount : event.netAmount;
        totalTransactions++;
      }
      // Also count transactions that paid fees
      if (event.fees > 0n) {
        totalTransactions++;
      }
    }

    const averageGasPerTx = totalTransactions > 0
      ? totalGasSpent / BigInt(totalTransactions)
      : 0n;

    // Gas per profit unit (lower is better)
    // Turkish: "Harcama Verimliliği"
    let gasPerProfitUnit = 0;
    if (netPnl > 0n) {
      gasPerProfitUnit = Number(totalGasSpent) / Number(netPnl);
    }

    // Month over month change
    let monthOverMonthChange = 0;
    if (this.previousMonthGasEfficiency && this.previousMonthGasEfficiency > 0) {
      monthOverMonthChange = 
        ((gasPerProfitUnit - this.previousMonthGasEfficiency) / this.previousMonthGasEfficiency) * 100;
    }

    return {
      totalGasSpent,
      totalTransactions,
      averageGasPerTx,
      gasPerProfitUnit,
      monthOverMonthChange,
    };
  }

  /**
   * Calculate growth metrics
   * Turkish: "Büyüme Hızı"
   */
  private calculateGrowthMetrics(
    openingBalance: bigint,
    closingBalance: bigint,
    periodStart: number,
    periodEnd: number
  ): MonthlyRollupReport["growthMetrics"] {
    const absoluteGrowth = closingBalance - openingBalance;
    
    const percentageGrowth = openingBalance > 0n
      ? Number((absoluteGrowth * 10000n) / openingBalance) / 100
      : 0;

    // Calculate period length in years
    const periodMs = periodEnd - periodStart;
    const periodYears = periodMs / (365.25 * 24 * 60 * 60 * 1000);

    // Compound annual growth rate
    // CAGR = (EndValue/StartValue)^(1/years) - 1
    let compoundedAnnualRate = 0;
    if (openingBalance > 0n && periodYears > 0) {
      const ratio = Number(closingBalance) / Number(openingBalance);
      compoundedAnnualRate = (Math.pow(ratio, 1 / periodYears) - 1) * 100;
    }

    // Project year-end balance based on current growth rate
    const monthsRemaining = 12 - new Date(periodEnd).getMonth();
    const monthlyGrowthRate = percentageGrowth / 100;
    const projectedYearEndBalance = BigInt(
      Math.floor(Number(closingBalance) * Math.pow(1 + monthlyGrowthRate, monthsRemaining))
    );

    return {
      absoluteGrowth,
      percentageGrowth,
      compoundedAnnualRate,
      projectedYearEndBalance,
    };
  }

  private calculateInvariantHealth(
    checks: InvariantCheckResult[]
  ): MonthlyRollupReport["invariantHealth"] {
    let checksPerformed = checks.length;
    let checksPassed = 0;
    let checksFailedAndRecovered = 0;
    let checksFailedUnrecovered = 0;

    for (const check of checks) {
      if (check.passed) {
        checksPassed++;
      } else if (check.autoRecovered) {
        checksFailedAndRecovered++;
      } else {
        checksFailedUnrecovered++;
      }
    }

    // Health score (100 = perfect, penalize failures)
    let healthScore = 100;
    if (checksPerformed > 0) {
      // Minor penalty for recovered failures
      healthScore -= (checksFailedAndRecovered / checksPerformed) * 10;
      // Major penalty for unrecovered failures
      healthScore -= (checksFailedUnrecovered / checksPerformed) * 50;
    }
    healthScore = Math.max(0, healthScore);

    return {
      checksPerformed,
      checksPassed,
      checksFailedAndRecovered,
      checksFailedUnrecovered,
      healthScore,
    };
  }

  private calculateWithdrawalActivity(
    withdrawals: WithdrawalRequest[]
  ): MonthlyRollupReport["withdrawalActivity"] {
    let requested = 0;
    let executed = 0;
    let cancelled = 0;
    let totalAmountWithdrawn = 0n;
    let totalTimelockUsed = 0;

    for (const withdrawal of withdrawals) {
      requested++;

      if (withdrawal.status === "executed") {
        executed++;
        totalAmountWithdrawn += withdrawal.amount;
        
        // Calculate actual timelock used
        if (withdrawal.executedAt) {
          totalTimelockUsed += withdrawal.executedAt - withdrawal.requestedAt;
        }
      } else if (withdrawal.status === "cancelled") {
        cancelled++;
      }
    }

    const averageTimelockUsed = executed > 0
      ? totalTimelockUsed / executed
      : 0;

    return {
      requested,
      executed,
      cancelled,
      totalAmountWithdrawn,
      averageTimelockUsed,
    };
  }

  /**
   * Convert BigInt values to strings for JSON serialization
   */
  private convertBigIntToString(obj: any): any {
    if (typeof obj === 'bigint') {
      return obj.toString();
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.convertBigIntToString(item));
    }
    if (obj !== null && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.convertBigIntToString(value);
      }
      return result;
    }
    return obj;
  }
}

/**
 * Factory function
 */
export function createRollupReporter(): RollupReporter {
  return new RollupReporter();
}
