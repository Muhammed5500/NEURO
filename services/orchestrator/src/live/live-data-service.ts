/**
 * Live Data Service
 * 
 * Coordinates real-time data flow from Ingestion, Memory, and Market services.
 * Triggers Agent Graph runs when new signals arrive.
 * 
 * Turkish: "Tüm canlı veri servislerini koordine et ve agent graph'i tetikle"
 */

import { EventEmitter } from "events";
import { orchestratorLogger as logger } from "@neuro/shared";
import { 
  IngestionBridge, 
  createIngestionBridge,
  type SignalBatch,
  ConnectionError,
} from "./ingestion-bridge.js";
import { MemoryClient, createMemoryClient } from "./memory-client.js";
import { MarketDataService, createMarketDataService } from "./market-data-service.js";
import { createAgentGraph, runConsensusGraph, type CompiledAgentGraph } from "../graph/agent-graph.js";
import type { OrchestratorConfig } from "../config.js";
import type { InputSignals, MemorySimilarity, FinalDecision } from "../graph/state.js";

const liveLogger = logger.child({ component: "live-data-service" });

// ============================================
// TYPES
// ============================================

export interface LiveDataServiceConfig {
  // Redis for ingestion
  redisUrl?: string;
  
  // Qdrant for memory
  qdrantUrl?: string;
  qdrantApiKey?: string;
  
  // Monad for on-chain
  monadRpcUrl: string;
  nadfunApiUrl?: string;
  nadfunApiKey?: string;
  
  // OpenAI for embeddings
  openaiApiKey?: string;
  
  // Processing
  minSignalsForRun?: number;
  runCooldownMs?: number;
  enableMemoryLookup?: boolean;
  enableMarketData?: boolean;
}

export interface RunResult {
  runId: string;
  decision: FinalDecision | null;
  error: string | null;
  duration: number;
  signalsProcessed: {
    news: number;
    social: number;
    memory: number;
  };
}

export type ServiceStatus = "stopped" | "starting" | "running" | "error";

// ============================================
// LIVE DATA SERVICE
// ============================================

export class LiveDataService extends EventEmitter {
  private config: LiveDataServiceConfig;
  private orchestratorConfig: OrchestratorConfig;
  
  // Components
  private ingestionBridge: IngestionBridge | null = null;
  private memoryClient: MemoryClient | null = null;
  private marketDataService: MarketDataService | null = null;
  private agentGraph: CompiledAgentGraph | null = null;
  
  // State
  private status: ServiceStatus = "stopped";
  private runCount = 0;
  private lastRunAt: Date | null = null;
  private pendingSignals: SignalBatch | null = null;
  private runCooldownTimer: NodeJS.Timeout | null = null;

  constructor(
    config: LiveDataServiceConfig,
    orchestratorConfig: OrchestratorConfig
  ) {
    super();
    this.config = config;
    this.orchestratorConfig = orchestratorConfig;
    this.setMaxListeners(50);
  }

  /**
   * Initialize all services
   */
  async initialize(): Promise<void> {
    this.status = "starting";
    liveLogger.info("Initializing Live Data Service...");

    const errors: string[] = [];

    // Initialize Ingestion Bridge (if Redis configured)
    if (this.config.redisUrl) {
      try {
        this.ingestionBridge = createIngestionBridge({
          redisUrl: this.config.redisUrl,
        });
        await this.ingestionBridge.connect();
        this.setupIngestionHandlers();
        liveLogger.info("Ingestion Bridge connected");
      } catch (err) {
        const error = err instanceof ConnectionError ? err : new Error(String(err));
        errors.push(`Ingestion: ${error.message}`);
        liveLogger.error({ error }, "Failed to connect Ingestion Bridge");
      }
    } else {
      liveLogger.warn("Redis URL not configured - Ingestion Bridge disabled");
    }

    // Initialize Memory Client (if Qdrant configured)
    if (this.config.qdrantUrl && this.config.enableMemoryLookup !== false) {
      try {
        this.memoryClient = createMemoryClient({
          qdrantUrl: this.config.qdrantUrl,
          qdrantApiKey: this.config.qdrantApiKey,
          openaiApiKey: this.config.openaiApiKey,
        });
        await this.memoryClient.initialize();
        liveLogger.info("Memory Client connected");
      } catch (err) {
        const error = err instanceof ConnectionError ? err : new Error(String(err));
        errors.push(`Memory: ${error.message}`);
        liveLogger.error({ error }, "Failed to connect Memory Client");
      }
    } else {
      liveLogger.warn("Qdrant URL not configured - Memory lookups disabled");
    }

    // Initialize Market Data Service
    if (this.config.monadRpcUrl && this.config.enableMarketData !== false) {
      try {
        this.marketDataService = createMarketDataService({
          monadRpcUrl: this.config.monadRpcUrl,
          nadfunApiUrl: this.config.nadfunApiUrl,
          nadfunApiKey: this.config.nadfunApiKey,
        });
        await this.marketDataService.initialize();
        liveLogger.info("Market Data Service connected");
      } catch (err) {
        const error = err instanceof ConnectionError ? err : new Error(String(err));
        errors.push(`Market: ${error.message}`);
        liveLogger.error({ error }, "Failed to connect Market Data Service");
      }
    } else {
      liveLogger.warn("Monad RPC URL not configured - Market data disabled");
    }

    // Initialize Agent Graph
    try {
      this.agentGraph = await createAgentGraph(this.orchestratorConfig, {
        consensusConfig: {
          confidenceThreshold: this.orchestratorConfig.consensusConfidenceThreshold,
          adversarialVetoThreshold: this.orchestratorConfig.adversarialVetoThreshold,
          minAgentsRequired: this.orchestratorConfig.minAgentsForConsensus,
          agreementThreshold: this.orchestratorConfig.consensusAgreementThreshold,
          decisionExpiryMinutes: 30,
        },
        runRecordPath: this.orchestratorConfig.runRecordPath,
      });
      liveLogger.info("Agent Graph initialized");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      errors.push(`AgentGraph: ${error.message}`);
      liveLogger.error({ error }, "Failed to initialize Agent Graph");
    }

    // Report status
    if (errors.length > 0) {
      liveLogger.warn({ errors }, "Some services failed to initialize");
    }

    this.status = errors.length === 0 ? "running" : "error";
    liveLogger.info({ status: this.status }, "Live Data Service initialized");
  }

  /**
   * Start the daemon loop
   */
  async start(): Promise<void> {
    if (this.status !== "running" && this.status !== "error") {
      await this.initialize();
    }

    // Start ingestion consumer
    if (this.ingestionBridge) {
      // Don't await - runs in background
      this.ingestionBridge.start().catch((err) => {
        liveLogger.error({ error: err }, "Ingestion bridge error");
        this.emit("error", err);
      });
    }

    liveLogger.info("Live Data Service started - listening for signals");
    this.emit("started");
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    liveLogger.info("Stopping Live Data Service...");
    this.status = "stopped";

    if (this.runCooldownTimer) {
      clearTimeout(this.runCooldownTimer);
      this.runCooldownTimer = null;
    }

    if (this.ingestionBridge) {
      await this.ingestionBridge.stop();
    }

    liveLogger.info("Live Data Service stopped");
    this.emit("stopped");
  }

  /**
   * Manually trigger a run with provided signals
   */
  async triggerRun(
    query: string,
    partialSignals?: Partial<InputSignals>
  ): Promise<RunResult> {
    const runId = `run-${Date.now()}-${++this.runCount}`;
    const startTime = Date.now();

    liveLogger.info({ runId, query }, "Triggering agent run");

    try {
      // Build full signals
      const signals = await this.buildSignals(query, partialSignals);

      // Check minimum signals
      const minSignals = this.config.minSignalsForRun || 1;
      const totalSignals = signals.news.length + signals.social.length;
      
      if (totalSignals < minSignals && !partialSignals?.targetToken) {
        liveLogger.warn(
          { totalSignals, minSignals },
          "Not enough signals for run"
        );
        return {
          runId,
          decision: null,
          error: `Not enough signals: ${totalSignals} < ${minSignals}`,
          duration: Date.now() - startTime,
          signalsProcessed: {
            news: signals.news.length,
            social: signals.social.length,
            memory: signals.memory.length,
          },
        };
      }

      // Run agent graph
      if (!this.agentGraph) {
        throw new Error("Agent graph not initialized");
      }

      const result = await runConsensusGraph(this.agentGraph, {
        signals,
        query,
        runId,
      });

      this.lastRunAt = new Date();
      
      const runResult: RunResult = {
        runId,
        decision: result.decision,
        error: result.error,
        duration: Date.now() - startTime,
        signalsProcessed: {
          news: signals.news.length,
          social: signals.social.length,
          memory: signals.memory.length,
        },
      };

      liveLogger.info(
        { 
          runId, 
          decision: result.decision?.status,
          duration: runResult.duration,
        },
        "Agent run completed"
      );

      this.emit("run:complete", runResult);
      return runResult;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      liveLogger.error({ runId, error }, "Agent run failed");

      const runResult: RunResult = {
        runId,
        decision: null,
        error: error.message,
        duration: Date.now() - startTime,
        signalsProcessed: { news: 0, social: 0, memory: 0 },
      };

      this.emit("run:error", runResult);
      return runResult;
    }
  }

  /**
   * Get service health status
   */
  async getHealth(): Promise<{
    status: ServiceStatus;
    services: {
      ingestion: boolean;
      memory: boolean;
      market: boolean;
      agentGraph: boolean;
    };
    stats: {
      runCount: number;
      lastRunAt: Date | null;
    };
  }> {
    const [ingestionHealth, memoryHealth, marketHealth] = await Promise.all([
      this.ingestionBridge?.isHealthy() ?? false,
      this.memoryClient?.isHealthy() ?? false,
      this.marketDataService?.isHealthy() ?? false,
    ]);

    return {
      status: this.status,
      services: {
        ingestion: ingestionHealth,
        memory: memoryHealth,
        market: marketHealth,
        agentGraph: this.agentGraph !== null,
      },
      stats: {
        runCount: this.runCount,
        lastRunAt: this.lastRunAt,
      },
    };
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private setupIngestionHandlers(): void {
    if (!this.ingestionBridge) return;

    this.ingestionBridge.on("signals", (batch: SignalBatch) => {
      liveLogger.debug(
        { newsCount: batch.news.length, socialCount: batch.social.length },
        "Received signal batch"
      );

      // Merge with pending signals
      if (this.pendingSignals) {
        this.pendingSignals.news.push(...batch.news);
        this.pendingSignals.social.push(...batch.social);
        this.pendingSignals.rawEvents.push(...batch.rawEvents);
      } else {
        this.pendingSignals = batch;
      }

      // Check if we should trigger a run
      this.maybeScheduleRun();
    });

    this.ingestionBridge.on("error", (err: Error) => {
      liveLogger.error({ error: err }, "Ingestion bridge error");
      this.emit("error", new ConnectionError(
        "INGESTION_BRIDGE",
        "STREAM_ERROR",
        err.message,
        err
      ));
    });
  }

  private maybeScheduleRun(): void {
    if (!this.pendingSignals) return;

    const minSignals = this.config.minSignalsForRun || 3;
    const totalSignals = 
      this.pendingSignals.news.length + this.pendingSignals.social.length;

    if (totalSignals < minSignals) {
      return;
    }

    // Apply cooldown
    const cooldown = this.config.runCooldownMs || 5000;
    if (this.lastRunAt) {
      const elapsed = Date.now() - this.lastRunAt.getTime();
      if (elapsed < cooldown) {
        // Schedule for later
        if (!this.runCooldownTimer) {
          this.runCooldownTimer = setTimeout(() => {
            this.runCooldownTimer = null;
            this.processSignals();
          }, cooldown - elapsed);
        }
        return;
      }
    }

    this.processSignals();
  }

  private async processSignals(): Promise<void> {
    if (!this.pendingSignals) return;

    const batch = this.pendingSignals;
    this.pendingSignals = null;

    // Generate query from signals
    const query = this.generateQueryFromSignals(batch);

    // Trigger run
    await this.triggerRun(query, {
      news: batch.news,
      social: batch.social,
    });
  }

  private generateQueryFromSignals(batch: SignalBatch): string {
    // Extract common tickers
    const tickers = new Set<string>();
    batch.news.forEach((n) => n.tickers.forEach((t) => tickers.add(t)));
    batch.social.forEach((s) => s.tickers.forEach((t) => tickers.add(t)));

    const tickerList = Array.from(tickers).slice(0, 5).join(", ");

    if (tickerList) {
      return `Analyze recent market activity for ${tickerList} and recommend action`;
    }

    return "Analyze recent market signals and recommend action";
  }

  private async buildSignals(
    query: string,
    partial?: Partial<InputSignals>
  ): Promise<InputSignals> {
    const signals: InputSignals = {
      news: partial?.news || [],
      social: partial?.social || [],
      onchain: partial?.onchain || null,
      memory: partial?.memory || [],
      query,
      targetToken: partial?.targetToken,
    };

    // Fetch memory similarities
    if (this.memoryClient && signals.news.length > 0) {
      try {
        const primaryNews = signals.news[0];
        const memories = await this.memoryClient.findSimilarForNews(
          primaryNews.title,
          primaryNews.content,
          primaryNews.tickers,
          5
        );
        signals.memory = memories;
        liveLogger.debug({ count: memories.length }, "Fetched memory similarities");
      } catch (err) {
        liveLogger.warn({ error: err }, "Failed to fetch memory similarities");
        // Continue without memory - don't fail the run
      }
    }

    // Fetch on-chain data
    if (this.marketDataService && !signals.onchain) {
      try {
        signals.onchain = await this.marketDataService.getOnChainSignal(
          signals.targetToken?.address
        );
        liveLogger.debug(
          { blockNumber: signals.onchain.blockNumber },
          "Fetched on-chain data"
        );
      } catch (err) {
        liveLogger.warn({ error: err }, "Failed to fetch on-chain data");
        // Continue without on-chain - don't fail the run
      }
    }

    return signals;
  }
}

// ============================================
// FACTORY
// ============================================

export function createLiveDataService(
  config: LiveDataServiceConfig,
  orchestratorConfig: OrchestratorConfig
): LiveDataService {
  return new LiveDataService(config, orchestratorConfig);
}
