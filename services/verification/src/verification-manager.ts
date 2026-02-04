/**
 * Verification Manager
 * Coordinates all verification services
 */

import { type Address } from "viem";
import { logger, MONAD_MAINNET, NADFUN_API } from "@neuro/shared";
import {
  TransactionVerifier,
  type TransactionToVerify,
  type TransactionVerification,
} from "./verifiers/transaction-verifier.js";
import {
  BalanceVerifier,
  type BalanceVerification,
} from "./verifiers/balance-verifier.js";
import {
  PriceVerifier,
  type PriceVerification,
} from "./verifiers/price-verifier.js";

const verifyLogger = logger.child({ service: "verification" });

export interface VerificationManagerConfig {
  monadRpcUrl: string;
  nadfunApiUrl: string;
  maxTxValueMon?: number;
}

export interface FullVerification {
  transaction?: TransactionVerification;
  balance?: BalanceVerification;
  price?: PriceVerification;
  overallValid: boolean;
  summary: string[];
}

export class VerificationManager {
  private readonly transactionVerifier: TransactionVerifier;
  private readonly balanceVerifier: BalanceVerifier;
  private readonly priceVerifier: PriceVerifier;

  constructor(config: VerificationManagerConfig) {
    this.transactionVerifier = new TransactionVerifier({
      maxValueMon: config.maxTxValueMon || 1.0,
    });

    this.balanceVerifier = new BalanceVerifier({
      rpcUrl: config.monadRpcUrl,
    });

    this.priceVerifier = new PriceVerifier({
      nadfunApiUrl: config.nadfunApiUrl,
    });

    verifyLogger.info({
      rpcUrl: config.monadRpcUrl,
      nadfunApiUrl: config.nadfunApiUrl,
    }, "Verification Manager configured");
  }

  async initialize(): Promise<void> {
    verifyLogger.info("Verification Manager initialized");
  }

  /**
   * Full verification before transaction execution
   */
  async verifyBeforeExecution(params: {
    transaction: TransactionToVerify;
    tokenAddress?: Address;
    currentNonce?: number;
  }): Promise<FullVerification> {
    const summary: string[] = [];
    let overallValid = true;

    // 1. Verify transaction
    const txVerification = await this.transactionVerifier.verify(
      params.transaction,
      params.currentNonce
    );
    if (!txVerification.valid) {
      overallValid = false;
      summary.push(...txVerification.errors);
    }
    summary.push(...txVerification.warnings);

    // 2. Verify balance
    const balanceVerification = await this.balanceVerifier.verify(
      params.transaction.from
    );
    if (!balanceVerification.valid) {
      overallValid = false;
      summary.push("Balance discrepancy detected");
    }

    // 3. Verify price if token address provided
    let priceVerification: PriceVerification | undefined;
    if (params.tokenAddress) {
      priceVerification = await this.priceVerifier.verify(params.tokenAddress);
      if (!priceVerification.valid) {
        overallValid = false;
        summary.push(`Price deviation too high: ${priceVerification.maxDeviationPercent.toFixed(2)}%`);
      }
    }

    verifyLogger.info({
      overallValid,
      summaryCount: summary.length,
    }, "Full verification completed");

    return {
      transaction: txVerification,
      balance: balanceVerification,
      price: priceVerification,
      overallValid,
      summary,
    };
  }

  /**
   * Quick balance check
   */
  async checkBalance(address: Address): Promise<BalanceVerification> {
    return this.balanceVerifier.verify(address);
  }

  /**
   * Quick price check
   */
  async checkPrice(tokenAddress: Address): Promise<PriceVerification> {
    return this.priceVerifier.verify(tokenAddress);
  }
}
