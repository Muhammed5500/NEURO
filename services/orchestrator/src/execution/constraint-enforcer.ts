/**
 * Constraint Enforcer
 * 
 * Enforces execution constraints:
 * - Max slippage
 * - Max budget
 * - Deny if risk score too high
 * 
 * Turkish Requirements:
 * - Slippage Guard: "%2.5 limitini aşarsa planı anında iptal et"
 * - Simulation Consistency: "3 blok geçtiyse simülasyonu bayat kabul et"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  AtomicBundle,
  BundleSimulationReceipt,
  ExecutionConstraints,
  ConstraintViolation,
  ConstraintViolationType,
} from "./types.js";
import { DEFAULT_CONSTRAINTS, MONAD_CONSTANTS } from "./types.js";

const enforcerLogger = logger.child({ component: "constraint-enforcer" });

// ============================================
// CONSTRAINT ENFORCER
// ============================================

export class ConstraintEnforcer {
  private readonly constraints: ExecutionConstraints;

  constructor(constraints?: Partial<ExecutionConstraints>) {
    this.constraints = { ...DEFAULT_CONSTRAINTS, ...constraints };
  }

  /**
   * Enforce all constraints on a bundle and simulation result
   */
  enforceAll(
    bundle: AtomicBundle,
    simulation: BundleSimulationReceipt,
    riskScore: number,
    currentBlockNumber?: bigint
  ): {
    passed: boolean;
    violations: ConstraintViolation[];
    canExecute: boolean;
    blockingReasons: string[];
  } {
    const violations: ConstraintViolation[] = [];
    const blockingReasons: string[] = [];

    // 1. Slippage check
    // Turkish: "fiyat kayması %2.5 limitini aşarsa planı anında iptal et"
    const slippageViolation = this.checkSlippage(simulation);
    if (slippageViolation) {
      violations.push(slippageViolation);
      blockingReasons.push(slippageViolation.message);
    }

    // 2. Budget check
    const budgetViolation = this.checkBudget(bundle);
    if (budgetViolation) {
      violations.push(budgetViolation);
      blockingReasons.push(budgetViolation.message);
    }

    // 3. Risk score check
    const riskViolation = this.checkRiskScore(riskScore);
    if (riskViolation) {
      violations.push(riskViolation);
      blockingReasons.push(riskViolation.message);
    }

    // 4. Gas price check
    const gasViolation = this.checkGasPrice(bundle);
    if (gasViolation) {
      violations.push(gasViolation);
      if (gasViolation.severity === "critical") {
        blockingReasons.push(gasViolation.message);
      }
    }

    // 5. Simulation staleness check
    // Turkish: "3 blok (1.2 saniye) geçtiyse simülasyonu bayat kabul et"
    if (currentBlockNumber !== undefined) {
      const stalenessViolation = this.checkStaleness(simulation, currentBlockNumber);
      if (stalenessViolation) {
        violations.push(stalenessViolation);
        blockingReasons.push(stalenessViolation.message);
      }
    }

    // 6. Simulation success check
    if (!simulation.success) {
      const simViolation: ConstraintViolation = {
        type: "simulation_failed",
        message: `Simulation failed: ${simulation.failedStepReason || "unknown error"}`,
        actual: "failed",
        limit: "success",
        severity: "critical",
      };
      violations.push(simViolation);
      blockingReasons.push(simViolation.message);
    }

    const criticalViolations = violations.filter(v => v.severity === "critical");
    const passed = criticalViolations.length === 0;
    const canExecute = passed && !this.constraints.requireManualApproval;

    enforcerLogger.info({
      bundleId: bundle.id,
      passed,
      violationCount: violations.length,
      criticalCount: criticalViolations.length,
      canExecute,
    }, "Constraint enforcement complete");

    return {
      passed,
      violations,
      canExecute,
      blockingReasons,
    };
  }

  /**
   * Check slippage constraint
   * Turkish: "belirlenen %2.5 limitini aşarsa planı anında iptal et ve 'Slippage Breach' hatası döndür"
   */
  checkSlippage(simulation: BundleSimulationReceipt): ConstraintViolation | null {
    if (!simulation.slippageCheck.passed) {
      return {
        type: "slippage_breach",
        message: `Slippage Breach: ${simulation.slippageCheck.actualSlippage.toFixed(2)}% exceeds ${this.constraints.maxSlippagePercent}% limit`,
        actual: simulation.slippageCheck.actualSlippage,
        limit: this.constraints.maxSlippagePercent,
        severity: "critical",
      };
    }

    // Warn if close to limit
    if (simulation.slippageCheck.actualSlippage > this.constraints.maxSlippagePercent * 0.8) {
      return {
        type: "slippage_breach",
        message: `Slippage warning: ${simulation.slippageCheck.actualSlippage.toFixed(2)}% approaching ${this.constraints.maxSlippagePercent}% limit`,
        actual: simulation.slippageCheck.actualSlippage,
        limit: this.constraints.maxSlippagePercent,
        severity: "warning",
      };
    }

    return null;
  }

  /**
   * Check budget constraint
   */
  checkBudget(bundle: AtomicBundle): ConstraintViolation | null {
    const maxCostMon = bundle.maxCostMon;
    
    if (maxCostMon > this.constraints.maxBudgetMon) {
      return {
        type: "budget_exceeded",
        message: `Budget exceeded: ${maxCostMon.toFixed(4)} MON > ${this.constraints.maxBudgetMon} MON limit`,
        actual: maxCostMon,
        limit: this.constraints.maxBudgetMon,
        severity: "critical",
      };
    }

    // Warn if over 80% of budget
    if (maxCostMon > this.constraints.maxBudgetMon * 0.8) {
      return {
        type: "budget_exceeded",
        message: `Budget warning: ${maxCostMon.toFixed(4)} MON is ${((maxCostMon / this.constraints.maxBudgetMon) * 100).toFixed(0)}% of budget`,
        actual: maxCostMon,
        limit: this.constraints.maxBudgetMon,
        severity: "warning",
      };
    }

    return null;
  }

  /**
   * Check risk score constraint
   */
  checkRiskScore(riskScore: number): ConstraintViolation | null {
    if (riskScore > this.constraints.maxRiskScore) {
      return {
        type: "risk_too_high",
        message: `Risk too high: ${(riskScore * 100).toFixed(0)}% > ${(this.constraints.maxRiskScore * 100).toFixed(0)}% threshold`,
        actual: riskScore,
        limit: this.constraints.maxRiskScore,
        severity: "critical",
      };
    }

    // Warn if close to threshold
    if (riskScore > this.constraints.maxRiskScore * 0.8) {
      return {
        type: "risk_too_high",
        message: `Risk warning: ${(riskScore * 100).toFixed(0)}% approaching threshold`,
        actual: riskScore,
        limit: this.constraints.maxRiskScore,
        severity: "warning",
      };
    }

    return null;
  }

  /**
   * Check gas price constraint
   */
  checkGasPrice(bundle: AtomicBundle): ConstraintViolation | null {
    const gasPriceGwei = Number(bundle.maxFeePerGas) / 1e9;

    if (gasPriceGwei > this.constraints.maxGasPriceGwei) {
      return {
        type: "gas_price_too_high",
        message: `Gas price too high: ${gasPriceGwei.toFixed(0)} gwei > ${this.constraints.maxGasPriceGwei} gwei limit`,
        actual: gasPriceGwei,
        limit: this.constraints.maxGasPriceGwei,
        severity: gasPriceGwei > this.constraints.maxGasPriceGwei * 1.5 ? "critical" : "warning",
      };
    }

    return null;
  }

  /**
   * Check simulation staleness
   * Turkish: "3 blok (1.2 saniye) geçtiyse simülasyonu bayat (stale) kabul et ve yenilenmesini iste"
   */
  checkStaleness(
    simulation: BundleSimulationReceipt,
    currentBlockNumber: bigint
  ): ConstraintViolation | null {
    const blocksSince = Number(currentBlockNumber - simulation.simulationBlockNumber);
    const timeSinceMs = Date.now() - new Date(simulation.simulatedAt).getTime();

    const isStale = 
      blocksSince >= MONAD_CONSTANTS.STALE_SIMULATION_BLOCKS ||
      timeSinceMs >= MONAD_CONSTANTS.STALE_SIMULATION_MS;

    if (isStale) {
      return {
        type: "simulation_stale",
        message: `Simulation stale: ${blocksSince} blocks / ${timeSinceMs}ms since simulation (threshold: ${MONAD_CONSTANTS.STALE_SIMULATION_BLOCKS} blocks / ${MONAD_CONSTANTS.STALE_SIMULATION_MS}ms)`,
        actual: `${blocksSince} blocks`,
        limit: `${MONAD_CONSTANTS.STALE_SIMULATION_BLOCKS} blocks`,
        severity: "critical",
      };
    }

    return null;
  }

  /**
   * Update constraints
   */
  updateConstraints(newConstraints: Partial<ExecutionConstraints>): void {
    Object.assign(this.constraints, newConstraints);
  }

  /**
   * Get current constraints
   */
  getConstraints(): ExecutionConstraints {
    return { ...this.constraints };
  }
}

/**
 * Factory function
 */
export function createConstraintEnforcer(
  constraints?: Partial<ExecutionConstraints>
): ConstraintEnforcer {
  return new ConstraintEnforcer(constraints);
}
