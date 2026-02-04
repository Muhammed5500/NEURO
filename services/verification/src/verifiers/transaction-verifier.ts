/**
 * Transaction Verifier
 * Verifies transaction integrity before execution
 */

import { type Address, type Hash, formatEther } from "viem";
import { logger, MONAD_MAINNET } from "@neuro/shared";

const verifyLogger = logger.child({ service: "verification", module: "transaction" });

export interface TransactionVerification {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks: {
    addressValid: boolean;
    valueWithinLimits: boolean;
    gasEstimateReasonable: boolean;
    nonceCorrect: boolean;
    contractVerified?: boolean;
  };
}

export interface TransactionToVerify {
  to: Address;
  from: Address;
  value: bigint;
  gasLimit: bigint;
  data?: `0x${string}`;
  nonce?: number;
}

export class TransactionVerifier {
  private readonly maxValueMon: number;
  private readonly maxGasLimit: bigint;

  constructor(config: { maxValueMon?: number; maxGasLimit?: bigint } = {}) {
    this.maxValueMon = config.maxValueMon || 1.0;
    this.maxGasLimit = config.maxGasLimit || 5_000_000n;
  }

  /**
   * Verify a transaction before execution
   */
  async verify(
    tx: TransactionToVerify,
    currentNonce?: number
  ): Promise<TransactionVerification> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check 1: Valid addresses
    const addressValid = this.isValidAddress(tx.to) && this.isValidAddress(tx.from);
    if (!addressValid) {
      errors.push("Invalid address format");
    }

    // Check 2: Value within limits
    const valueMon = Number(formatEther(tx.value));
    const valueWithinLimits = valueMon <= this.maxValueMon;
    if (!valueWithinLimits) {
      errors.push(`Value ${valueMon} MON exceeds limit of ${this.maxValueMon} MON`);
    }
    if (valueMon > this.maxValueMon * 0.8) {
      warnings.push(`Value ${valueMon} MON is close to limit`);
    }

    // Check 3: Gas limit reasonable
    const gasEstimateReasonable = tx.gasLimit <= this.maxGasLimit;
    if (!gasEstimateReasonable) {
      errors.push(`Gas limit ${tx.gasLimit} exceeds maximum ${this.maxGasLimit}`);
    }

    // Check 4: Nonce correct (if provided)
    let nonceCorrect = true;
    if (tx.nonce !== undefined && currentNonce !== undefined) {
      nonceCorrect = tx.nonce === currentNonce;
      if (!nonceCorrect) {
        errors.push(`Nonce mismatch: expected ${currentNonce}, got ${tx.nonce}`);
      }
    }

    const valid = errors.length === 0;

    verifyLogger.info({
      valid,
      errorCount: errors.length,
      warningCount: warnings.length,
      to: tx.to,
      valueMon,
    }, "Transaction verification completed");

    return {
      valid,
      errors,
      warnings,
      checks: {
        addressValid,
        valueWithinLimits,
        gasEstimateReasonable,
        nonceCorrect,
      },
    };
  }

  private isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }
}
