/**
 * Gas Calculator for Monad
 * 
 * CRITICAL: Monad charges based on GAS LIMIT, not gas used.
 * All estimates MUST include safety buffer to prevent failed transactions.
 */

import type { MonadClient } from "../client/monad-client.js";
import {
  GAS_CONFIG,
  calculateGasWithBuffer,
  calculateStorageOptimizedGas,
  executionLogger as logger,
  type GasEstimate,
} from "@neuro/shared";
import { formatGwei, parseGwei } from "viem";

// ============================================
// GAS ESTIMATION
// ============================================

export interface GasEstimationParams {
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
  from?: `0x${string}`;
}

/**
 * Estimates gas for a transaction with Monad-specific buffer
 * 
 * IMPORTANT: Monad charges based on GAS LIMIT, not actual gas used.
 * We add a 10-15% buffer to prevent failed transactions.
 */
export async function estimateGas(
  client: MonadClient,
  params: GasEstimationParams,
  bufferPercentage: number = client.config.gasBufferPercentage
): Promise<GasEstimate> {
  const from = params.from || client.account?.address;
  
  if (!from) {
    throw new Error("From address required for gas estimation");
  }

  try {
    // Get base gas estimate from node
    const estimatedGas = await client.public.estimateGas({
      to: params.to,
      data: params.data,
      value: params.value,
      account: from,
    });

    // Apply Monad-specific buffer calculation
    const gasEstimate = calculateGasWithBuffer(estimatedGas, bufferPercentage);

    logger.debug({
      estimated: estimatedGas.toString(),
      withBuffer: gasEstimate.gasLimitWithBuffer.toString(),
      bufferPercentage,
    }, "Gas estimated with buffer");

    return gasEstimate;
  } catch (error) {
    logger.error({ error, params }, "Gas estimation failed");
    throw error;
  }
}

/**
 * Estimates gas for token operations with cold storage considerations
 * 
 * Monad SLOAD-cold is 8100 gas (4x higher than Ethereum's 2100)
 */
export async function estimateTokenOperationGas(
  client: MonadClient,
  params: GasEstimationParams,
  coldStorageReads: number = 2, // Default: token balance + allowance
  warmStorageReads: number = 0
): Promise<GasEstimate> {
  const from = params.from || client.account?.address;
  
  if (!from) {
    throw new Error("From address required for gas estimation");
  }

  try {
    // Get base gas estimate
    const baseGas = await client.public.estimateGas({
      to: params.to,
      data: params.data,
      value: params.value,
      account: from,
    });

    // Add cold storage costs for Monad
    const optimizedGas = calculateStorageOptimizedGas(
      baseGas,
      coldStorageReads,
      warmStorageReads
    );

    // Apply buffer
    const gasEstimate = calculateGasWithBuffer(
      optimizedGas,
      client.config.gasBufferPercentage
    );

    logger.debug({
      baseGas: baseGas.toString(),
      withStorageCosts: optimizedGas.toString(),
      final: gasEstimate.gasLimitWithBuffer.toString(),
      coldReads: coldStorageReads,
    }, "Token operation gas estimated");

    return gasEstimate;
  } catch (error) {
    logger.error({ error, params }, "Token operation gas estimation failed");
    throw error;
  }
}

// ============================================
// OPERATION-SPECIFIC GAS ESTIMATES
// ============================================

/**
 * Returns pre-calculated gas estimates for common operations
 */
export function getOperationGasEstimate(
  operation: keyof typeof GAS_CONFIG.operations,
  bufferPercentage: number = GAS_CONFIG.defaultBufferPercentage
): GasEstimate {
  const baseGas = GAS_CONFIG.operations[operation];
  return calculateGasWithBuffer(baseGas, bufferPercentage);
}

/**
 * Estimates gas for a token launch on nad.fun
 */
export async function estimateTokenLaunchGas(
  client: MonadClient
): Promise<GasEstimate> {
  // Token launch involves multiple storage writes
  // Use conservative estimate with cold storage costs
  const baseGas = GAS_CONFIG.operations.tokenLaunch;
  const coldStorageReads = 5; // Contract state, balances, etc.
  
  const optimizedGas = calculateStorageOptimizedGas(baseGas, coldStorageReads, 0);
  return calculateGasWithBuffer(optimizedGas, client.config.gasBufferPercentage);
}

/**
 * Estimates gas for a swap operation
 */
export async function estimateSwapGas(
  client: MonadClient,
  isComplexPath: boolean = false
): Promise<GasEstimate> {
  const baseGas = isComplexPath
    ? GAS_CONFIG.operations.complexTrade
    : GAS_CONFIG.operations.swap;
  
  // Swaps typically involve multiple cold storage reads
  const coldStorageReads = isComplexPath ? 6 : 4;
  
  const optimizedGas = calculateStorageOptimizedGas(baseGas, coldStorageReads, 0);
  return calculateGasWithBuffer(optimizedGas, client.config.gasBufferPercentage);
}

// ============================================
// GAS PRICE MONITORING
// ============================================

/**
 * Gets current gas price and compares to configured maximum
 */
export async function checkGasPrice(client: MonadClient): Promise<{
  current: bigint;
  max: bigint;
  acceptable: boolean;
  currentGwei: string;
  maxGwei: string;
}> {
  const currentGasPrice = await client.public.getGasPrice();
  const maxGasPrice = parseGwei(client.config.maxGasPriceGwei.toString());
  
  return {
    current: currentGasPrice,
    max: maxGasPrice,
    acceptable: currentGasPrice <= maxGasPrice,
    currentGwei: formatGwei(currentGasPrice),
    maxGwei: formatGwei(maxGasPrice),
  };
}

/**
 * Waits for acceptable gas price before proceeding
 */
export async function waitForAcceptableGasPrice(
  client: MonadClient,
  maxWaitMs: number = 60000,
  pollIntervalMs: number = 5000
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    const { acceptable, currentGwei, maxGwei } = await checkGasPrice(client);
    
    if (acceptable) {
      logger.info({ currentGwei, maxGwei }, "Gas price acceptable");
      return;
    }

    logger.debug({ currentGwei, maxGwei }, "Gas price too high, waiting...");
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Gas price did not reach acceptable level within ${maxWaitMs}ms`);
}

// ============================================
// COST CALCULATION
// ============================================

/**
 * Calculates the total cost of a transaction in MON
 */
export function calculateTransactionCost(
  gasLimit: bigint,
  gasPrice: bigint
): { wei: bigint; mon: number } {
  const costWei = gasLimit * gasPrice;
  const costMon = Number(costWei) / 1e18;
  
  return { wei: costWei, mon: costMon };
}

/**
 * Validates that operator wallet has sufficient balance for transaction
 */
export async function validateSufficientBalance(
  client: MonadClient,
  estimatedCostWei: bigint,
  additionalValueWei: bigint = 0n
): Promise<{ sufficient: boolean; balance: bigint; required: bigint }> {
  if (!client.account) {
    throw new Error("No account configured");
  }

  const balance = await client.public.getBalance({
    address: client.account.address,
  });
  
  const required = estimatedCostWei + additionalValueWei;
  const sufficient = balance >= required;

  if (!sufficient) {
    logger.warn({
      balance: balance.toString(),
      required: required.toString(),
      shortfall: (required - balance).toString(),
    }, "Insufficient balance for transaction");
  }

  return { sufficient, balance, required };
}
