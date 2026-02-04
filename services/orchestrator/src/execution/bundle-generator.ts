/**
 * Bundle Generator
 * 
 * Generates atomic execution bundles for trading operations.
 * Plan steps: createToken, addLiquidity, initialSwap
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { FinalDecision } from "../graph/state.js";
import type {
  AtomicBundle,
  ExecutionStep,
  ExecutionStepType,
  ExecutionConstraints,
} from "./types.js";
import { MONAD_CONSTANTS, DEFAULT_CONSTRAINTS } from "./types.js";

const genLogger = logger.child({ component: "bundle-generator" });

// ============================================
// CONFIGURATION
// ============================================

export interface BundleGeneratorConfig {
  // Default addresses (would come from env/config)
  nadFunFactoryAddress: string;
  nadFunRouterAddress: string;
  wmonAddress: string;
  
  // Gas settings
  defaultGasPerStep: bigint;
  gasBufferPercent: number;
  
  // Default constraints
  constraints: ExecutionConstraints;
}

const DEFAULT_CONFIG: BundleGeneratorConfig = {
  nadFunFactoryAddress: "0x0000000000000000000000000000000000000001",
  nadFunRouterAddress: "0x0000000000000000000000000000000000000002",
  wmonAddress: "0x0000000000000000000000000000000000000003",
  defaultGasPerStep: 250000n,
  gasBufferPercent: MONAD_CONSTANTS.GAS_BUFFER_PERCENT,
  constraints: DEFAULT_CONSTRAINTS,
};

// ============================================
// CALLDATA ENCODERS
// ============================================

/**
 * Encode createToken calldata for nad.fun
 */
function encodeCreateToken(params: {
  name: string;
  symbol: string;
  description?: string;
  initialSupply?: bigint;
}): string {
  // In production, this would use ethers/viem to encode
  // For now, return a mock encoded calldata
  const methodId = "0x12345678"; // createToken(string,string,string,uint256)
  return methodId + "0".repeat(64 * 4); // Placeholder
}

/**
 * Encode addLiquidity calldata for nad.fun
 */
function encodeAddLiquidity(params: {
  tokenAddress: string;
  tokenAmount: bigint;
  monAmount: bigint;
  minLiquidity: bigint;
  deadline: number;
}): string {
  const methodId = "0x87654321"; // addLiquidity(...)
  return methodId + "0".repeat(64 * 5);
}

/**
 * Encode swap calldata for nad.fun
 * Turkish: "nad.fun bonding curve mekaniğine göre"
 */
function encodeSwap(params: {
  tokenAddress: string;
  amountIn: bigint;
  minAmountOut: bigint;
  isBuy: boolean;
  deadline: number;
}): string {
  const methodId = params.isBuy ? "0xaaaabbbb" : "0xccccdddd";
  return methodId + "0".repeat(64 * 4);
}

/**
 * Encode approve calldata
 */
function encodeApprove(params: {
  spender: string;
  amount: bigint;
}): string {
  const methodId = "0x095ea7b3"; // approve(address,uint256)
  return methodId + "0".repeat(64 * 2);
}

// ============================================
// BUNDLE GENERATOR
// ============================================

export class BundleGenerator {
  private readonly config: BundleGeneratorConfig;

  constructor(config?: Partial<BundleGeneratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate execution bundle from consensus decision
   */
  generateFromDecision(
    decision: FinalDecision,
    options: {
      walletAddress: string;
      targetToken?: {
        address?: string;
        symbol: string;
        name?: string;
      };
      tradeAmount: number;
      tradeAmountWei: string;
      maxSlippagePercent?: number;
      maxBudgetMon?: number;
    }
  ): AtomicBundle {
    genLogger.info({
      recommendation: decision.recommendation,
      targetToken: options.targetToken?.symbol,
    }, "Generating execution bundle from decision");

    const steps: ExecutionStep[] = [];
    const now = new Date();

    // Determine what steps are needed based on decision
    switch (decision.recommendation) {
      case "buy":
        // Simple buy on existing token
        steps.push(
          this.createSwapStep(0, {
            tokenAddress: options.targetToken?.address || "",
            amountInWei: options.tradeAmountWei,
            isBuy: true,
            maxSlippage: options.maxSlippagePercent || this.config.constraints.maxSlippagePercent,
          })
        );
        break;

      case "sell":
        // Approve + Sell
        if (options.targetToken?.address) {
          steps.push(
            this.createApproveStep(0, {
              tokenAddress: options.targetToken.address,
              spender: this.config.nadFunRouterAddress,
              amount: options.tradeAmountWei,
            })
          );
          steps.push(
            this.createSwapStep(1, {
              tokenAddress: options.targetToken.address,
              amountInWei: options.tradeAmountWei,
              isBuy: false,
              maxSlippage: options.maxSlippagePercent || this.config.constraints.maxSlippagePercent,
              dependsOn: ["step-0"],
            })
          );
        }
        break;

      default:
        genLogger.warn({ action: decision.action }, "Unknown action, generating empty bundle");
    }

    // Calculate totals with 15% gas buffer
    // Turkish: "gas_limit değerine otomatik olarak %15 güvenlik marjı ekle"
    const totalEstimatedGas = steps.reduce((sum, s) => sum + s.estimatedGas, 0n);
    const bufferMultiplier = 100 + this.config.gasBufferPercent;
    const totalEstimatedGasWithBuffer = (totalEstimatedGas * BigInt(bufferMultiplier)) / 100n;

    // Estimate gas price (would fetch from network in production)
    const maxFeePerGas = 50000000000n; // 50 gwei
    const maxPriorityFeePerGas = 2000000000n; // 2 gwei

    const estimatedCostWei = totalEstimatedGasWithBuffer * maxFeePerGas;
    const maxCostWei = estimatedCostWei; // Same since we use maxFee

    const bundle: AtomicBundle = {
      id: crypto.randomUUID(),
      version: "1.0.0",
      chainId: MONAD_CONSTANTS.CHAIN_ID,
      chainName: MONAD_CONSTANTS.CHAIN_NAME,
      steps,
      totalSteps: steps.length,
      totalEstimatedGas,
      totalEstimatedGasWithBuffer,
      maxFeePerGas,
      maxPriorityFeePerGas,
      estimatedCostWei: estimatedCostWei.toString(),
      estimatedCostMon: Number(estimatedCostWei) / 1e18,
      maxCostWei: maxCostWei.toString(),
      maxCostMon: Number(maxCostWei) / 1e18,
      maxBudgetWei: options.maxBudgetMon 
        ? (BigInt(Math.floor(options.maxBudgetMon * 1e18))).toString()
        : this.config.constraints.maxBudgetWei,
      maxBudgetMon: options.maxBudgetMon || this.config.constraints.maxBudgetMon,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(), // 30 min expiry
      consensusDecisionId: crypto.randomUUID(),
      targetTokenAddress: options.targetToken?.address,
      targetTokenSymbol: options.targetToken?.symbol,
      isAtomic: true,
      requiresApproval: true,
    };

    genLogger.info({
      bundleId: bundle.id,
      steps: bundle.totalSteps,
      estimatedCostMon: bundle.estimatedCostMon,
    }, "Bundle generated successfully");

    return bundle;
  }

  /**
   * Generate a token launch bundle
   * Steps: createToken → addLiquidity → initialSwap
   */
  generateTokenLaunchBundle(options: {
    walletAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDescription?: string;
    initialLiquidityMon: number;
    initialBuyMon?: number;
    maxBudgetMon?: number;
  }): AtomicBundle {
    genLogger.info({
      tokenSymbol: options.tokenSymbol,
      initialLiquidity: options.initialLiquidityMon,
    }, "Generating token launch bundle");

    const steps: ExecutionStep[] = [];
    const now = new Date();

    // Step 1: Create Token
    steps.push(
      this.createTokenStep(0, {
        name: options.tokenName,
        symbol: options.tokenSymbol,
        description: options.tokenDescription,
      })
    );

    // Step 2: Add Liquidity
    const liquidityWei = BigInt(Math.floor(options.initialLiquidityMon * 1e18));
    steps.push(
      this.createAddLiquidityStep(1, {
        // Token address will be determined from step 0 result
        tokenAddress: "0x0", // Placeholder, resolved at execution
        monAmount: liquidityWei,
        dependsOn: ["step-0"],
      })
    );

    // Step 3: Initial Swap (optional)
    if (options.initialBuyMon && options.initialBuyMon > 0) {
      const buyWei = BigInt(Math.floor(options.initialBuyMon * 1e18));
      steps.push(
        this.createSwapStep(2, {
          tokenAddress: "0x0", // Placeholder
          amountInWei: buyWei.toString(),
          isBuy: true,
          maxSlippage: 5, // Higher slippage for launch
          dependsOn: ["step-1"],
        })
      );
    }

    // Calculate totals with 15% gas buffer
    const totalEstimatedGas = steps.reduce((sum, s) => sum + s.estimatedGas, 0n);
    const bufferMultiplier = 100 + this.config.gasBufferPercent;
    const totalEstimatedGasWithBuffer = (totalEstimatedGas * BigInt(bufferMultiplier)) / 100n;

    const maxFeePerGas = 50000000000n;
    const maxPriorityFeePerGas = 2000000000n;
    const estimatedCostWei = totalEstimatedGasWithBuffer * maxFeePerGas;

    // Total value needed: liquidity + optional buy + gas
    const totalValueMon = options.initialLiquidityMon + (options.initialBuyMon || 0);
    const totalValueWei = BigInt(Math.floor(totalValueMon * 1e18));

    const bundle: AtomicBundle = {
      id: crypto.randomUUID(),
      version: "1.0.0",
      chainId: MONAD_CONSTANTS.CHAIN_ID,
      chainName: MONAD_CONSTANTS.CHAIN_NAME,
      steps,
      totalSteps: steps.length,
      totalEstimatedGas,
      totalEstimatedGasWithBuffer,
      maxFeePerGas,
      maxPriorityFeePerGas,
      estimatedCostWei: (estimatedCostWei + totalValueWei).toString(),
      estimatedCostMon: Number(estimatedCostWei + totalValueWei) / 1e18,
      maxCostWei: (estimatedCostWei + totalValueWei).toString(),
      maxCostMon: Number(estimatedCostWei + totalValueWei) / 1e18,
      maxBudgetWei: options.maxBudgetMon
        ? (BigInt(Math.floor(options.maxBudgetMon * 1e18))).toString()
        : this.config.constraints.maxBudgetWei,
      maxBudgetMon: options.maxBudgetMon || this.config.constraints.maxBudgetMon,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      targetTokenSymbol: options.tokenSymbol,
      isAtomic: true,
      requiresApproval: true,
    };

    genLogger.info({
      bundleId: bundle.id,
      steps: bundle.totalSteps,
      totalCostMon: bundle.maxCostMon,
    }, "Token launch bundle generated");

    return bundle;
  }

  // ============================================
  // STEP CREATORS
  // ============================================

  private createTokenStep(
    index: number,
    params: {
      name: string;
      symbol: string;
      description?: string;
    }
  ): ExecutionStep {
    const estimatedGas = 500000n; // Create token is expensive
    const bufferMultiplier = 100 + this.config.gasBufferPercent;

    return {
      id: `step-${index}`,
      index,
      type: "createToken",
      description: `Create token: ${params.symbol}`,
      to: this.config.nadFunFactoryAddress,
      value: "0",
      data: encodeCreateToken(params),
      estimatedGas,
      estimatedGasWithBuffer: (estimatedGas * BigInt(bufferMultiplier)) / 100n,
      expectedResult: {
        tokenAddress: "pending", // Will be known after execution
      },
      failureMode: "abort_all",
      maxRetries: 0, // No retry for create
    };
  }

  private createAddLiquidityStep(
    index: number,
    params: {
      tokenAddress: string;
      monAmount: bigint;
      tokenAmount?: bigint;
      dependsOn?: string[];
    }
  ): ExecutionStep {
    const estimatedGas = 350000n;
    const bufferMultiplier = 100 + this.config.gasBufferPercent;
    const deadline = Math.floor(Date.now() / 1000) + 1800; // 30 min

    return {
      id: `step-${index}`,
      index,
      type: "addLiquidity",
      description: `Add liquidity: ${Number(params.monAmount) / 1e18} MON`,
      to: this.config.nadFunRouterAddress,
      value: params.monAmount.toString(),
      data: encodeAddLiquidity({
        tokenAddress: params.tokenAddress,
        tokenAmount: params.tokenAmount || 0n,
        monAmount: params.monAmount,
        minLiquidity: 0n,
        deadline,
      }),
      estimatedGas,
      estimatedGasWithBuffer: (estimatedGas * BigInt(bufferMultiplier)) / 100n,
      expectedResult: {
        monAmount: params.monAmount.toString(),
      },
      dependsOn: params.dependsOn,
      failureMode: "abort_all",
      maxRetries: 1,
    };
  }

  private createSwapStep(
    index: number,
    params: {
      tokenAddress: string;
      amountInWei: string;
      isBuy: boolean;
      maxSlippage: number;
      dependsOn?: string[];
    }
  ): ExecutionStep {
    const estimatedGas = 200000n;
    const bufferMultiplier = 100 + this.config.gasBufferPercent;
    const deadline = Math.floor(Date.now() / 1000) + 1800;
    
    // Calculate minimum output with slippage
    // In production, this would query the pool first
    const minAmountOut = 0n; // Would be calculated from pool state

    return {
      id: `step-${index}`,
      index,
      type: params.isBuy ? "swap" : "swap",
      description: params.isBuy 
        ? `Buy tokens with ${Number(params.amountInWei) / 1e18} MON`
        : `Sell tokens for MON`,
      to: this.config.nadFunRouterAddress,
      value: params.isBuy ? params.amountInWei : "0",
      data: encodeSwap({
        tokenAddress: params.tokenAddress,
        amountIn: BigInt(params.amountInWei),
        minAmountOut,
        isBuy: params.isBuy,
        deadline,
      }),
      estimatedGas,
      estimatedGasWithBuffer: (estimatedGas * BigInt(bufferMultiplier)) / 100n,
      dependsOn: params.dependsOn,
      failureMode: "abort_all",
      maxRetries: 2,
    };
  }

  private createApproveStep(
    index: number,
    params: {
      tokenAddress: string;
      spender: string;
      amount: string;
    }
  ): ExecutionStep {
    const estimatedGas = 50000n;
    const bufferMultiplier = 100 + this.config.gasBufferPercent;

    return {
      id: `step-${index}`,
      index,
      type: "approve",
      description: `Approve token spending`,
      to: params.tokenAddress,
      value: "0",
      data: encodeApprove({
        spender: params.spender,
        amount: BigInt(params.amount),
      }),
      estimatedGas,
      estimatedGasWithBuffer: (estimatedGas * BigInt(bufferMultiplier)) / 100n,
      failureMode: "abort_all",
      maxRetries: 1,
    };
  }
}

/**
 * Factory function
 */
export function createBundleGenerator(
  config?: Partial<BundleGeneratorConfig>
): BundleGenerator {
  return new BundleGenerator(config);
}
