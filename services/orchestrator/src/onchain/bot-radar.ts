/**
 * BotRadar
 * 
 * Detects bot activity and sandwich attacks on nad.fun contracts.
 * 
 * Turkish: "nad.fun kontratlarına saniyeler içinde ardı ardına gelen 'create' ve 'swap'
 * işlemlerini analiz ederek sandviç saldırısı (sandwich attack) veya bot kümelenmesi
 * (bot clustering) olup olmadığını tespit eden bir BotRadar fonksiyonu ekle."
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { 
  TransactionPattern, 
  BotRadarResult, 
  BotPattern,
} from "./types.js";
import type { OnChainDataProvider } from "./monad-rpc-client.js";
import { OnChainCache, CacheKeys } from "./cache.js";

const botLogger = logger.child({ component: "bot-radar" });

// ============================================
// BOT RADAR CONFIGURATION
// ============================================

export interface BotRadarConfig {
  // Time window for analysis (seconds)
  analysisWindowSeconds: number;
  
  // Minimum transactions to analyze
  minTransactionsForAnalysis: number;
  
  // Sandwich detection thresholds
  sandwichTimeWindowMs: number; // Time between front/victim/back
  sandwichMinValueMon: number;
  
  // Burst detection (rapid transactions)
  burstTimeWindowMs: number;
  burstMinTransactions: number;
  
  // Cluster detection (same address patterns)
  clusterMinTransactions: number;
  clusterTimeWindowMs: number;
  
  // Bot score thresholds
  highBotScoreThreshold: number;
  lowBotScoreThreshold: number;
}

const DEFAULT_CONFIG: BotRadarConfig = {
  analysisWindowSeconds: 300, // 5 minutes
  minTransactionsForAnalysis: 10,
  sandwichTimeWindowMs: 1000, // 1 second
  sandwichMinValueMon: 1,
  burstTimeWindowMs: 5000, // 5 seconds
  burstMinTransactions: 5,
  clusterMinTransactions: 3,
  clusterTimeWindowMs: 30000, // 30 seconds
  highBotScoreThreshold: 0.8,
  lowBotScoreThreshold: 0.3,
};

// ============================================
// BOT RADAR IMPLEMENTATION
// ============================================

export class BotRadar {
  private readonly config: BotRadarConfig;
  private readonly cache: OnChainCache;

  constructor(config?: Partial<BotRadarConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new OnChainCache();
  }

  /**
   * Analyze transactions for bot activity
   * Turkish: "sandviç saldırısı veya bot kümelenmesi tespit et"
   */
  async analyze(
    provider: OnChainDataProvider,
    tokenAddress: string
  ): Promise<BotRadarResult> {
    const cacheKey = CacheKeys.botRadar(tokenAddress, this.config.analysisWindowSeconds);
    
    // Check cache first
    const cached = this.cache.get<BotRadarResult>(cacheKey);
    if (cached) {
      return cached;
    }

    botLogger.info({ tokenAddress }, "Starting bot radar analysis");

    // Get recent transactions
    const transactions = await provider.getRecentTransactions(
      tokenAddress,
      100 // Get last 100 transactions
    );

    if (transactions.length < this.config.minTransactionsForAnalysis) {
      return this.createEmptyResult(transactions, tokenAddress);
    }

    // Analyze for patterns
    const patterns: BotPattern[] = [];
    
    // 1. Detect sandwich attacks
    // Turkish: "sandviç saldırısı"
    const sandwiches = this.detectSandwichAttacks(transactions);
    patterns.push(...sandwiches);

    // 2. Detect burst patterns (rapid fire transactions)
    const bursts = this.detectBurstPatterns(transactions);
    patterns.push(...bursts);

    // 3. Detect bot clustering (same addresses with high activity)
    // Turkish: "bot kümelenmesi"
    const clusters = this.detectBotClusters(transactions);
    patterns.push(...clusters);

    // 4. Detect frontrunning patterns
    const frontruns = this.detectFrontrunning(transactions);
    patterns.push(...frontruns);

    // Calculate overall metrics
    const result = this.buildResult(transactions, patterns);
    
    // Cache the result
    this.cache.set(cacheKey, result, { ttlMs: 10000 }); // 10s cache

    botLogger.info({
      tokenAddress,
      patterns: patterns.length,
      sandwiches: sandwiches.length,
      bursts: bursts.length,
      clusters: clusters.length,
      riskScore: result.riskScore,
    }, "Bot radar analysis complete");

    return result;
  }

  /**
   * Quick bot activity check
   */
  async quickCheck(
    provider: OnChainDataProvider,
    tokenAddress: string
  ): Promise<{
    hasBotActivity: boolean;
    riskLevel: BotRadarResult["botActivityLevel"];
    suspiciousCount: number;
  }> {
    const transactions = await provider.getRecentTransactions(tokenAddress, 50);
    
    const suspiciousCount = transactions.filter(tx => tx.isSuspicious || tx.botScore > 0.5).length;
    const suspiciousRatio = suspiciousCount / Math.max(transactions.length, 1);

    let riskLevel: BotRadarResult["botActivityLevel"] = "none";
    if (suspiciousRatio > 0.5) riskLevel = "extreme";
    else if (suspiciousRatio > 0.3) riskLevel = "high";
    else if (suspiciousRatio > 0.15) riskLevel = "medium";
    else if (suspiciousRatio > 0.05) riskLevel = "low";

    return {
      hasBotActivity: suspiciousCount > 0,
      riskLevel,
      suspiciousCount,
    };
  }

  /**
   * Detect sandwich attacks
   * A sandwich attack has: frontrun → victim → backrun in quick succession
   */
  private detectSandwichAttacks(transactions: TransactionPattern[]): BotPattern[] {
    const patterns: BotPattern[] = [];
    const swaps = transactions.filter(tx => tx.transactionType === "swap");
    
    // Sort by timestamp
    const sorted = [...swaps].sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < sorted.length - 2; i++) {
      const tx1 = sorted[i];
      const tx2 = sorted[i + 1];
      const tx3 = sorted[i + 2];

      // Check if transactions are within sandwich time window
      if (tx3.timestamp - tx1.timestamp > this.config.sandwichTimeWindowMs) {
        continue;
      }

      // Check for sandwich pattern:
      // - tx1 and tx3 from same address (bot)
      // - tx2 from different address (victim)
      // - tx1 and tx3 have high value (bot's capital)
      if (
        tx1.from === tx3.from &&
        tx1.from !== tx2.from &&
        tx1.valueMon >= this.config.sandwichMinValueMon &&
        tx3.valueMon >= this.config.sandwichMinValueMon
      ) {
        patterns.push({
          patternType: "sandwich",
          confidence: 0.9,
          transactions: [tx1.txHash, tx2.txHash, tx3.txHash],
          addresses: [tx1.from, tx2.from],
          description: `Sandwich attack detected: ${tx1.from.slice(0, 10)}... sandwiched ${tx2.from.slice(0, 10)}...`,
          impactEstimate: tx2.valueMon * 0.05, // Estimate 5% impact
        });
      }
    }

    return patterns;
  }

  /**
   * Detect burst patterns (rapid fire transactions)
   */
  private detectBurstPatterns(transactions: TransactionPattern[]): BotPattern[] {
    const patterns: BotPattern[] = [];
    const sorted = [...transactions].sort((a, b) => a.timestamp - b.timestamp);

    // Sliding window analysis
    for (let i = 0; i < sorted.length; i++) {
      const windowStart = sorted[i].timestamp;
      const windowEnd = windowStart + this.config.burstTimeWindowMs;
      
      const windowTxs = sorted.filter(
        tx => tx.timestamp >= windowStart && tx.timestamp <= windowEnd
      );

      if (windowTxs.length >= this.config.burstMinTransactions) {
        // Check if from same address
        const addressCounts = new Map<string, number>();
        for (const tx of windowTxs) {
          addressCounts.set(tx.from, (addressCounts.get(tx.from) || 0) + 1);
        }

        for (const [address, count] of addressCounts) {
          if (count >= this.config.burstMinTransactions) {
            patterns.push({
              patternType: "burst",
              confidence: Math.min(0.95, count / 10),
              transactions: windowTxs.filter(tx => tx.from === address).map(tx => tx.txHash),
              addresses: [address],
              description: `Burst pattern: ${address.slice(0, 10)}... made ${count} transactions in ${this.config.burstTimeWindowMs}ms`,
            });
          }
        }
      }
    }

    return patterns;
  }

  /**
   * Detect bot clusters (groups of addresses acting in coordination)
   * Turkish: "bot kümelenmesi"
   */
  private detectBotClusters(transactions: TransactionPattern[]): BotPattern[] {
    const patterns: BotPattern[] = [];
    
    // Group transactions by time windows
    const windows = this.groupByTimeWindow(
      transactions,
      this.config.clusterTimeWindowMs
    );

    for (const windowTxs of windows) {
      if (windowTxs.length < this.config.clusterMinTransactions) continue;

      // Check for coordinated activity
      const swaps = windowTxs.filter(tx => tx.transactionType === "swap");
      const creates = windowTxs.filter(tx => tx.transactionType === "create");

      // Cluster indicator: multiple different addresses doing same thing at same time
      const uniqueAddresses = new Set(windowTxs.map(tx => tx.from));
      
      if (uniqueAddresses.size >= 3 && swaps.length >= 3) {
        // Check if all going in same direction (all buys or all sells)
        // This is a simplification - real implementation would check swap direction
        patterns.push({
          patternType: "cluster",
          confidence: 0.7,
          transactions: windowTxs.slice(0, 10).map(tx => tx.txHash),
          addresses: [...uniqueAddresses].slice(0, 5),
          description: `Bot cluster detected: ${uniqueAddresses.size} addresses made ${swaps.length} coordinated swaps`,
        });
      }

      // Create+swap coordination (potential pump setup)
      if (creates.length > 0 && swaps.length > creates.length * 2) {
        patterns.push({
          patternType: "cluster",
          confidence: 0.8,
          transactions: [...creates, ...swaps.slice(0, 5)].map(tx => tx.txHash),
          addresses: [...new Set([...creates, ...swaps].map(tx => tx.from))].slice(0, 5),
          description: `Coordinated create+swap pattern: ${creates.length} creates followed by ${swaps.length} swaps`,
        });
      }
    }

    return patterns;
  }

  /**
   * Detect frontrunning patterns
   */
  private detectFrontrunning(transactions: TransactionPattern[]): BotPattern[] {
    const patterns: BotPattern[] = [];
    const sorted = [...transactions].sort((a, b) => a.timestamp - b.timestamp);

    // Look for large swaps immediately before smaller ones
    for (let i = 0; i < sorted.length - 1; i++) {
      const tx1 = sorted[i];
      const tx2 = sorted[i + 1];

      if (tx1.transactionType !== "swap" || tx2.transactionType !== "swap") {
        continue;
      }

      // Time gap check
      if (tx2.timestamp - tx1.timestamp > 500) continue; // 500ms threshold

      // Value check: tx1 significantly larger than tx2
      if (tx1.valueMon > tx2.valueMon * 5 && tx1.from !== tx2.from) {
        patterns.push({
          patternType: "frontrun",
          confidence: 0.75,
          transactions: [tx1.txHash, tx2.txHash],
          addresses: [tx1.from],
          description: `Potential frontrun: ${tx1.from.slice(0, 10)}... (${tx1.valueMon.toFixed(2)} MON) before ${tx2.from.slice(0, 10)}...`,
          impactEstimate: tx2.valueMon * 0.03,
        });
      }
    }

    return patterns;
  }

  private groupByTimeWindow(
    transactions: TransactionPattern[],
    windowMs: number
  ): TransactionPattern[][] {
    if (transactions.length === 0) return [];

    const sorted = [...transactions].sort((a, b) => a.timestamp - b.timestamp);
    const windows: TransactionPattern[][] = [];
    let currentWindow: TransactionPattern[] = [sorted[0]];
    let windowStart = sorted[0].timestamp;

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].timestamp - windowStart <= windowMs) {
        currentWindow.push(sorted[i]);
      } else {
        windows.push(currentWindow);
        currentWindow = [sorted[i]];
        windowStart = sorted[i].timestamp;
      }
    }

    if (currentWindow.length > 0) {
      windows.push(currentWindow);
    }

    return windows;
  }

  private buildResult(
    transactions: TransactionPattern[],
    patterns: BotPattern[]
  ): BotRadarResult {
    const createCount = transactions.filter(tx => tx.transactionType === "create").length;
    const swapCount = transactions.filter(tx => tx.transactionType === "swap").length;
    
    const sandwichCount = patterns.filter(p => p.patternType === "sandwich").length;
    const clusterCount = patterns.filter(p => p.patternType === "cluster").length;

    // Calculate risk score
    let riskScore = 0;
    riskScore += sandwichCount * 0.3;
    riskScore += clusterCount * 0.2;
    riskScore += patterns.filter(p => p.patternType === "burst").length * 0.15;
    riskScore += patterns.filter(p => p.patternType === "frontrun").length * 0.2;
    riskScore = Math.min(1, riskScore);

    // Determine activity level
    let botActivityLevel: BotRadarResult["botActivityLevel"] = "none";
    if (riskScore > 0.8) botActivityLevel = "extreme";
    else if (riskScore > 0.5) botActivityLevel = "high";
    else if (riskScore > 0.3) botActivityLevel = "medium";
    else if (riskScore > 0.1) botActivityLevel = "low";

    // Generate recommendations
    const recommendations: string[] = [];
    if (sandwichCount > 0) {
      recommendations.push("High sandwich attack activity detected. Consider using MEV protection.");
    }
    if (clusterCount > 0) {
      recommendations.push("Bot cluster activity detected. Exercise caution with large trades.");
    }
    if (riskScore > 0.5) {
      recommendations.push("Consider waiting for bot activity to subside before trading.");
    }
    if (riskScore > 0.8) {
      recommendations.push("EXTREME RISK: Avoid trading until bot activity decreases.");
    }

    const minBlock = transactions.reduce(
      (min, tx) => tx.blockNumber < min ? tx.blockNumber : min,
      transactions[0]?.blockNumber || 0n
    );
    const maxBlock = transactions.reduce(
      (max, tx) => tx.blockNumber > max ? tx.blockNumber : max,
      transactions[0]?.blockNumber || 0n
    );

    return {
      windowStartBlock: minBlock,
      windowEndBlock: maxBlock,
      windowSeconds: this.config.analysisWindowSeconds,
      totalTransactions: transactions.length,
      createCount,
      swapCount,
      suspiciousPatternCount: patterns.length,
      potentialSandwichCount: sandwichCount,
      botClusterCount: clusterCount,
      botActivityLevel,
      riskScore,
      patterns,
      recommendations,
      analyzedAt: Date.now(),
      analysisMethod: "transaction_pattern_analysis",
    };
  }

  private createEmptyResult(
    transactions: TransactionPattern[],
    _tokenAddress: string
  ): BotRadarResult {
    return {
      windowStartBlock: 0n,
      windowEndBlock: 0n,
      windowSeconds: this.config.analysisWindowSeconds,
      totalTransactions: transactions.length,
      createCount: 0,
      swapCount: 0,
      suspiciousPatternCount: 0,
      potentialSandwichCount: 0,
      botClusterCount: 0,
      botActivityLevel: "none",
      riskScore: 0,
      patterns: [],
      recommendations: ["Insufficient transaction data for analysis"],
      analyzedAt: Date.now(),
      analysisMethod: "insufficient_data",
    };
  }
}

/**
 * Factory function
 */
export function createBotRadar(config?: Partial<BotRadarConfig>): BotRadar {
  return new BotRadar(config);
}
