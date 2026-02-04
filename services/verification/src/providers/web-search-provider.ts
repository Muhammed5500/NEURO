/**
 * WebSearchProvider Interface
 * 
 * Abstraction for web search functionality used in verification.
 * Allows switching between providers (Google, Bing, Brave, etc.)
 * and using mocks for testing.
 */

import { z } from "zod";

// ============================================
// SEARCH RESULT TYPES
// ============================================

export const webSearchResultSchema = z.object({
  // Result URL
  url: z.string().url(),
  
  // Page title
  title: z.string(),
  
  // Snippet/description
  snippet: z.string(),
  
  // Domain
  domain: z.string(),
  
  // Publication date if available
  publishedAt: z.string().datetime().optional(),
  
  // Source name (news outlet, blog, etc.)
  sourceName: z.string().optional(),
  
  // Is this a news article?
  isNews: z.boolean().optional(),
  
  // Relevance score from search engine (0-1)
  relevanceScore: z.number().min(0).max(1).optional(),
});

export type WebSearchResult = z.infer<typeof webSearchResultSchema>;

export const webSearchResponseSchema = z.object({
  // Query that was searched
  query: z.string(),
  
  // Total results found
  totalResults: z.number().int().min(0),
  
  // Results returned
  results: z.array(webSearchResultSchema),
  
  // Search duration in ms
  searchDurationMs: z.number().int().min(0),
  
  // Provider used
  provider: z.string(),
  
  // Timestamp
  searchedAt: z.string().datetime(),
});

export type WebSearchResponse = z.infer<typeof webSearchResponseSchema>;

// ============================================
// SEARCH OPTIONS
// ============================================

export interface WebSearchOptions {
  // Maximum results to return
  maxResults?: number;
  
  // Time range filter
  timeRange?: "hour" | "day" | "week" | "month" | "year";
  
  // Filter to news only
  newsOnly?: boolean;
  
  // Exclude certain domains
  excludeDomains?: string[];
  
  // Include only certain domains
  includeDomains?: string[];
  
  // Language filter
  language?: string;
  
  // Region filter
  region?: string;
}

// ============================================
// PROVIDER INTERFACE
// ============================================

export interface WebSearchProvider {
  /**
   * Provider name
   */
  readonly name: string;
  
  /**
   * Search the web for a query
   */
  search(query: string, options?: WebSearchOptions): Promise<WebSearchResponse>;
  
  /**
   * Search for news specifically
   */
  searchNews(query: string, options?: WebSearchOptions): Promise<WebSearchResponse>;
  
  /**
   * Check if a specific URL exists and get its content
   */
  fetchUrl(url: string): Promise<{
    exists: boolean;
    title?: string;
    content?: string;
    publishedAt?: string;
    domain: string;
  }>;
  
  /**
   * Find similar articles/content
   */
  findSimilar(content: string, options?: WebSearchOptions): Promise<WebSearchResponse>;
}

// ============================================
// DOMAIN INFO
// ============================================

export interface DomainInfo {
  domain: string;
  ownershipGroup: string;
  ipBlock?: string;
  asn?: string;
  country?: string;
  credibilityScore: number;
  isKnownNewsOutlet: boolean;
  isPotentiallyManipulated: boolean;
}

export interface DomainInfoProvider {
  /**
   * Get information about a domain
   */
  getDomainInfo(domain: string): Promise<DomainInfo>;
  
  /**
   * Check if domains are from same ownership group
   */
  areSameOwnership(domain1: string, domain2: string): Promise<boolean>;
}

// ============================================
// KNOWN OWNERSHIP GROUPS
// ============================================

/**
 * Known media ownership groups for domain diversity checking
 * Turkish: "farklı sahiplik yapılarında (farklı haber ağları)"
 */
export const KNOWN_OWNERSHIP_GROUPS: Record<string, string[]> = {
  "News Corp": [
    "wsj.com", "barrons.com", "marketwatch.com", "nypost.com",
    "thesun.co.uk", "news.com.au", "foxnews.com"
  ],
  "CNN/Warner": [
    "cnn.com", "cnnbusiness.com", "money.cnn.com", "bleacherreport.com"
  ],
  "Bloomberg LP": [
    "bloomberg.com", "businessweek.com"
  ],
  "Conde Nast": [
    "wired.com", "vanityfair.com", "newyorker.com", "arstechnica.com"
  ],
  "Vox Media": [
    "vox.com", "theverge.com", "polygon.com", "sbnation.com"
  ],
  "BuzzFeed Inc": [
    "buzzfeed.com", "buzzfeednews.com", "huffpost.com"
  ],
  "CoinDesk (DCG)": [
    "coindesk.com",
  ],
  "Crypto Media Group": [
    "cointelegraph.com", "decrypt.co", "theblock.co"
  ],
  "Independent Crypto": [
    "defiant.news", "bankless.com", "messari.io"
  ],
};

/**
 * Get ownership group for a domain
 */
export function getOwnershipGroup(domain: string): string {
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, "");
  
  for (const [group, domains] of Object.entries(KNOWN_OWNERSHIP_GROUPS)) {
    if (domains.some(d => normalizedDomain.includes(d) || d.includes(normalizedDomain))) {
      return group;
    }
  }
  
  // Unknown ownership - use domain as group (each unknown domain is its own group)
  return `Independent: ${normalizedDomain}`;
}

// ============================================
// CREDIBILITY SCORES
// ============================================

/**
 * Known credibility scores for domains (0-1)
 * Higher = more credible
 */
export const DOMAIN_CREDIBILITY: Record<string, number> = {
  // Tier 1: Major established outlets
  "reuters.com": 0.95,
  "apnews.com": 0.95,
  "bloomberg.com": 0.90,
  "wsj.com": 0.90,
  "ft.com": 0.90,
  "nytimes.com": 0.85,
  "bbc.com": 0.85,
  "economist.com": 0.85,
  
  // Tier 2: Quality crypto outlets
  "coindesk.com": 0.80,
  "theblock.co": 0.80,
  "decrypt.co": 0.75,
  "cointelegraph.com": 0.70,
  
  // Tier 3: Social/blog platforms
  "twitter.com": 0.40,
  "x.com": 0.40,
  "reddit.com": 0.35,
  "medium.com": 0.50,
  "substack.com": 0.55,
  
  // Low credibility
  "unknown": 0.30,
};

/**
 * Get credibility score for a domain
 */
export function getDomainCredibility(domain: string): number {
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, "");
  
  for (const [knownDomain, score] of Object.entries(DOMAIN_CREDIBILITY)) {
    if (normalizedDomain.includes(knownDomain) || knownDomain.includes(normalizedDomain)) {
      return score;
    }
  }
  
  return DOMAIN_CREDIBILITY.unknown;
}
