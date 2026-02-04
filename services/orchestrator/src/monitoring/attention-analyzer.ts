/**
 * Attention Decay Analyzer
 * 
 * Analyzes social attention and sentiment:
 * - Tweet volume trends
 * - Sentiment velocity analysis
 * - Engagement decay detection
 * 
 * Turkish: "Sentiment Velocity (Duygu hızı) analizi yap. Olumlu havadan nötr havaya geçiş hızını attention_decay puanına dönüştür."
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  AttentionMetrics,
  AttentionDecayResult,
  SentimentState,
  MonitoringConfig,
} from "./types.js";
import { DEFAULT_MONITORING_CONFIG } from "./types.js";

const attentionLogger = logger.child({ component: "attention-analyzer" });

// ============================================
// SENTIMENT DATA POINT
// ============================================

interface SentimentDataPoint {
  timestamp: number;
  tweetCount: number;
  sentimentScore: number; // -1 to 1
  engagement: number;
  newsCount: number;
}

// ============================================
// ATTENTION ANALYZER
// ============================================

export class AttentionAnalyzer {
  private readonly config: MonitoringConfig["attentionDecayThreshold"];
  
  // History per token
  private readonly history: Map<string, SentimentDataPoint[]> = new Map();
  
  // Current metrics
  private readonly metrics: Map<string, AttentionMetrics> = new Map();
  
  // Max history points
  private readonly maxHistoryPoints = 500;

  constructor(config?: Partial<MonitoringConfig["attentionDecayThreshold"]>) {
    this.config = { ...DEFAULT_MONITORING_CONFIG.attentionDecayThreshold, ...config };

    attentionLogger.info({
      volumeDropThreshold: this.config.volumeDropPercent,
      sentimentDropRate: this.config.sentimentDropRate,
    }, "AttentionAnalyzer initialized");
  }

  /**
   * Update attention metrics with new data
   */
  updateMetrics(
    tokenAddress: string,
    tweetCount: number,
    sentimentScore: number,
    engagement: number,
    newsCount: number
  ): AttentionMetrics {
    const now = Date.now();
    
    // Get or create history
    let tokenHistory = this.history.get(tokenAddress);
    if (!tokenHistory) {
      tokenHistory = [];
      this.history.set(tokenAddress, tokenHistory);
    }

    // Add new data point
    tokenHistory.push({
      timestamp: now,
      tweetCount,
      sentimentScore,
      engagement,
      newsCount,
    });

    // Trim history
    if (tokenHistory.length > this.maxHistoryPoints) {
      tokenHistory.splice(0, tokenHistory.length - this.maxHistoryPoints);
    }

    // Calculate metrics
    const metrics = this.calculateMetrics(tokenAddress, tokenHistory);
    this.metrics.set(tokenAddress, metrics);

    attentionLogger.debug({
      tokenAddress,
      tweetCount,
      sentimentScore: sentimentScore.toFixed(2),
      decayScore: metrics.attentionDecayScore.toFixed(2),
    }, "Attention metrics updated");

    return metrics;
  }

  /**
   * Get current metrics for a token
   */
  getMetrics(tokenAddress: string): AttentionMetrics | undefined {
    return this.metrics.get(tokenAddress);
  }

  /**
   * Analyze attention decay
   * Turkish: "attention_decay puanına dönüştür"
   */
  analyzeDecay(tokenAddress: string): AttentionDecayResult | null {
    const tokenHistory = this.history.get(tokenAddress);
    const metrics = this.metrics.get(tokenAddress);

    if (!tokenHistory || !metrics || tokenHistory.length < 10) {
      return null;
    }

    // Split history for comparison
    const midpoint = Math.floor(tokenHistory.length / 2);
    const firstHalf = tokenHistory.slice(0, midpoint);
    const secondHalf = tokenHistory.slice(midpoint);

    // Calculate volume decay
    const firstVolume = this.calculateAverageTweetCount(firstHalf);
    const secondVolume = this.calculateAverageTweetCount(secondHalf);
    const volumeDecay = firstVolume > 0 
      ? ((firstVolume - secondVolume) / firstVolume) * 100 
      : 0;

    // Calculate sentiment decay
    // Turkish: "Olumlu havadan nötr havaya geçiş hızı"
    const firstSentiment = this.calculateAverageSentiment(firstHalf);
    const secondSentiment = this.calculateAverageSentiment(secondHalf);
    const sentimentDecay = (firstSentiment - secondSentiment) * 100; // Positive = decay

    // Calculate engagement decay
    const firstEngagement = this.calculateAverageEngagement(firstHalf);
    const secondEngagement = this.calculateAverageEngagement(secondHalf);
    const engagementDecay = firstEngagement > 0 
      ? ((firstEngagement - secondEngagement) / firstEngagement) * 100 
      : 0;

    // Calculate overall decay score
    const decayScore = this.calculateDecayScore(volumeDecay, sentimentDecay, engagementDecay);
    const decayRate = this.calculateDecayRate(tokenHistory);

    // Determine if decaying
    const isDecaying = 
      volumeDecay > this.config.volumeDropPercent ||
      sentimentDecay > this.config.sentimentDropRate * 100 ||
      engagementDecay > this.config.engagementDropPercent;

    // Calculate projected decay
    const projectedDecayIn24h = decayRate * 24; // Assuming rate is per hour

    // Determine alert level
    const alertLevel = this.determineAlertLevel(decayScore, isDecaying);

    const result: AttentionDecayResult = {
      isDecaying,
      decayScore,
      decayRate,
      volumeDecay,
      sentimentDecay,
      engagementDecay,
      projectedDecayIn24h,
      alertLevel,
    };

    if (alertLevel !== "none") {
      attentionLogger.info({
        tokenAddress,
        decayScore,
        alertLevel,
        volumeDecay: volumeDecay.toFixed(2),
        sentimentDecay: sentimentDecay.toFixed(2),
      }, "Attention decay detected");
    }

    return result;
  }

  /**
   * Get tokens with significant decay
   */
  getDecayingTokens(minDecayScore = 30): Array<{
    tokenAddress: string;
    metrics: AttentionMetrics;
    decayResult: AttentionDecayResult;
  }> {
    const results: Array<{
      tokenAddress: string;
      metrics: AttentionMetrics;
      decayResult: AttentionDecayResult;
    }> = [];

    for (const [tokenAddress, metrics] of this.metrics) {
      if (metrics.attentionDecayScore >= minDecayScore) {
        const decayResult = this.analyzeDecay(tokenAddress);
        if (decayResult) {
          results.push({ tokenAddress, metrics, decayResult });
        }
      }
    }

    return results.sort((a, b) => b.metrics.attentionDecayScore - a.metrics.attentionDecayScore);
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private calculateMetrics(
    tokenAddress: string,
    history: SentimentDataPoint[]
  ): AttentionMetrics {
    const now = Date.now();
    const oneDayAgo = now - 86400000;
    const sevenDaysAgo = now - 604800000;

    // Filter for time periods
    const last24h = history.filter(h => h.timestamp >= oneDayAgo);
    const last7d = history.filter(h => h.timestamp >= sevenDaysAgo);

    // Tweet counts
    const tweetCount24h = last24h.reduce((sum, h) => sum + h.tweetCount, 0);
    const tweetCount7d = last7d.reduce((sum, h) => sum + h.tweetCount, 0);

    // Tweet velocity (per hour)
    const hoursSince24h = last24h.length > 0 
      ? (now - last24h[0].timestamp) / 3600000 
      : 24;
    const tweetVelocity = tweetCount24h / Math.max(1, hoursSince24h);

    // Sentiment
    const currentSentiment = this.scoreToState(
      last24h.length > 0 
        ? last24h[last24h.length - 1].sentimentScore 
        : 0
    );
    const sentimentScore = this.calculateAverageSentiment(last24h);

    // Sentiment velocity
    // Turkish: "Duygu hızı"
    const { velocity: sentimentVelocity, acceleration: sentimentAcceleration } = 
      this.calculateSentimentVelocity(history);

    // Attention decay score
    const attentionDecayScore = this.calculateDecayScoreFromHistory(history);

    // Engagement
    const averageEngagement = this.calculateAverageEngagement(last24h);
    const engagementTrend = this.calculateEngagementTrend(history);

    // News
    const newsArticleCount24h = last24h.reduce((sum, h) => sum + h.newsCount, 0);
    const newsSentiment = this.calculateAverageSentiment(
      last24h.filter(h => h.newsCount > 0)
    );

    return {
      tokenAddress,
      tweetCount24h,
      tweetCount7d,
      tweetVelocity,
      currentSentiment,
      sentimentScore,
      sentimentVelocity,
      sentimentAcceleration,
      attentionDecayScore,
      averageEngagement,
      engagementTrend,
      newsArticleCount24h,
      newsSentiment,
      lastUpdated: now,
    };
  }

  private calculateSentimentVelocity(history: SentimentDataPoint[]): {
    velocity: number;
    acceleration: number;
  } {
    if (history.length < 2) {
      return { velocity: 0, acceleration: 0 };
    }

    const velocities: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const timeDelta = history[i].timestamp - history[i-1].timestamp;
      const sentimentDelta = history[i].sentimentScore - history[i-1].sentimentScore;
      if (timeDelta > 0) {
        velocities.push(sentimentDelta / timeDelta * 3600000); // per hour
      }
    }

    if (velocities.length === 0) {
      return { velocity: 0, acceleration: 0 };
    }

    // Recent velocity
    const recentVelocities = velocities.slice(-5);
    const velocity = recentVelocities.reduce((a, b) => a + b, 0) / recentVelocities.length;

    // Acceleration
    let acceleration = 0;
    if (velocities.length >= 2) {
      const earlierVelocity = velocities.slice(-10, -5).reduce((a, b) => a + b, 0) / 
        Math.max(1, velocities.slice(-10, -5).length);
      acceleration = velocity - earlierVelocity;
    }

    return { velocity, acceleration };
  }

  private calculateDecayScore(
    volumeDecay: number,
    sentimentDecay: number,
    engagementDecay: number
  ): number {
    // Weighted combination
    const weights = { volume: 0.4, sentiment: 0.35, engagement: 0.25 };
    
    const score = 
      Math.max(0, volumeDecay) * weights.volume +
      Math.max(0, sentimentDecay) * weights.sentiment +
      Math.max(0, engagementDecay) * weights.engagement;

    return Math.min(100, score);
  }

  private calculateDecayScoreFromHistory(history: SentimentDataPoint[]): number {
    if (history.length < 10) return 0;

    const midpoint = Math.floor(history.length / 2);
    const firstHalf = history.slice(0, midpoint);
    const secondHalf = history.slice(midpoint);

    const volumeDecay = this.calculatePercentChange(
      this.calculateAverageTweetCount(firstHalf),
      this.calculateAverageTweetCount(secondHalf)
    );

    const sentimentDecay = (
      this.calculateAverageSentiment(firstHalf) - 
      this.calculateAverageSentiment(secondHalf)
    ) * 100;

    const engagementDecay = this.calculatePercentChange(
      this.calculateAverageEngagement(firstHalf),
      this.calculateAverageEngagement(secondHalf)
    );

    return this.calculateDecayScore(volumeDecay, sentimentDecay, engagementDecay);
  }

  private calculateDecayRate(history: SentimentDataPoint[]): number {
    if (history.length < 2) return 0;

    const timeSpan = history[history.length - 1].timestamp - history[0].timestamp;
    if (timeSpan === 0) return 0;

    const hours = timeSpan / 3600000;
    const decayScore = this.calculateDecayScoreFromHistory(history);

    return decayScore / hours;
  }

  private calculatePercentChange(first: number, second: number): number {
    if (first === 0) return 0;
    return ((first - second) / first) * 100;
  }

  private calculateAverageTweetCount(history: SentimentDataPoint[]): number {
    if (history.length === 0) return 0;
    return history.reduce((sum, h) => sum + h.tweetCount, 0) / history.length;
  }

  private calculateAverageSentiment(history: SentimentDataPoint[]): number {
    if (history.length === 0) return 0;
    return history.reduce((sum, h) => sum + h.sentimentScore, 0) / history.length;
  }

  private calculateAverageEngagement(history: SentimentDataPoint[]): number {
    if (history.length === 0) return 0;
    return history.reduce((sum, h) => sum + h.engagement, 0) / history.length;
  }

  private calculateEngagementTrend(
    history: SentimentDataPoint[]
  ): AttentionMetrics["engagementTrend"] {
    if (history.length < 10) return "stable";

    const midpoint = Math.floor(history.length / 2);
    const firstAvg = this.calculateAverageEngagement(history.slice(0, midpoint));
    const secondAvg = this.calculateAverageEngagement(history.slice(midpoint));

    const change = (secondAvg - firstAvg) / Math.max(1, firstAvg);
    if (change > 0.1) return "increasing";
    if (change < -0.1) return "decreasing";
    return "stable";
  }

  private scoreToState(score: number): SentimentState {
    if (score >= 0.6) return "very_positive";
    if (score >= 0.2) return "positive";
    if (score >= -0.2) return "neutral";
    if (score >= -0.6) return "negative";
    return "very_negative";
  }

  private determineAlertLevel(
    decayScore: number,
    isDecaying: boolean
  ): AttentionDecayResult["alertLevel"] {
    if (!isDecaying || decayScore < 20) return "none";
    if (decayScore < 40) return "watch";
    if (decayScore < 70) return "warning";
    return "critical";
  }
}

/**
 * Factory function
 */
export function createAttentionAnalyzer(
  config?: Partial<MonitoringConfig["attentionDecayThreshold"]>
): AttentionAnalyzer {
  return new AttentionAnalyzer(config);
}
