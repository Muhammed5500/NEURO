/**
 * Multi-Source Confirmation Checker
 * 
 * Verifies that high-importance claims are confirmed by multiple independent sources.
 * If Scout marks high importance but no other sources confirm, Adversarial downgrades or blocks.
 */

import { logger } from "@neuro/shared";
import type { 
  MultiSourceCheck,
  SourceConfirmation,
  CrossCheckRiskLevel,
} from "../types/cross-check-report.js";
import type { WebSearchProvider } from "../providers/web-search-provider.js";
import { 
  getOwnershipGroup, 
  getDomainCredibility,
} from "../providers/web-search-provider.js";

const checkerLogger = logger.child({ checker: "multi-source" });

// ============================================
// CONFIGURATION
// ============================================

export interface MultiSourceCheckerConfig {
  // Minimum independent sources required for "high importance"
  minSourcesForHighImportance: number;
  
  // Minimum independent sources required for "medium importance"
  minSourcesForMediumImportance: number;
  
  // Minimum similarity score to count as confirmation
  confirmationSimilarityThreshold: number;
  
  // Minimum credibility score to count as credible source
  credibilityThreshold: number;
}

const DEFAULT_CONFIG: MultiSourceCheckerConfig = {
  minSourcesForHighImportance: 3,
  minSourcesForMediumImportance: 2,
  confirmationSimilarityThreshold: 0.6,
  credibilityThreshold: 0.5,
};

// ============================================
// CHECKER IMPLEMENTATION
// ============================================

export class MultiSourceChecker {
  private readonly config: MultiSourceCheckerConfig;
  private readonly searchProvider: WebSearchProvider;

  constructor(searchProvider: WebSearchProvider, config?: Partial<MultiSourceCheckerConfig>) {
    this.searchProvider = searchProvider;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check for multi-source confirmation
   */
  async check(params: {
    claim: string;
    originalSource: string;
    importance: "low" | "medium" | "high";
  }): Promise<MultiSourceCheck> {
    checkerLogger.info({ 
      claim: params.claim.slice(0, 50),
      importance: params.importance,
    }, "Checking multi-source confirmation");

    // Search for the claim
    const searchResponse = await this.searchProvider.searchNews(params.claim, {
      maxResults: 20,
    });

    // Analyze sources
    const sources: SourceConfirmation[] = [];
    const seenDomains = new Set<string>();
    const seenOwnershipGroups = new Set<string>();

    // Get original source info
    const originalDomain = this.extractDomain(params.originalSource);
    const originalOwnershipGroup = getOwnershipGroup(originalDomain);
    seenDomains.add(originalDomain);
    seenOwnershipGroups.add(originalOwnershipGroup);

    for (const result of searchResponse.results) {
      const domain = result.domain;
      
      // Skip if same domain as original
      if (domain.toLowerCase() === originalDomain.toLowerCase()) {
        continue;
      }

      const ownershipGroup = getOwnershipGroup(domain);
      const credibilityScore = getDomainCredibility(domain);
      
      // Calculate similarity (simplified - in production would use semantic similarity)
      const similarityScore = this.calculateSimilarity(params.claim, result.title + " " + result.snippet);

      // Is this an independent source?
      const isIndependent = !seenOwnershipGroups.has(ownershipGroup);

      sources.push({
        url: result.url,
        domain,
        sourceName: result.sourceName || domain,
        isIndependent,
        publishedAt: result.publishedAt,
        similarityScore,
        credibilityScore,
        ownershipGroup,
      });

      seenDomains.add(domain);
      seenOwnershipGroups.add(ownershipGroup);
    }

    // Count independent, credible confirmations
    const independentSourcesConfirmed = sources.filter(s => 
      s.isIndependent && 
      s.similarityScore >= this.config.confirmationSimilarityThreshold &&
      s.credibilityScore >= this.config.credibilityThreshold
    ).length;

    // Check if minimum is met
    const minimumRequired = params.importance === "high" 
      ? this.config.minSourcesForHighImportance
      : params.importance === "medium"
        ? this.config.minSourcesForMediumImportance
        : 1;

    const requirementMet = independentSourcesConfirmed >= minimumRequired;

    // Calculate risk level
    const riskLevel = this.calculateRiskLevel(
      params.importance,
      independentSourcesConfirmed,
      minimumRequired
    );

    // Generate explanation
    const explanation = this.generateExplanation({
      importance: params.importance,
      independentSourcesConfirmed,
      minimumRequired,
      requirementMet,
      totalSources: sources.length,
    });

    checkerLogger.info({
      independentSourcesConfirmed,
      minimumRequired,
      requirementMet,
      riskLevel,
    }, "Multi-source check complete");

    return {
      totalSourcesFound: sources.length,
      independentSourcesConfirmed,
      minimumRequired,
      requirementMet,
      sources: sources.slice(0, 10), // Limit to 10 for report
      riskLevel,
      explanation,
    };
  }

  /**
   * Quick check for confirmation count
   */
  async quickCheck(claim: string): Promise<{
    hasConfirmation: boolean;
    sourceCount: number;
  }> {
    const results = await this.searchProvider.searchNews(claim, { maxResults: 5 });
    
    return {
      hasConfirmation: results.totalResults > 1,
      sourceCount: results.totalResults,
    };
  }

  private calculateRiskLevel(
    importance: "low" | "medium" | "high",
    confirmed: number,
    required: number
  ): CrossCheckRiskLevel {
    const ratio = confirmed / required;

    // High importance with no confirmation = CRITICAL
    if (importance === "high" && confirmed === 0) {
      return "CRITICAL";
    }

    // High importance with insufficient confirmation = HIGH
    if (importance === "high" && ratio < 1) {
      return "HIGH";
    }

    // Medium importance with no confirmation = HIGH
    if (importance === "medium" && confirmed === 0) {
      return "HIGH";
    }

    // Partial confirmation = MEDIUM
    if (ratio < 1) {
      return "MEDIUM";
    }

    // Fully confirmed = LOW
    return "LOW";
  }

  private generateExplanation(params: {
    importance: string;
    independentSourcesConfirmed: number;
    minimumRequired: number;
    requirementMet: boolean;
    totalSources: number;
  }): string {
    const parts: string[] = [];

    if (params.requirementMet) {
      parts.push(`Claim confirmed by ${params.independentSourcesConfirmed} independent source(s).`);
      parts.push(`Requirement met (${params.minimumRequired} needed for ${params.importance} importance).`);
    } else {
      parts.push(`Only ${params.independentSourcesConfirmed} independent confirmation(s) found.`);
      parts.push(`${params.minimumRequired} required for ${params.importance} importance.`);
      parts.push("CAUTION: Insufficient confirmation.");
    }

    parts.push(`Total sources found: ${params.totalSources}.`);

    return parts.join(" ");
  }

  private calculateSimilarity(text1: string, text2: string): number {
    // Simple word overlap similarity (production would use embeddings)
    const words1 = new Set(text1.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const words2 = new Set(text2.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private extractDomain(urlOrDomain: string): string {
    try {
      if (urlOrDomain.startsWith("http")) {
        return new URL(urlOrDomain).hostname.replace(/^www\./, "");
      }
      return urlOrDomain.replace(/^www\./, "");
    } catch {
      return urlOrDomain;
    }
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createMultiSourceChecker(
  searchProvider: WebSearchProvider,
  config?: Partial<MultiSourceCheckerConfig>
): MultiSourceChecker {
  return new MultiSourceChecker(searchProvider, config);
}
