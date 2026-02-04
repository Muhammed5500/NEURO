/**
 * Epoch Manager
 * 
 * Manages reward epochs with:
 * - Strict caps per epoch
 * - Burn policy for undistributed points
 * - Epoch transitions
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  EpochConfig,
  EpochState,
  RewardRecord,
} from "./types.js";
import {
  DEFAULT_EPOCH_CONFIG,
  RewardCapExceededError,
} from "./types.js";

const epochLogger = logger.child({ component: "epoch-manager" });

// ============================================
// EPOCH MANAGER
// ============================================

export class EpochManager {
  private readonly config: EpochConfig;
  private readonly epochs: Map<number, EpochState> = new Map();
  private currentEpochNumber: number;

  constructor(config?: Partial<EpochConfig>) {
    this.config = { ...DEFAULT_EPOCH_CONFIG, ...config };
    this.currentEpochNumber = this.calculateCurrentEpoch();

    // Initialize current epoch
    this.getOrCreateEpoch(this.currentEpochNumber);

    epochLogger.info({
      duration: this.config.duration,
      maxPointsPerEpoch: this.config.maxPointsPerEpoch,
      burnPolicy: this.config.burnUndistributed,
      currentEpoch: this.currentEpochNumber,
    }, "EpochManager initialized");
  }

  /**
   * Calculate current epoch number
   */
  calculateCurrentEpoch(): number {
    const elapsed = Date.now() - this.config.epochZeroTimestamp;
    return Math.floor(elapsed / this.config.durationMs);
  }

  /**
   * Get current epoch state
   */
  getCurrentEpoch(): EpochState {
    const epochNumber = this.calculateCurrentEpoch();
    
    // Check if we need to transition epochs
    if (epochNumber > this.currentEpochNumber) {
      this.transitionEpochs(epochNumber);
    }

    return this.getOrCreateEpoch(this.currentEpochNumber);
  }

  /**
   * Get epoch by number
   */
  getEpoch(epochNumber: number): EpochState | undefined {
    return this.epochs.get(epochNumber);
  }

  /**
   * Get or create epoch state
   */
  private getOrCreateEpoch(epochNumber: number): EpochState {
    let epoch = this.epochs.get(epochNumber);
    
    if (!epoch) {
      const startTimestamp = this.config.epochZeroTimestamp + 
        (epochNumber * this.config.durationMs);
      
      epoch = {
        epochNumber,
        startTimestamp,
        endTimestamp: startTimestamp + this.config.durationMs,
        maxPoints: this.config.maxPointsPerEpoch,
        distributedPoints: 0,
        remainingPoints: this.config.maxPointsPerEpoch,
        burnedPoints: 0,
        totalRewards: 0,
        totalUsers: 0,
        status: "active",
      };

      this.epochs.set(epochNumber, epoch);

      epochLogger.info({
        epochNumber,
        maxPoints: epoch.maxPoints,
        startsAt: new Date(startTimestamp).toISOString(),
        endsAt: new Date(epoch.endTimestamp).toISOString(),
      }, "New epoch created");
    }

    return epoch;
  }

  /**
   * Transition to new epoch(s)
   * Turkish: "Epoch sonunda dağıtılmayan puanlar asla devretmemeli (Burn policy)"
   */
  private transitionEpochs(newEpochNumber: number): void {
    epochLogger.info({
      fromEpoch: this.currentEpochNumber,
      toEpoch: newEpochNumber,
    }, "Transitioning epochs");

    // Finalize all epochs between current and new
    for (let e = this.currentEpochNumber; e < newEpochNumber; e++) {
      this.finalizeEpoch(e);
    }

    // Update current epoch
    this.currentEpochNumber = newEpochNumber;
    this.getOrCreateEpoch(newEpochNumber);
  }

  /**
   * Finalize an epoch
   * Turkish: "Burn policy"
   */
  finalizeEpoch(epochNumber: number): EpochState | undefined {
    const epoch = this.epochs.get(epochNumber);
    if (!epoch) return undefined;

    if (epoch.status === "completed" || epoch.status === "burned") {
      return epoch;
    }

    // Apply burn policy
    if (this.config.burnUndistributed && epoch.remainingPoints > 0) {
      epoch.burnedPoints = epoch.remainingPoints;
      epoch.remainingPoints = 0;
      epoch.status = "burned";

      epochLogger.warn({
        epochNumber,
        burnedPoints: epoch.burnedPoints,
      }, "Undistributed points burned");
    } else {
      epoch.status = "completed";
    }

    epoch.finalizedAt = Date.now();

    epochLogger.info({
      epochNumber,
      distributedPoints: epoch.distributedPoints,
      burnedPoints: epoch.burnedPoints,
      totalRewards: epoch.totalRewards,
      status: epoch.status,
    }, "Epoch finalized");

    return epoch;
  }

  /**
   * Check if points can be distributed
   * Turkish: "Rewards cannot exceed cap"
   */
  canDistribute(points: number, userId?: string): {
    allowed: boolean;
    reason?: string;
    epochRemaining: number;
    userRemaining?: number;
  } {
    const epoch = this.getCurrentEpoch();

    // Check epoch cap
    if (epoch.distributedPoints + points > epoch.maxPoints) {
      return {
        allowed: false,
        reason: `Epoch cap exceeded: ${epoch.distributedPoints} + ${points} > ${epoch.maxPoints}`,
        epochRemaining: epoch.remainingPoints,
      };
    }

    // Check per-action cap
    if (points > this.config.maxPointsPerAction) {
      return {
        allowed: false,
        reason: `Action cap exceeded: ${points} > ${this.config.maxPointsPerAction}`,
        epochRemaining: epoch.remainingPoints,
      };
    }

    return {
      allowed: true,
      epochRemaining: epoch.remainingPoints - points,
    };
  }

  /**
   * Reserve points for distribution
   */
  reservePoints(points: number): boolean {
    const check = this.canDistribute(points);
    if (!check.allowed) {
      return false;
    }

    const epoch = this.getCurrentEpoch();
    epoch.distributedPoints += points;
    epoch.remainingPoints -= points;

    return true;
  }

  /**
   * Release reserved points (if reward rejected)
   */
  releasePoints(points: number): void {
    const epoch = this.getCurrentEpoch();
    epoch.distributedPoints -= points;
    epoch.remainingPoints += points;
  }

  /**
   * Record a distribution
   */
  recordDistribution(record: RewardRecord): void {
    const epoch = this.getOrCreateEpoch(record.epochNumber);
    epoch.totalRewards++;
  }

  /**
   * Get time remaining in current epoch
   */
  getTimeRemaining(): number {
    const epoch = this.getCurrentEpoch();
    return Math.max(0, epoch.endTimestamp - Date.now());
  }

  /**
   * Get epoch progress
   */
  getEpochProgress(): {
    epochNumber: number;
    elapsed: number;
    remaining: number;
    progressPercent: number;
    capUsagePercent: number;
  } {
    const epoch = this.getCurrentEpoch();
    const now = Date.now();
    const elapsed = now - epoch.startTimestamp;
    const remaining = epoch.endTimestamp - now;

    return {
      epochNumber: epoch.epochNumber,
      elapsed,
      remaining: Math.max(0, remaining),
      progressPercent: Math.min(100, (elapsed / this.config.durationMs) * 100),
      capUsagePercent: (epoch.distributedPoints / epoch.maxPoints) * 100,
    };
  }

  /**
   * Get historical epochs
   */
  getEpochHistory(limit = 10): EpochState[] {
    const epochs = Array.from(this.epochs.values())
      .filter(e => e.status !== "active")
      .sort((a, b) => b.epochNumber - a.epochNumber)
      .slice(0, limit);

    return epochs;
  }

  /**
   * Get burn forecast for current epoch
   * Turkish: "Burn policy"
   */
  getBurnForecast(): {
    currentRemaining: number;
    projectedBurn: number;
    timeRemaining: number;
    distributionRate: number;
  } {
    const epoch = this.getCurrentEpoch();
    const elapsed = Date.now() - epoch.startTimestamp;
    const remaining = this.getTimeRemaining();

    // Calculate distribution rate (points per ms)
    const distributionRate = elapsed > 0 
      ? epoch.distributedPoints / elapsed 
      : 0;

    // Project remaining distributions
    const projectedDistributions = distributionRate * remaining;
    const projectedBurn = Math.max(
      0, 
      epoch.remainingPoints - projectedDistributions
    );

    return {
      currentRemaining: epoch.remainingPoints,
      projectedBurn: Math.floor(projectedBurn),
      timeRemaining: remaining,
      distributionRate,
    };
  }
}

/**
 * Factory function
 */
export function createEpochManager(
  config?: Partial<EpochConfig>
): EpochManager {
  return new EpochManager(config);
}
