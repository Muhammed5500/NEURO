/**
 * Transaction Submission Types
 * 
 * Types for transaction submission providers and policies.
 */

import { z } from "zod";

// ============================================
// SUBMISSION ROUTE TYPES
// ============================================

export type SubmissionRoute = 
  | "public_rpc"
  | "private_relay"
  | "deferred_execution";

export type SubmissionStatus = 
  | "pending"
  | "submitted"
  | "confirmed"
  | "failed"
  | "rejected"
  | "timeout";

// ============================================
// TRANSACTION REQUEST
// ============================================

export interface TransactionRequest {
  // Chain info
  chainId: number;
  
  // Transaction data
  from: string;
  to: string;
  value: string; // Wei
  data: string;
  
  // Gas (with buffer already applied)
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  
  // Nonce (optional, will be fetched if not provided)
  nonce?: number;
}

// ============================================
// SUBMISSION RESULT
// ============================================

export interface SubmissionResult {
  success: boolean;
  
  // Transaction details
  txHash?: string;
  nonce?: number;
  
  // Routing info
  route: SubmissionRoute;
  providerName: string;
  
  // Status
  status: SubmissionStatus;
  
  // Error info
  errorCode?: string;
  errorMessage?: string;
  
  // Timing
  submittedAt: string;
  confirmedAt?: string;
  
  // Gas used (after confirmation)
  gasUsed?: string;
  effectiveGasPrice?: string;
  
  // Block info (after confirmation)
  blockNumber?: number;
  blockHash?: string;
}

// ============================================
// PROVIDER CAPABILITIES
// ============================================

export interface SubmissionProviderCapabilities {
  supportsPublicRpc: boolean;
  supportsPrivateRelay: boolean;
  supportsDeferredExecution: boolean;
  
  // Health status
  publicRpcOnline: boolean;
  privateRelayOnline: boolean;
  deferredExecutionOnline: boolean;
  
  // Rate limits
  maxRequestsPerSecond: number;
}

// ============================================
// PROVIDER OPTIONS
// ============================================

export interface SubmissionOptions {
  // Required route (if specific route needed)
  requiredRoute?: SubmissionRoute;
  
  // Timeout
  timeoutMs?: number;
  
  // Confirmation
  waitForConfirmation?: boolean;
  confirmationBlocks?: number;
  
  // Retry
  maxRetries?: number;
  
  // Correlation
  correlationId: string;
  planId?: string;
  simulationId?: string;
  bundleId?: string;
}

// ============================================
// AUDIT TYPES
// ============================================

/**
 * Turkish: "Her gönderim girişimi; plan ID, simülasyon ID ve nihai tx_hash ile
 * birbirine bağlanarak AuditLog'a kaydedilmeli."
 */
export interface SubmissionAuditEntry {
  id: string;
  timestamp: string;
  
  // Correlation IDs (Turkish requirement)
  correlationId: string;
  planId?: string;
  simulationId?: string;
  bundleId?: string;
  txHash?: string;
  
  // Action
  action: "submission_attempt" | "submission_success" | "submission_failed" | "policy_rejected" | "fallback_blocked" | "nonce_acquired" | "nonce_released";
  
  // Details
  route?: SubmissionRoute;
  providerName?: string;
  
  // Transaction info
  from?: string;
  to?: string;
  value?: string;
  budgetMon?: number;
  
  // Status
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  
  // Security flags
  securityEvent?: boolean;
  securityEventType?: "fallback_attempted" | "provider_offline" | "policy_violation" | "nonce_collision";
  
  // Metadata
  metadata?: Record<string, unknown>;
}

// ============================================
// POLICY TYPES
// ============================================

/**
 * Turkish: "Eğer işlem bütçesi (budget) belirlenen bir limitin (örn: 0.5 MON)
 * üzerindeyse, publicRpcSubmit metodunu kod seviyesinde devre dışı bırak."
 */
export interface SubmissionPolicy {
  // Route restrictions
  allowPublicRpc: boolean;
  allowPrivateRelay: boolean;
  allowDeferredExecution: boolean;
  
  // Budget-based routing (Turkish requirement)
  publicRpcMaxBudgetMon: number;
  
  // Sensitive action detection
  sensitiveActionTypes: string[];
  requirePrivateForSensitive: boolean;
  
  // Fail-closed behavior (Turkish requirement)
  failClosedOnProviderOffline: boolean;
  blockFallbackToPublic: boolean;
}

export const DEFAULT_SUBMISSION_POLICY: SubmissionPolicy = {
  allowPublicRpc: true,
  allowPrivateRelay: true,
  allowDeferredExecution: true,
  
  // Turkish: "0.5 MON üzerindeyse publicRpcSubmit devre dışı"
  publicRpcMaxBudgetMon: 0.5,
  
  sensitiveActionTypes: ["token_launch", "large_swap", "liquidity_removal"],
  requirePrivateForSensitive: true,
  
  // Turkish: "Fail-Closed Architecture"
  failClosedOnProviderOffline: true,
  blockFallbackToPublic: true,
};

// ============================================
// NONCE MANAGEMENT TYPES
// ============================================

/**
 * Turkish: "her gönderim denemesinde nonce kontrolünü atomik olarak
 * gerçekleştiren bir yapı kur"
 */
export interface NonceReservation {
  address: string;
  nonce: number;
  reservedAt: number;
  expiresAt: number;
  correlationId: string;
  released: boolean;
}

// ============================================
// SECURITY ERROR TYPES
// ============================================

export class SecurityBreachError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly correlationId: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "SecurityBreachError";
  }
}

export class ProviderOfflineError extends Error {
  constructor(
    public readonly providerName: string,
    public readonly route: SubmissionRoute,
    public readonly correlationId: string
  ) {
    super(`Provider ${providerName} for route ${route} is offline`);
    this.name = "ProviderOfflineError";
  }
}

export class NonceCollisionError extends Error {
  constructor(
    public readonly address: string,
    public readonly expectedNonce: number,
    public readonly actualNonce: number,
    public readonly correlationId: string
  ) {
    super(`Nonce collision for ${address}: expected ${expectedNonce}, got ${actualNonce}`);
    this.name = "NonceCollisionError";
  }
}

export class PolicyViolationError extends Error {
  constructor(
    public readonly policy: string,
    public readonly reason: string,
    public readonly correlationId: string
  ) {
    super(`Policy violation: ${policy} - ${reason}`);
    this.name = "PolicyViolationError";
  }
}
