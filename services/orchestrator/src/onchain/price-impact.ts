/**
 * Price Impact Calculator
 * 
 * Calculates price impact using nad.fun bonding curve mathematics.
 * 
 * Turkish: "Sadece havuz bakiyesine bakma; nad.fun'ın bonding curve (bağlanma eğrisi)
 * matematiğini kullanarak, bizim yapacağımız işlemin fiyatı ne kadar kaydıracağını
 * (Price Impact) milisaniyeler içinde hesapla."
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { PriceImpact, PoolLiquidity } from "./types.js";
import { OnChainCache, CacheKeys } from "./cache.js";

const impactLogger = logger.child({ component: "price-impact" });

// ============================================
// BONDING CURVE CONSTANTS (nad.fun specific)
// ============================================

/**
 * nad.fun uses a specific bonding curve formula.
 * This is a simplified model - real implementation would match
 * the exact on-chain contract math.
 * 
 * Typical bonding curve: price = supply^n / scale
 * Or: reserve_ratio based formulas
 */
const BONDING_CURVE_PARAMS = {
  // Curve exponent (higher = steeper curve)
  exponent: 2,
  
  // Scale factor
  scaleFactor: 1e18,
  
  // Reserve ratio for graduated pools (when using Uniswap-style)
  reserveRatio: 0.5, // 50%
  
  // Fee percentage
  feePercent: 0.3, // 0.3%
  
  // Graduation threshold in MON
  graduationThresholdMon: 100000,
};

// ============================================
// PRICE IMPACT THRESHOLDS
// ============================================

const IMPACT_THRESHOLDS = {
  low: 0.5,      // < 0.5% = low impact
  medium: 1,     // < 1% = medium impact
  high: 3,       // < 3% = high impact
  extreme: 5,    // >= 5% = extreme impact
};

// ============================================
// PRICE IMPACT CALCULATOR
// ============================================

export class PriceImpactCalculator {
  private readonly cache: OnChainCache;

  constructor() {
    this.cache = new OnChainCache();
  }

  /**
   * Calculate price impact for a trade
   * Turkish: "işlemin fiyatı ne kadar kaydıracağını milisaniyeler içinde hesapla"
   */
  calculateImpact(
    pool: PoolLiquidity,
    tradeAmountMon: number,
    direction: "buy" | "sell"
  ): PriceImpact {
    const startTime = Date.now();
    
    // Use cached if available
    const cacheKey = CacheKeys.priceImpact(pool.tokenAddress, tradeAmountMon, direction);
    const cached = this.cache.get<PriceImpact>(cacheKey);
    if (cached) {
      return cached;
    }

    let result: PriceImpact;

    if (pool.isGraduated) {
      // Use constant product formula for graduated pools
      result = this.calculateConstantProductImpact(pool, tradeAmountMon, direction);
    } else {
      // Use bonding curve formula for non-graduated pools
      result = this.calculateBondingCurveImpact(pool, tradeAmountMon, direction);
    }

    // Add timing
    result.calculatedAt = startTime;

    // Cache result
    this.cache.set(cacheKey, result, { ttlMs: 3000 });

    impactLogger.debug({
      tokenAddress: pool.tokenAddress,
      tradeAmountMon,
      direction,
      priceImpactPercent: result.priceImpactPercent,
      calculationTimeMs: Date.now() - startTime,
    }, "Price impact calculated");

    return result;
  }

  /**
   * Calculate impact using bonding curve math
   * 
   * For a bonding curve: P = k * S^n
   * Where P = price, S = supply, k = constant, n = exponent
   * 
   * Price impact = (new_price - current_price) / current_price * 100
   */
  private calculateBondingCurveImpact(
    pool: PoolLiquidity,
    tradeAmountMon: number,
    direction: "buy" | "sell"
  ): PriceImpact {
    const currentPrice = pool.currentPrice;
    const monReserve = Number(pool.monReserve) / 1e18;
    const tokenReserve = Number(pool.tokenReserve) / 1e18;
    
    // Bonding curve progress affects the steepness
    const progressFactor = Math.max(0.1, pool.bondingCurveProgress / 100);
    
    // Calculate new reserves after trade
    let newMonReserve: number;
    let newTokenReserve: number;
    let expectedOutput: number;

    if (direction === "buy") {
      // Buying tokens with MON
      newMonReserve = monReserve + tradeAmountMon;
      
      // Bonding curve: token_out = f(mon_in, current_supply)
      // Simplified: token_out = mon_in / current_price * (1 - impact_factor)
      const impactFactor = (tradeAmountMon / monReserve) * progressFactor;
      const averagePrice = currentPrice * (1 + impactFactor / 2);
      expectedOutput = tradeAmountMon / averagePrice;
      
      newTokenReserve = tokenReserve - expectedOutput;
    } else {
      // Selling tokens for MON
      const tokensToSell = tradeAmountMon / currentPrice;
      newTokenReserve = tokenReserve + tokensToSell;
      
      // Impact is higher on the sell side for bonding curves
      const impactFactor = (tokensToSell / tokenReserve) * progressFactor * 1.5;
      const averagePrice = currentPrice * (1 - impactFactor / 2);
      expectedOutput = tokensToSell * averagePrice;
      
      newMonReserve = monReserve - expectedOutput;
    }

    // Calculate new price
    const newPrice = direction === "buy"
      ? newMonReserve / (newTokenReserve || 1)
      : newMonReserve / newTokenReserve;
    
    // Price impact
    const priceImpactPercent = Math.abs((newPrice - currentPrice) / currentPrice * 100);
    const priceImpactBps = priceImpactPercent * 100;

    // Apply fee
    const feeAdjustedOutput = expectedOutput * (1 - BONDING_CURVE_PARAMS.feePercent / 100);
    
    // Calculate minimum with 1% slippage tolerance
    const slippageTolerance = 0.01;
    const minimumOutput = feeAdjustedOutput * (1 - slippageTolerance);

    return {
      tradeAmountMon,
      tradeDirection: direction,
      priceImpactPercent,
      priceImpactBps,
      expectedPrice: newPrice,
      expectedOutput: BigInt(Math.floor(feeAdjustedOutput * 1e18)),
      minimumOutput: BigInt(Math.floor(minimumOutput * 1e18)),
      ...this.assessImpact(priceImpactPercent),
      calculationMethod: "bonding_curve",
      calculatedAt: Date.now(),
    };
  }

  /**
   * Calculate impact using constant product formula (x * y = k)
   * Used for graduated pools that have migrated to AMM
   */
  private calculateConstantProductImpact(
    pool: PoolLiquidity,
    tradeAmountMon: number,
    direction: "buy" | "sell"
  ): PriceImpact {
    const monReserve = Number(pool.monReserve) / 1e18;
    const tokenReserve = Number(pool.tokenReserve) / 1e18;
    const k = monReserve * tokenReserve;
    const currentPrice = pool.currentPrice;

    let expectedOutput: number;
    let newPrice: number;

    if (direction === "buy") {
      // Buying tokens with MON
      // new_mon = mon + input
      // new_token = k / new_mon
      // output = token - new_token
      const newMonReserve = monReserve + tradeAmountMon;
      const newTokenReserve = k / newMonReserve;
      expectedOutput = tokenReserve - newTokenReserve;
      newPrice = newMonReserve / newTokenReserve;
    } else {
      // Selling tokens for MON
      const tokensToSell = tradeAmountMon / currentPrice;
      const newTokenReserve = tokenReserve + tokensToSell;
      const newMonReserve = k / newTokenReserve;
      expectedOutput = monReserve - newMonReserve;
      newPrice = newMonReserve / newTokenReserve;
    }

    // Price impact
    const priceImpactPercent = Math.abs((newPrice - currentPrice) / currentPrice * 100);
    const priceImpactBps = priceImpactPercent * 100;

    // Apply fee
    const feeAdjustedOutput = expectedOutput * (1 - BONDING_CURVE_PARAMS.feePercent / 100);
    
    // Calculate minimum with slippage
    const slippageTolerance = 0.01;
    const minimumOutput = feeAdjustedOutput * (1 - slippageTolerance);

    return {
      tradeAmountMon,
      tradeDirection: direction,
      priceImpactPercent,
      priceImpactBps,
      expectedPrice: newPrice,
      expectedOutput: BigInt(Math.floor(feeAdjustedOutput * 1e18)),
      minimumOutput: BigInt(Math.floor(minimumOutput * 1e18)),
      ...this.assessImpact(priceImpactPercent),
      calculationMethod: "constant_product",
      calculatedAt: Date.now(),
    };
  }

  /**
   * Assess impact severity
   */
  private assessImpact(impactPercent: number): {
    isHighImpact: boolean;
    warningLevel: PriceImpact["warningLevel"];
    warningMessage?: string;
  } {
    if (impactPercent < IMPACT_THRESHOLDS.low) {
      return { isHighImpact: false, warningLevel: "none" };
    }
    
    if (impactPercent < IMPACT_THRESHOLDS.medium) {
      return { 
        isHighImpact: false, 
        warningLevel: "low",
        warningMessage: `Low price impact: ${impactPercent.toFixed(2)}%`,
      };
    }
    
    if (impactPercent < IMPACT_THRESHOLDS.high) {
      return { 
        isHighImpact: true, 
        warningLevel: "medium",
        warningMessage: `Medium price impact: ${impactPercent.toFixed(2)}%. Consider reducing trade size.`,
      };
    }
    
    if (impactPercent < IMPACT_THRESHOLDS.extreme) {
      return { 
        isHighImpact: true, 
        warningLevel: "high",
        warningMessage: `High price impact: ${impactPercent.toFixed(2)}%! Trade size may be too large.`,
      };
    }
    
    return { 
      isHighImpact: true, 
      warningLevel: "extreme",
      warningMessage: `EXTREME price impact: ${impactPercent.toFixed(2)}%! This trade will significantly move the market.`,
    };
  }

  /**
   * Calculate optimal trade size for target impact
   */
  calculateOptimalSize(
    pool: PoolLiquidity,
    targetImpactPercent: number,
    direction: "buy" | "sell"
  ): number {
    // Binary search for optimal trade size
    let low = 0;
    let high = Number(pool.monReserve) / 1e18 * 0.5; // Max 50% of reserves
    
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2;
      const impact = this.calculateImpact(pool, mid, direction);
      
      if (Math.abs(impact.priceImpactPercent - targetImpactPercent) < 0.01) {
        return mid;
      }
      
      if (impact.priceImpactPercent > targetImpactPercent) {
        high = mid;
      } else {
        low = mid;
      }
    }
    
    return (low + high) / 2;
  }

  /**
   * Batch calculate impacts for multiple sizes
   */
  calculateImpactTable(
    pool: PoolLiquidity,
    sizes: number[],
    direction: "buy" | "sell"
  ): Array<{ size: number; impact: PriceImpact }> {
    return sizes.map(size => ({
      size,
      impact: this.calculateImpact(pool, size, direction),
    }));
  }
}

/**
 * Factory function
 */
export function createPriceImpactCalculator(): PriceImpactCalculator {
  return new PriceImpactCalculator();
}
