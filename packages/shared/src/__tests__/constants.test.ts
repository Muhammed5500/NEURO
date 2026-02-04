import { describe, it, expect } from "vitest";
import {
  MONAD_MAINNET,
  NADFUN_API,
  GAS_CONFIG,
  FINALITY,
  SECURITY_DEFAULTS,
  EVM_VERSION,
} from "../constants/index.js";

describe("Constants", () => {
  describe("MONAD_MAINNET", () => {
    it("should have correct chain ID", () => {
      expect(MONAD_MAINNET.chainId).toBe(143);
    });

    it("should have correct RPC URL", () => {
      expect(MONAD_MAINNET.rpcUrl).toBe("https://rpc.monad.xyz");
    });

    it("should have correct WebSocket URL", () => {
      expect(MONAD_MAINNET.rpcUrlWs).toBe("wss://rpc.monad.xyz/ws");
    });

    it("should have MON as native currency", () => {
      expect(MONAD_MAINNET.nativeCurrency.symbol).toBe("MON");
      expect(MONAD_MAINNET.nativeCurrency.decimals).toBe(18);
    });
  });

  describe("NADFUN_API", () => {
    it("should have correct base URL", () => {
      expect(NADFUN_API.baseUrl).toBe("https://api.nadapp.net");
    });

    it("should have endpoint helpers", () => {
      expect(NADFUN_API.endpoints.tokens).toBe("/api/v1/tokens");
      expect(NADFUN_API.endpoints.tokenByAddress("0x123")).toBe("/api/v1/tokens/address/0x123");
    });
  });

  describe("GAS_CONFIG", () => {
    it("should have correct SLOAD-cold cost", () => {
      // Monad SLOAD-cold is 8100 gas (4x Ethereum's 2100)
      expect(GAS_CONFIG.sloadCold).toBe(8100n);
    });

    it("should have correct default buffer", () => {
      expect(GAS_CONFIG.defaultBufferPercentage).toBe(15);
    });

    it("should have operation estimates", () => {
      expect(GAS_CONFIG.operations.transfer).toBe(21000n);
      expect(GAS_CONFIG.operations.tokenLaunch).toBe(500000n);
    });
  });

  describe("FINALITY", () => {
    it("should have correct wait time", () => {
      // Economic finality: 800ms (2 blocks)
      expect(FINALITY.waitMs).toBe(800);
      expect(FINALITY.blocks).toBe(2);
    });
  });

  describe("SECURITY_DEFAULTS", () => {
    it("should default to READ_ONLY", () => {
      expect(SECURITY_DEFAULTS.executionMode).toBe("READ_ONLY");
    });

    it("should require manual approval", () => {
      expect(SECURITY_DEFAULTS.manualApprovalRequired).toBe(true);
    });

    it("should have kill switch disabled", () => {
      expect(SECURITY_DEFAULTS.killSwitchEnabled).toBe(false);
    });
  });

  describe("EVM_VERSION", () => {
    it("should be Prague (Pectra)", () => {
      expect(EVM_VERSION).toBe("prague");
    });
  });
});
