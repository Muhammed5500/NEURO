/**
 * SDK Type Definitions
 */

import type { Address, Hash, Hex } from "viem";

// Re-export shared types
export type {
  Token,
  TokenLaunchParams,
  TransactionRequest,
  TransactionResult,
  GasEstimate,
  MarketData,
} from "@neuro/shared";

// ============================================
// SDK-SPECIFIC TYPES
// ============================================

export interface TokenInfo {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  price?: {
    mon: number;
    usd: number;
  };
  marketCap?: number;
  volume24h?: number;
  holdersCount?: number;
}

export interface TradeParams {
  tokenAddress: Address;
  amount: bigint;
  minAmountOut?: bigint;
  slippagePercent?: number;
  deadline?: number;
}

export interface TradeQuote {
  amountIn: bigint;
  amountOut: bigint;
  priceImpact: number;
  fee: bigint;
  route: Address[];
  expiresAt: number;
}

export interface TradeResult {
  hash: Hash;
  status: "pending" | "confirmed" | "failed";
  amountIn: bigint;
  amountOut: bigint;
  gasUsed?: bigint;
  blockNumber?: bigint;
}

export interface PortfolioToken {
  token: TokenInfo;
  balance: bigint;
  valueUsd: number;
  valueMon: number;
  pnlPercent?: number;
}

export interface Portfolio {
  address: Address;
  tokens: PortfolioToken[];
  totalValueUsd: number;
  totalValueMon: number;
}

export interface ChainStatus {
  connected: boolean;
  chainId: number;
  blockNumber: bigint;
  gasPrice: bigint;
  latencyMs: number;
}

// ============================================
// EVENT TYPES
// ============================================

export type SDKEvent =
  | { type: "connected"; chainId: number }
  | { type: "disconnected" }
  | { type: "blockNumber"; blockNumber: bigint }
  | { type: "transaction"; hash: Hash; status: string }
  | { type: "error"; error: Error };

export type SDKEventHandler = (event: SDKEvent) => void;
