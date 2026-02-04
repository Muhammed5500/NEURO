/**
 * NEURO Orchestrator Service
 * Multi-Agent Consensus Engine with LangGraph
 * 
 * Features:
 * - 5 specialized agents (Scout, Macro, OnChain, Risk, Adversarial)
 * - Concurrent agent execution where possible
 * - Confidence-based decision thresholding (0.85 minimum)
 * - Adversarial veto power (90%+ trap confidence = automatic REJECT)
 * - Deterministic replay via immutable run records
 * - Chain of Thought audit trail
 */

import "dotenv/config";

// Export all modules
export * from "./graph/agent-graph.js";
export * from "./graph/state.js";
export * from "./agents/index.js";
export * from "./consensus/index.js";
export * from "./storage/index.js";
export * from "./approval/approval-manager.js";
export * from "./onchain/index.js";
export * from "./execution/index.js";
export * from "./submission/index.js";
export * from "./session/index.js";
export * from "./content/index.js";
export * from "./metadata/index.js";
export * from "./rewards/index.js";
export * from "./monitoring/index.js";
export * from "./treasury/index.js";
export * from "./api/index.js";
export * from "./metrics/index.js";
export * from "./config.js";

import { createAgentGraph, runConsensusGraph } from "./graph/agent-graph.js";
import { loadOrchestratorConfig, getConsensusConfig } from "./config.js";
import { orchestratorLogger as logger } from "@neuro/shared";

async function main(): Promise<void> {
  logger.info("Starting NEURO Orchestrator Service...");

  const config = loadOrchestratorConfig();
  
  logger.info({
    llmProvider: config.llmProvider,
    llmModel: config.llmModel,
    manualApproval: config.manualApproval,
    consensusConfidenceThreshold: config.consensusConfidenceThreshold,
    adversarialVetoThreshold: config.adversarialVetoThreshold,
  }, "Configuration loaded");

  // Create the multi-agent consensus graph
  const consensusConfig = getConsensusConfig(config);
  const graph = await createAgentGraph(config, {
    consensusConfig,
    runRecordPath: config.runRecordPath,
  });

  logger.info("Multi-agent consensus graph initialized");
  logger.info({
    confidenceThreshold: consensusConfig.confidenceThreshold,
    adversarialVetoThreshold: consensusConfig.adversarialVetoThreshold,
    minAgentsRequired: consensusConfig.minAgentsRequired,
  }, "Consensus thresholds");

  logger.info("NEURO Orchestrator Service started successfully");
  logger.info("Use 'pnpm orchestrator:run -- --fixture <path>' to run with fixtures");

  // Keep process running
  process.on("SIGINT", () => {
    logger.info("Shutting down NEURO Orchestrator Service...");
    process.exit(0);
  });
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    logger.fatal({ error }, "Failed to start NEURO Orchestrator Service");
    process.exit(1);
  });
}
