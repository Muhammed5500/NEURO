/**
 * Audit Logger
 * 
 * Logs all submission attempts with correlation IDs.
 * 
 * Turkish: "Her gönderim girişimi; plan ID, simülasyon ID ve nihai tx_hash ile
 * birbirine bağlanarak AuditLog'a kaydedilmeli."
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as fs from "fs/promises";
import * as path from "path";
import type { SubmissionAuditEntry } from "./types.js";

const auditLogger = logger.child({ component: "submission-audit" });

// ============================================
// AUDIT LOGGER CONFIGURATION
// ============================================

export interface AuditLoggerConfig {
  // Storage path for audit logs
  storagePath: string;
  
  // Log to console as well
  logToConsole: boolean;
  
  // Log security events to separate file
  separateSecurityLog: boolean;
  
  // Retention period in days
  retentionDays: number;
  
  // Batch writes for performance
  batchWriteIntervalMs: number;
}

const DEFAULT_CONFIG: AuditLoggerConfig = {
  storagePath: "./data/audit_logs",
  logToConsole: true,
  separateSecurityLog: true,
  retentionDays: 90,
  batchWriteIntervalMs: 5000,
};

// ============================================
// AUDIT LOGGER
// ============================================

export class SubmissionAuditLogger {
  private readonly config: AuditLoggerConfig;
  private readonly pendingEntries: SubmissionAuditEntry[] = [];
  private batchInterval?: NodeJS.Timeout;
  private initialized = false;

  constructor(config?: Partial<AuditLoggerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the audit logger
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure storage directory exists
    await fs.mkdir(this.config.storagePath, { recursive: true });
    
    if (this.config.separateSecurityLog) {
      await fs.mkdir(path.join(this.config.storagePath, "security"), { recursive: true });
    }

    // Start batch write interval
    this.batchInterval = setInterval(
      () => this.flushPendingEntries(),
      this.config.batchWriteIntervalMs
    );

    this.initialized = true;
    auditLogger.info({ storagePath: this.config.storagePath }, "AuditLogger initialized");
  }

  /**
   * Log a submission audit entry
   * Turkish: "Her gönderim girişimi; plan ID, simülasyon ID ve nihai tx_hash ile birbirine bağlanarak"
   */
  log(entry: Omit<SubmissionAuditEntry, "id" | "timestamp">): SubmissionAuditEntry {
    const fullEntry: SubmissionAuditEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    // Log to console if enabled
    if (this.config.logToConsole) {
      const logLevel = entry.securityEvent ? "warn" : entry.success ? "info" : "error";
      
      auditLogger[logLevel]({
        auditId: fullEntry.id,
        correlationId: fullEntry.correlationId,
        action: fullEntry.action,
        planId: fullEntry.planId,
        simulationId: fullEntry.simulationId,
        txHash: fullEntry.txHash,
        route: fullEntry.route,
        success: fullEntry.success,
        securityEvent: fullEntry.securityEvent,
        errorMessage: fullEntry.errorMessage,
      }, `Audit: ${fullEntry.action}`);
    }

    // Add to pending entries for batch write
    this.pendingEntries.push(fullEntry);

    return fullEntry;
  }

  /**
   * Log submission attempt
   */
  logSubmissionAttempt(params: {
    correlationId: string;
    planId?: string;
    simulationId?: string;
    bundleId?: string;
    route: string;
    providerName: string;
    from: string;
    to: string;
    value: string;
    budgetMon?: number;
  }): SubmissionAuditEntry {
    return this.log({
      correlationId: params.correlationId,
      planId: params.planId,
      simulationId: params.simulationId,
      bundleId: params.bundleId,
      action: "submission_attempt",
      route: params.route as any,
      providerName: params.providerName,
      from: params.from,
      to: params.to,
      value: params.value,
      budgetMon: params.budgetMon,
      success: true, // Attempt logged, not yet completed
    });
  }

  /**
   * Log submission success
   */
  logSubmissionSuccess(params: {
    correlationId: string;
    planId?: string;
    simulationId?: string;
    bundleId?: string;
    txHash: string;
    route: string;
    providerName: string;
    from: string;
    to: string;
    value: string;
    budgetMon?: number;
    metadata?: Record<string, unknown>;
  }): SubmissionAuditEntry {
    return this.log({
      correlationId: params.correlationId,
      planId: params.planId,
      simulationId: params.simulationId,
      bundleId: params.bundleId,
      txHash: params.txHash,
      action: "submission_success",
      route: params.route as any,
      providerName: params.providerName,
      from: params.from,
      to: params.to,
      value: params.value,
      budgetMon: params.budgetMon,
      success: true,
      metadata: params.metadata,
    });
  }

  /**
   * Log submission failure
   */
  logSubmissionFailed(params: {
    correlationId: string;
    planId?: string;
    simulationId?: string;
    bundleId?: string;
    route: string;
    providerName?: string;
    from?: string;
    to?: string;
    errorCode?: string;
    errorMessage: string;
    securityEvent?: boolean;
    securityEventType?: SubmissionAuditEntry["securityEventType"];
    metadata?: Record<string, unknown>;
  }): SubmissionAuditEntry {
    return this.log({
      correlationId: params.correlationId,
      planId: params.planId,
      simulationId: params.simulationId,
      bundleId: params.bundleId,
      action: "submission_failed",
      route: params.route as any,
      providerName: params.providerName,
      from: params.from,
      to: params.to,
      success: false,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
      securityEvent: params.securityEvent,
      securityEventType: params.securityEventType,
      metadata: params.metadata,
    });
  }

  /**
   * Query audit logs by correlation ID
   */
  async queryByCorrelationId(correlationId: string): Promise<SubmissionAuditEntry[]> {
    // First check pending entries
    const pending = this.pendingEntries.filter(e => e.correlationId === correlationId);
    
    // Then check persisted logs (simplified - in production would use a database)
    // For now, just return pending entries
    return pending;
  }

  /**
   * Query audit logs by plan ID
   */
  async queryByPlanId(planId: string): Promise<SubmissionAuditEntry[]> {
    return this.pendingEntries.filter(e => e.planId === planId);
  }

  /**
   * Query security events
   */
  async querySecurityEvents(since?: Date): Promise<SubmissionAuditEntry[]> {
    const sinceTime = since?.getTime() || 0;
    return this.pendingEntries.filter(
      e => e.securityEvent && new Date(e.timestamp).getTime() >= sinceTime
    );
  }

  /**
   * Get submission history for an address
   */
  async getAddressHistory(address: string, limit = 100): Promise<SubmissionAuditEntry[]> {
    const normalized = address.toLowerCase();
    return this.pendingEntries
      .filter(e => e.from?.toLowerCase() === normalized)
      .slice(-limit);
  }

  /**
   * Flush pending entries to storage
   */
  async flushPendingEntries(): Promise<void> {
    if (this.pendingEntries.length === 0) return;

    const entries = [...this.pendingEntries];
    this.pendingEntries.length = 0;

    try {
      const today = new Date().toISOString().split("T")[0];
      const filePath = path.join(this.config.storagePath, `audit_${today}.jsonl`);
      
      // Append entries as JSONL
      const lines = entries.map(e => JSON.stringify(e)).join("\n") + "\n";
      await fs.appendFile(filePath, lines);

      // Also write security events to separate file
      if (this.config.separateSecurityLog) {
        const securityEntries = entries.filter(e => e.securityEvent);
        if (securityEntries.length > 0) {
          const securityPath = path.join(
            this.config.storagePath,
            "security",
            `security_${today}.jsonl`
          );
          const securityLines = securityEntries.map(e => JSON.stringify(e)).join("\n") + "\n";
          await fs.appendFile(securityPath, securityLines);
        }
      }

      auditLogger.debug({ count: entries.length }, "Audit entries flushed");
    } catch (error) {
      // Re-add entries on failure
      this.pendingEntries.unshift(...entries);
      auditLogger.error({ error }, "Failed to flush audit entries");
    }
  }

  /**
   * Generate audit report
   */
  generateReport(entries: SubmissionAuditEntry[]): {
    totalAttempts: number;
    successCount: number;
    failureCount: number;
    securityEventCount: number;
    routeDistribution: Record<string, number>;
    errorDistribution: Record<string, number>;
  } {
    const successCount = entries.filter(e => e.action === "submission_success").length;
    const failureCount = entries.filter(e => e.action === "submission_failed").length;
    const securityEventCount = entries.filter(e => e.securityEvent).length;

    const routeDistribution: Record<string, number> = {};
    const errorDistribution: Record<string, number> = {};

    for (const entry of entries) {
      if (entry.route) {
        routeDistribution[entry.route] = (routeDistribution[entry.route] || 0) + 1;
      }
      if (entry.errorCode) {
        errorDistribution[entry.errorCode] = (errorDistribution[entry.errorCode] || 0) + 1;
      }
    }

    return {
      totalAttempts: entries.filter(e => e.action === "submission_attempt").length,
      successCount,
      failureCount,
      securityEventCount,
      routeDistribution,
      errorDistribution,
    };
  }

  /**
   * Shutdown the audit logger
   */
  async shutdown(): Promise<void> {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
    }
    
    // Final flush
    await this.flushPendingEntries();
    
    auditLogger.info("AuditLogger shutdown");
  }
}

/**
 * Factory function
 */
export function createAuditLogger(
  config?: Partial<AuditLoggerConfig>
): SubmissionAuditLogger {
  return new SubmissionAuditLogger(config);
}
