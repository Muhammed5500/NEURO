/**
 * NEURO SDK Client
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Account,
  type Address,
  formatEther,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MONAD_MAINNET, calculateGasWithBuffer } from "@neuro/shared";
import { createConfig, type NeuroSDKConfig } from "../config.js";
import type {
  TokenInfo,
  TradeParams,
  TradeQuote,
  TradeResult,
  Portfolio,
  ChainStatus,
  SDKEvent,
  SDKEventHandler,
} from "../types/index.js";

// ============================================
// MONAD CHAIN DEFINITION
// ============================================

const monadMainnet: Chain = {
  id: MONAD_MAINNET.chainId,
  name: MONAD_MAINNET.name,
  nativeCurrency: MONAD_MAINNET.nativeCurrency,
  rpcUrls: {
    default: { http: [MONAD_MAINNET.rpcUrl] },
  },
};

// ============================================
// SDK CLIENT
// ============================================

export class NeuroClient {
  private readonly config: Required<NeuroSDKConfig>;
  private readonly publicClient: PublicClient;
  private walletClient?: WalletClient;
  private account?: Account;
  private eventHandlers: Set<SDKEventHandler> = new Set();

  constructor(config: NeuroSDKConfig = {}) {
    this.config = createConfig(config);

    // Create public client
    this.publicClient = createPublicClient({
      chain: monadMainnet,
      transport: http(this.config.rpcUrl),
    });

    // Create wallet client if private key provided
    if (this.config.privateKey) {
      this.account = privateKeyToAccount(this.config.privateKey as `0x${string}`);
      this.walletClient = createWalletClient({
        account: this.account,
        chain: monadMainnet,
        transport: http(this.config.rpcUrl),
      });
    }
  }

  // ============================================
  // CONNECTION
  // ============================================

  async getChainStatus(): Promise<ChainStatus> {
    const start = Date.now();
    
    try {
      const [chainId, blockNumber, gasPrice] = await Promise.all([
        this.publicClient.getChainId(),
        this.publicClient.getBlockNumber(),
        this.publicClient.getGasPrice(),
      ]);

      return {
        connected: true,
        chainId,
        blockNumber,
        gasPrice,
        latencyMs: Date.now() - start,
      };
    } catch {
      return {
        connected: false,
        chainId: 0,
        blockNumber: 0n,
        gasPrice: 0n,
        latencyMs: Date.now() - start,
      };
    }
  }

  // ============================================
  // TOKENS
  // ============================================

  async getToken(address: Address): Promise<TokenInfo | null> {
    try {
      const response = await fetch(
        `${this.config.nadfunApiUrl}/api/v1/tokens/address/${address}`
      );
      
      if (!response.ok) return null;
      
      const data = await response.json();
      return this.mapTokenResponse(data.data);
    } catch {
      return null;
    }
  }

  async getTrendingTokens(limit: number = 20): Promise<TokenInfo[]> {
    try {
      const response = await fetch(
        `${this.config.nadfunApiUrl}/api/v1/market/trending?limit=${limit}`
      );
      
      if (!response.ok) return [];
      
      const data = await response.json();
      return (data.data || []).map(this.mapTokenResponse);
    } catch {
      return [];
    }
  }

  async getNewTokens(limit: number = 20): Promise<TokenInfo[]> {
    try {
      const response = await fetch(
        `${this.config.nadfunApiUrl}/api/v1/market/new?limit=${limit}`
      );
      
      if (!response.ok) return [];
      
      const data = await response.json();
      return (data.data || []).map(this.mapTokenResponse);
    } catch {
      return [];
    }
  }

  private mapTokenResponse(data: any): TokenInfo {
    return {
      address: data.address as Address,
      name: data.name,
      symbol: data.symbol,
      decimals: data.decimals || 18,
      totalSupply: BigInt(data.total_supply || "0"),
      price: data.price_usd ? {
        usd: data.price_usd,
        mon: data.price_mon || 0,
      } : undefined,
      marketCap: data.market_cap,
      volume24h: data.volume_24h,
      holdersCount: data.holders_count,
    };
  }

  // ============================================
  // TRADING
  // ============================================

  async getQuote(params: TradeParams, isBuy: boolean): Promise<TradeQuote | null> {
    try {
      const response = await fetch(
        `${this.config.nadfunApiUrl}/api/v1/trade/quote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tokenAddress: params.tokenAddress,
            amountIn: params.amount.toString(),
            isBuy,
          }),
        }
      );
      
      if (!response.ok) return null;
      
      const data = await response.json();
      return {
        amountIn: BigInt(data.data.amount_in),
        amountOut: BigInt(data.data.amount_out),
        priceImpact: data.data.price_impact,
        fee: BigInt(data.data.fee || "0"),
        route: data.data.route || [],
        expiresAt: data.data.expires_at,
      };
    } catch {
      return null;
    }
  }

  // ============================================
  // PORTFOLIO
  // ============================================

  async getPortfolio(address: Address): Promise<Portfolio | null> {
    try {
      const response = await fetch(
        `${this.config.nadfunApiUrl}/api/v1/user/${address}/portfolio`
      );
      
      if (!response.ok) return null;
      
      const data = await response.json();
      return {
        address,
        tokens: (data.data?.tokens || []).map((t: any) => ({
          token: this.mapTokenResponse(t.token),
          balance: BigInt(t.balance || "0"),
          valueUsd: t.value_usd || 0,
          valueMon: t.value_mon || 0,
          pnlPercent: t.pnl_percent,
        })),
        totalValueUsd: data.data?.total_value_usd || 0,
        totalValueMon: data.data?.total_value_mon || 0,
      };
    } catch {
      return null;
    }
  }

  // ============================================
  // BALANCE
  // ============================================

  async getBalance(address: Address): Promise<bigint> {
    return this.publicClient.getBalance({ address });
  }

  async getBalanceFormatted(address: Address): Promise<string> {
    const balance = await this.getBalance(address);
    return formatEther(balance);
  }

  // ============================================
  // GAS
  // ============================================

  async estimateGas(params: {
    to: Address;
    value?: bigint;
    data?: `0x${string}`;
  }): Promise<{ gasLimit: bigint; gasLimitWithBuffer: bigint; gasCostMon: number }> {
    const gasPrice = await this.publicClient.getGasPrice();
    const gasLimit = await this.publicClient.estimateGas({
      to: params.to,
      value: params.value,
      data: params.data,
    });

    const estimate = calculateGasWithBuffer(gasLimit, this.config.gasBufferPercent);

    return {
      gasLimit,
      gasLimitWithBuffer: estimate.gasLimitWithBuffer,
      gasCostMon: estimate.maxCostMon,
    };
  }

  // ============================================
  // EVENTS
  // ============================================

  on(handler: SDKEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: SDKEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (e) {
        console.error("Event handler error:", e);
      }
    }
  }

  // ============================================
  // GETTERS
  // ============================================

  get address(): Address | undefined {
    return this.account?.address;
  }

  get isConnected(): boolean {
    return !!this.walletClient;
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createNeuroClient(config?: NeuroSDKConfig): NeuroClient {
  return new NeuroClient(config);
}
