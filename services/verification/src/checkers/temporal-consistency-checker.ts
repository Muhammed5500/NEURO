/**
 * Temporal Consistency Checker
 * 
 * Checks the time consistency between news publication and social spread.
 * 
 * Turkish: "Haberin orijinal yayınlanma tarihi ile sosyal medyadaki yayılma hızı
 * arasındaki farkı kontrol et. Eğer haber 6 saat eskiyse ama yeniymiş gibi
 * trend oluyorsa HIGH_RISK olarak işaretle."
 */

import { logger } from "@neuro/shared";
import type { 
  TemporalConsistencyCheck,
  CrossCheckRiskLevel,
} from "../types/cross-check-report.js";

const checkerLogger = logger.child({ checker: "temporal-consistency" });

// ============================================
// CONFIGURATION
// ============================================

export interface TemporalConsistencyCheckerConfig {
  // Threshold for stale news in hours
  // Turkish: "6 saat eskiyse"
  staleThresholdHours: number;
  
  // Maximum acceptable gap between publication and trending
  maxAcceptableGapHours: number;
}

const DEFAULT_CONFIG: TemporalConsistencyCheckerConfig = {
  staleThresholdHours: 6,
  maxAcceptableGapHours: 12,
};

// ============================================
// INPUT TYPES
// ============================================

export interface TemporalCheckInput {
  // Original news publication time
  originalPublicationTime?: string;
  
  // First social media mention
  firstSocialMention?: string;
  
  // When the content started trending
  trendingStartTime?: string;
  
  // Current time (defaults to now)
  checkTime?: string;
}

// ============================================
// CHECKER IMPLEMENTATION
// ============================================

export class TemporalConsistencyChecker {
  private readonly config: TemporalConsistencyCheckerConfig;

  constructor(config?: Partial<TemporalConsistencyCheckerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check temporal consistency
   */
  check(input: TemporalCheckInput): TemporalConsistencyCheck {
    checkerLogger.info("Checking temporal consistency");

    const now = input.checkTime ? new Date(input.checkTime) : new Date();
    const originalPubTime = input.originalPublicationTime 
      ? new Date(input.originalPublicationTime) : undefined;
    const firstSocial = input.firstSocialMention
      ? new Date(input.firstSocialMention) : undefined;
    const trendingStart = input.trendingStartTime
      ? new Date(input.trendingStartTime) : now;

    // Calculate publication to trending gap
    let publicationToTrendingHours: number | undefined;
    if (originalPubTime) {
      publicationToTrendingHours = 
        (trendingStart.getTime() - originalPubTime.getTime()) / (1000 * 60 * 60);
    }

    // Determine if stale news is being pushed as fresh
    // Turkish: "haber 6 saat eskiyse ama yeniymiş gibi trend oluyorsa"
    const staleNewsBeingPushed = publicationToTrendingHours !== undefined &&
      publicationToTrendingHours > this.config.staleThresholdHours;

    // Calculate risk level
    const riskLevel = this.calculateRiskLevel(publicationToTrendingHours, staleNewsBeingPushed);

    // Generate explanation
    const explanation = this.generateExplanation({
      publicationToTrendingHours,
      staleNewsBeingPushed,
      staleThresholdHours: this.config.staleThresholdHours,
    });

    checkerLogger.info({
      publicationToTrendingHours,
      staleNewsBeingPushed,
      riskLevel,
    }, "Temporal consistency check complete");

    return {
      originalPublicationTime: originalPubTime?.toISOString(),
      firstSocialMention: firstSocial?.toISOString(),
      trendingStartTime: trendingStart.toISOString(),
      publicationToTrendingHours,
      staleNewsBeingPushed,
      staleThresholdHours: this.config.staleThresholdHours,
      riskLevel,
      explanation,
    };
  }

  /**
   * Quick check for temporal issues
   */
  quickCheck(
    originalPublicationTime: string,
    currentTime?: string
  ): {
    isStale: boolean;
    hoursOld: number;
  } {
    const pubTime = new Date(originalPublicationTime);
    const now = currentTime ? new Date(currentTime) : new Date();
    const hoursOld = (now.getTime() - pubTime.getTime()) / (1000 * 60 * 60);

    return {
      isStale: hoursOld > this.config.staleThresholdHours,
      hoursOld,
    };
  }

  private calculateRiskLevel(
    publicationToTrendingHours: number | undefined,
    staleNewsBeingPushed: boolean
  ): CrossCheckRiskLevel {
    // Turkish: "HIGH_RISK olarak işaretle"
    if (staleNewsBeingPushed) {
      // Very old news (> 24h) being pushed = CRITICAL
      if ((publicationToTrendingHours || 0) > 24) {
        return "CRITICAL";
      }
      // Moderately stale news = HIGH
      return "HIGH";
    }

    // Some delay but within acceptable range = MEDIUM
    if ((publicationToTrendingHours || 0) > this.config.staleThresholdHours / 2) {
      return "MEDIUM";
    }

    return "LOW";
  }

  private generateExplanation(params: {
    publicationToTrendingHours?: number;
    staleNewsBeingPushed: boolean;
    staleThresholdHours: number;
  }): string {
    const parts: string[] = [];

    if (params.publicationToTrendingHours !== undefined) {
      parts.push(`Publication to trending gap: ${params.publicationToTrendingHours.toFixed(1)} hours.`);
    } else {
      parts.push("Original publication time unknown.");
    }

    if (params.staleNewsBeingPushed) {
      parts.push(`WARNING: News is ${params.publicationToTrendingHours?.toFixed(1)} hours old but being pushed as fresh!`);
      parts.push(`(Threshold: ${params.staleThresholdHours} hours)`);
    } else {
      parts.push("Temporal consistency OK.");
    }

    return parts.join(" ");
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createTemporalConsistencyChecker(
  config?: Partial<TemporalConsistencyCheckerConfig>
): TemporalConsistencyChecker {
  return new TemporalConsistencyChecker(config);
}
