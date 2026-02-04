/**
 * Reward System Types
 * 
 * Types for the optional reward module with:
 * - Epoch-based caps
 * - Reputation weighting
 * - Anti-gaming penalties
 * - Proof of action
 * - Audit trail
 */

import { z } from "zod";

// ============================================
// EPOCH CONFIGURATION
// ============================================

/**
 * Epoch duration options
 */
export type EpochDuration = "hourly" | "daily" | "weekly" | "monthly";

/**
 * Epoch configuration
 */
export interface EpochConfig {
  duration: EpochDuration;
  durationMs: number;
  
  // Caps
  // Turkish: "strictly capped per epoch"
  maxPointsPerEpoch: number;
  maxPointsPerUser: number;
  maxPointsPerAction: number;
  
  // Burn policy
  // Turkish: "Epoch sonunda dağıtılmayan puanlar asla devretmemeli (Burn policy)"
  burnUndistributed: boolean;
  
  // Start time
  epochZeroTimestamp: number;
}

export const DEFAULT_EPOCH_CONFIG: EpochConfig = {
  duration: "weekly",
  durationMs: 7 * 24 * 60 * 60 * 1000, // 1 week
  maxPointsPerEpoch: 1_000_000,
  maxPointsPerUser: 10_000,
  maxPointsPerAction: 1_000,
  burnUndistributed: true,
  epochZeroTimestamp: Date.now(),
};

// ============================================
// ELIGIBLE ACTIONS
// ============================================

/**
 * Actions that can earn rewards
 */
export type EligibleActionType =
  | "signal_submission"      // Submitting valid trading signals
  | "signal_verification"    // Verifying other signals
  | "early_detection"        // Early trend detection
  | "accurate_prediction"    // Correct market prediction
  | "liquidity_provision"    // Providing liquidity
  | "community_contribution" // Community building
  | "bug_report"            // Reporting bugs
  | "data_contribution"     // Contributing training data
  | "referral";             // Referring new users

/**
 * Action configuration
 */
export interface ActionConfig {
  type: EligibleActionType;
  enabled: boolean;
  
  // Base points
  basePoints: number;
  
  // Limits
  maxPerEpoch: number;
  maxPerUser: number;
  
  // Cooldown
  cooldownMs: number;
  
  // Requires evidence
  requiresEvidence: boolean;
  
  // Description for dashboard
  description: string;
}

/**
 * Default action configurations
 */
export const DEFAULT_ACTION_CONFIGS: ActionConfig[] = [
  {
    type: "signal_submission",
    enabled: true,
    basePoints: 50,
    maxPerEpoch: 10000,
    maxPerUser: 100,
    cooldownMs: 60000, // 1 minute
    requiresEvidence: true,
    description: "Submit valid trading signals",
  },
  {
    type: "signal_verification",
    enabled: true,
    basePoints: 10,
    maxPerEpoch: 50000,
    maxPerUser: 500,
    cooldownMs: 10000,
    requiresEvidence: true,
    description: "Verify other users' signals",
  },
  {
    type: "early_detection",
    enabled: true,
    basePoints: 200,
    maxPerEpoch: 1000,
    maxPerUser: 20,
    cooldownMs: 300000, // 5 minutes
    requiresEvidence: true,
    description: "Early detection of market trends",
  },
  {
    type: "accurate_prediction",
    enabled: true,
    basePoints: 100,
    maxPerEpoch: 5000,
    maxPerUser: 50,
    cooldownMs: 0,
    requiresEvidence: true,
    description: "Accurate market predictions",
  },
  {
    type: "liquidity_provision",
    enabled: true,
    basePoints: 25,
    maxPerEpoch: 20000,
    maxPerUser: 200,
    cooldownMs: 0,
    requiresEvidence: true,
    description: "Providing liquidity to pools",
  },
  {
    type: "community_contribution",
    enabled: true,
    basePoints: 30,
    maxPerEpoch: 5000,
    maxPerUser: 50,
    cooldownMs: 3600000, // 1 hour
    requiresEvidence: true,
    description: "Community building activities",
  },
  {
    type: "bug_report",
    enabled: true,
    basePoints: 500,
    maxPerEpoch: 100,
    maxPerUser: 10,
    cooldownMs: 86400000, // 1 day
    requiresEvidence: true,
    description: "Valid bug reports",
  },
  {
    type: "data_contribution",
    enabled: true,
    basePoints: 75,
    maxPerEpoch: 10000,
    maxPerUser: 100,
    cooldownMs: 60000,
    requiresEvidence: true,
    description: "Contributing training data",
  },
  {
    type: "referral",
    enabled: true,
    basePoints: 100,
    maxPerEpoch: 1000,
    maxPerUser: 20,
    cooldownMs: 0,
    requiresEvidence: true,
    description: "Referring new users",
  },
];

// ============================================
// REPUTATION SYSTEM
// ============================================

/**
 * Reputation tier with multiplier
 * Turkish: "geçmişte tutarlı ve doğru veri sağlayanların puan çarpanı zamanla artmalı"
 */
export interface ReputationTier {
  tier: number;
  name: string;
  minScore: number;
  multiplier: number;
  benefits: string[];
}

export const REPUTATION_TIERS: ReputationTier[] = [
  {
    tier: 0,
    name: "Newcomer",
    minScore: 0,
    multiplier: 1.0,
    benefits: ["Basic rewards"],
  },
  {
    tier: 1,
    name: "Contributor",
    minScore: 100,
    multiplier: 1.1,
    benefits: ["10% bonus", "Early access"],
  },
  {
    tier: 2,
    name: "Trusted",
    minScore: 500,
    multiplier: 1.25,
    benefits: ["25% bonus", "Priority processing"],
  },
  {
    tier: 3,
    name: "Expert",
    minScore: 2000,
    multiplier: 1.5,
    benefits: ["50% bonus", "Governance voice"],
  },
  {
    tier: 4,
    name: "Oracle",
    minScore: 10000,
    multiplier: 2.0,
    benefits: ["100% bonus", "Verification power"],
  },
];

/**
 * User reputation profile
 */
export interface UserReputation {
  userId: string;
  address: string;
  
  // Current state
  reputationScore: number;
  tier: number;
  multiplier: number;
  
  // History
  totalPointsEarned: number;
  totalActionsCompleted: number;
  accuracyRate: number;
  
  // Penalties
  // Turkish: "penalty_logic"
  penaltyCount: number;
  isSuspended: boolean;
  suspendedUntil?: number;
  
  // Timestamps
  joinedAt: number;
  lastActionAt: number;
  updatedAt: number;
}

// ============================================
// PENALTY SYSTEM
// ============================================

/**
 * Penalty types
 * Turkish: "Hatalı veya kötü niyetli veri sağlayan kullanıcıların puanlarının düşürülmesi"
 */
export type PenaltyType =
  | "invalid_data"       // Submitting invalid data
  | "duplicate_submission" // Duplicate submissions
  | "spam"               // Spam behavior
  | "manipulation"       // Market manipulation attempt
  | "false_evidence"     // Fake evidence
  | "sybil_attack";      // Multiple account abuse

export interface PenaltyConfig {
  type: PenaltyType;
  pointsDeduction: number;
  reputationDeduction: number;
  suspensionDurationMs?: number; // If set, suspends user
  description: string;
}

export const DEFAULT_PENALTY_CONFIGS: PenaltyConfig[] = [
  {
    type: "invalid_data",
    pointsDeduction: 50,
    reputationDeduction: 10,
    description: "Submitting invalid or incorrect data",
  },
  {
    type: "duplicate_submission",
    pointsDeduction: 25,
    reputationDeduction: 5,
    description: "Duplicate submission detected",
  },
  {
    type: "spam",
    pointsDeduction: 100,
    reputationDeduction: 25,
    suspensionDurationMs: 86400000, // 1 day
    description: "Spam behavior detected",
  },
  {
    type: "manipulation",
    pointsDeduction: 500,
    reputationDeduction: 100,
    suspensionDurationMs: 604800000, // 1 week
    description: "Market manipulation attempt",
  },
  {
    type: "false_evidence",
    pointsDeduction: 200,
    reputationDeduction: 50,
    suspensionDurationMs: 259200000, // 3 days
    description: "Providing false or fake evidence",
  },
  {
    type: "sybil_attack",
    pointsDeduction: 1000,
    reputationDeduction: 500,
    suspensionDurationMs: 2592000000, // 30 days
    description: "Multiple account abuse detected",
  },
];

// ============================================
// REWARD RECORD
// ============================================

/**
 * Proof of action
 * Turkish: "Her ödül kaydı, o aksiyonu kanıtlayan bir verinin SHA-256 özetini içermeli"
 */
export interface ProofOfAction {
  // Evidence hash
  evidenceHash: string; // SHA-256 of evidence
  
  // Evidence type
  evidenceType: "tweet_url" | "tx_hash" | "ipfs_cid" | "api_response" | "other";
  
  // Original evidence (optional, may be stored separately)
  evidenceUrl?: string;
  
  // Verification
  verified: boolean;
  verifiedAt?: number;
  verifiedBy?: string;
}

/**
 * Individual reward record
 */
export interface RewardRecord {
  id: string;
  
  // Who
  userId: string;
  address: string;
  
  // What
  actionType: EligibleActionType;
  
  // How much
  basePoints: number;
  multiplier: number;
  finalPoints: number;
  
  // When
  epochNumber: number;
  timestamp: number;
  
  // Why (explainability)
  // Turkish: "Every distribution is explainable"
  reason: string;
  details: Record<string, unknown>;
  
  // Proof
  // Turkish: "Proof of Action (Evidence Hash)"
  proof: ProofOfAction;
  
  // Status
  status: "pending" | "verified" | "distributed" | "rejected" | "burned";
  
  // Oracle verification
  oracleVerified?: boolean;
  oracleResponse?: unknown;
}

// ============================================
// EPOCH STATE
// ============================================

/**
 * Epoch summary
 */
export interface EpochState {
  epochNumber: number;
  
  // Time
  startTimestamp: number;
  endTimestamp: number;
  
  // Points
  maxPoints: number;
  distributedPoints: number;
  remainingPoints: number;
  
  // Burned points (if burn policy enabled)
  // Turkish: "Burn policy"
  burnedPoints: number;
  
  // Counts
  totalRewards: number;
  totalUsers: number;
  
  // Status
  status: "active" | "completed" | "burned";
  
  // Finalized
  finalizedAt?: number;
}

// ============================================
// DASHBOARD DATA
// ============================================

/**
 * User reward summary for dashboard
 * Turkish: "who earned what, why, and cap usage"
 */
export interface UserRewardSummary {
  userId: string;
  address: string;
  
  // Current epoch
  currentEpochPoints: number;
  currentEpochCap: number;
  currentEpochCapUsage: number; // percentage
  
  // Reputation
  reputationTier: string;
  multiplier: number;
  
  // History
  totalPointsAllTime: number;
  totalActionsAllTime: number;
  
  // Recent rewards
  recentRewards: Array<{
    actionType: EligibleActionType;
    points: number;
    reason: string;
    timestamp: number;
  }>;
}

/**
 * Epoch summary for dashboard
 */
export interface EpochDashboardData {
  epochNumber: number;
  timeRemaining: number;
  
  // Cap usage
  totalCap: number;
  distributed: number;
  remaining: number;
  usagePercent: number;
  
  // Top earners
  topEarners: Array<{
    address: string;
    points: number;
    actionCount: number;
  }>;
  
  // Action breakdown
  actionBreakdown: Array<{
    actionType: EligibleActionType;
    totalPoints: number;
    totalCount: number;
    averagePoints: number;
  }>;
  
  // Burn forecast (if burn policy)
  burnForecast: number;
}

// ============================================
// ERROR TYPES
// ============================================

export class RewardCapExceededError extends Error {
  constructor(
    message: string,
    public readonly cap: number,
    public readonly current: number,
    public readonly requested: number
  ) {
    super(message);
    this.name = "RewardCapExceededError";
  }
}

export class UserSuspendedError extends Error {
  constructor(
    message: string,
    public readonly userId: string,
    public readonly suspendedUntil: number
  ) {
    super(message);
    this.name = "UserSuspendedError";
  }
}

export class ActionNotAllowedError extends Error {
  constructor(
    message: string,
    public readonly actionType: EligibleActionType
  ) {
    super(message);
    this.name = "ActionNotAllowedError";
  }
}

export class CooldownActiveError extends Error {
  constructor(
    message: string,
    public readonly actionType: EligibleActionType,
    public readonly cooldownEndsAt: number
  ) {
    super(message);
    this.name = "CooldownActiveError";
  }
}
