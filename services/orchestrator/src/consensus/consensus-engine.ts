/**
 * Consensus Engine
 * 
 * Aggregates agent opinions into a final decision.
 * 
 * Turkish Rules:
 * 1. "Nihai karar (FINAL_DECISION), confidence_score ortalaması 0.85'in altındaysa
 *    asla EXECUTE olmamalı; sistem otomatik olarak REJECT veya NEED_MORE_DATA moduna geçmeli."
 * 
 * 2. "Eğer AdversarialAgent (Eleştirel Ajan) %90 ve üzeri bir güvenle 'BU BİR TUZAK' diyorsa,
 *    diğer tüm ajanlar 'EVET' dese bile karar REJECT olmalı."
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { 
  AgentOpinionWithCoT, 
  FinalDecision, 
  FinalDecisionStatus 
} from "../graph/state.js";
import type { RecommendedAction, Sentiment } from "@neuro/shared";

// ============================================
// CONSENSUS CONFIGURATION
// ============================================

export interface ConsensusConfig {
  // Minimum average confidence to allow EXECUTE
  // Turkish: "confidence_score ortalaması 0.85'in altındaysa asla EXECUTE olmamalı"
  confidenceThreshold: number;
  
  // Adversarial veto threshold
  // Turkish: "%90 ve üzeri bir güvenle 'BU BİR TUZAK' diyorsa REJECT olmalı"
  adversarialVetoThreshold: number;
  
  // Minimum agents required for consensus
  minAgentsRequired: number;
  
  // Agreement threshold for consensus
  agreementThreshold: number;
  
  // Decision expiry in minutes
  decisionExpiryMinutes: number;
}

export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  confidenceThreshold: 0.85,
  adversarialVetoThreshold: 0.90,
  minAgentsRequired: 3,
  agreementThreshold: 0.6,
  decisionExpiryMinutes: 30,
};

// ============================================
// CONSENSUS ENGINE
// ============================================

export class ConsensusEngine {
  private config: ConsensusConfig;

  constructor(config: Partial<ConsensusConfig> = {}) {
    this.config = { ...DEFAULT_CONSENSUS_CONFIG, ...config };
  }

  /**
   * Build consensus from agent opinions
   */
  buildConsensus(
    opinions: AgentOpinionWithCoT[],
    targetToken?: { address: string; symbol: string }
  ): FinalDecision {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.decisionExpiryMinutes * 60 * 1000);

    logger.info({ 
      agentCount: opinions.length,
      targetToken: targetToken?.symbol,
    }, "Building consensus from agent opinions");

    // Check minimum agents
    if (opinions.length < this.config.minAgentsRequired) {
      return this.createDecision("NEED_MORE_DATA", {
        rationale: `Insufficient agents: ${opinions.length}/${this.config.minAgentsRequired} required`,
        opinions,
        targetToken,
        now,
        expiresAt,
      });
    }

    // Check for adversarial veto
    // Turkish: "AdversarialAgent %90 ve üzeri güvenle TUZAK diyorsa REJECT"
    const adversarialOpinion = opinions.find(o => o.role === "adversarial");
    if (adversarialOpinion?.isTrap && 
        (adversarialOpinion.trapConfidence || 0) >= this.config.adversarialVetoThreshold) {
      
      logger.warn({
        trapConfidence: adversarialOpinion.trapConfidence,
        trapReasons: adversarialOpinion.trapReasons,
      }, "ADVERSARIAL VETO TRIGGERED - Decision REJECTED");

      return this.createDecision("REJECT", {
        rationale: `ADVERSARIAL VETO: Trap detected with ${((adversarialOpinion.trapConfidence || 0) * 100).toFixed(0)}% confidence. Reasons: ${adversarialOpinion.trapReasons?.join("; ")}`,
        opinions,
        targetToken,
        now,
        expiresAt,
        adversarialVeto: true,
        vetoReason: adversarialOpinion.trapReasons?.join("; "),
      });
    }

    // Calculate aggregated scores
    const { 
      averageConfidence, 
      averageRiskScore, 
      agreementScore,
      majorityRecommendation,
      majoritySentiment,
    } = this.aggregateOpinions(opinions);

    // Check confidence threshold
    // Turkish: "confidence_score ortalaması 0.85'in altındaysa asla EXECUTE olmamalı"
    if (averageConfidence < this.config.confidenceThreshold) {
      const status: FinalDecisionStatus = averageConfidence < 0.5 
        ? "NEED_MORE_DATA" 
        : "MANUAL_REVIEW";

      logger.info({
        averageConfidence,
        threshold: this.config.confidenceThreshold,
        status,
      }, "Confidence below threshold - not executing");

      return this.createDecision(status, {
        rationale: `Average confidence (${(averageConfidence * 100).toFixed(1)}%) below threshold (${this.config.confidenceThreshold * 100}%). ` +
                   `${status === "NEED_MORE_DATA" ? "More data needed." : "Manual review required."}`,
        opinions,
        targetToken,
        now,
        expiresAt,
        averageConfidence,
        averageRiskScore,
        agreementScore,
        majorityRecommendation,
        majoritySentiment,
      });
    }

    // Check agreement threshold
    if (agreementScore < this.config.agreementThreshold) {
      return this.createDecision("MANUAL_REVIEW", {
        rationale: `Low agent agreement (${(agreementScore * 100).toFixed(1)}%). Agents disagree on recommendation.`,
        opinions,
        targetToken,
        now,
        expiresAt,
        averageConfidence,
        averageRiskScore,
        agreementScore,
        majorityRecommendation,
        majoritySentiment,
      });
    }

    // Check if recommendation is actionable
    if (majorityRecommendation === "hold" || majorityRecommendation === "monitor") {
      return this.createDecision("REJECT", {
        rationale: `Consensus recommendation is ${majorityRecommendation.toUpperCase()}. No action needed.`,
        opinions,
        targetToken,
        now,
        expiresAt,
        averageConfidence,
        averageRiskScore,
        agreementScore,
        majorityRecommendation,
        majoritySentiment,
      });
    }

    if (majorityRecommendation === "avoid") {
      return this.createDecision("REJECT", {
        rationale: `Consensus is to AVOID this opportunity due to identified risks.`,
        opinions,
        targetToken,
        now,
        expiresAt,
        averageConfidence,
        averageRiskScore,
        agreementScore,
        majorityRecommendation,
        majoritySentiment,
      });
    }

    // High risk score should prevent execution
    if (averageRiskScore > 0.7) {
      return this.createDecision("REJECT", {
        rationale: `Risk score too high (${(averageRiskScore * 100).toFixed(1)}%). Not safe to execute.`,
        opinions,
        targetToken,
        now,
        expiresAt,
        averageConfidence,
        averageRiskScore,
        agreementScore,
        majorityRecommendation,
        majoritySentiment,
      });
    }

    // All checks passed - can execute!
    logger.info({
      averageConfidence,
      averageRiskScore,
      agreementScore,
      recommendation: majorityRecommendation,
    }, "Consensus reached - EXECUTE approved");

    return this.createDecision("EXECUTE", {
      rationale: this.buildExecuteRationale(opinions, {
        averageConfidence,
        averageRiskScore,
        agreementScore,
        majorityRecommendation,
        majoritySentiment,
      }),
      opinions,
      targetToken,
      now,
      expiresAt,
      averageConfidence,
      averageRiskScore,
      agreementScore,
      majorityRecommendation,
      majoritySentiment,
    });
  }

  /**
   * Aggregate opinions into scores
   */
  private aggregateOpinions(opinions: AgentOpinionWithCoT[]): {
    averageConfidence: number;
    averageRiskScore: number;
    agreementScore: number;
    majorityRecommendation: RecommendedAction;
    majoritySentiment: Sentiment;
  } {
    // Calculate averages
    const confidences = opinions.map(o => o.confidenceScore);
    const riskScores = opinions.map(o => o.riskScore);
    
    const averageConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const averageRiskScore = riskScores.reduce((a, b) => a + b, 0) / riskScores.length;

    // Count recommendations
    const recommendationCounts = new Map<RecommendedAction, number>();
    for (const op of opinions) {
      const count = recommendationCounts.get(op.recommendation) || 0;
      recommendationCounts.set(op.recommendation, count + 1);
    }

    // Find majority recommendation
    let majorityRecommendation: RecommendedAction = "hold";
    let maxCount = 0;
    for (const [rec, count] of recommendationCounts) {
      if (count > maxCount) {
        maxCount = count;
        majorityRecommendation = rec;
      }
    }

    // Calculate agreement score
    const agreementScore = maxCount / opinions.length;

    // Count sentiments
    const sentimentCounts = new Map<Sentiment, number>();
    for (const op of opinions) {
      const count = sentimentCounts.get(op.sentiment) || 0;
      sentimentCounts.set(op.sentiment, count + 1);
    }

    // Find majority sentiment
    let majoritySentiment: Sentiment = "neutral";
    maxCount = 0;
    for (const [sent, count] of sentimentCounts) {
      if (count > maxCount) {
        maxCount = count;
        majoritySentiment = sent;
      }
    }

    return {
      averageConfidence,
      averageRiskScore,
      agreementScore,
      majorityRecommendation,
      majoritySentiment,
    };
  }

  /**
   * Create a decision object
   */
  private createDecision(
    status: FinalDecisionStatus,
    params: {
      rationale: string;
      opinions: AgentOpinionWithCoT[];
      targetToken?: { address: string; symbol: string };
      now: Date;
      expiresAt: Date;
      adversarialVeto?: boolean;
      vetoReason?: string;
      averageConfidence?: number;
      averageRiskScore?: number;
      agreementScore?: number;
      majorityRecommendation?: RecommendedAction;
      majoritySentiment?: Sentiment;
    }
  ): FinalDecision {
    // Calculate suggested amount based on risk (simplified)
    let suggestedAmount: string | undefined;
    let suggestedSlippage: number | undefined;

    if (status === "EXECUTE" && params.averageRiskScore !== undefined) {
      // Lower risk = larger position (max 0.5 MON, min 0.05 MON)
      const riskFactor = 1 - params.averageRiskScore;
      const amountMon = Math.max(0.05, Math.min(0.5, 0.1 + (riskFactor * 0.4)));
      suggestedAmount = (amountMon * 1e18).toString(); // Convert to Wei
      suggestedSlippage = Math.min(5, Math.max(1, params.averageRiskScore * 5));
    }

    return {
      status,
      recommendation: params.majorityRecommendation || "hold",
      confidence: params.averageConfidence || 0,
      rationale: params.rationale,
      averageConfidence: params.averageConfidence || 0,
      averageRiskScore: params.averageRiskScore || 0,
      agreementScore: params.agreementScore || 0,
      adversarialVeto: params.adversarialVeto || false,
      vetoReason: params.vetoReason,
      suggestedAmount,
      suggestedSlippage,
      tokenAddress: params.targetToken?.address,
      tokenSymbol: params.targetToken?.symbol,
      decisionMadeAt: params.now.toISOString(),
      expiresAt: params.expiresAt.toISOString(),
    };
  }

  /**
   * Build execute rationale from opinions
   */
  private buildExecuteRationale(
    opinions: AgentOpinionWithCoT[],
    scores: {
      averageConfidence: number;
      averageRiskScore: number;
      agreementScore: number;
      majorityRecommendation: RecommendedAction;
      majoritySentiment: Sentiment;
    }
  ): string {
    const insights: string[] = [];

    // Collect key insights from each agent
    for (const op of opinions) {
      if (op.keyInsights.length > 0) {
        insights.push(`[${op.role.toUpperCase()}] ${op.keyInsights[0]}`);
      }
    }

    return `EXECUTE approved with ${(scores.averageConfidence * 100).toFixed(1)}% confidence. ` +
           `Recommendation: ${scores.majorityRecommendation.toUpperCase()}. ` +
           `Sentiment: ${scores.majoritySentiment}. ` +
           `Risk: ${(scores.averageRiskScore * 100).toFixed(1)}%. ` +
           `Agreement: ${(scores.agreementScore * 100).toFixed(1)}%.\n\n` +
           `Key insights:\n${insights.map(i => `• ${i}`).join('\n')}`;
  }
}

/**
 * Factory function
 */
export function createConsensusEngine(config?: Partial<ConsensusConfig>): ConsensusEngine {
  return new ConsensusEngine(config);
}
