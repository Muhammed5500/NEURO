/**
 * Key Rotation Tool
 * 
 * Off-chain tool for managing session key rotation.
 * Provides scheduled rotation, emergency rotation, and audit logging.
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { SessionKeyConfig, CreateSessionOptions } from "./types.js";
import type { SessionManager } from "./session-manager.js";

const rotationLogger = logger.child({ component: "key-rotation" });

// ============================================
// ROTATION POLICY
// ============================================

export interface RotationPolicy {
  // Auto-rotation settings
  autoRotateEnabled: boolean;
  rotateBeforeExpiryMs: number; // Rotate this far before expiry
  
  // Budget-based rotation
  rotateAtBudgetPercentUsed: number; // Rotate when budget % used
  
  // Time-based rotation
  maxSessionAgeMs: number; // Force rotate after this time
  
  // Minimum values for new sessions
  minBudgetMon: number;
  minValidityMs: number;
}

const DEFAULT_ROTATION_POLICY: RotationPolicy = {
  autoRotateEnabled: true,
  rotateBeforeExpiryMs: 300000, // 5 minutes before expiry
  rotateAtBudgetPercentUsed: 90,
  maxSessionAgeMs: 86400000, // 24 hours
  minBudgetMon: 0.1,
  minValidityMs: 300000, // 5 minutes
};

// ============================================
// ROTATION RESULT
// ============================================

export interface RotationResult {
  success: boolean;
  oldSessionId: string;
  newSessionId?: string;
  reason: string;
  
  // Budget info
  budgetTransferred?: number;
  budgetRemaining?: number;
  
  // Time info
  newExpiresAt?: number;
  
  // Error
  error?: string;
}

// ============================================
// KEY ROTATION TOOL
// ============================================

export class KeyRotationTool {
  private readonly sessionManager: SessionManager;
  private readonly policy: RotationPolicy;
  
  // Scheduled rotations
  private scheduledRotations: Map<string, NodeJS.Timeout> = new Map();
  
  // Rotation history for audit
  private rotationHistory: Array<{
    timestamp: number;
    oldSessionId: string;
    newSessionId?: string;
    reason: string;
    success: boolean;
  }> = [];

  constructor(
    sessionManager: SessionManager,
    policy?: Partial<RotationPolicy>
  ) {
    this.sessionManager = sessionManager;
    this.policy = { ...DEFAULT_ROTATION_POLICY, ...policy };

    rotationLogger.info({
      autoRotateEnabled: this.policy.autoRotateEnabled,
      rotateBeforeExpiryMs: this.policy.rotateBeforeExpiryMs,
    }, "KeyRotationTool initialized");
  }

  /**
   * Schedule automatic rotation for a session
   */
  scheduleRotation(sessionId: string): void {
    if (!this.policy.autoRotateEnabled) {
      return;
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      rotationLogger.warn({ sessionId }, "Cannot schedule rotation: session not found");
      return;
    }

    // Calculate when to rotate
    const rotateAt = session.expiresAt - this.policy.rotateBeforeExpiryMs;
    const now = Date.now();
    const delay = rotateAt - now;

    if (delay <= 0) {
      // Already past rotation time, rotate immediately
      this.rotateNow(sessionId, "scheduled_expiry");
      return;
    }

    // Clear existing schedule
    this.cancelScheduledRotation(sessionId);

    // Schedule new rotation
    const timeout = setTimeout(() => {
      this.rotateNow(sessionId, "scheduled_expiry");
    }, delay);

    this.scheduledRotations.set(sessionId, timeout);

    rotationLogger.debug({
      sessionId,
      rotateAt: new Date(rotateAt).toISOString(),
      delayMs: delay,
    }, "Rotation scheduled");
  }

  /**
   * Cancel scheduled rotation
   */
  cancelScheduledRotation(sessionId: string): void {
    const timeout = this.scheduledRotations.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.scheduledRotations.delete(sessionId);
    }
  }

  /**
   * Rotate a session immediately
   */
  async rotateNow(
    sessionId: string,
    reason: string,
    options?: Partial<CreateSessionOptions>
  ): Promise<RotationResult> {
    rotationLogger.info({ sessionId, reason }, "Rotating session");

    try {
      const session = this.sessionManager.getSession(sessionId);
      if (!session) {
        return this.recordResult({
          success: false,
          oldSessionId: sessionId,
          reason,
          error: "Session not found",
        });
      }

      // Calculate remaining budget
      const remainingBudget = session.totalBudgetMon - session.spentMon;
      if (remainingBudget < this.policy.minBudgetMon) {
        return this.recordResult({
          success: false,
          oldSessionId: sessionId,
          reason,
          error: `Insufficient remaining budget: ${remainingBudget} < ${this.policy.minBudgetMon}`,
        });
      }

      // Calculate remaining validity
      const remainingTime = session.expiresAt - Date.now();
      const newValidityMs = Math.max(
        options?.expiryDurationMs || remainingTime,
        this.policy.minValidityMs
      );

      // Create new session
      const newSession = await this.sessionManager.rotateSession(sessionId, {
        totalBudgetMon: options?.totalBudgetMon ?? remainingBudget,
        velocityLimitMonPerMinute: options?.velocityLimitMonPerMinute ?? session.velocityLimitMonPerMinute,
        expiryDurationMs: newValidityMs,
      });

      // Schedule next rotation
      this.scheduleRotation(newSession.sessionId);

      // Cancel old schedule
      this.cancelScheduledRotation(sessionId);

      return this.recordResult({
        success: true,
        oldSessionId: sessionId,
        newSessionId: newSession.sessionId,
        reason,
        budgetTransferred: remainingBudget,
        budgetRemaining: remainingBudget,
        newExpiresAt: newSession.expiresAt,
      });
    } catch (error) {
      return this.recordResult({
        success: false,
        oldSessionId: sessionId,
        reason,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Check if a session needs rotation
   */
  checkNeedsRotation(sessionId: string): {
    needsRotation: boolean;
    reason?: string;
    urgency: "none" | "low" | "medium" | "high" | "critical";
  } {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return { needsRotation: false, urgency: "none" };
    }

    const now = Date.now();

    // Check expiry
    const timeToExpiry = session.expiresAt - now;
    if (timeToExpiry <= 0) {
      return {
        needsRotation: true,
        reason: "Session expired",
        urgency: "critical",
      };
    }

    if (timeToExpiry <= this.policy.rotateBeforeExpiryMs) {
      return {
        needsRotation: true,
        reason: "Session expiring soon",
        urgency: "high",
      };
    }

    // Check budget usage
    const budgetUsedPercent = (session.spentMon / session.totalBudgetMon) * 100;
    if (budgetUsedPercent >= this.policy.rotateAtBudgetPercentUsed) {
      return {
        needsRotation: true,
        reason: `Budget ${budgetUsedPercent.toFixed(1)}% used`,
        urgency: "medium",
      };
    }

    // Check age
    const sessionAge = now - session.createdAt;
    if (sessionAge >= this.policy.maxSessionAgeMs) {
      return {
        needsRotation: true,
        reason: "Session too old",
        urgency: "low",
      };
    }

    return { needsRotation: false, urgency: "none" };
  }

  /**
   * Rotate all sessions that need it
   */
  async rotateAllDue(): Promise<RotationResult[]> {
    const results: RotationResult[] = [];
    const sessions = this.sessionManager.listActiveSessions();

    for (const session of sessions) {
      const check = this.checkNeedsRotation(session.sessionId);
      if (check.needsRotation) {
        const result = await this.rotateNow(session.sessionId, check.reason!);
        results.push(result);
      }
    }

    rotationLogger.info({
      checked: sessions.length,
      rotated: results.filter(r => r.success).length,
    }, "Bulk rotation check complete");

    return results;
  }

  /**
   * Emergency rotation of all sessions
   */
  async emergencyRotateAll(reason: string): Promise<RotationResult[]> {
    const results: RotationResult[] = [];
    const sessions = this.sessionManager.listActiveSessions();

    for (const session of sessions) {
      const result = await this.rotateNow(session.sessionId, `emergency: ${reason}`);
      results.push(result);
    }

    rotationLogger.warn({
      reason,
      rotated: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    }, "Emergency rotation complete");

    return results;
  }

  /**
   * Get rotation history
   */
  getRotationHistory(): typeof this.rotationHistory {
    return [...this.rotationHistory];
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    // Cancel all scheduled rotations
    for (const [sessionId, timeout] of this.scheduledRotations) {
      clearTimeout(timeout);
    }
    this.scheduledRotations.clear();

    rotationLogger.info("KeyRotationTool shutdown");
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private recordResult(result: RotationResult): RotationResult {
    this.rotationHistory.push({
      timestamp: Date.now(),
      oldSessionId: result.oldSessionId,
      newSessionId: result.newSessionId,
      reason: result.reason,
      success: result.success,
    });

    // Keep history bounded
    if (this.rotationHistory.length > 1000) {
      this.rotationHistory.splice(0, this.rotationHistory.length - 1000);
    }

    if (result.success) {
      rotationLogger.info({
        oldSessionId: result.oldSessionId,
        newSessionId: result.newSessionId,
        reason: result.reason,
        budgetTransferred: result.budgetTransferred,
      }, "Session rotated successfully");
    } else {
      rotationLogger.warn({
        sessionId: result.oldSessionId,
        reason: result.reason,
        error: result.error,
      }, "Session rotation failed");
    }

    return result;
  }
}

/**
 * Factory function
 */
export function createKeyRotationTool(
  sessionManager: SessionManager,
  policy?: Partial<RotationPolicy>
): KeyRotationTool {
  return new KeyRotationTool(sessionManager, policy);
}
