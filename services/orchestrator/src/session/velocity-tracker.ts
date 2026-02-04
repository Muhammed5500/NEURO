/**
 * Velocity Tracker
 * 
 * Tracks spending velocity per session to enforce rate limits.
 * 
 * Turkish: "Sadece toplam bütçe değil, aynı zamanda 'dakika başına' harcama limiti
 * (velocity limit) ekle. Bu, ajanın bir hata sonucu (loop) tüm bütçeyi saniyeler
 * içinde bitirmesini engeller."
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { SpendingRecord } from "./types.js";

const velocityLogger = logger.child({ component: "velocity-tracker" });

// ============================================
// VELOCITY TRACKER CONFIGURATION
// ============================================

export interface VelocityTrackerConfig {
  // Window size for velocity calculation (default: 1 minute)
  windowSizeMs: number;
  
  // Maximum records to keep per session
  maxRecordsPerSession: number;
  
  // Cleanup interval
  cleanupIntervalMs: number;
}

const DEFAULT_CONFIG: VelocityTrackerConfig = {
  windowSizeMs: 60000, // 1 minute
  maxRecordsPerSession: 1000,
  cleanupIntervalMs: 30000,
};

// ============================================
// VELOCITY CHECK RESULT
// ============================================

export interface VelocityCheckResult {
  allowed: boolean;
  
  // Current velocity
  currentVelocityWei: string;
  currentVelocityMon: number;
  
  // Limit
  limitWei: string;
  limitMon: number;
  
  // Remaining
  remainingWei: string;
  remainingMon: number;
  
  // Records in window
  recordsInWindow: number;
  windowStartMs: number;
  windowEndMs: number;
  
  // If not allowed
  waitTimeMs?: number;
  exceededByWei?: string;
  exceededByMon?: number;
}

// ============================================
// VELOCITY TRACKER
// ============================================

export class VelocityTracker {
  private readonly config: VelocityTrackerConfig;
  private readonly records: Map<string, SpendingRecord[]> = new Map();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config?: Partial<VelocityTrackerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Start cleanup interval
    this.cleanupInterval = setInterval(
      () => this.cleanupOldRecords(),
      this.config.cleanupIntervalMs
    );

    velocityLogger.info({
      windowSizeMs: this.config.windowSizeMs,
    }, "VelocityTracker initialized");
  }

  /**
   * Record a spending event
   */
  recordSpending(
    sessionId: string,
    amountWei: string,
    amountMon: number,
    targetAddress: string,
    methodSelector: string,
    txHash?: string
  ): void {
    const record: SpendingRecord = {
      timestamp: Date.now(),
      amountWei,
      amountMon,
      txHash,
      targetAddress,
      methodSelector,
    };

    let sessionRecords = this.records.get(sessionId);
    if (!sessionRecords) {
      sessionRecords = [];
      this.records.set(sessionId, sessionRecords);
    }

    sessionRecords.push(record);

    // Trim if too many records
    if (sessionRecords.length > this.config.maxRecordsPerSession) {
      sessionRecords.splice(0, sessionRecords.length - this.config.maxRecordsPerSession);
    }

    velocityLogger.debug({
      sessionId,
      amountMon,
      totalRecords: sessionRecords.length,
    }, "Spending recorded");
  }

  /**
   * Check if a new spending would exceed velocity limit
   * Turkish: "dakika başına harcama limiti"
   */
  checkVelocity(
    sessionId: string,
    proposedAmountWei: string,
    proposedAmountMon: number,
    limitWei: string,
    limitMon: number
  ): VelocityCheckResult {
    const now = Date.now();
    const windowStart = now - this.config.windowSizeMs;

    // Get records in current window
    const sessionRecords = this.records.get(sessionId) || [];
    const recordsInWindow = sessionRecords.filter(r => r.timestamp >= windowStart);

    // Calculate current velocity in window
    const currentVelocityWei = recordsInWindow.reduce(
      (sum, r) => sum + BigInt(r.amountWei),
      0n
    );
    const currentVelocityMon = recordsInWindow.reduce(
      (sum, r) => sum + r.amountMon,
      0
    );

    // Calculate what total would be after proposed spending
    const proposedBigInt = BigInt(proposedAmountWei);
    const totalAfterSpending = currentVelocityWei + proposedBigInt;
    const limitBigInt = BigInt(limitWei);

    // Calculate remaining
    const remainingWei = limitBigInt - currentVelocityWei;
    const remainingMon = limitMon - currentVelocityMon;

    // Check if would exceed
    const allowed = totalAfterSpending <= limitBigInt;

    const result: VelocityCheckResult = {
      allowed,
      currentVelocityWei: currentVelocityWei.toString(),
      currentVelocityMon,
      limitWei,
      limitMon,
      remainingWei: remainingWei > 0n ? remainingWei.toString() : "0",
      remainingMon: Math.max(0, remainingMon),
      recordsInWindow: recordsInWindow.length,
      windowStartMs: windowStart,
      windowEndMs: now,
    };

    if (!allowed) {
      // Calculate how much exceeded
      const exceededByWei = totalAfterSpending - limitBigInt;
      result.exceededByWei = exceededByWei.toString();
      result.exceededByMon = proposedAmountMon - Math.max(0, remainingMon);

      // Calculate wait time (when oldest record in window will expire)
      if (recordsInWindow.length > 0) {
        const oldestInWindow = Math.min(...recordsInWindow.map(r => r.timestamp));
        result.waitTimeMs = (oldestInWindow + this.config.windowSizeMs) - now;
      }

      velocityLogger.warn({
        sessionId,
        currentVelocityMon,
        proposedAmountMon,
        limitMon,
        exceededByMon: result.exceededByMon,
      }, "Velocity limit would be exceeded");
    }

    return result;
  }

  /**
   * Get current velocity for a session
   */
  getCurrentVelocity(sessionId: string): {
    velocityWei: string;
    velocityMon: number;
    recordsInWindow: number;
  } {
    const now = Date.now();
    const windowStart = now - this.config.windowSizeMs;

    const sessionRecords = this.records.get(sessionId) || [];
    const recordsInWindow = sessionRecords.filter(r => r.timestamp >= windowStart);

    const velocityWei = recordsInWindow.reduce(
      (sum, r) => sum + BigInt(r.amountWei),
      0n
    );
    const velocityMon = recordsInWindow.reduce(
      (sum, r) => sum + r.amountMon,
      0
    );

    return {
      velocityWei: velocityWei.toString(),
      velocityMon,
      recordsInWindow: recordsInWindow.length,
    };
  }

  /**
   * Get spending history for a session
   */
  getSpendingHistory(
    sessionId: string,
    limit?: number
  ): SpendingRecord[] {
    const records = this.records.get(sessionId) || [];
    if (limit) {
      return records.slice(-limit);
    }
    return [...records];
  }

  /**
   * Clear all records for a session
   */
  clearSession(sessionId: string): void {
    this.records.delete(sessionId);
    velocityLogger.debug({ sessionId }, "Session velocity records cleared");
  }

  /**
   * Clear all records (for kill switch)
   * Turkish: "bekleyen (queued) tüm işlemleri anında temizle"
   */
  clearAll(): number {
    const count = this.records.size;
    this.records.clear();
    velocityLogger.info({ count }, "All velocity records cleared");
    return count;
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clearAll();
    velocityLogger.info("VelocityTracker shutdown");
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private cleanupOldRecords(): void {
    const cutoff = Date.now() - this.config.windowSizeMs * 2; // Keep 2x window
    let cleaned = 0;

    for (const [sessionId, records] of this.records) {
      const before = records.length;
      const filtered = records.filter(r => r.timestamp >= cutoff);
      
      if (filtered.length === 0) {
        this.records.delete(sessionId);
      } else if (filtered.length < before) {
        this.records.set(sessionId, filtered);
      }
      
      cleaned += before - filtered.length;
    }

    if (cleaned > 0) {
      velocityLogger.debug({ cleaned }, "Old velocity records cleaned");
    }
  }
}

/**
 * Factory function
 */
export function createVelocityTracker(
  config?: Partial<VelocityTrackerConfig>
): VelocityTracker {
  return new VelocityTracker(config);
}
