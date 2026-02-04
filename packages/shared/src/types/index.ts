/**
 * NEURO Type Definitions
 */

import type { Address, Hash, Hex } from "viem";
import type {
  ExecutionMode,
  TransactionType,
  ApprovalStatus,
  RiskLevel,
} from "../constants/index.js";

// ============================================
// WALLET TYPES
// ============================================
export interface WalletConfig {
  address: Address;
  type: "operator" | "treasury";
  label: string;
}

// ============================================
// TOKEN TYPES
// ============================================
export interface Token {
  id: string;
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  creatorAddress?: Address;
  nadfunUrl?: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface TokenLaunchParams {
  name: string;
  symbol: string;
  description: string;
  totalSupply: bigint;
  decimals?: number;
  imageUrl?: string;
  websiteUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
  metadata?: Record<string, unknown>;
}

// ============================================
// TRANSACTION TYPES
// ============================================
export interface TransactionRequest {
  id: string;
  type: TransactionType;
  from: Address;
  to: Address;
  value: bigint;
  data?: Hex;
  gasLimit: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
}

export interface TransactionResult {
  id: string;
  hash: Hash;
  blockNumber?: bigint;
  status: "pending" | "confirmed" | "failed";
  gasUsed?: bigint;
  effectiveGasPrice?: bigint;
  error?: string;
  confirmedAt?: Date;
}

export interface PendingTransaction {
  request: TransactionRequest;
  approvalId?: string;
  createdAt: Date;
  expiresAt?: Date;
}

// ============================================
// APPROVAL TYPES
// ============================================
export interface ApprovalRequest {
  id: string;
  transactionId?: string;
  actionType: TransactionType;
  description: string;
  riskLevel: RiskLevel;
  estimatedGas: bigint;
  estimatedCostMon: number;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: Date;
  expiresAt: Date;
}

export interface ApprovalDecision {
  approvalId: string;
  approved: boolean;
  approvedBy: string;
  reason?: string;
  timestamp: Date;
}

// ============================================
// AI DECISION TYPES
// ============================================
export interface AIDecision {
  id: string;
  decisionType: string;
  inputContext: Record<string, unknown>;
  reasoning: string;
  outputAction: Record<string, unknown>;
  confidenceScore: number;
  modelUsed: string;
  approvalId?: string;
  executed: boolean;
  createdAt: Date;
}

// ============================================
// MARKET DATA TYPES
// ============================================
export interface MarketData {
  tokenId: string;
  tokenAddress: Address;
  priceMon: number;
  priceUsd: number;
  volume24h: number;
  marketCap: number;
  holdersCount: number;
  liquidity: number;
  timestamp: Date;
}

export interface TrendingToken {
  token: Token;
  marketData: MarketData;
  rank: number;
  priceChange24h: number;
  volumeChange24h: number;
}

// ============================================
// SECURITY TYPES
// ============================================
export interface SecurityConfig {
  executionMode: ExecutionMode;
  manualApprovalRequired: boolean;
  killSwitchEnabled: boolean;
  maxSingleTxValueMon: number;
  operatorWallet?: WalletConfig;
  treasuryWallet?: WalletConfig;
}

export interface KillSwitchState {
  enabled: boolean;
  enabledBy?: string;
  enabledAt?: Date;
  reason?: string;
}

// ============================================
// GAS ESTIMATION TYPES
// ============================================
export interface GasEstimate {
  gasLimit: bigint;
  gasLimitWithBuffer: bigint;
  bufferPercentage: number;
  estimatedCostWei: bigint;
  estimatedCostMon: number;
  maxCostWei: bigint;
  maxCostMon: number;
}

// ============================================
// API RESPONSE TYPES
// ============================================
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: Date;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================
// EVENT TYPES
// ============================================
export type NeuroEvent =
  | { type: "TRANSACTION_SUBMITTED"; payload: TransactionRequest }
  | { type: "TRANSACTION_CONFIRMED"; payload: TransactionResult }
  | { type: "TRANSACTION_FAILED"; payload: TransactionResult }
  | { type: "APPROVAL_REQUESTED"; payload: ApprovalRequest }
  | { type: "APPROVAL_DECIDED"; payload: ApprovalDecision }
  | { type: "AI_DECISION_MADE"; payload: AIDecision }
  | { type: "KILL_SWITCH_ACTIVATED"; payload: KillSwitchState }
  | { type: "KILL_SWITCH_DEACTIVATED"; payload: KillSwitchState }
  | { type: "MARKET_DATA_UPDATED"; payload: MarketData };
