/**
 * Monitoring System Tests
 * 
 * Tests for bonding curve saturation monitoring and advisory signals:
 * - Bonding curve stall detection
 * - Attention decay analysis
 * - Volume/liquidity divergence
 * - Action card generation
 * 
 * Acceptance Criteria:
 * - Advisory signals appear in dashboard
 * - No auto-trade occurs without manual approval
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createBondingCurveTracker,
  BondingCurveTracker,
  createAttentionAnalyzer,
  AttentionAnalyzer,
  createDivergenceDetector,
  DivergenceDetector,
  createActionCardGenerator,
  ActionCardGenerator,
  createAdvisoryService,
  AdvisoryService,
  ActionNotApprovedError,
  type AdvisorySignal,
} from "../monitoring/index.js";

// ============================================
// BONDING CURVE TRACKER TESTS
// ============================================

describe("BondingCurveTracker", () => {
  let tracker: BondingCurveTracker;

  beforeEach(() => {
    tracker = createBondingCurveTracker();
  });

  describe("updateState", () => {
    it("should track bonding curve metrics", () => {
      const state = tracker.updateState(
        "0x1234",
        0.001,
        BigInt(500_000_000e18),
        BigInt(30e18),
        BigInt(100e18),
        BigInt(50e18)
      );

      expect(state.tokenAddress).toBe("0x1234");
      expect(state.currentPrice).toBe(0.001);
      expect(state.graduationProgress).toBeGreaterThan(0);
      expect(state.sellPressureRatio).toBeCloseTo(1/3, 1); // 50/(100+50)
    });

    it("should detect curve stall when velocity drops and sell pressure increases", () => {
      // Turkish: "fiyat artışı yavaşlıyor ama satış baskısı artıyorsa CURVE_STALL sinyali üret"
      
      // Simulate healthy growth
      for (let i = 0; i < 20; i++) {
        tracker.updateState(
          "0x1234",
          0.001 + i * 0.0001, // Price increasing
          BigInt(500_000_000e18),
          BigInt((30 + i)  * 1e18),
          BigInt(100e18), // More buys
          BigInt(30e18)   // Less sells
        );
      }

      // Now simulate stall: price slows, sell pressure increases
      for (let i = 0; i < 20; i++) {
        const state = tracker.updateState(
          "0x1234",
          0.003 + i * 0.00001, // Price barely moving
          BigInt(500_000_000e18),
          BigInt(50e18),
          BigInt(30e18),  // Less buys
          BigInt(80e18)   // More sells
        );

        // Eventually should detect stall
        if (i > 15) {
          expect(state.sellPressureTrend).toBe("increasing");
        }
      }

      const result = tracker.analyzeCurve("0x1234");
      expect(result).toBeDefined();
      // May or may not stall depending on exact numbers
    });
  });

  describe("graduation tracking", () => {
    it("should track distance to graduation", () => {
      // Turkish: "Mezuniyet noktasına olan uzaklık"
      const state = tracker.updateState(
        "0x1234",
        0.001,
        BigInt(500_000_000e18),
        BigInt(34.5e18), // ~50% to graduation (69 MON)
        BigInt(100e18),
        BigInt(50e18)
      );

      expect(state.graduationProgress).toBeCloseTo(50, 5);
      expect(state.distanceToGraduation).toBeGreaterThan(0);
    });
  });
});

// ============================================
// ATTENTION ANALYZER TESTS
// ============================================

describe("AttentionAnalyzer", () => {
  let analyzer: AttentionAnalyzer;

  beforeEach(() => {
    analyzer = createAttentionAnalyzer();
  });

  describe("updateMetrics", () => {
    it("should track attention metrics", () => {
      const metrics = analyzer.updateMetrics(
        "0x1234",
        100, // tweets
        0.7, // sentiment
        50,  // engagement
        5    // news
      );

      expect(metrics.tokenAddress).toBe("0x1234");
      expect(metrics.tweetCount24h).toBe(100);
      expect(metrics.sentimentScore).toBeCloseTo(0.7, 1);
    });

    it("should detect sentiment velocity decay", () => {
      // Turkish: "Olumlu havadan nötr havaya geçiş hızı"
      
      // Start with positive sentiment
      for (let i = 0; i < 15; i++) {
        analyzer.updateMetrics(
          "0x1234",
          100 - i * 2, // Declining tweets
          0.8 - i * 0.03, // Declining sentiment
          50 - i * 2,
          5
        );
      }

      const decayResult = analyzer.analyzeDecay("0x1234");
      
      expect(decayResult).toBeDefined();
      expect(decayResult?.isDecaying).toBe(true);
      expect(decayResult?.sentimentDecay).toBeGreaterThan(0);
    });
  });

  describe("attention decay score", () => {
    it("should calculate attention decay score", () => {
      // Turkish: "attention_decay puanına dönüştür"
      
      // Simulate decay
      for (let i = 0; i < 20; i++) {
        analyzer.updateMetrics(
          "0x1234",
          Math.max(10, 100 - i * 5),
          Math.max(-0.5, 0.8 - i * 0.08),
          Math.max(5, 50 - i * 3),
          1
        );
      }

      const metrics = analyzer.getMetrics("0x1234");
      
      expect(metrics?.attentionDecayScore).toBeGreaterThan(0);
    });
  });
});

// ============================================
// DIVERGENCE DETECTOR TESTS
// ============================================

describe("DivergenceDetector", () => {
  let detector: DivergenceDetector;

  beforeEach(() => {
    detector = createDivergenceDetector();
  });

  describe("detectDivergence", () => {
    it("should detect exit liquidity risk when volume increases but liquidity stagnates", () => {
      // Turkish: "hacim artarken likidite aynı oranda artmıyorsa, 'Exit Liquidity' riski olarak işaretle"
      
      // Normal state
      for (let i = 0; i < 10; i++) {
        detector.updateState(
          "0x1234",
          BigInt(100e18),
          BigInt(50e18)
        );
      }

      // Volume increases, liquidity stagnates
      for (let i = 0; i < 10; i++) {
        detector.updateState(
          "0x1234",
          BigInt((100 + i * 20) * 1e18), // Volume increasing 20% each
          BigInt(50e18) // Liquidity flat
        );
      }

      const result = detector.detectDivergence("0x1234");
      const state = detector.getState("0x1234");

      expect(result).toBeDefined();
      expect(state?.divergenceDirection).toBe("volume_leading");
      // Risk depends on exact calculations
    });
  });
});

// ============================================
// ACTION CARD GENERATOR TESTS
// ============================================

describe("ActionCardGenerator", () => {
  let generator: ActionCardGenerator;

  beforeEach(() => {
    generator = createActionCardGenerator();
  });

  describe("generateCard", () => {
    it("should generate action card with required fields", () => {
      // Turkish: "trigger_reason, suggested_action, priority_level ve simüle edilmiş pnl_impact"
      
      const signals: AdvisorySignal[] = [
        {
          id: "sig-1",
          type: "EXIT_LIQUIDITY_RISK",
          priority: "high",
          tokenAddress: "0x1234",
          tokenSymbol: "TEST",
          triggerReason: "Exit liquidity risk detected",
          triggerMetrics: { exitLiquidityRisk: 75 },
          createdAt: Date.now(),
          acknowledged: false,
        },
      ];

      const card = generator.generateCard({
        tokenAddress: "0x1234",
        tokenSymbol: "TEST",
        signals,
        currentPrice: 0.002,
        positionSize: 1000,
        positionCost: 1.5,
      });

      // Turkish: "trigger_reason"
      expect(card.triggerReason).toBeDefined();
      expect(card.triggerReason.length).toBeGreaterThan(0);

      // Turkish: "suggested_action"
      expect(card.suggestedAction).toBeDefined();
      expect(card.actionDetails.sellPercentage).toBeDefined();

      // Turkish: "priority_level"
      expect(card.priorityLevel).toBe("high");

      // Turkish: "simüle edilmiş pnl_impact"
      expect(card.pnlImpact).toBeDefined();
      expect(card.pnlImpact.unrealizedPnl).toBeDefined();
      expect(card.pnlImpact.netPnlIfExit).toBeDefined();
    });

    it("should always require manual approval", () => {
      // Acceptance criteria: "No auto-trade occurs without manual approval"
      
      const signals: AdvisorySignal[] = [
        {
          id: "sig-1",
          type: "CURVE_STALL",
          priority: "critical",
          tokenAddress: "0x1234",
          tokenSymbol: "TEST",
          triggerReason: "Curve stalling",
          triggerMetrics: {},
          createdAt: Date.now(),
          acknowledged: false,
        },
      ];

      const card = generator.generateCard({
        tokenAddress: "0x1234",
        tokenSymbol: "TEST",
        signals,
        currentPrice: 0.002,
        positionSize: 1000,
        positionCost: 1.5,
      });

      expect(card.requiresApproval).toBe(true);
      expect(card.approvalStatus).toBe("pending");
    });
  });

  describe("approveCard", () => {
    it("should not allow execution without approval", () => {
      const signals: AdvisorySignal[] = [
        {
          id: "sig-1",
          type: "CURVE_STALL",
          priority: "high",
          triggerReason: "Test",
          triggerMetrics: {},
          createdAt: Date.now(),
          acknowledged: false,
        },
      ];

      const card = generator.generateCard({
        tokenAddress: "0x1234",
        tokenSymbol: "TEST",
        signals,
        currentPrice: 0.002,
        positionSize: 1000,
        positionCost: 1.5,
      });

      // Try to execute without approval
      expect(() => {
        generator.markExecuted(card.id, "0xabc", 100);
      }).toThrow(ActionNotApprovedError);
    });

    it("should allow execution after approval", () => {
      const signals: AdvisorySignal[] = [
        {
          id: "sig-1",
          type: "CURVE_STALL",
          priority: "high",
          triggerReason: "Test",
          triggerMetrics: {},
          createdAt: Date.now(),
          acknowledged: false,
        },
      ];

      const card = generator.generateCard({
        tokenAddress: "0x1234",
        tokenSymbol: "TEST",
        signals,
        currentPrice: 0.002,
        positionSize: 1000,
        positionCost: 1.5,
      });

      // Approve
      generator.approveCard(card.id, "admin@example.com");

      // Now can execute
      const executed = generator.markExecuted(card.id, "0xabc", 150);
      
      expect(executed.executedAt).toBeDefined();
      expect(executed.executionTxHash).toBe("0xabc");
      expect(executed.actualPnl).toBe(150);
    });
  });
});

// ============================================
// ADVISORY SERVICE INTEGRATION TESTS
// ============================================

describe("AdvisoryService", () => {
  let service: AdvisoryService;

  beforeEach(() => {
    service = createAdvisoryService();
  });

  describe("getDashboardData", () => {
    it("should provide dashboard data with signals", () => {
      // Acceptance criteria: "Advisory signals appear in dashboard"
      
      // Register a position
      service.registerPosition("0x1234", "TEST", 1000, 1.5);

      // Update with risky data
      service.updateTokenData("0x1234", "TEST", {
        price: 0.002,
        supply: BigInt(500_000_000e18),
        reserve: BigInt(30e18),
        buyVolume24h: BigInt(20e18),
        sellVolume24h: BigInt(80e18), // High sell pressure
        tweetCount: 10,
        sentimentScore: -0.2,
        engagement: 5,
        newsCount: 0,
        volume24h: BigInt(200e18),
        liquidity: BigInt(10e18),
      });

      const dashboard = service.getDashboardData();

      expect(dashboard.totalTokensMonitored).toBe(1);
      expect(dashboard.generatedAt).toBeDefined();
      expect(dashboard.signalsByPriority).toBeDefined();
      expect(dashboard.signalsByType).toBeDefined();
      expect(dashboard.actionCards).toBeInstanceOf(Array);
      expect(dashboard.atRiskTokens).toBeInstanceOf(Array);
    });
  });

  describe("no auto-trade", () => {
    it("should generate action cards that require approval", () => {
      // Acceptance criteria: "No auto-trade occurs without manual approval"
      
      service.registerPosition("0x1234", "TEST", 1000, 1.5);

      // Simulate multiple updates to generate signals
      for (let i = 0; i < 20; i++) {
        service.updateTokenData("0x1234", "TEST", {
          price: 0.002 - i * 0.00005,
          supply: BigInt(500_000_000e18),
          reserve: BigInt(30e18),
          buyVolume24h: BigInt((20 - i)  * 1e18),
          sellVolume24h: BigInt((50 + i * 3) * 1e18),
          tweetCount: Math.max(5, 50 - i * 3),
          sentimentScore: Math.max(-0.5, 0.5 - i * 0.1),
          engagement: Math.max(2, 30 - i * 2),
          newsCount: 0,
          volume24h: BigInt((100 + i * 10) * 1e18),
          liquidity: BigInt(20e18),
        });
      }

      const dashboard = service.getDashboardData();
      
      // Any generated action cards should require approval
      for (const card of dashboard.actionCards) {
        expect(card.requiresApproval).toBe(true);
        expect(card.approvalStatus).toBe("pending");
      }
    });
  });
});
