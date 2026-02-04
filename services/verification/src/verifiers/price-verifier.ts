/**
 * Price Verifier
 * Cross-checks token prices across multiple sources
 */

import { type Address } from "viem";
import { logger } from "@neuro/shared";
import ky from "ky";

const verifyLogger = logger.child({ service: "verification", module: "price" });

export interface PriceVerification {
  valid: boolean;
  prices: {
    nadfun?: number;
    dex?: number;
    aggregator?: number;
  };
  averagePrice: number;
  maxDeviation: number;
  maxDeviationPercent: number;
}

export interface PriceSource {
  name: string;
  getPrice: (tokenAddress: Address) => Promise<number | null>;
}

export class PriceVerifier {
  private readonly sources: PriceSource[];
  private readonly maxDeviationPercent: number;

  constructor(config: {
    nadfunApiUrl: string;
    maxDeviationPercent?: number;
  }) {
    this.maxDeviationPercent = config.maxDeviationPercent || 5; // 5%
    
    // Initialize price sources
    this.sources = [
      {
        name: "nadfun",
        getPrice: async (tokenAddress: Address) => {
          try {
            const response = await ky
              .get(`${config.nadfunApiUrl}/api/v1/tokens/address/${tokenAddress}`)
              .json<{ data: { price_usd: number } }>();
            return response.data?.price_usd || null;
          } catch {
            return null;
          }
        },
      },
    ];
  }

  /**
   * Verify token price across multiple sources
   */
  async verify(tokenAddress: Address): Promise<PriceVerification> {
    const prices: Record<string, number> = {};
    const priceValues: number[] = [];

    // Fetch prices from all sources
    for (const source of this.sources) {
      const price = await source.getPrice(tokenAddress);
      if (price !== null && price > 0) {
        prices[source.name] = price;
        priceValues.push(price);
      }
    }

    // Calculate average and deviation
    if (priceValues.length === 0) {
      verifyLogger.warn({ tokenAddress }, "No price data available");
      return {
        valid: false,
        prices: {},
        averagePrice: 0,
        maxDeviation: 0,
        maxDeviationPercent: 0,
      };
    }

    const averagePrice = priceValues.reduce((a, b) => a + b, 0) / priceValues.length;
    const maxDeviation = Math.max(...priceValues.map((p) => Math.abs(p - averagePrice)));
    const maxDeviationPercent = (maxDeviation / averagePrice) * 100;
    const valid = maxDeviationPercent <= this.maxDeviationPercent;

    verifyLogger.info({
      tokenAddress,
      sourcesCount: priceValues.length,
      averagePrice,
      maxDeviationPercent,
      valid,
    }, "Price verification completed");

    return {
      valid,
      prices: {
        nadfun: prices.nadfun,
        dex: prices.dex,
        aggregator: prices.aggregator,
      },
      averagePrice,
      maxDeviation,
      maxDeviationPercent,
    };
  }

  /**
   * Add a custom price source
   */
  addSource(source: PriceSource): void {
    this.sources.push(source);
  }
}
