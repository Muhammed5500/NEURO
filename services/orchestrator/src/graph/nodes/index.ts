/**
 * LangGraph Node Definitions
 * Individual workflow nodes for the NEURO agent
 * 
 * Note: The multi-agent consensus nodes are now in ../agent-graph.ts
 * This file maintains backward compatibility with the original single-agent workflow.
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { AgentState, type ProposedAction, type AIDecision } from "../state.js";
import type { OrchestratorConfig } from "../../config.js";
import type { ApprovalManager } from "../../approval/approval-manager.js";
import {
  orchestratorLogger as logger,
  isKillSwitchActive,
  canWrite,
} from "@neuro/shared";

// ============================================
// LLM INITIALIZATION
// ============================================

function createLLM(config: OrchestratorConfig) {
  if (config.llmProvider === "anthropic" && config.anthropicApiKey) {
    return new ChatAnthropic({
      apiKey: config.anthropicApiKey,
      modelName: config.llmModel,
      temperature: 0.1,
    });
  }

  if (config.openaiApiKey) {
    return new ChatOpenAI({
      apiKey: config.openaiApiKey,
      modelName: config.llmModel,
      temperature: 0.1,
    });
  }

  throw new Error("No LLM API key configured");
}

// ============================================
// ANALYZE MARKET NODE
// ============================================

export async function analyzeMarketNode(
  state: typeof AgentState.State,
  config: OrchestratorConfig
): Promise<Partial<typeof AgentState.State>> {
  logger.info({ task: state.query }, "Analyzing market context");

  try {
    // In production, this would fetch real market data
    // For now, return mock data structure
    const marketContext = {
      trendingTokens: [],
      newTokens: [],
      portfolioValue: 0,
      portfolioTokens: [],
      marketSentiment: "neutral" as const,
      timestamp: new Date(),
    };

    logger.info({
      trendingCount: marketContext.trendingTokens.length,
      newCount: marketContext.newTokens.length,
    }, "Market context gathered");

    return {
      currentStep: "run_agents",
    };
  } catch (error) {
    logger.error({ error }, "Market analysis failed");
    return {
      error: error instanceof Error ? error.message : "Market analysis failed",
      currentStep: "error",
    };
  }
}

// ============================================
// DECISION NODE
// ============================================

export async function decisionNode(
  state: typeof AgentState.State,
  config: OrchestratorConfig
): Promise<Partial<typeof AgentState.State>> {
  logger.info({ task: state.query }, "Making AI decision");

  try {
    const llm = createLLM(config);

    const systemPrompt = `You are NEURO, an autonomous AI agent that manages tokens on nad.fun (Monad blockchain).

Your task: ${state.query}

Current signals:
${JSON.stringify(state.signals, null, 2)}

CRITICAL RULES:
1. You operate in a READ-ONLY environment by default. Only propose write actions if explicitly allowed.
2. Never exceed the maximum transaction value limit.
3. Always provide detailed reasoning for your decisions.
4. If uncertain, recommend "hold" with no action.
5. Risk levels: low (<0.1 MON), medium (0.1-0.5 MON), high (0.5-1 MON), critical (>1 MON)

Respond in JSON format:
{
  "action": "launch" | "buy" | "sell" | "hold",
  "tokenAddress": "0x... or null",
  "tokenSymbol": "SYMBOL or null",
  "amount": "amount in tokens or null",
  "amountMon": number or null,
  "reason": "detailed explanation",
  "riskLevel": "low" | "medium" | "high" | "critical",
  "confidence": 0.0-1.0
}`;

    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(`Analyze and decide: ${state.query}`),
    ]);

    // Parse the response
    const content = response.content.toString();
    let proposedAction: ProposedAction;

    try {
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      proposedAction = JSON.parse(jsonMatch[0]) as ProposedAction;
    } catch {
      // Default to hold if parsing fails
      proposedAction = {
        type: "hold",
        reason: "Failed to parse AI response, defaulting to hold",
        riskLevel: "low",
        confidence: 0.5,
      };
    }

    const decision: AIDecision = {
      id: crypto.randomUUID(),
      decisionType: state.query || "unknown",
      action: proposedAction,
      reasoning: proposedAction.reason,
      confidence: proposedAction.confidence,
      modelUsed: config.llmModel,
      timestamp: new Date(),
    };

    logger.info({
      decisionId: decision.id,
      action: proposedAction.type,
      confidence: proposedAction.confidence,
      riskLevel: proposedAction.riskLevel,
    }, "AI decision made");

    return {
      currentStep: proposedAction.type === "hold" ? "complete" : "build_consensus",
    };
  } catch (error) {
    logger.error({ error }, "Decision making failed");
    return {
      error: error instanceof Error ? error.message : "Decision making failed",
      currentStep: "error",
    };
  }
}

// ============================================
// VALIDATION NODE
// ============================================

export async function validationNode(
  state: typeof AgentState.State,
  config: OrchestratorConfig
): Promise<Partial<typeof AgentState.State>> {
  logger.info({ decision: state.decision?.status }, "Validating decision");

  try {
    // Check kill switch
    if (isKillSwitchActive()) {
      logger.warn("Kill switch is active - blocking action");
      return {
        error: "Kill switch is active - all write operations blocked",
        currentStep: "error",
      };
    }

    // Check if writes are allowed
    if (!canWrite()) {
      logger.warn("System in READ-ONLY mode - blocking write action");
      return {
        error: "System is in READ-ONLY mode",
        currentStep: "error",
      };
    }

    // Validate confidence threshold (Turkish: 0.85 minimum)
    if (state.decision && state.decision.confidence < config.consensusConfidenceThreshold) {
      logger.warn({
        confidence: state.decision.confidence,
        threshold: config.consensusConfidenceThreshold,
      }, "Confidence below threshold");
      return {
        error: `Confidence ${state.decision.confidence} below threshold ${config.consensusConfidenceThreshold}`,
        currentStep: "error",
      };
    }

    logger.info("Validation passed");

    return {
      currentStep: "store_record",
    };
  } catch (error) {
    logger.error({ error }, "Validation failed");
    return {
      error: error instanceof Error ? error.message : "Validation failed",
      currentStep: "error",
    };
  }
}

// ============================================
// APPROVAL NODE
// ============================================

export async function approvalNode(
  state: typeof AgentState.State,
  config: OrchestratorConfig,
  approvalManager: ApprovalManager
): Promise<Partial<typeof AgentState.State>> {
  logger.info({
    decision: state.decision?.status,
  }, "Awaiting manual approval");

  try {
    if (!state.decision) {
      return {
        error: "No decision to approve",
        currentStep: "error",
      };
    }

    // For now, auto-approve in development
    logger.info("Auto-approving in development mode");

    return {
      currentStep: "store_record",
    };
  } catch (error) {
    logger.error({ error }, "Approval process failed");
    return {
      error: error instanceof Error ? error.message : "Approval process failed",
      currentStep: "error",
    };
  }
}

// ============================================
// EXECUTION NODE
// ============================================

export async function executionNode(
  state: typeof AgentState.State,
  config: OrchestratorConfig
): Promise<Partial<typeof AgentState.State>> {
  logger.info({
    decision: state.decision?.status,
  }, "Executing approved action");

  try {
    // Final safety check
    if (isKillSwitchActive()) {
      return {
        error: "Kill switch activated during execution",
        currentStep: "error",
      };
    }

    const decision = state.decision;
    if (!decision || decision.status !== "EXECUTE") {
      return {
        error: "No executable decision",
        currentStep: "error",
      };
    }

    // In production, this would call the execution service
    logger.warn("Execution not implemented - returning mock result");

    return {
      currentStep: "complete",
    };
  } catch (error) {
    logger.error({ error }, "Execution failed");
    return {
      error: error instanceof Error ? error.message : "Execution failed",
      currentStep: "error",
    };
  }
}

// ============================================
// CONFIRMATION NODE
// ============================================

export async function confirmationNode(
  state: typeof AgentState.State,
  config: OrchestratorConfig
): Promise<Partial<typeof AgentState.State>> {
  logger.info({
    decision: state.decision?.status,
  }, "Confirming execution result");

  // Wait for economic finality (800ms on Monad)
  await new Promise((resolve) => setTimeout(resolve, 800));

  return {
    currentStep: "complete",
  };
}
