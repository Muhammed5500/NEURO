/**
 * OnChain Data Service
 * 
 * High-level service for accessing on-chain data with caching,
 * provider abstraction, and analysis tools integrated.
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { 
  OnChainDataProvider,
  MulticallRequest,
} from "./monad-rpc-client.js";
import type {
  ProviderCapabilities,
  NetworkState,
  PoolLiquidity,
  HolderAnalysis,
  TransactionPattern,
  PriceImpact,
  BotRadarResult,
} from "./types.js";
import { createProviderFromEnv } from "./index.js";
import { BotRadar, createBotRadar } from "./bot-radar.js";
import { PriceImpactCalculator, createPriceImpactCalculator } from "./price-impact.js";

const serviceLogger = logger.child({ component: "onchain-data-service" });

// ============================================
// SERVICE CONFIGURATION
// ============================================

export interface OnChainDataServiceConfig {
  // Optional custom provider
  provider?: OnChainDataProvider;
  
  // Bot radar configuration
  botRadarConfig?: {
    analysisWindowSeconds?: number;
    sandwichTimeWindowMs?: number;
  };
}

// ============================================
// AGGREGATED ON-CHAIN DATA
// ============================================

export interface OnChainAnalysis {
  // Network state
  network: NetworkState;
  
  // Pool data
  pool?: PoolLiquidity;
  
  // Price impact for suggested trade size
  priceImpact?: PriceImpact;
  
  // Bot activity
  botRadar?: BotRadarResult;
  
  // Holder analysis
  holders?: HolderAnalysis;
  
  // Analysis summary
  summary: {
    isGoodTimeToTrade: boolean;
    liquidityStatus: "safe" | "caution" | "dangerous";
    gasStatus: "low" | "medium" | "high" | "extreme";
    botActivityStatus: "none" | "low" | "medium" | "high" | "extreme";
    overallRisk: "low" | "medium" | "high" | "critical";
    recommendations: string[];
  };
  
  // Metadata
  analyzedAt: number;
  providerUsed: string;
  capabilities: ProviderCapabilities;
}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export class OnChainDataService {
  private readonly provider: OnChainDataProvider;
  private readonly botRadar: BotRadar;
  private readonly priceImpactCalculator: PriceImpactCalculator;

  constructor(config?: OnChainDataServiceConfig) {
    this.provider = config?.provider || createProviderFromEnv();
    this.botRadar = createBotRadar(config?.botRadarConfig);
    this.priceImpactCalculator = createPriceImpactCalculator();

    serviceLogger.info({
      provider: this.provider.name,
      capabilities: this.provider.capabilities,
    }, "OnChainDataService initialized");
  }

  /**
   * Get provider capabilities
   */
  getCapabilities(): ProviderCapabilities {
    return this.provider.capabilities;
  }

  /**
   * Get current network state
   */
  async getNetworkState(): Promise<NetworkState> {
    return this.provider.getNetworkState();
  }

  /**
   * Get pool liquidity data
   */
  async getPoolLiquidity(tokenAddress: string): Promise<PoolLiquidity> {
    return this.provider.getPoolLiquidity(tokenAddress);
  }

  /**
   * Calculate price impact for a trade
   */
  async calculatePriceImpact(
    tokenAddress: string,
    tradeAmountMon: number,
    direction: "buy" | "sell"
  ): Promise<PriceImpact> {
    const pool = await this.provider.getPoolLiquidity(tokenAddress);
    return this.priceImpactCalculator.calculateImpact(pool, tradeAmountMon, direction);
  }

  /**
   * Analyze bot activity for a token
   */
  async analyzeBotActivity(tokenAddress: string): Promise<BotRadarResult> {
    return this.botRadar.analyze(this.provider, tokenAddress);
  }

  /**
   * Get holder analysis
   */
  async getHolderAnalysis(tokenAddress: string): Promise<HolderAnalysis> {
    return this.provider.getHolderAnalysis(tokenAddress);
  }

  /**
   * Full on-chain analysis for a token
   */
  async analyzeToken(
    tokenAddress: string,
    tradeAmountMon?: number
  ): Promise<OnChainAnalysis> {
    const startTime = Date.now();

    serviceLogger.info({ tokenAddress, tradeAmountMon }, "Starting full on-chain analysis");

    // Fetch all data in parallel where possible
    const [network, pool, holders, botRadar] = await Promise.all([
      this.provider.getNetworkState(),
      this.provider.getPoolLiquidity(tokenAddress),
      this.provider.getHolderAnalysis(tokenAddress),
      this.botRadar.analyze(this.provider, tokenAddress),
    ]);

    // Calculate price impact if trade amount specified
    let priceImpact: PriceImpact | undefined;
    if (tradeAmountMon && tradeAmountMon > 0) {
      priceImpact = this.priceImpactCalculator.calculateImpact(
        pool,
        tradeAmountMon,
        "buy"
      );
    }

    // Build summary
    const summary = this.buildSummary(network, pool, botRadar, priceImpact);

    const analysis: OnChainAnalysis = {
      network,
      pool,
      priceImpact,
      botRadar,
      holders,
      summary,
      analyzedAt: Date.now(),
      providerUsed: this.provider.name,
      capabilities: this.provider.capabilities,
    };

    serviceLogger.info({
      tokenAddress,
      analysisTimeMs: Date.now() - startTime,
      overallRisk: summary.overallRisk,
    }, "On-chain analysis complete");

    return analysis;
  }

  /**
   * Quick check if it's safe to trade
   */
  async quickTradeCheck(
    tokenAddress: string,
    tradeAmountMon: number
  ): Promise<{
    isSafe: boolean;
    risk: "low" | "medium" | "high" | "critical";
    reasons: string[];
  }> {
    const reasons: string[] = [];

    // Get network state
    const network = await this.provider.getNetworkState();
    if (network.congestionLevel === "extreme") {
      reasons.push("Network congestion is extreme");
    }

    // Get pool data
    const pool = await this.provider.getPoolLiquidity(tokenAddress);
    if (pool.totalLiquidityUsd < 1000) {
      reasons.push("Liquidity is dangerously low");
    }

    // Calculate price impact
    const impact = this.priceImpactCalculator.calculateImpact(pool, tradeAmountMon, "buy");
    if (impact.isHighImpact) {
      reasons.push(`High price impact: ${impact.priceImpactPercent.toFixed(2)}%`);
    }

    // Quick bot check
    const botCheck = await this.botRadar.quickCheck(this.provider, tokenAddress);
    if (botCheck.riskLevel === "high" || botCheck.riskLevel === "extreme") {
      reasons.push(`High bot activity detected`);
    }

    // Determine overall risk
    let risk: "low" | "medium" | "high" | "critical" = "low";
    if (reasons.length === 1) risk = "medium";
    else if (reasons.length === 2) risk = "high";
    else if (reasons.length >= 3) risk = "critical";

    return {
      isSafe: reasons.length === 0,
      risk,
      reasons,
    };
  }

  private buildSummary(
    network: NetworkState,
    pool: PoolLiquidity,
    botRadar: BotRadarResult,
    priceImpact?: PriceImpact
  ): OnChainAnalysis["summary"] {
    const recommendations: string[] = [];

    // Liquidity status
    let liquidityStatus: "safe" | "caution" | "dangerous" = "safe";
    if (pool.totalLiquidityUsd < 1000) {
      liquidityStatus = "dangerous";
      recommendations.push("Liquidity is too low for safe trading");
    } else if (pool.totalLiquidityUsd < 10000) {
      liquidityStatus = "caution";
      recommendations.push("Moderate liquidity - use smaller trade sizes");
    }

    // Gas status
    const gasStatus = network.congestionLevel;
    if (gasStatus === "high" || gasStatus === "extreme") {
      recommendations.push(`Gas is ${gasStatus} - consider waiting`);
    }

    // Bot activity status
    const botActivityStatus = botRadar.botActivityLevel;
    if (botActivityStatus === "high" || botActivityStatus === "extreme") {
      recommendations.push(...botRadar.recommendations);
    }

    // Price impact
    if (priceImpact?.isHighImpact) {
      recommendations.push(priceImpact.warningMessage || "High price impact detected");
    }

    // Calculate overall risk
    let overallRisk: "low" | "medium" | "high" | "critical" = "low";
    
    if (liquidityStatus === "dangerous" || botActivityStatus === "extreme") {
      overallRisk = "critical";
    } else if (
      liquidityStatus === "caution" ||
      botActivityStatus === "high" ||
      gasStatus === "extreme"
    ) {
      overallRisk = "high";
    } else if (
      gasStatus === "high" ||
      botActivityStatus === "medium" ||
      priceImpact?.isHighImpact
    ) {
      overallRisk = "medium";
    }

    // Is it a good time to trade?
    const isGoodTimeToTrade =
      liquidityStatus !== "dangerous" &&
      gasStatus !== "extreme" &&
      botActivityStatus !== "extreme" &&
      overallRisk !== "critical";

    if (isGoodTimeToTrade && recommendations.length === 0) {
      recommendations.push("Conditions appear favorable for trading");
    }

    return {
      isGoodTimeToTrade,
      liquidityStatus,
      gasStatus,
      botActivityStatus,
      overallRisk,
      recommendations,
    };
  }
}

/**
 * Factory function
 */
export function createOnChainDataService(
  config?: OnChainDataServiceConfig
): OnChainDataService {
  return new OnChainDataService(config);
}
