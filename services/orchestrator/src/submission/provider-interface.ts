/**
 * Transaction Submission Provider Interface
 * 
 * Defines the contract for transaction submission providers.
 * Supports public RPC, private relay, and deferred execution routes.
 */

import type {
  TransactionRequest,
  SubmissionResult,
  SubmissionProviderCapabilities,
  SubmissionOptions,
} from "./types.js";

// ============================================
// PROVIDER INTERFACE
// ============================================

/**
 * Transaction Submission Provider Interface
 * 
 * All providers must implement at least publicRpcSubmit.
 * Private relay and deferred execution are optional capabilities.
 */
export interface TransactionSubmissionProvider {
  readonly name: string;
  readonly capabilities: SubmissionProviderCapabilities;

  /**
   * Submit transaction via public RPC
   * 
   * This is the standard submission method available on all providers.
   * 
   * Turkish: "Eğer işlem bütçesi 0.5 MON üzerindeyse, publicRpcSubmit
   * metodunu kod seviyesinde devre dışı bırak" - This is enforced at
   * the policy engine level, not the provider level.
   */
  publicRpcSubmit(
    tx: TransactionRequest,
    options: SubmissionOptions
  ): Promise<SubmissionResult>;

  /**
   * Submit transaction via private relay (MEV protection)
   * 
   * Optional capability. If not supported, returns undefined.
   * Private relays protect against sandwich attacks and frontrunning.
   */
  privateRelaySubmit?(
    tx: TransactionRequest,
    options: SubmissionOptions
  ): Promise<SubmissionResult>;

  /**
   * Submit transaction via deferred execution
   * 
   * Optional capability for Monad's deferred execution feature.
   * Allows transactions to be scheduled for future execution.
   */
  deferredExecutionSubmit?(
    tx: TransactionRequest,
    options: SubmissionOptions
  ): Promise<SubmissionResult>;

  /**
   * Check provider health status
   */
  healthCheck(): Promise<SubmissionProviderCapabilities>;

  /**
   * Get current nonce for an address
   */
  getNonce(address: string): Promise<number>;

  /**
   * Wait for transaction confirmation
   */
  waitForConfirmation(
    txHash: string,
    confirmationBlocks?: number,
    timeoutMs?: number
  ): Promise<SubmissionResult>;
}

// ============================================
// PROVIDER HEALTH CHECK
// ============================================

export interface ProviderHealthStatus {
  provider: string;
  overallHealthy: boolean;
  routes: {
    publicRpc: {
      available: boolean;
      latencyMs?: number;
      lastError?: string;
    };
    privateRelay: {
      available: boolean;
      latencyMs?: number;
      lastError?: string;
    };
    deferredExecution: {
      available: boolean;
      latencyMs?: number;
      lastError?: string;
    };
  };
  checkedAt: string;
}

/**
 * Check if provider supports a specific route
 */
export function supportsRoute(
  provider: TransactionSubmissionProvider,
  route: string
): boolean {
  switch (route) {
    case "public_rpc":
      return provider.capabilities.supportsPublicRpc;
    case "private_relay":
      return provider.capabilities.supportsPrivateRelay && 
             typeof provider.privateRelaySubmit === "function";
    case "deferred_execution":
      return provider.capabilities.supportsDeferredExecution &&
             typeof provider.deferredExecutionSubmit === "function";
    default:
      return false;
  }
}

/**
 * Check if a route is online
 */
export function isRouteOnline(
  provider: TransactionSubmissionProvider,
  route: string
): boolean {
  switch (route) {
    case "public_rpc":
      return provider.capabilities.publicRpcOnline;
    case "private_relay":
      return provider.capabilities.privateRelayOnline;
    case "deferred_execution":
      return provider.capabilities.deferredExecutionOnline;
    default:
      return false;
  }
}
