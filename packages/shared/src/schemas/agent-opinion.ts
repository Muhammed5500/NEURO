/**
 * AgentOpinion Schema
 * Represents an individual AI agent's opinion/analysis
 * 
 * @version 1.0.0
 * @backward-compatibility
 * - v1.0.0: Initial schema
 */

import { z } from "zod";
import {
  createVersionedSchema,
  sentimentSchema,
  severitySchema,
  addressSchema,
  weiAmountSchema,
  CURRENT_SCHEMA_VERSION,
} from "./common.js";

// ============================================
// SCHEMA DEFINITION
// ============================================

export const agentTypeSchema = z.enum([
  "market_analyzer",
  "sentiment_analyzer",
  "risk_assessor",
  "technical_analyzer",
  "news_analyzer",
  "social_analyzer",
  "execution_planner",
  "verification_agent",
]);

export type AgentType = z.infer<typeof agentTypeSchema>;

export const recommendedActionSchema = z.enum([
  "buy",
  "sell",
  "hold",
  "launch",
  "avoid",
  "monitor",
  "investigate",
]);

export type RecommendedAction = z.infer<typeof recommendedActionSchema>;

export const agentOpinionSchema = createVersionedSchema({
  // Agent identification
  agentType: agentTypeSchema,
  agentId: z.string(),
  agentVersion: z.string(),
  
  // Context
  contextId: z.string().uuid().optional(), // Links to a decision context
  tokenAddress: addressSchema.optional(),
  tokenSymbol: z.string().optional(),
  
  // Opinion
  recommendation: recommendedActionSchema,
  sentiment: sentimentSchema,
  
  // Scores
  confidenceScore: z.number().min(0).max(1),
  riskScore: z.number().min(0).max(1),
  opportunityScore: z.number().min(0).max(1).optional(),
  
  // Risk assessment
  riskLevel: severitySchema,
  riskFactors: z.array(z.object({
    factor: z.string(),
    severity: severitySchema,
    description: z.string(),
  })).default([]),
  
  // Analysis details
  reasoning: z.string().min(1).max(10000),
  keyInsights: z.array(z.string()).default([]),
  supportingEvidence: z.array(z.object({
    type: z.string(),
    source: z.string(),
    relevance: z.number().min(0).max(1),
    summary: z.string(),
  })).default([]),
  
  // Suggested parameters (for execution)
  suggestedAmount: weiAmountSchema.optional(),
  suggestedAmountUsd: z.number().min(0).optional(),
  suggestedSlippage: z.number().min(0).max(100).optional(),
  
  // Model info
  modelUsed: z.string(),
  promptTokens: z.number().int().min(0).optional(),
  completionTokens: z.number().int().min(0).optional(),
  
  // Timing
  analysisStartedAt: z.string().datetime(),
  analysisCompletedAt: z.string().datetime(),
  analysisDurationMs: z.number().int().min(0),
  
  // Validity
  expiresAt: z.string().datetime().optional(),
  isStale: z.boolean().default(false),
});

export type AgentOpinion = z.infer<typeof agentOpinionSchema>;

// ============================================
// FACTORY FUNCTIONS
// ============================================

export function createAgentOpinion(
  data: Omit<AgentOpinion, "id" | "schemaVersion" | "createdAt">
): AgentOpinion {
  return agentOpinionSchema.parse({
    ...data,
    id: crypto.randomUUID(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
  });
}

// ============================================
// EXAMPLES & FIXTURES
// ============================================

export const agentOpinionExamples: AgentOpinion[] = [
  {
    schemaVersion: "1.0.0",
    id: "550e8400-e29b-41d4-a716-446655440040",
    createdAt: "2024-01-15T14:00:00Z",
    agentType: "market_analyzer",
    agentId: "market-analyzer-v1",
    agentVersion: "1.2.0",
    contextId: "550e8400-e29b-41d4-a716-446655440099",
    tokenAddress: "0x1234567890123456789012345678901234567890",
    tokenSymbol: "PEPE",
    recommendation: "buy",
    sentiment: "bullish",
    confidenceScore: 0.82,
    riskScore: 0.35,
    opportunityScore: 0.78,
    riskLevel: "medium",
    riskFactors: [
      {
        factor: "liquidity",
        severity: "low",
        description: "Adequate liquidity for position size",
      },
      {
        factor: "volatility",
        severity: "medium",
        description: "High 24h price volatility observed",
      },
    ],
    reasoning: "Based on social signal analysis, the token shows strong momentum with influencer mentions and increasing volume. The technical indicators suggest an upward trend continuation.",
    keyInsights: [
      "3 macro influencers mentioned in last 24h",
      "Volume up 150% from 7-day average",
      "Holder count growing steadily",
    ],
    supportingEvidence: [
      {
        type: "social_signal",
        source: "twitter",
        relevance: 0.9,
        summary: "Major crypto influencer mentioned with bullish sentiment",
      },
    ],
    suggestedAmount: "100000000000000000", // 0.1 MON in Wei
    suggestedAmountUsd: 50,
    suggestedSlippage: 2.5,
    modelUsed: "gpt-4-turbo",
    promptTokens: 2500,
    completionTokens: 800,
    analysisStartedAt: "2024-01-15T13:59:50Z",
    analysisCompletedAt: "2024-01-15T14:00:00Z",
    analysisDurationMs: 10000,
    expiresAt: "2024-01-15T14:30:00Z",
    isStale: false,
  },
];
