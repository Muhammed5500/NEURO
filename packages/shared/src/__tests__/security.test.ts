import { describe, it, expect, beforeEach } from "vitest";
import {
  activateKillSwitch,
  deactivateKillSwitch,
  isKillSwitchActive,
  getKillSwitchState,
  setExecutionMode,
  getExecutionMode,
  canWrite,
  calculateGasWithBuffer,
  validateTransactionExecution,
} from "../security/index.js";

describe("Security Module", () => {
  beforeEach(() => {
    // Reset state before each test
    deactivateKillSwitch("test", "CONFIRM_DEACTIVATE_KILL_SWITCH");
    setExecutionMode("READ_ONLY", "test");
  });

  describe("Kill Switch", () => {
    it("should be inactive by default", () => {
      expect(isKillSwitchActive()).toBe(false);
    });

    it("should activate kill switch", () => {
      activateKillSwitch("admin", "Emergency test");
      expect(isKillSwitchActive()).toBe(true);
      
      const state = getKillSwitchState();
      expect(state.enabled).toBe(true);
      expect(state.reason).toBe("Emergency test");
      expect(state.enabledBy).toBe("admin");
    });

    it("should deactivate kill switch with correct code", () => {
      activateKillSwitch("admin", "Emergency");
      const result = deactivateKillSwitch("admin", "CONFIRM_DEACTIVATE_KILL_SWITCH");
      
      expect(result).toBe(true);
      expect(isKillSwitchActive()).toBe(false);
    });

    it("should not deactivate kill switch with wrong code", () => {
      activateKillSwitch("admin", "Emergency");
      const result = deactivateKillSwitch("admin", "WRONG_CODE");
      
      expect(result).toBe(false);
      expect(isKillSwitchActive()).toBe(true);
    });
  });

  describe("Execution Mode", () => {
    it("should default to READ_ONLY", () => {
      expect(getExecutionMode()).toBe("READ_ONLY");
    });

    it("should allow setting execution mode", () => {
      const result = setExecutionMode("WRITE_ENABLED", "admin");
      expect(result).toBe(true);
      expect(getExecutionMode()).toBe("WRITE_ENABLED");
    });

    it("should not allow WRITE_ENABLED when kill switch is active", () => {
      activateKillSwitch("admin", "Emergency");
      const result = setExecutionMode("WRITE_ENABLED", "admin");
      
      expect(result).toBe(false);
      expect(getExecutionMode()).toBe("READ_ONLY");
    });
  });

  describe("canWrite", () => {
    it("should return false in READ_ONLY mode", () => {
      expect(canWrite()).toBe(false);
    });

    it("should return true in WRITE_ENABLED mode", () => {
      setExecutionMode("WRITE_ENABLED", "admin");
      expect(canWrite()).toBe(true);
    });

    it("should return false when kill switch is active", () => {
      setExecutionMode("WRITE_ENABLED", "admin");
      activateKillSwitch("admin", "Emergency");
      expect(canWrite()).toBe(false);
    });
  });

  describe("Gas Calculation", () => {
    it("should add buffer to gas estimate", () => {
      const estimate = calculateGasWithBuffer(100000n, 15);
      
      expect(estimate.gasLimit).toBe(100000n);
      expect(estimate.gasLimitWithBuffer).toBe(115000n);
      expect(estimate.bufferPercentage).toBe(15);
    });

    it("should cap buffer at maximum", () => {
      const estimate = calculateGasWithBuffer(100000n, 50);
      
      expect(estimate.bufferPercentage).toBe(25); // Max buffer
    });

    it("should calculate costs correctly", () => {
      const estimate = calculateGasWithBuffer(100000n, 15);
      
      expect(estimate.estimatedCostMon).toBeGreaterThan(0);
      expect(estimate.maxCostMon).toBeGreaterThan(estimate.estimatedCostMon);
    });
  });

  describe("Transaction Validation", () => {
    it("should allow valid transactions", () => {
      setExecutionMode("WRITE_ENABLED", "admin");
      const result = validateTransactionExecution(0.5, true);
      
      expect(result.allowed).toBe(true);
    });

    it("should block transactions exceeding value limit", () => {
      setExecutionMode("WRITE_ENABLED", "admin");
      const result = validateTransactionExecution(10, true); // Exceeds default 1 MON
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("exceeds maximum");
    });

    it("should block transactions when kill switch is active", () => {
      setExecutionMode("WRITE_ENABLED", "admin");
      activateKillSwitch("admin", "Emergency");
      const result = validateTransactionExecution(0.5, true);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Kill switch");
    });
  });
});
