/**
 * Reward Distribution Service
 * 
 * Orchestrates the reward system:
 * - Action submission and verification
 * - Points calculation with reputation multiplier
 * - Epoch cap enforcement
 * - Audit logging
 * - Dashboard data
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as crypto from "crypto";
import type {
  EligibleActionType,
  ActionConfig,
  RewardRecord,
  ProofOfAction,
  UserRewardSummary,
  EpochDashboardData,
  EpochConfig,
} from "./types.js";
import {
  DEFAULT_ACTION_CONFIGS,
  RewardCapExceededError,
  UserSuspendedError,
  ActionNotAllowedError,
  CooldownActiveError,
} from "./types.js";
import { EpochManager, createEpochManager } from "./epoch-manager.js";
import { ReputationManager, createReputationManager } from "./reputation-system.js";
import {
  type RewardOracle,
  type VerificationRequest,
  createOracleFromEnv,
} from "./oracle.js";

const serviceLogger = logger.child({ component: "reward-service" });

// ============================================
// REWARD SERVICE CONFIGURATION
// ============================================

export interface RewardServiceConfig {
  // Enable/disable entire module
  enabled: boolean;
  
  // Epoch config
  epochConfig?: Partial<EpochConfig>;
  
  // Action configs
  actionConfigs?: ActionConfig[];
  
  // Verification
  requireVerification: boolean;
  verificationTimeoutMs: number;
}

const DEFAULT_SERVICE_CONFIG: RewardServiceConfig = {
  enabled: true,
  requireVerification: true,
  verificationTimeoutMs: 30000,
};

// ============================================
// REWARD ACTION REQUEST
// ============================================

export interface RewardActionRequest {
  // Who
  userId: string;
  address: string;
  
  // What
  actionType: EligibleActionType;
  
  // Evidence
  // Turkish: "Proof of Action (Evidence Hash)"
  evidenceType: ProofOfAction["evidenceType"];
  evidenceUrl?: string;
  evidenceData?: unknown;
  
  // Context
  context?: Record<string, unknown>;
  
  // Metadata
  metadata?: Record<string, unknown>;
}

// ============================================
// REWARD SERVICE
// ============================================

export class RewardService {
  private readonly config: RewardServiceConfig;
  private readonly epochManager: EpochManager;
  private readonly reputationManager: ReputationManager;
  private readonly oracle: RewardOracle;
  private readonly actionConfigs: Map<EligibleActionType, ActionConfig>;
  
  // Reward records
  private readonly records: Map<string, RewardRecord> = new Map();
  
  // User action tracking for cooldowns
  private readonly userLastAction: Map<string, Map<EligibleActionType, number>> = new Map();
  
  // User epoch points tracking
  private readonly userEpochPoints: Map<string, Map<number, number>> = new Map();

  constructor(
    config?: Partial<RewardServiceConfig>,
    oracle?: RewardOracle
  ) {
    this.config = { ...DEFAULT_SERVICE_CONFIG, ...config };

    this.epochManager = createEpochManager(this.config.epochConfig);
    this.reputationManager = createReputationManager();
    this.oracle = oracle || createOracleFromEnv();

    // Build action config map
    this.actionConfigs = new Map();
    for (const config of this.config.actionConfigs || DEFAULT_ACTION_CONFIGS) {
      this.actionConfigs.set(config.type, config);
    }

    serviceLogger.info({
      enabled: this.config.enabled,
      actionTypes: this.actionConfigs.size,
      oracleName: this.oracle.name,
    }, "RewardService initialized");
  }

  /**
   * Submit an action for reward
   */
  async submitAction(request: RewardActionRequest): Promise<RewardRecord> {
    if (!this.config.enabled) {
      throw new Error("Reward module is disabled");
    }

    const startTime = Date.now();
    const recordId = crypto.randomUUID();

    // Get action config
    const actionConfig = this.actionConfigs.get(request.actionType);
    if (!actionConfig || !actionConfig.enabled) {
      throw new ActionNotAllowedError(
        `Action type not allowed: ${request.actionType}`,
        request.actionType
      );
    }

    // Check user can earn rewards
    const canEarn = this.reputationManager.canEarnRewards(request.userId);
    if (!canEarn.allowed) {
      throw new UserSuspendedError(
        canEarn.reason || "User cannot earn rewards",
        request.userId,
        canEarn.suspendedUntil || 0
      );
    }

    // Check cooldown
    this.checkCooldown(request.userId, request.actionType, actionConfig);

    // Check epoch caps
    const epoch = this.epochManager.getCurrentEpoch();
    const userEpochKey = `${request.userId}:${epoch.epochNumber}`;
    const userCurrentPoints = this.getUserEpochPoints(request.userId, epoch.epochNumber);

    // Get reputation multiplier
    // Turkish: "puan çarpanı"
    const multiplier = this.reputationManager.getMultiplier(request.userId);
    const basePoints = actionConfig.basePoints;
    const finalPoints = Math.floor(basePoints * multiplier);

    // Check caps
    // Acceptance criteria: "Rewards cannot exceed cap"
    const canDistribute = this.epochManager.canDistribute(finalPoints, request.userId);
    if (!canDistribute.allowed) {
      throw new RewardCapExceededError(
        canDistribute.reason || "Cap exceeded",
        epoch.maxPoints,
        epoch.distributedPoints,
        finalPoints
      );
    }

    // Check user epoch cap
    if (userCurrentPoints + finalPoints > this.config.epochConfig?.maxPointsPerUser! || 
        userCurrentPoints + finalPoints > actionConfig.maxPerUser * actionConfig.basePoints * multiplier) {
      throw new RewardCapExceededError(
        "User epoch cap exceeded",
        actionConfig.maxPerUser * actionConfig.basePoints,
        userCurrentPoints,
        finalPoints
      );
    }

    // Create verification request
    const verificationRequest: VerificationRequest = {
      actionType: request.actionType,
      userId: request.userId,
      address: request.address,
      evidenceType: request.evidenceType,
      evidenceUrl: request.evidenceUrl,
      evidenceData: request.evidenceData,
      context: request.context,
      requestId: recordId,
      timestamp: startTime,
    };

    // Verify with oracle (if required)
    let proof: ProofOfAction;
    let oracleVerified = false;
    let oracleResponse: unknown;

    if (this.config.requireVerification && actionConfig.requiresEvidence) {
      const verification = await Promise.race([
        this.oracle.verify(verificationRequest),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error("Verification timeout")), this.config.verificationTimeoutMs)
        ),
      ]);

      proof = {
        evidenceHash: verification.evidenceHash,
        evidenceType: request.evidenceType,
        evidenceUrl: request.evidenceUrl,
        verified: verification.verified,
        verifiedAt: verification.verifiedAt,
        verifiedBy: this.oracle.name,
      };

      oracleVerified = verification.verified;
      oracleResponse = verification.details;

      if (!verification.verified) {
        // Apply penalty for unverified action
        // Turkish: "penalty_logic"
        this.reputationManager.applyPenalty(
          request.userId,
          "invalid_data",
          `Action verification failed: ${verification.reason}`
        );

        throw new Error(`Verification failed: ${verification.reason}`);
      }
    } else {
      // No verification required - create proof without oracle
      const evidenceString = JSON.stringify({
        userId: request.userId,
        actionType: request.actionType,
        evidenceUrl: request.evidenceUrl,
        timestamp: startTime,
      });

      proof = {
        evidenceHash: crypto.createHash("sha256").update(evidenceString).digest("hex"),
        evidenceType: request.evidenceType,
        evidenceUrl: request.evidenceUrl,
        verified: false,
      };
    }

    // Reserve points in epoch
    this.epochManager.reservePoints(finalPoints);

    // Create reward record
    // Turkish: "Every distribution is explainable and auditable"
    const record: RewardRecord = {
      id: recordId,
      userId: request.userId,
      address: request.address,
      actionType: request.actionType,
      basePoints,
      multiplier,
      finalPoints,
      epochNumber: epoch.epochNumber,
      timestamp: Date.now(),
      reason: `${actionConfig.description} (${multiplier}x multiplier)`,
      details: {
        actionConfig: actionConfig.type,
        basePoints,
        multiplier,
        userReputation: this.reputationManager.getUser(request.userId, request.address).reputationScore,
        ...request.metadata,
      },
      proof,
      status: oracleVerified ? "verified" : "pending",
      oracleVerified,
      oracleResponse,
    };

    // Store record
    this.records.set(recordId, record);

    // Update user tracking
    this.recordUserAction(request.userId, request.actionType, epoch.epochNumber, finalPoints);

    // Update reputation
    this.reputationManager.recordAction(request.userId, request.address, record);

    // Record in epoch
    this.epochManager.recordDistribution(record);

    serviceLogger.info({
      recordId,
      userId: request.userId,
      actionType: request.actionType,
      basePoints,
      multiplier,
      finalPoints,
      epochNumber: epoch.epochNumber,
      verified: oracleVerified,
    }, "Reward distributed");

    return record;
  }

  /**
   * Get user reward summary for dashboard
   * Turkish: "who earned what, why"
   */
  getUserSummary(userId: string, address: string): UserRewardSummary {
    const epoch = this.epochManager.getCurrentEpoch();
    const user = this.reputationManager.getUser(userId, address);
    const currentEpochPoints = this.getUserEpochPoints(userId, epoch.epochNumber);

    // Get recent rewards
    const recentRewards = Array.from(this.records.values())
      .filter(r => r.userId === userId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10)
      .map(r => ({
        actionType: r.actionType,
        points: r.finalPoints,
        reason: r.reason,
        timestamp: r.timestamp,
      }));

    const maxPerUser = this.config.epochConfig?.maxPointsPerUser || 10000;

    return {
      userId,
      address,
      currentEpochPoints,
      currentEpochCap: maxPerUser,
      currentEpochCapUsage: (currentEpochPoints / maxPerUser) * 100,
      reputationTier: this.reputationManager.getTierInfo(user.tier).name,
      multiplier: user.multiplier,
      totalPointsAllTime: user.totalPointsEarned,
      totalActionsAllTime: user.totalActionsCompleted,
      recentRewards,
    };
  }

  /**
   * Get epoch dashboard data
   * Turkish: "cap usage"
   */
  getEpochDashboard(): EpochDashboardData {
    const epoch = this.epochManager.getCurrentEpoch();
    const progress = this.epochManager.getEpochProgress();
    const burnForecast = this.epochManager.getBurnForecast();

    // Get top earners
    const userPoints = new Map<string, { points: number; actions: number; address: string }>();
    
    for (const record of this.records.values()) {
      if (record.epochNumber === epoch.epochNumber) {
        const existing = userPoints.get(record.userId) || { points: 0, actions: 0, address: record.address };
        existing.points += record.finalPoints;
        existing.actions++;
        userPoints.set(record.userId, existing);
      }
    }

    const topEarners = Array.from(userPoints.entries())
      .map(([_, data]) => ({
        address: data.address,
        points: data.points,
        actionCount: data.actions,
      }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 10);

    // Get action breakdown
    const actionStats = new Map<EligibleActionType, { total: number; count: number }>();
    
    for (const record of this.records.values()) {
      if (record.epochNumber === epoch.epochNumber) {
        const existing = actionStats.get(record.actionType) || { total: 0, count: 0 };
        existing.total += record.finalPoints;
        existing.count++;
        actionStats.set(record.actionType, existing);
      }
    }

    const actionBreakdown = Array.from(actionStats.entries())
      .map(([actionType, stats]) => ({
        actionType,
        totalPoints: stats.total,
        totalCount: stats.count,
        averagePoints: stats.count > 0 ? Math.round(stats.total / stats.count) : 0,
      }))
      .sort((a, b) => b.totalPoints - a.totalPoints);

    return {
      epochNumber: epoch.epochNumber,
      timeRemaining: progress.remaining,
      totalCap: epoch.maxPoints,
      distributed: epoch.distributedPoints,
      remaining: epoch.remainingPoints,
      usagePercent: progress.capUsagePercent,
      topEarners,
      actionBreakdown,
      burnForecast: burnForecast.projectedBurn,
    };
  }

  /**
   * Get reward record by ID
   */
  getRecord(recordId: string): RewardRecord | undefined {
    return this.records.get(recordId);
  }

  /**
   * Get user records
   */
  getUserRecords(userId: string, limit = 100): RewardRecord[] {
    return Array.from(this.records.values())
      .filter(r => r.userId === userId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Export audit data
   * Turkish: "Every distribution is explainable and auditable"
   */
  exportAuditData(epochNumber?: number): {
    epoch: number;
    records: RewardRecord[];
    totalDistributed: number;
    totalBurned: number;
    uniqueUsers: number;
  } {
    const targetEpoch = epochNumber ?? this.epochManager.getCurrentEpoch().epochNumber;
    const epochState = this.epochManager.getEpoch(targetEpoch);

    const records = Array.from(this.records.values())
      .filter(r => r.epochNumber === targetEpoch);

    const uniqueUsers = new Set(records.map(r => r.userId)).size;

    return {
      epoch: targetEpoch,
      records,
      totalDistributed: epochState?.distributedPoints || 0,
      totalBurned: epochState?.burnedPoints || 0,
      uniqueUsers,
    };
  }

  /**
   * Check if module is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private checkCooldown(
    userId: string,
    actionType: EligibleActionType,
    config: ActionConfig
  ): void {
    if (config.cooldownMs === 0) return;

    const userActions = this.userLastAction.get(userId);
    if (!userActions) return;

    const lastAction = userActions.get(actionType);
    if (!lastAction) return;

    const elapsed = Date.now() - lastAction;
    if (elapsed < config.cooldownMs) {
      throw new CooldownActiveError(
        `Cooldown active: ${Math.ceil((config.cooldownMs - elapsed) / 1000)}s remaining`,
        actionType,
        lastAction + config.cooldownMs
      );
    }
  }

  private recordUserAction(
    userId: string,
    actionType: EligibleActionType,
    epochNumber: number,
    points: number
  ): void {
    // Record last action time
    let userActions = this.userLastAction.get(userId);
    if (!userActions) {
      userActions = new Map();
      this.userLastAction.set(userId, userActions);
    }
    userActions.set(actionType, Date.now());

    // Record epoch points
    const key = `${userId}:${epochNumber}`;
    let epochPoints = this.userEpochPoints.get(userId);
    if (!epochPoints) {
      epochPoints = new Map();
      this.userEpochPoints.set(userId, epochPoints);
    }
    const current = epochPoints.get(epochNumber) || 0;
    epochPoints.set(epochNumber, current + points);
  }

  private getUserEpochPoints(userId: string, epochNumber: number): number {
    const epochPoints = this.userEpochPoints.get(userId);
    return epochPoints?.get(epochNumber) || 0;
  }
}

/**
 * Factory function
 */
export function createRewardService(
  config?: Partial<RewardServiceConfig>,
  oracle?: RewardOracle
): RewardService {
  return new RewardService(config, oracle);
}
