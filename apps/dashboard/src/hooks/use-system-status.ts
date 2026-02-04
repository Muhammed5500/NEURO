"use client";

/**
 * useSystemStatus Hook - LIVE DATA ONLY
 * 
 * Fetches REAL system status from backend.
 * NO MOCK DATA - returns error state if unavailable.
 */

import { useQuery } from "@tanstack/react-query";
import { liveFetch, API, ConnectionError, type DataSourceError } from "@/lib/live-data-client";

export interface SystemStatus {
  execution: ServiceStatus;
  orchestrator: ServiceStatus;
  ingestion: ServiceStatus;
  database: ServiceStatus;
  killSwitchEnabled: boolean;
  executionMode: "READ_ONLY" | "WRITE_ENABLED" | "DEMO";
  chainStats: {
    blockNumber: number | null;
    gasPrice: number | null;
    connected: boolean;
  };
}

export interface ServiceStatus {
  status: "online" | "offline" | "degraded";
  latency: number | null;
  lastCheck: Date;
  error?: string;
}

async function fetchSystemStatus(): Promise<SystemStatus> {
  try {
    const data = await liveFetch<SystemStatus>(
      API.orchestrator.status(),
      "SYSTEM_STATUS"
    );
    return data;
  } catch (err) {
    // Re-throw connection errors
    if (err instanceof ConnectionError) {
      throw err;
    }
    throw new ConnectionError("SYSTEM_STATUS", "UNKNOWN", String(err));
  }
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ["systemStatus"],
    queryFn: fetchSystemStatus,
    refetchInterval: 5000, // Refresh every 5 seconds
    retry: false, // Don't retry on failure - show error immediately
    staleTime: 0, // Always fetch fresh data
  });
}
