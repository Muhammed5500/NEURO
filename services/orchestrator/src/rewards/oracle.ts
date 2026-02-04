/**
 * Oracle Interface and Implementations
 * 
 * Provides verification oracles for reward actions:
 * - Mock oracle for development
 * - Production interface (no vendor lock)
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as crypto from "crypto";
import type {
  EligibleActionType,
  ProofOfAction,
} from "./types.js";

const oracleLogger = logger.child({ component: "reward-oracle" });

// ============================================
// ORACLE INTERFACE
// ============================================

/**
 * Verification request
 */
export interface VerificationRequest {
  actionType: EligibleActionType;
  userId: string;
  address: string;
  
  // Evidence
  evidenceType: ProofOfAction["evidenceType"];
  evidenceUrl?: string;
  evidenceData?: unknown;
  
  // Context
  context?: Record<string, unknown>;
  
  // Request metadata
  requestId: string;
  timestamp: number;
}

/**
 * Verification response
 */
export interface VerificationResponse {
  requestId: string;
  
  // Result
  verified: boolean;
  confidence: number; // 0-1
  
  // Details
  reason: string;
  details?: Record<string, unknown>;
  
  // Evidence hash
  // Turkish: "SHA-256 özetini içermeli"
  evidenceHash: string;
  
  // Timing
  verifiedAt: number;
  responseTimeMs: number;
}

/**
 * Oracle capabilities
 */
export interface OracleCapabilities {
  supportsActionTypes: EligibleActionType[];
  supportsEvidenceTypes: ProofOfAction["evidenceType"][];
  maxRequestsPerMinute: number;
  averageResponseTimeMs: number;
}

/**
 * Oracle interface - no vendor lock
 */
export interface RewardOracle {
  readonly name: string;
  readonly capabilities: OracleCapabilities;
  
  /**
   * Verify an action
   */
  verify(request: VerificationRequest): Promise<VerificationResponse>;
  
  /**
   * Batch verification
   */
  verifyBatch(requests: VerificationRequest[]): Promise<VerificationResponse[]>;
  
  /**
   * Health check
   */
  healthCheck(): Promise<boolean>;
}

// ============================================
// MOCK ORACLE (Development)
// ============================================

export interface MockOracleConfig {
  simulatedDelayMs: number;
  defaultVerificationRate: number; // 0-1, chance of verification success
  actionVerificationRates?: Partial<Record<EligibleActionType, number>>;
}

const DEFAULT_MOCK_CONFIG: MockOracleConfig = {
  simulatedDelayMs: 100,
  defaultVerificationRate: 0.95,
};

export class MockRewardOracle implements RewardOracle {
  readonly name = "mock";
  readonly capabilities: OracleCapabilities = {
    supportsActionTypes: [
      "signal_submission",
      "signal_verification",
      "early_detection",
      "accurate_prediction",
      "liquidity_provision",
      "community_contribution",
      "bug_report",
      "data_contribution",
      "referral",
    ],
    supportsEvidenceTypes: ["tweet_url", "tx_hash", "ipfs_cid", "api_response", "other"],
    maxRequestsPerMinute: 1000,
    averageResponseTimeMs: 100,
  };

  private readonly config: MockOracleConfig;
  private verificationHistory: Map<string, VerificationResponse> = new Map();

  constructor(config?: Partial<MockOracleConfig>) {
    this.config = { ...DEFAULT_MOCK_CONFIG, ...config };

    oracleLogger.info({
      oracle: this.name,
      defaultVerificationRate: this.config.defaultVerificationRate,
    }, "MockRewardOracle initialized");
  }

  async verify(request: VerificationRequest): Promise<VerificationResponse> {
    const startTime = Date.now();

    // Simulate network delay
    await new Promise(r => setTimeout(r, this.config.simulatedDelayMs));

    // Compute evidence hash
    // Turkish: "SHA-256 özetini içermeli"
    const evidenceHash = this.computeEvidenceHash(request);

    // Determine verification rate for action type
    const verificationRate = this.config.actionVerificationRates?.[request.actionType] 
      ?? this.config.defaultVerificationRate;

    // Simulate verification result
    const verified = Math.random() < verificationRate;
    const confidence = verified 
      ? 0.8 + (Math.random() * 0.2) // 0.8-1.0 if verified
      : 0.1 + (Math.random() * 0.3); // 0.1-0.4 if not verified

    const response: VerificationResponse = {
      requestId: request.requestId,
      verified,
      confidence,
      reason: verified 
        ? `Action verified: ${request.actionType}` 
        : `Verification failed: insufficient evidence`,
      details: {
        actionType: request.actionType,
        evidenceType: request.evidenceType,
        mockOracle: true,
      },
      evidenceHash,
      verifiedAt: Date.now(),
      responseTimeMs: Date.now() - startTime,
    };

    // Store in history
    this.verificationHistory.set(request.requestId, response);

    oracleLogger.debug({
      requestId: request.requestId,
      actionType: request.actionType,
      verified,
      confidence,
    }, "Mock verification completed");

    return response;
  }

  async verifyBatch(requests: VerificationRequest[]): Promise<VerificationResponse[]> {
    return Promise.all(requests.map(r => this.verify(r)));
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  /**
   * Compute SHA-256 hash of evidence
   * Turkish: "o aksiyonu kanıtlayan bir verinin SHA-256 özetini"
   */
  private computeEvidenceHash(request: VerificationRequest): string {
    const evidence = JSON.stringify({
      actionType: request.actionType,
      userId: request.userId,
      evidenceUrl: request.evidenceUrl,
      evidenceData: request.evidenceData,
      timestamp: request.timestamp,
    });

    return crypto.createHash("sha256").update(evidence).digest("hex");
  }

  // Test helpers
  getVerificationHistory(): VerificationResponse[] {
    return Array.from(this.verificationHistory.values());
  }

  setVerificationRate(actionType: EligibleActionType, rate: number): void {
    if (!this.config.actionVerificationRates) {
      this.config.actionVerificationRates = {};
    }
    this.config.actionVerificationRates[actionType] = rate;
  }
}

// ============================================
// CHAINLINK ORACLE (Production Stub)
// ============================================

export interface ChainlinkOracleConfig {
  rpcUrl: string;
  contractAddress: string;
  privateKey?: string;
}

export class ChainlinkRewardOracle implements RewardOracle {
  readonly name = "chainlink";
  readonly capabilities: OracleCapabilities = {
    supportsActionTypes: [
      "accurate_prediction",
      "liquidity_provision",
    ],
    supportsEvidenceTypes: ["tx_hash"],
    maxRequestsPerMinute: 30,
    averageResponseTimeMs: 5000,
  };

  private readonly config: ChainlinkOracleConfig;

  constructor(config: ChainlinkOracleConfig) {
    this.config = config;

    oracleLogger.info({
      oracle: this.name,
      contractAddress: config.contractAddress,
    }, "ChainlinkRewardOracle initialized (stub)");
  }

  async verify(request: VerificationRequest): Promise<VerificationResponse> {
    const startTime = Date.now();

    // Stub: In production, this would call Chainlink oracle contract
    // For now, return a placeholder response

    const evidenceHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(request))
      .digest("hex");

    return {
      requestId: request.requestId,
      verified: false,
      confidence: 0,
      reason: "Chainlink oracle not configured for production",
      evidenceHash,
      verifiedAt: Date.now(),
      responseTimeMs: Date.now() - startTime,
    };
  }

  async verifyBatch(requests: VerificationRequest[]): Promise<VerificationResponse[]> {
    return Promise.all(requests.map(r => this.verify(r)));
  }

  async healthCheck(): Promise<boolean> {
    // In production, would check contract connectivity
    return false;
  }
}

// ============================================
// API ORACLE (Production Stub)
// ============================================

export interface ApiOracleConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}

export class ApiRewardOracle implements RewardOracle {
  readonly name = "api";
  readonly capabilities: OracleCapabilities = {
    supportsActionTypes: [
      "signal_submission",
      "community_contribution",
      "bug_report",
    ],
    supportsEvidenceTypes: ["tweet_url", "api_response", "other"],
    maxRequestsPerMinute: 100,
    averageResponseTimeMs: 500,
  };

  private readonly config: ApiOracleConfig;

  constructor(config: ApiOracleConfig) {
    this.config = config;

    oracleLogger.info({
      oracle: this.name,
      baseUrl: config.baseUrl,
    }, "ApiRewardOracle initialized (stub)");
  }

  async verify(request: VerificationRequest): Promise<VerificationResponse> {
    const startTime = Date.now();

    // Stub: In production, this would call external API
    // For example, Twitter API to verify tweet existence

    const evidenceHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(request))
      .digest("hex");

    return {
      requestId: request.requestId,
      verified: false,
      confidence: 0,
      reason: "API oracle not configured for production",
      evidenceHash,
      verifiedAt: Date.now(),
      responseTimeMs: Date.now() - startTime,
    };
  }

  async verifyBatch(requests: VerificationRequest[]): Promise<VerificationResponse[]> {
    return Promise.all(requests.map(r => this.verify(r)));
  }

  async healthCheck(): Promise<boolean> {
    // In production, would ping API endpoint
    return false;
  }
}

// ============================================
// COMPOSITE ORACLE
// ============================================

/**
 * Composite oracle that routes to appropriate oracle based on action type
 */
export class CompositeRewardOracle implements RewardOracle {
  readonly name = "composite";
  readonly capabilities: OracleCapabilities;

  private readonly oracles: RewardOracle[];
  private readonly actionToOracle: Map<EligibleActionType, RewardOracle> = new Map();

  constructor(oracles: RewardOracle[]) {
    this.oracles = oracles;

    // Build routing map
    for (const oracle of oracles) {
      for (const actionType of oracle.capabilities.supportsActionTypes) {
        if (!this.actionToOracle.has(actionType)) {
          this.actionToOracle.set(actionType, oracle);
        }
      }
    }

    // Aggregate capabilities
    const allActionTypes = new Set<EligibleActionType>();
    const allEvidenceTypes = new Set<ProofOfAction["evidenceType"]>();
    let minRpm = Infinity;
    let maxResponseTime = 0;

    for (const oracle of oracles) {
      oracle.capabilities.supportsActionTypes.forEach(t => allActionTypes.add(t));
      oracle.capabilities.supportsEvidenceTypes.forEach(t => allEvidenceTypes.add(t));
      minRpm = Math.min(minRpm, oracle.capabilities.maxRequestsPerMinute);
      maxResponseTime = Math.max(maxResponseTime, oracle.capabilities.averageResponseTimeMs);
    }

    this.capabilities = {
      supportsActionTypes: Array.from(allActionTypes),
      supportsEvidenceTypes: Array.from(allEvidenceTypes),
      maxRequestsPerMinute: minRpm,
      averageResponseTimeMs: maxResponseTime,
    };

    oracleLogger.info({
      oracle: this.name,
      childOracles: oracles.map(o => o.name),
      supportedActions: this.capabilities.supportsActionTypes.length,
    }, "CompositeRewardOracle initialized");
  }

  async verify(request: VerificationRequest): Promise<VerificationResponse> {
    const oracle = this.actionToOracle.get(request.actionType);
    
    if (!oracle) {
      const evidenceHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(request))
        .digest("hex");

      return {
        requestId: request.requestId,
        verified: false,
        confidence: 0,
        reason: `No oracle available for action type: ${request.actionType}`,
        evidenceHash,
        verifiedAt: Date.now(),
        responseTimeMs: 0,
      };
    }

    return oracle.verify(request);
  }

  async verifyBatch(requests: VerificationRequest[]): Promise<VerificationResponse[]> {
    // Group by oracle
    const groups = new Map<RewardOracle, VerificationRequest[]>();

    for (const request of requests) {
      const oracle = this.actionToOracle.get(request.actionType) || this.oracles[0];
      const group = groups.get(oracle) || [];
      group.push(request);
      groups.set(oracle, group);
    }

    // Verify in parallel
    const results: VerificationResponse[] = [];
    const promises: Promise<void>[] = [];

    for (const [oracle, groupRequests] of groups) {
      promises.push(
        oracle.verifyBatch(groupRequests).then(responses => {
          results.push(...responses);
        })
      );
    }

    await Promise.all(promises);

    // Sort back to original order
    const requestIdOrder = new Map(requests.map((r, i) => [r.requestId, i]));
    results.sort((a, b) => 
      (requestIdOrder.get(a.requestId) ?? 0) - (requestIdOrder.get(b.requestId) ?? 0)
    );

    return results;
  }

  async healthCheck(): Promise<boolean> {
    const results = await Promise.all(this.oracles.map(o => o.healthCheck()));
    return results.some(r => r); // Healthy if at least one oracle is healthy
  }
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

export function createMockOracle(config?: Partial<MockOracleConfig>): MockRewardOracle {
  return new MockRewardOracle(config);
}

export function createChainlinkOracle(config: ChainlinkOracleConfig): ChainlinkRewardOracle {
  return new ChainlinkRewardOracle(config);
}

export function createApiOracle(config: ApiOracleConfig): ApiRewardOracle {
  return new ApiRewardOracle(config);
}

export function createCompositeOracle(oracles: RewardOracle[]): CompositeRewardOracle {
  return new CompositeRewardOracle(oracles);
}

/**
 * Create oracle from environment
 */
export function createOracleFromEnv(): RewardOracle {
  const useProduction = process.env.USE_PRODUCTION_ORACLE === "true";

  if (useProduction) {
    const oracles: RewardOracle[] = [];

    // Add Chainlink if configured
    if (process.env.CHAINLINK_RPC_URL && process.env.CHAINLINK_CONTRACT_ADDRESS) {
      oracles.push(createChainlinkOracle({
        rpcUrl: process.env.CHAINLINK_RPC_URL,
        contractAddress: process.env.CHAINLINK_CONTRACT_ADDRESS,
      }));
    }

    // Add API oracle if configured
    if (process.env.REWARD_API_URL && process.env.REWARD_API_KEY) {
      oracles.push(createApiOracle({
        baseUrl: process.env.REWARD_API_URL,
        apiKey: process.env.REWARD_API_KEY,
      }));
    }

    // Fall back to mock if no production oracles configured
    if (oracles.length === 0) {
      oracleLogger.warn("No production oracles configured, using mock");
      return createMockOracle();
    }

    return createCompositeOracle(oracles);
  }

  return createMockOracle();
}
