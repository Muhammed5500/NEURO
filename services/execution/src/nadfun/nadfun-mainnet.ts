/**
 * nad.fun Mainnet Integration
 * 
 * CRITICAL CONSTRAINTS:
 * - DEFAULT: READ-ONLY mode
 * - MANUAL_APPROVAL=true is MANDATORY for all mainnet writes
 * - Kill switch must be checked before ANY write operation
 * - Gas calculations include 10-15% buffer (Monad charges by gas limit)
 * - Wait 800ms (2 blocks) for economic finality before confirming
 */

import { type Address, type Hash, formatEther, parseEther } from "viem";
import { EventEmitter } from "eventemitter3";
import {
  NADFUN_API,
  FINALITY,
  executionLogger as logger,
  isKillSwitchActive,
  canWrite,
  isManualApprovalRequired,
  validateTransactionExecution,
  waitForFinality,
  type TokenLaunchParams,
  type GasEstimate,
  type ApprovalRequest,
} from "@neuro/shared";
import type { MonadClient } from "../client/monad-client.js";
import type { ExecutionConfig } from "../config.js";
import { NadFunApi, type TokenData, type TradeQuote } from "./nadfun-api.js";
import { estimateTokenLaunchGas, estimateSwapGas } from "../gas/gas-calculator.js";

// ============================================
// TYPES
// ============================================

export interface LaunchResult {
  success: boolean;
  tokenAddress?: Address;
  txHash?: Hash;
  error?: string;
  approvalId?: string;
}

export interface TradeResult {
  success: boolean;
  txHash?: Hash;
  amountOut?: bigint;
  error?: string;
  approvalId?: string;
}

export interface NadFunEvents {
  "approval:required": (approval: ApprovalRequest) => void;
  "transaction:submitted": (txHash: Hash, type: string) => void;
  "transaction:confirmed": (txHash: Hash, blockNumber: bigint) => void;
  "transaction:failed": (txHash: Hash, error: string) => void;
  "killswitch:activated": () => void;
}

// ============================================
// NAD.FUN MAINNET SERVICE
// ============================================

export class NadFunMainnet extends EventEmitter<NadFunEvents> {
  private readonly config: ExecutionConfig;
  private readonly client: MonadClient;
  private readonly api: NadFunApi;

  constructor(config: ExecutionConfig, client: MonadClient) {
    super();
    this.config = config;
    this.client = client;
    this.api = new NadFunApi(config.nadfunApiUrl, config.nadfunApiKey);

    logger.info({
      endpoint: NADFUN_API.baseUrl,
      executionMode: config.executionMode,
      manualApproval: config.manualApproval,
    }, "NadFunMainnet initialized");
  }

  // ============================================
  // SECURITY CHECKS
  // ============================================

  /**
   * Pre-flight security checks for ALL write operations
   * Returns approval request if manual approval is required
   */
  private async preflightWriteCheck(
    actionType: string,
    valueMon: number,
    description: string,
    payload: Record<string, unknown>
  ): Promise<{ canProceed: boolean; approvalId?: string; reason?: string }> {
    // CHECK 1: Kill switch
    if (isKillSwitchActive()) {
      this.emit("killswitch:activated");
      logger.error({ actionType }, "KILL SWITCH ACTIVE - Operation blocked");
      return { canProceed: false, reason: "Kill switch is active" };
    }

    // CHECK 2: Execution mode
    if (!canWrite()) {
      logger.warn({ actionType }, "System in READ-ONLY mode - Operation blocked");
      return { canProceed: false, reason: "System is in READ-ONLY mode" };
    }

    // CHECK 3: Transaction value validation
    const validation = validateTransactionExecution(valueMon, true);
    if (!validation.allowed) {
      logger.warn({ actionType, valueMon, reason: validation.reason }, "Transaction validation failed");
      return { canProceed: false, reason: validation.reason };
    }

    // CHECK 4: Manual approval requirement
    if (isManualApprovalRequired()) {
      const gasEstimate = await this.estimateGasForAction(actionType);
      
      const approvalRequest: ApprovalRequest = {
        id: crypto.randomUUID(),
        actionType: actionType as any,
        description,
        riskLevel: valueMon > 0.5 ? "high" : "medium",
        estimatedGas: gasEstimate.gasLimitWithBuffer,
        estimatedCostMon: gasEstimate.maxCostMon,
        payload,
        status: "pending",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
      };

      this.emit("approval:required", approvalRequest);
      
      logger.info({
        approvalId: approvalRequest.id,
        actionType,
        riskLevel: approvalRequest.riskLevel,
      }, "Manual approval required");

      return { canProceed: false, approvalId: approvalRequest.id, reason: "Manual approval required" };
    }

    return { canProceed: true };
  }

  /**
   * Estimates gas for different action types
   */
  private async estimateGasForAction(actionType: string): Promise<GasEstimate> {
    switch (actionType) {
      case "TOKEN_LAUNCH":
        return estimateTokenLaunchGas(this.client);
      case "TOKEN_BUY":
      case "TOKEN_SELL":
        return estimateSwapGas(this.client, false);
      default:
        return estimateSwapGas(this.client, true);
    }
  }

  // ============================================
  // READ OPERATIONS (Always Available)
  // ============================================

  /**
   * Health check for nad.fun API
   */
  async healthCheck(): Promise<{ api: boolean; rpc: boolean }> {
    try {
      const [apiHealth, chainId] = await Promise.all([
        this.api.health(),
        this.client.public.getChainId(),
      ]);

      return {
        api: apiHealth,
        rpc: chainId === 143, // Monad Mainnet
      };
    } catch (error) {
      logger.error({ error }, "Health check failed");
      return { api: false, rpc: false };
    }
  }

  /**
   * Gets token data from nad.fun
   */
  async getToken(addressOrSymbol: string): Promise<TokenData | null> {
    return this.api.getToken(addressOrSymbol);
  }

  /**
   * Gets trending tokens from nad.fun
   */
  async getTrendingTokens(limit: number = 20): Promise<TokenData[]> {
    return this.api.getTrendingTokens(limit);
  }

  /**
   * Gets newly launched tokens
   */
  async getNewTokens(limit: number = 20): Promise<TokenData[]> {
    return this.api.getNewTokens(limit);
  }

  /**
   * Gets a quote for a trade
   */
  async getTradeQuote(
    tokenAddress: Address,
    amountIn: bigint,
    isBuy: boolean
  ): Promise<TradeQuote | null> {
    return this.api.getQuote(tokenAddress, amountIn, isBuy);
  }

  /**
   * Gets portfolio for an address
   */
  async getPortfolio(address: Address): Promise<{
    tokens: Array<{ token: TokenData; balance: bigint; value: number }>;
    totalValue: number;
  }> {
    return this.api.getPortfolio(address);
  }

  // ============================================
  // WRITE OPERATIONS (Require Security Checks)
  // ============================================

  /**
   * Launches a new token on nad.fun
   * 
   * SECURITY: Requires manual approval if MANUAL_APPROVAL=true
   */
  async launchToken(params: TokenLaunchParams): Promise<LaunchResult> {
    const valueMon = 0; // Token launch typically doesn't require MON value
    const description = `Launch token ${params.symbol} (${params.name})`;
    
    // Pre-flight security checks
    const check = await this.preflightWriteCheck(
      "TOKEN_LAUNCH",
      valueMon,
      description,
      { params }
    );

    if (!check.canProceed) {
      return {
        success: false,
        error: check.reason,
        approvalId: check.approvalId,
      };
    }

    try {
      // Execute token launch
      logger.info({ symbol: params.symbol, name: params.name }, "Launching token");

      // This would call the nad.fun contract
      // For now, return placeholder - actual implementation depends on nad.fun contract ABI
      throw new Error("Token launch implementation requires nad.fun contract ABI");
    } catch (error) {
      logger.error({ error, params }, "Token launch failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Executes a buy order on nad.fun
   * 
   * SECURITY: Requires manual approval if MANUAL_APPROVAL=true
   */
  async buyToken(
    tokenAddress: Address,
    amountMon: number,
    minAmountOut: bigint = 0n
  ): Promise<TradeResult> {
    const description = `Buy token at ${tokenAddress} for ${amountMon} MON`;
    
    // Pre-flight security checks
    const check = await this.preflightWriteCheck(
      "TOKEN_BUY",
      amountMon,
      description,
      { tokenAddress, amountMon, minAmountOut: minAmountOut.toString() }
    );

    if (!check.canProceed) {
      return {
        success: false,
        error: check.reason,
        approvalId: check.approvalId,
      };
    }

    try {
      logger.info({ tokenAddress, amountMon }, "Executing buy order");

      // Get quote first
      const amountWei = parseEther(amountMon.toString());
      const quote = await this.api.getQuote(tokenAddress, amountWei, true);
      
      if (!quote) {
        throw new Error("Failed to get trade quote");
      }

      // Actual trade execution would go here
      // This requires the nad.fun contract ABI and router address
      throw new Error("Trade execution requires nad.fun contract integration");
    } catch (error) {
      logger.error({ error, tokenAddress, amountMon }, "Buy order failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Executes a sell order on nad.fun
   * 
   * SECURITY: Requires manual approval if MANUAL_APPROVAL=true
   */
  async sellToken(
    tokenAddress: Address,
    amountTokens: bigint,
    minAmountOut: bigint = 0n
  ): Promise<TradeResult> {
    const amountMon = 0; // Selling tokens, not spending MON
    const description = `Sell ${formatEther(amountTokens)} tokens at ${tokenAddress}`;
    
    // Pre-flight security checks
    const check = await this.preflightWriteCheck(
      "TOKEN_SELL",
      amountMon,
      description,
      { tokenAddress, amountTokens: amountTokens.toString(), minAmountOut: minAmountOut.toString() }
    );

    if (!check.canProceed) {
      return {
        success: false,
        error: check.reason,
        approvalId: check.approvalId,
      };
    }

    try {
      logger.info({ tokenAddress, amountTokens: formatEther(amountTokens) }, "Executing sell order");

      // Get quote first
      const quote = await this.api.getQuote(tokenAddress, amountTokens, false);
      
      if (!quote) {
        throw new Error("Failed to get trade quote");
      }

      // Actual trade execution would go here
      throw new Error("Trade execution requires nad.fun contract integration");
    } catch (error) {
      logger.error({ error, tokenAddress }, "Sell order failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ============================================
  // APPROVED EXECUTION
  // ============================================

  /**
   * Executes a previously approved action
   * Called by the orchestrator after manual approval
   */
  async executeApprovedAction(
    approvalId: string,
    approvedBy: string
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    // This would retrieve the approval from the database and execute it
    // For now, return placeholder
    logger.info({ approvalId, approvedBy }, "Executing approved action");
    
    return {
      success: false,
      error: "Approved action execution requires database integration",
    };
  }

  // ============================================
  // FINALITY
  // ============================================

  /**
   * Waits for economic finality (800ms / 2 blocks on Monad)
   * Call this before confirming any financial action to the UI
   */
  async waitForEconomicFinality(txHash: Hash): Promise<{
    confirmed: boolean;
    blockNumber?: bigint;
    gasUsed?: bigint;
  }> {
    try {
      // Wait for block confirmation
      const receipt = await this.client.public.waitForTransactionReceipt({
        hash: txHash,
        confirmations: FINALITY.blocks,
      });

      // Additional wait for economic finality
      await waitForFinality();

      this.emit("transaction:confirmed", txHash, receipt.blockNumber);

      return {
        confirmed: receipt.status === "success",
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.emit("transaction:failed", txHash, errorMessage);
      
      return {
        confirmed: false,
      };
    }
  }
}
