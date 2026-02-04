/**
 * Cross-Check Service
 * 
 * Orchestrates all verification checks and produces a CrossCheckReport.
 * Used by the Adversarial Agent to verify claims and detect manipulation.
 */

import { logger } from "@neuro/shared";
import type {
  CrossCheckReport,
  CrossCheckRiskLevel,
} from "./types/cross-check-report.js";
import { createCrossCheckReport } from "./types/cross-check-report.js";
import type { WebSearchProvider } from "./providers/web-search-provider.js";
import { MockWebSearchProvider } from "./providers/mock-web-search-provider.js";
import {
  RecycledNewsChecker,
  createRecycledNewsChecker,
} from "./checkers/recycled-news-checker.js";
import {
  MultiSourceChecker,
  createMultiSourceChecker,
} from "./checkers/multi-source-checker.js";
import {
  PhraseMatchingChecker,
  createPhraseMatchingChecker,
  type SocialPost,
} from "./checkers/phrase-matching-checker.js";
import {
  DomainDiversityChecker,
  createDomainDiversityChecker,
} from "./checkers/domain-diversity-checker.js";
import {
  TemporalConsistencyChecker,
  createTemporalConsistencyChecker,
} from "./checkers/temporal-consistency-checker.js";

const serviceLogger = logger.child({ service: "cross-check" });

// ============================================
// CONFIGURATION
// ============================================

export interface CrossCheckServiceConfig {
  // Use mock provider for testing
  useMockProvider?: boolean;
  
  // Search provider to use
  searchProvider?: WebSearchProvider;
  
  // Thresholds for blocking/downgrading
  blockRiskLevels: CrossCheckRiskLevel[];
  downgradeRiskLevels: CrossCheckRiskLevel[];
  
  // Recycled news config
  staleThresholdHours?: number;
  
  // Multi-source config
  minSourcesForHighImportance?: number;
  
  // Phrase matching config
  minAccountsForSuspicion?: number;
  
  // Domain diversity config
  minOwnershipGroups?: number;
}

const DEFAULT_CONFIG: CrossCheckServiceConfig = {
  useMockProvider: false,
  blockRiskLevels: ["CRITICAL"],
  downgradeRiskLevels: ["HIGH"],
};

// ============================================
// INPUT TYPES
// ============================================

export interface CrossCheckInput {
  // What to check
  type: "news" | "social" | "claim";
  title: string;
  content: string;
  source: string;
  originalTimestamp?: string;
  
  // Importance level (affects required confirmations)
  importance?: "low" | "medium" | "high";
  
  // Social posts for copy-pasta detection
  relatedSocialPosts?: SocialPost[];
  
  // Trending info
  trendingAt?: string;
  
  // Additional domains to check diversity
  additionalDomains?: string[];
}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export class CrossCheckService {
  private readonly config: CrossCheckServiceConfig;
  private readonly searchProvider: WebSearchProvider;
  private readonly recycledNewsChecker: RecycledNewsChecker;
  private readonly multiSourceChecker: MultiSourceChecker;
  private readonly phraseMatchingChecker: PhraseMatchingChecker;
  private readonly domainDiversityChecker: DomainDiversityChecker;
  private readonly temporalConsistencyChecker: TemporalConsistencyChecker;

  constructor(config?: Partial<CrossCheckServiceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Initialize search provider
    this.searchProvider = this.config.searchProvider || 
      (this.config.useMockProvider 
        ? new MockWebSearchProvider()
        : new MockWebSearchProvider()); // Default to mock for now
    
    // Initialize checkers
    this.recycledNewsChecker = createRecycledNewsChecker(
      this.searchProvider,
      { staleThresholdHours: this.config.staleThresholdHours }
    );
    
    this.multiSourceChecker = createMultiSourceChecker(
      this.searchProvider,
      { minSourcesForHighImportance: this.config.minSourcesForHighImportance }
    );
    
    this.phraseMatchingChecker = createPhraseMatchingChecker(
      { minAccountsForSuspicion: this.config.minAccountsForSuspicion }
    );
    
    this.domainDiversityChecker = createDomainDiversityChecker(
      { minOwnershipGroups: this.config.minOwnershipGroups }
    );
    
    this.temporalConsistencyChecker = createTemporalConsistencyChecker(
      { staleThresholdHours: this.config.staleThresholdHours }
    );

    serviceLogger.info({
      useMockProvider: this.config.useMockProvider,
    }, "Cross-check service initialized");
  }

  /**
   * Run full cross-check and produce report
   */
  async check(input: CrossCheckInput): Promise<CrossCheckReport> {
    const startTime = Date.now();
    
    serviceLogger.info({
      type: input.type,
      title: input.title.slice(0, 50),
      importance: input.importance,
    }, "Starting cross-check");

    const findings: string[] = [];
    const recommendations: string[] = [];

    // 1. Recycled News Check
    const recycledNewsCheck = await this.recycledNewsChecker.check({
      title: input.title,
      content: input.content,
      reportedPublishedAt: input.originalTimestamp,
      trendingAt: input.trendingAt,
    });
    
    if (recycledNewsCheck.isRecycled || recycledNewsCheck.isFakeFresh) {
      findings.push(`Recycled/stale news detected (${recycledNewsCheck.ageHours?.toFixed(1)}h old)`);
      recommendations.push("Verify if this news is truly new or a recycled story");
    }

    // 2. Multi-Source Check
    const multiSourceCheck = await this.multiSourceChecker.check({
      claim: input.title,
      originalSource: input.source,
      importance: input.importance || "medium",
    });
    
    if (!multiSourceCheck.requirementMet) {
      findings.push(`Insufficient source confirmation (${multiSourceCheck.independentSourcesConfirmed}/${multiSourceCheck.minimumRequired})`);
      recommendations.push("Wait for independent source confirmation before acting");
    }

    // 3. Domain Diversity Check
    const domains = [
      input.source,
      ...multiSourceCheck.sources.map(s => s.domain),
      ...(input.additionalDomains || []),
    ];
    
    const domainDiversityCheck = await this.domainDiversityChecker.check(domains);
    
    if (domainDiversityCheck.uniqueOwnershipGroups <= 1) {
      findings.push("All sources from same ownership group");
      recommendations.push("Seek confirmation from truly independent sources");
    }

    // 4. Phrase Matching Check (if social posts provided)
    let phraseMatchingCheck;
    if (input.relatedSocialPosts && input.relatedSocialPosts.length > 0) {
      phraseMatchingCheck = this.phraseMatchingChecker.check(input.relatedSocialPosts);
      
      if (phraseMatchingCheck.coordinatedAmplification) {
        findings.push(`Coordinated bot amplification detected (${phraseMatchingCheck.botAccountCount} bot accounts)`);
        recommendations.push("HIGH RISK: This appears to be a coordinated campaign");
      }
    }

    // 5. Temporal Consistency Check
    const temporalConsistencyCheck = this.temporalConsistencyChecker.check({
      originalPublicationTime: input.originalTimestamp,
      trendingStartTime: input.trendingAt,
    });
    
    if (temporalConsistencyCheck.staleNewsBeingPushed) {
      findings.push(`Stale news being pushed as fresh (${temporalConsistencyCheck.publicationToTrendingHours?.toFixed(1)}h gap)`);
      recommendations.push("Investigate why old news is suddenly trending");
    }

    // Calculate overall risk
    const riskLevels = [
      recycledNewsCheck.riskLevel,
      multiSourceCheck.riskLevel,
      domainDiversityCheck.riskLevel,
      phraseMatchingCheck?.riskLevel || "LOW",
      temporalConsistencyCheck.riskLevel,
    ];
    
    const overallRiskLevel = this.calculateOverallRisk(riskLevels);
    const overallScore = this.calculateOverallScore(riskLevels);

    // Determine if should block or downgrade
    const shouldBlock = this.config.blockRiskLevels.includes(overallRiskLevel);
    const shouldDowngrade = this.config.downgradeRiskLevels.includes(overallRiskLevel) && !shouldBlock;

    // Generate summary
    const summary = this.generateSummary({
      overallRiskLevel,
      findings,
      shouldBlock,
      shouldDowngrade,
    });

    // Calculate check duration
    const checkDurationMs = Date.now() - startTime;

    serviceLogger.info({
      overallRiskLevel,
      overallScore,
      shouldBlock,
      shouldDowngrade,
      findingsCount: findings.length,
      checkDurationMs,
    }, "Cross-check complete");

    return createCrossCheckReport({
      subject: {
        type: input.type,
        title: input.title,
        content: input.content,
        source: input.source,
        originalTimestamp: input.originalTimestamp,
      },
      recycledNewsCheck,
      multiSourceCheck,
      domainDiversityCheck,
      phraseMatchingCheck,
      temporalConsistencyCheck,
      overallRiskLevel,
      overallScore,
      shouldBlock,
      shouldDowngrade,
      downgradedTo: shouldDowngrade ? this.getDowngradedImportance(input.importance) : undefined,
      summary,
      findings,
      recommendations,
      checkDurationMs,
    });
  }

  /**
   * Quick verification check (faster, less thorough)
   */
  async quickCheck(input: {
    title: string;
    source: string;
    importance: "low" | "medium" | "high";
  }): Promise<{
    passesCheck: boolean;
    riskLevel: CrossCheckRiskLevel;
    summary: string;
  }> {
    // Quick recycled check
    const recycled = await this.recycledNewsChecker.quickCheck(input.title);
    
    // Quick confirmation check
    const confirmation = await this.multiSourceChecker.quickCheck(input.title);
    
    // Determine if passes
    const passesCheck = !recycled.possiblyRecycled && confirmation.hasConfirmation;
    
    const riskLevel = recycled.possiblyRecycled
      ? "HIGH"
      : !confirmation.hasConfirmation && input.importance === "high"
        ? "HIGH"
        : "LOW";

    return {
      passesCheck,
      riskLevel,
      summary: passesCheck 
        ? "Quick check passed" 
        : `Issues: ${recycled.possiblyRecycled ? "possibly recycled" : ""} ${!confirmation.hasConfirmation ? "unconfirmed" : ""}`.trim(),
    };
  }

  private calculateOverallRisk(levels: CrossCheckRiskLevel[]): CrossCheckRiskLevel {
    if (levels.includes("CRITICAL")) return "CRITICAL";
    if (levels.includes("HIGH")) return "HIGH";
    if (levels.includes("MEDIUM")) return "MEDIUM";
    return "LOW";
  }

  private calculateOverallScore(levels: CrossCheckRiskLevel[]): number {
    const scores: Record<CrossCheckRiskLevel, number> = {
      LOW: 1,
      MEDIUM: 0.7,
      HIGH: 0.3,
      CRITICAL: 0,
    };
    
    const totalScore = levels.reduce((sum, level) => sum + scores[level], 0);
    return Math.round((totalScore / levels.length) * 100) / 100;
  }

  private getDowngradedImportance(
    current?: "low" | "medium" | "high"
  ): "low" | "medium" | "high" {
    switch (current) {
      case "high": return "medium";
      case "medium": return "low";
      default: return "low";
    }
  }

  private generateSummary(params: {
    overallRiskLevel: CrossCheckRiskLevel;
    findings: string[];
    shouldBlock: boolean;
    shouldDowngrade: boolean;
  }): string {
    const parts: string[] = [];
    
    parts.push(`Overall Risk: ${params.overallRiskLevel}.`);
    
    if (params.shouldBlock) {
      parts.push("RECOMMENDATION: BLOCK this decision.");
    } else if (params.shouldDowngrade) {
      parts.push("RECOMMENDATION: DOWNGRADE importance.");
    }
    
    if (params.findings.length > 0) {
      parts.push(`Issues found: ${params.findings.length}.`);
    } else {
      parts.push("No significant issues detected.");
    }
    
    return parts.join(" ");
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createCrossCheckService(
  config?: Partial<CrossCheckServiceConfig>
): CrossCheckService {
  return new CrossCheckService(config);
}
