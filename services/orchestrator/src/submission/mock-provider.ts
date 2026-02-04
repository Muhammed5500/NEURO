/**
 * Mock Submission Provider
 * 
 * Development provider that simulates transaction submission.
 * Used for testing without broadcasting to actual networks.
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { TransactionSubmissionProvider } from "./provider-interface.js";
import type {
  TransactionRequest,
  SubmissionResult,
  SubmissionProviderCapabilities,
  SubmissionOptions,
  SubmissionRoute,
} from "./types.js";

const mockLogger = logger.child({ component: "mock-submission-provider" });

// ============================================
// MOCK PROVIDER CONFIGURATION
// ============================================

export interface MockProviderConfig {
  // Simulate delays
  publicRpcDelayMs: number;
  privateRelayDelayMs: number;
  deferredExecutionDelayMs: number;
  confirmationDelayMs: number;
  
  // Simulate failures
  publicRpcFailureRate: number; // 0-1
  privateRelayFailureRate: number;
  deferredExecutionFailureRate: number;
  
  // Capability simulation
  simulatePrivateRelay: boolean;
  simulateDeferredExecution: boolean;
  
  // Offline simulation
  simulatePublicOffline: boolean;
  simulatePrivateOffline: boolean;
  simulateDeferredOffline: boolean;
  
  // Starting nonce
  startingNonce: number;
  
  // Block number simulation
  startingBlockNumber: number;
  blockTimeMs: number;
}

const DEFAULT_CONFIG: MockProviderConfig = {
  publicRpcDelayMs: 100,
  privateRelayDelayMs: 200,
  deferredExecutionDelayMs: 150,
  confirmationDelayMs: 800, // Monad ~800ms finality
  publicRpcFailureRate: 0,
  privateRelayFailureRate: 0,
  deferredExecutionFailureRate: 0,
  simulatePrivateRelay: true,
  simulateDeferredExecution: true,
  simulatePublicOffline: false,
  simulatePrivateOffline: false,
  simulateDeferredOffline: false,
  startingNonce: 0,
  startingBlockNumber: 15000000,
  blockTimeMs: 400,
};

// ============================================
// MOCK PROVIDER IMPLEMENTATION
// ============================================

export class MockSubmissionProvider implements TransactionSubmissionProvider {
  readonly name = "MockSubmissionProvider";
  capabilities: SubmissionProviderCapabilities;
  
  private readonly config: MockProviderConfig;
  private nonces: Map<string, number> = new Map();
  private submittedTxs: Map<string, SubmissionResult> = new Map();
  private blockNumber: number;
  private lastBlockTime: number;

  constructor(config?: Partial<MockProviderConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.blockNumber = this.config.startingBlockNumber;
    this.lastBlockTime = Date.now();
    
    this.capabilities = {
      supportsPublicRpc: true,
      supportsPrivateRelay: this.config.simulatePrivateRelay,
      supportsDeferredExecution: this.config.simulateDeferredExecution,
      publicRpcOnline: !this.config.simulatePublicOffline,
      privateRelayOnline: !this.config.simulatePrivateOffline,
      deferredExecutionOnline: !this.config.simulateDeferredOffline,
      maxRequestsPerSecond: 100,
    };

    mockLogger.info({
      privateRelay: this.config.simulatePrivateRelay,
      deferredExecution: this.config.simulateDeferredExecution,
    }, "MockSubmissionProvider initialized");
  }

  /**
   * Update capability/online status for testing
   */
  setCapabilities(updates: Partial<SubmissionProviderCapabilities>): void {
    this.capabilities = { ...this.capabilities, ...updates };
    mockLogger.debug({ updates }, "Capabilities updated");
  }

  /**
   * Set provider online/offline status
   */
  setOnlineStatus(route: SubmissionRoute, online: boolean): void {
    switch (route) {
      case "public_rpc":
        this.capabilities.publicRpcOnline = online;
        break;
      case "private_relay":
        this.capabilities.privateRelayOnline = online;
        break;
      case "deferred_execution":
        this.capabilities.deferredExecutionOnline = online;
        break;
    }
    mockLogger.debug({ route, online }, "Online status updated");
  }

  async publicRpcSubmit(
    tx: TransactionRequest,
    options: SubmissionOptions
  ): Promise<SubmissionResult> {
    mockLogger.debug({
      correlationId: options.correlationId,
      to: tx.to,
      value: tx.value,
    }, "Mock public RPC submission");

    // Simulate delay
    await this.delay(this.config.publicRpcDelayMs);

    // Check if should fail
    if (Math.random() < this.config.publicRpcFailureRate) {
      return this.createFailureResult(options, "public_rpc", "Simulated RPC failure");
    }

    return this.createSuccessResult(tx, options, "public_rpc");
  }

  async privateRelaySubmit(
    tx: TransactionRequest,
    options: SubmissionOptions
  ): Promise<SubmissionResult> {
    mockLogger.debug({
      correlationId: options.correlationId,
      to: tx.to,
    }, "Mock private relay submission");

    await this.delay(this.config.privateRelayDelayMs);

    if (Math.random() < this.config.privateRelayFailureRate) {
      return this.createFailureResult(options, "private_relay", "Simulated relay failure");
    }

    return this.createSuccessResult(tx, options, "private_relay");
  }

  async deferredExecutionSubmit(
    tx: TransactionRequest,
    options: SubmissionOptions
  ): Promise<SubmissionResult> {
    mockLogger.debug({
      correlationId: options.correlationId,
      to: tx.to,
    }, "Mock deferred execution submission");

    await this.delay(this.config.deferredExecutionDelayMs);

    if (Math.random() < this.config.deferredExecutionFailureRate) {
      return this.createFailureResult(options, "deferred_execution", "Simulated deferred failure");
    }

    return this.createSuccessResult(tx, options, "deferred_execution");
  }

  async healthCheck(): Promise<SubmissionProviderCapabilities> {
    return { ...this.capabilities };
  }

  async getNonce(address: string): Promise<number> {
    const normalized = address.toLowerCase();
    if (!this.nonces.has(normalized)) {
      this.nonces.set(normalized, this.config.startingNonce);
    }
    return this.nonces.get(normalized)!;
  }

  async waitForConfirmation(
    txHash: string,
    confirmationBlocks = 2,
    timeoutMs = 30000
  ): Promise<SubmissionResult> {
    const startTime = Date.now();
    
    // Simulate confirmation delay
    await this.delay(this.config.confirmationDelayMs);

    const result = this.submittedTxs.get(txHash);
    if (!result) {
      return {
        success: false,
        txHash,
        route: "public_rpc",
        providerName: this.name,
        status: "failed",
        errorCode: "TX_NOT_FOUND",
        errorMessage: "Transaction not found",
        submittedAt: new Date().toISOString(),
      };
    }

    // Update with confirmation details
    const confirmedResult: SubmissionResult = {
      ...result,
      status: "confirmed",
      confirmedAt: new Date().toISOString(),
      blockNumber: this.getCurrentBlockNumber(),
      blockHash: this.generateMockBlockHash(),
      gasUsed: (BigInt(result.nonce! * 21000 + 50000)).toString(),
    };

    this.submittedTxs.set(txHash, confirmedResult);
    return confirmedResult;
  }

  /**
   * Get submitted transactions (for testing)
   */
  getSubmittedTransactions(): Map<string, SubmissionResult> {
    return new Map(this.submittedTxs);
  }

  /**
   * Clear submitted transactions (for testing)
   */
  clearSubmittedTransactions(): void {
    this.submittedTxs.clear();
    mockLogger.debug("Submitted transactions cleared");
  }

  /**
   * Reset nonces (for testing)
   */
  resetNonces(): void {
    this.nonces.clear();
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private async createSuccessResult(
    tx: TransactionRequest,
    options: SubmissionOptions,
    route: SubmissionRoute
  ): Promise<SubmissionResult> {
    const nonce = await this.getAndIncrementNonce(tx.from);
    const txHash = this.generateMockTxHash(tx, nonce);

    const result: SubmissionResult = {
      success: true,
      txHash,
      nonce,
      route,
      providerName: this.name,
      status: options.waitForConfirmation ? "confirmed" : "submitted",
      submittedAt: new Date().toISOString(),
    };

    if (options.waitForConfirmation) {
      await this.delay(this.config.confirmationDelayMs);
      result.confirmedAt = new Date().toISOString();
      result.blockNumber = this.getCurrentBlockNumber();
      result.blockHash = this.generateMockBlockHash();
      result.gasUsed = (BigInt(tx.gasLimit) * 80n / 100n).toString();
      result.effectiveGasPrice = tx.maxFeePerGas;
    }

    this.submittedTxs.set(txHash, result);
    
    mockLogger.info({
      txHash,
      route,
      nonce,
      correlationId: options.correlationId,
    }, "Mock transaction submitted successfully");

    return result;
  }

  private createFailureResult(
    options: SubmissionOptions,
    route: SubmissionRoute,
    errorMessage: string
  ): SubmissionResult {
    return {
      success: false,
      route,
      providerName: this.name,
      status: "failed",
      errorCode: "MOCK_FAILURE",
      errorMessage,
      submittedAt: new Date().toISOString(),
    };
  }

  private async getAndIncrementNonce(address: string): Promise<number> {
    const normalized = address.toLowerCase();
    const nonce = await this.getNonce(normalized);
    this.nonces.set(normalized, nonce + 1);
    return nonce;
  }

  private generateMockTxHash(tx: TransactionRequest, nonce: number): string {
    const data = `${tx.from}${tx.to}${tx.value}${nonce}${Date.now()}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data.charCodeAt(i);
      hash = hash & hash;
    }
    return `0x${Math.abs(hash).toString(16).padStart(64, "0")}`;
  }

  private generateMockBlockHash(): string {
    return `0x${crypto.randomUUID().replace(/-/g, "").padEnd(64, "0")}`;
  }

  private getCurrentBlockNumber(): number {
    // Simulate block progression
    const now = Date.now();
    const elapsed = now - this.lastBlockTime;
    const newBlocks = Math.floor(elapsed / this.config.blockTimeMs);
    
    if (newBlocks > 0) {
      this.blockNumber += newBlocks;
      this.lastBlockTime = now;
    }
    
    return this.blockNumber;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Factory function
 */
export function createMockProvider(
  config?: Partial<MockProviderConfig>
): MockSubmissionProvider {
  return new MockSubmissionProvider(config);
}

// ============================================
// MOCK SCENARIOS
// ============================================

export const MOCK_SCENARIOS = {
  HEALTHY: {
    simulatePublicOffline: false,
    simulatePrivateOffline: false,
    simulateDeferredOffline: false,
    publicRpcFailureRate: 0,
    privateRelayFailureRate: 0,
  },
  
  PRIVATE_OFFLINE: {
    simulatePublicOffline: false,
    simulatePrivateOffline: true,
    simulateDeferredOffline: false,
  },
  
  ALL_PRIVATE_OFFLINE: {
    simulatePublicOffline: false,
    simulatePrivateOffline: true,
    simulateDeferredOffline: true,
  },
  
  FLAKY_RPC: {
    publicRpcFailureRate: 0.3,
    privateRelayFailureRate: 0.1,
  },
  
  HIGH_LATENCY: {
    publicRpcDelayMs: 2000,
    privateRelayDelayMs: 3000,
    confirmationDelayMs: 5000,
  },
};
