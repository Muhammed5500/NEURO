/**
 * Metrics Collection Service
 * 
 * Central service for collecting and exposing metrics:
 * - Latency tracking
 * - Chain comparisons
 * - Dashboard data generation
 * 
 * Acceptance criteria: "Panel updates live during runs"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import { EventEmitter } from "events";
import type {
  LatencyPhase,
  LatencyMeasurement,
  LatencyStats,
  RunLatencyBreakdown,
  MetricsDashboardData,
  SourcedValue,
  DataSource,
} from "./types.js";
import { LatencyTracker, createLatencyTracker } from "./latency-tracker.js";
import { ChainComparisonService, createChainComparisonService } from "./chain-comparison.js";

const metricsLogger = logger.child({ component: "metrics-service" });

// ============================================
// METRICS SERVICE
// ============================================

export class MetricsService extends EventEmitter {
  private readonly latencyTracker: LatencyTracker;
  private readonly chainComparison: ChainComparisonService;
  
  // Current run tracking
  private currentRunId: string | null = null;
  
  // Update interval
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly updateIntervalMs = 1000; // 1 second updates

  constructor(
    latencyTracker?: LatencyTracker,
    chainComparison?: ChainComparisonService
  ) {
    super();
    
    this.latencyTracker = latencyTracker || createLatencyTracker();
    this.chainComparison = chainComparison || createChainComparisonService();
    
    this.setMaxListeners(50);

    metricsLogger.info("MetricsService initialized");
  }

  /**
   * Start live updates
   * Acceptance criteria: "Panel updates live during runs"
   */
  startLiveUpdates(): void {
    if (this.updateInterval) return;

    this.updateInterval = setInterval(() => {
      this.emitDashboardUpdate();
    }, this.updateIntervalMs);

    metricsLogger.info("Live metric updates started");
  }

  /**
   * Stop live updates
   */
  stopLiveUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Start tracking a run
   */
  startRun(runId: string): void {
    this.currentRunId = runId;
    this.latencyTracker.startRun(runId);
    
    this.emit("run:start", { runId });
    this.emitDashboardUpdate();
  }

  /**
   * Complete a run
   */
  completeRun(runId: string): RunLatencyBreakdown | undefined {
    const breakdown = this.latencyTracker.completeRun(runId);
    
    if (breakdown && this.currentRunId === runId) {
      this.currentRunId = null;
      
      // Update chain comparison with measured latency
      const executionMs = breakdown.phases.execution?.durationMs || 
                         breakdown.phases.finality?.durationMs ||
                         breakdown.totalLatencyMs;
      this.chainComparison.updateMeasuredMetrics(executionMs);
    }
    
    this.emit("run:complete", { runId, breakdown });
    this.emitDashboardUpdate();
    
    return breakdown;
  }

  /**
   * Start measuring a phase
   */
  startPhase(phase: LatencyPhase, operationId?: string): string {
    return this.latencyTracker.startPhase(phase, this.currentRunId || undefined, operationId);
  }

  /**
   * End measuring a phase
   */
  endPhase(measurementId: string, metadata?: Record<string, unknown>): LatencyMeasurement | null {
    const measurement = this.latencyTracker.endPhase(measurementId, metadata);
    
    if (measurement) {
      this.emit("phase:complete", measurement);
      this.emitDashboardUpdate();
    }
    
    return measurement;
  }

  /**
   * Record an external measurement
   */
  recordMeasurement(
    phase: LatencyPhase,
    durationMs: number,
    source: DataSource = "measured",
    operationId?: string,
    metadata?: Record<string, unknown>
  ): LatencyMeasurement {
    const measurement = this.latencyTracker.recordMeasurement(
      phase,
      durationMs,
      source,
      this.currentRunId || undefined,
      operationId,
      metadata
    );
    
    this.emit("measurement:recorded", measurement);
    this.emitDashboardUpdate();
    
    return measurement;
  }

  /**
   * Measure an async function
   */
  async measureAsync<T>(
    phase: LatencyPhase,
    fn: () => Promise<T>,
    operationId?: string
  ): Promise<{ result: T; measurement: LatencyMeasurement }> {
    const result = await this.latencyTracker.measureAsync(
      phase,
      fn,
      this.currentRunId || undefined,
      operationId
    );
    
    this.emit("phase:complete", result.measurement);
    this.emitDashboardUpdate();
    
    return result;
  }

  /**
   * Get dashboard data
   * Turkish: "Her rakamın yanında [measured] veya [config-ref] etiketi olsun"
   */
  getDashboardData(): MetricsDashboardData {
    const latencyStats = this.latencyTracker.getAllPhaseStats();
    const chainComparisons = this.chainComparison.compareWithAllChains();
    const gaugeData = this.chainComparison.getGaugeData();
    const summary = this.latencyTracker.getSummary();
    
    // Build sourced values for summary
    const avgIngestionMs: SourcedValue<number> = {
      value: summary.avgIngestionMs,
      source: summary.totalMeasurements > 0 ? "measured" : "config-ref",
      measuredAt: Date.now(),
    };
    
    const avgConsensusMs: SourcedValue<number> = {
      value: summary.avgConsensusMs,
      source: summary.totalMeasurements > 0 ? "measured" : "config-ref",
      measuredAt: Date.now(),
    };
    
    const avgExecutionMs: SourcedValue<number> = {
      value: summary.avgExecutionMs,
      source: summary.totalMeasurements > 0 ? "measured" : "config-ref",
      measuredAt: Date.now(),
    };
    
    const avgTotalMs: SourcedValue<number> = {
      value: summary.avgTotalRunMs,
      source: summary.completedRuns > 0 ? "measured" : "config-ref",
      measuredAt: Date.now(),
    };

    // Calculate estimated USD saved (vs Ethereum as baseline)
    const ethComparison = chainComparisons.comparisons.ethereum;
    const estimatedUsdSaved: SourcedValue<number> = {
      value: ethComparison?.costSavedUsd.value || 0,
      source: ethComparison?.costSavedUsd.source || "config-ref",
      measuredAt: Date.now(),
    };

    return {
      currentRun: this.currentRunId 
        ? this.latencyTracker.getRunBreakdown(this.currentRunId) 
        : undefined,
      latencyStats: latencyStats as Record<LatencyPhase, LatencyStats>,
      chainComparisons,
      gaugeData,
      summary: {
        totalMeasurements: summary.totalMeasurements,
        avgIngestionMs,
        avgConsensusMs,
        avgExecutionMs,
        avgTotalMs,
        estimatedUsdSaved,
      },
      generatedAt: Date.now(),
    };
  }

  /**
   * Get latency tracker (for direct access)
   */
  getLatencyTracker(): LatencyTracker {
    return this.latencyTracker;
  }

  /**
   * Get chain comparison service (for direct access)
   */
  getChainComparison(): ChainComparisonService {
    return this.chainComparison;
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.latencyTracker.clear();
    this.currentRunId = null;
    this.emitDashboardUpdate();
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private emitDashboardUpdate(): void {
    const data = this.getDashboardData();
    this.emit("dashboard:update", data);
  }
}

/**
 * Factory function
 */
export function createMetricsService(
  latencyTracker?: LatencyTracker,
  chainComparison?: ChainComparisonService
): MetricsService {
  return new MetricsService(latencyTracker, chainComparison);
}

// Singleton instance
let metricsService: MetricsService | null = null;

export function getMetricsService(): MetricsService {
  if (!metricsService) {
    metricsService = new MetricsService();
  }
  return metricsService;
}
