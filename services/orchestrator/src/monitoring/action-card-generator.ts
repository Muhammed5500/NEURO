/**
 * Action Card Generator
 * 
 * Generates action cards for manual approval:
 * - Aggregates signals into actionable cards
 * - Calculates PnL impact
 * - Enforces manual approval requirement
 * 
 * Turkish: "trigger_reason, suggested_action (örn: %50 Sell), priority_level ve simüle edilmiş pnl_impact"
 * Acceptance criteria: "No auto-trade occurs without manual approval"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as crypto from "crypto";
import type {
  ActionCard,
  AdvisorySignal,
  AdvisorySignalType,
  SuggestedActionType,
  PriorityLevel,
  CreateActionCardRequest,
  MonitoringConfig,
} from "./types.js";
import {
  DEFAULT_MONITORING_CONFIG,
  ActionCardExpiredError,
  ActionNotApprovedError,
} from "./types.js";

const cardLogger = logger.child({ component: "action-card-generator" });

// ============================================
// ACTION RECOMMENDATION RULES
// ============================================

interface ActionRule {
  signalTypes: AdvisorySignalType[];
  minPriority: PriorityLevel;
  suggestedAction: SuggestedActionType;
  sellPercentage?: number;
  urgency: ActionCard["actionDetails"]["urgency"];
}

const ACTION_RULES: ActionRule[] = [
  // Critical - full exit
  {
    signalTypes: ["EXIT_LIQUIDITY_RISK"],
    minPriority: "critical",
    suggestedAction: "SELL_FULL",
    sellPercentage: 100,
    urgency: "immediate",
  },
  {
    signalTypes: ["CURVE_STALL", "HIGH_SELL_PRESSURE"],
    minPriority: "critical",
    suggestedAction: "SELL_PARTIAL",
    sellPercentage: 75,
    urgency: "immediate",
  },
  
  // High - significant reduction
  {
    signalTypes: ["EXIT_LIQUIDITY_RISK"],
    minPriority: "high",
    suggestedAction: "SELL_PARTIAL",
    sellPercentage: 50,
    urgency: "soon",
  },
  {
    signalTypes: ["CURVE_STALL"],
    minPriority: "high",
    suggestedAction: "SELL_PARTIAL",
    sellPercentage: 50,
    urgency: "soon",
  },
  {
    signalTypes: ["ATTENTION_DECAY", "VOLUME_DIVERGENCE"],
    minPriority: "high",
    suggestedAction: "REDUCE_EXPOSURE",
    sellPercentage: 30,
    urgency: "soon",
  },
  
  // Medium - moderate action
  {
    signalTypes: ["REDUCE_EXPOSURE"],
    minPriority: "medium",
    suggestedAction: "SELL_PARTIAL",
    sellPercentage: 25,
    urgency: "when_convenient",
  },
  {
    signalTypes: ["MARKET_COOLING"],
    minPriority: "medium",
    suggestedAction: "PAUSE_BUYS",
    urgency: "when_convenient",
  },
  {
    signalTypes: ["GRADUATION_RISK"],
    minPriority: "medium",
    suggestedAction: "SET_STOP_LOSS",
    urgency: "soon",
  },
  
  // Low - monitoring
  {
    signalTypes: ["ATTENTION_DECAY"],
    minPriority: "low",
    suggestedAction: "MONITOR_CLOSELY",
    urgency: "when_convenient",
  },
];

// ============================================
// ACTION CARD GENERATOR
// ============================================

export class ActionCardGenerator {
  private readonly config: MonitoringConfig;
  
  // Active cards
  private readonly cards: Map<string, ActionCard> = new Map();
  
  // Cards by token
  private readonly cardsByToken: Map<string, Set<string>> = new Map();

  constructor(config?: Partial<MonitoringConfig>) {
    this.config = { ...DEFAULT_MONITORING_CONFIG, ...config };

    cardLogger.info({
      expiryMs: this.config.actionCardExpiryMs,
    }, "ActionCardGenerator initialized");
  }

  /**
   * Generate action card from signals
   * Turkish: "trigger_reason, suggested_action, priority_level ve simüle edilmiş pnl_impact"
   */
  generateCard(request: CreateActionCardRequest): ActionCard {
    const cardId = crypto.randomUUID();
    const now = Date.now();

    // Determine highest priority
    const highestPriority = this.getHighestPriority(request.signals);

    // Find matching action rule
    const rule = this.findMatchingRule(request.signals, highestPriority);

    // Generate trigger reason
    // Turkish: "trigger_reason"
    const triggerReason = this.generateTriggerReason(request.signals);

    // Calculate PnL impact
    // Turkish: "simüle edilmiş pnl_impact"
    const pnlImpact = this.calculatePnlImpact(
      request.currentPrice,
      request.positionSize,
      request.positionCost,
      rule?.sellPercentage || 0
    );

    // Aggregate trigger metrics
    const triggerMetrics: Record<string, number> = {};
    for (const signal of request.signals) {
      for (const [key, value] of Object.entries(signal.triggerMetrics)) {
        triggerMetrics[key] = value;
      }
    }

    const card: ActionCard = {
      id: cardId,
      tokenAddress: request.tokenAddress,
      tokenSymbol: request.tokenSymbol,
      
      // Trigger
      triggerReason,
      triggerSignals: request.signals.map(s => s.type),
      triggerMetrics,
      
      // Action
      // Turkish: "suggested_action (örn: %50 Sell)"
      suggestedAction: rule?.suggestedAction || "MONITOR_CLOSELY",
      actionDetails: {
        sellPercentage: rule?.sellPercentage,
        urgency: rule?.urgency || "when_convenient",
      },
      
      // Priority
      // Turkish: "priority_level"
      priorityLevel: highestPriority,
      
      // PnL Impact
      // Turkish: "simüle edilmiş pnl_impact"
      pnlImpact,
      
      // Risk assessment
      riskAssessment: {
        currentRisk: highestPriority,
        riskIfNoAction: this.escalateRisk(highestPriority),
        riskIfActionTaken: this.reduceRisk(highestPriority),
        confidenceScore: this.calculateConfidence(request.signals),
      },
      
      // Timing
      createdAt: now,
      expiresAt: now + this.config.actionCardExpiryMs,
      
      // Approval - ALWAYS requires manual approval
      // Acceptance criteria: "No auto-trade occurs without manual approval"
      requiresApproval: true,
      approvalStatus: "pending",
    };

    // Store card
    this.cards.set(cardId, card);

    // Track by token
    let tokenCards = this.cardsByToken.get(request.tokenAddress);
    if (!tokenCards) {
      tokenCards = new Set();
      this.cardsByToken.set(request.tokenAddress, tokenCards);
    }
    tokenCards.add(cardId);

    cardLogger.info({
      cardId,
      tokenAddress: request.tokenAddress,
      suggestedAction: card.suggestedAction,
      sellPercentage: card.actionDetails.sellPercentage,
      priorityLevel: card.priorityLevel,
      unrealizedPnl: pnlImpact.unrealizedPnl,
    }, "Action card generated");

    return card;
  }

  /**
   * Approve an action card
   * Acceptance criteria: "No auto-trade occurs without manual approval"
   */
  approveCard(cardId: string, approvedBy: string): ActionCard {
    const card = this.cards.get(cardId);
    if (!card) {
      throw new Error(`Card not found: ${cardId}`);
    }

    // Check expiry
    if (Date.now() > card.expiresAt) {
      card.approvalStatus = "expired";
      throw new ActionCardExpiredError(
        "Action card has expired",
        cardId,
        card.expiresAt
      );
    }

    // Approve
    card.approvalStatus = "approved";
    card.approvedBy = approvedBy;
    card.approvedAt = Date.now();

    cardLogger.info({
      cardId,
      tokenAddress: card.tokenAddress,
      approvedBy,
      suggestedAction: card.suggestedAction,
    }, "Action card approved");

    return card;
  }

  /**
   * Reject an action card
   */
  rejectCard(cardId: string, reason: string): ActionCard {
    const card = this.cards.get(cardId);
    if (!card) {
      throw new Error(`Card not found: ${cardId}`);
    }

    card.approvalStatus = "rejected";
    card.rejectionReason = reason;

    cardLogger.info({
      cardId,
      tokenAddress: card.tokenAddress,
      reason,
    }, "Action card rejected");

    return card;
  }

  /**
   * Mark card as executed
   */
  markExecuted(cardId: string, txHash: string, actualPnl: number): ActionCard {
    const card = this.cards.get(cardId);
    if (!card) {
      throw new Error(`Card not found: ${cardId}`);
    }

    if (card.approvalStatus !== "approved") {
      throw new ActionNotApprovedError(
        "Cannot execute unapproved action card",
        cardId
      );
    }

    card.executedAt = Date.now();
    card.executionTxHash = txHash;
    card.actualPnl = actualPnl;

    cardLogger.info({
      cardId,
      txHash,
      actualPnl,
      estimatedPnl: card.pnlImpact.netPnlIfExit,
    }, "Action card executed");

    return card;
  }

  /**
   * Get card by ID
   */
  getCard(cardId: string): ActionCard | undefined {
    return this.cards.get(cardId);
  }

  /**
   * Get pending cards for a token
   */
  getPendingCardsForToken(tokenAddress: string): ActionCard[] {
    const cardIds = this.cardsByToken.get(tokenAddress);
    if (!cardIds) return [];

    const now = Date.now();
    return Array.from(cardIds)
      .map(id => this.cards.get(id)!)
      .filter(card => 
        card.approvalStatus === "pending" && 
        card.expiresAt > now
      )
      .sort((a, b) => {
        // Sort by priority then by time
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const aPriority = priorityOrder[a.priorityLevel];
        const bPriority = priorityOrder[b.priorityLevel];
        if (aPriority !== bPriority) return aPriority - bPriority;
        return b.createdAt - a.createdAt;
      });
  }

  /**
   * Get all pending cards
   */
  getAllPendingCards(): ActionCard[] {
    const now = Date.now();
    return Array.from(this.cards.values())
      .filter(card => 
        card.approvalStatus === "pending" && 
        card.expiresAt > now
      )
      .sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const aPriority = priorityOrder[a.priorityLevel];
        const bPriority = priorityOrder[b.priorityLevel];
        if (aPriority !== bPriority) return aPriority - bPriority;
        return b.createdAt - a.createdAt;
      });
  }

  /**
   * Clean up expired cards
   */
  cleanupExpiredCards(): number {
    const now = Date.now();
    let count = 0;

    for (const [cardId, card] of this.cards) {
      if (card.expiresAt < now && card.approvalStatus === "pending") {
        card.approvalStatus = "expired";
        count++;
      }
    }

    if (count > 0) {
      cardLogger.debug({ count }, "Expired cards cleaned up");
    }

    return count;
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private getHighestPriority(signals: AdvisorySignal[]): PriorityLevel {
    const priorityOrder: Record<PriorityLevel, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    let highest: PriorityLevel = "low";
    for (const signal of signals) {
      if (priorityOrder[signal.priority] < priorityOrder[highest]) {
        highest = signal.priority;
      }
    }
    return highest;
  }

  private findMatchingRule(
    signals: AdvisorySignal[],
    priority: PriorityLevel
  ): ActionRule | undefined {
    const signalTypes = signals.map(s => s.type);
    const priorityOrder: Record<PriorityLevel, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    // Find best matching rule
    for (const rule of ACTION_RULES) {
      // Check if any signal type matches
      const hasMatchingType = rule.signalTypes.some(t => signalTypes.includes(t));
      
      // Check priority
      const meetsPriority = priorityOrder[priority] <= priorityOrder[rule.minPriority];

      if (hasMatchingType && meetsPriority) {
        return rule;
      }
    }

    return undefined;
  }

  private generateTriggerReason(signals: AdvisorySignal[]): string {
    const reasons = signals.map(s => s.triggerReason);
    
    if (reasons.length === 1) {
      return reasons[0];
    }

    return `Multiple signals detected: ${signals.map(s => s.type).join(", ")}. ` +
           reasons.slice(0, 2).join(" ");
  }

  private calculatePnlImpact(
    currentPrice: number,
    positionSize: number,
    positionCost: number,
    sellPercentage: number
  ): ActionCard["pnlImpact"] {
    const currentPositionValue = positionSize * currentPrice;
    const unrealizedPnl = currentPositionValue - positionCost;
    const unrealizedPnlPercent = positionCost > 0 
      ? (unrealizedPnl / positionCost) * 100 
      : 0;

    // Estimate exit impact
    const sellAmount = positionSize * (sellPercentage / 100);
    const estimatedSlippage = this.estimateSlippage(sellAmount, currentPrice);
    const estimatedFees = sellAmount * currentPrice * 0.003; // 0.3% fees
    
    const estimatedExitValue = sellAmount * currentPrice * (1 - estimatedSlippage);
    const exitCost = (positionCost / positionSize) * sellAmount;
    const netPnlIfExit = estimatedExitValue - exitCost - estimatedFees;
    const netPnlPercentIfExit = exitCost > 0 
      ? (netPnlIfExit / exitCost) * 100 
      : 0;

    // Project 24h (simple decay estimate)
    const projectedDecay = 0.1; // 10% decay estimate
    const projectedValueIn24h = currentPositionValue * (1 - projectedDecay);
    const projectedPnlIn24h = projectedValueIn24h - positionCost;

    return {
      currentPositionValue,
      currentPositionCost: positionCost,
      unrealizedPnl,
      unrealizedPnlPercent,
      estimatedExitValue,
      estimatedSlippage,
      estimatedFees,
      netPnlIfExit,
      netPnlPercentIfExit,
      projectedValueIn24h,
      projectedPnlIn24h,
    };
  }

  private estimateSlippage(amount: number, price: number): number {
    // Simplified slippage estimate
    const tradeValue = amount * price;
    if (tradeValue < 100) return 0.001; // 0.1%
    if (tradeValue < 1000) return 0.005; // 0.5%
    if (tradeValue < 10000) return 0.01; // 1%
    return 0.025; // 2.5%
  }

  private escalateRisk(current: PriorityLevel): PriorityLevel {
    switch (current) {
      case "low": return "medium";
      case "medium": return "high";
      case "high": return "critical";
      case "critical": return "critical";
    }
  }

  private reduceRisk(current: PriorityLevel): PriorityLevel {
    switch (current) {
      case "critical": return "high";
      case "high": return "medium";
      case "medium": return "low";
      case "low": return "low";
    }
  }

  private calculateConfidence(signals: AdvisorySignal[]): number {
    if (signals.length === 0) return 0;

    // More signals = higher confidence
    const signalBonus = Math.min(0.3, signals.length * 0.1);

    // Higher priority signals = higher confidence
    const priorityScores: Record<PriorityLevel, number> = {
      critical: 0.9,
      high: 0.7,
      medium: 0.5,
      low: 0.3,
    };
    const avgPriorityScore = signals.reduce(
      (sum, s) => sum + priorityScores[s.priority], 0
    ) / signals.length;

    return Math.min(1, avgPriorityScore + signalBonus);
  }
}

/**
 * Factory function
 */
export function createActionCardGenerator(
  config?: Partial<MonitoringConfig>
): ActionCardGenerator {
  return new ActionCardGenerator(config);
}
