/**
 * Treasury Ledger Tests
 * 
 * Tests for treasury management:
 * - Allocation determinism
 * - Invariant enforcement
 * - Withdrawal timelock
 * - Balance reconciliation
 * - Monthly reports
 * 
 * Acceptance criteria:
 * - Ledger totals always match
 * - Allocation is deterministic and tested
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createBucketManager,
  BucketManager,
  createInvariantChecker,
  InvariantChecker,
  createWithdrawalQueue,
  WithdrawalQueue,
  createBalanceReconciler,
  BalanceReconciler,
  MockOnChainBalanceProvider,
  createRollupReporter,
  RollupReporter,
  createTreasuryLedger,
  TreasuryLedger,
  ALLOCATION_PERCENTAGES,
  InvariantViolationError,
  TimelockNotExpiredError,
  type BucketBalances,
  type PnlEvent,
} from "../treasury/index.js";

// ============================================
// BUCKET MANAGER TESTS
// ============================================

describe("BucketManager", () => {
  let manager: BucketManager;

  beforeEach(() => {
    manager = createBucketManager();
  });

  describe("allocation", () => {
    it("should allocate according to percentages (40/30/30)", () => {
      // Acceptance criteria: "Allocation is deterministic"
      const result = manager.allocate(BigInt(100e18));

      // 40% liquidity
      expect(result.allocations.liquidity_reserve).toBe(BigInt(40e18));
      // 30% launch
      expect(result.allocations.launch_reserve).toBe(BigInt(30e18));
      // 30% gas (plus any remainder)
      expect(result.allocations.gas_reserve).toBe(BigInt(30e18));
    });

    it("should be deterministic - same input always gives same output", () => {
      // Acceptance criteria: "Allocation is deterministic and tested"
      const amount = BigInt(123456789e18);
      
      const result1 = manager.allocate(amount);
      const result2 = manager.allocate(amount);
      const result3 = manager.allocate(amount);

      expect(result1.allocations.liquidity_reserve).toBe(result2.allocations.liquidity_reserve);
      expect(result1.allocations.launch_reserve).toBe(result2.allocations.launch_reserve);
      expect(result1.allocations.gas_reserve).toBe(result2.allocations.gas_reserve);

      expect(result2.allocations.liquidity_reserve).toBe(result3.allocations.liquidity_reserve);
      expect(result2.allocations.launch_reserve).toBe(result3.allocations.launch_reserve);
      expect(result2.allocations.gas_reserve).toBe(result3.allocations.gas_reserve);
    });

    it("should handle remainder by adding to gas reserve", () => {
      // Amount that doesn't divide evenly
      const result = manager.allocate(BigInt(100)); // 100 wei

      // 40 + 30 + 30 = 100, no remainder
      expect(
        result.allocations.liquidity_reserve +
        result.allocations.launch_reserve +
        result.allocations.gas_reserve
      ).toBe(BigInt(100));

      // Test with amount that has remainder
      const result2 = manager.allocate(BigInt(103)); // 103 wei
      // 40% of 103 = 41.2 -> 41
      // 30% of 103 = 30.9 -> 30
      // 30% of 103 = 30.9 -> 30
      // Remainder: 103 - 41 - 30 - 30 = 2 -> added to gas
      expect(result2.allocations.liquidity_reserve).toBe(41n);
      expect(result2.allocations.launch_reserve).toBe(30n);
      expect(result2.allocations.gas_reserve).toBe(32n); // 30 + 2 remainder
    });
  });

  describe("total balance tracking", () => {
    it("should maintain total balance after allocations", () => {
      // Acceptance criteria: "Ledger totals always match"
      const amount = BigInt(100e18);
      const result = manager.allocate(amount);
      manager.applyAllocation(result.allocations);

      expect(manager.getTotalBalance()).toBe(amount);
    });
  });
});

// ============================================
// INVARIANT CHECKER TESTS
// ============================================

describe("InvariantChecker", () => {
  let checker: InvariantChecker;

  beforeEach(() => {
    checker = createInvariantChecker();
  });

  describe("invariant enforcement", () => {
    it("should pass when Sum(Buckets) == Total", () => {
      // Turkish: "Sum(Buckets) == Total"
      const total = BigInt(100e18);
      const buckets: BucketBalances = {
        liquidity_reserve: BigInt(40e18),
        launch_reserve: BigInt(30e18),
        gas_reserve: BigInt(30e18),
      };

      const result = checker.check(total, buckets, "pre_operation");

      expect(result.passed).toBe(true);
      expect(result.discrepancy).toBe(0n);
    });

    it("should fail when Sum(Buckets) != Total", () => {
      // Acceptance criteria: "Ledger totals always match"
      const total = BigInt(100e18);
      const buckets: BucketBalances = {
        liquidity_reserve: BigInt(40e18),
        launch_reserve: BigInt(30e18),
        gas_reserve: BigInt(25e18), // Missing 5e18
      };

      const result = checker.check(total, buckets, "pre_operation");

      expect(result.passed).toBe(false);
      expect(result.discrepancy).toBe(BigInt(5e18));
    });

    it("should throw on enforce when invariant fails", () => {
      const total = BigInt(100e18);
      const buckets: BucketBalances = {
        liquidity_reserve: BigInt(40e18),
        launch_reserve: BigInt(30e18),
        gas_reserve: BigInt(20e18), // Missing 10e18
      };

      expect(() => {
        checker.enforce(total, buckets, "pre_operation");
      }).toThrow(InvariantViolationError);
    });
  });

  describe("auto-recovery", () => {
    it("should auto-recover small discrepancies via callback", () => {
      // Turkish: "Gas Reserve üzerinden dengele"
      const total = BigInt(100e18);
      const buckets: BucketBalances = {
        liquidity_reserve: BigInt(40e18),
        launch_reserve: BigInt(30e18),
        gas_reserve: BigInt(29.5e18), // Small discrepancy
      };

      let adjustmentApplied = 0n;
      const result = checker.checkWithRecovery(
        total,
        buckets,
        "post_operation",
        "test-op",
        (adjustment) => {
          adjustmentApplied = adjustment;
        }
      );

      expect(result.autoRecovered).toBe(true);
      expect(adjustmentApplied).toBe(BigInt(0.5e18));
    });
  });
});

// ============================================
// WITHDRAWAL QUEUE TESTS
// ============================================

describe("WithdrawalQueue", () => {
  let queue: WithdrawalQueue;

  beforeEach(() => {
    queue = createWithdrawalQueue({
      minTimelockMs: 24 * 60 * 60 * 1000, // 24 hours
      requiredApprovals: 1,
    });
  });

  describe("timelock enforcement", () => {
    it("should enforce minimum 24-hour timelock", () => {
      // Turkish: "minimum 24 saatlik withdrawal_queue"
      const request = queue.requestWithdrawal(
        BigInt(10e18),
        "liquidity_reserve",
        "0x1234567890123456789012345678901234567890",
        1000 // Try to set 1 second timelock
      );

      // Should be at least 24 hours
      const expectedMinTimelock = 24 * 60 * 60 * 1000;
      expect(request.timelockExpiresAt - request.requestedAt).toBeGreaterThanOrEqual(
        expectedMinTimelock
      );
    });

    it("should not allow execution before timelock expires", () => {
      const request = queue.requestWithdrawal(
        BigInt(10e18),
        "liquidity_reserve",
        "0x1234567890123456789012345678901234567890"
      );

      // Approve the request
      queue.approveWithdrawal(request.id, "admin@example.com");

      // Try to execute immediately - should fail
      expect(() => {
        queue.executeWithdrawal(request.id, "0xabc");
      }).toThrow(TimelockNotExpiredError);
    });
  });

  describe("kill switch integration", () => {
    it("should cancel all pending withdrawals on kill switch", () => {
      // Turkish: "Kill Switch ile müdahale"
      
      // Create several requests
      queue.requestWithdrawal(BigInt(10e18), "liquidity_reserve", "0x1111");
      queue.requestWithdrawal(BigInt(20e18), "launch_reserve", "0x2222");
      queue.requestWithdrawal(BigInt(5e18), "gas_reserve", "0x3333");

      expect(queue.getPendingRequests().length).toBe(3);

      // Activate kill switch
      const cancelled = queue.cancelAllPending("kill_switch", "Emergency");

      expect(cancelled).toBe(3);
      expect(queue.getPendingRequests().length).toBe(0);
    });

    it("should prevent execution when kill switch is active", () => {
      // Set kill switch callback
      queue.setKillSwitchCallback(() => true);

      const request = queue.requestWithdrawal(
        BigInt(10e18),
        "liquidity_reserve",
        "0x1234"
      );

      const readiness = queue.isReadyForExecution(request.id);
      expect(readiness.ready).toBe(false);
      expect(readiness.reason).toContain("Kill switch");
    });
  });
});

// ============================================
// BALANCE RECONCILER TESTS
// ============================================

describe("BalanceReconciler", () => {
  let reconciler: BalanceReconciler;
  let provider: MockOnChainBalanceProvider;

  beforeEach(() => {
    provider = new MockOnChainBalanceProvider();
    reconciler = createBalanceReconciler(provider);
    reconciler.setTreasuryAddress("0x1234");
  });

  describe("virtual vs real balance reconciliation", () => {
    it("should detect discrepancy between virtual and on-chain", async () => {
      // Turkish: "Sanal Defter ve Gerçek Zincir Üstü Bakiye"
      reconciler.updateVirtualBalance(BigInt(100e18));
      provider.setBalance(BigInt(99e18)); // 1 MON less on-chain

      const result = await reconciler.reconcile();

      expect(result.virtualBalance).toBe(BigInt(100e18));
      expect(result.onchainBalance).toBe(BigInt(99e18));
      expect(result.discrepancy).toBe(BigInt(1e18));
    });

    it("should auto-adjust via gas reserve callback", async () => {
      // Turkish: "Gas Reserve üzerinden dengele"
      reconciler.updateVirtualBalance(BigInt(100e18));
      provider.setBalance(BigInt(99e18));

      let adjustmentApplied = 0n;
      const result = await reconciler.reconcile(0n, 0n, (adjustment) => {
        adjustmentApplied = adjustment;
      });

      expect(result.adjustedFromGasReserve).toBe(true);
      expect(adjustmentApplied).toBe(-BigInt(1e18)); // Negative to reduce virtual
    });
  });
});

// ============================================
// ROLLUP REPORTER TESTS
// ============================================

describe("RollupReporter", () => {
  let reporter: RollupReporter;

  beforeEach(() => {
    reporter = createRollupReporter();
  });

  describe("monthly report generation", () => {
    it("should generate comprehensive report with gas efficiency", () => {
      // Turkish: "Harcama Verimliliği (Gas efficiency)"
      const periodStart = new Date("2026-02-01").getTime();
      const periodEnd = new Date("2026-03-01").getTime();

      const events: PnlEvent[] = [
        {
          id: "1",
          type: "TRADE_PROFIT",
          grossAmount: BigInt(10e18),
          fees: BigInt(0.1e18),
          netAmount: BigInt(9.9e18),
          allocations: { liquidity_reserve: BigInt(4e18), launch_reserve: BigInt(3e18), gas_reserve: BigInt(2.9e18) },
          description: "Trade profit",
          createdAt: periodStart + 1000,
          previousTotalBalance: 0n,
          newTotalBalance: BigInt(9.9e18),
          invariantCheckPassed: true,
        },
        {
          id: "2",
          type: "GAS_EXPENSE",
          grossAmount: BigInt(0.5e18),
          fees: 0n,
          netAmount: -BigInt(0.5e18),
          allocations: { liquidity_reserve: 0n, launch_reserve: 0n, gas_reserve: -BigInt(0.5e18) },
          description: "Gas cost",
          createdAt: periodStart + 2000,
          previousTotalBalance: BigInt(9.9e18),
          newTotalBalance: BigInt(9.4e18),
          invariantCheckPassed: true,
        },
      ];

      const report = reporter.generateReport(
        periodStart,
        periodEnd,
        0n,
        BigInt(9.4e18),
        { liquidity_reserve: 0n, launch_reserve: 0n, gas_reserve: 0n },
        { liquidity_reserve: BigInt(4e18), launch_reserve: BigInt(3e18), gas_reserve: BigInt(2.4e18) },
        events,
        [],
        []
      );

      expect(report.monthYear).toBe("2026-02");
      expect(report.pnlSummary.netPnl).toBe(BigInt(9.9e18) - BigInt(0.5e18));
      expect(report.gasEfficiency).toBeDefined();
      expect(report.gasEfficiency.totalGasSpent).toBe(BigInt(0.5e18));
    });

    it("should calculate growth metrics", () => {
      // Turkish: "Büyüme Hızı"
      const periodStart = new Date("2026-02-01").getTime();
      const periodEnd = new Date("2026-03-01").getTime();

      const report = reporter.generateReport(
        periodStart,
        periodEnd,
        BigInt(100e18), // Opening
        BigInt(120e18), // Closing (20% growth)
        { liquidity_reserve: BigInt(40e18), launch_reserve: BigInt(30e18), gas_reserve: BigInt(30e18) },
        { liquidity_reserve: BigInt(48e18), launch_reserve: BigInt(36e18), gas_reserve: BigInt(36e18) },
        [],
        [],
        []
      );

      expect(report.growthMetrics.percentageGrowth).toBeCloseTo(20, 1);
      expect(report.growthMetrics.absoluteGrowth).toBe(BigInt(20e18));
    });

    it("should export as JSON", () => {
      // Turkish: "JSON çıktısı sağla"
      const report = reporter.generateReport(
        Date.now() - 86400000 * 30,
        Date.now(),
        BigInt(100e18),
        BigInt(110e18),
        { liquidity_reserve: BigInt(40e18), launch_reserve: BigInt(30e18), gas_reserve: BigInt(30e18) },
        { liquidity_reserve: BigInt(44e18), launch_reserve: BigInt(33e18), gas_reserve: BigInt(33e18) },
        [],
        [],
        []
      );

      const json = reporter.exportAsJson(report);
      
      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed.monthYear).toBeDefined();
      expect(parsed.growthMetrics).toBeDefined();
      expect(parsed.gasEfficiency).toBeDefined();
    });
  });
});

// ============================================
// TREASURY LEDGER INTEGRATION TESTS
// ============================================

describe("TreasuryLedger", () => {
  let ledger: TreasuryLedger;

  beforeEach(() => {
    ledger = createTreasuryLedger();
  });

  describe("PnL event recording", () => {
    it("should record profit and allocate to buckets", () => {
      const event = ledger.recordPnlEvent(
        "TRADE_PROFIT",
        BigInt(100e18),
        BigInt(1e18), // 1 MON fees
        "Test trade profit"
      );

      expect(event.netAmount).toBe(BigInt(99e18));
      expect(event.invariantCheckPassed).toBe(true);

      // Check total balance
      expect(ledger.getTotalBalance()).toBe(BigInt(99e18));

      // Check bucket allocations
      const buckets = ledger.getBucketBalances();
      expect(buckets.liquidity_reserve + buckets.launch_reserve + buckets.gas_reserve)
        .toBe(BigInt(99e18));
    });

    it("should maintain invariant after every operation", () => {
      // Acceptance criteria: "Ledger totals always match"
      
      // Multiple operations
      ledger.recordPnlEvent("TRADE_PROFIT", BigInt(100e18), BigInt(1e18), "Profit 1");
      ledger.recordPnlEvent("TRADE_PROFIT", BigInt(50e18), BigInt(0.5e18), "Profit 2");
      ledger.recordPnlEvent("GAS_EXPENSE", BigInt(5e18), 0n, "Gas cost");
      ledger.recordPnlEvent("TRADE_LOSS", BigInt(10e18), BigInt(0.1e18), "Trade loss");

      const state = ledger.getState();
      const buckets = ledger.getBucketBalances();
      const bucketSum = buckets.liquidity_reserve + buckets.launch_reserve + buckets.gas_reserve;

      expect(state.totalBalance).toBe(bucketSum);
      expect(state.lastInvariantCheck.passed || state.lastInvariantCheck.autoRecovered).toBe(true);
    });
  });

  describe("allocation determinism", () => {
    it("should produce identical allocations for identical inputs", () => {
      // Acceptance criteria: "Allocation is deterministic and tested"
      
      // Create two ledgers and record same events
      const ledger1 = createTreasuryLedger();
      const ledger2 = createTreasuryLedger();

      ledger1.recordPnlEvent("TRADE_PROFIT", BigInt(123.456e18), BigInt(1.234e18), "Test");
      ledger2.recordPnlEvent("TRADE_PROFIT", BigInt(123.456e18), BigInt(1.234e18), "Test");

      const buckets1 = ledger1.getBucketBalances();
      const buckets2 = ledger2.getBucketBalances();

      expect(buckets1.liquidity_reserve).toBe(buckets2.liquidity_reserve);
      expect(buckets1.launch_reserve).toBe(buckets2.launch_reserve);
      expect(buckets1.gas_reserve).toBe(buckets2.gas_reserve);
    });
  });

  describe("withdrawal with timelock", () => {
    it("should create withdrawal request with timelock", () => {
      // Add some funds first
      ledger.recordPnlEvent("TRADE_PROFIT", BigInt(100e18), 0n, "Initial funds");

      const request = ledger.requestWithdrawal(
        BigInt(10e18),
        "liquidity_reserve",
        "0x1234567890123456789012345678901234567890"
      );

      expect(request.status).toBe("pending");
      expect(request.timelockExpiresAt - request.requestedAt).toBeGreaterThanOrEqual(
        24 * 60 * 60 * 1000 // 24 hours
      );
    });
  });

  describe("kill switch", () => {
    it("should cancel all pending withdrawals on kill switch", () => {
      ledger.recordPnlEvent("TRADE_PROFIT", BigInt(100e18), 0n, "Initial");

      // Create withdrawals
      ledger.requestWithdrawal(BigInt(5e18), "liquidity_reserve", "0x1111");
      ledger.requestWithdrawal(BigInt(3e18), "launch_reserve", "0x2222");

      const state = ledger.getState();
      expect(state.pendingWithdrawals.length).toBe(2);

      // Activate kill switch
      const cancelled = ledger.activateKillSwitch("admin", "Emergency");

      expect(cancelled).toBe(2);
      expect(ledger.getState().pendingWithdrawals.length).toBe(0);
    });
  });

  describe("monthly report", () => {
    it("should generate comprehensive monthly report", () => {
      // Record some activity
      ledger.recordPnlEvent("TRADE_PROFIT", BigInt(100e18), BigInt(1e18), "Profit");
      ledger.recordPnlEvent("GAS_EXPENSE", BigInt(2e18), 0n, "Gas");

      const periodStart = Date.now() - 86400000;
      const periodEnd = Date.now();

      const report = ledger.generateMonthlyReport(
        periodStart,
        periodEnd,
        0n,
        { liquidity_reserve: 0n, launch_reserve: 0n, gas_reserve: 0n }
      );

      expect(report.closingBalance).toBe(ledger.getTotalBalance());
      expect(report.gasEfficiency).toBeDefined();
      expect(report.growthMetrics).toBeDefined();
    });
  });
});
