/**
 * OnChain Provider Tests
 * 
 * Tests for simulation mode and provider switching.
 * Covers acceptance criteria:
 * - Agent can run in dev with simulated data
 * - In prod, it can switch to real provider without code changes
 */

import { describe, it, expect, beforeEach } from "vitest";
import { 
  SimulationProvider, 
  createSimulationProvider,
  SIMULATION_SCENARIOS,
} from "../onchain/simulation-provider.js";
import { MonadRpcClient } from "../onchain/monad-rpc-client.js";
import { createOnChainProvider, createProviderFromEnv } from "../onchain/index.js";
import { BotRadar, createBotRadar } from "../onchain/bot-radar.js";
import { PriceImpactCalculator, createPriceImpactCalculator } from "../onchain/price-impact.js";
import { OnChainDataService, createOnChainDataService } from "../onchain/onchain-data-service.js";
import { OnChainCache } from "../onchain/cache.js";

describe("SimulationProvider", () => {
  let provider: SimulationProvider;

  beforeEach(() => {
    provider = createSimulationProvider("HEALTHY_MARKET");
  });

  describe("Initialization", () => {
    it("should initialize with default healthy market scenario", () => {
      expect(provider.name).toBe("SimulationProvider");
      expect(provider.capabilities.supportsMulticall).toBe(true);
      expect(provider.capabilities.supportsNadFunApi).toBe(true);
    });

    it("should support all capability flags in simulation", () => {
      const caps = provider.capabilities;
      
      // Simulation mode supports everything
      expect(caps.supportsMonadDb).toBe(true);
      expect(caps.supportsDeferredExecution).toBe(true);
      expect(caps.supportsMempoolQueries).toBe(true);
      expect(caps.supportsBondingCurveQueries).toBe(true);
    });
  });

  describe("Network State", () => {
    it("should return simulated network state", async () => {
      const state = await provider.getNetworkState();

      expect(state.chainId).toBe(143);
      expect(state.blockNumber).toBeGreaterThan(0n);
      expect(state.gasPriceGwei).toBeGreaterThan(0);
      expect(["low", "medium", "high", "extreme"]).toContain(state.congestionLevel);
    });

    it("should increment block number on each call", async () => {
      const state1 = await provider.getNetworkState();
      const state2 = await provider.getNetworkState();

      expect(state2.blockNumber).toBeGreaterThan(state1.blockNumber);
    });
  });

  describe("Pool Liquidity", () => {
    it("should return simulated pool data", async () => {
      const pool = await provider.getPoolLiquidity("0x1234567890123456789012345678901234567890");

      expect(pool.tokenAddress).toBe("0x1234567890123456789012345678901234567890");
      expect(pool.totalLiquidityUsd).toBeGreaterThan(0);
      expect(pool.bondingCurveProgress).toBeGreaterThanOrEqual(0);
      expect(pool.bondingCurveProgress).toBeLessThanOrEqual(100);
    });

    it("should allow setting custom pool data", async () => {
      provider.setPoolData("0xCUSTOM", {
        totalLiquidityUsd: 99999,
        bondingCurveProgress: 75,
      });

      const pool = await provider.getPoolLiquidity("0xCUSTOM");

      expect(pool.totalLiquidityUsd).toBeCloseTo(99999, -2);
      expect(pool.bondingCurveProgress).toBe(75);
    });
  });

  describe("Scenarios", () => {
    it("should switch between scenarios", async () => {
      // Start with healthy market
      let state = await provider.getNetworkState();
      expect(state.congestionLevel).toBe("low");

      // Switch to high gas scenario
      provider.setScenario("HIGH_GAS");
      state = await provider.getNetworkState();
      expect(state.congestionLevel).toBe("extreme");

      // Switch to low liquidity scenario
      provider.setScenario("LOW_LIQUIDITY");
      const pool = await provider.getPoolLiquidity("0xTEST");
      expect(pool.totalLiquidityUsd).toBeLessThan(1000);
    });

    it("should have bot activity in BOT_ACTIVITY scenario", async () => {
      const botProvider = createSimulationProvider("BOT_ACTIVITY");
      const txs = await botProvider.getRecentTransactions("0xTEST", 50);

      expect(txs.length).toBeGreaterThan(0);
      expect(txs.some(tx => tx.isSuspicious)).toBe(true);
    });

    it("should have near-graduation token in NEAR_GRADUATION scenario", async () => {
      const gradProvider = createSimulationProvider("NEAR_GRADUATION");
      const pool = await gradProvider.getPoolLiquidity("0xTEST");

      expect(pool.bondingCurveProgress).toBeGreaterThan(90);
    });
  });

  describe("Health Check", () => {
    it("should always be healthy in simulation", async () => {
      const isHealthy = await provider.isHealthy();
      expect(isHealthy).toBe(true);
    });
  });
});

describe("Provider Factory", () => {
  describe("createOnChainProvider", () => {
    it("should create simulation provider when mode is simulation", () => {
      const provider = createOnChainProvider({
        mode: "simulation",
        simulationScenario: "HEALTHY_MARKET",
      });

      expect(provider.name).toBe("SimulationProvider");
    });

    it("should create RPC client when mode is production with RPC URL", () => {
      const provider = createOnChainProvider({
        mode: "production",
        rpcUrl: "https://rpc.example.com",
        chainId: 143,
      });

      expect(provider.name).toBe("MonadRpcClient");
    });

    it("should throw error when production mode without RPC URL", () => {
      expect(() => {
        createOnChainProvider({
          mode: "production",
          // No rpcUrl
        });
      }).toThrow("RPC URL required");
    });
  });

  describe("createProviderFromEnv", () => {
    it("should create simulation provider in development", () => {
      // Save original
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      const provider = createProviderFromEnv();
      expect(provider.name).toBe("SimulationProvider");

      // Restore
      process.env.NODE_ENV = originalEnv;
    });
  });
});

describe("BotRadar", () => {
  let botRadar: BotRadar;
  let provider: SimulationProvider;

  beforeEach(() => {
    botRadar = createBotRadar();
    provider = createSimulationProvider("HEALTHY_MARKET");
  });

  describe("Analysis", () => {
    it("should analyze transactions and return result", async () => {
      const result = await botRadar.analyze(provider, "0xTEST");

      expect(result.totalTransactions).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(1);
      expect(result.analyzedAt).toBeGreaterThan(0);
    });

    it("should detect bot activity in BOT_ACTIVITY scenario", async () => {
      const botProvider = createSimulationProvider("BOT_ACTIVITY");
      const result = await botRadar.analyze(botProvider, "0xTEST");

      expect(result.botActivityLevel).not.toBe("none");
      expect(result.potentialSandwichCount).toBeGreaterThan(0);
    });

    it("should provide recommendations for high bot activity", async () => {
      const botProvider = createSimulationProvider("BOT_ACTIVITY");
      const result = await botRadar.analyze(botProvider, "0xTEST");

      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe("Quick Check", () => {
    it("should provide quick bot check", async () => {
      const result = await botRadar.quickCheck(provider, "0xTEST");

      expect(typeof result.hasBotActivity).toBe("boolean");
      expect(["none", "low", "medium", "high", "extreme"]).toContain(result.riskLevel);
    });
  });
});

describe("PriceImpactCalculator", () => {
  let calculator: PriceImpactCalculator;
  let provider: SimulationProvider;

  beforeEach(() => {
    calculator = createPriceImpactCalculator();
    provider = createSimulationProvider("HEALTHY_MARKET");
  });

  describe("Impact Calculation", () => {
    it("should calculate buy impact", async () => {
      const pool = await provider.getPoolLiquidity("0xTEST");
      const impact = calculator.calculateImpact(pool, 0.1, "buy");

      expect(impact.tradeAmountMon).toBe(0.1);
      expect(impact.tradeDirection).toBe("buy");
      expect(impact.priceImpactPercent).toBeGreaterThanOrEqual(0);
      expect(impact.expectedOutput).toBeGreaterThan(0n);
    });

    it("should calculate sell impact", async () => {
      const pool = await provider.getPoolLiquidity("0xTEST");
      const impact = calculator.calculateImpact(pool, 0.1, "sell");

      expect(impact.tradeDirection).toBe("sell");
      expect(impact.priceImpactPercent).toBeGreaterThanOrEqual(0);
    });

    it("should have higher impact for larger trades", async () => {
      const pool = await provider.getPoolLiquidity("0xTEST");
      
      const smallImpact = calculator.calculateImpact(pool, 0.1, "buy");
      const largeImpact = calculator.calculateImpact(pool, 10, "buy");

      expect(largeImpact.priceImpactPercent).toBeGreaterThan(smallImpact.priceImpactPercent);
    });

    it("should flag high impact trades", async () => {
      const lowLiqProvider = createSimulationProvider("LOW_LIQUIDITY");
      const pool = await lowLiqProvider.getPoolLiquidity("0xTEST");
      
      const impact = calculator.calculateImpact(pool, 1, "buy");

      expect(impact.isHighImpact).toBe(true);
      expect(["medium", "high", "extreme"]).toContain(impact.warningLevel);
    });
  });

  describe("Optimal Size Calculation", () => {
    it("should calculate optimal trade size for target impact", async () => {
      const pool = await provider.getPoolLiquidity("0xTEST");
      
      const targetImpact = 1; // 1%
      const optimalSize = calculator.calculateOptimalSize(pool, targetImpact, "buy");

      expect(optimalSize).toBeGreaterThan(0);

      // Verify the calculated size gives approximately the target impact
      const actualImpact = calculator.calculateImpact(pool, optimalSize, "buy");
      expect(actualImpact.priceImpactPercent).toBeCloseTo(targetImpact, 1);
    });
  });

  describe("Impact Table", () => {
    it("should generate impact table for multiple sizes", async () => {
      const pool = await provider.getPoolLiquidity("0xTEST");
      const sizes = [0.1, 0.5, 1, 5];
      
      const table = calculator.calculateImpactTable(pool, sizes, "buy");

      expect(table.length).toBe(sizes.length);
      expect(table[0].size).toBe(0.1);
      expect(table[3].size).toBe(5);
      
      // Impact should increase with size
      for (let i = 1; i < table.length; i++) {
        expect(table[i].impact.priceImpactPercent).toBeGreaterThanOrEqual(
          table[i - 1].impact.priceImpactPercent
        );
      }
    });
  });
});

describe("OnChainCache", () => {
  let cache: OnChainCache;

  beforeEach(() => {
    cache = new OnChainCache({ defaultTtlMs: 100 });
  });

  describe("Basic Operations", () => {
    it("should set and get values", () => {
      cache.set("test", { value: 123 });
      const result = cache.get<{ value: number }>("test");

      expect(result).toEqual({ value: 123 });
    });

    it("should return null for missing keys", () => {
      const result = cache.get("nonexistent");
      expect(result).toBeNull();
    });

    it("should expire entries after TTL", async () => {
      cache.set("expiring", "data", { ttlMs: 50 });
      
      expect(cache.get("expiring")).toBe("data");
      
      await new Promise(r => setTimeout(r, 60));
      
      expect(cache.get("expiring")).toBeNull();
    });
  });

  describe("Invalidation", () => {
    it("should invalidate single key", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      cache.invalidate("key1");

      expect(cache.get("key1")).toBeNull();
      expect(cache.get("key2")).toBe("value2");
    });

    it("should invalidate by prefix", () => {
      cache.set("pool:0x123", "data1");
      cache.set("pool:0x456", "data2");
      cache.set("network:1", "data3");

      const invalidated = cache.invalidatePrefix("pool:");

      expect(invalidated).toBe(2);
      expect(cache.get("pool:0x123")).toBeNull();
      expect(cache.get("pool:0x456")).toBeNull();
      expect(cache.get("network:1")).toBe("data3");
    });
  });

  describe("getOrFetch", () => {
    it("should return cached value without fetching", async () => {
      let fetchCount = 0;
      const fetcher = async () => {
        fetchCount++;
        return "fetched";
      };

      cache.set("existing", "cached");

      const result = await cache.getOrFetch("existing", fetcher);

      expect(result).toBe("cached");
      expect(fetchCount).toBe(0);
    });

    it("should fetch and cache on miss", async () => {
      let fetchCount = 0;
      const fetcher = async () => {
        fetchCount++;
        return "fetched";
      };

      const result1 = await cache.getOrFetch("new", fetcher);
      const result2 = await cache.getOrFetch("new", fetcher);

      expect(result1).toBe("fetched");
      expect(result2).toBe("fetched");
      expect(fetchCount).toBe(1); // Only fetched once
    });
  });

  describe("Statistics", () => {
    it("should track hits and misses", () => {
      cache.set("key", "value");

      cache.get("key"); // hit
      cache.get("key"); // hit
      cache.get("missing"); // miss

      const stats = cache.getStats();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.67, 1);
    });
  });
});

describe("OnChainDataService", () => {
  let service: OnChainDataService;

  beforeEach(() => {
    // Use simulation provider for testing
    service = createOnChainDataService({
      provider: createSimulationProvider("HEALTHY_MARKET"),
    });
  });

  describe("Full Analysis", () => {
    it("should perform complete token analysis", async () => {
      const analysis = await service.analyzeToken(
        "0x1234567890123456789012345678901234567890",
        0.5 // trade amount
      );

      expect(analysis.network).toBeDefined();
      expect(analysis.pool).toBeDefined();
      expect(analysis.priceImpact).toBeDefined();
      expect(analysis.botRadar).toBeDefined();
      expect(analysis.holders).toBeDefined();
      expect(analysis.summary).toBeDefined();
      expect(analysis.providerUsed).toBe("SimulationProvider");
    });

    it("should calculate overall risk correctly", async () => {
      const analysis = await service.analyzeToken("0xTEST", 0.1);

      expect(["low", "medium", "high", "critical"]).toContain(analysis.summary.overallRisk);
      expect(typeof analysis.summary.isGoodTimeToTrade).toBe("boolean");
    });
  });

  describe("Quick Trade Check", () => {
    it("should provide quick safety assessment", async () => {
      const check = await service.quickTradeCheck("0xTEST", 0.1);

      expect(typeof check.isSafe).toBe("boolean");
      expect(["low", "medium", "high", "critical"]).toContain(check.risk);
      expect(Array.isArray(check.reasons)).toBe(true);
    });

    it("should flag unsafe conditions", async () => {
      // Use low liquidity scenario
      const lowLiqService = createOnChainDataService({
        provider: createSimulationProvider("LOW_LIQUIDITY"),
      });

      const check = await lowLiqService.quickTradeCheck("0xTEST", 1);

      expect(check.isSafe).toBe(false);
      expect(check.reasons.length).toBeGreaterThan(0);
    });
  });
});
