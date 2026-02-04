/**
 * Session Key Manager
 * 
 * Manages session keys with:
 * - Budget caps
 * - Expiry timestamps
 * - Allowed method selectors
 * - Nonce + replay protection
 * - Target address allowlist
 * - Spending velocity limits
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as crypto from "crypto";
import type {
  SessionKeyConfig,
  CreateSessionOptions,
  SessionValidationResult,
  SessionValidationError,
  ContractVerificationHook,
} from "./types.js";
import {
  DEFAULT_TARGET_ALLOWLIST,
  ALLOWED_METHOD_SELECTORS,
  SessionError,
  AllowlistError,
} from "./types.js";
import { EncryptedSessionStorage, createEncryptedStorage } from "./encrypted-storage.js";
import { VelocityTracker, createVelocityTracker } from "./velocity-tracker.js";
import { KillSwitch, getGlobalKillSwitch } from "./kill-switch.js";

const managerLogger = logger.child({ component: "session-manager" });

// ============================================
// SESSION MANAGER CONFIGURATION
// ============================================

export interface SessionManagerConfig {
  // Encryption
  masterKeyHex?: string;
  
  // Default limits
  defaultBudgetMon: number;
  defaultVelocityLimitMonPerMinute: number;
  defaultExpiryDurationMs: number;
  
  // Allowlist
  // Turkish: "Sadece nad.fun ve Monad Token kontrat adreslerine izin veren"
  targetAddressAllowlist: Record<string, string>;
  strictAllowlist: boolean; // If true, reject any address not in allowlist
  
  // Nonce
  maxNonceGap: number; // Maximum gap between used nonces
  
  // Kill switch
  killSwitch?: KillSwitch;
}

const DEFAULT_CONFIG: SessionManagerConfig = {
  defaultBudgetMon: 1.0,
  defaultVelocityLimitMonPerMinute: 0.5,
  defaultExpiryDurationMs: 3600000, // 1 hour
  targetAddressAllowlist: DEFAULT_TARGET_ALLOWLIST,
  strictAllowlist: true, // Turkish requirement: strict mode
  maxNonceGap: 100,
};

// ============================================
// SESSION MANAGER
// ============================================

export class SessionManager {
  private readonly config: SessionManagerConfig;
  private readonly storage: EncryptedSessionStorage;
  private readonly velocityTracker: VelocityTracker;
  private readonly killSwitch: KillSwitch;
  
  // Normalized allowlist for fast lookup
  private readonly allowlistSet: Set<string>;

  constructor(config?: Partial<SessionManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.storage = createEncryptedStorage(this.config.masterKeyHex);
    this.velocityTracker = createVelocityTracker();
    this.killSwitch = this.config.killSwitch || getGlobalKillSwitch();
    
    // Build allowlist set (normalized to lowercase)
    this.allowlistSet = new Set(
      Object.values(this.config.targetAddressAllowlist).map(a => a.toLowerCase())
    );

    // Wire up kill switch callbacks
    this.killSwitch.setCallbacks({
      clearSessions: () => this.revokeAllSessions("kill_switch"),
    });

    managerLogger.info({
      allowlistSize: this.allowlistSet.size,
      strictAllowlist: this.config.strictAllowlist,
      defaultBudgetMon: this.config.defaultBudgetMon,
    }, "SessionManager initialized");
  }

  /**
   * Create a new session key
   */
  async createSession(options: CreateSessionOptions): Promise<SessionKeyConfig> {
    // Check kill switch
    this.killSwitch.checkAllowed("create_session");

    const now = Date.now();
    const sessionId = crypto.randomUUID();
    
    // Generate key pair (simplified - in production would use proper key derivation)
    const keyPair = crypto.generateKeyPairSync("ec", {
      namedCurve: "secp256k1",
    });
    const publicKey = keyPair.publicKey.export({ format: "der", type: "spki" }).toString("hex");

    // Build allowed method selectors
    let allowedSelectors = options.allowedMethodSelectors || [];
    if (options.allowedMethods) {
      for (const method of options.allowedMethods) {
        const selectors = ALLOWED_METHOD_SELECTORS[method];
        if (selectors) {
          allowedSelectors.push(...selectors);
        }
      }
    }
    // Default to all allowed selectors if none specified
    if (allowedSelectors.length === 0) {
      allowedSelectors = Object.values(ALLOWED_METHOD_SELECTORS).flat();
    }

    // Build allowed target addresses
    let allowedAddresses = [...Object.values(this.config.targetAddressAllowlist)];
    if (options.additionalTargetAddresses) {
      // Validate additional addresses against allowlist if strict mode
      if (this.config.strictAllowlist) {
        for (const addr of options.additionalTargetAddresses) {
          if (!this.isAddressAllowed(addr)) {
            throw new AllowlistError(
              `Address ${addr} is not in the allowlist`,
              addr,
              allowedAddresses
            );
          }
        }
      }
      allowedAddresses.push(...options.additionalTargetAddresses);
    }

    // Calculate budget in Wei
    const budgetWei = BigInt(Math.floor(options.totalBudgetMon * 1e18)).toString();
    const velocityWei = BigInt(
      Math.floor(options.velocityLimitMonPerMinute * 1e18)
    ).toString();

    const session: SessionKeyConfig = {
      sessionId,
      publicKey,
      
      totalBudgetWei: budgetWei,
      totalBudgetMon: options.totalBudgetMon,
      spentWei: "0",
      spentMon: 0,
      
      velocityLimitWeiPerMinute: velocityWei,
      velocityLimitMonPerMinute: options.velocityLimitMonPerMinute,
      
      createdAt: now,
      expiresAt: now + options.expiryDurationMs,
      
      allowedMethodSelectors: [...new Set(allowedSelectors)],
      allowedTargetAddresses: [...new Set(allowedAddresses.map(a => a.toLowerCase()))],
      
      nonce: 0,
      usedNonces: [],
      
      isActive: true,
      isRevoked: false,
    };

    // Store encrypted
    this.storage.store(session);

    managerLogger.info({
      sessionId,
      budgetMon: options.totalBudgetMon,
      velocityLimit: options.velocityLimitMonPerMinute,
      expiresInMs: options.expiryDurationMs,
      allowedAddresses: allowedAddresses.length,
    }, "Session created");

    return session;
  }

  /**
   * Validate a session for a transaction
   */
  validateSession(
    sessionId: string,
    targetAddress: string,
    methodSelector: string,
    amountWei: string,
    amountMon: number,
    nonce: number
  ): SessionValidationResult {
    // Check kill switch first
    if (this.killSwitch.isActive()) {
      return {
        valid: false,
        error: "KILL_SWITCH_ACTIVE",
        errorMessage: "Kill switch is active, all executions disabled",
      };
    }

    // Get session
    const session = this.storage.retrieve(sessionId);
    if (!session) {
      return {
        valid: false,
        error: "SESSION_NOT_FOUND",
        errorMessage: `Session ${sessionId} not found`,
      };
    }

    // Check revoked
    if (session.isRevoked) {
      return {
        valid: false,
        error: "SESSION_REVOKED",
        errorMessage: `Session revoked at ${new Date(session.revokedAt!).toISOString()}: ${session.revokedReason}`,
      };
    }

    // Check expiry
    const now = Date.now();
    if (now >= session.expiresAt) {
      return {
        valid: false,
        error: "SESSION_EXPIRED",
        errorMessage: `Session expired at ${new Date(session.expiresAt).toISOString()}`,
        expiresInMs: 0,
      };
    }

    // Check nonce (replay protection)
    if (session.usedNonces.includes(nonce)) {
      return {
        valid: false,
        error: "NONCE_ALREADY_USED",
        errorMessage: `Nonce ${nonce} already used`,
      };
    }
    
    // Check nonce not too far ahead
    if (nonce > session.nonce + this.config.maxNonceGap) {
      return {
        valid: false,
        error: "NONCE_TOO_OLD",
        errorMessage: `Nonce ${nonce} too far ahead of current ${session.nonce}`,
      };
    }

    // Check method selector
    if (!session.allowedMethodSelectors.includes(methodSelector)) {
      return {
        valid: false,
        error: "METHOD_NOT_ALLOWED",
        errorMessage: `Method selector ${methodSelector} not allowed`,
      };
    }

    // Check target address
    // Turkish: "Ajan, bu adresler dışındaki hiçbir kontrata 1 kuruş bile gönderemesin"
    const normalizedTarget = targetAddress.toLowerCase();
    if (!session.allowedTargetAddresses.includes(normalizedTarget)) {
      return {
        valid: false,
        error: "TARGET_NOT_ALLOWED",
        errorMessage: `Target address ${targetAddress} not in allowlist`,
      };
    }

    // Check budget
    const spentBigInt = BigInt(session.spentWei);
    const amountBigInt = BigInt(amountWei);
    const totalBudgetBigInt = BigInt(session.totalBudgetWei);
    
    if (spentBigInt + amountBigInt > totalBudgetBigInt) {
      return {
        valid: false,
        error: "BUDGET_EXCEEDED",
        errorMessage: `Would exceed budget: spent ${session.spentMon} + ${amountMon} > ${session.totalBudgetMon}`,
        remainingBudgetMon: session.totalBudgetMon - session.spentMon,
      };
    }

    // Check velocity
    // Turkish: "dakika başına harcama limiti"
    const velocityCheck = this.velocityTracker.checkVelocity(
      sessionId,
      amountWei,
      amountMon,
      session.velocityLimitWeiPerMinute,
      session.velocityLimitMonPerMinute
    );

    if (!velocityCheck.allowed) {
      return {
        valid: false,
        error: "VELOCITY_EXCEEDED",
        errorMessage: `Velocity limit exceeded: ${velocityCheck.currentVelocityMon + amountMon} > ${velocityCheck.limitMon} MON/min`,
        velocityUsedMon: velocityCheck.currentVelocityMon,
        velocityRemainingMon: velocityCheck.remainingMon,
      };
    }

    // All checks passed
    return {
      valid: true,
      remainingBudgetMon: session.totalBudgetMon - session.spentMon - amountMon,
      velocityUsedMon: velocityCheck.currentVelocityMon,
      velocityRemainingMon: velocityCheck.remainingMon - amountMon,
      expiresInMs: session.expiresAt - now,
    };
  }

  /**
   * Record spending and update session
   */
  recordSpending(
    sessionId: string,
    amountWei: string,
    amountMon: number,
    nonce: number,
    targetAddress: string,
    methodSelector: string,
    txHash?: string
  ): void {
    // Check kill switch
    this.killSwitch.checkAllowed("record_spending");

    const session = this.storage.retrieve(sessionId);
    if (!session) {
      throw new SessionError("Session not found", "SESSION_NOT_FOUND", sessionId);
    }

    // Update spent amounts
    const newSpentWei = (BigInt(session.spentWei) + BigInt(amountWei)).toString();
    const newSpentMon = session.spentMon + amountMon;

    // Record nonce as used
    session.usedNonces.push(nonce);
    if (nonce >= session.nonce) {
      session.nonce = nonce + 1;
    }

    // Update session
    session.spentWei = newSpentWei;
    session.spentMon = newSpentMon;

    // Store updated session
    this.storage.update(session);

    // Record in velocity tracker
    this.velocityTracker.recordSpending(
      sessionId,
      amountWei,
      amountMon,
      targetAddress,
      methodSelector,
      txHash
    );

    managerLogger.info({
      sessionId,
      amountMon,
      newSpentMon,
      remainingMon: session.totalBudgetMon - newSpentMon,
      nonce,
      txHash,
    }, "Spending recorded");
  }

  /**
   * Revoke a session
   */
  revokeSession(sessionId: string, reason: string): void {
    const session = this.storage.retrieve(sessionId);
    if (!session) {
      throw new SessionError("Session not found", "SESSION_NOT_FOUND", sessionId);
    }

    session.isRevoked = true;
    session.revokedAt = Date.now();
    session.revokedReason = reason;
    session.isActive = false;

    this.storage.update(session);
    
    // Clear velocity records
    this.velocityTracker.clearSession(sessionId);

    managerLogger.info({
      sessionId,
      reason,
    }, "Session revoked");
  }

  /**
   * Revoke all sessions (for kill switch)
   * Turkish: "emergency revoke sessions"
   */
  revokeAllSessions(reason: string): number {
    const sessionIds = this.storage.getSessionIds();
    let count = 0;

    for (const sessionId of sessionIds) {
      try {
        this.revokeSession(sessionId, reason);
        count++;
      } catch (error) {
        managerLogger.warn({ sessionId, error }, "Failed to revoke session");
      }
    }

    // Clear all from storage
    this.storage.clearAll();
    
    // Clear velocity tracker
    this.velocityTracker.clearAll();

    managerLogger.warn({ count, reason }, "All sessions revoked");
    return count;
  }

  /**
   * Rotate session key (create new, revoke old)
   */
  async rotateSession(
    oldSessionId: string,
    options?: Partial<CreateSessionOptions>
  ): Promise<SessionKeyConfig> {
    const oldSession = this.storage.retrieve(oldSessionId);
    if (!oldSession) {
      throw new SessionError("Session not found", "SESSION_NOT_FOUND", oldSessionId);
    }

    // Create new session with remaining budget
    const remainingBudget = oldSession.totalBudgetMon - oldSession.spentMon;
    const remainingTime = oldSession.expiresAt - Date.now();

    const newSession = await this.createSession({
      totalBudgetMon: options?.totalBudgetMon ?? remainingBudget,
      velocityLimitMonPerMinute: options?.velocityLimitMonPerMinute ?? oldSession.velocityLimitMonPerMinute,
      expiryDurationMs: options?.expiryDurationMs ?? remainingTime,
      allowedMethodSelectors: oldSession.allowedMethodSelectors,
      additionalTargetAddresses: oldSession.allowedTargetAddresses,
    });

    // Revoke old session
    this.revokeSession(oldSessionId, "Key rotation");

    managerLogger.info({
      oldSessionId,
      newSessionId: newSession.sessionId,
      remainingBudget,
    }, "Session rotated");

    return newSession;
  }

  /**
   * Get session info (without private key)
   */
  getSession(sessionId: string): SessionKeyConfig | null {
    return this.storage.retrieve(sessionId);
  }

  /**
   * List all active sessions
   */
  listActiveSessions(): SessionKeyConfig[] {
    const sessions: SessionKeyConfig[] = [];
    const now = Date.now();

    for (const sessionId of this.storage.getSessionIds()) {
      const session = this.storage.retrieve(sessionId);
      if (session && session.isActive && !session.isRevoked && session.expiresAt > now) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  /**
   * Check if an address is in the allowlist
   * Turkish: "target_address_allowlist"
   */
  isAddressAllowed(address: string): boolean {
    return this.allowlistSet.has(address.toLowerCase());
  }

  /**
   * Add address to allowlist (runtime only)
   */
  addToAllowlist(name: string, address: string): void {
    this.config.targetAddressAllowlist[name] = address;
    this.allowlistSet.add(address.toLowerCase());
    managerLogger.info({ name, address }, "Address added to allowlist");
  }

  /**
   * Generate contract verification hook
   */
  generateVerificationHook(
    sessionId: string,
    targetAddress: string,
    methodSelector: string,
    value: string,
    nonce: number,
    signature: string
  ): ContractVerificationHook {
    const session = this.storage.retrieve(sessionId);
    if (!session) {
      throw new SessionError("Session not found", "SESSION_NOT_FOUND", sessionId);
    }

    return {
      sessionId,
      publicKey: session.publicKey,
      signature,
      nonce,
      targetAddress,
      methodSelector,
      value,
      budgetProof: {
        totalBudget: session.totalBudgetWei,
        spent: session.spentWei,
        remaining: (BigInt(session.totalBudgetWei) - BigInt(session.spentWei)).toString(),
      },
      timestamp: Date.now(),
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Shutdown and clear all memory
   * Turkish: "clear_memory ile temizlenmelidir"
   */
  shutdown(): void {
    this.storage.shutdown();
    this.velocityTracker.shutdown();
    managerLogger.info("SessionManager shutdown and memory cleared");
  }
}

/**
 * Factory function
 */
export function createSessionManager(
  config?: Partial<SessionManagerConfig>
): SessionManager {
  return new SessionManager(config);
}
