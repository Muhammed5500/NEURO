/**
 * Kill Switch (Panic Button)
 * 
 * Emergency mechanism to disable all execution paths.
 * 
 * Turkish: "Kill switch tetiklendiğinde, sadece yeni işlemleri durdurmakla kalma;
 * ExecutionPlan içindeki bekleyen (queued) tüm işlemleri anında temizle."
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { KillSwitchState } from "./types.js";
import { KillSwitchError } from "./types.js";

const killSwitchLogger = logger.child({ component: "kill-switch" });

// ============================================
// KILL SWITCH CALLBACKS
// ============================================

export interface KillSwitchCallbacks {
  // Called when kill switch is activated
  onActivate?: (state: KillSwitchState) => void | Promise<void>;
  
  // Called to clear queued execution plans
  // Turkish: "ExecutionPlan içindeki bekleyen (queued) tüm işlemleri anında temizle"
  clearQueuedPlans?: () => number | Promise<number>;
  
  // Called to revoke all sessions
  clearSessions?: () => number | Promise<number>;
  
  // Called when kill switch is deactivated
  onDeactivate?: (state: KillSwitchState) => void | Promise<void>;
}

// ============================================
// KILL SWITCH CONFIGURATION
// ============================================

export interface KillSwitchConfig {
  // Require multisig for reactivation
  requireMultisigForReactivation: boolean;
  
  // Auto-deactivate after duration (0 = never)
  autoDeactivateAfterMs: number;
  
  // Callbacks
  callbacks: KillSwitchCallbacks;
}

const DEFAULT_CONFIG: KillSwitchConfig = {
  requireMultisigForReactivation: false,
  autoDeactivateAfterMs: 0,
  callbacks: {},
};

// ============================================
// KILL SWITCH IMPLEMENTATION
// ============================================

export class KillSwitch {
  private readonly config: KillSwitchConfig;
  private state: KillSwitchState;
  private autoDeactivateTimeout?: NodeJS.Timeout;
  
  // Audit log
  private readonly auditLog: Array<{
    timestamp: number;
    action: "activate" | "deactivate" | "check";
    triggeredBy?: string;
    reason?: string;
  }> = [];

  constructor(config?: Partial<KillSwitchConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.state = {
      isActive: false,
      clearedSessionCount: 0,
      clearedQueuedPlansCount: 0,
      canReactivate: true,
      reactivationRequiresMultisig: this.config.requireMultisigForReactivation,
    };

    killSwitchLogger.info("KillSwitch initialized");
  }

  /**
   * Check if kill switch is active
   */
  isActive(): boolean {
    return this.state.isActive;
  }

  /**
   * Get current state
   */
  getState(): KillSwitchState {
    return { ...this.state };
  }

  /**
   * Activate the kill switch (PANIC BUTTON)
   * 
   * Turkish: "global disable for any write action"
   */
  async activate(
    triggeredBy: string,
    reason: string
  ): Promise<KillSwitchState> {
    if (this.state.isActive) {
      killSwitchLogger.warn("Kill switch already active");
      return this.state;
    }

    killSwitchLogger.warn({
      triggeredBy,
      reason,
    }, "🚨 KILL SWITCH ACTIVATED - ALL EXECUTION DISABLED");

    const now = Date.now();
    
    // Update state
    this.state.isActive = true;
    this.state.activatedAt = now;
    this.state.activatedBy = triggeredBy;
    this.state.reason = reason;

    // Audit log
    this.auditLog.push({
      timestamp: now,
      action: "activate",
      triggeredBy,
      reason,
    });

    // Clear queued execution plans
    // Turkish: "bekleyen (queued) tüm işlemleri anında temizle"
    if (this.config.callbacks.clearQueuedPlans) {
      try {
        const clearedPlans = await this.config.callbacks.clearQueuedPlans();
        this.state.clearedQueuedPlansCount = clearedPlans;
        killSwitchLogger.info({ clearedPlans }, "Queued execution plans cleared");
      } catch (error) {
        killSwitchLogger.error({ error }, "Failed to clear queued plans");
      }
    }

    // Clear/revoke all sessions
    if (this.config.callbacks.clearSessions) {
      try {
        const clearedSessions = await this.config.callbacks.clearSessions();
        this.state.clearedSessionCount = clearedSessions;
        killSwitchLogger.info({ clearedSessions }, "Sessions cleared");
      } catch (error) {
        killSwitchLogger.error({ error }, "Failed to clear sessions");
      }
    }

    // Call activation callback
    if (this.config.callbacks.onActivate) {
      try {
        await this.config.callbacks.onActivate(this.state);
      } catch (error) {
        killSwitchLogger.error({ error }, "onActivate callback failed");
      }
    }

    // Set auto-deactivate timer if configured
    if (this.config.autoDeactivateAfterMs > 0) {
      this.autoDeactivateTimeout = setTimeout(
        () => this.deactivate("system", "Auto-deactivate timer expired"),
        this.config.autoDeactivateAfterMs
      );
    }

    return { ...this.state };
  }

  /**
   * Deactivate the kill switch
   */
  async deactivate(
    triggeredBy: string,
    reason: string,
    multisigApproval?: string
  ): Promise<KillSwitchState> {
    if (!this.state.isActive) {
      killSwitchLogger.warn("Kill switch already inactive");
      return this.state;
    }

    // Check if multisig required
    if (this.config.requireMultisigForReactivation && !multisigApproval) {
      throw new Error("Multisig approval required to deactivate kill switch");
    }

    killSwitchLogger.info({
      triggeredBy,
      reason,
    }, "Kill switch deactivated");

    const now = Date.now();

    // Clear auto-deactivate timer
    if (this.autoDeactivateTimeout) {
      clearTimeout(this.autoDeactivateTimeout);
      this.autoDeactivateTimeout = undefined;
    }

    // Audit log
    this.auditLog.push({
      timestamp: now,
      action: "deactivate",
      triggeredBy,
      reason,
    });

    // Reset state
    this.state.isActive = false;
    // Keep cleared counts for audit
    
    // Call deactivation callback
    if (this.config.callbacks.onDeactivate) {
      try {
        await this.config.callbacks.onDeactivate(this.state);
      } catch (error) {
        killSwitchLogger.error({ error }, "onDeactivate callback failed");
      }
    }

    return { ...this.state };
  }

  /**
   * Check if an action is allowed (throws if kill switch active)
   */
  checkAllowed(action: string, correlationId?: string): void {
    if (this.state.isActive) {
      // Audit log
      this.auditLog.push({
        timestamp: Date.now(),
        action: "check",
        triggeredBy: correlationId,
        reason: `Blocked action: ${action}`,
      });

      throw new KillSwitchError(
        `Action blocked: Kill switch is active. Reason: ${this.state.reason}`,
        this.state.activatedAt!,
        this.state.reason
      );
    }
  }

  /**
   * Guard wrapper for async functions
   */
  guard<T>(
    action: string,
    fn: () => Promise<T>,
    correlationId?: string
  ): Promise<T> {
    this.checkAllowed(action, correlationId);
    return fn();
  }

  /**
   * Get audit log
   */
  getAuditLog(): typeof this.auditLog {
    return [...this.auditLog];
  }

  /**
   * Update callbacks
   */
  setCallbacks(callbacks: Partial<KillSwitchCallbacks>): void {
    Object.assign(this.config.callbacks, callbacks);
  }
}

/**
 * Factory function
 */
export function createKillSwitch(
  config?: Partial<KillSwitchConfig>
): KillSwitch {
  return new KillSwitch(config);
}

// ============================================
// GLOBAL KILL SWITCH INSTANCE
// ============================================

let globalKillSwitch: KillSwitch | null = null;

export function getGlobalKillSwitch(): KillSwitch {
  if (!globalKillSwitch) {
    globalKillSwitch = createKillSwitch();
  }
  return globalKillSwitch;
}

export function setGlobalKillSwitch(killSwitch: KillSwitch): void {
  globalKillSwitch = killSwitch;
}
