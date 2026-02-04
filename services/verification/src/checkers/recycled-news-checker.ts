/**
 * Recycled News Checker
 * 
 * Detects old/recycled news being pushed as new.
 * 
 * Turkish: "Haberin orijinal yayınlanma tarihi ile sosyal medyadaki yayılma hızı
 * arasındaki farkı kontrol et. Eğer haber 6 saat eskiyse ama yeniymiş gibi
 * trend oluyorsa HIGH_RISK olarak işaretle."
 */

import { logger } from "@neuro/shared";
import type { 
  RecycledNewsCheck, 
  CrossCheckRiskLevel,
} from "../types/cross-check-report.js";
import type { 
  WebSearchProvider, 
  WebSearchResult,
} from "../providers/web-search-provider.js";

const checkerLogger = logger.child({ checker: "recycled-news" });

// ============================================
// CONFIGURATION
// ============================================

export interface RecycledNewsCheckerConfig {
  // Threshold for "stale" news in hours
  // Turkish: "6 saat eskiyse"
  staleThresholdHours: number;
  
  // Maximum age to consider (older is definitely recycled)
  maxAgeHours: number;
  
  // Minimum similarity to consider duplicate
  duplicateSimilarityThreshold: number;
}

const DEFAULT_CONFIG: RecycledNewsCheckerConfig = {
  staleThresholdHours: 6,
  maxAgeHours: 168, // 7 days
  duplicateSimilarityThreshold: 0.85,
};

// ============================================
// CHECKER IMPLEMENTATION
// ============================================

export class RecycledNewsChecker {
  private readonly config: RecycledNewsCheckerConfig;
  private readonly searchProvider: WebSearchProvider;

  constructor(searchProvider: WebSearchProvider, config?: Partial<RecycledNewsCheckerConfig>) {
    this.searchProvider = searchProvider;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if news is recycled/old
   */
  async check(params: {
    title: string;
    content: string;
    reportedPublishedAt?: string;
    trendingAt?: string;
  }): Promise<RecycledNewsCheck> {
    checkerLogger.info({ title: params.title.slice(0, 50) }, "Checking for recycled news");

    const now = new Date();
    const canonicalUrls: string[] = [];
    const duplicateHashes: string[] = [];
    
    // Search for similar news
    const searchResponse = await this.searchProvider.search(
      params.title,
      { maxResults: 20, newsOnly: true, timeRange: "month" }
    );

    // Find the oldest publication
    let oldestPublicationDate: Date | null = null;
    
    for (const result of searchResponse.results) {
      if (result.publishedAt) {
        const pubDate = new Date(result.publishedAt);
        if (!oldestPublicationDate || pubDate < oldestPublicationDate) {
          oldestPublicationDate = pubDate;
        }
      }
      
      canonicalUrls.push(result.url);
      
      // Create content hash for duplicate detection
      const hash = this.createContentHash(result.title + result.snippet);
      if (!duplicateHashes.includes(hash)) {
        duplicateHashes.push(hash);
      }
    }

    // Calculate age and temporal gap
    const originalPublicationDate = oldestPublicationDate || 
      (params.reportedPublishedAt ? new Date(params.reportedPublishedAt) : null);
    
    let ageHours: number | undefined;
    let temporalGapHours: number | undefined;
    
    if (originalPublicationDate) {
      ageHours = (now.getTime() - originalPublicationDate.getTime()) / (1000 * 60 * 60);
    }

    const trendingTime = params.trendingAt ? new Date(params.trendingAt) : now;
    if (originalPublicationDate) {
      temporalGapHours = (trendingTime.getTime() - originalPublicationDate.getTime()) / (1000 * 60 * 60);
    }

    // Determine if recycled
    const isRecycled = ageHours !== undefined && ageHours > this.config.maxAgeHours;
    
    // Determine if being pushed as fresh when stale
    // Turkish: "yeniymiş gibi trend oluyorsa"
    const isFakeFresh = temporalGapHours !== undefined && 
                        temporalGapHours > this.config.staleThresholdHours;

    // Calculate risk level
    const riskLevel = this.calculateRiskLevel(ageHours, temporalGapHours, isRecycled, isFakeFresh);

    // Generate explanation
    const explanation = this.generateExplanation({
      ageHours,
      temporalGapHours,
      isRecycled,
      isFakeFresh,
      resultCount: searchResponse.totalResults,
    });

    checkerLogger.info({
      isRecycled,
      isFakeFresh,
      ageHours,
      riskLevel,
    }, "Recycled news check complete");

    return {
      isRecycled,
      originalPublicationDate: originalPublicationDate?.toISOString(),
      ageHours,
      isFakeFresh,
      temporalGapHours,
      canonicalUrls: canonicalUrls.slice(0, 10), // Limit to 10
      duplicateHashes: duplicateHashes.slice(0, 10),
      riskLevel,
      explanation,
    };
  }

  /**
   * Quick check if content might be recycled
   */
  async quickCheck(title: string): Promise<{
    possiblyRecycled: boolean;
    oldestDate?: string;
  }> {
    const results = await this.searchProvider.search(title, { maxResults: 5 });
    
    let oldestDate: Date | null = null;
    for (const result of results.results) {
      if (result.publishedAt) {
        const date = new Date(result.publishedAt);
        if (!oldestDate || date < oldestDate) {
          oldestDate = date;
        }
      }
    }

    const now = new Date();
    const ageHours = oldestDate ? 
      (now.getTime() - oldestDate.getTime()) / (1000 * 60 * 60) : 0;

    return {
      possiblyRecycled: ageHours > this.config.staleThresholdHours,
      oldestDate: oldestDate?.toISOString(),
    };
  }

  private calculateRiskLevel(
    ageHours: number | undefined,
    temporalGapHours: number | undefined,
    isRecycled: boolean,
    isFakeFresh: boolean
  ): CrossCheckRiskLevel {
    // Critical: Definitely recycled old news being pushed
    if (isRecycled && isFakeFresh) {
      return "CRITICAL";
    }

    // High: Stale news being pushed as fresh
    // Turkish: "haber 6 saat eskiyse ama yeniymiş gibi trend oluyorsa HIGH_RISK"
    if (isFakeFresh && (ageHours || 0) > this.config.staleThresholdHours) {
      return "HIGH";
    }

    // Medium: News is getting old
    if ((temporalGapHours || 0) > this.config.staleThresholdHours / 2) {
      return "MEDIUM";
    }

    // Low: Fresh news
    return "LOW";
  }

  private generateExplanation(params: {
    ageHours?: number;
    temporalGapHours?: number;
    isRecycled: boolean;
    isFakeFresh: boolean;
    resultCount: number;
  }): string {
    const parts: string[] = [];

    if (params.isRecycled) {
      parts.push(`News appears to be recycled (${params.ageHours?.toFixed(1)} hours old).`);
    }

    if (params.isFakeFresh) {
      parts.push(`Stale news is being pushed as fresh (${params.temporalGapHours?.toFixed(1)} hour gap).`);
    }

    if (!params.isRecycled && !params.isFakeFresh) {
      if (params.ageHours) {
        parts.push(`News is ${params.ageHours.toFixed(1)} hours old.`);
      } else {
        parts.push("News appears to be fresh.");
      }
    }

    parts.push(`Found ${params.resultCount} related results.`);

    return parts.join(" ");
  }

  private createContentHash(content: string): string {
    // Simple hash for content comparison
    const normalized = content.toLowerCase().replace(/[^a-z0-9]/g, "");
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createRecycledNewsChecker(
  searchProvider: WebSearchProvider,
  config?: Partial<RecycledNewsCheckerConfig>
): RecycledNewsChecker {
  return new RecycledNewsChecker(searchProvider, config);
}
