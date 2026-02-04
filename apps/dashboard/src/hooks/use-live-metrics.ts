"use client";

/**
 * useLiveMetrics Hook
 * 
 * Measures ACTUAL latency metrics from real API calls.
 * NO SIMULATED DATA - shows DISCONNECTED if no data.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  API,
  monadRpcCall,
  ConnectionError,
  type ConnectionState,
  type DataSourceError,
} from "@/lib/live-data-client";

// ============================================
// TYPES
// ============================================

export interface PipelineStage {
  id: string;
  name: string;
  avgLatency: number | null; // null = no data
  currentLatency: number | null;
  status: "idle" | "measuring" | "connected" | "error";
  lastMeasured: Date | null;
  error?: string;
}

export interface ChainMetrics {
  blockNumber: number | null;
  gasPrice: number | null; // in gwei
  finality: number | null; // ms
  connected: boolean;
  lastUpdate: Date | null;
}

export interface ServiceHealth {
  name: string;
  status: "online" | "offline" | "degraded";
  latency: number | null;
  lastCheck: Date | null;
  error?: string;
}

// ============================================
// LATENCY MEASUREMENT
// ============================================

async function measureLatency(
  url: string,
  method: "GET" | "POST" = "GET"
): Promise<{ latency: number } | { error: string }> {
  const start = performance.now();
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
    });
    
    clearTimeout(timeout);
    const end = performance.now();
    
    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }
    
    return { latency: Math.round(end - start) };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { error: "TIMEOUT" };
    }
    return { error: "NETWORK_ERROR" };
  }
}

// ============================================
// HOOK - PIPELINE LATENCY
// ============================================

export function useLivePipelineMetrics() {
  const [stages, setStages] = useState<PipelineStage[]>([
    { id: "orchestrator", name: "ORCHESTRATOR", avgLatency: null, currentLatency: null, status: "idle", lastMeasured: null },
    { id: "ingestion", name: "INGESTION", avgLatency: null, currentLatency: null, status: "idle", lastMeasured: null },
    { id: "execution", name: "EXECUTION", avgLatency: null, currentLatency: null, status: "idle", lastMeasured: null },
    { id: "finality", name: "FINALITY", avgLatency: null, currentLatency: null, status: "idle", lastMeasured: null },
  ]);
  const [totalLatency, setTotalLatency] = useState<number | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [error, setError] = useState<DataSourceError | null>(null);

  const latencyHistoryRef = useRef<Map<string, number[]>>(new Map());

  const measureAllStages = useCallback(async () => {
    setConnectionState("connecting");
    
    const endpoints: Record<string, string> = {
      orchestrator: API.orchestrator.health(),
      ingestion: `${process.env.NEXT_PUBLIC_ORCHESTRATOR_URL}/api/ingestion/health`,
      execution: `${process.env.NEXT_PUBLIC_ORCHESTRATOR_URL}/api/execution/health`,
    };

    const results = await Promise.all(
      Object.entries(endpoints).map(async ([id, url]) => {
        const result = await measureLatency(url);
        return { id, result };
      })
    );

    // Measure Monad finality
    let finalityResult: { latency: number } | { error: string };
    try {
      const start = performance.now();
      await monadRpcCall("eth_blockNumber");
      const end = performance.now();
      finalityResult = { latency: Math.round(end - start) };
    } catch {
      finalityResult = { error: "RPC_ERROR" };
    }
    results.push({ id: "finality", result: finalityResult });

    // Update stages
    let hasError = false;
    let total = 0;
    let validCount = 0;

    setStages((prev) =>
      prev.map((stage) => {
        const measurement = results.find((r) => r.id === stage.id);
        if (!measurement) return stage;

        if ("error" in measurement.result) {
          hasError = true;
          return {
            ...stage,
            status: "error" as const,
            error: measurement.result.error,
            lastMeasured: new Date(),
          };
        }

        const latency = measurement.result.latency;
        
        // Update history for averaging
        const history = latencyHistoryRef.current.get(stage.id) || [];
        history.push(latency);
        if (history.length > 10) history.shift(); // Keep last 10
        latencyHistoryRef.current.set(stage.id, history);
        
        const avgLatency = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
        
        total += latency;
        validCount++;

        return {
          ...stage,
          currentLatency: latency,
          avgLatency,
          status: "connected" as const,
          lastMeasured: new Date(),
          error: undefined,
        };
      })
    );

    setTotalLatency(validCount > 0 ? total : null);
    setConnectionState(hasError ? "error" : "connected");
    
    if (hasError) {
      setError({
        source: "PIPELINE_METRICS",
        code: "PARTIAL_FAILURE",
        message: "Some services unavailable",
        timestamp: new Date(),
      });
    } else {
      setError(null);
    }
  }, []);

  useEffect(() => {
    measureAllStages();
    
    // Measure every 5 seconds
    const interval = setInterval(measureAllStages, 5000);
    return () => clearInterval(interval);
  }, [measureAllStages]);

  return {
    stages,
    totalLatency,
    connectionState,
    error,
    retry: measureAllStages,
    isConnected: connectionState === "connected",
  };
}

// ============================================
// HOOK - MONAD CHAIN METRICS
// ============================================

export function useLiveChainMetrics() {
  const [metrics, setMetrics] = useState<ChainMetrics>({
    blockNumber: null,
    gasPrice: null,
    finality: null,
    connected: false,
    lastUpdate: null,
  });
  const [error, setError] = useState<DataSourceError | null>(null);

  const fetchChainMetrics = useCallback(async () => {
    try {
      const start = performance.now();
      
      const [blockHex, gasPriceHex] = await Promise.all([
        monadRpcCall<string>("eth_blockNumber"),
        monadRpcCall<string>("eth_gasPrice"),
      ]);
      
      const finality = Math.round(performance.now() - start);
      
      setMetrics({
        blockNumber: parseInt(blockHex, 16),
        gasPrice: Math.round(parseInt(gasPriceHex, 16) / 1e9 * 1000) / 1000, // gwei with 3 decimals
        finality,
        connected: true,
        lastUpdate: new Date(),
      });
      setError(null);
    } catch (err) {
      setMetrics((prev) => ({ ...prev, connected: false }));
      if (err instanceof ConnectionError) {
        setError(err.toDataSourceError());
      } else {
        setError({
          source: "MONAD_CHAIN",
          code: "RPC_ERROR",
          message: String(err),
          timestamp: new Date(),
        });
      }
    }
  }, []);

  useEffect(() => {
    fetchChainMetrics();
    
    // Poll every 2 seconds
    const interval = setInterval(fetchChainMetrics, 2000);
    return () => clearInterval(interval);
  }, [fetchChainMetrics]);

  return {
    metrics,
    error,
    retry: fetchChainMetrics,
  };
}

// ============================================
// HOOK - SERVICE HEALTH
// ============================================

export function useLiveServiceHealth() {
  const [services, setServices] = useState<ServiceHealth[]>([
    { name: "Orchestrator", status: "offline", latency: null, lastCheck: null },
    { name: "Ingestion", status: "offline", latency: null, lastCheck: null },
    { name: "Execution", status: "offline", latency: null, lastCheck: null },
    { name: "Memory", status: "offline", latency: null, lastCheck: null },
  ]);
  const [error, setError] = useState<DataSourceError | null>(null);

  const checkServices = useCallback(async () => {
    const baseUrl = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "";
    
    if (!baseUrl) {
      setServices((prev) =>
        prev.map((s) => ({
          ...s,
          status: "offline" as const,
          error: "URL not configured",
          lastCheck: new Date(),
        }))
      );
      setError({
        source: "SERVICE_HEALTH",
        code: "CONFIG_MISSING",
        message: "NEXT_PUBLIC_ORCHESTRATOR_URL not configured",
        timestamp: new Date(),
      });
      return;
    }

    const endpoints: Record<string, string> = {
      Orchestrator: `${baseUrl}/health`,
      Ingestion: `${baseUrl}/api/ingestion/health`,
      Execution: `${baseUrl}/api/execution/health`,
      Memory: `${baseUrl}/api/memory/health`,
    };

    const results = await Promise.all(
      Object.entries(endpoints).map(async ([name, url]) => {
        const result = await measureLatency(url);
        return { name, result };
      })
    );

    setServices(
      results.map(({ name, result }) => ({
        name,
        status: "error" in result ? "offline" : "online",
        latency: "latency" in result ? result.latency : null,
        lastCheck: new Date(),
        error: "error" in result ? result.error : undefined,
      }))
    );

    const hasOffline = results.some((r) => "error" in r.result);
    if (hasOffline) {
      setError({
        source: "SERVICE_HEALTH",
        code: "SERVICES_DOWN",
        message: "Some services are offline",
        timestamp: new Date(),
      });
    } else {
      setError(null);
    }
  }, []);

  useEffect(() => {
    checkServices();
    
    // Check every 10 seconds
    const interval = setInterval(checkServices, 10000);
    return () => clearInterval(interval);
  }, [checkServices]);

  return {
    services,
    error,
    retry: checkServices,
  };
}
