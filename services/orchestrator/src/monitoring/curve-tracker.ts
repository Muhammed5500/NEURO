/**
 * Bonding Curve Saturation Tracker
 * 
 * Monitors nad.fun bonding curve metrics:
 * - Distance to graduation
 * - Price velocity and acceleration
 * - Sell pressure detection
 * - CURVE_STALL signal generation
 * 
 * Turkish: "nad.fun bonding curve üzerindeki 'Mezuniyet' (Graduation) noktasına olan uzaklığı ve hızı takip et"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  BondingCurveState,
  CurveStallResult,
  MonitoringConfig,
} from "./types.js";
import { DEFAULT_MONITORING_CONFIG } from "./types.js";

const curveLogger = logger.child({ component: "curve-tracker" });

// ============================================
// NAD.FUN BONDING CURVE PARAMETERS
// ============================================

const NAD_FUN_CURVE = {
  // Graduation threshold (when token graduates to DEX)
  GRADUATION_THRESHOLD_MON: 69, // ~69 MON to graduate
  
  // Curve parameters (simplified)
  INITIAL_PRICE: 0.00001,
  PRICE_MULTIPLIER: 1.5,
  
  // Max supply on bonding curve
  MAX_CURVE_SUPPLY: 800_000_000n, // 800M tokens
};

// ============================================
// PRICE HISTORY
// ============================================

interface PriceDataPoint {
  timestamp: number;
  price: number;
  buyVolume: bigint;
  sellVolume: bigint;
  reserve: bigint;
}

// ============================================
// CURVE TRACKER
// ============================================

export class BondingCurveTracker {
  private readonly config: MonitoringConfig["curveStallThreshold"];
  
  // Price history per token
  private readonly priceHistory: Map<string, PriceDataPoint[]> = new Map();
  
  // Current states
  private readonly states: Map<string, BondingCurveState> = new Map();
  
  // Max history points to keep
  private readonly maxHistoryPoints = 1000;

  constructor(config?: Partial<MonitoringConfig["curveStallThreshold"]>) {
    this.config = { ...DEFAULT_MONITORING_CONFIG.curveStallThreshold, ...config };

    curveLogger.info({
      priceVelocityDropThreshold: this.config.priceVelocityDropPercent,
      sellPressureThreshold: this.config.sellPressureIncreasePercent,
    }, "BondingCurveTracker initialized");
  }

  /**
   * Update curve state with new data point
   */
  updateState(
    tokenAddress: string,
    price: number,
    supply: bigint,
    reserve: bigint,
    buyVolume24h: bigint,
    sellVolume24h: bigint
  ): BondingCurveState {
    const now = Date.now();
    
    // Get or create price history
    let history = this.priceHistory.get(tokenAddress);
    if (!history) {
      history = [];
      this.priceHistory.set(tokenAddress, history);
    }

    // Add new data point
    history.push({
      timestamp: now,
      price,
      buyVolume: buyVolume24h,
      sellVolume: sellVolume24h,
      reserve,
    });

    // Trim history if needed
    if (history.length > this.maxHistoryPoints) {
      history.splice(0, history.length - this.maxHistoryPoints);
    }

    // Calculate graduation progress
    // Turkish: "Mezuniyet noktasına olan uzaklık"
    const graduationProgress = this.calculateGraduationProgress(reserve);
    const graduationPrice = this.estimateGraduationPrice(price, graduationProgress);
    const distanceToGraduation = graduationPrice - price;

    // Calculate velocity and acceleration
    const { velocity, acceleration } = this.calculatePriceVelocity(history);

    // Calculate sell pressure
    const sellPressureRatio = this.calculateSellPressure(buyVolume24h, sellVolume24h);
    const sellPressureTrend = this.calculateSellPressureTrend(history);

    // Detect stalling
    const stallResult = this.detectStall(history, sellPressureRatio, sellPressureTrend);

    const state: BondingCurveState = {
      tokenAddress,
      currentPrice: price,
      currentSupply: supply,
      currentReserve: reserve,
      graduationPrice,
      graduationProgress,
      distanceToGraduation,
      priceVelocity: velocity,
      priceAcceleration: acceleration,
      buyVolume24h,
      sellVolume24h,
      netVolume24h: buyVolume24h - sellVolume24h,
      sellPressureRatio,
      sellPressureTrend,
      isStalling: stallResult.isStalling,
      stallConfidence: stallResult.confidence,
      lastUpdated: now,
      dataPoints: history.length,
    };

    this.states.set(tokenAddress, state);

    curveLogger.debug({
      tokenAddress,
      graduationProgress: graduationProgress.toFixed(2),
      priceVelocity: velocity.toFixed(6),
      sellPressureRatio: sellPressureRatio.toFixed(2),
      isStalling: stallResult.isStalling,
    }, "Curve state updated");

    return state;
  }

  /**
   * Get current state for a token
   */
  getState(tokenAddress: string): BondingCurveState | undefined {
    return this.states.get(tokenAddress);
  }

  /**
   * Detect curve stall
   * Turkish: "fiyat artışı yavaşlıyor ama satış baskısı artıyorsa CURVE_STALL sinyali üret"
   */
  detectStall(
    history: PriceDataPoint[],
    currentSellPressure: number,
    sellPressureTrend: BondingCurveState["sellPressureTrend"]
  ): CurveStallResult {
    if (history.length < this.config.minDataPoints) {
      return {
        isStalling: false,
        confidence: 0,
        priceSlowdown: false,
        sellPressureIncrease: false,
        volumeDecline: false,
        priceVelocityChange: 0,
        sellPressureChange: 0,
        volumeChange: 0,
        graduationProbability: 0.5,
      };
    }

    // Split history into two halves for comparison
    const midpoint = Math.floor(history.length / 2);
    const firstHalf = history.slice(0, midpoint);
    const secondHalf = history.slice(midpoint);

    // Calculate metrics for each half
    const firstVelocity = this.calculateAverageVelocity(firstHalf);
    const secondVelocity = this.calculateAverageVelocity(secondHalf);
    
    const firstSellPressure = this.calculateAverageSellPressure(firstHalf);
    const secondSellPressure = this.calculateAverageSellPressure(secondHalf);

    const firstVolume = this.calculateAverageVolume(firstHalf);
    const secondVolume = this.calculateAverageVolume(secondHalf);

    // Calculate changes
    const priceVelocityChange = firstVelocity !== 0 
      ? ((secondVelocity - firstVelocity) / Math.abs(firstVelocity)) * 100 
      : 0;
    
    const sellPressureChange = firstSellPressure !== 0 
      ? ((secondSellPressure - firstSellPressure) / firstSellPressure) * 100 
      : 0;
    
    const volumeChange = firstVolume !== 0 
      ? ((secondVolume - firstVolume) / firstVolume) * 100 
      : 0;

    // Detect individual indicators
    // Turkish: "fiyat artışı yavaşlıyor"
    const priceSlowdown = priceVelocityChange < -this.config.priceVelocityDropPercent;
    
    // Turkish: "satış baskısı artıyorsa"
    const sellPressureIncrease = sellPressureChange > this.config.sellPressureIncreasePercent;
    
    const volumeDecline = volumeChange < -20; // 20% decline

    // Determine if stalling
    // Turkish: "CURVE_STALL sinyali üret"
    const isStalling = priceSlowdown && sellPressureIncrease;

    // Calculate confidence
    let confidence = 0;
    if (priceSlowdown) confidence += 0.4;
    if (sellPressureIncrease) confidence += 0.4;
    if (volumeDecline) confidence += 0.2;
    if (sellPressureTrend === "increasing") confidence += 0.1;

    confidence = Math.min(1, confidence);

    // Estimate graduation probability
    const state = this.states.get(history[0]?.timestamp ? "" : "");
    const graduationProbability = this.estimateGraduationProbability(
      secondVelocity,
      currentSellPressure,
      state?.graduationProgress || 0
    );

    const result: CurveStallResult = {
      isStalling,
      confidence,
      priceSlowdown,
      sellPressureIncrease,
      volumeDecline,
      priceVelocityChange,
      sellPressureChange,
      volumeChange,
      graduationProbability,
    };

    if (isStalling) {
      curveLogger.warn({
        confidence,
        priceVelocityChange,
        sellPressureChange,
      }, "CURVE_STALL detected");
    }

    return result;
  }

  /**
   * Analyze curve for a specific token
   */
  analyzeCurve(tokenAddress: string): CurveStallResult | null {
    const state = this.states.get(tokenAddress);
    const history = this.priceHistory.get(tokenAddress);

    if (!state || !history) {
      return null;
    }

    return this.detectStall(history, state.sellPressureRatio, state.sellPressureTrend);
  }

  /**
   * Get tokens with stalling curves
   */
  getStallingTokens(minConfidence = 0.5): Array<{
    tokenAddress: string;
    state: BondingCurveState;
    stallResult: CurveStallResult;
  }> {
    const results: Array<{
      tokenAddress: string;
      state: BondingCurveState;
      stallResult: CurveStallResult;
    }> = [];

    for (const [tokenAddress, state] of this.states) {
      if (state.isStalling && state.stallConfidence >= minConfidence) {
        const stallResult = this.analyzeCurve(tokenAddress);
        if (stallResult) {
          results.push({ tokenAddress, state, stallResult });
        }
      }
    }

    return results.sort((a, b) => b.state.stallConfidence - a.state.stallConfidence);
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private calculateGraduationProgress(reserve: bigint): number {
    const reserveMon = Number(reserve) / 1e18;
    return Math.min(100, (reserveMon / NAD_FUN_CURVE.GRADUATION_THRESHOLD_MON) * 100);
  }

  private estimateGraduationPrice(currentPrice: number, progress: number): number {
    // Simplified estimate based on bonding curve math
    const remainingProgress = 100 - progress;
    const priceIncreaseFactor = 1 + (remainingProgress / 100) * (NAD_FUN_CURVE.PRICE_MULTIPLIER - 1);
    return currentPrice * priceIncreaseFactor;
  }

  private calculatePriceVelocity(history: PriceDataPoint[]): {
    velocity: number;
    acceleration: number;
  } {
    if (history.length < 2) {
      return { velocity: 0, acceleration: 0 };
    }

    // Calculate velocities for each point
    const velocities: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const timeDelta = history[i].timestamp - history[i-1].timestamp;
      const priceDelta = history[i].price - history[i-1].price;
      if (timeDelta > 0) {
        velocities.push(priceDelta / timeDelta * 3600000); // per hour
      }
    }

    if (velocities.length === 0) {
      return { velocity: 0, acceleration: 0 };
    }

    // Current velocity (average of last 5)
    const recentVelocities = velocities.slice(-5);
    const velocity = recentVelocities.reduce((a, b) => a + b, 0) / recentVelocities.length;

    // Acceleration (change in velocity)
    let acceleration = 0;
    if (velocities.length >= 2) {
      const earlierVelocity = velocities.slice(-10, -5).reduce((a, b) => a + b, 0) / 
        Math.max(1, velocities.slice(-10, -5).length);
      acceleration = velocity - earlierVelocity;
    }

    return { velocity, acceleration };
  }

  private calculateSellPressure(buyVolume: bigint, sellVolume: bigint): number {
    const totalVolume = buyVolume + sellVolume;
    if (totalVolume === 0n) return 0;
    return Number(sellVolume) / Number(totalVolume);
  }

  private calculateSellPressureTrend(
    history: PriceDataPoint[]
  ): BondingCurveState["sellPressureTrend"] {
    if (history.length < 10) return "stable";

    const midpoint = Math.floor(history.length / 2);
    const firstPressure = this.calculateAverageSellPressure(history.slice(0, midpoint));
    const secondPressure = this.calculateAverageSellPressure(history.slice(midpoint));

    const change = secondPressure - firstPressure;
    if (change > 0.1) return "increasing";
    if (change < -0.1) return "decreasing";
    return "stable";
  }

  private calculateAverageVelocity(history: PriceDataPoint[]): number {
    if (history.length < 2) return 0;
    
    const totalPriceChange = history[history.length - 1].price - history[0].price;
    const totalTime = history[history.length - 1].timestamp - history[0].timestamp;
    
    if (totalTime === 0) return 0;
    return totalPriceChange / totalTime * 3600000; // per hour
  }

  private calculateAverageSellPressure(history: PriceDataPoint[]): number {
    if (history.length === 0) return 0;
    
    let totalBuy = 0n;
    let totalSell = 0n;
    
    for (const point of history) {
      totalBuy += point.buyVolume;
      totalSell += point.sellVolume;
    }
    
    return this.calculateSellPressure(totalBuy, totalSell);
  }

  private calculateAverageVolume(history: PriceDataPoint[]): number {
    if (history.length === 0) return 0;
    
    let total = 0n;
    for (const point of history) {
      total += point.buyVolume + point.sellVolume;
    }
    
    return Number(total) / history.length;
  }

  private estimateGraduationProbability(
    velocity: number,
    sellPressure: number,
    progress: number
  ): number {
    // Base probability from progress
    let probability = progress / 100;

    // Adjust based on velocity
    if (velocity > 0) {
      probability *= 1.2;
    } else {
      probability *= 0.8;
    }

    // Adjust based on sell pressure
    if (sellPressure > 0.6) {
      probability *= 0.7;
    } else if (sellPressure < 0.4) {
      probability *= 1.1;
    }

    return Math.max(0, Math.min(1, probability));
  }
}

/**
 * Factory function
 */
export function createBondingCurveTracker(
  config?: Partial<MonitoringConfig["curveStallThreshold"]>
): BondingCurveTracker {
  return new BondingCurveTracker(config);
}
