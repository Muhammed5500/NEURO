"use client";

/**
 * useLiveNadfun Hook
 * 
 * Connects to LIVE nad.fun operations and bonding curve data.
 * NO MOCK DATA - errors if backend unavailable.
 */

import { useState, useEffect, useCallback } from "react";
import {
  API,
  liveFetch,
  ConnectionError,
  type ConnectionState,
  type DataSourceError,
} from "@/lib/live-data-client";

// ============================================
// TYPES
// ============================================

export type OperationType = "DEPLOY_TOKEN" | "X_CAMPAIGN" | "MASS_COMMENT" | "LIQUIDITY_ADD";
export type CurveStatus = "ACTIVE" | "STALLING" | "ACCELERATING" | "NEAR_GRADUATION" | "GRADUATED";

export interface PendingOperation {
  id: string;
  type: OperationType;
  title: string;
  description: string;
  status: "pending" | "executing" | "awaiting_approval";
  priority: "low" | "medium" | "high" | "critical";
  confidence: number;
  estimatedCostMon: number;
  estimatedImpact: {
    reach?: number;
    engagement?: number;
    viralPotential?: number;
  };
  metadata: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

export interface ActiveToken {
  id: string;
  contractAddress: string;
  symbol: string;
  name: string;
  curveProgress: number;
  status: CurveStatus;
  currentPrice: number;
  priceChange24h: number;
  liquidity: number;
  holders: number;
  volume24h: number;
  graduationTarget: number;
  estimatedTimeToGrad: string | null;
  velocity: number;
  deployedAt: string;
}

// ============================================
// HOOK - PENDING OPERATIONS
// ============================================

export function useLiveOperations() {
  const [operations, setOperations] = useState<PendingOperation[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [error, setError] = useState<DataSourceError | null>(null);

  const fetchOperations = useCallback(async () => {
    try {
      setConnectionState("connecting");
      setError(null);

      const data = await liveFetch<{ operations: PendingOperation[] }>(
        API.nadfun.pendingOps(),
        "NADFUN_OPERATIONS"
      );

      setOperations(data.operations);
      setConnectionState("connected");
    } catch (err) {
      if (err instanceof ConnectionError) {
        setError(err.toDataSourceError());
      } else {
        setError({
          source: "NADFUN_OPERATIONS",
          code: "UNKNOWN",
          message: String(err),
          timestamp: new Date(),
        });
      }
      setConnectionState("error");
    }
  }, []);

  const approveOperation = useCallback(async (id: string) => {
    try {
      await liveFetch(
        API.nadfun.approve(id),
        "NADFUN_APPROVE",
        { method: "POST" }
      );
      // Refetch after approval
      await fetchOperations();
    } catch (err) {
      if (err instanceof ConnectionError) {
        throw err;
      }
      throw new ConnectionError("NADFUN_APPROVE", "UNKNOWN", String(err));
    }
  }, [fetchOperations]);

  const rejectOperation = useCallback(async (id: string) => {
    try {
      await liveFetch(
        API.nadfun.reject(id),
        "NADFUN_REJECT",
        { method: "POST" }
      );
      // Refetch after rejection
      await fetchOperations();
    } catch (err) {
      if (err instanceof ConnectionError) {
        throw err;
      }
      throw new ConnectionError("NADFUN_REJECT", "UNKNOWN", String(err));
    }
  }, [fetchOperations]);

  useEffect(() => {
    fetchOperations();
    
    // Poll every 5 seconds for updates
    const interval = setInterval(fetchOperations, 5000);
    return () => clearInterval(interval);
  }, [fetchOperations]);

  return {
    operations,
    connectionState,
    error,
    approveOperation,
    rejectOperation,
    retry: fetchOperations,
    isConnected: connectionState === "connected",
  };
}

// ============================================
// HOOK - BONDING CURVES
// ============================================

export function useLiveBondingCurves() {
  const [tokens, setTokens] = useState<ActiveToken[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [error, setError] = useState<DataSourceError | null>(null);

  const fetchTokens = useCallback(async () => {
    try {
      setConnectionState("connecting");
      setError(null);

      const data = await liveFetch<{ tokens: ActiveToken[] }>(
        API.nadfun.bondingCurves(),
        "NADFUN_BONDING_CURVES"
      );

      setTokens(data.tokens);
      setConnectionState("connected");
    } catch (err) {
      if (err instanceof ConnectionError) {
        setError(err.toDataSourceError());
      } else {
        setError({
          source: "NADFUN_BONDING_CURVES",
          code: "UNKNOWN",
          message: String(err),
          timestamp: new Date(),
        });
      }
      setConnectionState("error");
    }
  }, []);

  useEffect(() => {
    fetchTokens();
    
    // Poll every 3 seconds for real-time curve updates
    const interval = setInterval(fetchTokens, 3000);
    return () => clearInterval(interval);
  }, [fetchTokens]);

  return {
    tokens,
    connectionState,
    error,
    retry: fetchTokens,
    isConnected: connectionState === "connected",
  };
}
