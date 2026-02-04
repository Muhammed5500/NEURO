/**
 * Chain Comparison Service
 * 
 * Compare Monad metrics with reference chains:
 * - Calculate time savings
 * - Calculate cost savings in USD
 * 
 * Turkish: "Referans zincirlerin anlık gaz fiyatlarını config üzerinden oku ve
 * Monad'daki işlem başına tasarrufu 'USD cinsinden' göster"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  ReferenceChain,
  ReferenceChainConfig,
  MonadConfig,
  ChainComparison,
  AllChainComparisons,
  SourcedValue,
  GaugeData,
  SpeedZone,
  GaugeConfig,
} from "./types.js";
import {
  DEFAULT_REFERENCE_CHAINS,
  DEFAULT_MONAD_CONFIG,
  DEFAULT_GAUGE_CONFIG,
} from "./types.js";

const comparisonLogger = logger.child({ component: "chain-comparison" });

// ============================================
// CHAIN COMPARISON SERVICE
// ============================================

export class ChainComparisonService {
  private referenceChains: Map<ReferenceChain, ReferenceChainConfig>;
  private monadConfig: MonadConfig;
  private gaugeConfig: GaugeConfig;
  
  // Measured Monad latency (updated from tracker)
  private measuredMonadLatencyMs: number | null = null;
  private measuredMonadCostUsd: number | null = null;

  constructor(
    referenceChains?: Partial<Record<ReferenceChain, ReferenceChainConfig>>,
    monadConfig?: Partial<MonadConfig>,
    gaugeConfig?: GaugeConfig
  ) {
    // Initialize reference chains
    this.referenceChains = new Map();
    const chains = { ...DEFAULT_REFERENCE_CHAINS, ...referenceChains };
    for (const [chain, config] of Object.entries(chains)) {
      this.referenceChains.set(chain as ReferenceChain, config);
    }

    // Initialize Monad config
    this.monadConfig = { ...DEFAULT_MONAD_CONFIG, ...monadConfig } as MonadConfig;
    
    // Initialize gauge config
    this.gaugeConfig = gaugeConfig || DEFAULT_GAUGE_CONFIG;

    comparisonLogger.info({
      referenceChains: Array.from(this.referenceChains.keys()),
      monadLatencyMs: this.monadConfig.avgTxLatencyMs,
    }, "ChainComparisonService initialized");
  }

  /**
   * Update reference chain config
   */
  updateReferenceChain(chain: ReferenceChain, config: Partial<ReferenceChainConfig>): void {
    const existing = this.referenceChains.get(chain);
    if (existing) {
      this.referenceChains.set(chain, {
        ...existing,
        ...config,
        lastUpdated: Date.now(),
      });
    }
  }

  /**
   * Update Monad config
   */
  updateMonadConfig(config: Partial<MonadConfig>): void {
    this.monadConfig = {
      ...this.monadConfig,
      ...config,
      lastUpdated: Date.now(),
    } as MonadConfig;
  }

  /**
   * Update measured Monad metrics from tracker
   */
  updateMeasuredMetrics(latencyMs: number, costUsd?: number): void {
    this.measuredMonadLatencyMs = latencyMs;
    if (costUsd !== undefined) {
      this.measuredMonadCostUsd = costUsd;
    }
  }

  /**
   * Compare Monad with a specific reference chain
   * Turkish: "Monad'daki işlem başına tasarrufu 'USD cinsinden' göster"
   */
  compareWithChain(chain: ReferenceChain): ChainComparison | null {
    const refConfig = this.referenceChains.get(chain);
    if (!refConfig) {
      comparisonLogger.warn({ chain }, "Reference chain config not found");
      return null;
    }

    const now = Date.now();
    
    // Get Monad latency (measured or config)
    const monadLatencyMs = this.measuredMonadLatencyMs || this.monadConfig.avgTxLatencyMs;
    const monadLatencySource: SourcedValue<number>["source"] = 
      this.measuredMonadLatencyMs ? "measured" : "config-ref";

    // Get Monad cost (measured or config)
    const monadCostUsd = this.measuredMonadCostUsd || this.monadConfig.avgTxCostUsd;
    const monadCostSource: SourcedValue<number>["source"] = 
      this.measuredMonadCostUsd ? "measured" : "config-ref";

    // Calculate time savings
    const latencySavedMs = refConfig.avgTxLatencyMs - monadLatencyMs;
    const latencySavedPercent = (latencySavedMs / refConfig.avgTxLatencyMs) * 100;

    // Calculate cost savings
    // Turkish: "'USD cinsinden' (Estimated USD Saved)"
    const costSavedUsd = refConfig.avgTxCostUsd - monadCostUsd;
    const costSavedPercent = (costSavedUsd / refConfig.avgTxCostUsd) * 100;

    // Calculate finality savings
    const finalitySavedMs = refConfig.avgFinalityMs - this.monadConfig.avgFinalityMs;

    // Speed multiplier
    const speedMultiplier = refConfig.avgTxLatencyMs / monadLatencyMs;

    return {
      referenceChain: chain,
      referenceConfig: refConfig,
      monadConfig: this.monadConfig,
      
      latencySavedMs: {
        value: latencySavedMs,
        source: monadLatencySource === "measured" ? "measured" : "estimated",
        measuredAt: now,
      },
      latencySavedPercent: {
        value: latencySavedPercent,
        source: monadLatencySource === "measured" ? "measured" : "estimated",
        measuredAt: now,
      },
      
      costSavedUsd: {
        value: costSavedUsd,
        source: monadCostSource === "measured" ? "measured" : "estimated",
        measuredAt: now,
      },
      costSavedPercent: {
        value: costSavedPercent,
        source: monadCostSource === "measured" ? "measured" : "estimated",
        measuredAt: now,
      },
      
      finalitySavedMs: {
        value: finalitySavedMs,
        source: "config-ref",
        measuredAt: now,
      },
      
      speedMultiplier: {
        value: speedMultiplier,
        source: monadLatencySource === "measured" ? "measured" : "estimated",
        measuredAt: now,
      },
      
      calculatedAt: now,
    };
  }

  /**
   * Compare Monad with all reference chains
   */
  compareWithAllChains(): AllChainComparisons {
    const comparisons: Record<ReferenceChain, ChainComparison> = {} as any;
    
    let bestLatencySaving = { chain: "ethereum" as ReferenceChain, savedMs: 0 };
    let bestCostSaving = { chain: "ethereum" as ReferenceChain, savedUsd: 0 };

    for (const chain of this.referenceChains.keys()) {
      const comparison = this.compareWithChain(chain);
      if (comparison) {
        comparisons[chain] = comparison;
        
        // Track best savings
        if (comparison.latencySavedMs.value > bestLatencySaving.savedMs) {
          bestLatencySaving = {
            chain,
            savedMs: comparison.latencySavedMs.value,
          };
        }
        if (comparison.costSavedUsd.value > bestCostSaving.savedUsd) {
          bestCostSaving = {
            chain,
            savedUsd: comparison.costSavedUsd.value,
          };
        }
      }
    }

    return {
      monad: this.monadConfig,
      comparisons,
      bestLatencySaving,
      bestCostSaving,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Get gauge data for speed display
   * Turkish: "Monad'ın iğnesi her zaman 'Ultra Fast' bölgesinde kalsın"
   */
  getGaugeData(): GaugeData {
    const monadLatencyMs = this.measuredMonadLatencyMs || this.monadConfig.avgTxLatencyMs;
    const source: SourcedValue<number>["source"] = 
      this.measuredMonadLatencyMs ? "measured" : "config-ref";

    // Determine zone
    let zone: SpeedZone = "ultra_fast";
    let zoneLabel = "ULTRA FAST";
    let zoneColor = "#4ade80";

    for (const zoneConfig of this.gaugeConfig.zones) {
      if (monadLatencyMs >= zoneConfig.minMs && monadLatencyMs < zoneConfig.maxMs) {
        zone = zoneConfig.zone;
        zoneLabel = zoneConfig.label;
        zoneColor = zoneConfig.color;
        break;
      }
    }

    // Calculate needle position (0-100)
    // 0 = fastest (0ms), 100 = slowest (60000ms+)
    const maxMs = 60000;
    const needlePosition = Math.min(100, (monadLatencyMs / maxMs) * 100);

    // Speed multipliers vs reference chains
    const ethConfig = this.referenceChains.get("ethereum");
    const solConfig = this.referenceChains.get("solana");

    const vsEthereum = ethConfig
      ? ethConfig.avgTxLatencyMs / monadLatencyMs
      : 60;
    const vsSolana = solConfig
      ? solConfig.avgTxLatencyMs / monadLatencyMs
      : 4;

    return {
      currentLatencyMs: {
        value: monadLatencyMs,
        source,
        measuredAt: Date.now(),
      },
      zone,
      zoneLabel,
      zoneColor,
      needlePosition,
      vsEthereum: {
        value: vsEthereum,
        source: source === "measured" ? "measured" : "estimated",
        measuredAt: Date.now(),
      },
      vsSolana: {
        value: vsSolana,
        source: source === "measured" ? "measured" : "estimated",
        measuredAt: Date.now(),
      },
    };
  }

  /**
   * Get reference chain config
   */
  getReferenceChain(chain: ReferenceChain): ReferenceChainConfig | undefined {
    return this.referenceChains.get(chain);
  }

  /**
   * Get all reference chains
   */
  getAllReferenceChains(): Record<ReferenceChain, ReferenceChainConfig> {
    const result: Record<string, ReferenceChainConfig> = {};
    for (const [chain, config] of this.referenceChains) {
      result[chain] = config;
    }
    return result as Record<ReferenceChain, ReferenceChainConfig>;
  }

  /**
   * Get Monad config
   */
  getMonadConfig(): MonadConfig {
    return this.monadConfig;
  }
}

/**
 * Factory function
 */
export function createChainComparisonService(
  referenceChains?: Partial<Record<ReferenceChain, ReferenceChainConfig>>,
  monadConfig?: Partial<MonadConfig>
): ChainComparisonService {
  return new ChainComparisonService(referenceChains, monadConfig);
}
