/**
 * Metrics Types for Dashboard
 * 
 * Types for displaying latency and comparison metrics
 */

export type DataSource = "measured" | "config-ref" | "simulated" | "estimated";

export interface SourcedValue<T> {
  value: T;
  source: DataSource;
  measuredAt?: number;
  confidence?: number;
}

export type LatencyPhase =
  | "ingestion"
  | "embedding"
  | "agent_analysis"
  | "consensus"
  | "planning"
  | "simulation"
  | "submission"
  | "mempool"
  | "execution"
  | "finality";

export interface LatencyStats {
  phase: LatencyPhase;
  count: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  recentAvgMs: number;
  trend: "improving" | "stable" | "degrading";
  source: DataSource;
  lastUpdated: number;
}

export type ReferenceChain = "ethereum" | "solana" | "arbitrum" | "polygon" | "optimism" | "base";

export interface ReferenceChainConfig {
  name: string;
  chainId: number;
  avgBlockTimeMs: number;
  avgFinalityMs: number;
  avgTxLatencyMs: number;
  avgGasPrice: number;
  avgGasLimit: number;
  nativeTokenSymbol: string;
  nativeTokenPriceUsd: number;
  avgTxCostUsd: number;
  source: DataSource;
  lastUpdated: number;
}

export interface ChainComparison {
  referenceChain: ReferenceChain;
  referenceConfig: ReferenceChainConfig;
  latencySavedMs: SourcedValue<number>;
  latencySavedPercent: SourcedValue<number>;
  costSavedUsd: SourcedValue<number>;
  costSavedPercent: SourcedValue<number>;
  finalitySavedMs: SourcedValue<number>;
  speedMultiplier: SourcedValue<number>;
  calculatedAt: number;
}

export interface AllChainComparisons {
  comparisons: Record<ReferenceChain, ChainComparison>;
  bestLatencySaving: { chain: ReferenceChain; savedMs: number };
  bestCostSaving: { chain: ReferenceChain; savedUsd: number };
  lastUpdated: number;
}

export type SpeedZone = "ultra_slow" | "slow" | "moderate" | "fast" | "ultra_fast";

export interface GaugeData {
  currentLatencyMs: SourcedValue<number>;
  zone: SpeedZone;
  zoneLabel: string;
  zoneColor: string;
  needlePosition: number;
  vsEthereum: SourcedValue<number>;
  vsSolana: SourcedValue<number>;
}

export interface MetricsSummary {
  totalMeasurements: number;
  avgIngestionMs: SourcedValue<number>;
  avgConsensusMs: SourcedValue<number>;
  avgExecutionMs: SourcedValue<number>;
  avgTotalMs: SourcedValue<number>;
  estimatedUsdSaved: SourcedValue<number>;
}

export interface MetricsDashboardData {
  latencyStats: Record<LatencyPhase, LatencyStats | null>;
  chainComparisons: AllChainComparisons;
  gaugeData: GaugeData;
  summary: MetricsSummary;
  generatedAt: number;
}
