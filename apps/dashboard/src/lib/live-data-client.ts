/**
 * Live Data Client
 * 
 * Central client for all real-time data connections.
 * NO MOCK DATA - throws errors if connections fail.
 */

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface DataSourceError {
  source: string;
  message: string;
  code: string;
  timestamp: Date;
  raw?: unknown;
}

// ============================================
// CONFIGURATION - All from environment
// ============================================

const CONFIG = {
  ORCHESTRATOR_URL: process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "",
  X_API_ENABLED: process.env.NEXT_PUBLIC_X_API_ENABLED === "true",
  MONAD_RPC_URL: process.env.NEXT_PUBLIC_MONAD_RPC_URL || "",
  MONAD_CHAIN_ID: 143,
  NEWS_RSS_FEEDS: (process.env.NEXT_PUBLIC_NEWS_RSS_FEEDS || "").split(",").filter(Boolean),
  SOCIAL_BOT_API_URL: process.env.NEXT_PUBLIC_SOCIAL_BOT_API_URL || "",
} as const;

// Validate required config at startup
export function validateConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  
  if (!CONFIG.ORCHESTRATOR_URL) missing.push("NEXT_PUBLIC_ORCHESTRATOR_URL");
  if (!CONFIG.MONAD_RPC_URL) missing.push("NEXT_PUBLIC_MONAD_RPC_URL");
  
  return { valid: missing.length === 0, missing };
}

// ============================================
// CONNECTION ERROR CLASS
// ============================================

export class ConnectionError extends Error {
  constructor(
    public source: string,
    public code: string,
    message: string,
    public raw?: unknown
  ) {
    super(`[${source}] ${message}`);
    this.name = "ConnectionError";
  }

  toDataSourceError(): DataSourceError {
    return {
      source: this.source,
      message: this.message,
      code: this.code,
      timestamp: new Date(),
      raw: this.raw,
    };
  }
}

// ============================================
// API ENDPOINTS
// ============================================

export const API = {
  // Orchestrator SSE
  orchestrator: {
    stream: () => `${CONFIG.ORCHESTRATOR_URL}/api/stream/events`,
    status: () => `${CONFIG.ORCHESTRATOR_URL}/api/status`,
    runs: (runId: string) => `${CONFIG.ORCHESTRATOR_URL}/api/runs/${runId}/events`,
    health: () => `${CONFIG.ORCHESTRATOR_URL}/health`,
  },
  
  // Trends & Intelligence
  trends: {
    keywords: () => `${CONFIG.ORCHESTRATOR_URL}/api/trends/keywords`,
    sentiment: () => `${CONFIG.ORCHESTRATOR_URL}/api/trends/sentiment`,
    stream: () => `${CONFIG.ORCHESTRATOR_URL}/api/trends/stream`,
  },
  
  // nad.fun Operations
  nadfun: {
    pendingOps: () => `${CONFIG.ORCHESTRATOR_URL}/api/nadfun/pending`,
    approve: (id: string) => `${CONFIG.ORCHESTRATOR_URL}/api/nadfun/approve/${id}`,
    reject: (id: string) => `${CONFIG.ORCHESTRATOR_URL}/api/nadfun/reject/${id}`,
    tokens: () => `${CONFIG.ORCHESTRATOR_URL}/api/nadfun/tokens`,
    bondingCurves: () => `${CONFIG.ORCHESTRATOR_URL}/api/nadfun/bonding-curves`,
  },
  
  // Social Bot
  social: {
    metrics: () => `${CONFIG.SOCIAL_BOT_API_URL}/api/metrics`,
    posts: () => `${CONFIG.SOCIAL_BOT_API_URL}/api/posts`,
    bots: () => `${CONFIG.SOCIAL_BOT_API_URL}/api/bots`,
  },
  
  // Monad Chain
  monad: {
    rpc: () => CONFIG.MONAD_RPC_URL,
  },
};

// ============================================
// FETCH WRAPPER WITH ERROR HANDLING
// ============================================

interface FetchOptions extends RequestInit {
  timeout?: number;
}

export async function liveFetch<T>(
  url: string,
  source: string,
  options: FetchOptions = {}
): Promise<T> {
  const { timeout = 10000, ...fetchOptions } = options;
  
  // Validate URL exists
  if (!url || url.includes("undefined") || url.includes("//api")) {
    throw new ConnectionError(
      source,
      "CONFIG_MISSING",
      `API URL not configured. Check environment variables.`
    );
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...fetchOptions.headers,
      },
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      throw new ConnectionError(
        source,
        `HTTP_${response.status}`,
        `Request failed: ${response.status} ${response.statusText}`,
        errorBody
      );
    }
    
    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof ConnectionError) {
      throw error;
    }
    
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new ConnectionError(source, "TIMEOUT", `Request timed out after ${timeout}ms`);
      }
      if (error.message.includes("fetch")) {
        throw new ConnectionError(
          source,
          "NETWORK_ERROR",
          "Network request failed. Check if backend is running.",
          error
        );
      }
    }
    
    throw new ConnectionError(source, "UNKNOWN", String(error), error);
  }
}

// ============================================
// SSE CONNECTION WRAPPER
// ============================================

export interface SSEConnection {
  connect: () => void;
  disconnect: () => void;
  state: ConnectionState;
  error: DataSourceError | null;
}

export function createSSEConnection(
  url: string,
  source: string,
  onMessage: (data: unknown) => void,
  onStateChange: (state: ConnectionState, error?: DataSourceError) => void
): SSEConnection {
  let eventSource: EventSource | null = null;
  let state: ConnectionState = "disconnected";
  let error: DataSourceError | null = null;
  
  const connect = () => {
    if (!url || url.includes("undefined")) {
      error = {
        source,
        code: "CONFIG_MISSING",
        message: "SSE URL not configured",
        timestamp: new Date(),
      };
      state = "error";
      onStateChange(state, error);
      return;
    }
    
    state = "connecting";
    onStateChange(state);
    
    try {
      eventSource = new EventSource(url);
      
      eventSource.onopen = () => {
        state = "connected";
        error = null;
        onStateChange(state);
      };
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessage(data);
        } catch (e) {
          console.error(`[${source}] Failed to parse SSE message:`, e);
        }
      };
      
      eventSource.onerror = (e) => {
        error = {
          source,
          code: "SSE_ERROR",
          message: "SSE connection failed",
          timestamp: new Date(),
          raw: e,
        };
        state = "error";
        onStateChange(state, error);
        
        // Don't auto-reconnect - let the UI show the error
        eventSource?.close();
      };
    } catch (e) {
      error = {
        source,
        code: "SSE_INIT_FAILED",
        message: String(e),
        timestamp: new Date(),
        raw: e,
      };
      state = "error";
      onStateChange(state, error);
    }
  };
  
  const disconnect = () => {
    eventSource?.close();
    eventSource = null;
    state = "disconnected";
    error = null;
    onStateChange(state);
  };
  
  return {
    connect,
    disconnect,
    get state() { return state; },
    get error() { return error; },
  };
}

// ============================================
// MONAD RPC CLIENT
// ============================================

export async function monadRpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
  const rpcUrl = CONFIG.MONAD_RPC_URL;
  
  if (!rpcUrl) {
    throw new ConnectionError("MONAD_RPC", "CONFIG_MISSING", "MONAD_RPC_URL not configured");
  }
  
  const response = await liveFetch<{ result?: T; error?: { message: string; code: number } }>(
    rpcUrl,
    "MONAD_RPC",
    {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
    }
  );
  
  if (response.error) {
    throw new ConnectionError(
      "MONAD_RPC",
      `RPC_${response.error.code}`,
      response.error.message
    );
  }
  
  return response.result as T;
}

// ============================================
// EXPORTS
// ============================================

export { CONFIG };
