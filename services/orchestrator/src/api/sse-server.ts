/**
 * SSE Server for Agent Event Streaming
 * 
 * Provides Server-Sent Events endpoint for real-time agent message streaming
 * Turkish: "Orchestrator'dan gelen AgentEvent akışını SSE üzerinden kesintisiz dinle"
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { orchestratorLogger as logger } from "@neuro/shared";
import { EventEmitter } from "events";
import * as crypto from "crypto";
import type { AgentRole } from "../graph/state.js";

const sseLogger = logger.child({ component: "sse-server" });

// ============================================
// EVENT TYPES
// ============================================

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

export interface AgentEvent {
  id: string;
  runId: string;
  timestamp: number;
  type: EventType;
  severity: EventSeverity;
  agent?: AgentRole;
  message: string;
  data?: Record<string, unknown>;
  chainOfThought?: string;
  actionCard?: {
    id: string;
    priority: "low" | "medium" | "high" | "critical";
    suggestedAction: string;
    tokenSymbol?: string;
  };
}

// ============================================
// EVENT STORAGE (IN-MEMORY FOR NOW)
// ============================================

interface RunRecord {
  id: string;
  startedAt: number;
  completedAt?: number;
  status: "running" | "completed" | "failed" | "cancelled";
  query: string;
  tokenAddress?: string;
  tokenSymbol?: string;
  events: AgentEvent[];
}

class EventStore {
  private readonly runs: Map<string, RunRecord> = new Map();
  private readonly maxRuns = 100;
  private readonly maxEventsPerRun = 1000;

  addEvent(event: AgentEvent): void {
    let run = this.runs.get(event.runId);
    
    if (!run) {
      run = {
        id: event.runId,
        startedAt: event.timestamp,
        status: "running",
        query: "",
        events: [],
      };
      this.runs.set(event.runId, run);

      // Trim old runs
      if (this.runs.size > this.maxRuns) {
        const oldestKey = this.runs.keys().next().value;
        if (oldestKey) this.runs.delete(oldestKey);
      }
    }

    run.events.push(event);

    // Trim events
    if (run.events.length > this.maxEventsPerRun) {
      run.events.splice(0, run.events.length - this.maxEventsPerRun);
    }

    // Update run status based on event
    if (event.type === "CONSENSUS_RESULT") {
      run.completedAt = event.timestamp;
      run.status = "completed";
    }
  }

  getRunEvents(runId: string): AgentEvent[] {
    return this.runs.get(runId)?.events || [];
  }

  getRun(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }

  getAllRuns(): RunRecord[] {
    return Array.from(this.runs.values())
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  setRunMetadata(runId: string, metadata: Partial<RunRecord>): void {
    const run = this.runs.get(runId);
    if (run) {
      Object.assign(run, metadata);
    }
  }
}

// ============================================
// SSE SERVER
// ============================================

export class SSEServer {
  private readonly emitter = new EventEmitter();
  private readonly store = new EventStore();
  private readonly clients: Map<string, ServerResponse> = new Map();
  private readonly trendStreamClients: Map<string, ServerResponse> = new Map();
  private server: ReturnType<typeof createServer> | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private trendHeartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.emitter.setMaxListeners(100);
    sseLogger.info("SSEServer initialized");
  }

  /**
   * Start the SSE server
   */
  start(port: number = 4000): void {
    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.server.listen(port, () => {
      sseLogger.info({ port }, "SSE server listening");
    });

    // Start heartbeat for agent event clients
    this.heartbeatInterval = setInterval(() => {
      this.broadcast({ type: "heartbeat", timestamp: Date.now() });
    }, 30000);

    // Heartbeat for trends stream clients (keeps SSE connection alive)
    this.trendHeartbeatInterval = setInterval(() => {
      const msg = { type: "heartbeat", timestamp: Date.now() };
      for (const [, res] of this.trendStreamClients) {
        this.sendTrendToClient(res, msg);
      }
    }, 15000);
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.trendHeartbeatInterval) {
      clearInterval(this.trendHeartbeatInterval);
      this.trendHeartbeatInterval = null;
    }
    if (this.server) {
      this.server.close();
    }
    this.clients.clear();
    this.trendStreamClients.clear();
    sseLogger.info("SSE server stopped");
  }

  /**
   * Emit an agent event
   */
  emitEvent(event: Omit<AgentEvent, "id" | "timestamp">): AgentEvent {
    const fullEvent: AgentEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };

    this.store.addEvent(fullEvent);
    this.broadcast(fullEvent, "agent_event");

    sseLogger.debug({
      eventId: fullEvent.id,
      runId: fullEvent.runId,
      type: fullEvent.type,
      agent: fullEvent.agent,
    }, "Event emitted");

    return fullEvent;
  }

  /**
   * Set run metadata
   */
  setRunMetadata(runId: string, metadata: {
    query?: string;
    tokenAddress?: string;
    tokenSymbol?: string;
  }): void {
    this.store.setRunMetadata(runId, metadata);
  }

  /**
   * Get event store (for API access)
   */
  getStore(): EventStore {
    return this.store;
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = url.pathname;

    // Route handling
    if (pathname === "/api/stream/events") {
      this.handleSSEConnection(req, res, url);
    } else if (pathname.startsWith("/api/runs/") && pathname.endsWith("/events")) {
      this.handleRunEvents(req, res, pathname);
    } else if (pathname === "/api/runs") {
      this.handleListRuns(req, res);
    } else if (pathname === "/api/metrics") {
      this.handleMetrics(req, res);
    } else if (pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", clients: this.clients.size }));
    } else if (pathname === "/api/status") {
      this.handleApiStatus(req, res);
    } else if (pathname === "/api/ingestion/health") {
      this.jsonOk(res, { status: "ok" });
    } else if (pathname === "/api/execution/health") {
      this.jsonOk(res, { status: "ok" });
    } else if (pathname === "/api/memory/health") {
      this.jsonOk(res, { status: "ok" });
    } else if (pathname === "/api/trends/keywords") {
      this.handleTrendsKeywords(req, res);
    } else if (pathname === "/api/trends/sentiment") {
      this.handleTrendsSentiment(req, res);
    } else if (pathname === "/api/trends/stream") {
      this.handleTrendsStream(req, res);
    } else if (pathname === "/api/nadfun/pending") {
      this.handleNadfunPending(req, res);
    } else if (pathname.startsWith("/api/nadfun/approve/") && req.method === "POST") {
      this.handleNadfunApprove(req, res, pathname);
    } else if (pathname.startsWith("/api/nadfun/reject/") && req.method === "POST") {
      this.handleNadfunReject(req, res, pathname);
    } else if (pathname === "/api/nadfun/tokens") {
      this.handleNadfunTokens(req, res);
    } else if (pathname === "/api/nadfun/bonding-curves") {
      this.handleNadfunBondingCurves(req, res);
    } else if (pathname === "/" || pathname === "/api") {
      this.handleRoot(req, res);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  }

  private jsonOk(res: ServerResponse, data: object): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  private handleRoot(_req: IncomingMessage, res: ServerResponse): void {
    this.jsonOk(res, {
      service: "NEURO Orchestrator Daemon",
      version: "1.0.0",
      status: "running",
      endpoints: {
        health: "/health",
        status: "/api/status",
        runs: "/api/runs",
        stream: "/api/stream/events",
        metrics: "/api/metrics",
        trends: "/api/trends/keywords",
        trendsSentiment: "/api/trends/sentiment",
        trendsStream: "/api/trends/stream",
      },
    });
  }

  private handleApiStatus(_req: IncomingMessage, res: ServerResponse): void {
    const now = new Date().toISOString();
    const status = {
      execution: { status: "offline" as const, latency: null, lastCheck: now, error: undefined },
      orchestrator: { status: "online" as const, latency: 0, lastCheck: now, error: undefined },
      ingestion: { status: "offline" as const, latency: null, lastCheck: now, error: undefined },
      database: { status: "offline" as const, latency: null, lastCheck: now, error: undefined },
      killSwitchEnabled: process.env.KILL_SWITCH_ENABLED === "true",
      executionMode: (process.env.EXECUTION_MODE || "READ_ONLY") as "READ_ONLY" | "WRITE_ENABLED" | "DEMO",
      chainStats: { blockNumber: null as number | null, gasPrice: null as number | null, connected: false },
    };
    this.jsonOk(res, status);
  }

  private handleTrendsKeywords(_req: IncomingMessage, res: ServerResponse): void {
    this.jsonOk(res, { keywords: [] });
  }

  private handleTrendsSentiment(_req: IncomingMessage, res: ServerResponse): void {
    this.jsonOk(res, {
      overall: 0,
      bullish: 0,
      bearish: 0,
      neutral: 0,
      volume: 0,
      lastUpdated: new Date().toISOString(),
    });
  }

  private handleTrendsStream(req: IncomingMessage, res: ServerResponse): void {
    const clientId = crypto.randomUUID();
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    this.trendStreamClients.set(clientId, res);
    this.sendTrendToClient(res, { type: "connected", clientId });
    req.on("close", () => {
      this.trendStreamClients.delete(clientId);
    });
  }

  private sendTrendToClient(res: ServerResponse, data: unknown): void {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      sseLogger.error({ error: err }, "Failed to send to trend client");
    }
  }

  private handleNadfunPending(_req: IncomingMessage, res: ServerResponse): void {
    this.jsonOk(res, { operations: [] });
  }

  private handleNadfunApprove(_req: IncomingMessage, res: ServerResponse, pathname: string): void {
    const id = pathname.replace("/api/nadfun/approve/", "").trim();
    if (!id) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing operation id" }));
      return;
    }
    this.jsonOk(res, { ok: true, id });
  }

  private handleNadfunReject(_req: IncomingMessage, res: ServerResponse, pathname: string): void {
    const id = pathname.replace("/api/nadfun/reject/", "").trim();
    if (!id) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing operation id" }));
      return;
    }
    this.jsonOk(res, { ok: true, id });
  }

  private handleNadfunTokens(_req: IncomingMessage, res: ServerResponse): void {
    this.jsonOk(res, { tokens: [] });
  }

  private handleNadfunBondingCurves(_req: IncomingMessage, res: ServerResponse): void {
    this.jsonOk(res, { tokens: [] });
  }

  private handleSSEConnection(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL
  ): void {
    const clientId = crypto.randomUUID();

    // SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Parse filters
    const runId = url.searchParams.get("runId");
    const agents = url.searchParams.get("agents")?.split(",") as AgentRole[] | undefined;
    const severities = url.searchParams.get("severities")?.split(",") as EventSeverity[] | undefined;
    const types = url.searchParams.get("types")?.split(",") as EventType[] | undefined;

    // Store client with filter info
    (res as any).filters = { runId, agents, severities, types };
    this.clients.set(clientId, res);

    sseLogger.info({ clientId, filters: { runId, agents, severities, types } }, "Client connected");

    // Send initial connection event
    this.sendToClient(res, { type: "connected", clientId });

    // Handle disconnect
    req.on("close", () => {
      this.clients.delete(clientId);
      sseLogger.info({ clientId }, "Client disconnected");
    });
  }

  private handleRunEvents(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string
  ): void {
    // Extract run ID from path: /api/runs/:runId/events
    const match = pathname.match(/\/api\/runs\/([^/]+)\/events/);
    const runId = match?.[1];

    if (!runId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid run ID" }));
      return;
    }

    const events = this.store.getRunEvents(runId);
    const run = this.store.getRun(runId);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      runId,
      run: run ? {
        id: run.id,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        status: run.status,
        query: run.query,
        tokenAddress: run.tokenAddress,
        tokenSymbol: run.tokenSymbol,
        eventCount: run.events.length,
      } : null,
      events,
    }));
  }

  private handleListRuns(req: IncomingMessage, res: ServerResponse): void {
    const runs = this.store.getAllRuns().map(run => ({
      id: run.id,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      status: run.status,
      query: run.query,
      tokenAddress: run.tokenAddress,
      tokenSymbol: run.tokenSymbol,
      eventCount: run.events.length,
    }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ runs }));
  }

  private handleMetrics(_req: IncomingMessage, res: ServerResponse): void {
    (async () => {
      try {
        const { getMetricsService } = await import("../metrics/metrics-service.js");
        const metricsService = getMetricsService();
        const data = metricsService.getDashboardData();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      } catch (err) {
        sseLogger.error({ error: err }, "Failed to get metrics");
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to get metrics" }));
      }
    })();
  }

  private broadcast(data: unknown, eventType?: string): void {
    const message = eventType
      ? `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
      : `data: ${JSON.stringify(data)}\n\n`;

    for (const [clientId, res] of this.clients) {
      try {
        // Apply filters if present
        const filters = (res as any).filters;
        if (filters && data && typeof data === "object" && "runId" in data) {
          const event = data as AgentEvent;
          
          if (filters.runId && event.runId !== filters.runId) continue;
          if (filters.agents?.length && event.agent && !filters.agents.includes(event.agent)) continue;
          if (filters.severities?.length && !filters.severities.includes(event.severity)) continue;
          if (filters.types?.length && !filters.types.includes(event.type)) continue;
        }

        res.write(message);
      } catch (err) {
        sseLogger.error({ clientId, error: err }, "Failed to send to client");
        this.clients.delete(clientId);
      }
    }
  }

  private sendToClient(res: ServerResponse, data: unknown, eventType?: string): void {
    const message = eventType
      ? `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
      : `data: ${JSON.stringify(data)}\n\n`;

    try {
      res.write(message);
    } catch (err) {
      sseLogger.error({ error: err }, "Failed to send to client");
    }
  }
}

// Singleton instance
let sseServer: SSEServer | null = null;

export function getSSEServer(): SSEServer {
  if (!sseServer) {
    sseServer = new SSEServer();
  }
  return sseServer;
}

export function createSSEServer(): SSEServer {
  return new SSEServer();
}
