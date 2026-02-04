/**
 * Monitoring System Types
 * 
 * Types for bonding curve saturation monitoring and advisory signals:
 * - Bonding curve metrics
 * - Attention decay scoring
 * - Volume/liquidity divergence
 * - Action cards
 */

import { z } from "zod";

// ============================================
// ADVISORY SIGNAL TYPES
// ============================================

/**
 * Types of advisory signals
 */
export type AdvisorySignalType =
  | "REDUCE_EXPOSURE"       // Suggest reducing position
  | "PAUSE_NEW_LAUNCHES"    // Suggest pausing new token launches
  | "EXIT_LIQUIDITY_RISK"   // Exit liquidity trap detected
  | "CURVE_STALL"           // Bonding curve stalling
  | "ATTENTION_DECAY"       // Social attention declining
  | "VOLUME_DIVERGENCE"     // Volume/liquidity mismatch
  | "HIGH_SELL_PRESSURE"    // Unusual sell pressure
  | "GRADUATION_RISK"       // Risk of failing graduation
  | "MARKET_COOLING";       // General market cooling

/**
 * Signal priority levels
 */
export type PriorityLevel = "low" | "medium" | "high" | "critical";

/**
 * Advisory signal
 */
export interface AdvisorySignal {
  id: string;
  type: AdvisorySignalType;
  priority: PriorityLevel;
  
  // Target
  tokenAddress?: string;
  tokenSymbol?: string;
  
  // Trigger
  // Turkish: "trigger_reason"
  triggerReason: string;
  triggerMetrics: Record<string, number>;
  
  // Timestamp
  createdAt: number;
  expiresAt?: number;
  
  // Status
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
}

// ============================================
// BONDING CURVE METRICS
// ============================================

/**
 * Bonding curve state
 * Turkish: "nad.fun bonding curve üzerindeki 'Mezuniyet' (Graduation) noktası"
 */
export interface BondingCurveState {
  tokenAddress: string;
  
  // Current position
  currentPrice: number;
  currentSupply: bigint;
  currentReserve: bigint;
  
  // Graduation metrics
  // Turkish: "Mezuniyet noktasına olan uzaklık"
  graduationPrice: number;
  graduationProgress: number; // 0-100%
  distanceToGraduation: number; // in price terms
  
  // Velocity
  // Turkish: "fiyat artışı yavaşlıyor mu"
  priceVelocity: number; // Price change per time unit
  priceAcceleration: number; // Change in velocity
  
  // Volume metrics
  buyVolume24h: bigint;
  sellVolume24h: bigint;
  netVolume24h: bigint;
  
  // Sell pressure
  // Turkish: "satış baskısı artıyorsa"
  sellPressureRatio: number; // sellVolume / buyVolume
  sellPressureTrend: "increasing" | "stable" | "decreasing";
  
  // Health indicators
  isStalling: boolean;
  stallConfidence: number;
  
  // Timestamps
  lastUpdated: number;
  dataPoints: number;
}

/**
 * Curve stall detection result
 * Turkish: "CURVE_STALL sinyali üret"
 */
export interface CurveStallResult {
  isStalling: boolean;
  confidence: number;
  
  // Indicators
  priceSlowdown: boolean;
  sellPressureIncrease: boolean;
  volumeDecline: boolean;
  
  // Metrics
  priceVelocityChange: number;
  sellPressureChange: number;
  volumeChange: number;
  
  // Time to graduation estimate
  estimatedTimeToGraduation?: number; // ms
  graduationProbability: number;
}

// ============================================
// ATTENTION DECAY METRICS
// ============================================

/**
 * Sentiment state
 */
export type SentimentState = "very_positive" | "positive" | "neutral" | "negative" | "very_negative";

/**
 * Attention metrics
 * Turkish: "Sentiment Velocity (Duygu hızı) analizi"
 */
export interface AttentionMetrics {
  tokenAddress: string;
  
  // Volume metrics
  tweetCount24h: number;
  tweetCount7d: number;
  tweetVelocity: number; // tweets per hour
  
  // Sentiment
  currentSentiment: SentimentState;
  sentimentScore: number; // -1 to 1
  
  // Sentiment velocity
  // Turkish: "Olumlu havadan nötr havaya geçiş hızı"
  sentimentVelocity: number; // Rate of change
  sentimentAcceleration: number;
  
  // Decay score
  // Turkish: "attention_decay puanı"
  attentionDecayScore: number; // 0-100, higher = more decay
  
  // Engagement
  averageEngagement: number;
  engagementTrend: "increasing" | "stable" | "decreasing";
  
  // News coverage
  newsArticleCount24h: number;
  newsSentiment: number;
  
  // Timestamps
  lastUpdated: number;
}

/**
 * Attention decay result
 */
export interface AttentionDecayResult {
  isDecaying: boolean;
  decayScore: number;
  decayRate: number;
  
  // Components
  volumeDecay: number;
  sentimentDecay: number;
  engagementDecay: number;
  
  // Projected
  projectedDecayIn24h: number;
  
  // Alert level
  alertLevel: "none" | "watch" | "warning" | "critical";
}

// ============================================
// VOLUME/LIQUIDITY METRICS
// ============================================

/**
 * Volume and liquidity state
 * Turkish: "Volume/Liquidity Divergence"
 */
export interface VolumeLiquidityState {
  tokenAddress: string;
  
  // Volume
  volume24h: bigint;
  volumeChange24h: number; // percentage
  volumeTrend: "increasing" | "stable" | "decreasing";
  
  // Liquidity
  liquidity: bigint;
  liquidityChange24h: number; // percentage
  liquidityTrend: "increasing" | "stable" | "decreasing";
  
  // Divergence
  // Turkish: "hacim artarken likidite aynı oranda artmıyorsa"
  divergenceRatio: number; // volume change / liquidity change
  isDiverging: boolean;
  divergenceDirection: "volume_leading" | "balanced" | "liquidity_leading";
  
  // Exit liquidity risk
  // Turkish: "'Exit Liquidity' riski olarak işaretle"
  exitLiquidityRisk: number; // 0-100
  exitLiquidityAlert: boolean;
  
  // Depth analysis
  liquidityDepth: "shallow" | "moderate" | "deep";
  priceImpact1Percent: number; // Trade size for 1% impact
  
  // Timestamps
  lastUpdated: number;
}

/**
 * Divergence detection result
 */
export interface DivergenceResult {
  isDiverging: boolean;
  divergenceScore: number;
  
  // Type
  isExitLiquidityRisk: boolean;
  riskLevel: PriorityLevel;
  
  // Metrics
  volumeChangePercent: number;
  liquidityChangePercent: number;
  ratio: number;
  
  // Recommendation
  recommendation: string;
}

// ============================================
// ACTION CARD
// ============================================

/**
 * Suggested action types
 */
export type SuggestedActionType =
  | "SELL_PARTIAL"     // Sell percentage of position
  | "SELL_FULL"        // Sell entire position
  | "HOLD"             // Continue holding
  | "PAUSE_BUYS"       // Stop buying more
  | "SET_STOP_LOSS"    // Set stop loss
  | "REDUCE_EXPOSURE"  // General exposure reduction
  | "MONITOR_CLOSELY"; // Increase monitoring frequency

/**
 * Action card schema
 * Turkish: "trigger_reason, suggested_action, priority_level ve simüle edilmiş pnl_impact"
 */
export interface ActionCard {
  id: string;
  
  // Target
  tokenAddress: string;
  tokenSymbol: string;
  
  // Trigger
  // Turkish: "trigger_reason"
  triggerReason: string;
  triggerSignals: AdvisorySignalType[];
  triggerMetrics: Record<string, number>;
  
  // Action
  // Turkish: "suggested_action (örn: %50 Sell)"
  suggestedAction: SuggestedActionType;
  actionDetails: {
    sellPercentage?: number;
    stopLossPrice?: number;
    targetPrice?: number;
    urgency: "immediate" | "soon" | "when_convenient";
  };
  
  // Priority
  // Turkish: "priority_level"
  priorityLevel: PriorityLevel;
  
  // PnL Impact
  // Turkish: "simüle edilmiş pnl_impact (eğer şimdi çıkarsak ne kadar kar/zarar ederiz)"
  pnlImpact: {
    currentPositionValue: number;
    currentPositionCost: number;
    unrealizedPnl: number;
    unrealizedPnlPercent: number;
    
    // If action is taken
    estimatedExitValue: number;
    estimatedSlippage: number;
    estimatedFees: number;
    netPnlIfExit: number;
    netPnlPercentIfExit: number;
    
    // Projection
    projectedValueIn24h: number;
    projectedPnlIn24h: number;
  };
  
  // Risk assessment
  riskAssessment: {
    currentRisk: PriorityLevel;
    riskIfNoAction: PriorityLevel;
    riskIfActionTaken: PriorityLevel;
    confidenceScore: number;
  };
  
  // Timing
  createdAt: number;
  expiresAt: number;
  validUntilBlock?: number;
  
  // Approval
  // Acceptance criteria: "No auto-trade occurs without manual approval"
  requiresApproval: true; // Always true - no auto-trade
  approvalStatus: "pending" | "approved" | "rejected" | "expired";
  approvedBy?: string;
  approvedAt?: number;
  rejectionReason?: string;
  
  // Execution
  executedAt?: number;
  executionTxHash?: string;
  actualPnl?: number;
}

/**
 * Action card creation request
 */
export interface CreateActionCardRequest {
  tokenAddress: string;
  tokenSymbol: string;
  signals: AdvisorySignal[];
  currentPrice: number;
  positionSize: number;
  positionCost: number;
  context?: Record<string, unknown>;
}

// ============================================
// MONITORING STATE
// ============================================

/**
 * Aggregated monitoring state for a token
 */
export interface TokenMonitoringState {
  tokenAddress: string;
  tokenSymbol: string;
  
  // States
  bondingCurve?: BondingCurveState;
  attention?: AttentionMetrics;
  volumeLiquidity?: VolumeLiquidityState;
  
  // Signals
  activeSignals: AdvisorySignal[];
  pendingActionCards: ActionCard[];
  
  // Overall health
  healthScore: number; // 0-100
  riskLevel: PriorityLevel;
  
  // Last update
  lastUpdated: number;
}

/**
 * Dashboard data for monitoring
 */
export interface MonitoringDashboardData {
  // Overview
  totalTokensMonitored: number;
  tokensWithSignals: number;
  pendingActionCards: number;
  
  // Signals by type
  signalsByType: Record<AdvisorySignalType, number>;
  signalsByPriority: Record<PriorityLevel, number>;
  
  // Action cards
  actionCards: ActionCard[];
  
  // At-risk tokens
  atRiskTokens: Array<{
    tokenAddress: string;
    tokenSymbol: string;
    riskLevel: PriorityLevel;
    primaryConcern: string;
    unrealizedPnl: number;
  }>;
  
  // Alerts
  recentSignals: AdvisorySignal[];
  
  // Timestamp
  generatedAt: number;
}

// ============================================
// CONFIGURATION
// ============================================

export interface MonitoringConfig {
  // Thresholds
  curveStallThreshold: {
    priceVelocityDropPercent: number;
    sellPressureIncreasePercent: number;
    minDataPoints: number;
  };
  
  attentionDecayThreshold: {
    volumeDropPercent: number;
    sentimentDropRate: number;
    engagementDropPercent: number;
  };
  
  volumeLiquidityThreshold: {
    divergenceRatioAlert: number;
    exitLiquidityRiskThreshold: number;
  };
  
  // Timing
  monitoringIntervalMs: number;
  signalExpiryMs: number;
  actionCardExpiryMs: number;
}

export const DEFAULT_MONITORING_CONFIG: MonitoringConfig = {
  curveStallThreshold: {
    priceVelocityDropPercent: 50, // 50% drop in velocity
    sellPressureIncreasePercent: 30, // 30% increase in sell pressure
    minDataPoints: 10,
  },
  attentionDecayThreshold: {
    volumeDropPercent: 40,
    sentimentDropRate: 0.2, // 0.2 points per hour
    engagementDropPercent: 30,
  },
  volumeLiquidityThreshold: {
    divergenceRatioAlert: 2.0, // Volume changing 2x faster than liquidity
    exitLiquidityRiskThreshold: 70, // Risk score threshold
  },
  monitoringIntervalMs: 60000, // 1 minute
  signalExpiryMs: 3600000, // 1 hour
  actionCardExpiryMs: 86400000, // 24 hours
};

// ============================================
// ERRORS
// ============================================

export class ActionCardExpiredError extends Error {
  constructor(
    message: string,
    public readonly cardId: string,
    public readonly expiredAt: number
  ) {
    super(message);
    this.name = "ActionCardExpiredError";
  }
}

export class ActionNotApprovedError extends Error {
  constructor(
    message: string,
    public readonly cardId: string
  ) {
    super(message);
    this.name = "ActionNotApprovedError";
  }
}
