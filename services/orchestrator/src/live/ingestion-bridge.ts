/**
 * Ingestion Bridge
 * 
 * Connects to Redis Streams (or NATS) to receive real-time ingestion events
 * from the Rust Ingestion Service and converts them to InputSignals.
 * 
 * Turkish: "Ingestion servisinden gelen verileri Orchestrator'a köprüle"
 */

import Redis from "ioredis";
import { EventEmitter } from "events";
import { orchestratorLogger as logger } from "@neuro/shared";
import type { IngestionEvent } from "@neuro/shared";
import type { NewsSignal, SocialSignal, InputSignals } from "../graph/state.js";

const bridgeLogger = logger.child({ component: "ingestion-bridge" });

// ============================================
// TYPES
// ============================================

export interface IngestionBridgeConfig {
  redisUrl: string;
  streamName?: string;
  consumerGroup?: string;
  consumerName?: string;
  batchSize?: number;
  blockTimeMs?: number;
  maxRetries?: number;
}

export interface SignalBatch {
  news: NewsSignal[];
  social: SocialSignal[];
  rawEvents: IngestionEvent[];
  timestamp: Date;
}

export class ConnectionError extends Error {
  constructor(
    public service: string,
    public code: string,
    message: string,
    public cause?: Error
  ) {
    super(`[${service}] ${message}`);
    this.name = "ConnectionError";
  }
}

// ============================================
// INGESTION BRIDGE
// ============================================

export class IngestionBridge extends EventEmitter {
  private config: Required<IngestionBridgeConfig>;
  private redis: Redis | null = null;
  private running = false;
  private lastMessageId = "0";
  private signalBuffer: SignalBatch;
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(config: IngestionBridgeConfig) {
    super();
    
    this.config = {
      redisUrl: config.redisUrl,
      streamName: config.streamName || "neuro:ingestion",
      consumerGroup: config.consumerGroup || "orchestrator",
      consumerName: config.consumerName || `orchestrator-${process.pid}`,
      batchSize: config.batchSize || 100,
      blockTimeMs: config.blockTimeMs || 5000,
      maxRetries: config.maxRetries || 3,
    };

    this.signalBuffer = this.createEmptyBatch();
    this.setMaxListeners(50);
  }

  /**
   * Connect to Redis and create consumer group
   */
  async connect(): Promise<void> {
    try {
      this.redis = new Redis(this.config.redisUrl, {
        maxRetriesPerRequest: this.config.maxRetries,
        retryStrategy: (times) => {
          if (times > this.config.maxRetries) {
            return null;
          }
          return Math.min(times * 200, 2000);
        },
      });

      // Test connection
      await this.redis.ping();
      bridgeLogger.info({ redisUrl: this.config.redisUrl }, "Connected to Redis");

      // Create consumer group (ignore error if already exists)
      try {
        await this.redis.xgroup(
          "CREATE",
          this.config.streamName,
          this.config.consumerGroup,
          "0",
          "MKSTREAM"
        );
        bridgeLogger.info(
          { group: this.config.consumerGroup, stream: this.config.streamName },
          "Consumer group created"
        );
      } catch (err: any) {
        if (!err.message?.includes("BUSYGROUP")) {
          throw err;
        }
        bridgeLogger.debug("Consumer group already exists");
      }

      this.emit("connected");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new ConnectionError(
        "INGESTION_BRIDGE",
        "REDIS_CONNECTION_FAILED",
        `Failed to connect to Redis: ${error.message}`,
        error
      );
    }
  }

  /**
   * Start consuming messages
   */
  async start(): Promise<void> {
    if (!this.redis) {
      throw new ConnectionError(
        "INGESTION_BRIDGE",
        "NOT_CONNECTED",
        "Must call connect() before start()"
      );
    }

    this.running = true;
    bridgeLogger.info("Starting ingestion bridge consumer loop");

    // Start periodic flush
    this.flushInterval = setInterval(() => {
      if (this.hasBufferedSignals()) {
        this.flushSignals();
      }
    }, 1000);

    // Consumer loop
    while (this.running) {
      try {
        await this.consumeBatch();
      } catch (err) {
        bridgeLogger.error({ error: err }, "Error in consumer loop");
        
        // Emit error but continue running
        this.emit("error", err);
        
        // Brief pause before retry
        await this.sleep(1000);
      }
    }
  }

  /**
   * Stop consuming
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Flush remaining signals
    if (this.hasBufferedSignals()) {
      this.flushSignals();
    }

    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }

    bridgeLogger.info("Ingestion bridge stopped");
    this.emit("stopped");
  }

  /**
   * Check if bridge is healthy
   */
  async isHealthy(): Promise<boolean> {
    if (!this.redis) return false;
    
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current signal buffer
   */
  getBuffer(): SignalBatch {
    return { ...this.signalBuffer };
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private async consumeBatch(): Promise<void> {
    if (!this.redis) return;

    // Read messages using XREADGROUP
    const streams = await this.redis.xreadgroup(
      "GROUP",
      this.config.consumerGroup,
      this.config.consumerName,
      "COUNT",
      this.config.batchSize,
      "BLOCK",
      this.config.blockTimeMs,
      "STREAMS",
      this.config.streamName,
      ">"
    );

    if (!streams || streams.length === 0) {
      return;
    }

    // Process messages
    for (const [_streamName, messages] of streams) {
      for (const [messageId, fields] of messages as [string, string[]][]) {
        try {
          const event = this.parseMessage(fields);
          if (event) {
            this.processEvent(event);
            this.lastMessageId = messageId;

            // Acknowledge message
            await this.redis.xack(
              this.config.streamName,
              this.config.consumerGroup,
              messageId
            );
          }
        } catch (err) {
          bridgeLogger.error({ messageId, error: err }, "Failed to process message");
        }
      }
    }
  }

  private parseMessage(fields: string[]): IngestionEvent | null {
    // Convert field array to object
    const data: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      data[fields[i]] = fields[i + 1];
    }

    // Extract the event payload
    const payload = data.payload || data.data || data.event;
    if (!payload) {
      bridgeLogger.warn({ fields: data }, "Message missing payload");
      return null;
    }

    try {
      return JSON.parse(payload) as IngestionEvent;
    } catch {
      bridgeLogger.warn({ payload }, "Failed to parse event JSON");
      return null;
    }
  }

  private processEvent(event: IngestionEvent): void {
    this.signalBuffer.rawEvents.push(event);

    // Convert to NewsSignal or SocialSignal based on dataType
    if (event.dataType === "news") {
      const newsSignal = this.convertToNewsSignal(event);
      if (newsSignal) {
        this.signalBuffer.news.push(newsSignal);
        bridgeLogger.debug({ id: newsSignal.id }, "News signal added");
      }
    } else if (event.dataType === "social") {
      const socialSignal = this.convertToSocialSignal(event);
      if (socialSignal) {
        this.signalBuffer.social.push(socialSignal);
        bridgeLogger.debug({ id: socialSignal.id }, "Social signal added");
      }
    }

    this.emit("event", event);
  }

  private convertToNewsSignal(event: IngestionEvent): NewsSignal | null {
    const payload = event.payload as Record<string, any>;
    
    return {
      id: event.id,
      title: payload.title || payload.headline || "Untitled",
      content: payload.content || payload.body || payload.summary || "",
      source: event.sourceName || event.sourceId,
      publishedAt: event.dataTimestamp || event.createdAt,
      sentiment: payload.sentiment,
      sentimentScore: payload.sentimentScore,
      tickers: payload.tickers || payload.symbols || [],
      category: payload.category,
      relevanceScore: event.dataQualityScore,
    };
  }

  private convertToSocialSignal(event: IngestionEvent): SocialSignal | null {
    const payload = event.payload as Record<string, any>;
    
    return {
      id: event.id,
      platform: payload.platform || event.sourceName || "unknown",
      content: payload.content || payload.text || payload.body || "",
      authorId: payload.authorId || payload.author || "unknown",
      authorFollowers: payload.authorFollowers || payload.followers,
      isInfluencer: payload.isInfluencer || (payload.authorFollowers > 10000),
      sentiment: payload.sentiment,
      sentimentScore: payload.sentimentScore,
      engagementRate: payload.engagementRate,
      postedAt: event.dataTimestamp || event.createdAt,
      tickers: payload.tickers || payload.symbols || [],
    };
  }

  private hasBufferedSignals(): boolean {
    return (
      this.signalBuffer.news.length > 0 ||
      this.signalBuffer.social.length > 0
    );
  }

  private flushSignals(): void {
    const batch = this.signalBuffer;
    this.signalBuffer = this.createEmptyBatch();

    bridgeLogger.info(
      { newsCount: batch.news.length, socialCount: batch.social.length },
      "Flushing signal batch"
    );

    this.emit("signals", batch);
  }

  private createEmptyBatch(): SignalBatch {
    return {
      news: [],
      social: [],
      rawEvents: [],
      timestamp: new Date(),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================
// FACTORY
// ============================================

export function createIngestionBridge(config: IngestionBridgeConfig): IngestionBridge {
  return new IngestionBridge(config);
}
