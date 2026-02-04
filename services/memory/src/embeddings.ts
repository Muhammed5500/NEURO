/**
 * Embedding Generator using OpenAI
 */

import OpenAI from "openai";
import { logger } from "@neuro/shared";

const memoryLogger = logger.child({ service: "memory" });

export interface EmbeddingConfig {
  apiKey: string;
  model?: string;
}

export class EmbeddingService {
  private client: OpenAI;
  private model: string;

  constructor(config: EmbeddingConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || "text-embedding-ada-002";
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: text,
      });

      return response.data[0].embedding;
    } catch (error) {
      memoryLogger.error({ error }, "Embedding generation failed");
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: texts,
      });

      return response.data.map((d) => d.embedding);
    } catch (error) {
      memoryLogger.error({ error }, "Batch embedding generation failed");
      throw error;
    }
  }

  /**
   * Get embedding dimension for current model
   */
  getDimension(): number {
    // OpenAI ada-002 returns 1536 dimensions
    return 1536;
  }
}
