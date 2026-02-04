/**
 * Recycled News Checker Tests
 * 
 * Tests for recycled/stale news detection functionality.
 * Covers acceptance criteria: "Unit tests cover recycled-news detection"
 */

import { describe, it, expect, beforeEach } from "vitest";
import { 
  RecycledNewsChecker,
  createRecycledNewsChecker,
} from "../checkers/recycled-news-checker.js";
import { 
  MockWebSearchProvider,
  MOCK_SCENARIOS,
  createMockProviderForScenario,
  createMockProviderWithResults,
} from "../providers/mock-web-search-provider.js";
import type { WebSearchResult } from "../providers/web-search-provider.js";

describe("RecycledNewsChecker", () => {
  let checker: RecycledNewsChecker;
  let mockProvider: MockWebSearchProvider;

  beforeEach(() => {
    mockProvider = new MockWebSearchProvider();
    checker = createRecycledNewsChecker(mockProvider, {
      staleThresholdHours: 6,
    });
  });

  describe("Fresh News Detection", () => {
    it("should identify fresh news as not recycled", async () => {
      // Set up mock with fresh news results
      const freshResults: WebSearchResult[] = [
        {
          url: "https://news.com/article/1",
          title: "Breaking News Today",
          snippet: "This just happened...",
          domain: "news.com",
          publishedAt: new Date().toISOString(), // Now
          isNews: true,
        },
      ];
      
      mockProvider.setResults(freshResults);

      const result = await checker.check({
        title: "Breaking News Today",
        content: "This just happened...",
      });

      expect(result.isRecycled).toBe(false);
      expect(result.isFakeFresh).toBe(false);
      expect(result.riskLevel).toBe("LOW");
    });

    it("should calculate correct age for recent news", async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      
      const results: WebSearchResult[] = [
        {
          url: "https://news.com/article/1",
          title: "News from 2 hours ago",
          snippet: "...",
          domain: "news.com",
          publishedAt: twoHoursAgo.toISOString(),
          isNews: true,
        },
      ];
      
      mockProvider.setResults(results);

      const result = await checker.check({
        title: "News from 2 hours ago",
        content: "...",
      });

      expect(result.ageHours).toBeCloseTo(2, 0);
      expect(result.isFakeFresh).toBe(false);
    });
  });

  describe("Stale News Detection (Turkish: 6 saat eskiyse)", () => {
    it("should flag news older than 6 hours as stale when trending now", async () => {
      const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
      
      const results: WebSearchResult[] = [
        {
          url: "https://news.com/old-article",
          title: "Old News",
          snippet: "This happened 7 hours ago...",
          domain: "news.com",
          publishedAt: sevenHoursAgo.toISOString(),
          isNews: true,
        },
      ];
      
      mockProvider.setResults(results);

      const result = await checker.check({
        title: "Old News",
        content: "This happened 7 hours ago...",
        trendingAt: new Date().toISOString(), // Trending now
      });

      expect(result.isFakeFresh).toBe(true);
      expect(result.temporalGapHours).toBeGreaterThan(6);
      expect(result.riskLevel).toBe("HIGH");
    });

    it("should not flag appropriately timed news", async () => {
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
      
      const results: WebSearchResult[] = [
        {
          url: "https://news.com/recent",
          title: "Recent News",
          snippet: "...",
          domain: "news.com",
          publishedAt: fourHoursAgo.toISOString(),
          isNews: true,
        },
      ];
      
      mockProvider.setResults(results);

      const result = await checker.check({
        title: "Recent News",
        content: "...",
        trendingAt: new Date().toISOString(),
      });

      expect(result.isFakeFresh).toBe(false);
      expect(result.riskLevel).not.toBe("HIGH");
    });
  });

  describe("Recycled News Detection (>7 days old)", () => {
    it("should identify week-old news as recycled", async () => {
      const oneWeekAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      
      const results: WebSearchResult[] = [
        {
          url: "https://archive.com/old-story",
          title: "Last Week's News",
          snippet: "This story is a week old...",
          domain: "archive.com",
          publishedAt: oneWeekAgo.toISOString(),
          isNews: true,
        },
      ];
      
      mockProvider.setResults(results);

      const result = await checker.check({
        title: "Last Week's News",
        content: "This story is a week old...",
      });

      expect(result.isRecycled).toBe(true);
      expect(result.ageHours).toBeGreaterThan(168); // 7 days
      expect(result.riskLevel).toBe("CRITICAL");
    });

    it("should handle the RECYCLED_NEWS mock scenario correctly", async () => {
      // Use the predefined recycled news scenario
      const recycledProvider = createMockProviderForScenario("RECYCLED_NEWS");
      const recycledChecker = createRecycledNewsChecker(recycledProvider);

      const result = await recycledChecker.check({
        title: "Token Launch Announcement",
        content: "...",
      });

      expect(result.isRecycled).toBe(true);
    });
  });

  describe("Canonical URLs and Duplicates", () => {
    it("should collect canonical URLs from search results", async () => {
      const results: WebSearchResult[] = [
        { url: "https://site1.com/article", title: "News", snippet: "...", domain: "site1.com", isNews: true },
        { url: "https://site2.com/article", title: "News", snippet: "...", domain: "site2.com", isNews: true },
        { url: "https://site3.com/article", title: "News", snippet: "...", domain: "site3.com", isNews: true },
      ];
      
      mockProvider.setResults(results);

      const result = await checker.check({
        title: "News",
        content: "...",
      });

      expect(result.canonicalUrls).toHaveLength(3);
      expect(result.canonicalUrls).toContain("https://site1.com/article");
      expect(result.canonicalUrls).toContain("https://site2.com/article");
      expect(result.canonicalUrls).toContain("https://site3.com/article");
    });

    it("should generate content hashes for duplicate detection", async () => {
      const results: WebSearchResult[] = [
        { url: "https://site1.com/a", title: "Same News", snippet: "Same content", domain: "site1.com", isNews: true },
        { url: "https://site2.com/b", title: "Same News", snippet: "Same content", domain: "site2.com", isNews: true },
      ];
      
      mockProvider.setResults(results);

      const result = await checker.check({
        title: "Same News",
        content: "Same content",
      });

      expect(result.duplicateHashes.length).toBeGreaterThan(0);
    });
  });

  describe("Risk Level Calculation", () => {
    it("should return CRITICAL for old recycled news being pushed fresh", async () => {
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      
      const results: WebSearchResult[] = [{
        url: "https://old.com/news",
        title: "Very Old News",
        snippet: "...",
        domain: "old.com",
        publishedAt: twoWeeksAgo.toISOString(),
        isNews: true,
      }];
      
      mockProvider.setResults(results);

      const result = await checker.check({
        title: "Very Old News",
        content: "...",
        trendingAt: new Date().toISOString(),
      });

      expect(result.riskLevel).toBe("CRITICAL");
    });

    it("should return HIGH for stale news (6-24h) pushed as fresh", async () => {
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
      
      const results: WebSearchResult[] = [{
        url: "https://news.com/story",
        title: "12 Hour Old Story",
        snippet: "...",
        domain: "news.com",
        publishedAt: twelveHoursAgo.toISOString(),
        isNews: true,
      }];
      
      mockProvider.setResults(results);

      const result = await checker.check({
        title: "12 Hour Old Story",
        content: "...",
        trendingAt: new Date().toISOString(),
      });

      expect(result.riskLevel).toBe("HIGH");
    });

    it("should return LOW for fresh news", async () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
      
      const results: WebSearchResult[] = [{
        url: "https://news.com/fresh",
        title: "Fresh News",
        snippet: "...",
        domain: "news.com",
        publishedAt: oneHourAgo.toISOString(),
        isNews: true,
      }];
      
      mockProvider.setResults(results);

      const result = await checker.check({
        title: "Fresh News",
        content: "...",
      });

      expect(result.riskLevel).toBe("LOW");
    });
  });

  describe("Quick Check", () => {
    it("should provide quick check for potentially recycled news", async () => {
      const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
      
      const results: WebSearchResult[] = [{
        url: "https://news.com/story",
        title: "Story",
        snippet: "...",
        domain: "news.com",
        publishedAt: eightHoursAgo.toISOString(),
        isNews: true,
      }];
      
      mockProvider.setResults(results);

      const result = await checker.quickCheck("Story");

      expect(result.possiblyRecycled).toBe(true);
      expect(result.oldestDate).toBeDefined();
    });
  });

  describe("Explanation Generation", () => {
    it("should generate informative explanation for recycled news", async () => {
      const provider = createMockProviderForScenario("RECYCLED_NEWS");
      const checkerWithRecycled = createRecycledNewsChecker(provider);

      const result = await checkerWithRecycled.check({
        title: "Old Story",
        content: "...",
      });

      expect(result.explanation).toContain("recycled");
    });

    it("should mention freshness for fresh news", async () => {
      const freshResults: WebSearchResult[] = [{
        url: "https://news.com/fresh",
        title: "Fresh",
        snippet: "...",
        domain: "news.com",
        publishedAt: new Date().toISOString(),
        isNews: true,
      }];
      
      mockProvider.setResults(freshResults);

      const result = await checker.check({
        title: "Fresh",
        content: "...",
      });

      expect(result.explanation.toLowerCase()).toMatch(/fresh|hour/);
    });
  });

  describe("Edge Cases", () => {
    it("should handle no search results gracefully", async () => {
      const emptyProvider = createMockProviderForScenario("NO_RESULTS");
      const checkerEmpty = createRecycledNewsChecker(emptyProvider);

      const result = await checkerEmpty.check({
        title: "Unknown News",
        content: "...",
      });

      expect(result.isRecycled).toBe(false);
      expect(result.canonicalUrls).toHaveLength(0);
    });

    it("should handle missing publication dates", async () => {
      const noDatesResults: WebSearchResult[] = [{
        url: "https://news.com/no-date",
        title: "No Date",
        snippet: "...",
        domain: "news.com",
        // No publishedAt
        isNews: true,
      }];
      
      mockProvider.setResults(noDatesResults);

      const result = await checker.check({
        title: "No Date",
        content: "...",
      });

      // Should still work without crashing
      expect(result.ageHours).toBeUndefined();
      expect(result.isRecycled).toBe(false);
    });

    it("should use reported publication date when provided", async () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      
      const noDatesResults: WebSearchResult[] = [{
        url: "https://news.com/no-date",
        title: "No Date",
        snippet: "...",
        domain: "news.com",
        isNews: true,
      }];
      
      mockProvider.setResults(noDatesResults);

      const result = await checker.check({
        title: "No Date",
        content: "...",
        reportedPublishedAt: threeHoursAgo.toISOString(),
      });

      expect(result.ageHours).toBeCloseTo(3, 0);
    });
  });
});
