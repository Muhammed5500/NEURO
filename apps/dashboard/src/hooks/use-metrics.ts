"use client";

/**
 * useMetrics Hook - LIVE DATA ONLY
 * 
 * Fetches REAL metrics from backend.
 * NO MOCK DATA - shows error/disconnected states.
 */

import { useQuery } from "@tanstack/react-query";
import { liveFetch, API, ConnectionError } from "@/lib/live-data-client";
import type { MetricsData, LatencyBreakdown, ChainComparison } from "@/types/metrics";

// ============================================
// FETCH FUNCTIONS
// ============================================

async function fetchMetrics(): Promise<MetricsData> {
  try {
    return await liveFetch<MetricsData>(
      `${process.env.NEXT_PUBLIC_ORCHESTRATOR_URL}/api/metrics`,
      "METRICS"
    );
  } catch (err) {
    if (err instanceof ConnectionError) throw err;
    throw new ConnectionError("METRICS", "UNKNOWN", String(err));
  }
}

async function fetchLatencyBreakdown(): Promise<LatencyBreakdown> {
  try {
    return await liveFetch<LatencyBreakdown>(
      `${process.env.NEXT_PUBLIC_ORCHESTRATOR_URL}/api/metrics/latency`,
      "LATENCY_BREAKDOWN"
    );
  } catch (err) {
    if (err instanceof ConnectionError) throw err;
    throw new ConnectionError("LATENCY_BREAKDOWN", "UNKNOWN", String(err));
  }
}

async function fetchChainComparison(): Promise<ChainComparison> {
  try {
    return await liveFetch<ChainComparison>(
      `${process.env.NEXT_PUBLIC_ORCHESTRATOR_URL}/api/metrics/chain-comparison`,
      "CHAIN_COMPARISON"
    );
  } catch (err) {
    if (err instanceof ConnectionError) throw err;
    throw new ConnectionError("CHAIN_COMPARISON", "UNKNOWN", String(err));
  }
}

// ============================================
// HOOKS
// ============================================

export function useMetrics() {
  return useQuery({
    queryKey: ["metrics"],
    queryFn: fetchMetrics,
    refetchInterval: 3000,
    retry: false,
    staleTime: 0,
  });
}

export function useLatencyBreakdown() {
  return useQuery({
    queryKey: ["latencyBreakdown"],
    queryFn: fetchLatencyBreakdown,
    refetchInterval: 2000,
    retry: false,
    staleTime: 0,
  });
}

export function useChainComparison() {
  return useQuery({
    queryKey: ["chainComparison"],
    queryFn: fetchChainComparison,
    refetchInterval: 5000,
    retry: false,
    staleTime: 0,
  });
}
