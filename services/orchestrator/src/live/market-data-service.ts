/**
 * Live Market Data Service
 * 
 * Fetches real-time market data from Monad RPC and nad.fun API.
 * Replaces mock/empty data in analyzeMarketNode.
 * 
 * Turkish: "Monad RPC ve nad.fun API'den canlı piyasa verisi çek"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { OnChainSignal } from "../graph/state.js";
import { ConnectionError } from "./ingestion-bridge.js";

const marketLogger = logger.child({ component: "market-data-service" });

// ============================================
// TYPES
// ============================================

export interface MarketDataConfig {
  monadRpcUrl: string;
  nadfunApiUrl?: string;
  nadfunApiKey?: string;
  timeout?: number;
  cacheTtlMs?: number;
}

export interface TrendingToken {
  address: string;
  symbol: string;
  name: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  holders: number;
  bondingCurveProgress: number;
  rank: number;
}

export interface NewToken {
  address: string;
  symbol: string;
  name: string;
  deployedAt: string;
  initialLiquidity: number;
  creatorAddress: string;
}

export interface MarketContext {
  trendingTokens: TrendingToken[];
  newTokens: NewToken[];
  networkState: {
    blockNumber: number;
    gasPrice: number;
    gasPriceGwei: number;
    networkCongestion: "low" | "medium" | "high";
  };
  timestamp: Date;
}

// ============================================
// MARKET DATA SERVICE
// ============================================

export class MarketDataService {
  private config: Required<MarketDataConfig>;
  private cache: Map<string, { data: unknown; expiresAt: number }> = new Map();
  private healthy = false;

  constructor(config: MarketDataConfig) {
    this.config = {
      monadRpcUrl: config.monadRpcUrl,
      nadfunApiUrl: config.nadfunApiUrl || "https://api.nadapp.net",
      nadfunApiKey: config.nadfunApiKey || "",
      timeout: config.timeout || 10000,
      cacheTtlMs: config.cacheTtlMs || 10000, // 10 second cache
    };
  }

  /**
   * Initialize and verify connections
   */
  async initialize(): Promise<void> {
    try {
      // Check Monad RPC
      const blockNumber = await this.rpcCall<string>("eth_blockNumber");
      marketLogger.info(
        { blockNumber: parseInt(blockNumber, 16), rpcUrl: this.config.monadRpcUrl },
        "Connected to Monad RPC"
      );

      this.healthy = true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.healthy = false;
      throw new ConnectionError(
        "MARKET_DATA_SERVICE",
        "RPC_CONNECTION_FAILED",
        `Failed to connect to Monad RPC: ${error.message}`,
        error
      );
    }
  }

  /**
   * Get full market context
   */
  async getMarketContext(): Promise<MarketContext> {
    const [networkState, trendingTokens, newTokens] = await Promise.all([
      this.getNetworkState(),
      this.getTrendingTokens(),
      this.getNewTokens(),
    ]);

    return {
      networkState,
      trendingTokens,
      newTokens,
      timestamp: new Date(),
    };
  }

  /**
   * Get current network state from Monad RPC
   */
  async getNetworkState(): Promise<MarketContext["networkState"]> {
    const cacheKey = "networkState";
    const cached = this.getFromCache<MarketContext["networkState"]>(cacheKey);
    if (cached) return cached;

    try {
      const [blockNumberHex, gasPriceHex] = await Promise.all([
        this.rpcCall<string>("eth_blockNumber"),
        this.rpcCall<string>("eth_gasPrice"),
      ]);

      const blockNumber = parseInt(blockNumberHex, 16);
      const gasPrice = parseInt(gasPriceHex, 16);
      const gasPriceGwei = gasPrice / 1e9;

      // Determine network congestion based on gas price
      let networkCongestion: "low" | "medium" | "high" = "low";
      if (gasPriceGwei > 50) {
        networkCongestion = "high";
      } else if (gasPriceGwei > 10) {
        networkCongestion = "medium";
      }

      const state = {
        blockNumber,
        gasPrice,
        gasPriceGwei,
        networkCongestion,
      };

      this.setCache(cacheKey, state);
      return state;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new ConnectionError(
        "MARKET_DATA_SERVICE",
        "RPC_CALL_FAILED",
        `Failed to get network state: ${error.message}`,
        error
      );
    }
  }

  /**
   * Get trending tokens from nad.fun API
   */
  async getTrendingTokens(limit = 10): Promise<TrendingToken[]> {
    const cacheKey = `trendingTokens:${limit}`;
    const cached = this.getFromCache<TrendingToken[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.nadfunFetch(
        `/api/v1/market/trending?limit=${limit}`
      );

      if (!response.ok) {
        if (response.status === 404 || response.status === 503) {
          // API not available, return empty
          marketLogger.warn("nad.fun trending API not available");
          return [];
        }
        throw new Error(`nad.fun API error: ${response.status}`);
      }

      const data = await response.json() as { tokens?: TrendingToken[] };
      const tokens = data.tokens || [];

      this.setCache(cacheKey, tokens);
      return tokens;
    } catch (err) {
      // Don't fail hard on nad.fun API errors - it's supplementary data
      marketLogger.warn({ error: err }, "Failed to fetch trending tokens");
      return [];
    }
  }

  /**
   * Get newly deployed tokens from nad.fun API
   */
  async getNewTokens(limit = 10): Promise<NewToken[]> {
    const cacheKey = `newTokens:${limit}`;
    const cached = this.getFromCache<NewToken[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.nadfunFetch(`/api/v1/market/new?limit=${limit}`);

      if (!response.ok) {
        if (response.status === 404 || response.status === 503) {
          return [];
        }
        throw new Error(`nad.fun API error: ${response.status}`);
      }

      const data = await response.json() as { tokens?: NewToken[] };
      const tokens = data.tokens || [];

      this.setCache(cacheKey, tokens);
      return tokens;
    } catch (err) {
      marketLogger.warn({ error: err }, "Failed to fetch new tokens");
      return [];
    }
  }

  /**
   * Get on-chain signal for a specific token
   */
  async getOnChainSignal(tokenAddress?: string): Promise<OnChainSignal> {
    const networkState = await this.getNetworkState();

    const baseSignal: OnChainSignal = {
      gasPrice: networkState.gasPrice.toString(),
      gasPriceGwei: networkState.gasPriceGwei,
      blockNumber: networkState.blockNumber,
      networkCongestion: networkState.networkCongestion,
      timestamp: new Date().toISOString(),
    };

    if (!tokenAddress) {
      return baseSignal;
    }

    // Try to get token-specific data
    try {
      const tokenData = await this.getTokenData(tokenAddress);
      return {
        ...baseSignal,
        tokenAddress,
        tokenSymbol: tokenData.symbol,
        poolLiquidity: tokenData.liquidity.toString(),
        poolLiquidityUsd: tokenData.liquidity,
        volume24h: tokenData.volume24h,
        holderCount: tokenData.holders,
        bondingCurveProgress: tokenData.bondingCurveProgress,
      };
    } catch (err) {
      marketLogger.warn({ tokenAddress, error: err }, "Failed to get token data");
      return baseSignal;
    }
  }

  /**
   * Get token data from nad.fun API
   */
  async getTokenData(tokenAddress: string): Promise<TrendingToken> {
    const cacheKey = `tokenData:${tokenAddress}`;
    const cached = this.getFromCache<TrendingToken>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.nadfunFetch(
        `/api/v1/tokens/address/${tokenAddress}`
      );

      if (!response.ok) {
        throw new Error(`Token not found: ${response.status}`);
      }

      const data = await response.json() as TrendingToken;
      this.setCache(cacheKey, data);
      return data;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new ConnectionError(
        "MARKET_DATA_SERVICE",
        "TOKEN_DATA_FAILED",
        `Failed to get token data: ${error.message}`,
        error
      );
    }
  }

  /**
   * Check if service is healthy
   */
  async isHealthy(): Promise<boolean> {
    if (!this.healthy) return false;

    try {
      await this.rpcCall<string>("eth_blockNumber");
      return true;
    } catch {
      this.healthy = false;
      return false;
    }
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private async rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(this.config.monadRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`RPC request failed: ${response.status}`);
    }

    const data = await response.json() as { result?: T; error?: { message: string } };

    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`);
    }

    return data.result as T;
  }

  private async nadfunFetch(path: string): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.nadfunApiKey) {
      headers["X-API-Key"] = this.config.nadfunApiKey;
    }

    return fetch(`${this.config.nadfunApiUrl}${path}`, {
      headers,
      signal: AbortSignal.timeout(this.config.timeout),
    });
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  private setCache(key: string, data: unknown): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    });
  }
}

// ============================================
// FACTORY
// ============================================

export function createMarketDataService(config: MarketDataConfig): MarketDataService {
  return new MarketDataService(config);
}
