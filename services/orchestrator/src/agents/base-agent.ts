/**
 * Base Agent Class
 * 
 * Common functionality for all agents in the multi-agent system.
 * Each agent analyzes signals and produces an opinion with Chain of Thought.
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { orchestratorLogger as logger } from "@neuro/shared";

import type { OrchestratorConfig } from "../config.js";
import type { 
  AgentRole, 
  AgentOpinionWithCoT, 
  InputSignals,
} from "../graph/state.js";

// ============================================
// BASE AGENT CLASS
// ============================================

export abstract class BaseAgent {
  protected readonly role: AgentRole;
  protected readonly agentId: string;
  protected readonly config: OrchestratorConfig;
  protected llm: BaseChatModel;

  constructor(role: AgentRole, config: OrchestratorConfig) {
    this.role = role;
    this.agentId = `${role}-agent-v1`;
    this.config = config;
    this.llm = this.createLLM();
  }

  protected createLLM(): BaseChatModel {
    if (this.config.llmProvider === "anthropic" && this.config.anthropicApiKey) {
      return new ChatAnthropic({
        apiKey: this.config.anthropicApiKey,
        modelName: this.config.llmModel,
        temperature: 0.1, // Low temperature for consistency
      });
    }

    if (this.config.openaiApiKey) {
      return new ChatOpenAI({
        apiKey: this.config.openaiApiKey,
        modelName: this.config.llmModel,
        temperature: 0.1,
      });
    }

    throw new Error("No LLM API key configured");
  }

  /**
   * Analyze signals and produce an opinion
   */
  async analyze(
    signals: InputSignals,
    query: string
  ): Promise<AgentOpinionWithCoT> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    logger.info({ role: this.role, query }, `${this.role} agent starting analysis`);

    try {
      // Build the system prompt
      const systemPrompt = this.buildSystemPrompt(signals);
      
      // Build the user prompt
      const userPrompt = this.buildUserPrompt(signals, query);

      // Call LLM
      const response = await this.llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);

      const content = response.content.toString();
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      // Parse the response
      const opinion = this.parseResponse(content, {
        startedAt,
        completedAt,
        durationMs,
        model: this.config.llmModel,
      });

      logger.info({
        role: this.role,
        recommendation: opinion.recommendation,
        confidence: opinion.confidenceScore,
        durationMs,
      }, `${this.role} agent completed analysis`);

      return opinion;
    } catch (error) {
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      logger.error({ error, role: this.role }, `${this.role} agent analysis failed`);

      // Return a safe default opinion on error
      return this.createErrorOpinion(
        error instanceof Error ? error.message : "Unknown error",
        { startedAt, completedAt, durationMs }
      );
    }
  }

  /**
   * Build the system prompt for this agent
   */
  protected abstract buildSystemPrompt(signals: InputSignals): string;

  /**
   * Build the user prompt for this agent
   */
  protected abstract buildUserPrompt(signals: InputSignals, query: string): string;

  /**
   * Parse LLM response into structured opinion
   */
  protected parseResponse(
    content: string,
    timing: { startedAt: string; completedAt: string; durationMs: number; model: string }
  ): AgentOpinionWithCoT {
    try {
      // Extract JSON from response
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || 
                        content.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      return {
        role: this.role,
        agentId: this.agentId,
        recommendation: parsed.recommendation || "hold",
        sentiment: parsed.sentiment || "neutral",
        confidenceScore: Math.min(1, Math.max(0, parsed.confidenceScore || 0.5)),
        riskScore: Math.min(1, Math.max(0, parsed.riskScore || 0.5)),
        chainOfThought: parsed.chainOfThought || "",
        keyInsights: parsed.keyInsights || [],
        evidenceUsed: parsed.evidenceUsed || [],
        isTrap: parsed.isTrap,
        trapConfidence: parsed.trapConfidence,
        trapReasons: parsed.trapReasons,
        riskFactors: parsed.riskFactors || [],
        startedAt: timing.startedAt,
        completedAt: timing.completedAt,
        durationMs: timing.durationMs,
        modelUsed: timing.model,
      };
    } catch (error) {
      logger.warn({ error, role: this.role }, "Failed to parse LLM response, using defaults");
      
      return this.createErrorOpinion(
        `Parse error: ${error instanceof Error ? error.message : "Unknown"}`,
        {
          startedAt: timing.startedAt,
          completedAt: timing.completedAt,
          durationMs: timing.durationMs,
        }
      );
    }
  }

  /**
   * Create a safe error opinion
   */
  protected createErrorOpinion(
    errorMessage: string,
    timing: { startedAt: string; completedAt: string; durationMs: number }
  ): AgentOpinionWithCoT {
    return {
      role: this.role,
      agentId: this.agentId,
      recommendation: "hold",
      sentiment: "neutral",
      confidenceScore: 0.1, // Very low confidence
      riskScore: 0.9, // High risk due to error
      chainOfThought: `Error during analysis: ${errorMessage}. Defaulting to safe HOLD recommendation.`,
      keyInsights: ["Analysis failed due to error"],
      evidenceUsed: [],
      riskFactors: [{
        factor: "analysis_error",
        severity: "high",
        description: errorMessage,
      }],
      startedAt: timing.startedAt,
      completedAt: timing.completedAt,
      durationMs: timing.durationMs,
      modelUsed: this.config.llmModel,
    };
  }

  /**
   * Format signals for prompt
   */
  protected formatNewsSignals(signals: InputSignals): string {
    if (!signals.news.length) return "No news signals available.";
    
    return signals.news.slice(0, 5).map((n, i) => 
      `[News ${i + 1}] ${n.title}\n` +
      `Source: ${n.source} | Sentiment: ${n.sentiment || 'unknown'} (${n.sentimentScore?.toFixed(2) || 'N/A'})\n` +
      `Tickers: ${n.tickers.join(', ') || 'none'}\n` +
      `Content: ${n.content.slice(0, 200)}...`
    ).join('\n\n');
  }

  protected formatSocialSignals(signals: InputSignals): string {
    if (!signals.social.length) return "No social signals available.";
    
    return signals.social.slice(0, 5).map((s, i) =>
      `[Social ${i + 1}] @${s.authorId} on ${s.platform}\n` +
      `Followers: ${s.authorFollowers || 'unknown'} | Influencer: ${s.isInfluencer}\n` +
      `Sentiment: ${s.sentiment || 'unknown'} | Engagement: ${s.engagementRate?.toFixed(2) || 'N/A'}%\n` +
      `Content: ${s.content.slice(0, 200)}...`
    ).join('\n\n');
  }

  protected formatOnChainSignals(signals: InputSignals): string {
    const oc = signals.onchain;
    if (!oc) return "No on-chain data available.";
    
    return `Gas Price: ${oc.gasPriceGwei} gwei | Network: ${oc.networkCongestion}\n` +
           `Block: ${oc.blockNumber}\n` +
           (oc.tokenSymbol ? 
             `Token: ${oc.tokenSymbol}\n` +
             `Pool Liquidity: $${oc.poolLiquidityUsd?.toLocaleString() || 'unknown'}\n` +
             `24h Volume: $${oc.volume24h?.toLocaleString() || 'unknown'}\n` +
             `Holders: ${oc.holderCount || 'unknown'}\n` +
             `Bonding Curve: ${oc.bondingCurveProgress || 0}%`
           : 'No token-specific data');
  }

  protected formatMemorySignals(signals: InputSignals): string {
    if (!signals.memory.length) return "No similar historical events found.";
    
    return signals.memory.slice(0, 3).map((m, i) => {
      let outcome = "";
      if (m.marketOutcome) {
        outcome = ` | Outcome: ${m.marketOutcome.priceImpactDirection} ${m.marketOutcome.priceImpactPercent.toFixed(1)}%`;
      }
      return `[Similar ${i + 1}] Score: ${m.score.toFixed(2)}${outcome}\n` +
             `Source: ${m.source} | ${m.timestamp}\n` +
             `${m.content.slice(0, 150)}...`;
    }).join('\n\n');
  }
}

// ============================================
// RESPONSE FORMAT
// ============================================

export const AGENT_RESPONSE_FORMAT = `
Respond in the following JSON format:
\`\`\`json
{
  "recommendation": "buy" | "sell" | "hold" | "avoid" | "monitor",
  "sentiment": "bullish" | "bearish" | "neutral",
  "confidenceScore": 0.0-1.0,
  "riskScore": 0.0-1.0,
  "chainOfThought": "Your complete reasoning process, step by step...",
  "keyInsights": ["insight1", "insight2", ...],
  "evidenceUsed": ["evidence1", "evidence2", ...],
  "riskFactors": [
    {
      "factor": "factor_name",
      "severity": "low" | "medium" | "high" | "critical",
      "description": "explanation"
    }
  ]
}
\`\`\`
`;
