/**
 * Metrics Types
 * 
 * Types for latency tracking and chain comparison:
 * - Ingestion, consensus, execution latency
 * - Reference chain comparison (Ethereum, Solana, etc.)
 * - Source labeling for transparency
 * 
 * Turkish: "Her rakamın yanında [measured] veya [config-ref] etiketi olsun"
 */

// ============================================
// SOURCE LABELING
// ============================================

/**
 * Data source type for transparency
 * Turkish: "[measured] (gerçek ölçüm) veya [config-ref] (referans sabit)"
 */
export type DataSource = "measured" | "config-ref" | "simulated" | "estimated";

/**
 * Value with source annotation
 * Acceptance criteria: "All numbers cite their input sources"
 */
export interface SourcedValue<T> {
  value: T;
  source: DataSource;
  measuredAt?: number;
  confidence?: number; // 0-1 for estimated values
}

// ============================================
// LATENCY METRICS
// ============================================

/**
 * Latency measurement point
 */
export type LatencyPhase =
  | "ingestion"       // Data fetching
  | "embedding"       // Vector embedding
  | "agent_analysis"  // Individual agent work
  | "consensus"       // Consensus building
  | "planning"        // Execution plan generation
  | "simulation"      // Bundle simulation
  | "submission"      // Transaction submission
  | "mempool"         // Time in mempool
  | "execution"       // On-chain execution
  | "finality";       // Finality confirmation

/**
 * Single latency measurement
 * Turkish: "milisaniyelik hassasiyetle ölçecek"
 */
export interface LatencyMeasurement {
  phase: LatencyPhase;
  startTime: number;      // High-resolution timestamp
  endTime?: number;
  durationMs: number;
  source: DataSource;
  
  // Context
  runId?: string;
  operationId?: string;
  
  // Metadata
  metadata?: Record<string, unknown>;
}

/**
 * Aggregate latency statistics
 */
export interface LatencyStats {
  phase: LatencyPhase;
  
  // Basic stats
  count: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  
  // Percentiles
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  
  // Recent trend
  recentAvgMs: number;  // Last 10 measurements
  trend: "improving" | "stable" | "degrading";
  
  source: DataSource;
  lastUpdated: number;
}

/**
 * Complete run latency breakdown
 */
export interface RunLatencyBreakdown {
  runId: string;
  startTime: number;
  endTime?: number;
  
  // Phase timings
  phases: Record<LatencyPhase, LatencyMeasurement | undefined>;
  
  // Totals
  totalLatencyMs: number;
  criticalPathMs: number; // Longest sequential path
  
  // Status
  isComplete: boolean;
}

// ============================================
// REFERENCE CHAIN CONFIG
// ============================================

/**
 * Supported reference chains
 */
export type ReferenceChain = "ethereum" | "solana" | "arbitrum" | "polygon" | "optimism" | "base";

/**
 * Reference chain configuration
 * Turkish: "Referans zincirlerin anlık gaz fiyatlarını config üzerinden oku"
 */
export interface ReferenceChainConfig {
  name: string;
  chainId: number;
  
  // Timing characteristics (in ms)
  avgBlockTimeMs: number;
  avgFinalityMs: number;
  avgTxLatencyMs: number;
  
  // Gas costs (in native token)
  avgGasPrice: number;      // In gwei or equivalent
  avgGasLimit: number;      // Typical transaction
  
  // Native token price
  nativeTokenSymbol: string;
  nativeTokenPriceUsd: number;
  
  // Derived costs
  avgTxCostUsd: number;
  
  // Source
  source: DataSource;
  lastUpdated: number;
}

/**
 * Default reference chain configs (dev/simulation)
 */
export const DEFAULT_REFERENCE_CHAINS: Record<ReferenceChain, ReferenceChainConfig> = {
  ethereum: {
    name: "Ethereum",
    chainId: 1,
    avgBlockTimeMs: 12000,      // 12 seconds
    avgFinalityMs: 900000,      // ~15 minutes (safe finality)
    avgTxLatencyMs: 30000,      // 30 seconds typical
    avgGasPrice: 30,            // 30 gwei
    avgGasLimit: 21000,         // Simple transfer
    nativeTokenSymbol: "ETH",
    nativeTokenPriceUsd: 3500,
    avgTxCostUsd: 2.205,        // 30 gwei * 21000 * 3500 / 1e9
    source: "config-ref",
    lastUpdated: Date.now(),
  },
  solana: {
    name: "Solana",
    chainId: 101,
    avgBlockTimeMs: 400,        // 400ms
    avgFinalityMs: 13000,       // ~13 seconds
    avgTxLatencyMs: 2000,       // 2 seconds typical
    avgGasPrice: 0.000005,      // 5000 lamports = 0.000005 SOL
    avgGasLimit: 1,             // Simplified
    nativeTokenSymbol: "SOL",
    nativeTokenPriceUsd: 150,
    avgTxCostUsd: 0.00075,
    source: "config-ref",
    lastUpdated: Date.now(),
  },
  arbitrum: {
    name: "Arbitrum",
    chainId: 42161,
    avgBlockTimeMs: 250,        // 250ms
    avgFinalityMs: 1200000,     // ~20 minutes (L1 finality)
    avgTxLatencyMs: 2000,
    avgGasPrice: 0.1,           // 0.1 gwei
    avgGasLimit: 21000,
    nativeTokenSymbol: "ETH",
    nativeTokenPriceUsd: 3500,
    avgTxCostUsd: 0.00735,
    source: "config-ref",
    lastUpdated: Date.now(),
  },
  polygon: {
    name: "Polygon",
    chainId: 137,
    avgBlockTimeMs: 2000,       // 2 seconds
    avgFinalityMs: 180000,      // ~3 minutes
    avgTxLatencyMs: 5000,
    avgGasPrice: 50,            // 50 gwei
    avgGasLimit: 21000,
    nativeTokenSymbol: "MATIC",
    nativeTokenPriceUsd: 0.8,
    avgTxCostUsd: 0.00084,
    source: "config-ref",
    lastUpdated: Date.now(),
  },
  optimism: {
    name: "Optimism",
    chainId: 10,
    avgBlockTimeMs: 2000,       // 2 seconds
    avgFinalityMs: 1200000,     // ~20 minutes (L1 finality)
    avgTxLatencyMs: 3000,
    avgGasPrice: 0.001,         // Very low
    avgGasLimit: 21000,
    nativeTokenSymbol: "ETH",
    nativeTokenPriceUsd: 3500,
    avgTxCostUsd: 0.0000735,
    source: "config-ref",
    lastUpdated: Date.now(),
  },
  base: {
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
};

// ============================================
// MONAD METRICS
// ============================================

/**
 * Monad chain configuration
 */
export interface MonadConfig {
  name: "Monad";
  chainId: 143;
  
  // Monad's superior timing
  avgBlockTimeMs: 400;      // 400ms per block
  avgFinalityMs: 800;       // 2 blocks = 800ms
  avgTxLatencyMs: 500;      // Sub-second
  
  // Gas costs
  avgGasPrice: number;
  avgGasLimit: number;
  
  // Token
  nativeTokenSymbol: "MON";
  nativeTokenPriceUsd: number;
  avgTxCostUsd: number;
  
  source: DataSource;
  lastUpdated: number;
}

export const DEFAULT_MONAD_CONFIG: MonadConfig = {
  name: "Monad",
  chainId: 143,
  avgBlockTimeMs: 400,
  avgFinalityMs: 800,
  avgTxLatencyMs: 500,
  avgGasPrice: 1,           // 1 gwei equivalent
  avgGasLimit: 21000,
  nativeTokenSymbol: "MON",
  nativeTokenPriceUsd: 5,   // Hypothetical
  avgTxCostUsd: 0.000105,   // 1 gwei * 21000 * 5 / 1e9
  source: "config-ref",
  lastUpdated: Date.now(),
};

// ============================================
// COMPARISON METRICS
// ============================================

/**
 * Chain comparison result
 * Turkish: "Monad'daki işlem başına tasarrufu 'USD cinsinden' göster"
 */
export interface ChainComparison {
  referenceChain: ReferenceChain;
  referenceConfig: ReferenceChainConfig;
  monadConfig: MonadConfig;
  
  // Time savings
  latencySavedMs: SourcedValue<number>;
  latencySavedPercent: SourcedValue<number>;
  
  // Cost savings
  // Turkish: "'USD cinsinden' (Estimated USD Saved) büyük puntolarla göster"
  costSavedUsd: SourcedValue<number>;
  costSavedPercent: SourcedValue<number>;
  
  // Finality improvement
  finalitySavedMs: SourcedValue<number>;
  
  // Speed multiplier (e.g., "60x faster")
  speedMultiplier: SourcedValue<number>;
  
  // Timestamp
  calculatedAt: number;
}

/**
 * All chain comparisons
 */
export interface AllChainComparisons {
  monad: MonadConfig;
  comparisons: Record<ReferenceChain, ChainComparison>;
  
  // Best savings highlight
  bestLatencySaving: { chain: ReferenceChain; savedMs: number };
  bestCostSaving: { chain: ReferenceChain; savedUsd: number };
  
  lastUpdated: number;
}

// ============================================
// GAUGE DISPLAY
// ============================================

/**
 * Speed zone for gauge display
 * Turkish: "Monad'ın iğnesi her zaman 'Ultra Fast' bölgesinde kalsın"
 */
export type SpeedZone = "ultra_slow" | "slow" | "moderate" | "fast" | "ultra_fast";

export interface GaugeConfig {
  zones: Array<{
    zone: SpeedZone;
    minMs: number;
    maxMs: number;
    color: string;
    label: string;
  }>;
}

export const DEFAULT_GAUGE_CONFIG: GaugeConfig = {
  zones: [
    { zone: "ultra_fast", minMs: 0, maxMs: 1000, color: "#4ade80", label: "ULTRA FAST" },
    { zone: "fast", minMs: 1000, maxMs: 5000, color: "#22c55e", label: "FAST" },
    { zone: "moderate", minMs: 5000, maxMs: 15000, color: "#fbbf24", label: "MODERATE" },
    { zone: "slow", minMs: 15000, maxMs: 60000, color: "#f97316", label: "SLOW" },
    { zone: "ultra_slow", minMs: 60000, maxMs: Infinity, color: "#ef4444", label: "ULTRA SLOW" },
  ],
};

/**
 * Gauge display data
 */
export interface GaugeData {
  currentLatencyMs: SourcedValue<number>;
  zone: SpeedZone;
  zoneLabel: string;
  zoneColor: string;
  needlePosition: number; // 0-100 percentage
  
  // Comparison context
  vsEthereum: SourcedValue<number>; // multiplier
  vsSolana: SourcedValue<number>;
}

// ============================================
// DASHBOARD DATA
// ============================================

/**
 * Complete metrics dashboard data
 */
export interface MetricsDashboardData {
  // Current run metrics
  currentRun?: RunLatencyBreakdown;
  
  // Aggregate stats
  latencyStats: Record<LatencyPhase, LatencyStats>;
  
  // Chain comparisons
  chainComparisons: AllChainComparisons;
  
  // Gauge data
  gaugeData: GaugeData;
  
  // Summary
  summary: {
    totalMeasurements: number;
    avgIngestionMs: SourcedValue<number>;
    avgConsensusMs: SourcedValue<number>;
    avgExecutionMs: SourcedValue<number>;
    avgTotalMs: SourcedValue<number>;
    estimatedUsdSaved: SourcedValue<number>;
  };
  
  generatedAt: number;
}
