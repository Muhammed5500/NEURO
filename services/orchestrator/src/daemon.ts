/**
 * NEURO Orchestrator Daemon
 * 
 * Long-running process that:
 * - Listens to Ingestion service for real-time signals
 * - Queries Memory service for historical context
 * - Fetches live market data from Monad RPC
 * - Triggers Agent Graph runs when signals arrive
 * - Exposes HTTP/SSE API for Dashboard
 * 
 * Usage: node dist/daemon.js
 * 
 * Turkish: "Fixture yerine canlı veri akışı ile çalışan daemon"
 */

import "dotenv/config";

import { orchestratorLogger as logger } from "@neuro/shared";
import { loadOrchestratorConfig } from "./config.js";
import { getSSEServer } from "./api/sse-server.js";
import { 
  createLiveDataService, 
  LiveDataService,
  type RunResult,
} from "./live/live-data-service.js";
import { ConnectionError } from "./live/ingestion-bridge.js";

const daemonLogger = logger.child({ component: "daemon" });

// ============================================
// DAEMON CONFIGURATION
// ============================================

interface DaemonConfig {
  // HTTP/SSE Server
  httpPort: number;
  
  // Live Data Services
  redisUrl?: string;
  qdrantUrl?: string;
  qdrantApiKey?: string;
  monadRpcUrl: string;
  nadfunApiUrl?: string;
  nadfunApiKey?: string;
  openaiApiKey?: string;
  
  // Processing
  minSignalsForRun: number;
  runCooldownMs: number;
  enableMemoryLookup: boolean;
  enableMarketData: boolean;
}

function loadDaemonConfig(): DaemonConfig {
  return {
    // HTTP/SSE
    httpPort: parseInt(process.env.ORCHESTRATOR_PORT || "4000", 10),
    
    // Services
    redisUrl: process.env.REDIS_URL,
    qdrantUrl: process.env.QDRANT_URL,
    qdrantApiKey: process.env.QDRANT_API_KEY,
    monadRpcUrl: process.env.MONAD_RPC_URL || "https://rpc.monad.xyz",
    nadfunApiUrl: process.env.NADFUN_API_URL || "https://api.nadapp.net",
    nadfunApiKey: process.env.NADFUN_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    
    // Processing
    minSignalsForRun: parseInt(process.env.MIN_SIGNALS_FOR_RUN || "3", 10),
    runCooldownMs: parseInt(process.env.RUN_COOLDOWN_MS || "5000", 10),
    enableMemoryLookup: process.env.ENABLE_MEMORY_LOOKUP !== "false",
    enableMarketData: process.env.ENABLE_MARKET_DATA !== "false",
  };
}

// ============================================
// DAEMON MAIN
// ============================================

let liveDataService: LiveDataService | null = null;
let isShuttingDown = false;

async function main(): Promise<void> {
  daemonLogger.info("╔══════════════════════════════════════════════════════════╗");
  daemonLogger.info("║     NEURO Orchestrator Daemon - Live Data Pipeline      ║");
  daemonLogger.info("╚══════════════════════════════════════════════════════════╝");

  // Load configs
  const daemonConfig = loadDaemonConfig();
  const orchestratorConfig = loadOrchestratorConfig();

  daemonLogger.info({
    httpPort: daemonConfig.httpPort,
    redisConfigured: !!daemonConfig.redisUrl,
    qdrantConfigured: !!daemonConfig.qdrantUrl,
    monadRpcUrl: daemonConfig.monadRpcUrl,
    minSignalsForRun: daemonConfig.minSignalsForRun,
  }, "Configuration loaded");

  // Start HTTP/SSE server
  const sseServer = getSSEServer();
  sseServer.start(daemonConfig.httpPort);
  daemonLogger.info({ port: daemonConfig.httpPort }, "HTTP/SSE API server started");

  // Initialize Live Data Service
  liveDataService = createLiveDataService(
    {
      redisUrl: daemonConfig.redisUrl,
      qdrantUrl: daemonConfig.qdrantUrl,
      qdrantApiKey: daemonConfig.qdrantApiKey,
      monadRpcUrl: daemonConfig.monadRpcUrl,
      nadfunApiUrl: daemonConfig.nadfunApiUrl,
      nadfunApiKey: daemonConfig.nadfunApiKey,
      openaiApiKey: daemonConfig.openaiApiKey,
      minSignalsForRun: daemonConfig.minSignalsForRun,
      runCooldownMs: daemonConfig.runCooldownMs,
      enableMemoryLookup: daemonConfig.enableMemoryLookup,
      enableMarketData: daemonConfig.enableMarketData,
    },
    orchestratorConfig
  );

  // Set up event handlers
  liveDataService.on("run:complete", (result: RunResult) => {
    daemonLogger.info({
      runId: result.runId,
      decision: result.decision?.status,
      confidence: result.decision?.confidence,
      duration: result.duration,
      signals: result.signalsProcessed,
    }, "Agent run completed");

    // Emit to SSE clients
    if (result.decision) {
      sseServer.emitEvent({
        runId: result.runId,
        type: "CONSENSUS_RESULT",
        severity: "info",
        message: `Decision: ${result.decision.status} (confidence: ${(result.decision.confidence * 100).toFixed(1)}%)`,
        data: {
          decision: result.decision,
          signalsProcessed: result.signalsProcessed,
          duration: result.duration,
        },
      });
    }
  });

  liveDataService.on("run:error", (result: RunResult) => {
    daemonLogger.error({
      runId: result.runId,
      error: result.error,
    }, "Agent run failed");

    sseServer.emitEvent({
      runId: result.runId,
      type: "SYSTEM_MESSAGE",
      severity: "error",
      message: `Run failed: ${result.error}`,
    });
  });

  liveDataService.on("error", (err: Error) => {
    if (err instanceof ConnectionError) {
      daemonLogger.error({
        service: err.service,
        code: err.code,
        message: err.message,
      }, "Service connection error");
    } else {
      daemonLogger.error({ error: err }, "Live data service error");
    }
  });

  // Initialize and start
  try {
    await liveDataService.initialize();
    await liveDataService.start();

    // Log health status
    const health = await liveDataService.getHealth();
    daemonLogger.info({
      status: health.status,
      services: health.services,
    }, "Service health status");

    if (!health.services.ingestion) {
      daemonLogger.warn("Ingestion service not connected - no live signals will be received");
      daemonLogger.warn("Configure REDIS_URL to enable ingestion streaming");
    }

    if (!health.services.memory) {
      daemonLogger.warn("Memory service not connected - historical context disabled");
      daemonLogger.warn("Configure QDRANT_URL to enable memory lookups");
    }

  } catch (err) {
    daemonLogger.error({ error: err }, "Failed to start Live Data Service");
  }

  // Final status
  daemonLogger.info("═══════════════════════════════════════════════════════════");
  daemonLogger.info("NEURO Daemon is running in WATCH MODE");
  daemonLogger.info("Waiting for signals from Ingestion service...");
  daemonLogger.info(`Dashboard API available at http://localhost:${daemonConfig.httpPort}`);
  daemonLogger.info("═══════════════════════════════════════════════════════════");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    daemonLogger.info({ signal }, "Shutting down NEURO Daemon...");

    if (liveDataService) {
      await liveDataService.stop();
    }

    sseServer.stop();

    daemonLogger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Keep alive
  await new Promise(() => {});
}

// ============================================
// RUN
// ============================================

main().catch((error) => {
  daemonLogger.fatal({ error }, "Fatal error in NEURO Daemon");
  process.exit(1);
});
