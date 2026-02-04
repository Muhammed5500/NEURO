/**
 * Agent Event Types for Dashboard
 * 
 * Types for live streaming and replay of agent conversations
 */

export type AgentRole = "scout" | "macro" | "onchain" | "risk" | "adversarial";

export type EventSeverity = "debug" | "info" | "warn" | "error" | "critical";

export type EventType =
  | "AGENT_START"
  | "AGENT_THINKING"
  | "AGENT_OPINION"
  | "AGENT_COMPLETE"
  | "CONSENSUS_START"
  | "CONSENSUS_VOTE"
  | "CONSENSUS_RESULT"
  | "ACTION_CARD"
  | "EXECUTION_PLAN"
  | "KILL_SWITCH"
  | "SYSTEM_MESSAGE";

/**
 * Agent event from orchestrator
 */
export interface AgentEvent {
  id: string;
  runId: string;
  timestamp: number;
  
  // Event info
  type: EventType;
  severity: EventSeverity;
  
  // Agent info (if applicable)
  agent?: AgentRole;
  
  // Message
  message: string;
  
  // Structured data
  data?: Record<string, unknown>;
  
  // Chain of thought (for thinking events)
  chainOfThought?: string;
  
  // For action cards
  actionCard?: {
    id: string;
    priority: "low" | "medium" | "high" | "critical";
    suggestedAction: string;
    tokenSymbol?: string;
  };
}

/**
 * Run metadata
 */
export interface RunMetadata {
  id: string;
  startedAt: number;
  completedAt?: number;
  status: "running" | "completed" | "failed" | "cancelled";
  
  // Query info
  query: string;
  tokenAddress?: string;
  tokenSymbol?: string;
  
  // Result summary
  decision?: {
    status: string;
    recommendation: string;
    confidence: number;
  };
  
  // Event counts
  eventCount: number;
  agentCount: number;
}

/**
 * Filter options for stream
 */
export interface StreamFilters {
  runId?: string;
  agents?: AgentRole[];
  severities?: EventSeverity[];
  eventTypes?: EventType[];
  searchQuery?: string;
}

/**
 * Replay state
 */
export interface ReplayState {
  isPlaying: boolean;
  isPaused: boolean;
  currentIndex: number;
  speed: number; // 1x, 2x, 4x
  startTime?: number;
}

/**
 * Stream connection status
 */
export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
