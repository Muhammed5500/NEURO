/**
 * Advisory Signal Service
 * 
 * Orchestrates monitoring and generates advisory signals:
 * - Aggregates metrics from all analyzers
 * - Generates appropriate signals
 * - Creates action cards for manual approval
 * - Provides dashboard data
 * 
 * Acceptance criteria: "Advisory signals appear in dashboard"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as crypto from "crypto";
import type {
  AdvisorySignal,
  AdvisorySignalType,
  PriorityLevel,
  ActionCard,
  TokenMonitoringState,
  MonitoringDashboardData,
  MonitoringConfig,
  CreateActionCardRequest,
} from "./types.js";
import { DEFAULT_MONITORING_CONFIG } from "./types.js";
import {
  BondingCurveTracker,
  createBondingCurveTracker,
} from "./curve-tracker.js";
import {
  AttentionAnalyzer,
  createAttentionAnalyzer,
} from "./attention-analyzer.js";
import {
  DivergenceDetector,
  createDivergenceDetector,
} from "./divergence-detector.js";
import {
  ActionCardGenerator,
  createActionCardGenerator,
} from "./action-card-generator.js";

const serviceLogger = logger.child({ component: "advisory-service" });

// ============================================
// POSITION TRACKER (for PnL calculations)
// ============================================

interface Position {
  tokenAddress: string;
  tokenSymbol: string;
  size: number;
  costBasis: number;
  currentPrice?: number;
}

// ============================================
// ADVISORY SERVICE
// ============================================

export class AdvisoryService {
  private readonly config: MonitoringConfig;
  
  // Analyzers
  private readonly curveTracker: BondingCurveTracker;
  private readonly attentionAnalyzer: AttentionAnalyzer;
  private readonly divergenceDetector: DivergenceDetector;
  private readonly actionCardGenerator: ActionCardGenerator;
  
  // Signals
  private readonly signals: Map<string, AdvisorySignal> = new Map();
  private readonly signalsByToken: Map<string, Set<string>> = new Map();
  
  // Positions (for PnL calculation)
  private readonly positions: Map<string, Position> = new Map();
  
  // Token states
  private readonly tokenStates: Map<string, TokenMonitoringState> = new Map();

  constructor(config?: Partial<MonitoringConfig>) {
    this.config = { ...DEFAULT_MONITORING_CONFIG, ...config };

    this.curveTracker = createBondingCurveTracker(this.config.curveStallThreshold);
    this.attentionAnalyzer = createAttentionAnalyzer(this.config.attentionDecayThreshold);
    this.divergenceDetector = createDivergenceDetector(this.config.volumeLiquidityThreshold);
    this.actionCardGenerator = createActionCardGenerator(this.config);

    serviceLogger.info({
      monitoringInterval: this.config.monitoringIntervalMs,
      signalExpiry: this.config.signalExpiryMs,
    }, "AdvisoryService initialized");
  }

  /**
   * Update monitoring data for a token
   */
  updateTokenData(
    tokenAddress: string,
    tokenSymbol: string,
    data: {
      // Bonding curve data
      price: number;
      supply: bigint;
      reserve: bigint;
      buyVolume24h: bigint;
      sellVolume24h: bigint;
      
      // Attention data
      tweetCount: number;
      sentimentScore: number;
      engagement: number;
      newsCount: number;
      
      // Volume/liquidity data
      volume24h: bigint;
      liquidity: bigint;
    }
  ): TokenMonitoringState {
    // Update all analyzers
    const curveState = this.curveTracker.updateState(
      tokenAddress,
      data.price,
      data.supply,
      data.reserve,
      data.buyVolume24h,
      data.sellVolume24h
    );

    const attentionMetrics = this.attentionAnalyzer.updateMetrics(
      tokenAddress,
      data.tweetCount,
      data.sentimentScore,
      data.engagement,
      data.newsCount
    );

    const volumeLiquidityState = this.divergenceDetector.updateState(
      tokenAddress,
      data.volume24h,
      data.liquidity
    );

    // Update position price if we have one
    const position = this.positions.get(tokenAddress);
    if (position) {
      position.currentPrice = data.price;
    }

    // Generate signals
    const newSignals = this.generateSignals(
      tokenAddress,
      tokenSymbol,
      curveState,
      attentionMetrics,
      volumeLiquidityState
    );

    // Get active signals for token
    const activeSignals = this.getActiveSignalsForToken(tokenAddress);

    // Calculate health score
    const healthScore = this.calculateHealthScore(
      curveState,
      attentionMetrics,
      volumeLiquidityState
    );

    // Determine risk level
    const riskLevel = this.determineRiskLevel(activeSignals);

    // Build token state
    const tokenState: TokenMonitoringState = {
      tokenAddress,
      tokenSymbol,
      bondingCurve: curveState,
      attention: attentionMetrics,
      volumeLiquidity: volumeLiquidityState,
      activeSignals,
      pendingActionCards: this.actionCardGenerator.getPendingCardsForToken(tokenAddress),
      healthScore,
      riskLevel,
      lastUpdated: Date.now(),
    };

    this.tokenStates.set(tokenAddress, tokenState);

    // Generate action cards if needed
    if (activeSignals.length > 0 && position) {
      this.maybeGenerateActionCard(tokenAddress, tokenSymbol, activeSignals, position, data.price);
    }

    serviceLogger.debug({
      tokenAddress,
      healthScore,
      riskLevel,
      activeSignals: activeSignals.length,
      newSignals: newSignals.length,
    }, "Token data updated");

    return tokenState;
  }

  /**
   * Register a position for PnL tracking
   */
  registerPosition(
    tokenAddress: string,
    tokenSymbol: string,
    size: number,
    costBasis: number
  ): void {
    this.positions.set(tokenAddress, {
      tokenAddress,
      tokenSymbol,
      size,
      costBasis,
    });

    serviceLogger.debug({
      tokenAddress,
      size,
      costBasis,
    }, "Position registered");
  }

  /**
   * Get dashboard data
   * Acceptance criteria: "Advisory signals appear in dashboard"
   */
  getDashboardData(): MonitoringDashboardData {
    const now = Date.now();
    
    // Clean up expired
    this.cleanupExpired();

    // Count signals by type and priority
    const signalsByType: Record<AdvisorySignalType, number> = {} as any;
    const signalsByPriority: Record<PriorityLevel, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const signal of this.signals.values()) {
      if (!signal.expiresAt || signal.expiresAt > now) {
        signalsByType[signal.type] = (signalsByType[signal.type] || 0) + 1;
        signalsByPriority[signal.priority]++;
      }
    }

    // Get action cards
    const actionCards = this.actionCardGenerator.getAllPendingCards();

    // Get at-risk tokens
    const atRiskTokens: MonitoringDashboardData["atRiskTokens"] = [];
    for (const [tokenAddress, state] of this.tokenStates) {
      if (state.riskLevel !== "low") {
        const position = this.positions.get(tokenAddress);
        const currentValue = position?.currentPrice 
          ? position.size * position.currentPrice 
          : 0;
        const unrealizedPnl = position 
          ? currentValue - position.costBasis 
          : 0;

        atRiskTokens.push({
          tokenAddress,
          tokenSymbol: state.tokenSymbol,
          riskLevel: state.riskLevel,
          primaryConcern: state.activeSignals[0]?.triggerReason || "Unknown",
          unrealizedPnl,
        });
      }
    }
    atRiskTokens.sort((a, b) => {
      const priorityOrder: Record<PriorityLevel, number> = {
        critical: 0, high: 1, medium: 2, low: 3
      };
      return priorityOrder[a.riskLevel] - priorityOrder[b.riskLevel];
    });

    // Get recent signals
    const recentSignals = Array.from(this.signals.values())
      .filter(s => !s.expiresAt || s.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20);

    return {
      totalTokensMonitored: this.tokenStates.size,
      tokensWithSignals: new Set(Array.from(this.signals.values()).map(s => s.tokenAddress)).size,
      pendingActionCards: actionCards.length,
      signalsByType,
      signalsByPriority,
      actionCards,
      atRiskTokens,
      recentSignals,
      generatedAt: now,
    };
  }

  /**
   * Acknowledge a signal
   */
  acknowledgeSignal(signalId: string, acknowledgedBy: string): AdvisorySignal | undefined {
    const signal = this.signals.get(signalId);
    if (signal) {
      signal.acknowledged = true;
      signal.acknowledgedBy = acknowledgedBy;
      signal.acknowledgedAt = Date.now();
    }
    return signal;
  }

  /**
   * Get action card generator (for approval operations)
   */
  getActionCardGenerator(): ActionCardGenerator {
    return this.actionCardGenerator;
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private generateSignals(
    tokenAddress: string,
    tokenSymbol: string,
    curveState: ReturnType<BondingCurveTracker["updateState"]>,
    attentionMetrics: ReturnType<AttentionAnalyzer["updateMetrics"]>,
    volumeLiquidityState: ReturnType<DivergenceDetector["updateState"]>
  ): AdvisorySignal[] {
    const newSignals: AdvisorySignal[] = [];
    const now = Date.now();

    // Check for CURVE_STALL
    // Turkish: "CURVE_STALL sinyali üret"
    if (curveState.isStalling && curveState.stallConfidence > 0.5) {
      const signal = this.createSignal(
        "CURVE_STALL",
        this.confidenceToPriority(curveState.stallConfidence),
        tokenAddress,
        tokenSymbol,
        `Bonding curve stalling: price velocity down, sell pressure ${curveState.sellPressureTrend}`,
        {
          stallConfidence: curveState.stallConfidence,
          priceVelocity: curveState.priceVelocity,
          sellPressureRatio: curveState.sellPressureRatio,
          graduationProgress: curveState.graduationProgress,
        }
      );
      newSignals.push(signal);
    }

    // Check for high sell pressure
    if (curveState.sellPressureRatio > 0.6 && curveState.sellPressureTrend === "increasing") {
      const signal = this.createSignal(
        "HIGH_SELL_PRESSURE",
        curveState.sellPressureRatio > 0.75 ? "high" : "medium",
        tokenAddress,
        tokenSymbol,
        `High sell pressure detected: ${(curveState.sellPressureRatio * 100).toFixed(1)}% of volume`,
        {
          sellPressureRatio: curveState.sellPressureRatio,
          netVolume: Number(curveState.netVolume24h),
        }
      );
      newSignals.push(signal);
    }

    // Check for attention decay
    // Turkish: "attention_decay"
    const decayResult = this.attentionAnalyzer.analyzeDecay(tokenAddress);
    if (decayResult && decayResult.alertLevel !== "none") {
      const priority = this.alertLevelToPriority(decayResult.alertLevel);
      const signal = this.createSignal(
        "ATTENTION_DECAY",
        priority,
        tokenAddress,
        tokenSymbol,
        `Social attention declining: decay score ${decayResult.decayScore.toFixed(1)}`,
        {
          decayScore: decayResult.decayScore,
          volumeDecay: decayResult.volumeDecay,
          sentimentDecay: decayResult.sentimentDecay,
          engagementDecay: decayResult.engagementDecay,
        }
      );
      newSignals.push(signal);
    }

    // Check for exit liquidity risk
    // Turkish: "'Exit Liquidity' riski olarak işaretle"
    const divergenceResult = this.divergenceDetector.detectDivergence(tokenAddress);
    if (divergenceResult && divergenceResult.isExitLiquidityRisk) {
      const signal = this.createSignal(
        "EXIT_LIQUIDITY_RISK",
        divergenceResult.riskLevel,
        tokenAddress,
        tokenSymbol,
        divergenceResult.recommendation,
        {
          volumeChange: divergenceResult.volumeChangePercent,
          liquidityChange: divergenceResult.liquidityChangePercent,
          divergenceRatio: divergenceResult.ratio,
          exitLiquidityRisk: volumeLiquidityState.exitLiquidityRisk,
        }
      );
      newSignals.push(signal);
    } else if (divergenceResult && divergenceResult.isDiverging) {
      const signal = this.createSignal(
        "VOLUME_DIVERGENCE",
        "medium",
        tokenAddress,
        tokenSymbol,
        divergenceResult.recommendation,
        {
          volumeChange: divergenceResult.volumeChangePercent,
          liquidityChange: divergenceResult.liquidityChangePercent,
          divergenceRatio: divergenceResult.ratio,
        }
      );
      newSignals.push(signal);
    }

    // Check graduation risk
    if (curveState.graduationProgress > 50 && curveState.isStalling) {
      const stallResult = this.curveTracker.analyzeCurve(tokenAddress);
      if (stallResult && stallResult.graduationProbability < 0.5) {
        const signal = this.createSignal(
          "GRADUATION_RISK",
          stallResult.graduationProbability < 0.3 ? "high" : "medium",
          tokenAddress,
          tokenSymbol,
          `Graduation at risk: ${(stallResult.graduationProbability * 100).toFixed(1)}% probability`,
          {
            graduationProgress: curveState.graduationProgress,
            graduationProbability: stallResult.graduationProbability,
          }
        );
        newSignals.push(signal);
      }
    }

    // Store new signals
    for (const signal of newSignals) {
      this.signals.set(signal.id, signal);
      
      let tokenSignals = this.signalsByToken.get(tokenAddress);
      if (!tokenSignals) {
        tokenSignals = new Set();
        this.signalsByToken.set(tokenAddress, tokenSignals);
      }
      tokenSignals.add(signal.id);
    }

    return newSignals;
  }

  private createSignal(
    type: AdvisorySignalType,
    priority: PriorityLevel,
    tokenAddress: string,
    tokenSymbol: string,
    triggerReason: string,
    triggerMetrics: Record<string, number>
  ): AdvisorySignal {
    return {
      id: crypto.randomUUID(),
      type,
      priority,
      tokenAddress,
      tokenSymbol,
      triggerReason,
      triggerMetrics,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.signalExpiryMs,
      acknowledged: false,
    };
  }

  private maybeGenerateActionCard(
    tokenAddress: string,
    tokenSymbol: string,
    signals: AdvisorySignal[],
    position: Position,
    currentPrice: number
  ): void {
    // Don't generate if we already have a pending card for critical/high signals
    const existingCards = this.actionCardGenerator.getPendingCardsForToken(tokenAddress);
    const hasHighPriorityCard = existingCards.some(
      c => c.priorityLevel === "critical" || c.priorityLevel === "high"
    );

    // Only generate for high/critical signals if no existing card
    const highPrioritySignals = signals.filter(
      s => s.priority === "critical" || s.priority === "high"
    );

    if (highPrioritySignals.length > 0 && !hasHighPriorityCard) {
      const request: CreateActionCardRequest = {
        tokenAddress,
        tokenSymbol,
        signals: highPrioritySignals,
        currentPrice,
        positionSize: position.size,
        positionCost: position.costBasis,
      };

      this.actionCardGenerator.generateCard(request);
    }
  }

  private getActiveSignalsForToken(tokenAddress: string): AdvisorySignal[] {
    const signalIds = this.signalsByToken.get(tokenAddress);
    if (!signalIds) return [];

    const now = Date.now();
    return Array.from(signalIds)
      .map(id => this.signals.get(id)!)
      .filter(s => !s.expiresAt || s.expiresAt > now)
      .sort((a, b) => {
        const priorityOrder: Record<PriorityLevel, number> = {
          critical: 0, high: 1, medium: 2, low: 3
        };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
  }

  private calculateHealthScore(
    curveState: ReturnType<BondingCurveTracker["updateState"]>,
    attentionMetrics: ReturnType<AttentionAnalyzer["updateMetrics"]>,
    volumeLiquidityState: ReturnType<DivergenceDetector["updateState"]>
  ): number {
    let score = 100;

    // Curve health
    if (curveState.isStalling) {
      score -= curveState.stallConfidence * 30;
    }
    if (curveState.sellPressureRatio > 0.5) {
      score -= (curveState.sellPressureRatio - 0.5) * 40;
    }

    // Attention health
    score -= attentionMetrics.attentionDecayScore * 0.3;

    // Liquidity health
    score -= volumeLiquidityState.exitLiquidityRisk * 0.4;

    return Math.max(0, Math.min(100, score));
  }

  private determineRiskLevel(signals: AdvisorySignal[]): PriorityLevel {
    if (signals.length === 0) return "low";
    
    const priorities = signals.map(s => s.priority);
    if (priorities.includes("critical")) return "critical";
    if (priorities.includes("high")) return "high";
    if (priorities.includes("medium")) return "medium";
    return "low";
  }

  private confidenceToPriority(confidence: number): PriorityLevel {
    if (confidence >= 0.85) return "critical";
    if (confidence >= 0.7) return "high";
    if (confidence >= 0.5) return "medium";
    return "low";
  }

  private alertLevelToPriority(alertLevel: string): PriorityLevel {
    switch (alertLevel) {
      case "critical": return "critical";
      case "warning": return "high";
      case "watch": return "medium";
      default: return "low";
    }
  }

  private cleanupExpired(): void {
    const now = Date.now();
    
    // Cleanup signals
    for (const [id, signal] of this.signals) {
      if (signal.expiresAt && signal.expiresAt < now) {
        this.signals.delete(id);
        this.signalsByToken.get(signal.tokenAddress!)?.delete(id);
      }
    }

    // Cleanup action cards
    this.actionCardGenerator.cleanupExpiredCards();
  }
}

/**
 * Factory function
 */
export function createAdvisoryService(
  config?: Partial<MonitoringConfig>
): AdvisoryService {
  return new AdvisoryService(config);
}
