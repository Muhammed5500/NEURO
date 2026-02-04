"use client";

import { useQuery } from "@tanstack/react-query";

export interface SystemStatus {
  execution: ServiceStatus;
  orchestrator: ServiceStatus;
  ingestion: ServiceStatus;
  database: ServiceStatus;
  killSwitchEnabled: boolean;
  executionMode: "READ_ONLY" | "WRITE_ENABLED";
  chainStats: {
    blockNumber: number;
    gasPrice: number;
    connected: boolean;
  };
}

export interface ServiceStatus {
  status: "online" | "offline" | "degraded";
  latency: number;
  lastCheck: Date;
}

async function fetchSystemStatus(): Promise<SystemStatus> {
  // In production, this would fetch from an API
  // For now, return mock data
  return {
    execution: { status: "online", latency: 45, lastCheck: new Date() },
    orchestrator: { status: "online", latency: 120, lastCheck: new Date() },
    ingestion: { status: "online", latency: 12, lastCheck: new Date() },
    database: { status: "online", latency: 3, lastCheck: new Date() },
    killSwitchEnabled: false,
    executionMode: "READ_ONLY",
    chainStats: {
      blockNumber: 0,
      gasPrice: 0,
      connected: true,
    },
  };
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ["systemStatus"],
    queryFn: fetchSystemStatus,
    refetchInterval: 5000, // Refresh every 5 seconds
  });
}
