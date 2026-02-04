/**
 * Session Key Framework Tests
 * 
 * Tests for session key management with:
 * - Budget caps
 * - Expiry timestamps
 * - Velocity limits
 * - Target address allowlist
 * - Kill switch
 * 
 * Acceptance Criteria:
 * - Unit tests show session cannot exceed budget or time window
 * - Kill switch disables all execution paths
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createSessionManager,
  SessionManager,
  createKillSwitch,
  KillSwitch,
  createVelocityTracker,
  VelocityTracker,
  createEncryptedStorage,
  EncryptedSessionStorage,
  DEFAULT_TARGET_ALLOWLIST,
  KillSwitchError,
  SessionError,
  AllowlistError,
} from "../session/index.js";

// ============================================
// SESSION MANAGER TESTS
// ============================================

describe("SessionManager", () => {
  let sessionManager: SessionManager;
  let killSwitch: KillSwitch;

  beforeEach(() => {
    killSwitch = createKillSwitch();
    sessionManager = createSessionManager({
      killSwitch,
      strictAllowlist: true,
    });
  });

  afterEach(() => {
    sessionManager.shutdown();
  });

  describe("createSession", () => {
    it("should create a session with budget and expiry", async () => {
      const session = await sessionManager.createSession({
        totalBudgetMon: 1.0,
        velocityLimitMonPerMinute: 0.5,
        expiryDurationMs: 3600000, // 1 hour
      });

      expect(session.sessionId).toBeDefined();
      expect(session.totalBudgetMon).toBe(1.0);
      expect(session.velocityLimitMonPerMinute).toBe(0.5);
      expect(session.expiresAt).toBeGreaterThan(Date.now());
      expect(session.isActive).toBe(true);
    });

    it("should include default allowlist addresses", async () => {
      const session = await sessionManager.createSession({
        totalBudgetMon: 1.0,
        velocityLimitMonPerMinute: 0.5,
        expiryDurationMs: 3600000,
      });

      // Should include default allowlist
      expect(session.allowedTargetAddresses.length).toBeGreaterThan(0);
    });

    it("should reject non-allowlisted addresses in strict mode", async () => {
      await expect(
        sessionManager.createSession({
          totalBudgetMon: 1.0,
          velocityLimitMonPerMinute: 0.5,
          expiryDurationMs: 3600000,
          additionalTargetAddresses: ["0xSCAM_CONTRACT_NOT_IN_ALLOWLIST"],
        })
      ).rejects.toThrow(AllowlistError);
    });
  });

  describe("validateSession - Budget", () => {
    it("should reject when budget exceeded", async () => {
      // Acceptance criteria: "session cannot exceed budget"
      const session = await sessionManager.createSession({
        totalBudgetMon: 0.1, // Small budget
        velocityLimitMonPerMinute: 1.0,
        expiryDurationMs: 3600000,
      });

      // Try to spend more than budget
      const result = sessionManager.validateSession(
        session.sessionId,
        Object.values(DEFAULT_TARGET_ALLOWLIST)[0],
        "0x095ea7b3",
        "200000000000000000", // 0.2 MON > 0.1 budget
        0.2,
        0
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe("BUDGET_EXCEEDED");
    });

    it("should allow spending within budget", async () => {
      const session = await sessionManager.createSession({
        totalBudgetMon: 1.0,
        velocityLimitMonPerMinute: 1.0,
        expiryDurationMs: 3600000,
      });

      const result = sessionManager.validateSession(
        session.sessionId,
        Object.values(DEFAULT_TARGET_ALLOWLIST)[0],
        "0x095ea7b3",
        "100000000000000000", // 0.1 MON
        0.1,
        0
      );

      expect(result.valid).toBe(true);
      expect(result.remainingBudgetMon).toBe(0.9);
    });

    it("should track cumulative spending", async () => {
      const session = await sessionManager.createSession({
        totalBudgetMon: 0.2,
        velocityLimitMonPerMinute: 1.0,
        expiryDurationMs: 3600000,
      });

      const targetAddress = Object.values(DEFAULT_TARGET_ALLOWLIST)[0];
      const selector = "0x095ea7b3";

      // First spend: 0.1
      sessionManager.recordSpending(
        session.sessionId,
        "100000000000000000",
        0.1,
        0,
        targetAddress,
        selector
      );

      // Second spend attempt: 0.15 (would exceed 0.2 total)
      const result = sessionManager.validateSession(
        session.sessionId,
        targetAddress,
        selector,
        "150000000000000000",
        0.15,
        1
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe("BUDGET_EXCEEDED");
    });
  });

  describe("validateSession - Expiry", () => {
    it("should reject expired sessions", async () => {
      // Acceptance criteria: "session cannot exceed time window"
      const session = await sessionManager.createSession({
        totalBudgetMon: 1.0,
        velocityLimitMonPerMinute: 0.5,
        expiryDurationMs: 100, // Very short expiry
      });

      // Wait for expiry
      await new Promise(r => setTimeout(r, 150));

      const result = sessionManager.validateSession(
        session.sessionId,
        Object.values(DEFAULT_TARGET_ALLOWLIST)[0],
        "0x095ea7b3",
        "100000000000000000",
        0.1,
        0
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe("SESSION_EXPIRED");
    });
  });

  describe("validateSession - Velocity", () => {
    it("should reject when velocity limit exceeded", async () => {
      // Turkish: "dakika başına harcama limiti"
      const session = await sessionManager.createSession({
        totalBudgetMon: 10.0,
        velocityLimitMonPerMinute: 0.1, // Very low velocity limit
        expiryDurationMs: 3600000,
      });

      const targetAddress = Object.values(DEFAULT_TARGET_ALLOWLIST)[0];
      const selector = "0x095ea7b3";

      // First spend at velocity limit
      sessionManager.recordSpending(
        session.sessionId,
        "100000000000000000",
        0.1,
        0,
        targetAddress,
        selector
      );

      // Try to spend again immediately (would exceed velocity)
      const result = sessionManager.validateSession(
        session.sessionId,
        targetAddress,
        selector,
        "100000000000000000",
        0.1,
        1
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe("VELOCITY_EXCEEDED");
    });
  });

  describe("validateSession - Target Allowlist", () => {
    it("should reject non-allowlisted target addresses", async () => {
      // Turkish: "bu adresler dışındaki hiçbir kontrata 1 kuruş bile gönderemesin"
      const session = await sessionManager.createSession({
        totalBudgetMon: 1.0,
        velocityLimitMonPerMinute: 1.0,
        expiryDurationMs: 3600000,
      });

      const result = sessionManager.validateSession(
        session.sessionId,
        "0xSCAM_CONTRACT_NOT_IN_ALLOWLIST",
        "0x095ea7b3",
        "100000000000000000",
        0.1,
        0
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe("TARGET_NOT_ALLOWED");
    });
  });

  describe("validateSession - Nonce Replay Protection", () => {
    it("should reject reused nonces", async () => {
      const session = await sessionManager.createSession({
        totalBudgetMon: 1.0,
        velocityLimitMonPerMinute: 1.0,
        expiryDurationMs: 3600000,
      });

      const targetAddress = Object.values(DEFAULT_TARGET_ALLOWLIST)[0];
      const selector = "0x095ea7b3";

      // Record with nonce 0
      sessionManager.recordSpending(
        session.sessionId,
        "10000000000000000", // Small amount
        0.01,
        0,
        targetAddress,
        selector
      );

      // Try to use nonce 0 again
      const result = sessionManager.validateSession(
        session.sessionId,
        targetAddress,
        selector,
        "10000000000000000",
        0.01,
        0 // Same nonce
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe("NONCE_ALREADY_USED");
    });
  });

  describe("revokeSession", () => {
    it("should revoke session and prevent future use", async () => {
      const session = await sessionManager.createSession({
        totalBudgetMon: 1.0,
        velocityLimitMonPerMinute: 0.5,
        expiryDurationMs: 3600000,
      });

      sessionManager.revokeSession(session.sessionId, "Test revocation");

      const result = sessionManager.validateSession(
        session.sessionId,
        Object.values(DEFAULT_TARGET_ALLOWLIST)[0],
        "0x095ea7b3",
        "100000000000000000",
        0.1,
        0
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe("SESSION_REVOKED");
    });
  });
});

// ============================================
// KILL SWITCH TESTS
// ============================================

describe("KillSwitch", () => {
  let killSwitch: KillSwitch;
  let clearedPlans = 0;
  let clearedSessions = 0;

  beforeEach(() => {
    clearedPlans = 0;
    clearedSessions = 0;

    killSwitch = createKillSwitch({
      callbacks: {
        clearQueuedPlans: () => {
          clearedPlans = 5; // Mock cleared 5 plans
          return clearedPlans;
        },
        clearSessions: () => {
          clearedSessions = 3; // Mock cleared 3 sessions
          return clearedSessions;
        },
      },
    });
  });

  describe("activate", () => {
    it("should disable all execution paths", async () => {
      // Acceptance criteria: "Kill switch disables all execution paths"
      await killSwitch.activate("test_admin", "Emergency test");

      expect(killSwitch.isActive()).toBe(true);

      // Should throw when checking
      expect(() => {
        killSwitch.checkAllowed("any_action");
      }).toThrow(KillSwitchError);
    });

    it("should clear queued execution plans", async () => {
      // Turkish: "ExecutionPlan içindeki bekleyen (queued) tüm işlemleri anında temizle"
      const state = await killSwitch.activate("test_admin", "Emergency test");

      expect(state.clearedQueuedPlansCount).toBe(5);
      expect(clearedPlans).toBe(5);
    });

    it("should revoke all sessions", async () => {
      const state = await killSwitch.activate("test_admin", "Emergency test");

      expect(state.clearedSessionCount).toBe(3);
      expect(clearedSessions).toBe(3);
    });
  });

  describe("deactivate", () => {
    it("should allow execution after deactivation", async () => {
      await killSwitch.activate("test_admin", "Test");
      await killSwitch.deactivate("test_admin", "Test over");

      expect(killSwitch.isActive()).toBe(false);

      // Should not throw
      expect(() => {
        killSwitch.checkAllowed("any_action");
      }).not.toThrow();
    });
  });

  describe("guard", () => {
    it("should block guarded functions when active", async () => {
      await killSwitch.activate("admin", "Test");

      await expect(
        killSwitch.guard("test_action", async () => {
          return "result";
        })
      ).rejects.toThrow(KillSwitchError);
    });

    it("should allow guarded functions when inactive", async () => {
      const result = await killSwitch.guard("test_action", async () => {
        return "result";
      });

      expect(result).toBe("result");
    });
  });
});

// ============================================
// VELOCITY TRACKER TESTS
// ============================================

describe("VelocityTracker", () => {
  let tracker: VelocityTracker;

  beforeEach(() => {
    tracker = createVelocityTracker({
      windowSizeMs: 1000, // 1 second for testing
    });
  });

  afterEach(() => {
    tracker.shutdown();
  });

  describe("checkVelocity", () => {
    it("should allow spending within velocity limit", () => {
      const result = tracker.checkVelocity(
        "session-1",
        "100000000000000000", // 0.1 MON
        0.1,
        "500000000000000000", // 0.5 MON limit
        0.5
      );

      expect(result.allowed).toBe(true);
      expect(result.remainingMon).toBeCloseTo(0.4, 2);
    });

    it("should reject spending exceeding velocity limit", () => {
      // Turkish: "dakika başına harcama limiti"
      // Record spending at limit
      tracker.recordSpending(
        "session-1",
        "500000000000000000",
        0.5,
        "0xTarget",
        "0xMethod"
      );

      // Try to spend more
      const result = tracker.checkVelocity(
        "session-1",
        "100000000000000000",
        0.1,
        "500000000000000000", // 0.5 limit
        0.5
      );

      expect(result.allowed).toBe(false);
      expect(result.exceededByMon).toBeGreaterThan(0);
    });

    it("should allow spending after window expires", async () => {
      // Record spending
      tracker.recordSpending(
        "session-1",
        "500000000000000000",
        0.5,
        "0xTarget",
        "0xMethod"
      );

      // Wait for window to expire
      await new Promise(r => setTimeout(r, 1100));

      // Should be allowed again
      const result = tracker.checkVelocity(
        "session-1",
        "500000000000000000",
        0.5,
        "500000000000000000",
        0.5
      );

      expect(result.allowed).toBe(true);
    });
  });
});

// ============================================
// ENCRYPTED STORAGE TESTS
// ============================================

describe("EncryptedSessionStorage", () => {
  let storage: EncryptedSessionStorage;

  beforeEach(() => {
    storage = createEncryptedStorage();
  });

  afterEach(() => {
    storage.shutdown();
  });

  describe("store and retrieve", () => {
    it("should store and retrieve session data", () => {
      const session = {
        sessionId: "test-session-123",
        publicKey: "0x1234",
        totalBudgetWei: "1000000000000000000",
        totalBudgetMon: 1.0,
        spentWei: "0",
        spentMon: 0,
        velocityLimitWeiPerMinute: "500000000000000000",
        velocityLimitMonPerMinute: 0.5,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        allowedMethodSelectors: ["0x095ea7b3"],
        allowedTargetAddresses: ["0xabc"],
        nonce: 0,
        usedNonces: [],
        isActive: true,
        isRevoked: false,
      };

      storage.store(session);
      const retrieved = storage.retrieve("test-session-123");

      expect(retrieved).toEqual(session);
    });

    it("should return null for non-existent session", () => {
      const result = storage.retrieve("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("clearAll", () => {
    it("should clear all sessions from memory", () => {
      // Turkish: "clear_memory ile temizlenmelidir"
      const session1 = {
        sessionId: "session-1",
        publicKey: "0x1",
        totalBudgetWei: "1000000000000000000",
        totalBudgetMon: 1,
        spentWei: "0",
        spentMon: 0,
        velocityLimitWeiPerMinute: "500000000000000000",
        velocityLimitMonPerMinute: 0.5,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        allowedMethodSelectors: [],
        allowedTargetAddresses: [],
        nonce: 0,
        usedNonces: [],
        isActive: true,
        isRevoked: false,
      };

      storage.store(session1);
      expect(storage.size).toBe(1);

      const cleared = storage.clearAll();
      expect(cleared).toBe(1);
      expect(storage.size).toBe(0);
    });
  });
});

// ============================================
// INTEGRATION TESTS
// ============================================

describe("Session Framework Integration", () => {
  let sessionManager: SessionManager;
  let killSwitch: KillSwitch;

  beforeEach(() => {
    killSwitch = createKillSwitch();
    sessionManager = createSessionManager({
      killSwitch,
      strictAllowlist: true,
    });
  });

  afterEach(() => {
    sessionManager.shutdown();
  });

  it("should block all sessions when kill switch activated", async () => {
    // Create session
    const session = await sessionManager.createSession({
      totalBudgetMon: 1.0,
      velocityLimitMonPerMinute: 0.5,
      expiryDurationMs: 3600000,
    });

    // Activate kill switch
    await killSwitch.activate("admin", "Test");

    // Session validation should fail
    const result = sessionManager.validateSession(
      session.sessionId,
      Object.values(DEFAULT_TARGET_ALLOWLIST)[0],
      "0x095ea7b3",
      "100000000000000000",
      0.1,
      0
    );

    expect(result.valid).toBe(false);
    expect(result.error).toBe("KILL_SWITCH_ACTIVE");
  });

  it("should enforce combined budget and velocity limits", async () => {
    const session = await sessionManager.createSession({
      totalBudgetMon: 1.0, // Total budget
      velocityLimitMonPerMinute: 0.3, // Lower velocity limit
      expiryDurationMs: 3600000,
    });

    const targetAddress = Object.values(DEFAULT_TARGET_ALLOWLIST)[0];
    const selector = "0x095ea7b3";

    // First spend 0.3 (at velocity limit)
    const result1 = sessionManager.validateSession(
      session.sessionId,
      targetAddress,
      selector,
      "300000000000000000",
      0.3,
      0
    );
    expect(result1.valid).toBe(true);

    sessionManager.recordSpending(
      session.sessionId,
      "300000000000000000",
      0.3,
      0,
      targetAddress,
      selector
    );

    // Second spend 0.3 (would be within budget but exceed velocity)
    const result2 = sessionManager.validateSession(
      session.sessionId,
      targetAddress,
      selector,
      "300000000000000000",
      0.3,
      1
    );
    expect(result2.valid).toBe(false);
    expect(result2.error).toBe("VELOCITY_EXCEEDED");
  });
});
