/**
 * Agent Exports
 */

export * from "./base-agent.js";
export * from "./scout-agent.js";
export * from "./macro-agent.js";
export * from "./onchain-agent.js";
export * from "./risk-agent.js";
export * from "./adversarial-agent.js";

import { ScoutAgent } from "./scout-agent.js";
import { MacroAgent } from "./macro-agent.js";
import { OnChainAgent } from "./onchain-agent.js";
import { RiskAgent } from "./risk-agent.js";
import { AdversarialAgent } from "./adversarial-agent.js";
import type { OrchestratorConfig } from "../config.js";
import type { AgentRole } from "../graph/state.js";

/**
 * Create all agents
 */
export function createAgents(config: OrchestratorConfig) {
  return {
    scout: new ScoutAgent(config),
    macro: new MacroAgent(config),
    onchain: new OnChainAgent(config),
    risk: new RiskAgent(config),
    adversarial: new AdversarialAgent(config),
  };
}

export type AgentMap = ReturnType<typeof createAgents>;
