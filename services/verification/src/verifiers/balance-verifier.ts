/**
 * Balance Verifier
 * Verifies wallet balances across multiple sources
 */

import { type Address, createPublicClient, http, formatEther } from "viem";
import { logger, MONAD_MAINNET } from "@neuro/shared";
import ky from "ky";

const verifyLogger = logger.child({ service: "verification", module: "balance" });

export interface BalanceVerification {
  valid: boolean;
  balances: {
    rpc: bigint;
    explorer?: bigint;
  };
  discrepancy: boolean;
  discrepancyPercent?: number;
}

export class BalanceVerifier {
  private readonly rpcUrl: string;
  private readonly explorerApiUrl?: string;
  private readonly maxDiscrepancyPercent: number;

  constructor(config: {
    rpcUrl: string;
    explorerApiUrl?: string;
    maxDiscrepancyPercent?: number;
  }) {
    this.rpcUrl = config.rpcUrl;
    this.explorerApiUrl = config.explorerApiUrl;
    this.maxDiscrepancyPercent = config.maxDiscrepancyPercent || 0.1; // 0.1%
  }

  /**
   * Verify balance from multiple sources
   */
  async verify(address: Address): Promise<BalanceVerification> {
    // Get balance from RPC
    const client = createPublicClient({
      transport: http(this.rpcUrl),
    });

    const rpcBalance = await client.getBalance({ address });

    // Get balance from explorer if available
    let explorerBalance: bigint | undefined;
    if (this.explorerApiUrl) {
      try {
        const response = await ky
          .get(`${this.explorerApiUrl}/api/v1/address/${address}/balance`)
          .json<{ balance: string }>();
        explorerBalance = BigInt(response.balance);
      } catch (error) {
        verifyLogger.warn({ error, address }, "Failed to fetch explorer balance");
      }
    }

    // Check for discrepancy
    let discrepancy = false;
    let discrepancyPercent: number | undefined;

    if (explorerBalance !== undefined && rpcBalance !== explorerBalance) {
      const diff = rpcBalance > explorerBalance
        ? rpcBalance - explorerBalance
        : explorerBalance - rpcBalance;
      discrepancyPercent = Number((diff * 10000n) / rpcBalance) / 100;
      discrepancy = discrepancyPercent > this.maxDiscrepancyPercent;

      if (discrepancy) {
        verifyLogger.warn({
          address,
          rpcBalance: formatEther(rpcBalance),
          explorerBalance: formatEther(explorerBalance),
          discrepancyPercent,
        }, "Balance discrepancy detected");
      }
    }

    return {
      valid: !discrepancy,
      balances: {
        rpc: rpcBalance,
        explorer: explorerBalance,
      },
      discrepancy,
      discrepancyPercent,
    };
  }

  /**
   * Verify sufficient balance for transaction
   */
  async verifySufficientBalance(
    address: Address,
    requiredAmount: bigint,
    gasBuffer: bigint = 0n
  ): Promise<{ sufficient: boolean; balance: bigint; shortfall: bigint }> {
    const client = createPublicClient({
      transport: http(this.rpcUrl),
    });

    const balance = await client.getBalance({ address });
    const totalRequired = requiredAmount + gasBuffer;
    const sufficient = balance >= totalRequired;
    const shortfall = sufficient ? 0n : totalRequired - balance;

    verifyLogger.debug({
      address,
      balance: formatEther(balance),
      required: formatEther(totalRequired),
      sufficient,
    }, "Balance sufficiency check");

    return { sufficient, balance, shortfall };
  }
}
