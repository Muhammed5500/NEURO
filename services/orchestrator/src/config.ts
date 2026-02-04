/**
 * Orchestrator Service Configuration
 */

import { z } from "zod";
import { envSchema, SECURITY_DEFAULTS } from "@neuro/shared";

// ============================================
// ORCHESTRATOR CONFIG SCHEMA
// ============================================

const orchestratorConfigSchema = z.object({
  // AI/LLM
  llmProvider: z.enum(["openai", "anthropic"]),
  llmModel: z.string(),
  openaiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  
  // Security
  manualApproval: z.boolean(),
  killSwitchEnabled: z.boolean(),
  
  // Database
  databaseUrl: z.string().optional(),
  redisUrl: z.string().optional(),
  qdrantUrl: z.string().optional(),
  
  // Rate limiting
  maxDecisionsPerMinute: z.number(),
  
  // Confidence thresholds (Turkish: confidence_score ortalaması 0.85'in altındaysa...)
  minConfidenceForAction: z.number(),
  highRiskConfidenceThreshold: z.number(),
  
  // Multi-agent consensus thresholds
  consensusConfidenceThreshold: z.number(), // 0.85 default
  adversarialVetoThreshold: z.number(), // 0.90 default
  consensusAgreementThreshold: z.number(),
  minAgentsForConsensus: z.number(),
  
  // Run records
  runRecordPath: z.string(),
  
  // Monad network
  monadRpcUrl: z.string().optional(),
  monadChainId: z.number(),
});

export type OrchestratorConfig = z.infer<typeof orchestratorConfigSchema>;

// ============================================
// LOAD CONFIGURATION
// ============================================

export function loadOrchestratorConfig(): OrchestratorConfig {
  const env = envSchema.parse(process.env);

  const config: OrchestratorConfig = {
    // AI/LLM
    llmProvider: env.LLM_PROVIDER,
    llmModel: env.LLM_MODEL,
    openaiApiKey: env.OPENAI_API_KEY,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    
    // Security
    manualApproval: env.MANUAL_APPROVAL,
    killSwitchEnabled: env.KILL_SWITCH_ENABLED,
    
    // Database
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    qdrantUrl: env.QDRANT_URL,
    
    // Rate limiting
    maxDecisionsPerMinute: 30,
    
    // Confidence thresholds
    minConfidenceForAction: 0.7,
    highRiskConfidenceThreshold: 0.9,
    
    // Multi-agent consensus thresholds
    // Turkish: "confidence_score ortalaması 0.85'in altındaysa asla EXECUTE olmamalı"
    consensusConfidenceThreshold: parseFloat(process.env.CONSENSUS_CONFIDENCE_THRESHOLD || "0.85"),
    // Turkish: "AdversarialAgent %90 ve üzeri güvenle TUZAK diyorsa REJECT"
    adversarialVetoThreshold: parseFloat(process.env.ADVERSARIAL_VETO_THRESHOLD || "0.90"),
    consensusAgreementThreshold: parseFloat(process.env.CONSENSUS_AGREEMENT_THRESHOLD || "0.60"),
    minAgentsForConsensus: parseInt(process.env.MIN_AGENTS_FOR_CONSENSUS || "3"),
    
    // Run records
    runRecordPath: process.env.RUN_RECORD_PATH || "./data/run_records",
    
    // Monad network
    monadRpcUrl: process.env.MONAD_RPC_URL,
    monadChainId: parseInt(process.env.MONAD_CHAIN_ID || "143"),
  };

  return orchestratorConfigSchema.parse(config);
}

// ============================================
// CONSENSUS CONFIG FROM ORCHESTRATOR CONFIG
// ============================================

export function getConsensusConfig(config: OrchestratorConfig) {
  return {
    confidenceThreshold: config.consensusConfidenceThreshold,
    adversarialVetoThreshold: config.adversarialVetoThreshold,
    minAgentsRequired: config.minAgentsForConsensus,
    agreementThreshold: config.consensusAgreementThreshold,
    decisionExpiryMinutes: 30,
  };
}
