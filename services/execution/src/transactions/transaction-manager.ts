/**
 * Transaction Manager
 * Handles transaction lifecycle with Monad-specific optimizations
 */

import {
  type Address,
  type Hash,
  type TransactionRequest as ViemTxRequest,
  formatEther,
} from "viem";
import { EventEmitter } from "eventemitter3";
import {
  FINALITY,
  TX_TYPES,
  executionLogger as logger,
  isKillSwitchActive,
  canWrite,
  validateTransactionExecution,
  type TransactionRequest,
  type TransactionResult,
  type GasEstimate,
} from "@neuro/shared";
import type { MonadClient } from "../client/monad-client.js";
import { estimateGas, checkGasPrice, validateSufficientBalance } from "../gas/gas-calculator.js";

// ============================================
// TYPES
// ============================================

export interface TransactionEvents {
  "tx:submitted": (tx: TransactionRequest, hash: Hash) => void;
  "tx:confirmed": (result: TransactionResult) => void;
  "tx:failed": (tx: TransactionRequest, error: string) => void;
  "tx:blocked": (tx: TransactionRequest, reason: string) => void;
}

export interface PreparedTransaction {
  request: TransactionRequest;
  gasEstimate: GasEstimate;
  viemRequest: ViemTxRequest;
}

// ============================================
// TRANSACTION MANAGER
// ============================================

export class TransactionManager extends EventEmitter<TransactionEvents> {
  private readonly client: MonadClient;
  private pendingTxs: Map<string, TransactionRequest> = new Map();

  constructor(client: MonadClient) {
    super();
    this.client = client;

    logger.info("TransactionManager initialized");
  }

  // ============================================
  // TRANSACTION PREPARATION
  // ============================================

  /**
   * Prepares a transaction with gas estimation and validation
   * Does NOT execute the transaction
   */
  async prepareTransaction(
    to: Address,
    value: bigint,
    data?: `0x${string}`,
    type: keyof typeof TX_TYPES = "CUSTOM"
  ): Promise<PreparedTransaction> {
    if (!this.client.account) {
      throw new Error("No account configured - cannot prepare transactions");
    }

    const from = this.client.account.address;

    // Estimate gas with Monad buffer
    const gasEstimate = await estimateGas(this.client, {
      to,
      value,
      data,
      from,
    });

    // Get current gas price
    const gasPrice = await this.client.public.getGasPrice();

    // Create transaction request
    const request: TransactionRequest = {
      id: crypto.randomUUID(),
      type,
      from,
      to,
      value,
      data,
      gasLimit: gasEstimate.gasLimitWithBuffer,
      gasPrice,
    };

    // Create viem-compatible request
    const viemRequest: ViemTxRequest = {
      to,
      value,
      data,
      gas: gasEstimate.gasLimitWithBuffer,
      gasPrice,
    };

    logger.info({
      txId: request.id,
      type,
      to,
      value: formatEther(value),
      gasLimit: gasEstimate.gasLimitWithBuffer.toString(),
    }, "Transaction prepared");

    return {
      request,
      gasEstimate,
      viemRequest,
    };
  }

  // ============================================
  // TRANSACTION VALIDATION
  // ============================================

  /**
   * Validates a transaction can be executed
   */
  async validateTransaction(prepared: PreparedTransaction): Promise<{
    valid: boolean;
    reason?: string;
  }> {
    // Check kill switch
    if (isKillSwitchActive()) {
      return { valid: false, reason: "Kill switch is active" };
    }

    // Check execution mode
    if (!canWrite()) {
      return { valid: false, reason: "System is in READ-ONLY mode" };
    }

    // Check transaction value limits
    const valueMon = Number(formatEther(prepared.request.value));
    const validation = validateTransactionExecution(valueMon, true);
    if (!validation.allowed) {
      return { valid: false, reason: validation.reason };
    }

    // Check gas price
    const { acceptable, currentGwei, maxGwei } = await checkGasPrice(this.client);
    if (!acceptable) {
      return {
        valid: false,
        reason: `Gas price ${currentGwei} gwei exceeds maximum ${maxGwei} gwei`,
      };
    }

    // Check balance
    const { sufficient, balance, required } = await validateSufficientBalance(
      this.client,
      prepared.gasEstimate.maxCostWei,
      prepared.request.value
    );
    if (!sufficient) {
      return {
        valid: false,
        reason: `Insufficient balance: ${formatEther(balance)} MON, required: ${formatEther(required)} MON`,
      };
    }

    return { valid: true };
  }

  // ============================================
  // TRANSACTION EXECUTION
  // ============================================

  /**
   * Executes a prepared and validated transaction
   * 
   * CRITICAL: This should only be called after manual approval
   * when MANUAL_APPROVAL=true
   */
  async executeTransaction(
    prepared: PreparedTransaction
  ): Promise<TransactionResult> {
    // Final security check
    const validation = await this.validateTransaction(prepared);
    if (!validation.valid) {
      this.emit("tx:blocked", prepared.request, validation.reason!);
      throw new Error(`Transaction blocked: ${validation.reason}`);
    }

    if (!this.client.wallet || !this.client.account) {
      throw new Error("No wallet configured - cannot execute transactions");
    }

    try {
      logger.info({
        txId: prepared.request.id,
        to: prepared.request.to,
        value: formatEther(prepared.request.value),
      }, "Executing transaction");

      // Get nonce
      const nonce = await this.client.public.getTransactionCount({
        address: this.client.account.address,
      });

      // Send transaction
      const hash = await this.client.wallet.sendTransaction({
        ...prepared.viemRequest,
        nonce,
        chain: this.client.wallet.chain,
      });

      // Track pending transaction
      this.pendingTxs.set(hash, prepared.request);
      this.emit("tx:submitted", prepared.request, hash);

      logger.info({
        txId: prepared.request.id,
        hash,
      }, "Transaction submitted");

      // Wait for confirmation with economic finality
      const result = await this.waitForConfirmation(
        prepared.request.id,
        hash
      );

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      logger.error({
        txId: prepared.request.id,
        error: errorMessage,
      }, "Transaction failed");

      this.emit("tx:failed", prepared.request, errorMessage);

      return {
        id: prepared.request.id,
        hash: "0x" as Hash, // No hash if submission failed
        status: "failed",
        error: errorMessage,
      };
    }
  }

  /**
   * Waits for transaction confirmation with economic finality
   */
  private async waitForConfirmation(
    txId: string,
    hash: Hash
  ): Promise<TransactionResult> {
    try {
      // Wait for block confirmations
      const receipt = await this.client.public.waitForTransactionReceipt({
        hash,
        confirmations: FINALITY.blocks,
        timeout: 60000, // 1 minute timeout
      });

      // Additional wait for economic finality (800ms)
      await new Promise((resolve) => setTimeout(resolve, FINALITY.waitMs));

      const result: TransactionResult = {
        id: txId,
        hash,
        blockNumber: receipt.blockNumber,
        status: receipt.status === "success" ? "confirmed" : "failed",
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        confirmedAt: new Date(),
      };

      // Clean up pending tracking
      this.pendingTxs.delete(hash);

      if (result.status === "confirmed") {
        this.emit("tx:confirmed", result);
        logger.info({
          txId,
          hash,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
        }, "Transaction confirmed with economic finality");
      } else {
        this.emit("tx:failed", this.pendingTxs.get(hash)!, "Transaction reverted");
        logger.warn({
          txId,
          hash,
        }, "Transaction reverted");
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      this.pendingTxs.delete(hash);

      return {
        id: txId,
        hash,
        status: "failed",
        error: errorMessage,
      };
    }
  }

  // ============================================
  // TRANSACTION STATUS
  // ============================================

  /**
   * Gets the status of a transaction
   */
  async getTransactionStatus(hash: Hash): Promise<{
    status: "pending" | "confirmed" | "failed" | "not_found";
    blockNumber?: bigint;
    confirmations?: number;
  }> {
    try {
      const receipt = await this.client.public.getTransactionReceipt({
        hash,
      });

      if (!receipt) {
        // Check if transaction exists but not mined
        const tx = await this.client.public.getTransaction({ hash });
        if (tx) {
          return { status: "pending" };
        }
        return { status: "not_found" };
      }

      const currentBlock = await this.client.public.getBlockNumber();
      const confirmations = Number(currentBlock - receipt.blockNumber);

      return {
        status: receipt.status === "success" ? "confirmed" : "failed",
        blockNumber: receipt.blockNumber,
        confirmations,
      };
    } catch {
      return { status: "not_found" };
    }
  }

  /**
   * Gets all pending transactions
   */
  getPendingTransactions(): TransactionRequest[] {
    return Array.from(this.pendingTxs.values());
  }
}
