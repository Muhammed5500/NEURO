/**
 * Metrics System Tests
 * 
 * Tests for latency tracking and chain comparison:
 * - LatencyTracker measurements
 * - ChainComparisonService calculations
 * - MetricsService integration
 * 
 * Acceptance criteria:
 * - Panel updates live during runs
 * - All numbers cite their input sources
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  LatencyTracker,
  ChainComparisonService,
  MetricsService,
  DEFAULT_REFERENCE_CHAINS,
  DEFAULT_MONAD_CONFIG,
} from "../metrics/index.js";

describe("LatencyTracker", () => {
  let tracker: LatencyTracker;

  beforeEach(() => {
    tracker = new LatencyTracker();
  });

  describe("phase measurements", () => {
    it("should track phase start and end times with millisecond precision", () => {
      // Turkish: "milisaniyelik hassasiyetle ölçecek"
      const measurementId = tracker.startPhase("ingestion", "run-1");
      
      // Simulate some work
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait for ~10ms
      }
      
      const measurement = tracker.endPhase(measurementId);
      
      expect(measurement).not.toBeNull();
      expect(measurement!.phase).toBe("ingestion");
      expect(measurement!.durationMs).toBeGreaterThanOrEqual(9);
      expect(measurement!.source).toBe("measured");
    });

    it("should track multiple phases for a run", () => {
      tracker.startRun("run-1");
      
      // Track multiple phases
      const phases = ["ingestion", "consensus", "execution"] as const;
      
      for (const phase of phases) {
        const id = tracker.startPhase(phase, "run-1");
        tracker.endPhase(id);
      }
      
      const breakdown = tracker.getRunBreakdown("run-1");
      expect(breakdown).not.toBeUndefined();
      expect(breakdown!.phases.ingestion).not.toBeUndefined();
      expect(breakdown!.phases.consensus).not.toBeUndefined();
      expect(breakdown!.phases.execution).not.toBeUndefined();
    });

    it("should calculate run totals", () => {
      tracker.startRun("run-1");
      
      // Track phases with known durations
      tracker.recordMeasurement("ingestion", 100, "measured", "run-1");
      tracker.recordMeasurement("consensus", 200, "measured", "run-1");
      tracker.recordMeasurement("execution", 300, "measured", "run-1");
      
      tracker.completeRun("run-1");
      
      const breakdown = tracker.getRunBreakdown("run-1");
      expect(breakdown!.isComplete).toBe(true);
      expect(breakdown!.criticalPathMs).toBeGreaterThan(0);
    });
  });

  describe("statistics", () => {
    it("should calculate accurate phase statistics", () => {
      // Record multiple measurements
      const durations = [100, 120, 80, 150, 90];
      
      for (const duration of durations) {
        tracker.recordMeasurement("ingestion", duration, "measured");
      }
      
      const stats = tracker.getPhaseStats("ingestion");
      
      expect(stats).not.toBeNull();
      expect(stats!.count).toBe(5);
      expect(stats!.avgMs).toBe(108); // (100+120+80+150+90)/5
      expect(stats!.minMs).toBe(80);
      expect(stats!.maxMs).toBe(150);
    });

    it("should detect trends (improving/stable/degrading)", () => {
      // Record measurements with improving trend (recent values lower)
      for (let i = 0; i < 20; i++) {
        const duration = 200 - i * 5; // 200, 195, 190, ...
        tracker.recordMeasurement("ingestion", duration, "measured");
      }
      
      const stats = tracker.getPhaseStats("ingestion");
      
      expect(stats!.trend).toBe("improving");
    });
  });

  describe("measureAsync", () => {
    it("should measure async function execution", async () => {
      const { result, measurement } = await tracker.measureAsync(
        "consensus",
        async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return "done";
        }
      );
      
      expect(result).toBe("done");
      expect(measurement.phase).toBe("consensus");
      expect(measurement.durationMs).toBeGreaterThanOrEqual(45);
      expect(measurement.source).toBe("measured");
    });
  });
});

describe("ChainComparisonService", () => {
  let service: ChainComparisonService;

  beforeEach(() => {
    service = new ChainComparisonService();
  });

  describe("compareWithChain", () => {
    it("should calculate latency savings vs Ethereum", () => {
      const comparison = service.compareWithChain("ethereum");
      
      expect(comparison).not.toBeNull();
      
      // Monad: 500ms, Ethereum: 30000ms
      expect(comparison!.latencySavedMs.value).toBe(
        DEFAULT_REFERENCE_CHAINS.ethereum.avgTxLatencyMs - DEFAULT_MONAD_CONFIG.avgTxLatencyMs
      );
      expect(comparison!.latencySavedMs.source).toBe("estimated"); // From config
    });

    it("should calculate cost savings in USD", () => {
      // Turkish: "Monad'daki işlem başına tasarrufu 'USD cinsinden' göster"
      const comparison = service.compareWithChain("ethereum");
      
      expect(comparison).not.toBeNull();
      
      // Cost saved = ETH cost - Monad cost
      const expectedSaving = 
        DEFAULT_REFERENCE_CHAINS.ethereum.avgTxCostUsd - DEFAULT_MONAD_CONFIG.avgTxCostUsd;
      
      expect(comparison!.costSavedUsd.value).toBeCloseTo(expectedSaving, 6);
    });

    it("should calculate speed multiplier", () => {
      const comparison = service.compareWithChain("ethereum");
      
      // Ethereum: 30000ms, Monad: 500ms = 60x faster
      expect(comparison!.speedMultiplier.value).toBe(60);
    });

    it("should include source labels for all values", () => {
      // Turkish: "Her rakamın yanında [measured] veya [config-ref] etiketi olsun"
      const comparison = service.compareWithChain("ethereum");
      
      expect(comparison!.latencySavedMs.source).toBeDefined();
      expect(comparison!.costSavedUsd.source).toBeDefined();
      expect(comparison!.speedMultiplier.source).toBeDefined();
      expect(comparison!.finalitySavedMs.source).toBeDefined();
    });
  });

  describe("compareWithAllChains", () => {
    it("should compare with all reference chains", () => {
      const comparisons = service.compareWithAllChains();
      
      expect(comparisons.comparisons.ethereum).toBeDefined();
      expect(comparisons.comparisons.solana).toBeDefined();
      expect(comparisons.comparisons.arbitrum).toBeDefined();
      expect(comparisons.comparisons.polygon).toBeDefined();
    });

    it("should identify best savings", () => {
      const comparisons = service.compareWithAllChains();
      
      // Ethereum should have best savings due to high fees
      expect(comparisons.bestCostSaving.chain).toBe("ethereum");
      expect(comparisons.bestLatencySaving.chain).toBe("ethereum");
    });
  });

  describe("updateMeasuredMetrics", () => {
    it("should update comparison to use measured values", () => {
      // Start with config values
      let comparison = service.compareWithChain("ethereum");
      expect(comparison!.latencySavedMs.source).toBe("estimated");
      
      // Update with measured values
      service.updateMeasuredMetrics(450, 0.00008);
      
      comparison = service.compareWithChain("ethereum");
      expect(comparison!.latencySavedMs.source).toBe("measured");
      
      // Savings should be recalculated
      expect(comparison!.latencySavedMs.value).toBe(30000 - 450);
    });
  });

  describe("getGaugeData", () => {
    it("should return gauge data with Monad in 'Ultra Fast' zone", () => {
      // Turkish: "Monad'ın iğnesi her zaman 'Ultra Fast' bölgesinde kalsın"
      const gaugeData = service.getGaugeData();
      
      expect(gaugeData.zone).toBe("ultra_fast");
      expect(gaugeData.zoneLabel).toBe("ULTRA FAST");
      expect(gaugeData.currentLatencyMs.value).toBe(500);
    });

    it("should calculate speed multipliers vs reference chains", () => {
      const gaugeData = service.getGaugeData();
      
      expect(gaugeData.vsEthereum.value).toBe(60); // 30000 / 500
      expect(gaugeData.vsSolana.value).toBe(4);    // 2000 / 500
    });
  });
});

describe("MetricsService", () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  describe("run tracking", () => {
    it("should track complete runs with all phases", () => {
      service.startRun("run-1");
      
      // Track phases
      service.recordMeasurement("ingestion", 100);
      service.recordMeasurement("consensus", 200);
      service.recordMeasurement("execution", 300);
      
      service.completeRun("run-1");
      
      const data = service.getDashboardData();
      expect(data.currentRun).toBeUndefined(); // Completed, no longer current
    });

    it("should update chain comparison with measured execution latency", () => {
      service.startRun("run-1");
      service.recordMeasurement("execution", 450);
      service.completeRun("run-1");
      
      const data = service.getDashboardData();
      
      // Should now use measured latency
      expect(data.gaugeData.currentLatencyMs.value).toBe(450);
    });
  });

  describe("event emission", () => {
    it("should emit dashboard updates on measurements", () => {
      const handler = vi.fn();
      service.on("dashboard:update", handler);
      
      service.recordMeasurement("ingestion", 100);
      
      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0]).toHaveProperty("summary");
    });

    it("should emit phase complete events", () => {
      const handler = vi.fn();
      service.on("phase:complete", handler);
      
      const id = service.startPhase("ingestion");
      service.endPhase(id);
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "ingestion",
          source: "measured",
        })
      );
    });
  });

  describe("getDashboardData", () => {
    it("should return complete dashboard data with source labels", () => {
      // Acceptance criteria: "All numbers cite their input sources"
      service.recordMeasurement("ingestion", 100);
      service.recordMeasurement("consensus", 200);
      
      const data = service.getDashboardData();
      
      // Check summary has sourced values
      expect(data.summary.avgIngestionMs.source).toBeDefined();
      expect(data.summary.avgConsensusMs.source).toBeDefined();
      expect(data.summary.estimatedUsdSaved.source).toBeDefined();
      
      // Check chain comparisons have sources
      expect(data.chainComparisons.comparisons.ethereum.costSavedUsd.source).toBeDefined();
      
      // Check gauge data has sources
      expect(data.gaugeData.currentLatencyMs.source).toBeDefined();
      expect(data.gaugeData.vsEthereum.source).toBeDefined();
    });

    it("should indicate measured vs config-ref sources correctly", () => {
      // Without any measurements
      let data = service.getDashboardData();
      expect(data.summary.avgIngestionMs.source).toBe("config-ref");
      
      // After measurements
      service.recordMeasurement("ingestion", 100);
      data = service.getDashboardData();
      expect(data.summary.avgIngestionMs.source).toBe("measured");
    });
  });

  describe("live updates", () => {
    it("should emit updates at configured interval", async () => {
      // Acceptance criteria: "Panel updates live during runs"
      const handler = vi.fn();
      service.on("dashboard:update", handler);
      
      service.startLiveUpdates();
      
      // Wait for at least one interval
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      service.stopLiveUpdates();
      
      expect(handler).toHaveBeenCalled();
    });
  });
});

describe("Source Labeling (Acceptance Criteria)", () => {
  it("all metrics should have source annotations", () => {
    // Turkish: "Her rakamın yanında [measured] veya [config-ref] etiketi olsun"
    const service = new MetricsService();
    const data = service.getDashboardData();
    
    // Summary
    expect(data.summary.avgIngestionMs).toHaveProperty("source");
    expect(data.summary.avgConsensusMs).toHaveProperty("source");
    expect(data.summary.avgExecutionMs).toHaveProperty("source");
    expect(data.summary.avgTotalMs).toHaveProperty("source");
    expect(data.summary.estimatedUsdSaved).toHaveProperty("source");
    
    // Gauge
    expect(data.gaugeData.currentLatencyMs).toHaveProperty("source");
    expect(data.gaugeData.vsEthereum).toHaveProperty("source");
    expect(data.gaugeData.vsSolana).toHaveProperty("source");
    
    // Chain comparisons
    for (const [chain, comparison] of Object.entries(data.chainComparisons.comparisons)) {
      expect(comparison.latencySavedMs).toHaveProperty("source");
      expect(comparison.costSavedUsd).toHaveProperty("source");
      expect(comparison.speedMultiplier).toHaveProperty("source");
    }
  });
});

describe("Reference Chain Configuration", () => {
  it("should include all expected reference chains", () => {
    expect(DEFAULT_REFERENCE_CHAINS).toHaveProperty("ethereum");
    expect(DEFAULT_REFERENCE_CHAINS).toHaveProperty("solana");
    expect(DEFAULT_REFERENCE_CHAINS).toHaveProperty("arbitrum");
    expect(DEFAULT_REFERENCE_CHAINS).toHaveProperty("polygon");
    expect(DEFAULT_REFERENCE_CHAINS).toHaveProperty("optimism");
    expect(DEFAULT_REFERENCE_CHAINS).toHaveProperty("base");
  });

  it("should have realistic default values for Ethereum", () => {
    const eth = DEFAULT_REFERENCE_CHAINS.ethereum;
    
    expect(eth.avgBlockTimeMs).toBe(12000);      // 12 seconds
    expect(eth.avgTxLatencyMs).toBe(30000);      // 30 seconds
    expect(eth.nativeTokenSymbol).toBe("ETH");
    expect(eth.source).toBe("config-ref");
  });

  it("should have realistic default values for Monad", () => {
    expect(DEFAULT_MONAD_CONFIG.avgBlockTimeMs).toBe(400);  // 400ms
    expect(DEFAULT_MONAD_CONFIG.avgFinalityMs).toBe(800);   // 800ms
    expect(DEFAULT_MONAD_CONFIG.avgTxLatencyMs).toBe(500);  // 500ms
    expect(DEFAULT_MONAD_CONFIG.chainId).toBe(143);
    expect(DEFAULT_MONAD_CONFIG.nativeTokenSymbol).toBe("MON");
  });
});
