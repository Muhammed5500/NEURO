import { describe, it, expect } from "vitest";
import {
  addressSchema,
  txHashSchema,
  tokenSchema,
  tokenLaunchParamsSchema,
  approvalStatusSchema,
  riskLevelSchema,
} from "../schemas/index.js";

describe("Schema Validation", () => {
  describe("addressSchema", () => {
    it("should accept valid Ethereum address", () => {
      const address = "0x1234567890123456789012345678901234567890";
      expect(addressSchema.parse(address)).toBe(address);
    });

    it("should reject invalid address", () => {
      expect(() => addressSchema.parse("invalid")).toThrow();
      expect(() => addressSchema.parse("0x123")).toThrow();
      expect(() => addressSchema.parse("1234567890123456789012345678901234567890")).toThrow();
    });
  });

  describe("txHashSchema", () => {
    it("should accept valid transaction hash", () => {
      const hash = "0x" + "a".repeat(64);
      expect(txHashSchema.parse(hash)).toBe(hash);
    });

    it("should reject invalid hash", () => {
      expect(() => txHashSchema.parse("invalid")).toThrow();
      expect(() => txHashSchema.parse("0x" + "a".repeat(63))).toThrow();
    });
  });

  describe("tokenLaunchParamsSchema", () => {
    it("should accept valid launch params", () => {
      const params = {
        name: "Test Token",
        symbol: "TEST",
        description: "A test token",
        totalSupply: "1000000000000000000000000",
        decimals: 18,
      };

      const result = tokenLaunchParamsSchema.parse(params);
      expect(result.name).toBe("Test Token");
      expect(result.symbol).toBe("TEST");
    });

    it("should reject invalid symbol", () => {
      const params = {
        name: "Test Token",
        symbol: "invalid-symbol", // Should be uppercase
        description: "A test token",
        totalSupply: "1000000000000000000000000",
      };

      expect(() => tokenLaunchParamsSchema.parse(params)).toThrow();
    });
  });

  describe("approvalStatusSchema", () => {
    it("should accept valid status values", () => {
      expect(approvalStatusSchema.parse("pending")).toBe("pending");
      expect(approvalStatusSchema.parse("approved")).toBe("approved");
      expect(approvalStatusSchema.parse("rejected")).toBe("rejected");
      expect(approvalStatusSchema.parse("expired")).toBe("expired");
    });

    it("should reject invalid status", () => {
      expect(() => approvalStatusSchema.parse("invalid")).toThrow();
    });
  });

  describe("riskLevelSchema", () => {
    it("should accept valid risk levels", () => {
      expect(riskLevelSchema.parse("low")).toBe("low");
      expect(riskLevelSchema.parse("medium")).toBe("medium");
      expect(riskLevelSchema.parse("high")).toBe("high");
      expect(riskLevelSchema.parse("critical")).toBe("critical");
    });

    it("should reject invalid risk level", () => {
      expect(() => riskLevelSchema.parse("extreme")).toThrow();
    });
  });
});
