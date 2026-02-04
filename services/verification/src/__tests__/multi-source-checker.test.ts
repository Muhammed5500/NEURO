/**
 * Multi-Source Checker Tests
 * 
 * Tests multi-source confirmation functionality.
 * Covers acceptance criteria: "If Scout marks high importance but no other sources confirm,
 * Adversarial downgrades or blocks"
 */

import { describe, it, expect, beforeEach } from "vitest";
import { 
  MultiSourceChecker,
  createMultiSourceChecker,
} from "../checkers/multi-source-checker.js";
import { 
  MockWebSearchProvider,
  createMockProviderForScenario,
  createMockProviderWithResults,
} from "../providers/mock-web-search-provider.js";
import type { WebSearchResult } from "../providers/web-search-provider.js";

describe("MultiSourceChecker", () => {
  let checker: MultiSourceChecker;
  let mockProvider: MockWebSearchProvider;

  beforeEach(() => {
    mockProvider = new MockWebSearchProvider();
    checker = createMultiSourceChecker(mockProvider, {
      minSourcesForHighImportance: 3,
      minSourcesForMediumImportance: 2,
    });
  });

  describe("Confirmed News Detection", () => {
    it("should confirm when multiple independent sources agree", async () => {
      const provider = createMockProviderForScenario("CONFIRMED_NEWS");
      const confirmedChecker = createMultiSourceChecker(provider);

      const result = await confirmedChecker.check({
        claim: "Major Protocol Upgrade Announced",
        originalSource: "twitter.com",
        importance: "high",
      });

      expect(result.requirementMet).toBe(true);
      expect(result.independentSourcesConfirmed).toBeGreaterThanOrEqual(3);
      expect(result.riskLevel).toBe("LOW");
    });

    it("should count sources from different ownership groups", async () => {
      // Results from different ownership groups
      const diverseResults: WebSearchResult[] = [
        { url: "https://coindesk.com/story", title: "Story", snippet: "...", domain: "coindesk.com", isNews: true },
        { url: "https://theblock.co/article", title: "Story", snippet: "...", domain: "theblock.co", isNews: true },
        { url: "https://reuters.com/tech", title: "Story", snippet: "...", domain: "reuters.com", isNews: true },
      ];
      
      mockProvider.setResults(diverseResults);

      const result = await checker.check({
        claim: "Story",
        originalSource: "unknown-blog.com",
        importance: "high",
      });

      expect(result.independentSourcesConfirmed).toBeGreaterThan(0);
    });
  });

  describe("No Confirmation Detection (Acceptance Criteria)", () => {
    it("should fail when high importance claim has no confirmation", async () => {
      const provider = createMockProviderForScenario("NO_CONFIRMATION");
      const noConfirmChecker = createMultiSourceChecker(provider, {
        minSourcesForHighImportance: 3,
      });

      const result = await noConfirmChecker.check({
        claim: "Exclusive insider information",
        originalSource: "unknown-blog.com",
        importance: "high",
      });

      expect(result.requirementMet).toBe(false);
      expect(result.riskLevel).toBe("CRITICAL"); // High importance + no confirmation
      expect(result.explanation).toContain("Insufficient");
    });

    it("should return CRITICAL risk for unconfirmed high-importance claims", async () => {
      const singleSourceResults: WebSearchResult[] = [
        { url: "https://random-blog.com/exclusive", title: "Exclusive", snippet: "...", domain: "random-blog.com", isNews: false },
      ];
      
      mockProvider.setResults(singleSourceResults);

      const result = await checker.check({
        claim: "Breaking exclusive news",
        originalSource: "random-blog.com",
        importance: "high",
      });

      expect(result.riskLevel).toBe("CRITICAL");
      expect(result.independentSourcesConfirmed).toBe(0);
    });

    it("should return HIGH risk for unconfirmed medium-importance claims", async () => {
      mockProvider.setResults([]);

      const result = await checker.check({
        claim: "Some news",
        originalSource: "some-site.com",
        importance: "medium",
      });

      expect(result.riskLevel).toBe("HIGH");
    });
  });

  describe("Importance Level Requirements", () => {
    it("should require 3 sources for high importance", async () => {
      // Only 2 sources
      const twoResults: WebSearchResult[] = [
        { url: "https://site1.com/a", title: "News", snippet: "...", domain: "site1.com", isNews: true },
        { url: "https://site2.com/b", title: "News", snippet: "...", domain: "site2.com", isNews: true },
      ];
      
      mockProvider.setResults(twoResults);

      const result = await checker.check({
        claim: "News",
        originalSource: "original.com",
        importance: "high",
      });

      expect(result.minimumRequired).toBe(3);
      expect(result.requirementMet).toBe(false);
    });

    it("should require 2 sources for medium importance", async () => {
      const twoResults: WebSearchResult[] = [
        { url: "https://site1.com/a", title: "News", snippet: "...", domain: "site1.com", isNews: true },
        { url: "https://site2.com/b", title: "News", snippet: "...", domain: "site2.com", isNews: true },
      ];
      
      mockProvider.setResults(twoResults);

      const result = await checker.check({
        claim: "News",
        originalSource: "original.com",
        importance: "medium",
      });

      expect(result.minimumRequired).toBe(2);
      expect(result.requirementMet).toBe(true);
    });

    it("should require 1 source for low importance", async () => {
      const oneResult: WebSearchResult[] = [
        { url: "https://site1.com/a", title: "Minor News", snippet: "...", domain: "site1.com", isNews: true },
      ];
      
      mockProvider.setResults(oneResult);

      const result = await checker.check({
        claim: "Minor News",
        originalSource: "original.com",
        importance: "low",
      });

      expect(result.minimumRequired).toBe(1);
      expect(result.requirementMet).toBe(true);
    });
  });

  describe("Same Ownership Group Detection", () => {
    it("should not count sources from same ownership as independent", async () => {
      // All from News Corp group
      const sameOwnershipResults: WebSearchResult[] = [
        { url: "https://wsj.com/story", title: "Story", snippet: "...", domain: "wsj.com", isNews: true },
        { url: "https://barrons.com/story", title: "Story", snippet: "...", domain: "barrons.com", isNews: true },
        { url: "https://marketwatch.com/story", title: "Story", snippet: "...", domain: "marketwatch.com", isNews: true },
      ];
      
      mockProvider.setResults(sameOwnershipResults);

      const result = await checker.check({
        claim: "Story",
        originalSource: "external.com",
        importance: "high",
      });

      // Should only count as 1 independent source (all same ownership)
      expect(result.independentSourcesConfirmed).toBeLessThanOrEqual(1);
    });
  });

  describe("Source Details", () => {
    it("should capture source details in result", async () => {
      const results: WebSearchResult[] = [
        { 
          url: "https://reuters.com/tech", 
          title: "Tech News", 
          snippet: "Details about the story...", 
          domain: "reuters.com", 
          publishedAt: new Date().toISOString(),
          sourceName: "Reuters",
          isNews: true,
        },
      ];
      
      mockProvider.setResults(results);

      const result = await checker.check({
        claim: "Tech News",
        originalSource: "some-other-site.com",
        importance: "low",
      });

      expect(result.sources.length).toBeGreaterThan(0);
      expect(result.sources[0].domain).toBe("reuters.com");
      expect(result.sources[0].ownershipGroup).toBeDefined();
      expect(result.sources[0].credibilityScore).toBeGreaterThan(0);
    });
  });

  describe("Quick Check", () => {
    it("should provide quick confirmation status", async () => {
      const provider = createMockProviderForScenario("CONFIRMED_NEWS");
      const quickChecker = createMultiSourceChecker(provider);

      const result = await quickChecker.quickCheck("Major news story");

      expect(result.hasConfirmation).toBe(true);
      expect(result.sourceCount).toBeGreaterThan(1);
    });

    it("should indicate no confirmation for single-source claims", async () => {
      const provider = createMockProviderForScenario("NO_CONFIRMATION");
      const quickChecker = createMultiSourceChecker(provider);

      const result = await quickChecker.quickCheck("Exclusive claim");

      expect(result.sourceCount).toBeLessThanOrEqual(1);
    });
  });

  describe("Explanation Quality", () => {
    it("should explain when requirement is met", async () => {
      const provider = createMockProviderForScenario("CONFIRMED_NEWS");
      const confirmChecker = createMultiSourceChecker(provider);

      const result = await confirmChecker.check({
        claim: "Confirmed story",
        originalSource: "twitter.com",
        importance: "medium",
      });

      expect(result.explanation).toContain("confirmed");
      expect(result.explanation).toContain("Requirement met");
    });

    it("should warn when requirement is not met", async () => {
      const provider = createMockProviderForScenario("NO_CONFIRMATION");
      const warnChecker = createMultiSourceChecker(provider);

      const result = await warnChecker.check({
        claim: "Unconfirmed story",
        originalSource: "random.com",
        importance: "high",
      });

      expect(result.explanation).toContain("CAUTION");
    });
  });
});
