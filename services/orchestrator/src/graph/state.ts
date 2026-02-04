/**
 * LangGraph State Definition
 * Multi-agent consensus state for NEURO orchestrator
 * 
 * State includes:
 * - Latest signals (news/social/on-chain)
 * - Similarity results from memory
 * - Agent opinions with Chain of Thought
 * - Final decision + confidence + rationale
 */

import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { 
  AgentOpinion, 
  ConsensusDecision,
  Sentiment,
  Severity,
  RecommendedAction,
} from "@neuro/shared";

// ============================================
// AGENT TYPES
// ============================================

export type AgentRole = 
  | "scout"      // Analyzes news/social signals
  | "macro"      // Market trends and macro analysis
  | "onchain"    // Monad gas + nad.fun liquidity
  | "risk"       // Risk assessment
  | "adversarial"; // Critical evaluation, trap detection

export const AGENT_ROLES: AgentRole[] = [
  "scout",
  "macro", 
  "onchain",
  "risk",
  "adversarial",
];

// ============================================
// INPUT SIGNALS
// ============================================

export interface NewsSignal {
  id: string;
  title: string;
  content: string;
  source: string;
  publishedAt: string;
  sentiment?: Sentiment;
  sentimentScore?: number;
  tickers: string[];
  category?: string;
  relevanceScore?: number;
}

export interface SocialSignal {
  id: string;
  platform: string;
  content: string;
  authorId: string;
  authorFollowers?: number;
  isInfluencer: boolean;
  sentiment?: Sentiment;
  sentimentScore?: number;
  engagementRate?: number;
  postedAt: string;
  tickers: string[];
}

export interface OnChainSignal {
  // Monad network state
  gasPrice: string;
  gasPriceGwei: number;
  blockNumber: number;
  networkCongestion: "low" | "medium" | "high";
  
  // nad.fun specific
  tokenAddress?: string;
  tokenSymbol?: string;
  poolLiquidity?: string;
  poolLiquidityUsd?: number;
  volume24h?: number;
  holderCount?: number;
  bondingCurveProgress?: number; // 0-100%
  
  timestamp: string;
}

export interface MemorySimilarity {
  id: string;
  score: number;
  content: string;
  source: string;
  timestamp: string;
  
  // Historical outcome (if labeled)
  marketOutcome?: {
    priceImpactDirection: "up" | "down" | "neutral";
    priceImpactPercent: number;
    timeToImpactMs: number;
  };
}

export interface InputSignals {
  news: NewsSignal[];
  social: SocialSignal[];
  onchain: OnChainSignal | null;
  memory: MemorySimilarity[];
  query?: string;
  targetToken?: {
    address: string;
    symbol: string;
  };
}

// ============================================
// AGENT OPINION WITH CHAIN OF THOUGHT
// ============================================

export interface AgentOpinionWithCoT {
  // Agent identification
  role: AgentRole;
  agentId: string;
  
  // Decision
  recommendation: RecommendedAction;
  sentiment: Sentiment;
  confidenceScore: number;
  riskScore: number;
  
  // Chain of Thought (audit trail)
  chainOfThought: string; // Full reasoning trace
  keyInsights: string[];
  evidenceUsed: string[];
  
  // Adversarial specific
  isTrap?: boolean;       // Only for adversarial agent
  trapConfidence?: number; // Confidence that this is a trap
  trapReasons?: string[];  // Why it might be a trap
  
  // Risk factors
  riskFactors: Array<{
    factor: string;
    severity: Severity;
    description: string;
  }>;
  
  // Timing
  startedAt: string;
  completedAt: string;
  durationMs: number;
  
  // Model info
  modelUsed: string;
  promptTokens?: number;
  completionTokens?: number;
}

// ============================================
// FINAL DECISION
// ============================================

export type FinalDecisionStatus = 
  | "EXECUTE"
  | "REJECT"
  | "NEED_MORE_DATA"
  | "MANUAL_REVIEW";

export interface FinalDecision {
  status: FinalDecisionStatus;
  recommendation: RecommendedAction;
  confidence: number;
  rationale: string;
  
  // Aggregated scores
  averageConfidence: number;
  averageRiskScore: number;
  agreementScore: number;
  
  // Veto status
  adversarialVeto: boolean;
  vetoReason?: string;
  
  // Recommended parameters
  suggestedAmount?: string;
  suggestedSlippage?: number;
  
  // Token context
  tokenAddress?: string;
  tokenSymbol?: string;
  
  // Timing
  decisionMadeAt: string;
  expiresAt: string;
}

// ============================================
// RUN RECORD (for deterministic replay)
// ============================================

export interface RunRecord {
  // Identification
  id: string;
  version: string;
  
  // Inputs (immutable)
  inputs: {
    signals: InputSignals;
    query: string;
    config: {
      confidenceThreshold: number;
      adversarialVetoThreshold: number;
      consensusMethod: string;
    };
  };
  
  // Processing trace
  agentOpinions: AgentOpinionWithCoT[];
  
  // Output
  decision: FinalDecision | null;
  
  // Audit trail
  auditLog: Array<{
    timestamp: string;
    event: string;
    details: Record<string, unknown>;
  }>;
  
  // Timing
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  
  // Metadata
  checksum: string; // Hash of inputs for replay verification
}

// ============================================
// WORKFLOW STATE
// ============================================

export type WorkflowStep =
  | "initialize"
  | "gather_signals"
  | "run_agents"
  | "build_consensus"
  | "make_decision"
  | "store_record"
  | "complete"
  | "error";

// ============================================
// LANGGRAPH STATE ANNOTATION
// ============================================

export const AgentState = Annotation.Root({
  // Conversation messages
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  // Run identification
  runId: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),

  // Input signals
  signals: Annotation<InputSignals | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Query/task
  query: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),

  // Target token (if any)
  targetToken: Annotation<{ address: string; symbol: string } | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Agent opinions (accumulated)
  agentOpinions: Annotation<AgentOpinionWithCoT[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  // Final decision
  decision: Annotation<FinalDecision | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Run record
  runRecord: Annotation<RunRecord | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Current step
  currentStep: Annotation<WorkflowStep>({
    reducer: (_, next) => next,
    default: () => "initialize",
  }),

  // Error state
  error: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Audit log
  auditLog: Annotation<Array<{ timestamp: string; event: string; details: Record<string, unknown> }>>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
});

// ============================================
// STATE HELPERS
// ============================================

export function createInitialState(
  runId: string,
  query: string,
  signals?: InputSignals
): typeof AgentState.State {
  return {
    messages: [],
    runId,
    signals: signals || null,
    query,
    targetToken: signals?.targetToken || null,
    agentOpinions: [],
    decision: null,
    runRecord: null,
    currentStep: "initialize",
    error: null,
    auditLog: [{
      timestamp: new Date().toISOString(),
      event: "run_started",
      details: { runId, query },
    }],
  };
}

export function isTerminalState(state: typeof AgentState.State): boolean {
  return state.currentStep === "complete" || state.currentStep === "error";
}

export function addAuditEntry(
  state: typeof AgentState.State,
  event: string,
  details: Record<string, unknown>
): typeof AgentState.State {
  return {
    ...state,
    auditLog: [
      ...state.auditLog,
      { timestamp: new Date().toISOString(), event, details },
    ],
  };
}

// ============================================
// CHECKSUM FOR REPLAY
// ============================================

export function computeInputChecksum(signals: InputSignals, query: string): string {
  const data = JSON.stringify({ signals, query });
  // Simple hash for checksum (in production, use crypto.subtle)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
