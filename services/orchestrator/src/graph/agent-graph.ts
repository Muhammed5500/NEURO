/**
 * LangGraph Agent Graph
 * 
 * Multi-agent consensus state machine:
 * - All 5 agents run concurrently where possible
 * - Consensus engine aggregates opinions
 * - Run records stored for replay
 */

import { StateGraph, END, START } from "@langchain/langgraph";
import { orchestratorLogger as logger } from "@neuro/shared";

import { AgentState, type WorkflowStep, type InputSignals } from "./state.js";
import { createAgents, type AgentMap } from "../agents/index.js";
import { 
  ConsensusEngine, 
  createConsensusEngine, 
  type ConsensusConfig,
  DEFAULT_CONSENSUS_CONFIG,
} from "../consensus/index.js";
import { 
  createRunRecordStore, 
  createRunRecordBuilder,
  type RunRecordStore,
  type RunRecordBuilder,
} from "../storage/index.js";
import type { OrchestratorConfig } from "../config.js";

// ============================================
// GRAPH CONTEXT
// ============================================

interface GraphContext {
  config: OrchestratorConfig;
  consensusConfig: ConsensusConfig;
  agents: AgentMap;
  consensusEngine: ConsensusEngine;
  runRecordStore: RunRecordStore;
  runRecordBuilder: RunRecordBuilder | null;
}

// Module-level context (set during createAgentGraph)
let graphContext: GraphContext | null = null;

// ============================================
// NODE IMPLEMENTATIONS
// ============================================

/**
 * Initialize node - sets up the run
 */
async function initializeNode(
  state: typeof AgentState.State
): Promise<Partial<typeof AgentState.State>> {
  logger.info({ runId: state.runId, query: state.query }, "Initializing run");

  if (!graphContext) {
    return { error: "Graph context not initialized", currentStep: "error" };
  }

  // Create run record builder
  graphContext.runRecordBuilder = createRunRecordBuilder(state.runId);

  if (state.signals) {
    graphContext.runRecordBuilder.setInputs(
      state.signals,
      state.query,
      graphContext.consensusConfig
    );
  }

  return {
    currentStep: "run_agents",
    auditLog: [{
      timestamp: new Date().toISOString(),
      event: "initialized",
      details: { runId: state.runId },
    }],
  };
}

/**
 * Run agents node - executes all agents concurrently
 */
async function runAgentsNode(
  state: typeof AgentState.State
): Promise<Partial<typeof AgentState.State>> {
  if (!graphContext || !state.signals) {
    return { error: "Missing context or signals", currentStep: "error" };
  }

  logger.info({ runId: state.runId }, "Running all agents concurrently");

  const { agents } = graphContext;

  // Run all agents concurrently
  const agentPromises = [
    agents.scout.analyze(state.signals, state.query),
    agents.macro.analyze(state.signals, state.query),
    agents.onchain.analyze(state.signals, state.query),
    agents.risk.analyze(state.signals, state.query),
    agents.adversarial.analyze(state.signals, state.query),
  ];

  try {
    const opinions = await Promise.all(agentPromises);

    logger.info({
      runId: state.runId,
      agentCount: opinions.length,
      confidences: opinions.map(o => ({ role: o.role, confidence: o.confidenceScore })),
    }, "All agents completed");

    // Add opinions to run record
    for (const opinion of opinions) {
      graphContext.runRecordBuilder?.addAgentOpinion(opinion);
    }

    return {
      agentOpinions: opinions,
      currentStep: "build_consensus",
      auditLog: [{
        timestamp: new Date().toISOString(),
        event: "agents_completed",
        details: { 
          agentCount: opinions.length,
          roles: opinions.map(o => o.role),
        },
      }],
    };
  } catch (error) {
    logger.error({ error, runId: state.runId }, "Agent execution failed");
    return {
      error: error instanceof Error ? error.message : "Agent execution failed",
      currentStep: "error",
    };
  }
}

/**
 * Build consensus node - aggregates opinions into decision
 */
async function buildConsensusNode(
  state: typeof AgentState.State
): Promise<Partial<typeof AgentState.State>> {
  if (!graphContext) {
    return { error: "Graph context not initialized", currentStep: "error" };
  }

  logger.info({ 
    runId: state.runId, 
    opinionCount: state.agentOpinions.length,
  }, "Building consensus");

  const decision = graphContext.consensusEngine.buildConsensus(
    state.agentOpinions,
    state.targetToken || undefined
  );

  graphContext.runRecordBuilder?.setDecision(decision);

  logger.info({
    runId: state.runId,
    status: decision.status,
    confidence: decision.confidence,
    adversarialVeto: decision.adversarialVeto,
  }, "Consensus built");

  return {
    decision,
    currentStep: "store_record",
    auditLog: [{
      timestamp: new Date().toISOString(),
      event: "consensus_built",
      details: {
        status: decision.status,
        confidence: decision.confidence,
        recommendation: decision.recommendation,
      },
    }],
  };
}

/**
 * Store record node - saves run record for replay
 */
async function storeRecordNode(
  state: typeof AgentState.State
): Promise<Partial<typeof AgentState.State>> {
  if (!graphContext?.runRecordBuilder) {
    return { error: "Run record builder not initialized", currentStep: "error" };
  }

  logger.info({ runId: state.runId }, "Storing run record");

  try {
    const record = graphContext.runRecordBuilder.build();
    await graphContext.runRecordStore.save(record);

    logger.info({ 
      runId: state.runId, 
      checksum: record.checksum,
      totalDurationMs: record.totalDurationMs,
    }, "Run record saved");

    return {
      runRecord: record,
      currentStep: "complete",
      auditLog: [{
        timestamp: new Date().toISOString(),
        event: "record_saved",
        details: { checksum: record.checksum },
      }],
    };
  } catch (error) {
    logger.error({ error, runId: state.runId }, "Failed to save run record");
    return {
      error: error instanceof Error ? error.message : "Failed to save run record",
      currentStep: "error",
    };
  }
}

// ============================================
// ROUTING FUNCTIONS
// ============================================

function routeAfterInitialize(state: typeof AgentState.State): WorkflowStep | typeof END {
  if (state.error) return END;
  if (!state.signals) return END;
  return "run_agents";
}

function routeAfterAgents(state: typeof AgentState.State): WorkflowStep | typeof END {
  if (state.error) return END;
  if (state.agentOpinions.length === 0) return END;
  return "build_consensus";
}

function routeAfterConsensus(state: typeof AgentState.State): WorkflowStep | typeof END {
  if (state.error) return END;
  return "store_record";
}

function routeAfterStore(state: typeof AgentState.State): typeof END {
  return END;
}

// ============================================
// GRAPH CREATION
// ============================================

export interface CreateGraphOptions {
  consensusConfig?: Partial<ConsensusConfig>;
  runRecordPath?: string;
}

// Type alias for compiled graph
export type CompiledAgentGraph = Awaited<ReturnType<typeof createAgentGraph>>;

export async function createAgentGraph(
  config: OrchestratorConfig,
  options: CreateGraphOptions = {}
) {
  logger.info("Creating multi-agent consensus graph...");

  // Initialize context
  const consensusConfig = { ...DEFAULT_CONSENSUS_CONFIG, ...options.consensusConfig };
  
  graphContext = {
    config,
    consensusConfig,
    agents: createAgents(config),
    consensusEngine: createConsensusEngine(consensusConfig),
    runRecordStore: createRunRecordStore(options.runRecordPath),
    runRecordBuilder: null,
  };

  // Create state graph
  const graph = new StateGraph(AgentState)
    .addNode("initialize", initializeNode)
    .addNode("run_agents", runAgentsNode)
    .addNode("build_consensus", buildConsensusNode)
    .addNode("store_record", storeRecordNode)
    
    .addEdge(START, "initialize")
    .addConditionalEdges("initialize", routeAfterInitialize)
    .addConditionalEdges("run_agents", routeAfterAgents)
    .addConditionalEdges("build_consensus", routeAfterConsensus)
    .addConditionalEdges("store_record", routeAfterStore);

  const compiledGraph = graph.compile();

  logger.info("Multi-agent consensus graph compiled");

  return compiledGraph;
}

// ============================================
// GRAPH RUNNER
// ============================================

export interface RunOptions {
  signals: InputSignals;
  query: string;
  runId?: string;
  timeout?: number;
}

export async function runConsensusGraph(
  graph: Awaited<ReturnType<typeof createAgentGraph>>,
  options: RunOptions
): Promise<typeof AgentState.State> {
  const runId = options.runId || crypto.randomUUID();
  const timeout = options.timeout || 120000; // 2 minutes default

  logger.info({ runId, query: options.query }, "Running consensus graph");

  const initialState: typeof AgentState.State = {
    messages: [],
    runId,
    signals: options.signals,
    query: options.query,
    targetToken: options.signals.targetToken || null,
    agentOpinions: [],
    decision: null,
    runRecord: null,
    currentStep: "initialize",
    error: null,
    auditLog: [{
      timestamp: new Date().toISOString(),
      event: "run_started",
      details: { runId, query: options.query },
    }],
  };

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Graph execution timeout")), timeout);
    });

    const resultPromise = graph.invoke(initialState, {
      recursionLimit: 10,
    });

    const result = await Promise.race([resultPromise, timeoutPromise]);

    logger.info({
      runId,
      status: result.decision?.status,
      currentStep: result.currentStep,
      hasError: !!result.error,
    }, "Consensus graph completed");

    return result;
  } catch (error) {
    logger.error({ error, runId }, "Consensus graph failed");

    return {
      ...initialState,
      error: error instanceof Error ? error.message : "Unknown error",
      currentStep: "error",
    };
  }
}

// Re-export types
export type { InputSignals, AgentOpinionWithCoT, FinalDecision, RunRecord } from "./state.js";
