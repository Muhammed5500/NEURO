/**
 * ConsensusDecision Schema
 * Represents the aggregated decision from multiple agent opinions
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
  uuidSchema,
  CURRENT_SCHEMA_VERSION,
} from "./common.js";
import { recommendedActionSchema } from "./agent-opinion.js";

// ============================================
// SCHEMA DEFINITION
// ============================================

export const consensusMethodSchema = z.enum([
  "majority_vote",
  "weighted_average",
  "unanimous",
  "confidence_weighted",
  "hierarchical",
]);

export type ConsensusMethod = z.infer<typeof consensusMethodSchema>;

export const consensusApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
  "auto_approved",
  "auto_rejected",
]);

export type ConsensusApprovalStatus = z.infer<typeof consensusApprovalStatusSchema>;

export const consensusDecisionSchema = createVersionedSchema({
  // Context
  contextDescription: z.string(),
  tokenAddress: addressSchema.optional(),
  tokenSymbol: z.string().optional(),
  
  // Contributing opinions
  opinionIds: z.array(uuidSchema).min(1),
  opinionCount: z.number().int().min(1),
  
  // Consensus method
  consensusMethod: consensusMethodSchema,
  consensusThreshold: z.number().min(0).max(1).default(0.6),
  consensusReached: z.boolean(),
  
  // Final decision
  finalRecommendation: recommendedActionSchema,
  finalSentiment: sentimentSchema,
  
  // Aggregated scores
  aggregatedConfidence: z.number().min(0).max(1),
  aggregatedRiskScore: z.number().min(0).max(1),
  agreementScore: z.number().min(0).max(1), // How much agents agreed
  
  // Risk assessment
  riskLevel: severitySchema,
  riskSummary: z.string(),
  
  // Reasoning
  consolidatedReasoning: z.string(),
  keyFactors: z.array(z.string()).default([]),
  disssentingViews: z.array(z.object({
    agentId: z.string(),
    view: z.string(),
    confidence: z.number().min(0).max(1),
  })).default([]),
  
  // Recommended execution parameters
  recommendedAmount: weiAmountSchema.optional(),
  recommendedAmountUsd: z.number().min(0).optional(),
  recommendedSlippage: z.number().min(0).max(100).optional(),
  
  // Approval workflow
  requiresManualApproval: z.boolean(),
  approvalStatus: consensusApprovalStatusSchema.default("pending"),
  approvedBy: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
  rejectionReason: z.string().optional(),
  
  // Execution link
  executionPlanId: uuidSchema.optional(),
  
  // Timing
  decisionMadeAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export type ConsensusDecision = z.infer<typeof consensusDecisionSchema>;

// ============================================
// FACTORY FUNCTIONS
// ============================================

export function createConsensusDecision(
  data: Omit<ConsensusDecision, "id" | "schemaVersion" | "createdAt">
): ConsensusDecision {
  return consensusDecisionSchema.parse({
    ...data,
    id: crypto.randomUUID(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
  });
}

// ============================================
// EXAMPLES & FIXTURES
// ============================================

export const consensusDecisionExamples: ConsensusDecision[] = [
  {
    schemaVersion: "1.0.0",
    id: "550e8400-e29b-41d4-a716-446655440050",
    createdAt: "2024-01-15T14:05:00Z",
    contextDescription: "Buy decision for PEPE token based on social momentum",
    tokenAddress: "0x1234567890123456789012345678901234567890",
    tokenSymbol: "PEPE",
    opinionIds: [
      "550e8400-e29b-41d4-a716-446655440040",
      "550e8400-e29b-41d4-a716-446655440041",
      "550e8400-e29b-41d4-a716-446655440042",
    ],
    opinionCount: 3,
    consensusMethod: "confidence_weighted",
    consensusThreshold: 0.6,
    consensusReached: true,
    finalRecommendation: "buy",
    finalSentiment: "bullish",
    aggregatedConfidence: 0.78,
    aggregatedRiskScore: 0.38,
    agreementScore: 0.85,
    riskLevel: "medium",
    riskSummary: "Moderate risk due to volatility, but strong social signals support position",
    consolidatedReasoning: "Three agents agree on bullish outlook. Market analyzer sees strong momentum, sentiment analyzer confirms positive social signals, risk assessor notes acceptable risk levels.",
    keyFactors: [
      "Strong influencer activity",
      "Volume surge",
      "Positive sentiment trend",
      "Acceptable liquidity",
    ],
    disssentingViews: [],
    recommendedAmount: "100000000000000000", // 0.1 MON
    recommendedAmountUsd: 50,
    recommendedSlippage: 2.5,
    requiresManualApproval: true,
    approvalStatus: "pending",
    decisionMadeAt: "2024-01-15T14:05:00Z",
    expiresAt: "2024-01-15T14:35:00Z",
  },
];
