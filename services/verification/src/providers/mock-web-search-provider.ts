/**
 * MockWebSearchProvider
 * 
 * Mock implementation of WebSearchProvider for dev tests.
 * Returns configurable canned responses for testing various scenarios.
 */

import type { 
  WebSearchProvider, 
  WebSearchOptions, 
  WebSearchResponse,
  WebSearchResult,
} from "./web-search-provider.js";

// ============================================
// MOCK SCENARIOS
// ============================================

export interface MockScenario {
  name: string;
  description: string;
  results: WebSearchResult[];
}

export const MOCK_SCENARIOS: Record<string, MockScenario> = {
  // Legitimate news with multiple confirmations
  CONFIRMED_NEWS: {
    name: "Confirmed News",
    description: "News confirmed by multiple independent sources",
    results: [
      {
        url: "https://www.coindesk.com/breaking-news-1",
        title: "Major Protocol Upgrade Announced",
        snippet: "The team has announced a significant protocol upgrade...",
        domain: "coindesk.com",
        publishedAt: new Date().toISOString(),
        sourceName: "CoinDesk",
        isNews: true,
        relevanceScore: 0.95,
      },
      {
        url: "https://www.theblock.co/article/123",
        title: "Protocol Upgrade: What You Need to Know",
        snippet: "Following the announcement, here's what developers should know...",
        domain: "theblock.co",
        publishedAt: new Date().toISOString(),
        sourceName: "The Block",
        isNews: true,
        relevanceScore: 0.90,
      },
      {
        url: "https://decrypt.co/news/456",
        title: "Breaking: Major Upgrade Confirmed",
        snippet: "Multiple sources confirm the upcoming protocol changes...",
        domain: "decrypt.co",
        publishedAt: new Date().toISOString(),
        sourceName: "Decrypt",
        isNews: true,
        relevanceScore: 0.88,
      },
      {
        url: "https://www.reuters.com/tech/crypto",
        title: "Crypto Protocol Announces Major Update",
        snippet: "Reuters has confirmed the news through official channels...",
        domain: "reuters.com",
        publishedAt: new Date().toISOString(),
        sourceName: "Reuters",
        isNews: true,
        relevanceScore: 0.92,
      },
    ],
  },

  // Recycled old news
  RECYCLED_NEWS: {
    name: "Recycled News",
    description: "Old news being pushed as new",
    results: [
      {
        url: "https://archive.example.com/old-news",
        title: "Token Launch Announcement",
        snippet: "The token launch was announced...",
        domain: "archive.example.com",
        publishedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
        sourceName: "Archive",
        isNews: true,
        relevanceScore: 0.85,
      },
      {
        url: "https://old-news.com/article/recycled",
        title: "Same Old Token News",
        snippet: "This story was first reported last week...",
        domain: "old-news.com",
        publishedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
        sourceName: "Old News Site",
        isNews: true,
        relevanceScore: 0.70,
      },
    ],
  },

  // No confirmation (single source)
  NO_CONFIRMATION: {
    name: "No Confirmation",
    description: "Only one source, no independent confirmation",
    results: [
      {
        url: "https://unknown-blog.com/exclusive",
        title: "Exclusive: Insider Information",
        snippet: "Our sources say this token will moon...",
        domain: "unknown-blog.com",
        publishedAt: new Date().toISOString(),
        sourceName: "Unknown Blog",
        isNews: false,
        relevanceScore: 0.60,
      },
    ],
  },

  // Suspicious coordinated posts
  COORDINATED_SPAM: {
    name: "Coordinated Spam",
    description: "Bot-like coordinated amplification detected",
    results: [
      {
        url: "https://twitter.com/bot1/status/123",
        title: "🚀 $TOKEN TO THE MOON! BUY NOW! 🚀",
        snippet: "This is a once in a lifetime opportunity...",
        domain: "twitter.com",
        publishedAt: new Date().toISOString(),
        sourceName: "Twitter",
        isNews: false,
        relevanceScore: 0.30,
      },
      {
        url: "https://twitter.com/bot2/status/124",
        title: "🚀 $TOKEN TO THE MOON! BUY NOW! 🚀",
        snippet: "This is a once in a lifetime opportunity...",
        domain: "twitter.com",
        publishedAt: new Date().toISOString(),
        sourceName: "Twitter",
        isNews: false,
        relevanceScore: 0.30,
      },
      {
        url: "https://twitter.com/bot3/status/125",
        title: "🚀 $TOKEN TO THE MOON! BUY NOW! 🚀",
        snippet: "This is a once in a lifetime opportunity...",
        domain: "twitter.com",
        publishedAt: new Date().toISOString(),
        sourceName: "Twitter",
        isNews: false,
        relevanceScore: 0.30,
      },
    ],
  },

  // Same ownership group (low diversity)
  LOW_DIVERSITY: {
    name: "Low Diversity",
    description: "All sources from same ownership group",
    results: [
      {
        url: "https://wsj.com/article/1",
        title: "Market Analysis",
        snippet: "Our analysis shows...",
        domain: "wsj.com",
        publishedAt: new Date().toISOString(),
        sourceName: "Wall Street Journal",
        isNews: true,
        relevanceScore: 0.90,
      },
      {
        url: "https://barrons.com/article/2",
        title: "Investment Outlook",
        snippet: "Following the WSJ report...",
        domain: "barrons.com",
        publishedAt: new Date().toISOString(),
        sourceName: "Barrons",
        isNews: true,
        relevanceScore: 0.85,
      },
      {
        url: "https://marketwatch.com/story/3",
        title: "Token Analysis",
        snippet: "As reported by our sister publications...",
        domain: "marketwatch.com",
        publishedAt: new Date().toISOString(),
        sourceName: "MarketWatch",
        isNews: true,
        relevanceScore: 0.80,
      },
    ],
  },

  // No results
  NO_RESULTS: {
    name: "No Results",
    description: "No search results found",
    results: [],
  },
};

// ============================================
// MOCK PROVIDER IMPLEMENTATION
// ============================================

export interface MockWebSearchProviderConfig {
  // Default scenario to use
  defaultScenario?: keyof typeof MOCK_SCENARIOS;
  
  // Scenario overrides by query keyword
  scenarioByKeyword?: Record<string, keyof typeof MOCK_SCENARIOS>;
  
  // Simulated latency (ms)
  simulatedLatencyMs?: number;
  
  // Should fail randomly?
  failureRate?: number;
  
  // Custom results
  customResults?: WebSearchResult[];
}

export class MockWebSearchProvider implements WebSearchProvider {
  readonly name = "MockWebSearchProvider";
  private config: MockWebSearchProviderConfig;
  private customScenarios: Map<string, MockScenario> = new Map();

  constructor(config: MockWebSearchProviderConfig = {}) {
    this.config = {
      defaultScenario: "CONFIRMED_NEWS",
      simulatedLatencyMs: 100,
      failureRate: 0,
      ...config,
    };
  }

  /**
   * Add a custom scenario for testing
   */
  addScenario(name: string, scenario: MockScenario): void {
    this.customScenarios.set(name, scenario);
  }

  /**
   * Set specific results for testing
   */
  setResults(results: WebSearchResult[]): void {
    this.config.customResults = results;
  }

  async search(query: string, options?: WebSearchOptions): Promise<WebSearchResponse> {
    // Simulate latency
    if (this.config.simulatedLatencyMs) {
      await new Promise(r => setTimeout(r, this.config.simulatedLatencyMs));
    }

    // Simulate failures
    if (this.config.failureRate && Math.random() < this.config.failureRate) {
      throw new Error("Mock search provider simulated failure");
    }

    const startTime = Date.now();
    const results = this.getResults(query, options);
    const searchDurationMs = Date.now() - startTime;

    return {
      query,
      totalResults: results.length,
      results,
      searchDurationMs,
      provider: this.name,
      searchedAt: new Date().toISOString(),
    };
  }

  async searchNews(query: string, options?: WebSearchOptions): Promise<WebSearchResponse> {
    const response = await this.search(query, options);
    
    // Filter to news only
    return {
      ...response,
      results: response.results.filter(r => r.isNews),
    };
  }

  async fetchUrl(url: string): Promise<{
    exists: boolean;
    title?: string;
    content?: string;
    publishedAt?: string;
    domain: string;
  }> {
    // Simulate latency
    if (this.config.simulatedLatencyMs) {
      await new Promise(r => setTimeout(r, this.config.simulatedLatencyMs / 2));
    }

    // Extract domain
    const domain = new URL(url).hostname.replace(/^www\./, "");

    // Mock response
    return {
      exists: true,
      title: "Mock Page Title",
      content: "Mock page content for testing purposes.",
      publishedAt: new Date().toISOString(),
      domain,
    };
  }

  async findSimilar(content: string, options?: WebSearchOptions): Promise<WebSearchResponse> {
    // Use first few words as query
    const query = content.split(" ").slice(0, 5).join(" ");
    return this.search(query, options);
  }

  private getResults(query: string, options?: WebSearchOptions): WebSearchResult[] {
    // Check for custom results first
    if (this.config.customResults) {
      return this.applyOptions(this.config.customResults, options);
    }

    // Check for keyword-based scenario
    if (this.config.scenarioByKeyword) {
      const queryLower = query.toLowerCase();
      for (const [keyword, scenarioName] of Object.entries(this.config.scenarioByKeyword)) {
        if (queryLower.includes(keyword.toLowerCase())) {
          const scenario = MOCK_SCENARIOS[scenarioName] || this.customScenarios.get(scenarioName);
          if (scenario) {
            return this.applyOptions(scenario.results, options);
          }
        }
      }
    }

    // Use default scenario
    const scenario = MOCK_SCENARIOS[this.config.defaultScenario || "CONFIRMED_NEWS"];
    return this.applyOptions(scenario.results, options);
  }

  private applyOptions(results: WebSearchResult[], options?: WebSearchOptions): WebSearchResult[] {
    let filtered = [...results];

    if (options?.maxResults) {
      filtered = filtered.slice(0, options.maxResults);
    }

    if (options?.newsOnly) {
      filtered = filtered.filter(r => r.isNews);
    }

    if (options?.excludeDomains) {
      const excluded = new Set(options.excludeDomains.map(d => d.toLowerCase()));
      filtered = filtered.filter(r => !excluded.has(r.domain.toLowerCase()));
    }

    if (options?.includeDomains) {
      const included = new Set(options.includeDomains.map(d => d.toLowerCase()));
      filtered = filtered.filter(r => included.has(r.domain.toLowerCase()));
    }

    return filtered;
  }
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

/**
 * Create a mock provider configured for a specific test scenario
 */
export function createMockProviderForScenario(
  scenarioName: keyof typeof MOCK_SCENARIOS
): MockWebSearchProvider {
  return new MockWebSearchProvider({
    defaultScenario: scenarioName,
  });
}

/**
 * Create a mock provider that returns specific results
 */
export function createMockProviderWithResults(
  results: WebSearchResult[]
): MockWebSearchProvider {
  return new MockWebSearchProvider({
    customResults: results,
  });
}
