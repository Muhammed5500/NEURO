/**
 * Bundle Simulator
 * 
 * Simulates execution bundles on forked chain / local EVM.
 * Produces bundle receipts with expected state diffs.
 * 
 * Turkish Requirements:
 * - State Diff Analysis: "işlem sonrasında cüzdanın MON bakiyesi ve hedeflenen
 *   token bakiyesindeki net değişimi (net state diff) raporla"
 * - Slippage Guard: "fiyat kayması %2.5 limitini aşarsa planı anında iptal et
 *   ve 'Slippage Breach' hatası döndür"
 * - Simulation Consistency: "3 blok (1.2 saniye) geçtiyse simülasyonu bayat
 *   (stale) kabul et ve yenilenmesini iste"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  AtomicBundle,
  ExecutionStep,
  BundleSimulationReceipt,
  StepSimulationResult,
  AddressStateDiff,
} from "./types.js";
import { MONAD_CONSTANTS } from "./types.js";

const simLogger = logger.child({ component: "bundle-simulator" });

// ============================================
// SIMULATOR CONFIGURATION
// ============================================

export interface SimulatorConfig {
  // RPC URL for forked simulation
  rpcUrl?: string;
  
  // Fork at specific block (undefined = latest)
  forkBlockNumber?: bigint;
  
  // Use local EVM (mock) instead of fork
  useLocalEvm: boolean;
  
  // Slippage limit
  // Turkish: "%2.5 limitini aşarsa planı anında iptal et"
  maxSlippagePercent: number;
  
  // Staleness threshold
  // Turkish: "3 blok (1.2 saniye) geçtiyse simülasyonu bayat kabul et"
  staleThresholdBlocks: number;
  staleThresholdMs: number;
}

const DEFAULT_CONFIG: SimulatorConfig = {
  useLocalEvm: true,
  maxSlippagePercent: 2.5, // Turkish requirement
  staleThresholdBlocks: MONAD_CONSTANTS.STALE_SIMULATION_BLOCKS,
  staleThresholdMs: MONAD_CONSTANTS.STALE_SIMULATION_MS,
};

// ============================================
// LOCAL EVM MOCK
// ============================================

/**
 * Mock EVM state for local simulation
 */
interface MockEvmState {
  blockNumber: bigint;
  timestamp: number;
  balances: Map<string, bigint>; // address -> MON balance
  tokenBalances: Map<string, Map<string, bigint>>; // token -> address -> balance
  nonces: Map<string, number>;
}

function createMockEvmState(): MockEvmState {
  return {
    blockNumber: 15000000n,
    timestamp: Date.now(),
    balances: new Map(),
    tokenBalances: new Map(),
    nonces: new Map(),
  };
}

// ============================================
// BUNDLE SIMULATOR
// ============================================

export class BundleSimulator {
  private readonly config: SimulatorConfig;
  private mockState: MockEvmState;

  constructor(config?: Partial<SimulatorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mockState = createMockEvmState();
  }

  /**
   * Simulate an atomic bundle
   * Turkish: "forked chain simulation (or local EVM) to dry-run bundle"
   */
  async simulate(
    bundle: AtomicBundle,
    walletAddress: string,
    options?: {
      initialMonBalance?: string;
      initialTokenBalances?: Record<string, string>;
    }
  ): Promise<BundleSimulationReceipt> {
    const startTime = Date.now();
    simLogger.info({
      bundleId: bundle.id,
      steps: bundle.totalSteps,
      walletAddress,
    }, "Starting bundle simulation");

    // Initialize mock state
    this.initializeMockState(walletAddress, options);

    const simulationBlockNumber = this.mockState.blockNumber;
    const simulationTimestamp = this.mockState.timestamp;

    // Simulate each step
    const stepResults: StepSimulationResult[] = [];
    let allStepsSucceeded = true;
    let failedStepIndex: number | undefined;
    let failedStepReason: string | undefined;
    let totalGasUsed = 0n;

    // Track price impact
    let priceImpact: BundleSimulationReceipt["priceImpact"] | undefined;

    for (const step of bundle.steps) {
      // Check dependencies
      if (step.dependsOn) {
        const dependenciesMet = step.dependsOn.every(depId => {
          const depResult = stepResults.find(r => r.stepId === depId);
          return depResult?.success;
        });

        if (!dependenciesMet) {
          stepResults.push(this.createFailedStepResult(
            step,
            "Dependency step failed",
            walletAddress
          ));
          allStepsSucceeded = false;
          failedStepIndex = step.index;
          failedStepReason = "Dependency step failed";
          break;
        }
      }

      // Simulate the step
      const result = await this.simulateStep(step, walletAddress, bundle);
      stepResults.push(result);
      totalGasUsed += result.gasUsed;

      // Check for swap and extract price impact
      if (step.type === "swap" && result.success) {
        priceImpact = this.extractPriceImpact(step, result);
        
        // Turkish: "fiyat kayması %2.5 limitini aşarsa planı anında iptal et"
        if (priceImpact && priceImpact.impactPercent > this.config.maxSlippagePercent) {
          result.success = false;
          result.revertReason = `Slippage Breach: ${priceImpact.impactPercent.toFixed(2)}% > ${this.config.maxSlippagePercent}%`;
          allStepsSucceeded = false;
          failedStepIndex = step.index;
          failedStepReason = result.revertReason;
          break;
        }
      }

      if (!result.success) {
        allStepsSucceeded = false;
        failedStepIndex = step.index;
        failedStepReason = result.revertReason;

        // Handle failure mode
        if (step.failureMode === "abort_all") {
          simLogger.warn({
            stepId: step.id,
            reason: result.revertReason,
          }, "Step failed, aborting bundle");
          break;
        }
      }
    }

    // Calculate aggregated state diffs
    // Turkish: "cüzdanın MON bakiyesi ve hedeflenen token bakiyesindeki net değişimi"
    const aggregatedStateDiffs = this.calculateAggregatedStateDiffs(
      stepResults,
      walletAddress
    );

    // Calculate actual slippage
    const actualSlippage = priceImpact?.impactPercent || 0;
    const slippageCheck = {
      passed: actualSlippage <= this.config.maxSlippagePercent,
      actualSlippage,
      maxAllowedSlippage: this.config.maxSlippagePercent,
      breachedBy: actualSlippage > this.config.maxSlippagePercent
        ? actualSlippage - this.config.maxSlippagePercent
        : undefined,
    };

    // Staleness check (will be verified at execution time)
    const stalenessCheck = {
      isStale: false,
      blocksSinceSimulation: 0,
      timeSinceSimulationMs: 0,
      threshold: {
        maxBlocks: this.config.staleThresholdBlocks,
        maxMs: this.config.staleThresholdMs,
      },
    };

    // Generate warnings and recommendations
    const { warnings, recommendations } = this.generateWarningsAndRecommendations(
      allStepsSucceeded,
      slippageCheck,
      priceImpact,
      totalGasUsed,
      bundle.totalEstimatedGas
    );

    // Calculate costs
    const actualCostWei = (totalGasUsed * bundle.maxFeePerGas).toString();
    const actualCostMon = Number(actualCostWei) / 1e18;

    const receipt: BundleSimulationReceipt = {
      id: crypto.randomUUID(),
      bundleId: bundle.id,
      simulatedAt: new Date(startTime).toISOString(),
      simulationBlockNumber,
      simulationBlockTimestamp: simulationTimestamp,
      success: allStepsSucceeded && slippageCheck.passed,
      allStepsSucceeded,
      failedStepIndex,
      failedStepReason,
      stepResults,
      aggregatedStateDiffs,
      totalGasUsed,
      totalGasEstimated: bundle.totalEstimatedGas,
      gasEfficiency: Number(totalGasUsed) / Number(bundle.totalEstimatedGas),
      actualCostWei,
      actualCostMon,
      priceImpact,
      slippageCheck,
      stalenessCheck,
      warnings,
      recommendations,
    };

    simLogger.info({
      receiptId: receipt.id,
      success: receipt.success,
      totalGasUsed: totalGasUsed.toString(),
      actualCostMon,
      simulationTimeMs: Date.now() - startTime,
    }, "Bundle simulation complete");

    return receipt;
  }

  /**
   * Check if a simulation receipt is stale
   * Turkish: "3 blok (1.2 saniye) geçtiyse simülasyonu bayat kabul et"
   */
  checkStaleness(
    receipt: BundleSimulationReceipt,
    currentBlockNumber: bigint
  ): {
    isStale: boolean;
    blocksSince: number;
    timeSinceMs: number;
    requiresRefresh: boolean;
  } {
    const blocksSince = Number(currentBlockNumber - receipt.simulationBlockNumber);
    const timeSinceMs = Date.now() - new Date(receipt.simulatedAt).getTime();

    const isStale = 
      blocksSince >= this.config.staleThresholdBlocks ||
      timeSinceMs >= this.config.staleThresholdMs;

    return {
      isStale,
      blocksSince,
      timeSinceMs,
      requiresRefresh: isStale,
    };
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private initializeMockState(
    walletAddress: string,
    options?: {
      initialMonBalance?: string;
      initialTokenBalances?: Record<string, string>;
    }
  ): void {
    // Reset state
    this.mockState = createMockEvmState();

    // Set initial MON balance
    const initialMon = options?.initialMonBalance || "10000000000000000000"; // 10 MON
    this.mockState.balances.set(walletAddress.toLowerCase(), BigInt(initialMon));

    // Set initial token balances
    if (options?.initialTokenBalances) {
      for (const [token, balance] of Object.entries(options.initialTokenBalances)) {
        if (!this.mockState.tokenBalances.has(token.toLowerCase())) {
          this.mockState.tokenBalances.set(token.toLowerCase(), new Map());
        }
        this.mockState.tokenBalances
          .get(token.toLowerCase())!
          .set(walletAddress.toLowerCase(), BigInt(balance));
      }
    }

    // Set initial nonce
    this.mockState.nonces.set(walletAddress.toLowerCase(), 0);
  }

  private async simulateStep(
    step: ExecutionStep,
    walletAddress: string,
    bundle: AtomicBundle
  ): Promise<StepSimulationResult> {
    const wallet = walletAddress.toLowerCase();
    const balanceBefore = this.mockState.balances.get(wallet) || 0n;
    const nonceBefore = this.mockState.nonces.get(wallet) || 0;

    // Simulate based on step type
    let success = true;
    let revertReason: string | undefined;
    let gasUsed = step.estimatedGas * 90n / 100n; // Assume 90% of estimate
    const logs: StepSimulationResult["logs"] = [];
    const stateDiffs: AddressStateDiff[] = [];

    try {
      switch (step.type) {
        case "createToken":
          await this.simulateCreateToken(step, wallet);
          break;
        case "addLiquidity":
          await this.simulateAddLiquidity(step, wallet, bundle);
          break;
        case "swap":
          await this.simulateSwap(step, wallet, bundle);
          break;
        case "approve":
          await this.simulateApprove(step, wallet);
          break;
        default:
          // Generic simulation
          break;
      }

      // Deduct gas cost
      const gasCost = gasUsed * bundle.maxFeePerGas;
      const currentBalance = this.mockState.balances.get(wallet) || 0n;
      this.mockState.balances.set(wallet, currentBalance - gasCost);

      // Increment nonce
      this.mockState.nonces.set(wallet, nonceBefore + 1);

    } catch (error) {
      success = false;
      revertReason = error instanceof Error ? error.message : "Unknown error";
      gasUsed = step.estimatedGas; // Failed txs use full gas
    }

    // Calculate state diff for this step
    const balanceAfter = this.mockState.balances.get(wallet) || 0n;
    const nonceAfter = this.mockState.nonces.get(wallet) || 0;

    // Get token balance changes
    const tokenChanges: AddressStateDiff["tokenChanges"] = [];
    if (bundle.targetTokenAddress) {
      const tokenAddr = bundle.targetTokenAddress.toLowerCase();
      const tokenMap = this.mockState.tokenBalances.get(tokenAddr);
      const tokenBalance = tokenMap?.get(wallet) || 0n;
      
      tokenChanges.push({
        tokenAddress: bundle.targetTokenAddress,
        tokenSymbol: bundle.targetTokenSymbol,
        balanceBefore: "0", // Simplified
        balanceAfter: tokenBalance.toString(),
        balanceChange: tokenBalance.toString(),
        balanceChangeFormatted: `${Number(tokenBalance) / 1e18}`,
      });
    }

    stateDiffs.push({
      address: walletAddress,
      monBalanceBefore: balanceBefore.toString(),
      monBalanceAfter: balanceAfter.toString(),
      monBalanceChange: (balanceAfter - balanceBefore).toString(),
      monBalanceChangeMon: Number(balanceAfter - balanceBefore) / 1e18,
      tokenChanges,
      nonceBefore,
      nonceAfter,
    });

    return {
      stepId: step.id,
      stepIndex: step.index,
      success,
      revertReason,
      gasUsed,
      logs,
      stateDiffs,
    };
  }

  private async simulateCreateToken(
    step: ExecutionStep,
    wallet: string
  ): Promise<void> {
    // Mock: create token succeeds, generates new token address
    const newTokenAddress = `0x${crypto.randomUUID().replace(/-/g, "").slice(0, 40)}`;
    
    // Initialize token balance map
    this.mockState.tokenBalances.set(newTokenAddress.toLowerCase(), new Map());
    
    simLogger.debug({ tokenAddress: newTokenAddress }, "Simulated token creation");
  }

  private async simulateAddLiquidity(
    step: ExecutionStep,
    wallet: string,
    bundle: AtomicBundle
  ): Promise<void> {
    const value = BigInt(step.value);
    const currentBalance = this.mockState.balances.get(wallet) || 0n;
    
    if (currentBalance < value) {
      throw new Error("Insufficient MON balance for liquidity");
    }

    // Deduct MON for liquidity
    this.mockState.balances.set(wallet, currentBalance - value);
    
    simLogger.debug({ value: value.toString() }, "Simulated add liquidity");
  }

  private async simulateSwap(
    step: ExecutionStep,
    wallet: string,
    bundle: AtomicBundle
  ): Promise<void> {
    const value = BigInt(step.value);
    const currentBalance = this.mockState.balances.get(wallet) || 0n;

    if (step.description.includes("Buy")) {
      // Buying tokens with MON
      if (currentBalance < value) {
        throw new Error("Insufficient MON balance for swap");
      }
      
      // Deduct MON
      this.mockState.balances.set(wallet, currentBalance - value);
      
      // Credit tokens (mock: 1 MON = 1000 tokens)
      if (bundle.targetTokenAddress) {
        const tokenAddr = bundle.targetTokenAddress.toLowerCase();
        if (!this.mockState.tokenBalances.has(tokenAddr)) {
          this.mockState.tokenBalances.set(tokenAddr, new Map());
        }
        const tokenBalance = this.mockState.tokenBalances.get(tokenAddr)!.get(wallet) || 0n;
        const tokensReceived = value * 1000n; // Mock conversion rate
        this.mockState.tokenBalances.get(tokenAddr)!.set(wallet, tokenBalance + tokensReceived);
      }
    } else {
      // Selling tokens for MON
      // Mock: credit MON for sold tokens
      this.mockState.balances.set(wallet, currentBalance + value);
    }

    simLogger.debug({ value: value.toString() }, "Simulated swap");
  }

  private async simulateApprove(
    step: ExecutionStep,
    wallet: string
  ): Promise<void> {
    // Approve always succeeds in mock
    simLogger.debug({ spender: step.to }, "Simulated approval");
  }

  private extractPriceImpact(
    step: ExecutionStep,
    result: StepSimulationResult
  ): BundleSimulationReceipt["priceImpact"] {
    // In production, this would analyze the swap event logs
    // For mock, we estimate based on trade size
    const tradeValue = BigInt(step.value);
    const tradeValueMon = Number(tradeValue) / 1e18;
    
    // Mock: larger trades have higher impact
    const impactPercent = Math.min(tradeValueMon * 0.5, 5); // 0.5% per MON, max 5%
    
    return {
      impactPercent,
      impactBps: impactPercent * 100,
      expectedPrice: 0.001, // Mock
      actualPrice: 0.001 * (1 + impactPercent / 100),
    };
  }

  private calculateAggregatedStateDiffs(
    stepResults: StepSimulationResult[],
    walletAddress: string
  ): AddressStateDiff[] {
    // Aggregate all step state diffs into final state
    const aggregated = new Map<string, AddressStateDiff>();

    for (const result of stepResults) {
      for (const diff of result.stateDiffs) {
        const addr = diff.address.toLowerCase();
        if (!aggregated.has(addr)) {
          aggregated.set(addr, diff);
        } else {
          // Update with latest values
          const existing = aggregated.get(addr)!;
          existing.monBalanceAfter = diff.monBalanceAfter;
          existing.monBalanceChange = (
            BigInt(diff.monBalanceAfter) - BigInt(existing.monBalanceBefore)
          ).toString();
          existing.monBalanceChangeMon = Number(existing.monBalanceChange) / 1e18;
          existing.nonceAfter = diff.nonceAfter;
          
          // Merge token changes
          for (const tokenChange of diff.tokenChanges) {
            const existingToken = existing.tokenChanges.find(
              tc => tc.tokenAddress.toLowerCase() === tokenChange.tokenAddress.toLowerCase()
            );
            if (existingToken) {
              existingToken.balanceAfter = tokenChange.balanceAfter;
              existingToken.balanceChange = (
                BigInt(tokenChange.balanceAfter) - BigInt(existingToken.balanceBefore)
              ).toString();
              existingToken.balanceChangeFormatted = 
                `${Number(existingToken.balanceChange) / 1e18}`;
            } else {
              existing.tokenChanges.push(tokenChange);
            }
          }
        }
      }
    }

    return Array.from(aggregated.values());
  }

  private generateWarningsAndRecommendations(
    allStepsSucceeded: boolean,
    slippageCheck: BundleSimulationReceipt["slippageCheck"],
    priceImpact: BundleSimulationReceipt["priceImpact"],
    totalGasUsed: bigint,
    totalGasEstimated: bigint
  ): { warnings: string[]; recommendations: string[] } {
    const warnings: string[] = [];
    const recommendations: string[] = [];

    if (!allStepsSucceeded) {
      warnings.push("Not all steps succeeded in simulation");
      recommendations.push("Review failed steps before execution");
    }

    if (!slippageCheck.passed) {
      warnings.push(`Slippage breach: ${slippageCheck.actualSlippage.toFixed(2)}% exceeds ${slippageCheck.maxAllowedSlippage}% limit`);
      recommendations.push("Reduce trade size or increase slippage tolerance");
    } else if (slippageCheck.actualSlippage > slippageCheck.maxAllowedSlippage * 0.8) {
      warnings.push(`Slippage near limit: ${slippageCheck.actualSlippage.toFixed(2)}%`);
    }

    const gasEfficiency = Number(totalGasUsed) / Number(totalGasEstimated);
    if (gasEfficiency > 1.1) {
      warnings.push(`Gas usage ${((gasEfficiency - 1) * 100).toFixed(0)}% higher than estimated`);
    }

    if (priceImpact && priceImpact.impactPercent > 1) {
      warnings.push(`Price impact ${priceImpact.impactPercent.toFixed(2)}% may affect execution`);
      recommendations.push("Consider splitting into smaller trades");
    }

    if (warnings.length === 0) {
      recommendations.push("Simulation passed all checks, ready for execution");
    }

    return { warnings, recommendations };
  }
}

/**
 * Factory function
 */
export function createBundleSimulator(
  config?: Partial<SimulatorConfig>
): BundleSimulator {
  return new BundleSimulator(config);
}
