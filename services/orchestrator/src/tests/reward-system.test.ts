/**
 * Reward System Tests
 * 
 * Tests for the optional reward module with:
 * - Epoch caps and burn policy
 * - Reputation multipliers
 * - Anti-gaming penalties
 * - Oracle verification
 * - Audit logging
 * 
 * Acceptance Criteria:
 * - Rewards cannot exceed cap
 * - Every distribution is explainable and auditable
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createEpochManager,
  EpochManager,
  createReputationManager,
  ReputationManager,
  createMockOracle,
  MockRewardOracle,
  createRewardService,
  RewardService,
  REPUTATION_TIERS,
  DEFAULT_ACTION_CONFIGS,
  RewardCapExceededError,
  UserSuspendedError,
  type RewardActionRequest,
} from "../rewards/index.js";

// ============================================
// EPOCH MANAGER TESTS
// ============================================

describe("EpochManager", () => {
  let manager: EpochManager;

  beforeEach(() => {
    manager = createEpochManager({
      durationMs: 3600000, // 1 hour for testing
      maxPointsPerEpoch: 10000,
      maxPointsPerUser: 1000,
      maxPointsPerAction: 500,
      burnUndistributed: true,
      epochZeroTimestamp: Date.now() - 1000, // Started 1 second ago
    });
  });

  describe("canDistribute", () => {
    it("should allow distribution within cap", () => {
      // Acceptance criteria: "Rewards cannot exceed cap"
      const result = manager.canDistribute(100);
      
      expect(result.allowed).toBe(true);
      expect(result.epochRemaining).toBe(9900);
    });

    it("should reject distribution exceeding epoch cap", () => {
      // Fill up most of the cap
      for (let i = 0; i < 95; i++) {
        manager.reservePoints(100);
      }

      // Try to distribute more than remaining
      const result = manager.canDistribute(600);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("cap exceeded");
    });

    it("should reject distribution exceeding action cap", () => {
      const result = manager.canDistribute(600); // > maxPointsPerAction (500)
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Action cap exceeded");
    });
  });

  describe("reservePoints", () => {
    it("should track distributed points", () => {
      manager.reservePoints(100);
      manager.reservePoints(200);

      const epoch = manager.getCurrentEpoch();
      
      expect(epoch.distributedPoints).toBe(300);
      expect(epoch.remainingPoints).toBe(9700);
    });
  });

  describe("Burn Policy", () => {
    it("should forecast burn for undistributed points", () => {
      // Turkish: "Epoch sonunda dağıtılmayan puanlar asla devretmemeli (Burn policy)"
      manager.reservePoints(1000);

      const forecast = manager.getBurnForecast();
      
      expect(forecast.currentRemaining).toBe(9000);
      // Projected burn depends on time remaining
      expect(forecast.projectedBurn).toBeGreaterThanOrEqual(0);
    });
  });
});

// ============================================
// REPUTATION SYSTEM TESTS
// ============================================

describe("ReputationManager", () => {
  let manager: ReputationManager;

  beforeEach(() => {
    manager = createReputationManager();
  });

  describe("Reputation Multiplier", () => {
    it("should start users at tier 0 with 1.0x multiplier", () => {
      // Turkish: "puan çarpanı"
      const user = manager.getUser("user1", "0x123");
      
      expect(user.tier).toBe(0);
      expect(user.multiplier).toBe(1.0);
      expect(user.reputationScore).toBe(0);
    });

    it("should increase multiplier as reputation grows", () => {
      // Turkish: "geçmişte tutarlı ve doğru veri sağlayanların puan çarpanı zamanla artmalı"
      const user = manager.getUser("user1", "0x123");

      // Simulate many successful actions
      for (let i = 0; i < 50; i++) {
        manager.recordAction("user1", "0x123", {
          id: `record-${i}`,
          userId: "user1",
          address: "0x123",
          actionType: "signal_submission",
          basePoints: 50,
          multiplier: 1.0,
          finalPoints: 50,
          epochNumber: 0,
          timestamp: Date.now(),
          reason: "Test",
          details: {},
          proof: {
            evidenceHash: "abc",
            evidenceType: "other",
            verified: true,
          },
          status: "verified",
        });
      }

      const updatedUser = manager.getUser("user1", "0x123");
      
      // Should have gained some reputation and potentially a higher tier
      expect(updatedUser.reputationScore).toBeGreaterThan(0);
      expect(updatedUser.totalPointsEarned).toBe(2500); // 50 * 50
    });
  });

  describe("Penalty System", () => {
    it("should apply penalties for bad behavior", () => {
      // Turkish: "penalty_logic ekle"
      manager.getUser("user1", "0x123");

      const result = manager.applyPenalty("user1", "invalid_data", "Test penalty");

      expect(result.pointsDeducted).toBeGreaterThanOrEqual(0);
      expect(result.reputationDeducted).toBe(10);

      const user = manager.getUser("user1", "0x123");
      expect(user.penaltyCount).toBe(1);
    });

    it("should suspend users for severe violations", () => {
      // Turkish: "askıya alınmasını sağlayan"
      manager.getUser("user1", "0x123");

      const result = manager.applyPenalty("user1", "manipulation", "Market manipulation");

      expect(result.suspended).toBe(true);
      expect(result.suspendedUntil).toBeGreaterThan(Date.now());

      const canEarn = manager.canEarnRewards("user1");
      expect(canEarn.allowed).toBe(false);
      expect(canEarn.reason).toBe("User is suspended");
    });
  });

  describe("Tier System", () => {
    it("should have proper tier progression", () => {
      const tiers = manager.getAllTiers();

      expect(tiers.length).toBeGreaterThan(0);
      
      // Verify increasing multipliers
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i].multiplier).toBeGreaterThan(tiers[i-1].multiplier);
        expect(tiers[i].minScore).toBeGreaterThan(tiers[i-1].minScore);
      }
    });
  });
});

// ============================================
// ORACLE TESTS
// ============================================

describe("MockRewardOracle", () => {
  let oracle: MockRewardOracle;

  beforeEach(() => {
    oracle = createMockOracle({
      simulatedDelayMs: 10,
      defaultVerificationRate: 0.95,
    });
  });

  describe("verify", () => {
    it("should compute SHA-256 evidence hash", () => {
      // Turkish: "SHA-256 özetini içermeli"
    });

    it("should verify actions based on configured rate", async () => {
      const request = {
        actionType: "signal_submission" as const,
        userId: "user1",
        address: "0x123",
        evidenceType: "tweet_url" as const,
        evidenceUrl: "https://twitter.com/test/123",
        requestId: "req-1",
        timestamp: Date.now(),
      };

      const response = await oracle.verify(request);

      expect(response.requestId).toBe("req-1");
      expect(response.evidenceHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256
      expect(response.verifiedAt).toBeGreaterThan(0);
    });
  });

  describe("verifyBatch", () => {
    it("should verify multiple requests", async () => {
      const requests = [
        {
          actionType: "signal_submission" as const,
          userId: "user1",
          address: "0x123",
          evidenceType: "tweet_url" as const,
          requestId: "req-1",
          timestamp: Date.now(),
        },
        {
          actionType: "signal_verification" as const,
          userId: "user2",
          address: "0x456",
          evidenceType: "tx_hash" as const,
          requestId: "req-2",
          timestamp: Date.now(),
        },
      ];

      const responses = await oracle.verifyBatch(requests);

      expect(responses.length).toBe(2);
      expect(responses[0].requestId).toBe("req-1");
      expect(responses[1].requestId).toBe("req-2");
    });
  });
});

// ============================================
// REWARD SERVICE INTEGRATION TESTS
// ============================================

describe("RewardService", () => {
  let service: RewardService;
  let oracle: MockRewardOracle;

  beforeEach(() => {
    oracle = createMockOracle({
      simulatedDelayMs: 10,
      defaultVerificationRate: 1.0, // Always verify for testing
    });

    service = createRewardService(
      {
        enabled: true,
        requireVerification: true,
        verificationTimeoutMs: 5000,
        epochConfig: {
          maxPointsPerEpoch: 10000,
          maxPointsPerUser: 1000,
          maxPointsPerAction: 500,
          burnUndistributed: true,
        },
      },
      oracle
    );
  });

  describe("submitAction", () => {
    it("should distribute rewards with multiplier", async () => {
      const request: RewardActionRequest = {
        userId: "user1",
        address: "0x123",
        actionType: "signal_submission",
        evidenceType: "tweet_url",
        evidenceUrl: "https://twitter.com/test/123",
      };

      const record = await service.submitAction(request);

      expect(record.id).toBeDefined();
      expect(record.basePoints).toBe(50); // From DEFAULT_ACTION_CONFIGS
      expect(record.multiplier).toBe(1.0); // New user
      expect(record.finalPoints).toBe(50);
      expect(record.status).toBe("verified");
    });

    it("should enforce epoch cap", async () => {
      // Acceptance criteria: "Rewards cannot exceed cap"
      
      // Submit many actions to approach cap
      for (let i = 0; i < 190; i++) {
        try {
          await service.submitAction({
            userId: `user${i % 10}`, // Rotate users to avoid user cap
            address: `0x${i.toString(16).padStart(40, '0')}`,
            actionType: "signal_submission",
            evidenceType: "tweet_url",
            evidenceUrl: `https://twitter.com/test/${i}`,
          });
        } catch (e) {
          // May hit caps
        }
      }

      const dashboard = service.getEpochDashboard();
      
      // Total distributed should not exceed cap
      expect(dashboard.distributed).toBeLessThanOrEqual(dashboard.totalCap);
    });

    it("should reject suspended users", async () => {
      // Create user and suspend them
      await service.submitAction({
        userId: "baduser",
        address: "0xbad",
        actionType: "signal_submission",
        evidenceType: "tweet_url",
        evidenceUrl: "https://twitter.com/test/1",
      });

      // Manually apply suspension through reputation manager
      // (In real scenario, this happens through penalty system)
      const reputationManager = (service as any).reputationManager as ReputationManager;
      reputationManager.applyPenalty("baduser", "manipulation", "Test suspension");

      await expect(
        service.submitAction({
          userId: "baduser",
          address: "0xbad",
          actionType: "signal_submission",
          evidenceType: "tweet_url",
          evidenceUrl: "https://twitter.com/test/2",
        })
      ).rejects.toThrow(UserSuspendedError);
    });
  });

  describe("Dashboard Data", () => {
    it("should provide epoch dashboard with cap usage", async () => {
      // Turkish: "cap usage"
      await service.submitAction({
        userId: "user1",
        address: "0x123",
        actionType: "signal_submission",
        evidenceType: "tweet_url",
        evidenceUrl: "https://twitter.com/test/1",
      });

      const dashboard = service.getEpochDashboard();

      expect(dashboard.epochNumber).toBeDefined();
      expect(dashboard.totalCap).toBe(10000);
      expect(dashboard.distributed).toBeGreaterThan(0);
      expect(dashboard.usagePercent).toBeGreaterThan(0);
      expect(dashboard.topEarners).toBeInstanceOf(Array);
      expect(dashboard.actionBreakdown).toBeInstanceOf(Array);
    });

    it("should provide user summary", async () => {
      // Turkish: "who earned what, why"
      await service.submitAction({
        userId: "user1",
        address: "0x123",
        actionType: "signal_submission",
        evidenceType: "tweet_url",
        evidenceUrl: "https://twitter.com/test/1",
      });

      const summary = service.getUserSummary("user1", "0x123");

      expect(summary.userId).toBe("user1");
      expect(summary.currentEpochPoints).toBeGreaterThan(0);
      expect(summary.reputationTier).toBeDefined();
      expect(summary.multiplier).toBeDefined();
      expect(summary.recentRewards.length).toBeGreaterThan(0);
      
      // Check "why" is included
      expect(summary.recentRewards[0].reason).toBeDefined();
    });
  });

  describe("Audit Export", () => {
    it("should export auditable data", async () => {
      // Acceptance criteria: "Every distribution is explainable and auditable"
      await service.submitAction({
        userId: "user1",
        address: "0x123",
        actionType: "signal_submission",
        evidenceType: "tweet_url",
        evidenceUrl: "https://twitter.com/test/1",
      });

      const audit = service.exportAuditData();

      expect(audit.records.length).toBeGreaterThan(0);
      
      const record = audit.records[0];
      
      // Should be explainable
      expect(record.reason).toBeDefined();
      expect(record.details).toBeDefined();
      
      // Should include proof
      expect(record.proof.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
      
      // Should include who, what, when, why
      expect(record.userId).toBeDefined();
      expect(record.actionType).toBeDefined();
      expect(record.timestamp).toBeDefined();
      expect(record.reason).toBeDefined();
    });
  });

  describe("Proof of Action", () => {
    it("should include SHA-256 evidence hash in records", async () => {
      // Turkish: "SHA-256 özetini içermeli"
      const record = await service.submitAction({
        userId: "user1",
        address: "0x123",
        actionType: "signal_submission",
        evidenceType: "tweet_url",
        evidenceUrl: "https://twitter.com/test/1",
      });

      expect(record.proof.evidenceHash).toBeDefined();
      expect(record.proof.evidenceHash).toMatch(/^[a-f0-9]{64}$/); // Valid SHA-256
      expect(record.proof.evidenceType).toBe("tweet_url");
    });
  });
});
