/**
 * Reputation System
 * 
 * Manages user reputation with:
 * - Tier-based multipliers
 * - Proof of Reputation scoring
 * - Anti-gaming penalties
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as crypto from "crypto";
import type {
  UserReputation,
  ReputationTier,
  PenaltyType,
  PenaltyConfig,
  RewardRecord,
} from "./types.js";
import {
  REPUTATION_TIERS,
  DEFAULT_PENALTY_CONFIGS,
  UserSuspendedError,
} from "./types.js";

const reputationLogger = logger.child({ component: "reputation-system" });

// ============================================
// REPUTATION CALCULATOR
// ============================================

export interface ReputationFactors {
  // Base factors
  totalActions: number;
  totalPoints: number;
  
  // Quality factors
  accuracyRate: number; // 0-1
  verificationRate: number; // 0-1
  
  // Time factors
  accountAge: number; // days
  consecutiveActiveEpochs: number;
  
  // Negative factors
  penaltyCount: number;
  rejectedActions: number;
}

export function calculateReputationScore(factors: ReputationFactors): number {
  let score = 0;

  // Base score from actions (diminishing returns)
  score += Math.sqrt(factors.totalActions) * 10;

  // Points contribution (diminishing returns)
  score += Math.sqrt(factors.totalPoints) * 0.1;

  // Accuracy bonus (multiplicative)
  // Turkish: "tutarlı ve doğru veri sağlayanların"
  const accuracyMultiplier = 0.5 + (factors.accuracyRate * 1.5); // 0.5x to 2x
  score *= accuracyMultiplier;

  // Verification bonus
  score += factors.verificationRate * 50;

  // Account age bonus (logarithmic)
  score += Math.log10(factors.accountAge + 1) * 25;

  // Consecutive activity bonus
  score += factors.consecutiveActiveEpochs * 5;

  // Penalty deductions
  score -= factors.penaltyCount * 50;
  score -= factors.rejectedActions * 10;

  return Math.max(0, Math.floor(score));
}

// ============================================
// REPUTATION MANAGER
// ============================================

export class ReputationManager {
  private readonly tiers: ReputationTier[];
  private readonly penaltyConfigs: Map<PenaltyType, PenaltyConfig>;
  private readonly users: Map<string, UserReputation> = new Map();

  // Track user actions for accuracy calculation
  private readonly userActions: Map<string, {
    totalVerified: number;
    totalRejected: number;
    lastActions: Array<{ timestamp: number; verified: boolean }>;
  }> = new Map();

  constructor(
    tiers?: ReputationTier[],
    penaltyConfigs?: PenaltyConfig[]
  ) {
    this.tiers = tiers || REPUTATION_TIERS;
    
    this.penaltyConfigs = new Map();
    for (const config of penaltyConfigs || DEFAULT_PENALTY_CONFIGS) {
      this.penaltyConfigs.set(config.type, config);
    }

    reputationLogger.info({
      tierCount: this.tiers.length,
      penaltyTypes: this.penaltyConfigs.size,
    }, "ReputationManager initialized");
  }

  /**
   * Get or create user reputation
   */
  getUser(userId: string, address: string): UserReputation {
    let user = this.users.get(userId);
    
    if (!user) {
      user = {
        userId,
        address,
        reputationScore: 0,
        tier: 0,
        multiplier: this.tiers[0].multiplier,
        totalPointsEarned: 0,
        totalActionsCompleted: 0,
        accuracyRate: 1.0, // Start with perfect accuracy
        penaltyCount: 0,
        isSuspended: false,
        joinedAt: Date.now(),
        lastActionAt: 0,
        updatedAt: Date.now(),
      };
      this.users.set(userId, user);
      
      reputationLogger.debug({ userId, address }, "New user created");
    }

    // Check suspension status
    if (user.isSuspended && user.suspendedUntil && user.suspendedUntil < Date.now()) {
      user.isSuspended = false;
      user.suspendedUntil = undefined;
      reputationLogger.info({ userId }, "User suspension expired");
    }

    return user;
  }

  /**
   * Get user's current multiplier
   * Turkish: "puan çarpanı zamanla artmalı (Proof of Reputation)"
   */
  getMultiplier(userId: string): number {
    const user = this.users.get(userId);
    return user?.multiplier ?? this.tiers[0].multiplier;
  }

  /**
   * Check if user is allowed to earn rewards
   */
  canEarnRewards(userId: string): {
    allowed: boolean;
    reason?: string;
    suspendedUntil?: number;
  } {
    const user = this.users.get(userId);
    
    if (!user) {
      return { allowed: true };
    }

    if (user.isSuspended) {
      return {
        allowed: false,
        reason: "User is suspended",
        suspendedUntil: user.suspendedUntil,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a successful action
   */
  recordAction(
    userId: string,
    address: string,
    record: RewardRecord
  ): void {
    const user = this.getUser(userId, address);

    // Update counts
    user.totalActionsCompleted++;
    user.totalPointsEarned += record.finalPoints;
    user.lastActionAt = Date.now();
    user.updatedAt = Date.now();

    // Track for accuracy
    let actions = this.userActions.get(userId);
    if (!actions) {
      actions = { totalVerified: 0, totalRejected: 0, lastActions: [] };
      this.userActions.set(userId, actions);
    }

    if (record.status === "verified" || record.status === "distributed") {
      actions.totalVerified++;
      actions.lastActions.push({ timestamp: Date.now(), verified: true });
    }

    // Keep last 100 actions
    if (actions.lastActions.length > 100) {
      actions.lastActions = actions.lastActions.slice(-100);
    }

    // Update accuracy rate
    const totalActions = actions.totalVerified + actions.totalRejected;
    user.accuracyRate = totalActions > 0 
      ? actions.totalVerified / totalActions 
      : 1.0;

    // Recalculate reputation
    this.updateReputation(userId);

    reputationLogger.debug({
      userId,
      points: record.finalPoints,
      newTotal: user.totalPointsEarned,
      accuracy: user.accuracyRate,
    }, "Action recorded");
  }

  /**
   * Apply penalty to user
   * Turkish: "penalty_logic ekle"
   */
  applyPenalty(
    userId: string,
    penaltyType: PenaltyType,
    reason: string
  ): {
    pointsDeducted: number;
    reputationDeducted: number;
    suspended: boolean;
    suspendedUntil?: number;
  } {
    const config = this.penaltyConfigs.get(penaltyType);
    if (!config) {
      throw new Error(`Unknown penalty type: ${penaltyType}`);
    }

    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // Deduct points
    const pointsDeducted = Math.min(config.pointsDeduction, user.totalPointsEarned);
    user.totalPointsEarned -= pointsDeducted;

    // Deduct reputation
    user.reputationScore = Math.max(0, user.reputationScore - config.reputationDeduction);

    // Increment penalty count
    user.penaltyCount++;

    // Track rejection
    let actions = this.userActions.get(userId);
    if (!actions) {
      actions = { totalVerified: 0, totalRejected: 0, lastActions: [] };
      this.userActions.set(userId, actions);
    }
    actions.totalRejected++;
    actions.lastActions.push({ timestamp: Date.now(), verified: false });

    // Update accuracy
    const totalActions = actions.totalVerified + actions.totalRejected;
    user.accuracyRate = totalActions > 0 
      ? actions.totalVerified / totalActions 
      : 0;

    // Apply suspension if configured
    let suspendedUntil: number | undefined;
    if (config.suspensionDurationMs) {
      user.isSuspended = true;
      suspendedUntil = Date.now() + config.suspensionDurationMs;
      user.suspendedUntil = suspendedUntil;
    }

    // Recalculate tier
    this.updateReputation(userId);

    user.updatedAt = Date.now();

    reputationLogger.warn({
      userId,
      penaltyType,
      reason,
      pointsDeducted,
      reputationDeducted: config.reputationDeduction,
      suspended: user.isSuspended,
      newPenaltyCount: user.penaltyCount,
    }, "Penalty applied");

    return {
      pointsDeducted,
      reputationDeducted: config.reputationDeduction,
      suspended: user.isSuspended,
      suspendedUntil,
    };
  }

  /**
   * Update user reputation and tier
   */
  updateReputation(userId: string): void {
    const user = this.users.get(userId);
    if (!user) return;

    const actions = this.userActions.get(userId);
    
    // Calculate new reputation score
    const factors: ReputationFactors = {
      totalActions: user.totalActionsCompleted,
      totalPoints: user.totalPointsEarned,
      accuracyRate: user.accuracyRate,
      verificationRate: actions 
        ? actions.totalVerified / Math.max(1, actions.totalVerified + actions.totalRejected)
        : 1.0,
      accountAge: (Date.now() - user.joinedAt) / 86400000, // days
      consecutiveActiveEpochs: 0, // TODO: Track this
      penaltyCount: user.penaltyCount,
      rejectedActions: actions?.totalRejected || 0,
    };

    user.reputationScore = calculateReputationScore(factors);

    // Find matching tier
    let newTier = 0;
    for (let i = this.tiers.length - 1; i >= 0; i--) {
      if (user.reputationScore >= this.tiers[i].minScore) {
        newTier = i;
        break;
      }
    }

    // Check for tier change
    if (newTier !== user.tier) {
      const oldTier = this.tiers[user.tier];
      const newTierInfo = this.tiers[newTier];

      reputationLogger.info({
        userId,
        oldTier: oldTier.name,
        newTier: newTierInfo.name,
        oldMultiplier: oldTier.multiplier,
        newMultiplier: newTierInfo.multiplier,
        reputationScore: user.reputationScore,
      }, newTier > user.tier ? "User tier upgraded" : "User tier downgraded");
    }

    user.tier = newTier;
    user.multiplier = this.tiers[newTier].multiplier;
    user.updatedAt = Date.now();
  }

  /**
   * Get reputation tier info
   */
  getTierInfo(tier: number): ReputationTier {
    return this.tiers[tier] || this.tiers[0];
  }

  /**
   * Get all tiers
   */
  getAllTiers(): ReputationTier[] {
    return [...this.tiers];
  }

  /**
   * Get leaderboard
   */
  getLeaderboard(limit = 10): UserReputation[] {
    return Array.from(this.users.values())
      .filter(u => !u.isSuspended)
      .sort((a, b) => b.reputationScore - a.reputationScore)
      .slice(0, limit);
  }

  /**
   * Lift suspension manually
   */
  liftSuspension(userId: string): boolean {
    const user = this.users.get(userId);
    if (!user || !user.isSuspended) {
      return false;
    }

    user.isSuspended = false;
    user.suspendedUntil = undefined;
    user.updatedAt = Date.now();

    reputationLogger.info({ userId }, "Suspension lifted manually");
    return true;
  }
}

/**
 * Factory function
 */
export function createReputationManager(
  tiers?: ReputationTier[],
  penaltyConfigs?: PenaltyConfig[]
): ReputationManager {
  return new ReputationManager(tiers, penaltyConfigs);
}
