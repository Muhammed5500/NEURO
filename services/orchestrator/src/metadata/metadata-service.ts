/**
 * Metadata Service
 * 
 * Orchestrates the complete metadata pipeline:
 * - Metadata building with integrity
 * - IPFS pinning with multi-provider
 * - Milestone-based updates
 * - Version history with diffs
 * - Rate limiting and audit logging
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as crypto from "crypto";
import type {
  TokenMetadata,
  MetadataVersion,
  MetadataHistory,
  MilestoneEvent,
  MilestoneEventType,
  RateLimitConfig,
  RateLimitResult,
  MetadataAuditEntry,
  MultiPinResult,
  JsonPatchOperation,
} from "./types.js";
import {
  DEFAULT_RATE_LIMIT_CONFIG,
  RateLimitExceededError,
} from "./types.js";
import {
  MetadataBuilder,
  createMetadataBuilder,
  type TokenInfo,
} from "./metadata-builder.js";
import {
  type IpfsPinProvider,
  MultiPinProvider,
  createMultiPinProvider,
  createProvidersFromEnv,
} from "./ipfs-provider.js";
import {
  MilestoneTracker,
  createMilestoneTracker,
  type OnChainSnapshot,
} from "./milestone-trigger.js";
import {
  VersionHistoryManager,
  createVersionHistoryManager,
  generateJsonPatch,
} from "./version-history.js";

const serviceLogger = logger.child({ component: "metadata-service" });

// ============================================
// RATE LIMITER
// ============================================

interface RateLimitState {
  hourlyUpdates: Array<{ timestamp: number }>;
  dailyUpdates: Array<{ timestamp: number }>;
  lastUpdate: number;
}

class RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly tokenStates: Map<string, RateLimitState> = new Map();
  private globalUpdatesThisMinute: Array<{ timestamp: number }> = [];

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_RATE_LIMIT_CONFIG, ...config };
  }

  private getKey(tokenAddress: string, chainId: number): string {
    return `${chainId}:${tokenAddress.toLowerCase()}`;
  }

  private getOrCreateState(tokenAddress: string, chainId: number): RateLimitState {
    const key = this.getKey(tokenAddress, chainId);
    let state = this.tokenStates.get(key);
    
    if (!state) {
      state = {
        hourlyUpdates: [],
        dailyUpdates: [],
        lastUpdate: 0,
      };
      this.tokenStates.set(key, state);
    }

    return state;
  }

  private cleanupOldRecords(): void {
    const now = Date.now();
    const hourAgo = now - 3600000;
    const dayAgo = now - 86400000;
    const minuteAgo = now - 60000;

    // Clean global
    this.globalUpdatesThisMinute = this.globalUpdatesThisMinute.filter(
      u => u.timestamp > minuteAgo
    );

    // Clean per-token
    for (const state of this.tokenStates.values()) {
      state.hourlyUpdates = state.hourlyUpdates.filter(u => u.timestamp > hourAgo);
      state.dailyUpdates = state.dailyUpdates.filter(u => u.timestamp > dayAgo);
    }
  }

  /**
   * Check if update is allowed
   */
  checkLimit(tokenAddress: string, chainId: number): RateLimitResult {
    this.cleanupOldRecords();
    const state = this.getOrCreateState(tokenAddress, chainId);
    const now = Date.now();

    // Check cooldown
    const timeSinceLastUpdate = (now - state.lastUpdate) / 1000;
    if (timeSinceLastUpdate < this.config.minSecondsBetweenUpdates) {
      return {
        allowed: false,
        reason: `Cooldown: ${Math.ceil(this.config.minSecondsBetweenUpdates - timeSinceLastUpdate)}s remaining`,
        updatesThisHour: state.hourlyUpdates.length,
        updatesThisDay: state.dailyUpdates.length,
        retryAfterSeconds: Math.ceil(this.config.minSecondsBetweenUpdates - timeSinceLastUpdate),
      };
    }

    // Check hourly limit
    if (state.hourlyUpdates.length >= this.config.maxUpdatesPerHour) {
      const oldestHourly = state.hourlyUpdates[0];
      const retryAfter = Math.ceil((oldestHourly.timestamp + 3600000 - now) / 1000);
      return {
        allowed: false,
        reason: `Hourly limit reached (${this.config.maxUpdatesPerHour}/hour)`,
        updatesThisHour: state.hourlyUpdates.length,
        updatesThisDay: state.dailyUpdates.length,
        retryAfterSeconds: retryAfter,
      };
    }

    // Check daily limit
    if (state.dailyUpdates.length >= this.config.maxUpdatesPerDay) {
      const oldestDaily = state.dailyUpdates[0];
      const retryAfter = Math.ceil((oldestDaily.timestamp + 86400000 - now) / 1000);
      return {
        allowed: false,
        reason: `Daily limit reached (${this.config.maxUpdatesPerDay}/day)`,
        updatesThisHour: state.hourlyUpdates.length,
        updatesThisDay: state.dailyUpdates.length,
        retryAfterSeconds: retryAfter,
      };
    }

    // Check global limit
    if (this.globalUpdatesThisMinute.length >= this.config.globalMaxUpdatesPerMinute) {
      return {
        allowed: false,
        reason: `Global rate limit reached (${this.config.globalMaxUpdatesPerMinute}/min)`,
        updatesThisHour: state.hourlyUpdates.length,
        updatesThisDay: state.dailyUpdates.length,
        retryAfterSeconds: 60,
      };
    }

    return {
      allowed: true,
      updatesThisHour: state.hourlyUpdates.length,
      updatesThisDay: state.dailyUpdates.length,
    };
  }

  /**
   * Record an update
   */
  recordUpdate(tokenAddress: string, chainId: number): void {
    const state = this.getOrCreateState(tokenAddress, chainId);
    const now = Date.now();

    state.hourlyUpdates.push({ timestamp: now });
    state.dailyUpdates.push({ timestamp: now });
    state.lastUpdate = now;

    this.globalUpdatesThisMinute.push({ timestamp: now });
  }
}

// ============================================
// AUDIT LOGGER
// ============================================

class MetadataAuditLogger {
  private readonly entries: MetadataAuditEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 10000) {
    this.maxEntries = maxEntries;
  }

  /**
   * Log an audit entry
   */
  log(entry: MetadataAuditEntry): void {
    this.entries.push(entry);

    // Trim if too many
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    serviceLogger.info({
      tokenAddress: entry.tokenAddress,
      fromVersion: entry.fromVersion,
      toVersion: entry.toVersion,
      triggeredBy: entry.triggeredBy,
      changedFields: entry.changedFields,
      durationMs: entry.durationMs,
    }, "Metadata update audited");
  }

  /**
   * Get audit entries for a token
   */
  getForToken(tokenAddress: string, chainId: number): MetadataAuditEntry[] {
    return this.entries.filter(
      e => e.tokenAddress.toLowerCase() === tokenAddress.toLowerCase() &&
           e.chainId === chainId
    );
  }

  /**
   * Get recent entries
   */
  getRecent(limit = 100): MetadataAuditEntry[] {
    return this.entries.slice(-limit);
  }

  /**
   * Export audit log
   */
  export(): string {
    return JSON.stringify(this.entries, null, 2);
  }
}

// ============================================
// METADATA SERVICE
// ============================================

export interface MetadataServiceConfig {
  chainId: number;
  rateLimitConfig?: Partial<RateLimitConfig>;
  enforceRateLimits: boolean;
}

const DEFAULT_SERVICE_CONFIG: MetadataServiceConfig = {
  chainId: 143, // Monad
  enforceRateLimits: true,
};

export class MetadataService {
  private readonly config: MetadataServiceConfig;
  private readonly builder: MetadataBuilder;
  private readonly pinProvider: IpfsPinProvider;
  private readonly milestoneTracker: MilestoneTracker;
  private readonly versionHistory: VersionHistoryManager;
  private readonly rateLimiter: RateLimiter;
  private readonly auditLogger: MetadataAuditLogger;

  // In-memory metadata cache
  private readonly metadataCache: Map<string, TokenMetadata> = new Map();

  constructor(
    config?: Partial<MetadataServiceConfig>,
    providers?: IpfsPinProvider[]
  ) {
    this.config = { ...DEFAULT_SERVICE_CONFIG, ...config };

    this.builder = createMetadataBuilder({ chainId: this.config.chainId });
    
    // Create multi-provider
    const ipfsProviders = providers || createProvidersFromEnv();
    this.pinProvider = ipfsProviders.length > 1
      ? createMultiPinProvider(ipfsProviders, { minSuccessCount: 1 })
      : ipfsProviders[0];

    this.milestoneTracker = createMilestoneTracker();
    this.versionHistory = createVersionHistoryManager();
    this.rateLimiter = new RateLimiter(this.config.rateLimitConfig);
    this.auditLogger = new MetadataAuditLogger();

    serviceLogger.info({
      chainId: this.config.chainId,
      providerName: this.pinProvider.name,
      enforceRateLimits: this.config.enforceRateLimits,
    }, "MetadataService initialized");
  }

  /**
   * Create and pin initial metadata
   */
  async createMetadata(tokenInfo: TokenInfo): Promise<{
    metadata: TokenMetadata;
    cid: string;
    version: MetadataVersion;
    pinResult: MultiPinResult | { success: boolean; cid: string };
  }> {
    const startTime = Date.now();

    // Check rate limit
    const rateLimitCheck = this.rateLimiter.checkLimit(
      tokenInfo.address,
      this.config.chainId
    );

    if (this.config.enforceRateLimits && !rateLimitCheck.allowed) {
      throw new RateLimitExceededError(
        rateLimitCheck.reason!,
        tokenInfo.address,
        rateLimitCheck.retryAfterSeconds!
      );
    }

    // Build metadata
    const metadata = this.builder.build(tokenInfo);

    // Pin to IPFS
    // Turkish: "birden fazla pinning servisini destekleyen"
    const pinResult = this.pinProvider instanceof MultiPinProvider
      ? await (this.pinProvider as MultiPinProvider).pinToAll(metadata, `${tokenInfo.symbol}-metadata-v1`)
      : await this.pinProvider.pinJson(metadata, `${tokenInfo.symbol}-metadata-v1`);

    const cid = "cid" in pinResult ? pinResult.cid : (pinResult as any).cid;

    if (!cid) {
      throw new Error("Failed to pin metadata to IPFS");
    }

    // Create version record
    const pinResults = "results" in pinResult ? pinResult.results : [pinResult as any];
    const version = this.versionHistory.createInitialVersion(metadata, cid, pinResults);

    // Cache metadata
    this.cacheMetadata(tokenInfo.address, metadata);

    // Record rate limit
    this.rateLimiter.recordUpdate(tokenInfo.address, this.config.chainId);

    // Audit log
    const auditEntry: MetadataAuditEntry = {
      id: crypto.randomUUID(),
      tokenAddress: tokenInfo.address,
      chainId: this.config.chainId,
      fromVersion: 0,
      toVersion: 1,
      toCid: cid,
      diff: [],
      changedFields: ["*"],
      triggeredBy: "manual_request",
      rateLimitCheck,
      requestedAt: startTime,
      completedAt: Date.now(),
      durationMs: Date.now() - startTime,
      pinResults,
    };
    this.auditLogger.log(auditEntry);

    serviceLogger.info({
      tokenAddress: tokenInfo.address,
      cid,
      version: 1,
    }, "Initial metadata created and pinned");

    return { metadata, cid, version, pinResult };
  }

  /**
   * Process on-chain snapshot for milestone triggers
   * Turkish: "on-chain olaylara bağla"
   */
  async processOnChainSnapshot(
    snapshot: OnChainSnapshot
  ): Promise<Array<{
    event: MilestoneEvent;
    metadata: TokenMetadata;
    cid: string;
    version: MetadataVersion;
  }>> {
    const results: Array<{
      event: MilestoneEvent;
      metadata: TokenMetadata;
      cid: string;
      version: MetadataVersion;
    }> = [];

    // Check for milestone events
    const events = this.milestoneTracker.checkMilestones(snapshot);

    for (const event of events) {
      try {
        const result = await this.processMilestoneEvent(event);
        if (result) {
          results.push({ event, ...result });
        }
      } catch (error) {
        serviceLogger.warn({
          event: event.type,
          tokenAddress: snapshot.tokenAddress,
          error,
        }, "Failed to process milestone event");
      }
    }

    return results;
  }

  /**
   * Process a single milestone event
   */
  async processMilestoneEvent(
    event: MilestoneEvent
  ): Promise<{
    metadata: TokenMetadata;
    cid: string;
    version: MetadataVersion;
  } | null> {
    const startTime = Date.now();

    // Check rate limit
    const rateLimitCheck = this.rateLimiter.checkLimit(
      event.tokenAddress,
      event.chainId
    );

    if (this.config.enforceRateLimits && !rateLimitCheck.allowed) {
      serviceLogger.warn({
        tokenAddress: event.tokenAddress,
        reason: rateLimitCheck.reason,
      }, "Milestone event skipped due to rate limit");
      return null;
    }

    // Get current metadata
    const currentMetadata = this.getCachedMetadata(event.tokenAddress);
    if (!currentMetadata) {
      serviceLogger.warn({
        tokenAddress: event.tokenAddress,
      }, "No cached metadata for milestone event");
      return null;
    }

    // Get milestone config
    const config = this.milestoneTracker.getConfig(event.type, event.threshold);
    if (!config) {
      return null;
    }

    // Build updates
    const updates: Parameters<typeof this.builder.applyMilestoneUpdate>[2] = {};

    // Update description if needed
    if (event.updateFields.includes("description")) {
      updates.description = this.milestoneTracker.generateDescription(
        config,
        event,
        currentMetadata
      );
    }

    // Update external_url for graduation
    // Turkish: "Tokenın mezun olması -> external_url eklenmesi"
    if (event.type === "token_graduated" && event.updateFields.includes("external_url")) {
      updates.external_url = `https://neuro.ai/token/${event.tokenAddress}`;
      updates.status = "graduated";
    }

    // Apply updates
    const newMetadata = this.builder.applyMilestoneUpdate(
      currentMetadata,
      event,
      updates
    );

    // Pin new version
    const pinResult = this.pinProvider instanceof MultiPinProvider
      ? await (this.pinProvider as MultiPinProvider).pinToAll(
          newMetadata,
          `${currentMetadata.symbol}-metadata-v${newMetadata.version}`
        )
      : await this.pinProvider.pinJson(
          newMetadata,
          `${currentMetadata.symbol}-metadata-v${newMetadata.version}`
        );

    const cid = "cid" in pinResult ? pinResult.cid : (pinResult as any).cid;

    if (!cid) {
      throw new Error("Failed to pin updated metadata to IPFS");
    }

    // Update previousCid
    const history = this.versionHistory.getHistory(event.tokenAddress, event.chainId);
    if (history) {
      newMetadata.previousCid = history.currentCid;
    }

    // Add version to history
    // Turkish: "eski versiyon ile yeni versiyon arasındaki farkı sakla"
    const pinResults = "results" in pinResult ? pinResult.results : [pinResult as any];
    const version = this.versionHistory.addVersion(
      currentMetadata,
      newMetadata,
      cid,
      event,
      pinResults
    );

    // Update cache
    this.cacheMetadata(event.tokenAddress, newMetadata);

    // Record rate limit
    this.rateLimiter.recordUpdate(event.tokenAddress, event.chainId);

    // Audit log
    const diff = generateJsonPatch(currentMetadata, newMetadata);
    const auditEntry: MetadataAuditEntry = {
      id: crypto.randomUUID(),
      tokenAddress: event.tokenAddress,
      chainId: event.chainId,
      fromVersion: currentMetadata.version,
      toVersion: newMetadata.version,
      fromCid: history?.currentCid,
      toCid: cid,
      diff,
      changedFields: this.versionHistory.getChangedFields(diff),
      triggeredBy: event.type,
      milestoneEvent: event,
      rateLimitCheck,
      requestedAt: startTime,
      completedAt: Date.now(),
      durationMs: Date.now() - startTime,
      pinResults,
    };
    this.auditLogger.log(auditEntry);

    serviceLogger.info({
      tokenAddress: event.tokenAddress,
      event: event.type,
      newVersion: newMetadata.version,
      cid,
      changedFields: auditEntry.changedFields,
    }, "Metadata updated for milestone");

    return { metadata: newMetadata, cid, version };
  }

  /**
   * Get version history summary for dashboard
   * Turkish: "'NEURO neyi değiştirdi?' sorusuna net cevap"
   */
  getVersionSummary(tokenAddress: string, chainId?: number) {
    return this.versionHistory.getHistorySummary(
      tokenAddress,
      chainId || this.config.chainId
    );
  }

  /**
   * Get diff between versions for UI display
   */
  getVersionDiff(
    tokenAddress: string,
    fromVersion: number,
    toVersion: number,
    chainId?: number
  ): {
    diff: JsonPatchOperation[];
    formatted: ReturnType<typeof this.versionHistory.formatDiffForDisplay>;
  } {
    const diff = this.versionHistory.getDiffBetweenVersions(
      tokenAddress,
      chainId || this.config.chainId,
      fromVersion,
      toVersion
    );

    return {
      diff,
      formatted: this.versionHistory.formatDiffForDisplay(diff),
    };
  }

  /**
   * Get audit log for token
   */
  getAuditLog(tokenAddress: string, chainId?: number): MetadataAuditEntry[] {
    return this.auditLogger.getForToken(tokenAddress, chainId || this.config.chainId);
  }

  /**
   * Check rate limit status
   */
  checkRateLimit(tokenAddress: string, chainId?: number): RateLimitResult {
    return this.rateLimiter.checkLimit(tokenAddress, chainId || this.config.chainId);
  }

  /**
   * Get gateway URL for CID
   */
  getGatewayUrl(cid: string): string {
    return this.pinProvider.getGatewayUrl(cid);
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private cacheMetadata(tokenAddress: string, metadata: TokenMetadata): void {
    const key = `${this.config.chainId}:${tokenAddress.toLowerCase()}`;
    this.metadataCache.set(key, metadata);
  }

  private getCachedMetadata(tokenAddress: string): TokenMetadata | undefined {
    const key = `${this.config.chainId}:${tokenAddress.toLowerCase()}`;
    return this.metadataCache.get(key);
  }
}

/**
 * Factory function
 */
export function createMetadataService(
  config?: Partial<MetadataServiceConfig>,
  providers?: IpfsPinProvider[]
): MetadataService {
  return new MetadataService(config, providers);
}
