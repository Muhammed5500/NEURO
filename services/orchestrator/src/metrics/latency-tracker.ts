/**
 * Latency Tracker
 * 
 * High-precision latency measurement for all phases:
 * - Ingestion, consensus, execution
 * - Mempool to finality tracking
 * 
 * Turkish: "execution_latency ölçümünü, işlemin havuzdan (mempool) geçip
 * kesinleştiği (finality) ana kadar olan süreyi milisaniyelik hassasiyetle ölçecek"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  LatencyPhase,
  LatencyMeasurement,
  LatencyStats,
  RunLatencyBreakdown,
  DataSource,
} from "./types.js";

const trackerLogger = logger.child({ component: "latency-tracker" });

// ============================================
// HIGH-RESOLUTION TIMER
// ============================================

function getHighResTime(): number {
  // Use performance.now() for sub-millisecond precision
  if (typeof performance !== "undefined") {
    return performance.now();
  }
  // Fallback to Date.now()
  return Date.now();
}

// ============================================
// LATENCY TRACKER
// ============================================

export class LatencyTracker {
  // Active measurements (phase -> start time)
  private readonly activeMeasurements: Map<string, {
    phase: LatencyPhase;
    startTime: number;
    runId?: string;
    operationId?: string;
  }> = new Map();

  // Completed measurements per phase
  private readonly measurements: Map<LatencyPhase, LatencyMeasurement[]> = new Map();
  
  // Run breakdowns
  private readonly runBreakdowns: Map<string, RunLatencyBreakdown> = new Map();
  
  // Configuration
  private readonly maxMeasurementsPerPhase = 1000;
  private readonly maxRuns = 100;

  constructor() {
    // Initialize measurement storage for all phases
    const phases: LatencyPhase[] = [
      "ingestion", "embedding", "agent_analysis", "consensus",
      "planning", "simulation", "submission", "mempool", "execution", "finality"
    ];
    
    for (const phase of phases) {
      this.measurements.set(phase, []);
    }

    trackerLogger.info("LatencyTracker initialized with high-resolution timing");
  }

  /**
   * Start measuring a phase
   * Turkish: "milisaniyelik hassasiyetle ölçecek"
   */
  startPhase(
    phase: LatencyPhase,
    runId?: string,
    operationId?: string
  ): string {
    const measurementId = `${phase}-${runId || "global"}-${operationId || Date.now()}`;
    const startTime = getHighResTime();

    this.activeMeasurements.set(measurementId, {
      phase,
      startTime,
      runId,
      operationId,
    });

    // Update run breakdown if applicable
    if (runId) {
      this.ensureRunBreakdown(runId);
    }

    trackerLogger.debug({
      measurementId,
      phase,
      runId,
      startTime,
    }, "Phase measurement started");

    return measurementId;
  }

  /**
   * End measuring a phase
   */
  endPhase(
    measurementId: string,
    metadata?: Record<string, unknown>
  ): LatencyMeasurement | null {
    const active = this.activeMeasurements.get(measurementId);
    if (!active) {
      trackerLogger.warn({ measurementId }, "No active measurement found");
      return null;
    }

    const endTime = getHighResTime();
    const durationMs = endTime - active.startTime;

    const measurement: LatencyMeasurement = {
      phase: active.phase,
      startTime: active.startTime,
      endTime,
      durationMs,
      source: "measured",
      runId: active.runId,
      operationId: active.operationId,
      metadata,
    };

    // Store measurement
    this.storeMeasurement(measurement);

    // Update run breakdown
    if (active.runId) {
      this.updateRunBreakdown(active.runId, measurement);
    }

    // Clean up
    this.activeMeasurements.delete(measurementId);

    trackerLogger.debug({
      measurementId,
      phase: active.phase,
      durationMs: durationMs.toFixed(2),
    }, "Phase measurement completed");

    return measurement;
  }

  /**
   * Measure a function's execution time
   */
  async measureAsync<T>(
    phase: LatencyPhase,
    fn: () => Promise<T>,
    runId?: string,
    operationId?: string
  ): Promise<{ result: T; measurement: LatencyMeasurement }> {
    const measurementId = this.startPhase(phase, runId, operationId);
    
    try {
      const result = await fn();
      const measurement = this.endPhase(measurementId)!;
      return { result, measurement };
    } catch (error) {
      this.endPhase(measurementId, { error: String(error) });
      throw error;
    }
  }

  /**
   * Synchronous measurement
   */
  measureSync<T>(
    phase: LatencyPhase,
    fn: () => T,
    runId?: string,
    operationId?: string
  ): { result: T; measurement: LatencyMeasurement } {
    const measurementId = this.startPhase(phase, runId, operationId);
    
    try {
      const result = fn();
      const measurement = this.endPhase(measurementId)!;
      return { result, measurement };
    } catch (error) {
      this.endPhase(measurementId, { error: String(error) });
      throw error;
    }
  }

  /**
   * Record an external measurement
   */
  recordMeasurement(
    phase: LatencyPhase,
    durationMs: number,
    source: DataSource = "measured",
    runId?: string,
    operationId?: string,
    metadata?: Record<string, unknown>
  ): LatencyMeasurement {
    const now = getHighResTime();
    
    const measurement: LatencyMeasurement = {
      phase,
      startTime: now - durationMs,
      endTime: now,
      durationMs,
      source,
      runId,
      operationId,
      metadata,
    };

    this.storeMeasurement(measurement);

    if (runId) {
      this.updateRunBreakdown(runId, measurement);
    }

    return measurement;
  }

  /**
   * Start tracking a new run
   */
  startRun(runId: string): RunLatencyBreakdown {
    const breakdown: RunLatencyBreakdown = {
      runId,
      startTime: getHighResTime(),
      phases: {} as any,
      totalLatencyMs: 0,
      criticalPathMs: 0,
      isComplete: false,
    };

    this.runBreakdowns.set(runId, breakdown);

    // Trim old runs
    if (this.runBreakdowns.size > this.maxRuns) {
      const oldestKey = this.runBreakdowns.keys().next().value;
      if (oldestKey) this.runBreakdowns.delete(oldestKey);
    }

    trackerLogger.info({ runId }, "Run tracking started");

    return breakdown;
  }

  /**
   * Complete a run
   */
  completeRun(runId: string): RunLatencyBreakdown | undefined {
    const breakdown = this.runBreakdowns.get(runId);
    if (!breakdown) return undefined;

    const endTime = getHighResTime();
    breakdown.endTime = endTime;
    breakdown.totalLatencyMs = endTime - breakdown.startTime;
    breakdown.isComplete = true;

    // Calculate critical path (sum of sequential phases)
    breakdown.criticalPathMs = this.calculateCriticalPath(breakdown);

    trackerLogger.info({
      runId,
      totalLatencyMs: breakdown.totalLatencyMs.toFixed(2),
      criticalPathMs: breakdown.criticalPathMs.toFixed(2),
    }, "Run tracking completed");

    return breakdown;
  }

  /**
   * Get statistics for a phase
   */
  getPhaseStats(phase: LatencyPhase): LatencyStats | null {
    const phaseMeasurements = this.measurements.get(phase);
    if (!phaseMeasurements || phaseMeasurements.length === 0) {
      return null;
    }

    const durations = phaseMeasurements.map(m => m.durationMs).sort((a, b) => a - b);
    const count = durations.length;
    const totalMs = durations.reduce((a, b) => a + b, 0);

    // Calculate percentiles
    const p50Index = Math.floor(count * 0.5);
    const p95Index = Math.floor(count * 0.95);
    const p99Index = Math.floor(count * 0.99);

    // Recent average (last 10)
    const recentDurations = durations.slice(-10);
    const recentAvgMs = recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length;

    // Trend detection
    const avgMs = totalMs / count;
    const trend = recentAvgMs < avgMs * 0.9
      ? "improving"
      : recentAvgMs > avgMs * 1.1
      ? "degrading"
      : "stable";

    return {
      phase,
      count,
      totalMs,
      avgMs,
      minMs: durations[0],
      maxMs: durations[count - 1],
      p50Ms: durations[p50Index] || 0,
      p95Ms: durations[p95Index] || durations[count - 1] || 0,
      p99Ms: durations[p99Index] || durations[count - 1] || 0,
      recentAvgMs,
      trend,
      source: "measured",
      lastUpdated: Date.now(),
    };
  }

  /**
   * Get all phase statistics
   */
  getAllPhaseStats(): Record<LatencyPhase, LatencyStats | null> {
    const result: Record<string, LatencyStats | null> = {};
    
    for (const phase of this.measurements.keys()) {
      result[phase] = this.getPhaseStats(phase);
    }
    
    return result as Record<LatencyPhase, LatencyStats | null>;
  }

  /**
   * Get run breakdown
   */
  getRunBreakdown(runId: string): RunLatencyBreakdown | undefined {
    return this.runBreakdowns.get(runId);
  }

  /**
   * Get recent runs
   */
  getRecentRuns(limit = 10): RunLatencyBreakdown[] {
    return Array.from(this.runBreakdowns.values())
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit);
  }

  /**
   * Get summary metrics
   */
  getSummary(): {
    totalMeasurements: number;
    avgIngestionMs: number;
    avgConsensusMs: number;
    avgExecutionMs: number;
    avgTotalRunMs: number;
    completedRuns: number;
  } {
    const ingestionStats = this.getPhaseStats("ingestion");
    const consensusStats = this.getPhaseStats("consensus");
    const executionStats = this.getPhaseStats("execution");
    
    const completedRuns = Array.from(this.runBreakdowns.values()).filter(r => r.isComplete);
    const avgTotalRunMs = completedRuns.length > 0
      ? completedRuns.reduce((sum, r) => sum + r.totalLatencyMs, 0) / completedRuns.length
      : 0;

    let totalMeasurements = 0;
    for (const measurements of this.measurements.values()) {
      totalMeasurements += measurements.length;
    }

    return {
      totalMeasurements,
      avgIngestionMs: ingestionStats?.avgMs || 0,
      avgConsensusMs: consensusStats?.avgMs || 0,
      avgExecutionMs: executionStats?.avgMs || 0,
      avgTotalRunMs,
      completedRuns: completedRuns.length,
    };
  }

  /**
   * Clear all measurements
   */
  clear(): void {
    this.activeMeasurements.clear();
    for (const measurements of this.measurements.values()) {
      measurements.length = 0;
    }
    this.runBreakdowns.clear();
    trackerLogger.info("All measurements cleared");
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private storeMeasurement(measurement: LatencyMeasurement): void {
    const phaseMeasurements = this.measurements.get(measurement.phase);
    if (!phaseMeasurements) return;

    phaseMeasurements.push(measurement);

    // Trim if needed
    if (phaseMeasurements.length > this.maxMeasurementsPerPhase) {
      phaseMeasurements.splice(0, phaseMeasurements.length - this.maxMeasurementsPerPhase);
    }
  }

  private ensureRunBreakdown(runId: string): void {
    if (!this.runBreakdowns.has(runId)) {
      this.startRun(runId);
    }
  }

  private updateRunBreakdown(runId: string, measurement: LatencyMeasurement): void {
    const breakdown = this.runBreakdowns.get(runId);
    if (!breakdown) return;

    breakdown.phases[measurement.phase] = measurement;
  }

  private calculateCriticalPath(breakdown: RunLatencyBreakdown): number {
    // Sequential phases that form the critical path
    const criticalPhases: LatencyPhase[] = [
      "ingestion",
      "agent_analysis",
      "consensus",
      "planning",
      "simulation",
      "submission",
      "execution",
      "finality",
    ];

    let totalMs = 0;
    for (const phase of criticalPhases) {
      const measurement = breakdown.phases[phase];
      if (measurement) {
        totalMs += measurement.durationMs;
      }
    }

    return totalMs;
  }
}

/**
 * Factory function
 */
export function createLatencyTracker(): LatencyTracker {
  return new LatencyTracker();
}

// Singleton instance
let latencyTracker: LatencyTracker | null = null;

export function getLatencyTracker(): LatencyTracker {
  if (!latencyTracker) {
    latencyTracker = new LatencyTracker();
  }
  return latencyTracker;
}
