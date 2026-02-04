/**
 * Transaction Submission Service
 * 
 * Main service for submitting transactions with:
 * - Fail-closed architecture (Turkish: "Security Breach Risk" uyarısı)
 * - Policy-based route selection
 * - Atomic nonce management
 * - Full audit logging
 * 
 * Turkish Requirements:
 * - "sistem asla otomatik olarak Public RPC'ye düşmemeli (fallback yapmamalı)"
 * - "her gönderim girişimi; plan ID, simülasyon ID ve nihai tx_hash ile birbirine bağlanarak"
 * - "nonce kontrolünü atomik olarak gerçekleştiren"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { TransactionSubmissionProvider } from "./provider-interface.js";
import type {
  TransactionRequest,
  SubmissionResult,
  SubmissionOptions,
  SubmissionRoute,
  SubmissionPolicy,
  NonceReservation,
} from "./types.js";
import {
  SecurityBreachError,
  ProviderOfflineError,
  PolicyViolationError,
} from "./types.js";
import { NonceManager, createNonceManager } from "./nonce-manager.js";
import { PolicyEngine, createPolicyEngine } from "./policy-engine.js";
import { SubmissionAuditLogger, createAuditLogger } from "./audit-logger.js";

const serviceLogger = logger.child({ component: "submission-service" });

// ============================================
// SERVICE CONFIGURATION
// ============================================

export interface SubmissionServiceConfig {
  // Provider
  provider: TransactionSubmissionProvider;
  
  // Policy
  policy?: Partial<SubmissionPolicy>;
  
  // Audit logging
  auditLogPath?: string;
  logToConsole?: boolean;
  
  // Retry configuration
  maxRetries: number;
  retryDelayMs: number;
  
  // Timeouts
  defaultTimeoutMs: number;
  confirmationTimeoutMs: number;
}

const DEFAULT_CONFIG: Partial<SubmissionServiceConfig> = {
  maxRetries: 3,
  retryDelayMs: 1000,
  defaultTimeoutMs: 30000,
  confirmationTimeoutMs: 60000,
};

// ============================================
// SUBMISSION SERVICE
// ============================================

export class SubmissionService {
  private readonly config: SubmissionServiceConfig;
  private readonly provider: TransactionSubmissionProvider;
  private readonly nonceManager: NonceManager;
  private readonly policyEngine: PolicyEngine;
  private readonly auditLogger: SubmissionAuditLogger;
  private initialized = false;

  constructor(config: SubmissionServiceConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as SubmissionServiceConfig;
    this.provider = config.provider;
    
    this.nonceManager = createNonceManager();
    this.policyEngine = createPolicyEngine(config.policy);
    this.auditLogger = createAuditLogger({
      storagePath: config.auditLogPath || "./data/submission_audit",
      logToConsole: config.logToConsole ?? true,
    });

    // Wire up audit callbacks
    this.nonceManager.setAuditCallback(entry => this.auditLogger.log(entry));
    this.policyEngine.setAuditCallback(entry => this.auditLogger.log(entry));

    serviceLogger.info({
      provider: this.provider.name,
      maxRetries: this.config.maxRetries,
    }, "SubmissionService created");
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.auditLogger.initialize();
    
    // Run initial health check
    await this.provider.healthCheck();
    
    this.initialized = true;
    serviceLogger.info("SubmissionService initialized");
  }

  /**
   * Submit a transaction with full policy enforcement and audit logging
   * 
   * Turkish: "Every attempt is logged with correlation IDs"
   */
  async submit(
    tx: TransactionRequest,
    options: SubmissionOptions
  ): Promise<SubmissionResult> {
    const { correlationId, planId, simulationId, bundleId } = options;

    serviceLogger.info({
      correlationId,
      planId,
      to: tx.to,
      value: tx.value,
    }, "Starting transaction submission");

    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

    // Calculate budget
    const budgetMon = Number(tx.value) / 1e18;

    // 1. Run health check and get capabilities
    const capabilities = await this.provider.healthCheck();

    // 2. Evaluate route policy
    // Turkish: "0.5 MON üzerindeyse publicRpcSubmit devre dışı bırak"
    const routeEvaluation = this.policyEngine.evaluateRoute(tx, capabilities, {
      correlationId,
      budgetMon,
      preferredRoute: options.requiredRoute,
    });

    if (!routeEvaluation.allowed) {
      // Log the rejection
      this.auditLogger.logSubmissionFailed({
        correlationId,
        planId,
        simulationId,
        bundleId,
        route: "none",
        errorMessage: "No routes available based on policy",
        securityEvent: true,
        securityEventType: "policy_violation",
        metadata: { blockedRoutes: routeEvaluation.blockedRoutes },
      });

      throw new PolicyViolationError(
        "route_selection",
        "No routes available: " + routeEvaluation.blockedRoutes.map(r => r.reason).join(", "),
        correlationId
      );
    }

    const selectedRoute = routeEvaluation.selectedRoute!;

    // 3. Validate submission against policy
    // Turkish: "Fail-Closed Architecture"
    try {
      this.policyEngine.validateSubmission(
        selectedRoute,
        tx,
        capabilities,
        correlationId,
        budgetMon
      );
    } catch (error) {
      if (error instanceof SecurityBreachError) {
        // Log security event
        this.auditLogger.logSubmissionFailed({
          correlationId,
          planId,
          simulationId,
          bundleId,
          route: selectedRoute,
          providerName: this.provider.name,
          errorCode: error.code,
          errorMessage: error.message,
          securityEvent: true,
          securityEventType: "provider_offline",
        });
      }
      throw error;
    }

    // 4. Reserve nonce atomically
    // Turkish: "nonce kontrolünü atomik olarak gerçekleştiren"
    let nonceReservation: NonceReservation | undefined;
    
    try {
      nonceReservation = await this.nonceManager.reserveNonce(
        tx.from,
        () => this.provider.getNonce(tx.from),
        correlationId
      );

      // Update transaction with reserved nonce
      tx.nonce = nonceReservation.nonce;
    } catch (error) {
      this.auditLogger.logSubmissionFailed({
        correlationId,
        planId,
        simulationId,
        bundleId,
        route: selectedRoute,
        from: tx.from,
        errorMessage: error instanceof Error ? error.message : "Nonce reservation failed",
        securityEvent: error instanceof Error && error.name === "NonceCollisionError",
        securityEventType: "nonce_collision",
      });
      throw error;
    }

    // 5. Log submission attempt
    this.auditLogger.logSubmissionAttempt({
      correlationId,
      planId,
      simulationId,
      bundleId,
      route: selectedRoute,
      providerName: this.provider.name,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      budgetMon,
    });

    // 6. Submit with retry logic
    let result: SubmissionResult | undefined;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        result = await this.executeSubmission(tx, options, selectedRoute);
        
        if (result.success) {
          break;
        }
        
        lastError = new Error(result.errorMessage || "Submission failed");
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Don't retry on security errors
        if (error instanceof SecurityBreachError || error instanceof PolicyViolationError) {
          break;
        }
        
        // Don't retry on last attempt
        if (attempt === this.config.maxRetries) {
          break;
        }

        serviceLogger.warn({
          correlationId,
          attempt,
          error: lastError.message,
        }, "Submission attempt failed, retrying");

        await this.delay(this.config.retryDelayMs * (attempt + 1));
      }
    }

    // 7. Handle result
    if (result?.success) {
      // Confirm nonce
      await this.nonceManager.confirmNonce(nonceReservation!, result.txHash);

      // Log success
      this.auditLogger.logSubmissionSuccess({
        correlationId,
        planId,
        simulationId,
        bundleId,
        txHash: result.txHash!,
        route: selectedRoute,
        providerName: this.provider.name,
        from: tx.from,
        to: tx.to,
        value: tx.value,
        budgetMon,
        metadata: {
          nonce: result.nonce,
          gasUsed: result.gasUsed,
          blockNumber: result.blockNumber,
        },
      });

      serviceLogger.info({
        correlationId,
        txHash: result.txHash,
        route: selectedRoute,
      }, "Transaction submitted successfully");

      return result;
    }

    // Release nonce on failure
    await this.nonceManager.releaseNonce(nonceReservation!, lastError?.message);

    // Log failure
    this.auditLogger.logSubmissionFailed({
      correlationId,
      planId,
      simulationId,
      bundleId,
      route: selectedRoute,
      providerName: this.provider.name,
      from: tx.from,
      to: tx.to,
      errorCode: result?.errorCode || "SUBMISSION_FAILED",
      errorMessage: lastError?.message || "Unknown error",
    });

    // Return or throw based on whether we have a result
    if (result) {
      return result;
    }

    throw lastError || new Error("Submission failed");
  }

  /**
   * Check if submission would be allowed (dry run)
   */
  async validateSubmission(
    tx: TransactionRequest,
    correlationId: string
  ): Promise<{
    allowed: boolean;
    selectedRoute?: SubmissionRoute;
    blockedRoutes: Array<{ route: SubmissionRoute; reason: string }>;
    warnings: string[];
  }> {
    const capabilities = await this.provider.healthCheck();
    const budgetMon = Number(tx.value) / 1e18;

    const evaluation = this.policyEngine.evaluateRoute(tx, capabilities, {
      correlationId,
      budgetMon,
    });

    return {
      allowed: evaluation.allowed,
      selectedRoute: evaluation.selectedRoute,
      blockedRoutes: evaluation.blockedRoutes,
      warnings: evaluation.warnings,
    };
  }

  /**
   * Get provider health status
   */
  async getHealth(): Promise<{
    provider: string;
    capabilities: Awaited<ReturnType<TransactionSubmissionProvider["healthCheck"]>>;
    policy: SubmissionPolicy;
  }> {
    const capabilities = await this.provider.healthCheck();
    return {
      provider: this.provider.name,
      capabilities,
      policy: this.policyEngine.getPolicy(),
    };
  }

  /**
   * Get audit report
   */
  async getAuditReport(correlationId?: string): Promise<ReturnType<SubmissionAuditLogger["generateReport"]>> {
    const entries = correlationId
      ? await this.auditLogger.queryByCorrelationId(correlationId)
      : [];
    return this.auditLogger.generateReport(entries);
  }

  /**
   * Update policy
   */
  updatePolicy(updates: Partial<SubmissionPolicy>): void {
    this.policyEngine.updatePolicy(updates);
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    this.nonceManager.shutdown();
    await this.auditLogger.shutdown();
    serviceLogger.info("SubmissionService shutdown");
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private async executeSubmission(
    tx: TransactionRequest,
    options: SubmissionOptions,
    route: SubmissionRoute
  ): Promise<SubmissionResult> {
    const submissionOptions: SubmissionOptions = {
      ...options,
      timeoutMs: options.timeoutMs || this.config.defaultTimeoutMs,
    };

    switch (route) {
      case "public_rpc":
        return this.provider.publicRpcSubmit(tx, submissionOptions);

      case "private_relay":
        if (!this.provider.privateRelaySubmit) {
          throw new PolicyViolationError(
            "capability",
            "Private relay not supported by provider",
            options.correlationId
          );
        }
        return this.provider.privateRelaySubmit(tx, submissionOptions);

      case "deferred_execution":
        if (!this.provider.deferredExecutionSubmit) {
          throw new PolicyViolationError(
            "capability",
            "Deferred execution not supported by provider",
            options.correlationId
          );
        }
        return this.provider.deferredExecutionSubmit(tx, submissionOptions);

      default:
        throw new Error(`Unknown route: ${route}`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Factory function
 */
export function createSubmissionService(
  config: SubmissionServiceConfig
): SubmissionService {
  return new SubmissionService(config);
}
