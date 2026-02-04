import { describe, it, expect } from "vitest";
import { createNeuroClient, NeuroClient } from "../client/index.js";
import { createConfig, DEFAULT_CONFIG } from "../config.js";

describe("SDK Client", () => {
  describe("createNeuroClient", () => {
    it("should create client with default config", () => {
      const client = createNeuroClient();
      expect(client).toBeInstanceOf(NeuroClient);
    });

    it("should create client with custom config", () => {
      const client = createNeuroClient({
        rpcUrl: "https://custom.rpc.com",
        gasBufferPercent: 20,
      });
      expect(client).toBeInstanceOf(NeuroClient);
    });
  });

  describe("createConfig", () => {
    it("should use defaults when no config provided", () => {
      const config = createConfig();
      
      expect(config.rpcUrl).toBe(DEFAULT_CONFIG.rpcUrl);
      expect(config.nadfunApiUrl).toBe(DEFAULT_CONFIG.nadfunApiUrl);
      expect(config.gasBufferPercent).toBe(15);
    });

    it("should merge custom config with defaults", () => {
      const config = createConfig({
        rpcUrl: "https://custom.rpc.com",
      });
      
      expect(config.rpcUrl).toBe("https://custom.rpc.com");
      expect(config.nadfunApiUrl).toBe(DEFAULT_CONFIG.nadfunApiUrl);
    });
  });

  describe("NeuroClient", () => {
    it("should not have address when no private key", () => {
      const client = createNeuroClient();
      expect(client.address).toBeUndefined();
      expect(client.isConnected).toBe(false);
    });

    it("should have address when private key provided", () => {
      // Test private key (DO NOT USE IN PRODUCTION)
      const client = createNeuroClient({
        privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      });
      expect(client.address).toBeDefined();
      expect(client.isConnected).toBe(true);
    });
  });
});
