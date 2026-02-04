/**
 * nad.fun API Client
 * REST API integration for nad.fun Mainnet (https://api.nadapp.net)
 */

import ky, { type KyInstance } from "ky";
import PQueue from "p-queue";
import { type Address } from "viem";
import { NADFUN_API, SECURITY_DEFAULTS, executionLogger as logger } from "@neuro/shared";

// ============================================
// TYPES
// ============================================

export interface TokenData {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  creatorAddress: Address;
  description?: string;
  imageUrl?: string;
  websiteUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
  createdAt: string;
  marketCap?: number;
  volume24h?: number;
  priceUsd?: number;
  priceMon?: number;
  holdersCount?: number;
  liquidityMon?: number;
}

export interface TradeQuote {
  tokenAddress: Address;
  amountIn: string;
  amountOut: string;
  priceImpact: number;
  isBuy: boolean;
  fee: string;
  route: string[];
  expiresAt: number;
}

export interface PortfolioToken {
  token: TokenData;
  balance: string;
  valueUsd: number;
  valueMon: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

// ============================================
// NAD.FUN API CLIENT
// ============================================

export class NadFunApi {
  private readonly client: KyInstance;
  private readonly queue: PQueue;
  private readonly baseUrl: string;

  constructor(baseUrl: string = NADFUN_API.baseUrl, apiKey?: string) {
    this.baseUrl = baseUrl;

    // Initialize HTTP client with retry and timeout
    this.client = ky.create({
      prefixUrl: baseUrl,
      timeout: 30000,
      retry: {
        limit: 3,
        methods: ["get"],
        statusCodes: [408, 429, 500, 502, 503, 504],
        backoffLimit: 10000,
      },
      hooks: {
        beforeRequest: [
          (request) => {
            if (apiKey) {
              request.headers.set("X-API-Key", apiKey);
            }
            request.headers.set("Content-Type", "application/json");
          },
        ],
        beforeRetry: [
          async ({ request, retryCount }) => {
            logger.debug({ url: request.url, retryCount }, "Retrying API request");
          },
        ],
      },
    });

    // Rate limiting queue (60 requests per minute by default)
    this.queue = new PQueue({
      intervalCap: SECURITY_DEFAULTS.nadfunRateLimitRpm,
      interval: 60000,
      carryoverConcurrencyCount: true,
    });

    logger.info({ baseUrl }, "NadFunApi initialized");
  }

  // ============================================
  // HEALTH CHECK
  // ============================================

  /**
   * Checks if the nad.fun API is healthy
   */
  async health(): Promise<boolean> {
    try {
      const response = await this.queue.add(() =>
        this.client.get("health").json<{ status: string }>()
      );
      return response?.status === "ok";
    } catch (error) {
      logger.error({ error }, "nad.fun API health check failed");
      return false;
    }
  }

  // ============================================
  // TOKEN OPERATIONS
  // ============================================

  /**
   * Gets token data by address or symbol
   */
  async getToken(addressOrSymbol: string): Promise<TokenData | null> {
    try {
      const endpoint = addressOrSymbol.startsWith("0x")
        ? NADFUN_API.endpoints.tokenByAddress(addressOrSymbol)
        : `${NADFUN_API.endpoints.tokens}?symbol=${addressOrSymbol}`;

      const response = await this.queue.add(() =>
        this.client.get(endpoint.slice(1)).json<{ data: TokenData }>()
      );

      return response?.data || null;
    } catch (error) {
      logger.warn({ error, addressOrSymbol }, "Failed to get token data");
      return null;
    }
  }

  /**
   * Gets trending tokens
   */
  async getTrendingTokens(limit: number = 20): Promise<TokenData[]> {
    try {
      const response = await this.queue.add(() =>
        this.client
          .get(`${NADFUN_API.endpoints.trending.slice(1)}?limit=${limit}`)
          .json<{ data: TokenData[] }>()
      );

      return response?.data || [];
    } catch (error) {
      logger.warn({ error, limit }, "Failed to get trending tokens");
      return [];
    }
  }

  /**
   * Gets newly launched tokens
   */
  async getNewTokens(limit: number = 20): Promise<TokenData[]> {
    try {
      const response = await this.queue.add(() =>
        this.client
          .get(`${NADFUN_API.endpoints.newTokens.slice(1)}?limit=${limit}`)
          .json<{ data: TokenData[] }>()
      );

      return response?.data || [];
    } catch (error) {
      logger.warn({ error, limit }, "Failed to get new tokens");
      return [];
    }
  }

  // ============================================
  // TRADING OPERATIONS
  // ============================================

  /**
   * Gets a trade quote
   */
  async getQuote(
    tokenAddress: Address,
    amountIn: bigint,
    isBuy: boolean
  ): Promise<TradeQuote | null> {
    try {
      const response = await this.queue.add(() =>
        this.client
          .post(NADFUN_API.endpoints.quote.slice(1), {
            json: {
              tokenAddress,
              amountIn: amountIn.toString(),
              isBuy,
            },
          })
          .json<{ data: TradeQuote }>()
      );

      return response?.data || null;
    } catch (error) {
      logger.warn({ error, tokenAddress, isBuy }, "Failed to get trade quote");
      return null;
    }
  }

  // ============================================
  // USER OPERATIONS
  // ============================================

  /**
   * Gets portfolio for an address
   */
  async getPortfolio(address: Address): Promise<{
    tokens: Array<{ token: TokenData; balance: bigint; value: number }>;
    totalValue: number;
  }> {
    try {
      const response = await this.queue.add(() =>
        this.client
          .get(NADFUN_API.endpoints.portfolio(address).slice(1))
          .json<{ data: { tokens: PortfolioToken[]; totalValueUsd: number } }>()
      );

      if (!response?.data) {
        return { tokens: [], totalValue: 0 };
      }

      const tokens = response.data.tokens.map((t) => ({
        token: t.token,
        balance: BigInt(t.balance),
        value: t.valueUsd,
      }));

      return {
        tokens,
        totalValue: response.data.totalValueUsd,
      };
    } catch (error) {
      logger.warn({ error, address }, "Failed to get portfolio");
      return { tokens: [], totalValue: 0 };
    }
  }

  /**
   * Gets transaction history for an address
   */
  async getHistory(
    address: Address,
    limit: number = 50
  ): Promise<Array<{
    txHash: string;
    type: string;
    tokenAddress: Address;
    amountIn: string;
    amountOut: string;
    timestamp: string;
  }>> {
    try {
      const response = await this.queue.add(() =>
        this.client
          .get(`${NADFUN_API.endpoints.history(address).slice(1)}?limit=${limit}`)
          .json<{ data: Array<unknown> }>()
      );

      return (response?.data || []) as Array<{
        txHash: string;
        type: string;
        tokenAddress: Address;
        amountIn: string;
        amountOut: string;
        timestamp: string;
      }>;
    } catch (error) {
      logger.warn({ error, address }, "Failed to get transaction history");
      return [];
    }
  }

  // ============================================
  // LAUNCH OPERATIONS
  // ============================================

  /**
   * Prepares token launch data (does not execute on-chain)
   * Returns the data needed for contract interaction
   */
  async prepareLaunch(params: {
    name: string;
    symbol: string;
    description: string;
    totalSupply: string;
    imageUrl?: string;
    websiteUrl?: string;
    twitterUrl?: string;
    telegramUrl?: string;
  }): Promise<{
    data: `0x${string}`;
    estimatedGas: string;
    contractAddress: Address;
  } | null> {
    try {
      const response = await this.queue.add(() =>
        this.client
          .post(NADFUN_API.endpoints.launch.slice(1), {
            json: params,
          })
          .json<{
            data: {
              calldata: `0x${string}`;
              estimatedGas: string;
              contractAddress: Address;
            };
          }>()
      );

      if (!response?.data) {
        return null;
      }

      return {
        data: response.data.calldata,
        estimatedGas: response.data.estimatedGas,
        contractAddress: response.data.contractAddress,
      };
    } catch (error) {
      logger.error({ error, params }, "Failed to prepare token launch");
      return null;
    }
  }

  /**
   * Gets launch status by ID
   */
  async getLaunchStatus(launchId: string): Promise<{
    status: "pending" | "processing" | "completed" | "failed";
    tokenAddress?: Address;
    txHash?: string;
    error?: string;
  } | null> {
    try {
      const response = await this.queue.add(() =>
        this.client
          .get(NADFUN_API.endpoints.launchStatus(launchId).slice(1))
          .json<{
            data: {
              status: "pending" | "processing" | "completed" | "failed";
              tokenAddress?: Address;
              txHash?: string;
              error?: string;
            };
          }>()
      );

      return response?.data || null;
    } catch (error) {
      logger.warn({ error, launchId }, "Failed to get launch status");
      return null;
    }
  }
}
