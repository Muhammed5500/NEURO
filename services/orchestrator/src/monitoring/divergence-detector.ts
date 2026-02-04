/**
 * Volume/Liquidity Divergence Detector
 * 
 * Detects divergence between volume and liquidity:
 * - Volume increasing while liquidity stagnates
 * - Exit liquidity risk detection
 * 
 * Turkish: "hacim (volume) artarken likidite (liquidity) aynı oranda artmıyor veya azalıyorsa,
 * bunu bir 'Exit Liquidity' (Çıkış likiditesi olma riski) olarak işaretle."
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  VolumeLiquidityState,
  DivergenceResult,
  PriorityLevel,
  MonitoringConfig,
} from "./types.js";
import { DEFAULT_MONITORING_CONFIG } from "./types.js";

const divergenceLogger = logger.child({ component: "divergence-detector" });

// ============================================
// VOLUME/LIQUIDITY DATA POINT
// ============================================

interface VolumeDataPoint {
  timestamp: number;
  volume: bigint;
  liquidity: bigint;
}

// ============================================
// DIVERGENCE DETECTOR
// ============================================

export class DivergenceDetector {
  private readonly config: MonitoringConfig["volumeLiquidityThreshold"];
  
  // History per token
  private readonly history: Map<string, VolumeDataPoint[]> = new Map();
  
  // Current states
  private readonly states: Map<string, VolumeLiquidityState> = new Map();
  
  // Max history points
  private readonly maxHistoryPoints = 500;

  constructor(config?: Partial<MonitoringConfig["volumeLiquidityThreshold"]>) {
    this.config = { ...DEFAULT_MONITORING_CONFIG.volumeLiquidityThreshold, ...config };

    divergenceLogger.info({
      divergenceRatioAlert: this.config.divergenceRatioAlert,
      exitLiquidityThreshold: this.config.exitLiquidityRiskThreshold,
    }, "DivergenceDetector initialized");
  }

  /**
   * Update state with new volume and liquidity data
   */
  updateState(
    tokenAddress: string,
    volume24h: bigint,
    liquidity: bigint
  ): VolumeLiquidityState {
    const now = Date.now();
    
    // Get or create history
    let tokenHistory = this.history.get(tokenAddress);
    if (!tokenHistory) {
      tokenHistory = [];
      this.history.set(tokenAddress, tokenHistory);
    }

    // Add new data point
    tokenHistory.push({
      timestamp: now,
      volume: volume24h,
      liquidity,
    });

    // Trim history
    if (tokenHistory.length > this.maxHistoryPoints) {
      tokenHistory.splice(0, tokenHistory.length - this.maxHistoryPoints);
    }

    // Calculate state
    const state = this.calculateState(tokenAddress, tokenHistory, volume24h, liquidity);
    this.states.set(tokenAddress, state);

    divergenceLogger.debug({
      tokenAddress,
      volume24h: Number(volume24h) / 1e18,
      liquidity: Number(liquidity) / 1e18,
      divergenceRatio: state.divergenceRatio.toFixed(2),
      exitLiquidityRisk: state.exitLiquidityRisk,
    }, "Divergence state updated");

    return state;
  }

  /**
   * Get current state for a token
   */
  getState(tokenAddress: string): VolumeLiquidityState | undefined {
    return this.states.get(tokenAddress);
  }

  /**
   * Detect divergence
   * Turkish: "hacim artarken likidite aynı oranda artmıyorsa"
   */
  detectDivergence(tokenAddress: string): DivergenceResult | null {
    const state = this.states.get(tokenAddress);
    const tokenHistory = this.history.get(tokenAddress);

    if (!state || !tokenHistory || tokenHistory.length < 5) {
      return null;
    }

    // Calculate changes over time
    const midpoint = Math.floor(tokenHistory.length / 2);
    const firstHalf = tokenHistory.slice(0, midpoint);
    const secondHalf = tokenHistory.slice(midpoint);

    const firstVolume = this.calculateAverageVolume(firstHalf);
    const secondVolume = this.calculateAverageVolume(secondHalf);

    const firstLiquidity = this.calculateAverageLiquidity(firstHalf);
    const secondLiquidity = this.calculateAverageLiquidity(secondHalf);

    // Calculate percentage changes
    const volumeChangePercent = firstVolume > 0 
      ? ((secondVolume - firstVolume) / firstVolume) * 100 
      : 0;

    const liquidityChangePercent = firstLiquidity > 0 
      ? ((secondLiquidity - firstLiquidity) / firstLiquidity) * 100 
      : 0;

    // Calculate divergence ratio
    // Turkish: "hacim artarken likidite aynı oranda artmıyor"
    let ratio = 1;
    if (liquidityChangePercent !== 0) {
      ratio = Math.abs(volumeChangePercent / liquidityChangePercent);
    } else if (volumeChangePercent > 0) {
      ratio = Infinity; // Volume increasing but liquidity flat
    }

    // Determine if diverging
    const isDiverging = ratio > this.config.divergenceRatioAlert;

    // Check for exit liquidity risk
    // Turkish: "'Exit Liquidity' riski olarak işaretle"
    const isExitLiquidityRisk = 
      volumeChangePercent > 20 && // Volume increasing significantly
      (liquidityChangePercent < 5 || liquidityChangePercent < 0); // Liquidity stagnant or decreasing

    // Calculate risk level
    const riskLevel = this.calculateRiskLevel(
      state.exitLiquidityRisk,
      isDiverging,
      isExitLiquidityRisk
    );

    // Generate recommendation
    const recommendation = this.generateRecommendation(
      isDiverging,
      isExitLiquidityRisk,
      volumeChangePercent,
      liquidityChangePercent
    );

    const result: DivergenceResult = {
      isDiverging,
      divergenceScore: Math.min(100, ratio * 20),
      isExitLiquidityRisk,
      riskLevel,
      volumeChangePercent,
      liquidityChangePercent,
      ratio: isFinite(ratio) ? ratio : 99,
      recommendation,
    };

    if (isExitLiquidityRisk) {
      divergenceLogger.warn({
        tokenAddress,
        volumeChangePercent: volumeChangePercent.toFixed(2),
        liquidityChangePercent: liquidityChangePercent.toFixed(2),
        ratio: ratio.toFixed(2),
      }, "EXIT_LIQUIDITY_RISK detected");
    }

    return result;
  }

  /**
   * Get tokens with high exit liquidity risk
   */
  getHighRiskTokens(minRisk = 50): Array<{
    tokenAddress: string;
    state: VolumeLiquidityState;
    divergenceResult: DivergenceResult;
  }> {
    const results: Array<{
      tokenAddress: string;
      state: VolumeLiquidityState;
      divergenceResult: DivergenceResult;
    }> = [];

    for (const [tokenAddress, state] of this.states) {
      if (state.exitLiquidityRisk >= minRisk) {
        const divergenceResult = this.detectDivergence(tokenAddress);
        if (divergenceResult) {
          results.push({ tokenAddress, state, divergenceResult });
        }
      }
    }

    return results.sort((a, b) => b.state.exitLiquidityRisk - a.state.exitLiquidityRisk);
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private calculateState(
    tokenAddress: string,
    history: VolumeDataPoint[],
    currentVolume: bigint,
    currentLiquidity: bigint
  ): VolumeLiquidityState {
    const now = Date.now();

    // Calculate trends
    const volumeTrend = this.calculateVolumeTrend(history);
    const liquidityTrend = this.calculateLiquidityTrend(history);

    // Calculate 24h changes
    const oneDayAgo = now - 86400000;
    const dayAgoData = history.find(h => h.timestamp <= oneDayAgo);
    
    const volumeChange24h = dayAgoData 
      ? this.calculatePercentChange(dayAgoData.volume, currentVolume) 
      : 0;
    
    const liquidityChange24h = dayAgoData 
      ? this.calculatePercentChange(dayAgoData.liquidity, currentLiquidity) 
      : 0;

    // Calculate divergence
    let divergenceRatio = 1;
    if (liquidityChange24h !== 0) {
      divergenceRatio = Math.abs(volumeChange24h / liquidityChange24h);
    } else if (volumeChange24h > 0) {
      divergenceRatio = 10; // Cap at 10 for display
    }

    const isDiverging = divergenceRatio > this.config.divergenceRatioAlert;
    
    // Determine divergence direction
    let divergenceDirection: VolumeLiquidityState["divergenceDirection"] = "balanced";
    if (volumeChange24h > liquidityChange24h + 10) {
      divergenceDirection = "volume_leading";
    } else if (liquidityChange24h > volumeChange24h + 10) {
      divergenceDirection = "liquidity_leading";
    }

    // Calculate exit liquidity risk
    // Turkish: "'Exit Liquidity' riski"
    const exitLiquidityRisk = this.calculateExitLiquidityRisk(
      volumeChange24h,
      liquidityChange24h,
      divergenceRatio,
      volumeTrend,
      liquidityTrend
    );

    // Calculate liquidity depth
    const liquidityDepth = this.calculateLiquidityDepth(currentLiquidity);

    // Estimate price impact
    const priceImpact1Percent = this.estimatePriceImpact(currentLiquidity);

    return {
      tokenAddress,
      volume24h: currentVolume,
      volumeChange24h,
      volumeTrend,
      liquidity: currentLiquidity,
      liquidityChange24h,
      liquidityTrend,
      divergenceRatio,
      isDiverging,
      divergenceDirection,
      exitLiquidityRisk,
      exitLiquidityAlert: exitLiquidityRisk >= this.config.exitLiquidityRiskThreshold,
      liquidityDepth,
      priceImpact1Percent,
      lastUpdated: now,
    };
  }

  private calculateExitLiquidityRisk(
    volumeChange: number,
    liquidityChange: number,
    divergenceRatio: number,
    volumeTrend: VolumeLiquidityState["volumeTrend"],
    liquidityTrend: VolumeLiquidityState["liquidityTrend"]
  ): number {
    let risk = 0;

    // Volume increasing but liquidity stagnant/decreasing
    if (volumeChange > 20 && liquidityChange < 5) {
      risk += 40;
    }

    // High divergence ratio
    if (divergenceRatio > 3) {
      risk += 20;
    } else if (divergenceRatio > 2) {
      risk += 10;
    }

    // Trend mismatch
    if (volumeTrend === "increasing" && liquidityTrend !== "increasing") {
      risk += 15;
    }

    // Liquidity decreasing
    if (liquidityTrend === "decreasing") {
      risk += 25;
    }

    return Math.min(100, risk);
  }

  private calculateVolumeTrend(history: VolumeDataPoint[]): VolumeLiquidityState["volumeTrend"] {
    if (history.length < 5) return "stable";

    const midpoint = Math.floor(history.length / 2);
    const firstAvg = this.calculateAverageVolume(history.slice(0, midpoint));
    const secondAvg = this.calculateAverageVolume(history.slice(midpoint));

    const change = firstAvg > 0 ? (secondAvg - firstAvg) / firstAvg : 0;
    if (change > 0.1) return "increasing";
    if (change < -0.1) return "decreasing";
    return "stable";
  }

  private calculateLiquidityTrend(history: VolumeDataPoint[]): VolumeLiquidityState["liquidityTrend"] {
    if (history.length < 5) return "stable";

    const midpoint = Math.floor(history.length / 2);
    const firstAvg = this.calculateAverageLiquidity(history.slice(0, midpoint));
    const secondAvg = this.calculateAverageLiquidity(history.slice(midpoint));

    const change = firstAvg > 0 ? (secondAvg - firstAvg) / firstAvg : 0;
    if (change > 0.1) return "increasing";
    if (change < -0.1) return "decreasing";
    return "stable";
  }

  private calculateAverageVolume(history: VolumeDataPoint[]): number {
    if (history.length === 0) return 0;
    const total = history.reduce((sum, h) => sum + Number(h.volume), 0);
    return total / history.length;
  }

  private calculateAverageLiquidity(history: VolumeDataPoint[]): number {
    if (history.length === 0) return 0;
    const total = history.reduce((sum, h) => sum + Number(h.liquidity), 0);
    return total / history.length;
  }

  private calculatePercentChange(from: bigint, to: bigint): number {
    const fromNum = Number(from);
    if (fromNum === 0) return 0;
    return ((Number(to) - fromNum) / fromNum) * 100;
  }

  private calculateLiquidityDepth(liquidity: bigint): VolumeLiquidityState["liquidityDepth"] {
    const liquidityMon = Number(liquidity) / 1e18;
    if (liquidityMon > 100) return "deep";
    if (liquidityMon > 10) return "moderate";
    return "shallow";
  }

  private estimatePriceImpact(liquidity: bigint): number {
    // Simplified estimate: trade size for 1% impact
    // Based on constant product formula approximation
    const liquidityMon = Number(liquidity) / 1e18;
    return liquidityMon * 0.01; // ~1% of liquidity
  }

  private calculateRiskLevel(
    exitLiquidityRisk: number,
    isDiverging: boolean,
    isExitLiquidityRisk: boolean
  ): PriorityLevel {
    if (isExitLiquidityRisk && exitLiquidityRisk >= 80) return "critical";
    if (isExitLiquidityRisk || exitLiquidityRisk >= 60) return "high";
    if (isDiverging || exitLiquidityRisk >= 40) return "medium";
    return "low";
  }

  private generateRecommendation(
    isDiverging: boolean,
    isExitLiquidityRisk: boolean,
    volumeChange: number,
    liquidityChange: number
  ): string {
    if (isExitLiquidityRisk) {
      return `EXIT LIQUIDITY RISK: Volume up ${volumeChange.toFixed(1)}% but liquidity ${liquidityChange >= 0 ? 'only up' : 'down'} ${Math.abs(liquidityChange).toFixed(1)}%. Consider reducing exposure.`;
    }

    if (isDiverging) {
      return `Volume/liquidity divergence detected. Volume ${volumeChange >= 0 ? 'up' : 'down'} ${Math.abs(volumeChange).toFixed(1)}%, liquidity ${liquidityChange >= 0 ? 'up' : 'down'} ${Math.abs(liquidityChange).toFixed(1)}%. Monitor closely.`;
    }

    return "Volume and liquidity are moving in tandem. Normal market conditions.";
  }
}

/**
 * Factory function
 */
export function createDivergenceDetector(
  config?: Partial<MonitoringConfig["volumeLiquidityThreshold"]>
): DivergenceDetector {
  return new DivergenceDetector(config);
}
