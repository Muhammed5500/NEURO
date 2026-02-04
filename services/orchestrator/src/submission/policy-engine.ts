/**
 * Policy Engine
 * 
 * Enforces submission policies including:
 * - Threshold-based routing (budget > 0.5 MON blocks public RPC)
 * - Sensitive action detection
 * - Fail-closed architecture
 * 
 * Turkish Requirements:
 * - "Eğer işlem bütçesi 0.5 MON üzerindeyse, publicRpcSubmit devre dışı bırak"
 * - "Fail-Closed Architecture: otomatik olarak Public RPC'ye düşmemeli"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  SubmissionRoute,
  SubmissionPolicy,
  TransactionRequest,
  SubmissionProviderCapabilities,
  SubmissionAuditEntry,
} from "./types.js";
import {
  DEFAULT_SUBMISSION_POLICY,
  PolicyViolationError,
  SecurityBreachError,
  ProviderOfflineError,
} from "./types.js";

const policyLogger = logger.child({ component: "policy-engine" });

// ============================================
// ROUTE EVALUATION RESULT
// ============================================

export interface RouteEvaluationResult {
  allowed: boolean;
  selectedRoute?: SubmissionRoute;
  
  // Blocked routes with reasons
  blockedRoutes: Array<{
    route: SubmissionRoute;
    reason: string;
    isSecurityBlock: boolean;
  }>;
  
  // Warnings
  warnings: string[];
  
  // Policy details
  appliedPolicy: string;
  budgetMon?: number;
}

// ============================================
// POLICY ENGINE
// ============================================

export class PolicyEngine {
  private policy: SubmissionPolicy;
  private auditCallback?: (entry: Omit<SubmissionAuditEntry, "id" | "timestamp">) => void;

  constructor(policy?: Partial<SubmissionPolicy>) {
    this.policy = { ...DEFAULT_SUBMISSION_POLICY, ...policy };
    
    policyLogger.info({
      publicRpcMaxBudget: this.policy.publicRpcMaxBudgetMon,
      failClosedEnabled: this.policy.failClosedOnProviderOffline,
    }, "PolicyEngine initialized");
  }

  /**
   * Set audit callback
   */
  setAuditCallback(
    callback: (entry: Omit<SubmissionAuditEntry, "id" | "timestamp">) => void
  ): void {
    this.auditCallback = callback;
  }

  /**
   * Evaluate which route to use for a transaction
   */
  evaluateRoute(
    tx: TransactionRequest,
    capabilities: SubmissionProviderCapabilities,
    options: {
      correlationId: string;
      actionType?: string;
      budgetMon?: number;
      preferredRoute?: SubmissionRoute;
    }
  ): RouteEvaluationResult {
    const { correlationId, actionType, preferredRoute } = options;
    const blockedRoutes: RouteEvaluationResult["blockedRoutes"] = [];
    const warnings: string[] = [];

    // Calculate budget from transaction value
    const valueMon = Number(tx.value) / 1e18;
    const budgetMon = options.budgetMon ?? valueMon;

    policyLogger.debug({
      correlationId,
      budgetMon,
      actionType,
      preferredRoute,
    }, "Evaluating route policy");

    // ============================================
    // CHECK EACH ROUTE
    // ============================================

    // 1. Check Public RPC
    // Turkish: "Eğer işlem bütçesi 0.5 MON üzerindeyse, publicRpcSubmit devre dışı bırak"
    const publicRpcAllowed = this.checkPublicRpcAllowed(
      budgetMon,
      actionType,
      capabilities,
      correlationId,
      blockedRoutes
    );

    // 2. Check Private Relay
    const privateRelayAllowed = this.checkPrivateRelayAllowed(
      capabilities,
      correlationId,
      blockedRoutes
    );

    // 3. Check Deferred Execution
    const deferredAllowed = this.checkDeferredAllowed(
      capabilities,
      correlationId,
      blockedRoutes
    );

    // ============================================
    // SELECT ROUTE
    // ============================================

    let selectedRoute: SubmissionRoute | undefined;

    // If preferred route specified, try to use it
    if (preferredRoute) {
      if (this.isRouteAvailable(preferredRoute, publicRpcAllowed, privateRelayAllowed, deferredAllowed)) {
        selectedRoute = preferredRoute;
      } else {
        warnings.push(`Preferred route ${preferredRoute} not available`);
      }
    }

    // Select best available route (private > deferred > public)
    if (!selectedRoute) {
      if (privateRelayAllowed) {
        selectedRoute = "private_relay";
      } else if (deferredAllowed) {
        selectedRoute = "deferred_execution";
      } else if (publicRpcAllowed) {
        selectedRoute = "public_rpc";
        
        // Warn if using public for large transactions
        if (budgetMon > this.policy.publicRpcMaxBudgetMon * 0.8) {
          warnings.push(`Budget ${budgetMon.toFixed(4)} MON approaching public RPC limit`);
        }
      }
    }

    // Check if any route is available
    const allowed = selectedRoute !== undefined;

    // Log policy decision
    if (!allowed) {
      this.audit({
        correlationId,
        action: "policy_rejected",
        success: false,
        budgetMon,
        errorMessage: "No routes available",
        securityEvent: true,
        securityEventType: "policy_violation",
        metadata: { blockedRoutes },
      });
    }

    policyLogger.info({
      correlationId,
      allowed,
      selectedRoute,
      budgetMon,
      blockedCount: blockedRoutes.length,
    }, "Route evaluation complete");

    return {
      allowed,
      selectedRoute,
      blockedRoutes,
      warnings,
      appliedPolicy: "default",
      budgetMon,
    };
  }

  /**
   * Check if fallback to public RPC is allowed
   * Turkish: "sistem asla otomatik olarak Public RPC'ye düşmemeli (fallback yapmamalı)"
   */
  checkFallbackAllowed(
    originalRoute: SubmissionRoute,
    correlationId: string
  ): boolean {
    // If fail-closed is enabled, block all fallbacks
    if (this.policy.blockFallbackToPublic && originalRoute !== "public_rpc") {
      this.audit({
        correlationId,
        action: "fallback_blocked",
        success: false,
        route: originalRoute,
        errorMessage: "Fallback to public RPC blocked by policy",
        securityEvent: true,
        securityEventType: "fallback_attempted",
      });

      policyLogger.warn({
        correlationId,
        originalRoute,
      }, "Fallback to public RPC blocked by fail-closed policy");

      return false;
    }

    return true;
  }

  /**
   * Validate submission is allowed before execution
   * Throws SecurityBreachError if not allowed
   */
  validateSubmission(
    route: SubmissionRoute,
    tx: TransactionRequest,
    capabilities: SubmissionProviderCapabilities,
    correlationId: string,
    budgetMon?: number
  ): void {
    const value = budgetMon ?? Number(tx.value) / 1e18;

    // Check route-specific validations
    switch (route) {
      case "public_rpc":
        // Turkish: "0.5 MON üzerindeyse publicRpcSubmit devre dışı"
        if (value > this.policy.publicRpcMaxBudgetMon) {
          throw new PolicyViolationError(
            "threshold_routing",
            `Budget ${value.toFixed(4)} MON exceeds public RPC limit of ${this.policy.publicRpcMaxBudgetMon} MON`,
            correlationId
          );
        }
        
        if (!capabilities.publicRpcOnline) {
          throw new ProviderOfflineError("public_rpc", route, correlationId);
        }
        break;

      case "private_relay":
        if (!capabilities.supportsPrivateRelay) {
          throw new PolicyViolationError(
            "capability_check",
            "Private relay not supported by provider",
            correlationId
          );
        }
        
        // Turkish: "Fail-Closed Architecture"
        if (!capabilities.privateRelayOnline) {
          if (this.policy.failClosedOnProviderOffline) {
            throw new SecurityBreachError(
              "Security Breach Risk: Private relay offline, fail-closed triggered",
              "PRIVATE_RELAY_OFFLINE",
              correlationId,
              { route, budgetMon: value }
            );
          }
          throw new ProviderOfflineError("private_relay", route, correlationId);
        }
        break;

      case "deferred_execution":
        if (!capabilities.supportsDeferredExecution) {
          throw new PolicyViolationError(
            "capability_check",
            "Deferred execution not supported by provider",
            correlationId
          );
        }
        
        // Turkish: "Fail-Closed Architecture"
        if (!capabilities.deferredExecutionOnline) {
          if (this.policy.failClosedOnProviderOffline) {
            throw new SecurityBreachError(
              "Security Breach Risk: Deferred execution offline, fail-closed triggered",
              "DEFERRED_EXECUTION_OFFLINE",
              correlationId,
              { route, budgetMon: value }
            );
          }
          throw new ProviderOfflineError("deferred_execution", route, correlationId);
        }
        break;
    }
  }

  /**
   * Update policy
   */
  updatePolicy(updates: Partial<SubmissionPolicy>): void {
    this.policy = { ...this.policy, ...updates };
    policyLogger.info({ updates }, "Policy updated");
  }

  /**
   * Get current policy
   */
  getPolicy(): SubmissionPolicy {
    return { ...this.policy };
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private checkPublicRpcAllowed(
    budgetMon: number,
    actionType: string | undefined,
    capabilities: SubmissionProviderCapabilities,
    correlationId: string,
    blockedRoutes: RouteEvaluationResult["blockedRoutes"]
  ): boolean {
    // Check policy flag
    if (!this.policy.allowPublicRpc) {
      blockedRoutes.push({
        route: "public_rpc",
        reason: "Disabled by policy",
        isSecurityBlock: false,
      });
      return false;
    }

    // Check capability
    if (!capabilities.supportsPublicRpc) {
      blockedRoutes.push({
        route: "public_rpc",
        reason: "Not supported by provider",
        isSecurityBlock: false,
      });
      return false;
    }

    // Check online status
    if (!capabilities.publicRpcOnline) {
      blockedRoutes.push({
        route: "public_rpc",
        reason: "Provider offline",
        isSecurityBlock: false,
      });
      return false;
    }

    // Turkish: "0.5 MON üzerindeyse publicRpcSubmit devre dışı bırak"
    if (budgetMon > this.policy.publicRpcMaxBudgetMon) {
      blockedRoutes.push({
        route: "public_rpc",
        reason: `Budget ${budgetMon.toFixed(4)} MON exceeds limit of ${this.policy.publicRpcMaxBudgetMon} MON`,
        isSecurityBlock: true,
      });
      
      policyLogger.info({
        correlationId,
        budgetMon,
        limit: this.policy.publicRpcMaxBudgetMon,
      }, "Public RPC blocked due to threshold routing");
      
      return false;
    }

    // Check sensitive action
    if (
      actionType &&
      this.policy.sensitiveActionTypes.includes(actionType) &&
      this.policy.requirePrivateForSensitive
    ) {
      blockedRoutes.push({
        route: "public_rpc",
        reason: `Sensitive action type: ${actionType}`,
        isSecurityBlock: true,
      });
      return false;
    }

    return true;
  }

  private checkPrivateRelayAllowed(
    capabilities: SubmissionProviderCapabilities,
    correlationId: string,
    blockedRoutes: RouteEvaluationResult["blockedRoutes"]
  ): boolean {
    if (!this.policy.allowPrivateRelay) {
      blockedRoutes.push({
        route: "private_relay",
        reason: "Disabled by policy",
        isSecurityBlock: false,
      });
      return false;
    }

    if (!capabilities.supportsPrivateRelay) {
      blockedRoutes.push({
        route: "private_relay",
        reason: "Not supported by provider",
        isSecurityBlock: false,
      });
      return false;
    }

    if (!capabilities.privateRelayOnline) {
      blockedRoutes.push({
        route: "private_relay",
        reason: "Provider offline",
        isSecurityBlock: this.policy.failClosedOnProviderOffline,
      });
      return false;
    }

    return true;
  }

  private checkDeferredAllowed(
    capabilities: SubmissionProviderCapabilities,
    correlationId: string,
    blockedRoutes: RouteEvaluationResult["blockedRoutes"]
  ): boolean {
    if (!this.policy.allowDeferredExecution) {
      blockedRoutes.push({
        route: "deferred_execution",
        reason: "Disabled by policy",
        isSecurityBlock: false,
      });
      return false;
    }

    if (!capabilities.supportsDeferredExecution) {
      blockedRoutes.push({
        route: "deferred_execution",
        reason: "Not supported by provider",
        isSecurityBlock: false,
      });
      return false;
    }

    if (!capabilities.deferredExecutionOnline) {
      blockedRoutes.push({
        route: "deferred_execution",
        reason: "Provider offline",
        isSecurityBlock: this.policy.failClosedOnProviderOffline,
      });
      return false;
    }

    return true;
  }

  private isRouteAvailable(
    route: SubmissionRoute,
    publicAllowed: boolean,
    privateAllowed: boolean,
    deferredAllowed: boolean
  ): boolean {
    switch (route) {
      case "public_rpc":
        return publicAllowed;
      case "private_relay":
        return privateAllowed;
      case "deferred_execution":
        return deferredAllowed;
      default:
        return false;
    }
  }

  private audit(entry: Omit<SubmissionAuditEntry, "id" | "timestamp">): void {
    if (this.auditCallback) {
      this.auditCallback(entry);
    }
  }
}

/**
 * Factory function
 */
export function createPolicyEngine(
  policy?: Partial<SubmissionPolicy>
): PolicyEngine {
  return new PolicyEngine(policy);
}
