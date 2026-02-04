/**
 * Execution Plan Service
 * 
 * Main service for generating and validating execution plans.
 * Integrates bundle generation, simulation, and constraint enforcement.
 * 
 * Acceptance Criteria:
 * - Given a decision, system outputs an execution plan and a simulation report
 * - No transaction is broadcast unless manual approval is enabled
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { FinalDecision } from "../graph/state.js";
import type {
  AtomicBundle,
  BundleSimulationReceipt,
  ExecutionPlanOutput,
  ExecutionConstraints,
  ConstraintViolation,
} from "./types.js";
import { DEFAULT_CONSTRAINTS, MONAD_CONSTANTS } from "./types.js";
import { BundleGenerator, createBundleGenerator } from "./bundle-generator.js";
import { BundleSimulator, createBundleSimulator } from "./bundle-simulator.js";
import { ConstraintEnforcer, createConstraintEnforcer } from "./constraint-enforcer.js";

const planLogger = logger.child({ component: "execution-plan-service" });

// ============================================
// SERVICE CONFIGURATION
// ============================================

export interface ExecutionPlanServiceConfig {
  // Contract addresses
  nadFunFactoryAddress?: string;
  nadFunRouterAddress?: string;
  wmonAddress?: string;
  
  // Default constraints
  constraints: Partial<ExecutionConstraints>;
  
  // Simulation settings
  simulation: {
    useLocalEvm: boolean;
    rpcUrl?: string;
  };
  
  // Gas buffer
  // Turkish: "gas_limit değerine otomatik olarak %15 güvenlik marjı ekle"
  gasBufferPercent: number;
}

const DEFAULT_CONFIG: ExecutionPlanServiceConfig = {
  constraints: DEFAULT_CONSTRAINTS,
  simulation: {
    useLocalEvm: true,
  },
  gasBufferPercent: MONAD_CONSTANTS.GAS_BUFFER_PERCENT,
};

// ============================================
// EXECUTION PLAN SERVICE
// ============================================

export class ExecutionPlanService {
  private readonly config: ExecutionPlanServiceConfig;
  private readonly bundleGenerator: BundleGenerator;
  private readonly simulator: BundleSimulator;
  private readonly constraintEnforcer: ConstraintEnforcer;

  constructor(config?: Partial<ExecutionPlanServiceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.bundleGenerator = createBundleGenerator({
      nadFunFactoryAddress: this.config.nadFunFactoryAddress,
      nadFunRouterAddress: this.config.nadFunRouterAddress,
      wmonAddress: this.config.wmonAddress,
      gasBufferPercent: this.config.gasBufferPercent,
      constraints: this.config.constraints as ExecutionConstraints,
    });

    this.simulator = createBundleSimulator({
      useLocalEvm: this.config.simulation.useLocalEvm,
      rpcUrl: this.config.simulation.rpcUrl,
      maxSlippagePercent: this.config.constraints.maxSlippagePercent,
    });

    this.constraintEnforcer = createConstraintEnforcer(this.config.constraints);

    planLogger.info({
      gasBufferPercent: this.config.gasBufferPercent,
      maxSlippage: this.config.constraints.maxSlippagePercent,
    }, "ExecutionPlanService initialized");
  }

  /**
   * Generate execution plan from consensus decision
   * 
   * Acceptance Criteria:
   * "Given a decision, system outputs an execution plan and a simulation report"
   */
  async generatePlan(
    decision: FinalDecision,
    options: {
      walletAddress: string;
      targetToken?: {
        address?: string;
        symbol: string;
        name?: string;
      };
      tradeAmount: number;
      maxSlippagePercent?: number;
      maxBudgetMon?: number;
      riskScore?: number;
      currentBlockNumber?: bigint;
    }
  ): Promise<ExecutionPlanOutput> {
    const startTime = Date.now();
    planLogger.info({
      decisionId: decision.decisionId,
      action: decision.action,
      targetToken: options.targetToken?.symbol,
      tradeAmount: options.tradeAmount,
    }, "Generating execution plan");

    // 1. Validate decision is executable
    if (decision.status !== "EXECUTE") {
      planLogger.warn({
        status: decision.status,
      }, "Decision is not EXECUTE, cannot generate plan");

      throw new Error(`Cannot generate execution plan for decision with status: ${decision.status}`);
    }

    // 2. Generate the atomic bundle
    const bundle = this.bundleGenerator.generateFromDecision(decision, {
      walletAddress: options.walletAddress,
      targetToken: options.targetToken,
      tradeAmount: options.tradeAmount,
      tradeAmountWei: BigInt(Math.floor(options.tradeAmount * 1e18)).toString(),
      maxSlippagePercent: options.maxSlippagePercent,
      maxBudgetMon: options.maxBudgetMon,
    });

    // 3. Simulate the bundle
    // Turkish: "forked chain simulation (or local EVM) to dry-run bundle"
    const simulation = await this.simulator.simulate(
      bundle,
      options.walletAddress,
      {
        initialMonBalance: BigInt(10 * 1e18).toString(), // 10 MON for testing
      }
    );

    // 4. Enforce constraints
    const riskScore = options.riskScore ?? decision.averageRiskScore ?? 0.5;
    const constraintResult = this.constraintEnforcer.enforceAll(
      bundle,
      simulation,
      1 - riskScore, // Convert confidence to risk
      options.currentBlockNumber
    );

    // 5. Determine if manual approval is required
    // Turkish: "No transaction is broadcast unless manual approval is enabled"
    const requiresApproval = this.config.constraints.requireManualApproval ?? true;
    const canExecute = constraintResult.passed && !requiresApproval;

    // Build blocking reasons
    const blockingReasons = [...constraintResult.blockingReasons];
    if (requiresApproval && constraintResult.passed) {
      blockingReasons.push("Manual approval required before execution");
    }

    const output: ExecutionPlanOutput = {
      bundle,
      simulation,
      constraintsChecked: true,
      constraintsPassed: constraintResult.passed,
      violations: constraintResult.violations,
      requiresApproval,
      canExecute,
      blockingReasons,
      generatedAt: new Date().toISOString(),
      consensusDecisionId: output.bundle.consensusDecisionId,
    };

    planLogger.info({
      bundleId: bundle.id,
      simulationSuccess: simulation.success,
      constraintsPassed: constraintResult.passed,
      canExecute,
      violationCount: constraintResult.violations.length,
      generationTimeMs: Date.now() - startTime,
    }, "Execution plan generated");

    return output;
  }

  /**
   * Generate token launch plan
   * Steps: createToken → addLiquidity → initialSwap
   */
  async generateTokenLaunchPlan(options: {
    walletAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDescription?: string;
    initialLiquidityMon: number;
    initialBuyMon?: number;
    maxBudgetMon?: number;
    currentBlockNumber?: bigint;
  }): Promise<ExecutionPlanOutput> {
    planLogger.info({
      tokenSymbol: options.tokenSymbol,
      initialLiquidity: options.initialLiquidityMon,
    }, "Generating token launch plan");

    // Generate bundle
    const bundle = this.bundleGenerator.generateTokenLaunchBundle({
      walletAddress: options.walletAddress,
      tokenName: options.tokenName,
      tokenSymbol: options.tokenSymbol,
      tokenDescription: options.tokenDescription,
      initialLiquidityMon: options.initialLiquidityMon,
      initialBuyMon: options.initialBuyMon,
      maxBudgetMon: options.maxBudgetMon,
    });

    // Simulate
    const simulation = await this.simulator.simulate(
      bundle,
      options.walletAddress,
      {
        initialMonBalance: BigInt(
          Math.ceil((options.initialLiquidityMon + (options.initialBuyMon || 0) + 1) * 1e18)
        ).toString(),
      }
    );

    // Enforce constraints (use 0.5 risk for new tokens)
    const constraintResult = this.constraintEnforcer.enforceAll(
      bundle,
      simulation,
      0.5,
      options.currentBlockNumber
    );

    const requiresApproval = this.config.constraints.requireManualApproval ?? true;
    const canExecute = constraintResult.passed && !requiresApproval;

    const blockingReasons = [...constraintResult.blockingReasons];
    if (requiresApproval && constraintResult.passed) {
      blockingReasons.push("Manual approval required before execution");
    }

    return {
      bundle,
      simulation,
      constraintsChecked: true,
      constraintsPassed: constraintResult.passed,
      violations: constraintResult.violations,
      requiresApproval,
      canExecute,
      blockingReasons,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Refresh simulation if stale
   * Turkish: "simülasyonu bayat kabul et ve yenilenmesini iste"
   */
  async refreshSimulationIfNeeded(
    output: ExecutionPlanOutput,
    currentBlockNumber: bigint,
    walletAddress: string
  ): Promise<ExecutionPlanOutput> {
    const stalenessCheck = this.simulator.checkStaleness(
      output.simulation,
      currentBlockNumber
    );

    if (!stalenessCheck.requiresRefresh) {
      return output;
    }

    planLogger.info({
      bundleId: output.bundle.id,
      blocksSince: stalenessCheck.blocksSince,
      timeSinceMs: stalenessCheck.timeSinceMs,
    }, "Simulation is stale, refreshing");

    // Re-simulate
    const newSimulation = await this.simulator.simulate(
      output.bundle,
      walletAddress
    );

    // Re-enforce constraints
    const riskScore = 0.5; // Default
    const constraintResult = this.constraintEnforcer.enforceAll(
      output.bundle,
      newSimulation,
      riskScore,
      currentBlockNumber
    );

    const requiresApproval = this.config.constraints.requireManualApproval ?? true;
    const canExecute = constraintResult.passed && !requiresApproval;

    const blockingReasons = [...constraintResult.blockingReasons];
    if (requiresApproval && constraintResult.passed) {
      blockingReasons.push("Manual approval required before execution");
    }

    return {
      ...output,
      simulation: newSimulation,
      constraintsPassed: constraintResult.passed,
      violations: constraintResult.violations,
      canExecute,
      blockingReasons,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Format execution plan for display
   */
  formatPlanSummary(output: ExecutionPlanOutput): string {
    const lines: string[] = [];
    
    lines.push("═══════════════════════════════════════════════════════");
    lines.push("                    EXECUTION PLAN                      ");
    lines.push("═══════════════════════════════════════════════════════");
    lines.push("");
    
    // Bundle info
    lines.push(`Bundle ID: ${output.bundle.id}`);
    lines.push(`Chain: ${output.bundle.chainName} (${output.bundle.chainId})`);
    lines.push(`Steps: ${output.bundle.totalSteps}`);
    lines.push(`Generated: ${output.generatedAt}`);
    lines.push("");

    // Steps
    lines.push("─── EXECUTION STEPS ───");
    for (const step of output.bundle.steps) {
      lines.push(`  ${step.index + 1}. ${step.type}: ${step.description}`);
      lines.push(`     Gas: ${step.estimatedGasWithBuffer.toString()} (with 15% buffer)`);
    }
    lines.push("");

    // Costs
    lines.push("─── COST ESTIMATE ───");
    lines.push(`  Estimated: ${output.bundle.estimatedCostMon.toFixed(6)} MON`);
    lines.push(`  Maximum:   ${output.bundle.maxCostMon.toFixed(6)} MON`);
    lines.push(`  Budget:    ${output.bundle.maxBudgetMon.toFixed(6)} MON`);
    lines.push("");

    // Simulation
    lines.push("─── SIMULATION RESULT ───");
    lines.push(`  Success: ${output.simulation.success ? "✅ Yes" : "❌ No"}`);
    if (!output.simulation.success && output.simulation.failedStepReason) {
      lines.push(`  Failure: ${output.simulation.failedStepReason}`);
    }
    lines.push(`  Gas Used: ${output.simulation.totalGasUsed.toString()}`);
    lines.push(`  Efficiency: ${(output.simulation.gasEfficiency * 100).toFixed(1)}%`);
    lines.push("");

    // Slippage
    lines.push("─── SLIPPAGE CHECK ───");
    lines.push(`  Actual:  ${output.simulation.slippageCheck.actualSlippage.toFixed(2)}%`);
    lines.push(`  Limit:   ${output.simulation.slippageCheck.maxAllowedSlippage.toFixed(2)}%`);
    lines.push(`  Status:  ${output.simulation.slippageCheck.passed ? "✅ Passed" : "❌ BREACH"}`);
    lines.push("");

    // State diffs
    if (output.simulation.aggregatedStateDiffs.length > 0) {
      lines.push("─── STATE CHANGES ───");
      for (const diff of output.simulation.aggregatedStateDiffs) {
        lines.push(`  ${diff.address.slice(0, 10)}...:`);
        lines.push(`    MON: ${diff.monBalanceChangeMon >= 0 ? "+" : ""}${diff.monBalanceChangeMon.toFixed(6)}`);
        for (const tc of diff.tokenChanges) {
          lines.push(`    ${tc.tokenSymbol || tc.tokenAddress.slice(0, 10)}: +${tc.balanceChangeFormatted}`);
        }
      }
      lines.push("");
    }

    // Constraints
    lines.push("─── CONSTRAINT CHECK ───");
    lines.push(`  Passed: ${output.constraintsPassed ? "✅ Yes" : "❌ No"}`);
    if (output.violations.length > 0) {
      lines.push("  Violations:");
      for (const v of output.violations) {
        const icon = v.severity === "critical" ? "🚫" : v.severity === "error" ? "❌" : "⚠️";
        lines.push(`    ${icon} ${v.message}`);
      }
    }
    lines.push("");

    // Execution status
    lines.push("─── EXECUTION STATUS ───");
    lines.push(`  Requires Approval: ${output.requiresApproval ? "Yes" : "No"}`);
    lines.push(`  Can Execute: ${output.canExecute ? "✅ Yes" : "❌ No"}`);
    if (output.blockingReasons.length > 0) {
      lines.push("  Blocking Reasons:");
      for (const reason of output.blockingReasons) {
        lines.push(`    • ${reason}`);
      }
    }
    lines.push("");

    // Warnings
    if (output.simulation.warnings.length > 0) {
      lines.push("─── WARNINGS ───");
      for (const w of output.simulation.warnings) {
        lines.push(`  ⚠️ ${w}`);
      }
      lines.push("");
    }

    // Recommendations
    if (output.simulation.recommendations.length > 0) {
      lines.push("─── RECOMMENDATIONS ───");
      for (const r of output.simulation.recommendations) {
        lines.push(`  💡 ${r}`);
      }
      lines.push("");
    }

    lines.push("═══════════════════════════════════════════════════════");

    return lines.join("\n");
  }

  /**
   * Update constraints
   */
  updateConstraints(newConstraints: Partial<ExecutionConstraints>): void {
    this.constraintEnforcer.updateConstraints(newConstraints);
  }
}

/**
 * Factory function
 */
export function createExecutionPlanService(
  config?: Partial<ExecutionPlanServiceConfig>
): ExecutionPlanService {
  return new ExecutionPlanService(config);
}
