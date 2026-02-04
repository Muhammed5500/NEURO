/**
 * Memory Service Integration Tests
 * 
 * Demonstrates acceptance criteria:
 * - Sample ingestion event can be embedded
 * - Queried for nearest neighbors
 * - Deduplication prevents duplicates
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryManager } from "../memory-manager.js";

describe("Memory Service Integration", () => {
  let manager: MemoryManager;

  beforeAll(async () => {
    // Note: Requires Qdrant running via `docker compose up`
    manager = new MemoryManager({
      qdrantUrl: process.env.QDRANT_URL || "http://localhost:6333",
      openaiApiKey: process.env.OPENAI_API_KEY,
      enableLocalFallback: true, // Falls back to local model if no API key
      collectionName: "neuro_memories_test",
      deduplicationThreshold: 0.99,
      enableDeduplication: true,
    });

    await manager.initialize();
  });

  afterAll(async () => {
    // Clean up test collection
    const adapter = manager.getAdapter();
    try {
      // Delete test items
      await adapter.deleteByFilter({});
    } catch {
      // Ignore if collection doesn't exist
    }
    await manager.close();
  });

  describe("Acceptance Criteria", () => {
    it("should embed a sample ingestion event", async () => {
      // Sample ingestion event (like from newsapi)
      const result = await manager.indexIngestionEvent(
        {
          id: "test-event-001",
          sourceType: "news_api",
          sourceName: "NewsAPI",
          sourceUrl: "https://newsapi.org/article/123",
          dataType: "news",
          dataTimestamp: new Date().toISOString(),
          priority: "high",
          payload: {
            title: "Monad Network Achieves 10,000 TPS in Testnet",
            description: "The Monad blockchain has demonstrated impressive throughput...",
            tokenSymbol: "MON",
          },
        },
        "Monad Network Achieves 10,000 TPS in Testnet. The Monad blockchain has demonstrated impressive throughput in its latest testnet performance benchmarks."
      );

      expect(result.success).toBe(true);
      expect(result.id).toBe("test-event-001");
      expect(result.isDuplicate).toBeFalsy();
    });

    it("should query for nearest neighbors", async () => {
      // Wait for indexing to complete
      await manager.drainIndexer();

      // Query for similar content
      const queryResult = await manager.findSimilar(
        "Monad blockchain performance and TPS metrics",
        { limit: 5, minScore: 0.5 }
      );

      expect(queryResult.results.length).toBeGreaterThan(0);
      expect(queryResult.stats.totalResults).toBeGreaterThan(0);
      expect(queryResult.stats.avgScore).toBeGreaterThan(0.5);

      // Should find our indexed item
      const foundItem = queryResult.results.find(
        (r) => r.id === "test-event-001"
      );
      expect(foundItem).toBeDefined();
      expect(foundItem?.score).toBeGreaterThan(0.7);
    });

    it("should detect duplicates with 99% similarity threshold", async () => {
      // Try to index the exact same content
      const duplicateResult = await manager.index({
        id: "test-event-002",
        content: "Monad Network Achieves 10,000 TPS in Testnet. The Monad blockchain has demonstrated impressive throughput in its latest testnet performance benchmarks.",
        metadata: {
          sourceType: "news_item",
          source: "duplicate-source",
        },
      });

      // Should be detected as duplicate
      expect(duplicateResult.isDuplicate).toBe(true);
      expect(duplicateResult.duplicateOf).toBe("test-event-001");
    });

    it("should return statistics with price impact info", async () => {
      const queryResult = await manager.findSimilar("Monad blockchain", {
        limit: 10,
        includeStats: true,
      });

      // Stats should be present
      expect(queryResult.stats).toBeDefined();
      expect(queryResult.stats.totalResults).toBeGreaterThanOrEqual(0);

      // Price impact stats should indicate no labels yet
      if (queryResult.stats.priceImpactStats) {
        expect(queryResult.stats.priceImpactStats.hasLabels).toBe(false);
      }

      // Sentiment distribution should be present
      expect(queryResult.stats.sentimentDistribution).toBeDefined();

      // Time distribution should be present
      expect(queryResult.stats.timeDistribution).toBeDefined();
    });
  });

  describe("Metadata Schema Alignment", () => {
    it("should accept NewsItem-compatible metadata", async () => {
      const result = await manager.indexNewsItem(
        {
          id: "news-test-001",
          source: "twitter",
          sourceUrl: "https://twitter.com/monad/status/123",
          publishedAt: new Date().toISOString(),
          mentionedTokens: ["MON", "PEPE"],
          language: "en",
          sentiment: "bullish",
          sentimentScore: 0.85,
          category: "protocol",
          tags: ["monad", "mainnet"],
          importance: "high",
          relevanceScore: 0.9,
        },
        "Big news: Monad mainnet is launching next month! $MON and $PEPE looking bullish."
      );

      expect(result.success).toBe(true);
    });

    it("should accept SocialSignal-compatible metadata", async () => {
      const result = await manager.indexSocialSignal(
        {
          id: "social-test-001",
          platform: "twitter",
          contentUrl: "https://twitter.com/whale/status/456",
          postedAt: new Date().toISOString(),
          tokenSymbol: "MON",
          tokenAddress: "0x1234567890123456789012345678901234567890",
          sentiment: "bullish",
          sentimentScore: 0.92,
          signalStrength: 0.85,
          isInfluencer: true,
        },
        "Just bought 100k $MON, this is going to be huge! 🚀"
      );

      expect(result.success).toBe(true);
    });
  });

  describe("Async Indexing", () => {
    it("should process items asynchronously without blocking", async () => {
      const startTime = Date.now();
      const items = Array.from({ length: 5 }, (_, i) => ({
        id: `async-test-${i}`,
        content: `Test content for async indexing item ${i}`,
        metadata: {
          sourceType: "document" as const,
          source: "test",
        },
      }));

      // Index all items (should return quickly)
      const promises = items.map((item) => manager.index(item));
      
      // Should not block significantly
      const queueTime = Date.now() - startTime;
      expect(queueTime).toBeLessThan(1000); // Queuing should be fast

      // Wait for results
      const results = await Promise.all(promises);
      
      // All should succeed
      expect(results.every((r) => r.success)).toBe(true);

      // Check indexer stats
      await manager.drainIndexer();
      const stats = await manager.getStats();
      expect(stats.indexer.processed).toBeGreaterThan(0);
    });
  });

  describe("Error Resilience", () => {
    it("should report health status", async () => {
      const healthy = await manager.isHealthy();
      expect(healthy).toBe(true);
    });

    it("should show embedding provider status", async () => {
      const stats = await manager.getStats();
      expect(["openai", "local"]).toContain(stats.embeddingProvider);
    });
  });
});
