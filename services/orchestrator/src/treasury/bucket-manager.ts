/**
 * Allocation Bucket Manager
 * 
 * Manages treasury allocation buckets:
 * - 40% liquidity reserve
 * - 30% next launch reserve
 * - 30% gas reserve
 * 
 * Acceptance criteria: "Allocation is deterministic and tested"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  BucketType,
  BucketBalances,
  TreasuryConfig,
} from "./types.js";
import {
  ALLOCATION_PERCENTAGES,
  InsufficientBucketBalanceError,
} from "./types.js";

const bucketLogger = logger.child({ component: "bucket-manager" });

// ============================================
// ALLOCATION RESULT
// ============================================

export interface AllocationResult {
  allocations: BucketBalances;
  totalAllocated: bigint;
  remainder: bigint; // Due to integer division
}

// ============================================
// BUCKET MANAGER
// ============================================

export class BucketManager {
  private readonly percentages: Record<BucketType, number>;
  
  // Current balances
  private balances: BucketBalances = {
    liquidity_reserve: 0n,
    launch_reserve: 0n,
    gas_reserve: 0n,
  };

  constructor(config?: Partial<TreasuryConfig>) {
    this.percentages = config?.allocationPercentages || ALLOCATION_PERCENTAGES;

    // Validate percentages sum to 100
    const sum = Object.values(this.percentages).reduce((a, b) => a + b, 0);
    if (sum !== 100) {
      throw new Error(`Allocation percentages must sum to 100, got ${sum}`);
    }

    bucketLogger.info({
      liquidity: this.percentages.liquidity_reserve,
      launch: this.percentages.launch_reserve,
      gas: this.percentages.gas_reserve,
    }, "BucketManager initialized");
  }

  /**
   * Allocate an amount to buckets based on percentages
   * Acceptance criteria: "Allocation is deterministic"
   */
  allocate(amount: bigint): AllocationResult {
    if (amount <= 0n) {
      return {
        allocations: { liquidity_reserve: 0n, launch_reserve: 0n, gas_reserve: 0n },
        totalAllocated: 0n,
        remainder: 0n,
      };
    }

    // Calculate allocations (deterministic integer division)
    const liquidityAlloc = (amount * BigInt(this.percentages.liquidity_reserve)) / 100n;
    const launchAlloc = (amount * BigInt(this.percentages.launch_reserve)) / 100n;
    const gasAlloc = (amount * BigInt(this.percentages.gas_reserve)) / 100n;

    const totalAllocated = liquidityAlloc + launchAlloc + gasAlloc;
    const remainder = amount - totalAllocated;

    // Add remainder to gas reserve (deterministic choice)
    const finalGasAlloc = gasAlloc + remainder;

    const allocations: BucketBalances = {
      liquidity_reserve: liquidityAlloc,
      launch_reserve: launchAlloc,
      gas_reserve: finalGasAlloc,
    };

    bucketLogger.debug({
      amount: amount.toString(),
      liquidity: liquidityAlloc.toString(),
      launch: launchAlloc.toString(),
      gas: finalGasAlloc.toString(),
      remainder: remainder.toString(),
    }, "Amount allocated to buckets");

    return {
      allocations,
      totalAllocated: amount, // After adding remainder
      remainder: 0n, // All allocated
    };
  }

  /**
   * Apply allocation to current balances
   */
  applyAllocation(allocations: BucketBalances): void {
    this.balances.liquidity_reserve += allocations.liquidity_reserve;
    this.balances.launch_reserve += allocations.launch_reserve;
    this.balances.gas_reserve += allocations.gas_reserve;
  }

  /**
   * Deduct from a specific bucket
   */
  deduct(bucket: BucketType, amount: bigint): void {
    if (amount <= 0n) return;

    const available = this.balances[bucket];
    if (available < amount) {
      throw new InsufficientBucketBalanceError(
        `Insufficient balance in ${bucket}`,
        bucket,
        amount,
        available
      );
    }

    this.balances[bucket] -= amount;

    bucketLogger.debug({
      bucket,
      amount: amount.toString(),
      newBalance: this.balances[bucket].toString(),
    }, "Deducted from bucket");
  }

  /**
   * Transfer between buckets
   */
  transfer(from: BucketType, to: BucketType, amount: bigint): void {
    if (amount <= 0n) return;
    if (from === to) return;

    this.deduct(from, amount);
    this.balances[to] += amount;

    bucketLogger.debug({
      from,
      to,
      amount: amount.toString(),
    }, "Transferred between buckets");
  }

  /**
   * Get current balances
   */
  getBalances(): BucketBalances {
    return { ...this.balances };
  }

  /**
   * Get total balance across all buckets
   */
  getTotalBalance(): bigint {
    return (
      this.balances.liquidity_reserve +
      this.balances.launch_reserve +
      this.balances.gas_reserve
    );
  }

  /**
   * Get balance for a specific bucket
   */
  getBucketBalance(bucket: BucketType): bigint {
    return this.balances[bucket];
  }

  /**
   * Set balances directly (for initialization or recovery)
   */
  setBalances(balances: BucketBalances): void {
    this.balances = { ...balances };
  }

  /**
   * Adjust gas reserve (for discrepancy reconciliation)
   * Turkish: "Aradaki farkı otomatik olarak Gas Reserve üzerinden dengele"
   */
  adjustGasReserve(adjustment: bigint): void {
    const newBalance = this.balances.gas_reserve + adjustment;
    
    if (newBalance < 0n) {
      bucketLogger.warn({
        currentBalance: this.balances.gas_reserve.toString(),
        adjustment: adjustment.toString(),
        wouldBe: newBalance.toString(),
      }, "Gas reserve adjustment would result in negative balance");
      
      // Set to zero instead of going negative
      this.balances.gas_reserve = 0n;
    } else {
      this.balances.gas_reserve = newBalance;
    }

    bucketLogger.info({
      adjustment: adjustment.toString(),
      newBalance: this.balances.gas_reserve.toString(),
    }, "Gas reserve adjusted");
  }

  /**
   * Check if bucket has sufficient balance
   */
  hasSufficientBalance(bucket: BucketType, amount: bigint): boolean {
    return this.balances[bucket] >= amount;
  }

  /**
   * Get allocation percentages
   */
  getPercentages(): Record<BucketType, number> {
    return { ...this.percentages };
  }

  /**
   * Calculate what percentage each bucket currently holds
   */
  getCurrentAllocationPercentages(): Record<BucketType, number> {
    const total = this.getTotalBalance();
    if (total === 0n) {
      return { liquidity_reserve: 0, launch_reserve: 0, gas_reserve: 0 };
    }

    return {
      liquidity_reserve: Number((this.balances.liquidity_reserve * 10000n) / total) / 100,
      launch_reserve: Number((this.balances.launch_reserve * 10000n) / total) / 100,
      gas_reserve: Number((this.balances.gas_reserve * 10000n) / total) / 100,
    };
  }

  /**
   * Rebalance buckets to match target percentages
   */
  rebalance(): BucketBalances {
    const total = this.getTotalBalance();
    if (total === 0n) {
      return { liquidity_reserve: 0n, launch_reserve: 0n, gas_reserve: 0n };
    }

    // Calculate target balances
    const result = this.allocate(total);
    
    // Calculate changes
    const changes: BucketBalances = {
      liquidity_reserve: result.allocations.liquidity_reserve - this.balances.liquidity_reserve,
      launch_reserve: result.allocations.launch_reserve - this.balances.launch_reserve,
      gas_reserve: result.allocations.gas_reserve - this.balances.gas_reserve,
    };

    // Apply new balances
    this.balances = result.allocations;

    bucketLogger.info({
      newBalances: {
        liquidity: this.balances.liquidity_reserve.toString(),
        launch: this.balances.launch_reserve.toString(),
        gas: this.balances.gas_reserve.toString(),
      },
      changes: {
        liquidity: changes.liquidity_reserve.toString(),
        launch: changes.launch_reserve.toString(),
        gas: changes.gas_reserve.toString(),
      },
    }, "Buckets rebalanced");

    return changes;
  }
}

/**
 * Factory function
 */
export function createBucketManager(
  config?: Partial<TreasuryConfig>
): BucketManager {
  return new BucketManager(config);
}
