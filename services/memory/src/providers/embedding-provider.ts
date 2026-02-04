/**
 * Embedding Provider Interface
 * 
 * Supports multiple embedding providers with fallback:
 * - OpenAI (primary)
 * - Local model via @xenova/transformers (fallback)
 * 
 * Turkish: "OpenAI API'si hata verirse veya rate limit'e takılırsa
 * yerel (local) bir modele geçiş yapan (fallback) mantığı sağlam kur."
 */

import OpenAI from "openai";
import { logger } from "@neuro/shared";
import pRetry from "p-retry";
import type { EmbeddingModel } from "@neuro/shared";

const log = logger.child({ module: "embedding-provider" });

// ============================================
// TYPES
// ============================================

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  provider: "openai" | "local";
  tokenCount?: number;
  processingTimeMs: number;
}

export interface EmbeddingProviderConfig {
  openaiApiKey?: string;
  openaiModel?: EmbeddingModel;
  localModelName?: string;
  enableLocalFallback?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface IEmbeddingProvider {
  embed(text: string): Promise<EmbeddingResult>;
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
  getDimension(): number;
  getProvider(): "openai" | "local";
  isHealthy(): Promise<boolean>;
}

// ============================================
// OPENAI PROVIDER
// ============================================

export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  private client: OpenAI;
  private model: string;
  private dimension: number;

  constructor(apiKey: string, model: EmbeddingModel = "text-embedding-ada-002") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    
    // Set dimension based on model
    this.dimension = this.getModelDimension(model);
  }

  private getModelDimension(model: string): number {
    const dimensions: Record<string, number> = {
      "text-embedding-ada-002": 1536,
      "text-embedding-3-small": 1536,
      "text-embedding-3-large": 3072,
    };
    return dimensions[model] || 1536;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const startTime = Date.now();
    
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });

    return {
      embedding: response.data[0].embedding,
      model: this.model,
      provider: "openai",
      tokenCount: response.usage?.total_tokens,
      processingTimeMs: Date.now() - startTime,
    };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];
    
    const startTime = Date.now();
    
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    });

    const processingTime = Date.now() - startTime;
    const tokenPerItem = response.usage?.total_tokens 
      ? Math.floor(response.usage.total_tokens / texts.length)
      : undefined;

    return response.data.map((d) => ({
      embedding: d.embedding,
      model: this.model,
      provider: "openai" as const,
      tokenCount: tokenPerItem,
      processingTimeMs: processingTime,
    }));
  }

  getDimension(): number {
    return this.dimension;
  }

  getProvider(): "openai" {
    return "openai";
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.embeddings.create({
        model: this.model,
        input: "health check",
      });
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// LOCAL EMBEDDING PROVIDER (Transformers.js)
// ============================================

export class LocalEmbeddingProvider implements IEmbeddingProvider {
  private pipeline: any = null;
  private modelName: string;
  private dimension: number = 384; // Default for all-MiniLM-L6-v2
  private initialized = false;

  constructor(modelName: string = "Xenova/all-MiniLM-L6-v2") {
    this.modelName = modelName;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import to avoid loading transformers when not needed
      const { pipeline } = await import("@xenova/transformers");
      this.pipeline = await pipeline("feature-extraction", this.modelName);
      this.initialized = true;
      log.info({ model: this.modelName }, "Local embedding model initialized");
    } catch (error) {
      log.error({ error, model: this.modelName }, "Failed to initialize local model");
      throw error;
    }
  }

  async embed(text: string): Promise<EmbeddingResult> {
    await this.initialize();
    
    const startTime = Date.now();
    
    const output = await this.pipeline(text, {
      pooling: "mean",
      normalize: true,
    });

    // Convert to regular array
    const embedding = Array.from(output.data) as number[];
    this.dimension = embedding.length;

    return {
      embedding,
      model: this.modelName,
      provider: "local",
      processingTimeMs: Date.now() - startTime,
    };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    // Process sequentially for local model to avoid memory issues
    const results: EmbeddingResult[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  getDimension(): number {
    return this.dimension;
  }

  getProvider(): "local" {
    return "local";
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.initialize();
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// RESILIENT EMBEDDING PROVIDER (with fallback)
// ============================================

export class ResilientEmbeddingProvider implements IEmbeddingProvider {
  private primary: IEmbeddingProvider | null = null;
  private fallback: IEmbeddingProvider | null = null;
  private config: EmbeddingProviderConfig;
  private currentProvider: "openai" | "local" = "openai";
  private consecutiveFailures = 0;
  private readonly maxConsecutiveFailures = 3;

  constructor(config: EmbeddingProviderConfig) {
    this.config = {
      enableLocalFallback: true,
      maxRetries: 3,
      retryDelayMs: 1000,
      ...config,
    };

    // Initialize OpenAI provider if key is provided
    if (config.openaiApiKey) {
      this.primary = new OpenAIEmbeddingProvider(
        config.openaiApiKey,
        config.openaiModel || "text-embedding-ada-002"
      );
      this.currentProvider = "openai";
    }

    // Initialize local fallback if enabled
    if (config.enableLocalFallback) {
      this.fallback = new LocalEmbeddingProvider(config.localModelName);
    }

    // If no OpenAI key, use local as primary
    if (!this.primary && this.fallback) {
      this.primary = this.fallback;
      this.fallback = null;
      this.currentProvider = "local";
    }

    if (!this.primary) {
      throw new Error("No embedding provider available. Provide OpenAI API key or enable local fallback.");
    }
  }

  async embed(text: string): Promise<EmbeddingResult> {
    return this.executeWithFallback(() => this.primary!.embed(text));
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    return this.executeWithFallback(() => this.primary!.embedBatch(texts));
  }

  private async executeWithFallback<T>(operation: () => Promise<T>): Promise<T> {
    try {
      const result = await pRetry(operation, {
        retries: this.config.maxRetries!,
        minTimeout: this.config.retryDelayMs!,
        maxTimeout: this.config.retryDelayMs! * 10,
        onFailedAttempt: (error) => {
          log.warn(
            { 
              attempt: error.attemptNumber, 
              retriesLeft: error.retriesLeft,
              provider: this.currentProvider,
            },
            "Embedding request failed, retrying..."
          );
        },
      });

      // Reset failure counter on success
      this.consecutiveFailures = 0;
      return result;
    } catch (error) {
      this.consecutiveFailures++;
      log.error(
        { 
          error, 
          provider: this.currentProvider,
          consecutiveFailures: this.consecutiveFailures,
        },
        "Embedding request failed after retries"
      );

      // Try fallback if available and we've exceeded failure threshold
      if (
        this.fallback && 
        this.currentProvider === "openai" &&
        this.consecutiveFailures >= this.maxConsecutiveFailures
      ) {
        log.warn("Switching to local fallback embedding provider");
        this.currentProvider = "local";
        
        // Swap providers
        const temp = this.primary;
        this.primary = this.fallback;
        this.fallback = temp;
        this.consecutiveFailures = 0;

        // Retry with fallback
        return this.executeWithFallback(operation);
      }

      throw error;
    }
  }

  getDimension(): number {
    return this.primary!.getDimension();
  }

  getProvider(): "openai" | "local" {
    return this.currentProvider;
  }

  async isHealthy(): Promise<boolean> {
    const primaryHealthy = await this.primary!.isHealthy();
    if (primaryHealthy) return true;

    if (this.fallback) {
      return this.fallback.isHealthy();
    }

    return false;
  }

  /**
   * Force switch to a specific provider
   */
  switchProvider(provider: "openai" | "local"): void {
    if (provider === this.currentProvider) return;

    if (provider === "openai" && this.config.openaiApiKey) {
      if (this.currentProvider === "local" && this.fallback) {
        const temp = this.primary;
        this.primary = this.fallback;
        this.fallback = temp;
      }
      this.currentProvider = "openai";
    } else if (provider === "local" && this.config.enableLocalFallback) {
      if (this.currentProvider === "openai" && this.fallback) {
        const temp = this.primary;
        this.primary = this.fallback;
        this.fallback = temp;
      }
      this.currentProvider = "local";
    }

    log.info({ provider: this.currentProvider }, "Switched embedding provider");
  }

  /**
   * Reset consecutive failure counter (e.g., after manual intervention)
   */
  resetFailureCounter(): void {
    this.consecutiveFailures = 0;
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createEmbeddingProvider(config: EmbeddingProviderConfig): IEmbeddingProvider {
  return new ResilientEmbeddingProvider(config);
}
