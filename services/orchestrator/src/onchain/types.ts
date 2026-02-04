/**
 * OnChain Types
 * 
 * Types for on-chain data providers and queries.
 */

import { z } from "zod";

// ============================================
// CAPABILITY FLAGS
// ============================================

/**
 * Capability flags for provider features.
 * Allows graceful degradation when features aren't available.
 */
export interface ProviderCapabilities {
  // Core capabilities
  supportsMulticall: boolean;
  supportsBlockSubscriptions: boolean;
  supportsTraceApi: boolean;
  
  // MonadDB specific
  // Turkish: "Monad'ın özel MonadDb yapısı"
  supportsMonadDb: boolean;
  supportsDeferredExecution: boolean;
  
  // nad.fun specific
  supportsNadFunApi: boolean;
  supportsBondingCurveQueries: boolean;
  
  // Mempool visibility
  supportsMempoolQueries: boolean;
  supportsPendingTransactions: boolean;
  
  // Historical data
  supportsHistoricalBlocks: boolean;
  maxHistoricalBlocks: number;
}

export const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  supportsMulticall: true,
  supportsBlockSubscriptions: false,
  supportsTraceApi: false,
  supportsMonadDb: false,
  supportsDeferredExecution: false,
  supportsNadFunApi: true,
  supportsBondingCurveQueries: true,
  supportsMempoolQueries: false,
  supportsPendingTransactions: false,
  supportsHistoricalBlocks: true,
  maxHistoricalBlocks: 1000,
};

// ============================================
// NETWORK STATE
// ============================================

export interface NetworkState {
  chainId: number;
  blockNumber: bigint;
  timestamp: number;
  baseFeePerGas: bigint;
  gasPrice: bigint;
  gasPriceGwei: number;
  congestionLevel: "low" | "medium" | "high" | "extreme";
}

// ============================================
// POOL / LIQUIDITY DATA
// ============================================

export interface PoolLiquidity {
  tokenAddress: string;
  tokenSymbol: string;
  
  // Reserve amounts
  tokenReserve: bigint;
  monReserve: bigint;
  
  // USD values
  tokenReserveUsd: number;
  monReserveUsd: number;
  totalLiquidityUsd: number;
  
  // Bonding curve specific (nad.fun)
  bondingCurveProgress: number; // 0-100%
  graduationThreshold: bigint;
  isGraduated: boolean;
  
  // Price data
  currentPrice: number;
  pricePerMon: number;
  
  // Volume
  volume24h: number;
  volumeChange24h: number;
  
  // Last update
  lastUpdatedBlock: bigint;
  lastUpdatedAt: number;
}

// ============================================
// PRICE IMPACT CALCULATION
// ============================================

/**
 * Price impact result from bonding curve calculation.
 * Turkish: "yapacağımız işlemin fiyatı ne kadar kaydıracağını"
 */
export interface PriceImpact {
  // Input
  tradeAmountMon: number;
  tradeDirection: "buy" | "sell";
  
  // Impact
  priceImpactPercent: number;
  priceImpactBps: number; // Basis points
  
  // Expected execution
  expectedPrice: number;
  expectedOutput: bigint;
  minimumOutput: bigint; // With slippage
  
  // Warnings
  isHighImpact: boolean;
  warningLevel: "none" | "low" | "medium" | "high" | "extreme";
  warningMessage?: string;
  
  // Calculation metadata
  calculationMethod: "bonding_curve" | "constant_product" | "estimated";
  calculatedAt: number;
}

// ============================================
// BOT ACTIVITY / TRANSACTION PATTERNS
// ============================================

/**
 * Transaction pattern for bot detection.
 * Turkish: "sandviç saldırısı (sandwich attack) veya bot kümelenmesi"
 */
export interface TransactionPattern {
  txHash: string;
  blockNumber: bigint;
  timestamp: number;
  
  // Transaction details
  from: string;
  to: string;
  methodId: string;
  methodName?: string;
  
  // Value
  valueMon: number;
  gasUsed?: bigint;
  
  // Classification
  transactionType: "create" | "swap" | "transfer" | "approve" | "other";
  
  // Bot detection scores
  isSuspicious: boolean;
  botScore: number; // 0-1
}

/**
 * Bot radar analysis result.
 * Turkish: "BotRadar fonksiyonu"
 */
export interface BotRadarResult {
  // Analysis window
  windowStartBlock: bigint;
  windowEndBlock: bigint;
  windowSeconds: number;
  
  // Transaction counts
  totalTransactions: number;
  createCount: number;
  swapCount: number;
  
  // Bot activity indicators
  suspiciousPatternCount: number;
  potentialSandwichCount: number;
  botClusterCount: number;
  
  // Risk assessment
  botActivityLevel: "none" | "low" | "medium" | "high" | "extreme";
  riskScore: number; // 0-1
  
  // Detailed patterns
  patterns: BotPattern[];
  
  // Recommendations
  recommendations: string[];
  
  // Analysis metadata
  analyzedAt: number;
  analysisMethod: string;
}

export interface BotPattern {
  patternType: "sandwich" | "frontrun" | "backrun" | "burst" | "cluster";
  confidence: number;
  
  // Involved transactions
  transactions: string[]; // tx hashes
  
  // Involved addresses
  addresses: string[];
  
  // Details
  description: string;
  impactEstimate?: number;
}

// ============================================
// HOLDER ANALYSIS
// ============================================

export interface HolderAnalysis {
  tokenAddress: string;
  
  // Counts
  totalHolders: number;
  newHolders24h: number;
  
  // Distribution
  top10HoldersPercent: number;
  top50HoldersPercent: number;
  
  // Top holders
  topHolders: Array<{
    address: string;
    balance: bigint;
    balancePercent: number;
    isContract: boolean;
    label?: string;
  }>;
  
  // Whale activity
  whaleTransactions24h: number;
  netWhaleFlow24h: number; // Positive = accumulation
  
  // Analysis
  distributionHealth: "healthy" | "concentrated" | "whale_dominated";
  riskLevel: "low" | "medium" | "high";
}

// ============================================
// CACHE ENTRY
// ============================================

export interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  expiresAt: number;
  source: "rpc" | "api" | "simulation";
}
