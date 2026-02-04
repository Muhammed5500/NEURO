/**
 * Execution Plan Tests
 * 
 * Tests for execution plan generation, simulation, and constraint enforcement.
 * 
 * Acceptance Criteria:
 * - Given a decision, system outputs an execution plan and a simulation report
 * - No transaction is broadcast unless manual approval is enabled
 */

import { describe, it, expect, beforeEach } from "vitest";
import { 
  createBundleGenerator,
  createBundleSimulator,
  createConstraintEnforcer,
  createExecutionPlanService,
  MONAD_CONSTANTS,
  DEFAULT_CONSTRAINTS,
} from "../execution/index.js";
import type { FinalDecision } from "../graph/state.js";

// ============================================
// TEST FIXTURES
// ============================================

const createMockDecision = (overrides?: Partial<FinalDecision>): FinalDecision => ({
  status: "EXECUTE",
  recommendation: "buy",
  confidence: 0.85,
  rationale: "Test decision",
  averageConfidence: 0.85,
  averageRiskScore: 0.3,
  agreementScore: 0.8,
  adversarialVeto: false,
  decisionMadeAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  ...overrides,
});

// ============================================
// BUNDLE GENERATOR TESTS
// ============================================

describe("BundleGenerator", () => {
  let generator: ReturnType<typeof createBundleGenerator>;

  beforeEach(() => {
    generator = createBundleGenerator();
  });

  describe("generateFromDecision", () => {
    it("should generate a buy bundle from decision", () => {
      const decision = createMockDecision({ recommendation: "buy" });
      
      const bundle = generator.generateFromDecision(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: {
          address: "0xTOKEN",
          symbol: "TEST",
        },
        tradeAmount: 0.5,
        tradeAmountWei: "500000000000000000",
      });

      expect(bundle.id).toBeDefined();
      expect(bundle.chainId).toBe(MONAD_CONSTANTS.CHAIN_ID);
      expect(bundle.totalSteps).toBeGreaterThan(0);
      expect(bundle.consensusDecisionId).toBeDefined();
      expect(bundle.isAtomic).toBe(true);
      expect(bundle.requiresApproval).toBe(true);
    });

    it("should generate a sell bundle with approve step", () => {
      const decision = createMockDecision({ recommendation: "sell" });
      
      const bundle = generator.generateFromDecision(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: {
          address: "0xTOKEN",
          symbol: "TEST",
        },
        tradeAmount: 0.5,
        tradeAmountWei: "500000000000000000",
      });

      // Sell should have approve + swap
      expect(bundle.totalSteps).toBe(2);
      expect(bundle.steps[0].type).toBe("approve");
      expect(bundle.steps[1].type).toBe("swap");
    });

    it("should apply 15% gas buffer", () => {
      // Turkish: "gas_limit değerine otomatik olarak %15 güvenlik marjı ekle"
      const decision = createMockDecision();
      
      const bundle = generator.generateFromDecision(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: { symbol: "TEST" },
        tradeAmount: 0.5,
        tradeAmountWei: "500000000000000000",
      });

      // Check that buffer is applied
      const step = bundle.steps[0];
      const expectedWithBuffer = (step.estimatedGas * BigInt(115)) / 100n;
      expect(step.estimatedGasWithBuffer).toBe(expectedWithBuffer);
    });
  });

  describe("generateTokenLaunchBundle", () => {
    it("should generate createToken -> addLiquidity -> initialSwap steps", () => {
      const bundle = generator.generateTokenLaunchBundle({
        walletAddress: "0x1234567890123456789012345678901234567890",
        tokenName: "Test Token",
        tokenSymbol: "TEST",
        initialLiquidityMon: 1.0,
        initialBuyMon: 0.1,
      });

      expect(bundle.totalSteps).toBe(3);
      expect(bundle.steps[0].type).toBe("createToken");
      expect(bundle.steps[1].type).toBe("addLiquidity");
      expect(bundle.steps[2].type).toBe("swap");
      
      // Check dependencies
      expect(bundle.steps[1].dependsOn).toContain("step-0");
      expect(bundle.steps[2].dependsOn).toContain("step-1");
    });

    it("should skip initial buy if not specified", () => {
      const bundle = generator.generateTokenLaunchBundle({
        walletAddress: "0x1234567890123456789012345678901234567890",
        tokenName: "Test Token",
        tokenSymbol: "TEST",
        initialLiquidityMon: 1.0,
        // No initialBuyMon
      });

      expect(bundle.totalSteps).toBe(2);
      expect(bundle.steps[0].type).toBe("createToken");
      expect(bundle.steps[1].type).toBe("addLiquidity");
    });
  });
});

// ============================================
// BUNDLE SIMULATOR TESTS
// ============================================

describe("BundleSimulator", () => {
  let simulator: ReturnType<typeof createBundleSimulator>;
  let generator: ReturnType<typeof createBundleGenerator>;

  beforeEach(() => {
    simulator = createBundleSimulator({
      useLocalEvm: true,
      maxSlippagePercent: 2.5,
    });
    generator = createBundleGenerator();
  });

  describe("simulate", () => {
    it("should simulate a bundle and return receipt", async () => {
      const decision = createMockDecision();
      const bundle = generator.generateFromDecision(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: { address: "0xTOKEN", symbol: "TEST" },
        tradeAmount: 0.1,
        tradeAmountWei: "100000000000000000",
      });

      const receipt = await simulator.simulate(
        bundle,
        "0x1234567890123456789012345678901234567890"
      );

      expect(receipt.id).toBeDefined();
      expect(receipt.bundleId).toBe(bundle.id);
      expect(receipt.simulationBlockNumber).toBeGreaterThan(0n);
      expect(receipt.stepResults.length).toBe(bundle.totalSteps);
    });

    it("should calculate state diffs", async () => {
      // Turkish: "cüzdanın MON bakiyesi ve hedeflenen token bakiyesindeki net değişimi raporla"
      const decision = createMockDecision();
      const bundle = generator.generateFromDecision(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: { address: "0xTOKEN", symbol: "TEST" },
        tradeAmount: 0.1,
        tradeAmountWei: "100000000000000000",
      });

      const receipt = await simulator.simulate(
        bundle,
        "0x1234567890123456789012345678901234567890"
      );

      expect(receipt.aggregatedStateDiffs.length).toBeGreaterThan(0);
      
      const walletDiff = receipt.aggregatedStateDiffs[0];
      expect(walletDiff.monBalanceBefore).toBeDefined();
      expect(walletDiff.monBalanceAfter).toBeDefined();
      expect(walletDiff.monBalanceChange).toBeDefined();
      expect(typeof walletDiff.monBalanceChangeMon).toBe("number");
    });

    it("should detect slippage breach", async () => {
      // Turkish: "fiyat kayması %2.5 limitini aşarsa planı anında iptal et"
      const decision = createMockDecision();
      
      // Large trade to trigger high slippage
      const bundle = generator.generateFromDecision(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: { address: "0xTOKEN", symbol: "TEST" },
        tradeAmount: 10, // Large trade
        tradeAmountWei: "10000000000000000000",
      });

      // Use a simulator with very low slippage tolerance
      const strictSimulator = createBundleSimulator({
        useLocalEvm: true,
        maxSlippagePercent: 0.1, // Very low
      });

      const receipt = await strictSimulator.simulate(
        bundle,
        "0x1234567890123456789012345678901234567890"
      );

      // Should fail due to slippage
      expect(receipt.slippageCheck.passed).toBe(false);
    });
  });

  describe("checkStaleness", () => {
    it("should detect stale simulation (3 blocks)", async () => {
      // Turkish: "3 blok (1.2 saniye) geçtiyse simülasyonu bayat kabul et"
      const decision = createMockDecision();
      const bundle = generator.generateFromDecision(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: { symbol: "TEST" },
        tradeAmount: 0.1,
        tradeAmountWei: "100000000000000000",
      });

      const receipt = await simulator.simulate(
        bundle,
        "0x1234567890123456789012345678901234567890"
      );

      // Check with current block (not stale)
      const currentCheck = simulator.checkStaleness(
        receipt,
        receipt.simulationBlockNumber + 1n
      );
      expect(currentCheck.isStale).toBe(false);

      // Check with block 3+ blocks later (stale)
      const staleCheck = simulator.checkStaleness(
        receipt,
        receipt.simulationBlockNumber + 4n
      );
      expect(staleCheck.isStale).toBe(true);
      expect(staleCheck.requiresRefresh).toBe(true);
    });
  });
});

// ============================================
// CONSTRAINT ENFORCER TESTS
// ============================================

describe("ConstraintEnforcer", () => {
  let enforcer: ReturnType<typeof createConstraintEnforcer>;
  let generator: ReturnType<typeof createBundleGenerator>;
  let simulator: ReturnType<typeof createBundleSimulator>;

  beforeEach(() => {
    enforcer = createConstraintEnforcer();
    generator = createBundleGenerator();
    simulator = createBundleSimulator({ useLocalEvm: true });
  });

  describe("enforceAll", () => {
    it("should pass when all constraints met", async () => {
      const decision = createMockDecision();
      const bundle = generator.generateFromDecision(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: { symbol: "TEST" },
        tradeAmount: 0.1,
        tradeAmountWei: "100000000000000000",
      });

      const simulation = await simulator.simulate(
        bundle,
        "0x1234567890123456789012345678901234567890"
      );

      const result = enforcer.enforceAll(bundle, simulation, 0.3);

      expect(result.passed).toBe(true);
      expect(result.violations.filter(v => v.severity === "critical")).toHaveLength(0);
    });

    it("should reject when risk score too high", async () => {
      const decision = createMockDecision();
      const bundle = generator.generateFromDecision(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: { symbol: "TEST" },
        tradeAmount: 0.1,
        tradeAmountWei: "100000000000000000",
      });

      const simulation = await simulator.simulate(
        bundle,
        "0x1234567890123456789012345678901234567890"
      );

      const result = enforcer.enforceAll(bundle, simulation, 0.9); // High risk

      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.type === "risk_too_high")).toBe(true);
    });

    it("should reject when budget exceeded", async () => {
      // Create enforcer with low budget
      const strictEnforcer = createConstraintEnforcer({
        maxBudgetMon: 0.001, // Very low
      });

      const decision = createMockDecision();
      const bundle = generator.generateFromDecision(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: { symbol: "TEST" },
        tradeAmount: 1.0, // Exceeds budget
        tradeAmountWei: "1000000000000000000",
      });

      const simulation = await simulator.simulate(
        bundle,
        "0x1234567890123456789012345678901234567890"
      );

      const result = strictEnforcer.enforceAll(bundle, simulation, 0.3);

      expect(result.violations.some(v => v.type === "budget_exceeded")).toBe(true);
    });

    it("should reject when simulation stale", async () => {
      const decision = createMockDecision();
      const bundle = generator.generateFromDecision(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: { symbol: "TEST" },
        tradeAmount: 0.1,
        tradeAmountWei: "100000000000000000",
      });

      const simulation = await simulator.simulate(
        bundle,
        "0x1234567890123456789012345678901234567890"
      );

      // Check with block number far in the future (stale)
      const result = enforcer.enforceAll(
        bundle,
        simulation,
        0.3,
        simulation.simulationBlockNumber + 10n
      );

      expect(result.violations.some(v => v.type === "simulation_stale")).toBe(true);
    });
  });

  describe("checkSlippage", () => {
    it("should return critical violation when slippage exceeds limit", async () => {
      const mockReceipt = {
        slippageCheck: {
          passed: false,
          actualSlippage: 5.0,
          maxAllowedSlippage: 2.5,
        },
      } as any;

      const violation = enforcer.checkSlippage(mockReceipt);

      expect(violation).not.toBeNull();
      expect(violation?.type).toBe("slippage_breach");
      expect(violation?.severity).toBe("critical");
      expect(violation?.message).toContain("Slippage Breach");
    });
  });
});

// ============================================
// EXECUTION PLAN SERVICE TESTS
// ============================================

describe("ExecutionPlanService", () => {
  let service: ReturnType<typeof createExecutionPlanService>;

  beforeEach(() => {
    service = createExecutionPlanService({
      constraints: {
        requireManualApproval: true, // Acceptance criteria
        maxSlippagePercent: 2.5,
        maxBudgetMon: 10,
        maxRiskScore: 0.7,
      },
    });
  });

  describe("generatePlan", () => {
    it("should output execution plan and simulation report", async () => {
      // Acceptance criteria: "Given a decision, system outputs an execution plan and a simulation report"
      const decision = createMockDecision();

      const output = await service.generatePlan(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: { address: "0xTOKEN", symbol: "TEST" },
        tradeAmount: 0.5,
      });

      // Should have execution plan (bundle)
      expect(output.bundle).toBeDefined();
      expect(output.bundle.id).toBeDefined();
      expect(output.bundle.steps.length).toBeGreaterThan(0);

      // Should have simulation report
      expect(output.simulation).toBeDefined();
      expect(output.simulation.id).toBeDefined();
      expect(output.simulation.stepResults.length).toBeGreaterThan(0);

      // Should have constraint check
      expect(output.constraintsChecked).toBe(true);
    });

    it("should require manual approval by default", async () => {
      // Acceptance criteria: "No transaction is broadcast unless manual approval is enabled"
      const decision = createMockDecision();

      const output = await service.generatePlan(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: { symbol: "TEST" },
        tradeAmount: 0.1,
      });

      expect(output.requiresApproval).toBe(true);
      expect(output.canExecute).toBe(false);
      expect(output.blockingReasons).toContain("Manual approval required before execution");
    });

    it("should reject non-EXECUTE decisions", async () => {
      const decision = createMockDecision({ status: "REJECT" });

      await expect(
        service.generatePlan(decision, {
          walletAddress: "0x1234567890123456789012345678901234567890",
          targetToken: { symbol: "TEST" },
          tradeAmount: 0.1,
        })
      ).rejects.toThrow("Cannot generate execution plan");
    });

    it("should include gas buffer in all steps", async () => {
      // Turkish: "gas_limit değerine otomatik olarak %15 güvenlik marjı ekle"
      const decision = createMockDecision();

      const output = await service.generatePlan(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: { symbol: "TEST" },
        tradeAmount: 0.1,
      });

      for (const step of output.bundle.steps) {
        const expectedBuffered = (step.estimatedGas * 115n) / 100n;
        expect(step.estimatedGasWithBuffer).toBe(expectedBuffered);
      }
    });
  });

  describe("generateTokenLaunchPlan", () => {
    it("should generate complete launch plan", async () => {
      const output = await service.generateTokenLaunchPlan({
        walletAddress: "0x1234567890123456789012345678901234567890",
        tokenName: "Moon Token",
        tokenSymbol: "MOON",
        initialLiquidityMon: 1.0,
        initialBuyMon: 0.1,
      });

      expect(output.bundle.steps.length).toBe(3);
      expect(output.bundle.steps[0].type).toBe("createToken");
      expect(output.bundle.steps[1].type).toBe("addLiquidity");
      expect(output.bundle.steps[2].type).toBe("swap");
      expect(output.simulation).toBeDefined();
    });
  });

  describe("refreshSimulationIfNeeded", () => {
    it("should refresh stale simulation", async () => {
      // Turkish: "simülasyonu bayat kabul et ve yenilenmesini iste"
      const decision = createMockDecision();

      const output = await service.generatePlan(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: { symbol: "TEST" },
        tradeAmount: 0.1,
      });

      const originalSimId = output.simulation.id;

      // Refresh with stale block number
      const refreshed = await service.refreshSimulationIfNeeded(
        output,
        output.simulation.simulationBlockNumber + 10n,
        "0x1234567890123456789012345678901234567890"
      );

      // Should have new simulation
      expect(refreshed.simulation.id).not.toBe(originalSimId);
    });

    it("should not refresh if not stale", async () => {
      const decision = createMockDecision();

      const output = await service.generatePlan(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: { symbol: "TEST" },
        tradeAmount: 0.1,
      });

      const originalSimId = output.simulation.id;

      // Refresh with current block (not stale)
      const refreshed = await service.refreshSimulationIfNeeded(
        output,
        output.simulation.simulationBlockNumber + 1n,
        "0x1234567890123456789012345678901234567890"
      );

      // Should keep same simulation
      expect(refreshed.simulation.id).toBe(originalSimId);
    });
  });

  describe("formatPlanSummary", () => {
    it("should format plan for display", async () => {
      const decision = createMockDecision();

      const output = await service.generatePlan(decision, {
        walletAddress: "0x1234567890123456789012345678901234567890",
        targetToken: { symbol: "TEST" },
        tradeAmount: 0.1,
      });

      const summary = service.formatPlanSummary(output);

      expect(summary).toContain("EXECUTION PLAN");
      expect(summary).toContain("EXECUTION STEPS");
      expect(summary).toContain("SIMULATION RESULT");
      expect(summary).toContain("SLIPPAGE CHECK");
      expect(summary).toContain("STATE CHANGES");
      expect(summary).toContain("CONSTRAINT CHECK");
    });
  });
});
