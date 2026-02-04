/**
 * Session Key Types
 * 
 * Types for session key management with:
 * - Budget caps
 * - Expiry timestamps
 * - Allowed method selectors
 * - Nonce + replay protection
 * - Target address allowlist
 * - Spending velocity limits
 */

import { z } from "zod";

// ============================================
// SESSION KEY CONFIGURATION
// ============================================

/**
 * Session key configuration schema
 */
export const sessionKeyConfigSchema = z.object({
  // Session identification
  sessionId: z.string().uuid(),
  publicKey: z.string(), // Hex encoded
  
  // Budget constraints
  // Turkish: "toplam bütçe"
  totalBudgetWei: z.string(),
  totalBudgetMon: z.number().min(0),
  spentWei: z.string().default("0"),
  spentMon: z.number().default(0),
  
  // Velocity limit (per minute)
  // Turkish: "dakika başına harcama limiti (velocity limit)"
  velocityLimitWeiPerMinute: z.string(),
  velocityLimitMonPerMinute: z.number().min(0),
  
  // Time constraints
  createdAt: z.number(), // Unix timestamp ms
  expiresAt: z.number(), // Unix timestamp ms
  
  // Method selectors (4-byte hex)
  allowedMethodSelectors: z.array(z.string()),
  
  // Target address allowlist
  // Turkish: "nad.fun ve Monad Token kontrat adreslerine izin veren target_address_allowlist"
  allowedTargetAddresses: z.array(z.string()),
  
  // Nonce for replay protection
  nonce: z.number().int().min(0),
  usedNonces: z.array(z.number()).default([]),
  
  // Status
  isActive: z.boolean().default(true),
  isRevoked: z.boolean().default(false),
  revokedAt: z.number().optional(),
  revokedReason: z.string().optional(),
});

export type SessionKeyConfig = z.infer<typeof sessionKeyConfigSchema>;

// ============================================
// SESSION CREATION OPTIONS
// ============================================

export interface CreateSessionOptions {
  // Budget
  totalBudgetMon: number;
  velocityLimitMonPerMinute: number;
  
  // Time
  expiryDurationMs: number;
  
  // Method restrictions
  allowedMethods?: string[]; // Human readable method names
  allowedMethodSelectors?: string[]; // 4-byte hex selectors
  
  // Target restrictions (defaults to allowlist)
  additionalTargetAddresses?: string[];
  
  // Metadata
  description?: string;
}

// ============================================
// SPENDING RECORD
// ============================================

/**
 * Record of spending for velocity tracking
 * Turkish: "dakika başına harcama limiti"
 */
export interface SpendingRecord {
  timestamp: number;
  amountWei: string;
  amountMon: number;
  txHash?: string;
  targetAddress: string;
  methodSelector: string;
}

// ============================================
// SESSION VALIDATION RESULT
// ============================================

export type SessionValidationError = 
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "BUDGET_EXCEEDED"
  | "VELOCITY_EXCEEDED"
  | "METHOD_NOT_ALLOWED"
  | "TARGET_NOT_ALLOWED"
  | "NONCE_ALREADY_USED"
  | "NONCE_TOO_OLD"
  | "INVALID_SIGNATURE"
  | "KILL_SWITCH_ACTIVE";

export interface SessionValidationResult {
  valid: boolean;
  error?: SessionValidationError;
  errorMessage?: string;
  
  // Budget info
  remainingBudgetMon?: number;
  velocityUsedMon?: number;
  velocityRemainingMon?: number;
  
  // Time info
  expiresInMs?: number;
}

// ============================================
// KILL SWITCH TYPES
// ============================================

/**
 * Turkish: "Kill switch tetiklendiğinde, sadece yeni işlemleri durdurmakla kalma;
 * ExecutionPlan içindeki bekleyen (queued) tüm işlemleri anında temizle."
 */
export interface KillSwitchState {
  isActive: boolean;
  activatedAt?: number;
  activatedBy?: string;
  reason?: string;
  
  // Cleared items
  clearedSessionCount: number;
  clearedQueuedPlansCount: number;
  
  // Reactivation
  canReactivate: boolean;
  reactivationRequiresMultisig: boolean;
}

// ============================================
// ENCRYPTED STORAGE TYPES
// ============================================

/**
 * Turkish: "Oturum anahtarları bellekte (RAM) şifreli olarak tutulmalı"
 */
export interface EncryptedSession {
  sessionId: string;
  encryptedData: string; // AES-256-GCM encrypted
  iv: string; // Initialization vector
  tag: string; // Auth tag
  createdAt: number;
}

// ============================================
// CONTRACT VERIFICATION TYPES
// ============================================

export interface ContractVerificationHook {
  // Session validation data for on-chain verification
  sessionId: string;
  publicKey: string;
  signature: string;
  nonce: number;
  
  // Transaction data
  targetAddress: string;
  methodSelector: string;
  value: string;
  
  // Proof data
  budgetProof: {
    totalBudget: string;
    spent: string;
    remaining: string;
  };
  
  // Timestamp
  timestamp: number;
  expiresAt: number;
}

// ============================================
// ALLOWLIST CONFIGURATION
// ============================================

/**
 * Hard-coded allowlist for target addresses
 * Turkish: "Sadece nad.fun ve Monad Token kontrat adreslerine izin veren"
 */
export const DEFAULT_TARGET_ALLOWLIST: Record<string, string> = {
  // nad.fun contracts
  NAD_FUN_FACTORY: "0x0000000000000000000000000000000000000001", // Placeholder
  NAD_FUN_ROUTER: "0x0000000000000000000000000000000000000002",
  NAD_FUN_POOL: "0x0000000000000000000000000000000000000003",
  
  // Monad token contracts
  WMON: "0x0000000000000000000000000000000000000010",
  
  // Add actual addresses when deployed
};

/**
 * Allowed method selectors by category
 */
export const ALLOWED_METHOD_SELECTORS: Record<string, string[]> = {
  // ERC20 methods
  ERC20: [
    "0x095ea7b3", // approve(address,uint256)
    "0xa9059cbb", // transfer(address,uint256)
  ],
  
  // nad.fun methods
  NAD_FUN: [
    "0x12345678", // createToken(...)
    "0x87654321", // addLiquidity(...)
    "0xaaaabbbb", // swapExactMONForTokens(...)
    "0xccccdddd", // swapExactTokensForMON(...)
  ],
};

// ============================================
// ERROR TYPES
// ============================================

export class SessionError extends Error {
  constructor(
    message: string,
    public readonly code: SessionValidationError,
    public readonly sessionId?: string
  ) {
    super(message);
    this.name = "SessionError";
  }
}

export class KillSwitchError extends Error {
  constructor(
    message: string,
    public readonly activatedAt: number,
    public readonly reason?: string
  ) {
    super(message);
    this.name = "KillSwitchError";
  }
}

export class AllowlistError extends Error {
  constructor(
    message: string,
    public readonly address: string,
    public readonly allowlist: string[]
  ) {
    super(message);
    this.name = "AllowlistError";
  }
}
