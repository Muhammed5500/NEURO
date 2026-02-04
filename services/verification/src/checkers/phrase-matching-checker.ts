/**
 * Phrase Matching (Copy-Pasta) Checker
 * 
 * Detects coordinated bot activity through identical phrase matching.
 * 
 * Turkish: "Aynı cümlenin 10 farklı bot hesabında aynı anda paylaşılıp
 * paylaşılmadığını kontrol eden bir 'Copy-Pasta' dedektörü ekle"
 */

import { logger } from "@neuro/shared";
import type { 
  PhraseMatchingCheck,
  CopyPastaMatch,
  CrossCheckRiskLevel,
} from "../types/cross-check-report.js";

const checkerLogger = logger.child({ checker: "phrase-matching" });

// ============================================
// CONFIGURATION
// ============================================

export interface PhraseMatchingCheckerConfig {
  // Minimum accounts with same phrase to flag as suspicious
  // Turkish: "10 farklı bot hesabında"
  minAccountsForSuspicion: number;
  
  // Time window for coordinated posts (minutes)
  // Turkish: "aynı anda"
  coordinatedTimeWindowMinutes: number;
  
  // Minimum phrase length to consider (characters)
  minPhraseLength: number;
  
  // Thresholds for bot detection
  newAccountAgeThresholdDays: number;
  lowFollowerThreshold: number;
}

const DEFAULT_CONFIG: PhraseMatchingCheckerConfig = {
  minAccountsForSuspicion: 10,
  coordinatedTimeWindowMinutes: 30,
  minPhraseLength: 20,
  newAccountAgeThresholdDays: 30,
  lowFollowerThreshold: 100,
};

// ============================================
// SOCIAL POST TYPE
// ============================================

export interface SocialPost {
  id: string;
  content: string;
  authorId: string;
  platform: string;
  postedAt: string;
  followerCount?: number;
  accountCreatedAt?: string;
}

// ============================================
// CHECKER IMPLEMENTATION
// ============================================

export class PhraseMatchingChecker {
  private readonly config: PhraseMatchingCheckerConfig;

  constructor(config?: Partial<PhraseMatchingCheckerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check for copy-pasta patterns in social posts
   */
  check(posts: SocialPost[]): PhraseMatchingCheck {
    checkerLogger.info({ postCount: posts.length }, "Checking for copy-pasta patterns");

    // Extract and normalize phrases
    const phraseMap = this.buildPhraseMap(posts);

    // Find suspicious patterns
    const matches: CopyPastaMatch[] = [];
    let totalBotAccounts = 0;

    for (const [phrase, postData] of phraseMap) {
      if (postData.length >= this.config.minAccountsForSuspicion) {
        // Check if posts are within time window
        const timeWindow = this.checkTimeWindow(postData);
        
        // Analyze accounts
        const accountAnalysis = this.analyzeAccounts(postData);
        
        const match: CopyPastaMatch = {
          phrase,
          accountCount: postData.length,
          timeWindowMinutes: timeWindow.windowMinutes,
          likelyBots: accountAnalysis.likelyBotPercentage > 0.5,
          accounts: postData.map(p => ({
            accountId: p.authorId,
            platform: p.platform,
            postedAt: p.postedAt,
            followerCount: p.followerCount,
            accountAge: p.accountCreatedAt ? 
              this.calculateAccountAge(p.accountCreatedAt) : undefined,
            isNewAccount: p.accountCreatedAt ? 
              this.isNewAccount(p.accountCreatedAt) : undefined,
          })),
        };

        matches.push(match);
        
        if (accountAnalysis.likelyBotPercentage > 0.5) {
          totalBotAccounts += accountAnalysis.likelyBotCount;
        }
      }
    }

    // Determine if there's coordinated amplification
    const coordinatedAmplification = matches.some(m => 
      m.accountCount >= this.config.minAccountsForSuspicion &&
      m.timeWindowMinutes <= this.config.coordinatedTimeWindowMinutes &&
      m.likelyBots
    );

    // Calculate risk level
    const riskLevel = this.calculateRiskLevel(matches, coordinatedAmplification);

    // Generate explanation
    const explanation = this.generateExplanation({
      matchCount: matches.length,
      botAccountCount: totalBotAccounts,
      coordinatedAmplification,
    });

    checkerLogger.info({
      suspiciousPhraseCount: matches.length,
      botAccountCount: totalBotAccounts,
      coordinatedAmplification,
      riskLevel,
    }, "Phrase matching check complete");

    return {
      suspiciousPhraseCount: matches.length,
      botAccountCount: totalBotAccounts,
      coordinatedAmplification,
      matches,
      riskLevel,
      explanation,
    };
  }

  /**
   * Extract significant phrases from content
   */
  extractPhrases(content: string): string[] {
    const phrases: string[] = [];
    
    // Split into sentences
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      
      // Only consider phrases long enough
      if (trimmed.length >= this.config.minPhraseLength) {
        // Normalize: lowercase, remove extra spaces
        const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
        phrases.push(normalized);
      }
    }

    return phrases;
  }

  private buildPhraseMap(posts: SocialPost[]): Map<string, SocialPost[]> {
    const phraseMap = new Map<string, SocialPost[]>();

    for (const post of posts) {
      const phrases = this.extractPhrases(post.content);
      
      for (const phrase of phrases) {
        const existing = phraseMap.get(phrase) || [];
        // Only add if from different account
        if (!existing.some(p => p.authorId === post.authorId)) {
          existing.push(post);
        }
        phraseMap.set(phrase, existing);
      }
    }

    return phraseMap;
  }

  private checkTimeWindow(posts: SocialPost[]): {
    windowMinutes: number;
    isWithinWindow: boolean;
  } {
    if (posts.length < 2) {
      return { windowMinutes: 0, isWithinWindow: false };
    }

    const times = posts.map(p => new Date(p.postedAt).getTime()).sort((a, b) => a - b);
    const firstPost = times[0];
    const lastPost = times[times.length - 1];
    const windowMinutes = (lastPost - firstPost) / (1000 * 60);

    return {
      windowMinutes,
      isWithinWindow: windowMinutes <= this.config.coordinatedTimeWindowMinutes,
    };
  }

  private analyzeAccounts(posts: SocialPost[]): {
    likelyBotCount: number;
    likelyBotPercentage: number;
  } {
    let likelyBotCount = 0;

    for (const post of posts) {
      const botScore = this.calculateBotScore(post);
      if (botScore > 0.5) {
        likelyBotCount++;
      }
    }

    return {
      likelyBotCount,
      likelyBotPercentage: posts.length > 0 ? likelyBotCount / posts.length : 0,
    };
  }

  private calculateBotScore(post: SocialPost): number {
    let score = 0;
    let factors = 0;

    // Low follower count
    if (post.followerCount !== undefined) {
      factors++;
      if (post.followerCount < this.config.lowFollowerThreshold) {
        score += 1;
      }
    }

    // New account
    if (post.accountCreatedAt) {
      factors++;
      if (this.isNewAccount(post.accountCreatedAt)) {
        score += 1;
      }
    }

    // Default medium score if no factors available
    return factors > 0 ? score / factors : 0.5;
  }

  private isNewAccount(createdAt: string): boolean {
    const created = new Date(createdAt);
    const now = new Date();
    const ageMs = now.getTime() - created.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays < this.config.newAccountAgeThresholdDays;
  }

  private calculateAccountAge(createdAt: string): string {
    const created = new Date(createdAt);
    const now = new Date();
    const ageMs = now.getTime() - created.getTime();
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    
    if (ageDays < 1) return "< 1 day";
    if (ageDays < 7) return `${ageDays} days`;
    if (ageDays < 30) return `${Math.floor(ageDays / 7)} weeks`;
    if (ageDays < 365) return `${Math.floor(ageDays / 30)} months`;
    return `${Math.floor(ageDays / 365)} years`;
  }

  private calculateRiskLevel(
    matches: CopyPastaMatch[],
    coordinatedAmplification: boolean
  ): CrossCheckRiskLevel {
    // Coordinated bot activity = CRITICAL
    if (coordinatedAmplification) {
      return "CRITICAL";
    }

    // Multiple suspicious phrases with bots = HIGH
    if (matches.filter(m => m.likelyBots).length >= 2) {
      return "HIGH";
    }

    // Any suspicious phrase patterns = MEDIUM
    if (matches.length > 0) {
      return "MEDIUM";
    }

    return "LOW";
  }

  private generateExplanation(params: {
    matchCount: number;
    botAccountCount: number;
    coordinatedAmplification: boolean;
  }): string {
    const parts: string[] = [];

    if (params.coordinatedAmplification) {
      parts.push("ALERT: Coordinated bot amplification detected!");
      parts.push(`${params.botAccountCount} likely bot accounts identified.`);
    } else if (params.matchCount > 0) {
      parts.push(`${params.matchCount} suspicious phrase pattern(s) detected.`);
      if (params.botAccountCount > 0) {
        parts.push(`${params.botAccountCount} potential bot account(s) identified.`);
      }
    } else {
      parts.push("No suspicious copy-pasta patterns detected.");
    }

    return parts.join(" ");
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createPhraseMatchingChecker(
  config?: Partial<PhraseMatchingCheckerConfig>
): PhraseMatchingChecker {
  return new PhraseMatchingChecker(config);
}
