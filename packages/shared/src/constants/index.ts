/**
 * NEURO Constants
 * Monad MAINNET Configuration
 */

// ============================================
// MONAD MAINNET NETWORK
// ============================================
export const MONAD_MAINNET = {
  chainId: 143,
  name: "Monad Mainnet",
  rpcUrl: "https://rpc.monad.xyz",
  rpcUrlWs: "wss://rpc.monad.xyz/ws",
  blockExplorer: "https://explorer.monad.xyz",
  nativeCurrency: {
    name: "MON",
    symbol: "MON",
    decimals: 18,
  },
} as const;

// ============================================
// NAD.FUN API ENDPOINTS
// ============================================
export const NADFUN_API = {
  baseUrl: "https://api.nadapp.net",
  endpoints: {
    // Token operations
    tokens: "/api/v1/tokens",
    tokenById: (id: string) => `/api/v1/tokens/${id}`,
    tokenByAddress: (address: string) => `/api/v1/tokens/address/${address}`,
    
    // Launch operations
    launch: "/api/v1/launch",
    launchStatus: (id: string) => `/api/v1/launch/${id}/status`,
    
    // Trading operations
    trade: "/api/v1/trade",
    quote: "/api/v1/trade/quote",
    
    // Market data
    trending: "/api/v1/market/trending",
    newTokens: "/api/v1/market/new",
    
    // User operations
    portfolio: (address: string) => `/api/v1/user/${address}/portfolio`,
    history: (address: string) => `/api/v1/user/${address}/history`,
  },
} as const;

// ============================================
// GAS CONFIGURATION (MONAD SPECIFIC)
// ============================================
export const GAS_CONFIG = {
  // Monad charges based on GAS LIMIT, not gas used
  // Always add safety buffer to prevent failed transactions
  defaultBufferPercentage: 15,
  maxBufferPercentage: 25,
  
  // Monad-specific gas costs (significantly higher than Ethereum)
  sloadCold: 8100n,      // 4x higher than Ethereum (2100)
  sloadWarm: 100n,
  sstore: 20000n,
  
  // Common operation estimates
  operations: {
    transfer: 21000n,
    tokenTransfer: 65000n,
    tokenApprove: 46000n,
    swap: 200000n,
    tokenLaunch: 500000n,
    complexTrade: 350000n,
  },
  
  // Maximum gas price (in gwei)
  maxGasPriceGwei: 100n,
} as const;

// ============================================
// FINALITY CONFIGURATION
// ============================================
export const FINALITY = {
  // Economic Finality: 800ms (2 blocks)
  waitMs: 800,
  blocks: 2,
  
  // Polling intervals
  pollIntervalMs: 100,
  maxWaitMs: 5000,
} as const;

// ============================================
// SECURITY DEFAULTS
// ============================================
export const SECURITY_DEFAULTS = {
  executionMode: "READ_ONLY" as const,
  manualApprovalRequired: true,
  killSwitchEnabled: false,
  maxSingleTxValueMon: 1.0,
  
  // Rate limits
  nadfunRateLimitRpm: 60,
  rpcRateLimitRpm: 300,
  
  // Approval expiration
  approvalExpirationMs: 300000, // 5 minutes
} as const;

// ============================================
// EXECUTION MODES
// ============================================
export const EXECUTION_MODES = {
  READ_ONLY: "READ_ONLY",
  WRITE_ENABLED: "WRITE_ENABLED",
} as const;

export type ExecutionMode = keyof typeof EXECUTION_MODES;

// ============================================
// TRANSACTION TYPES
// ============================================
export const TX_TYPES = {
  TOKEN_LAUNCH: "TOKEN_LAUNCH",
  TOKEN_BUY: "TOKEN_BUY",
  TOKEN_SELL: "TOKEN_SELL",
  TRANSFER: "TRANSFER",
  APPROVE: "APPROVE",
  CUSTOM: "CUSTOM",
} as const;

export type TransactionType = keyof typeof TX_TYPES;

// ============================================
// APPROVAL STATUS
// ============================================
export const APPROVAL_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXPIRED: "expired",
  EXECUTED: "executed",
} as const;

export type ApprovalStatus = (typeof APPROVAL_STATUS)[keyof typeof APPROVAL_STATUS];

// ============================================
// RISK LEVELS
// ============================================
export const RISK_LEVELS = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
} as const;

export type RiskLevel = (typeof RISK_LEVELS)[keyof typeof RISK_LEVELS];

// ============================================
// EVM VERSION
// ============================================
export const EVM_VERSION = "prague" as const; // Pectra upgrade
