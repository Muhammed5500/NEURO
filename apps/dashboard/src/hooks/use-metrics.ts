"use client";

/**
 * useMetrics Hook
 * 
 * Hook for fetching and subscribing to metrics updates
 * Acceptance criteria: "Panel updates live during runs"
 */

import { useState, useEffect, useCallback } from "react";
import type { MetricsDashboardData } from "@/types/metrics";

interface UseMetricsOptions {
  refreshIntervalMs?: number;
  autoRefresh?: boolean;
}

interface UseMetricsReturn {
  data: MetricsDashboardData | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  lastUpdated: number | null;
}

const API_URL = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "http://localhost:4000";

// Default simulated data for development
const DEFAULT_METRICS: MetricsDashboardData = {
  latencyStats: {
    ingestion: {
      phase: "ingestion",
      count: 150,
      totalMs: 12000,
      avgMs: 80,
      minMs: 45,
      maxMs: 250,
      p50Ms: 75,
      p95Ms: 180,
      p99Ms: 220,
      recentAvgMs: 72,
      trend: "improving",
      source: "simulated",
      lastUpdated: Date.now(),
    },
    embedding: null,
    agent_analysis: {
      phase: "agent_analysis",
      count: 120,
      totalMs: 36000,
      avgMs: 300,
      minMs: 150,
      maxMs: 800,
      p50Ms: 280,
      p95Ms: 650,
      p99Ms: 750,
      recentAvgMs: 285,
      trend: "stable",
      source: "simulated",
      lastUpdated: Date.now(),
    },
    consensus: {
      phase: "consensus",
      count: 100,
      totalMs: 15000,
      avgMs: 150,
      minMs: 80,
      maxMs: 400,
      p50Ms: 140,
      p95Ms: 320,
      p99Ms: 380,
      recentAvgMs: 145,
      trend: "stable",
      source: "simulated",
      lastUpdated: Date.now(),
    },
    planning: {
      phase: "planning",
      count: 80,
      totalMs: 4000,
      avgMs: 50,
      minMs: 20,
      maxMs: 150,
      p50Ms: 45,
      p95Ms: 120,
      p99Ms: 140,
      recentAvgMs: 48,
      trend: "improving",
      source: "simulated",
      lastUpdated: Date.now(),
    },
    simulation: {
      phase: "simulation",
      count: 60,
      totalMs: 6000,
      avgMs: 100,
      minMs: 50,
      maxMs: 300,
      p50Ms: 90,
      p95Ms: 250,
      p99Ms: 280,
      recentAvgMs: 95,
      trend: "stable",
      source: "simulated",
      lastUpdated: Date.now(),
    },
    submission: {
      phase: "submission",
      count: 50,
      totalMs: 2500,
      avgMs: 50,
      minMs: 20,
      maxMs: 150,
      p50Ms: 45,
      p95Ms: 120,
      p99Ms: 140,
      recentAvgMs: 48,
      trend: "stable",
      source: "simulated",
      lastUpdated: Date.now(),
    },
    mempool: null,
    execution: {
      phase: "execution",
      count: 45,
      totalMs: 18000,
      avgMs: 400,
      minMs: 200,
      maxMs: 800,
      p50Ms: 380,
      p95Ms: 700,
      p99Ms: 780,
      recentAvgMs: 390,
      trend: "stable",
      source: "simulated",
      lastUpdated: Date.now(),
    },
    finality: {
      phase: "finality",
      count: 40,
      totalMs: 32000,
      avgMs: 800,
      minMs: 600,
      maxMs: 1200,
      p50Ms: 780,
      p95Ms: 1100,
      p99Ms: 1180,
      recentAvgMs: 790,
      trend: "stable",
      source: "simulated",
      lastUpdated: Date.now(),
    },
  },
  chainComparisons: {
    comparisons: {
      ethereum: {
        referenceChain: "ethereum",
        referenceConfig: {
          name: "Ethereum",
          chainId: 1,
          avgBlockTimeMs: 12000,
          avgFinalityMs: 900000,
          avgTxLatencyMs: 30000,
          avgGasPrice: 30,
          avgGasLimit: 21000,
          nativeTokenSymbol: "ETH",
          nativeTokenPriceUsd: 3500,
          avgTxCostUsd: 2.205,
          source: "config-ref",
          lastUpdated: Date.now(),
        },
        latencySavedMs: { value: 29500, source: "estimated", measuredAt: Date.now() },
        latencySavedPercent: { value: 98.3, source: "estimated", measuredAt: Date.now() },
        costSavedUsd: { value: 2.204895, source: "estimated", measuredAt: Date.now() },
        costSavedPercent: { value: 99.99, source: "estimated", measuredAt: Date.now() },
        finalitySavedMs: { value: 899200, source: "config-ref", measuredAt: Date.now() },
        speedMultiplier: { value: 60, source: "estimated", measuredAt: Date.now() },
        calculatedAt: Date.now(),
      },
      solana: {
        referenceChain: "solana",
        referenceConfig: {
          name: "Solana",
          chainId: 101,
          avgBlockTimeMs: 400,
          avgFinalityMs: 13000,
          avgTxLatencyMs: 2000,
          avgGasPrice: 0.000005,
          avgGasLimit: 1,
          nativeTokenSymbol: "SOL",
          nativeTokenPriceUsd: 150,
          avgTxCostUsd: 0.00075,
          source: "config-ref",
          lastUpdated: Date.now(),
        },
        latencySavedMs: { value: 1500, source: "estimated", measuredAt: Date.now() },
        latencySavedPercent: { value: 75, source: "estimated", measuredAt: Date.now() },
        costSavedUsd: { value: 0.000645, source: "estimated", measuredAt: Date.now() },
        costSavedPercent: { value: 86, source: "estimated", measuredAt: Date.now() },
        finalitySavedMs: { value: 12200, source: "config-ref", measuredAt: Date.now() },
        speedMultiplier: { value: 4, source: "estimated", measuredAt: Date.now() },
        calculatedAt: Date.now(),
      },
      arbitrum: {
        referenceChain: "arbitrum",
        referenceConfig: {
          name: "Arbitrum",
          chainId: 42161,
          avgBlockTimeMs: 250,
          avgFinalityMs: 1200000,
          avgTxLatencyMs: 2000,
          avgGasPrice: 0.1,
          avgGasLimit: 21000,
          nativeTokenSymbol: "ETH",
          nativeTokenPriceUsd: 3500,
          avgTxCostUsd: 0.00735,
          source: "config-ref",
          lastUpdated: Date.now(),
        },
        latencySavedMs: { value: 1500, source: "estimated", measuredAt: Date.now() },
        latencySavedPercent: { value: 75, source: "estimated", measuredAt: Date.now() },
        costSavedUsd: { value: 0.007245, source: "estimated", measuredAt: Date.now() },
        costSavedPercent: { value: 98.6, source: "estimated", measuredAt: Date.now() },
        finalitySavedMs: { value: 1199200, source: "config-ref", measuredAt: Date.now() },
        speedMultiplier: { value: 4, source: "estimated", measuredAt: Date.now() },
        calculatedAt: Date.now(),
      },
      polygon: {
        referenceChain: "polygon",
        referenceConfig: {
          name: "Polygon",
          chainId: 137,
          avgBlockTimeMs: 2000,
          avgFinalityMs: 180000,
          avgTxLatencyMs: 5000,
          avgGasPrice: 50,
          avgGasLimit: 21000,
          nativeTokenSymbol: "MATIC",
          nativeTokenPriceUsd: 0.8,
          avgTxCostUsd: 0.00084,
          source: "config-ref",
          lastUpdated: Date.now(),
        },
        latencySavedMs: { value: 4500, source: "estimated", measuredAt: Date.now() },
        latencySavedPercent: { value: 90, source: "estimated", measuredAt: Date.now() },
        costSavedUsd: { value: 0.000735, source: "estimated", measuredAt: Date.now() },
        costSavedPercent: { value: 87.5, source: "estimated", measuredAt: Date.now() },
        finalitySavedMs: { value: 179200, source: "config-ref", measuredAt: Date.now() },
        speedMultiplier: { value: 10, source: "estimated", measuredAt: Date.now() },
        calculatedAt: Date.now(),
      },
      optimism: {
        referenceChain: "optimism",
        referenceConfig: {
          name: "Optimism",
          chainId: 10,
          avgBlockTimeMs: 2000,
          avgFinalityMs: 1200000,
          avgTxLatencyMs: 3000,
          avgGasPrice: 0.001,
          avgGasLimit: 21000,
          nativeTokenSymbol: "ETH",
          nativeTokenPriceUsd: 3500,
          avgTxCostUsd: 0.0000735,
          source: "config-ref",
          lastUpdated: Date.now(),
        },
        latencySavedMs: { value: 2500, source: "estimated", measuredAt: Date.now() },
        latencySavedPercent: { value: 83.3, source: "estimated", measuredAt: Date.now() },
        costSavedUsd: { value: -0.0000315, source: "estimated", measuredAt: Date.now() },
        costSavedPercent: { value: -42.9, source: "estimated", measuredAt: Date.now() },
        finalitySavedMs: { value: 1199200, source: "config-ref", measuredAt: Date.now() },
        speedMultiplier: { value: 6, source: "estimated", measuredAt: Date.now() },
        calculatedAt: Date.now(),
      },
      base: {
        referenceChain: "base",
        referenceConfig: {
          name: "Base",
          chainId: 8453,
          avgBlockTimeMs: 2000,
          avgFinalityMs: 1200000,
          avgTxLatencyMs: 3000,
          avgGasPrice: 0.001,
          avgGasLimit: 21000,
          nativeTokenSymbol: "ETH",
          nativeTokenPriceUsd: 3500,
          avgTxCostUsd: 0.0000735,
          source: "config-ref",
          lastUpdated: Date.now(),
        },
        latencySavedMs: { value: 2500, source: "estimated", measuredAt: Date.now() },
        latencySavedPercent: { value: 83.3, source: "estimated", measuredAt: Date.now() },
        costSavedUsd: { value: -0.0000315, source: "estimated", measuredAt: Date.now() },
        costSavedPercent: { value: -42.9, source: "estimated", measuredAt: Date.now() },
        finalitySavedMs: { value: 1199200, source: "config-ref", measuredAt: Date.now() },
        speedMultiplier: { value: 6, source: "estimated", measuredAt: Date.now() },
        calculatedAt: Date.now(),
      },
    },
    bestLatencySaving: { chain: "ethereum", savedMs: 29500 },
    bestCostSaving: { chain: "ethereum", savedUsd: 2.204895 },
    lastUpdated: Date.now(),
  },
  gaugeData: {
    currentLatencyMs: { value: 500, source: "simulated", measuredAt: Date.now() },
    zone: "ultra_fast",
    zoneLabel: "ULTRA FAST",
    zoneColor: "#4ade80",
    needlePosition: 0.83,
    vsEthereum: { value: 60, source: "estimated", measuredAt: Date.now() },
    vsSolana: { value: 4, source: "estimated", measuredAt: Date.now() },
  },
  summary: {
    totalMeasurements: 645,
    avgIngestionMs: { value: 80, source: "simulated", measuredAt: Date.now() },
    avgConsensusMs: { value: 150, source: "simulated", measuredAt: Date.now() },
    avgExecutionMs: { value: 400, source: "simulated", measuredAt: Date.now() },
    avgTotalMs: { value: 1130, source: "simulated", measuredAt: Date.now() },
    estimatedUsdSaved: { value: 2.204895, source: "estimated", measuredAt: Date.now() },
  },
  generatedAt: Date.now(),
};

export function useMetrics(options: UseMetricsOptions = {}): UseMetricsReturn {
  const { refreshIntervalMs = 5000, autoRefresh = true } = options;

  const [data, setData] = useState<MetricsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/metrics`);
      
      if (!response.ok) {
        // Use default simulated data in dev
        setData({
          ...DEFAULT_METRICS,
          generatedAt: Date.now(),
        });
        setLastUpdated(Date.now());
        return;
      }

      const newData = await response.json();
      setData(newData);
      setLastUpdated(Date.now());
      setError(null);
    } catch (err) {
      // Use default simulated data on error
      setData({
        ...DEFAULT_METRICS,
        generatedAt: Date.now(),
      });
      setLastUpdated(Date.now());
      // Don't set error for network issues in dev - just use simulated data
      console.log("[useMetrics] Using simulated data");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(refresh, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshIntervalMs, refresh]);

  return {
    data,
    loading,
    error,
    refresh,
    lastUpdated,
  };
}
