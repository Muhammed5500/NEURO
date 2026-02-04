/**
 * Execution Service Configuration
 */

import { z } from "zod";
import { envSchema, MONAD_MAINNET, NADFUN_API, SECURITY_DEFAULTS } from "@neuro/shared";

// ============================================
// EXECUTION CONFIG SCHEMA
// ============================================

const executionConfigSchema = z.object({
  // Network
  chainId: z.number(),
  rpcUrl: z.string().url(),
  rpcUrlWs: z.string(),
  
  // nad.fun API
  nadfunApiUrl: z.string().url(),
  nadfunApiKey: z.string().optional(),
  
  // Security
  executionMode: z.enum(["READ_ONLY", "WRITE_ENABLED"]),
  manualApproval: z.boolean(),
  killSwitchEnabled: z.boolean(),
  maxSingleTxValueMon: z.number(),
  
  // Wallets
  operatorAddress: z.string().optional(),
  operatorPrivateKey: z.string().optional(),
  treasuryAddress: z.string().optional(),
  
  // Gas
  gasBufferPercentage: z.number(),
  maxGasPriceGwei: z.number(),
  
  // Finality
  finalityWaitMs: z.number(),
  finalityBlocks: z.number(),
  
  // Rate limiting
  nadfunRateLimitRpm: z.number(),
  rpcRateLimitRpm: z.number(),
});

export type ExecutionConfig = z.infer<typeof executionConfigSchema>;

// ============================================
// LOAD CONFIGURATION
// ============================================

export function loadConfig(): ExecutionConfig {
  // Parse environment with defaults
  const env = envSchema.parse(process.env);

  const config: ExecutionConfig = {
    // Network - Monad Mainnet (Chain ID 143)
    chainId: env.MONAD_CHAIN_ID || MONAD_MAINNET.chainId,
    rpcUrl: env.MONAD_RPC_URL || MONAD_MAINNET.rpcUrl,
    rpcUrlWs: env.MONAD_RPC_URL_WS || MONAD_MAINNET.rpcUrlWs,
    
    // nad.fun API
    nadfunApiUrl: env.NADFUN_API_URL || NADFUN_API.baseUrl,
    nadfunApiKey: env.NADFUN_API_KEY,
    
    // Security - DEFAULT: READ-ONLY with manual approval
    executionMode: env.EXECUTION_MODE,
    manualApproval: env.MANUAL_APPROVAL,
    killSwitchEnabled: env.KILL_SWITCH_ENABLED,
    maxSingleTxValueMon: env.MAX_SINGLE_TX_VALUE,
    
    // Wallets
    operatorAddress: env.OPERATOR_WALLET_ADDRESS,
    operatorPrivateKey: env.OPERATOR_PRIVATE_KEY,
    treasuryAddress: env.TREASURY_WALLET_ADDRESS,
    
    // Gas
    gasBufferPercentage: env.GAS_BUFFER_PERCENTAGE,
    maxGasPriceGwei: env.MAX_GAS_PRICE_GWEI,
    
    // Finality
    finalityWaitMs: env.FINALITY_WAIT_MS,
    finalityBlocks: env.FINALITY_BLOCKS,
    
    // Rate limiting
    nadfunRateLimitRpm: SECURITY_DEFAULTS.nadfunRateLimitRpm,
    rpcRateLimitRpm: SECURITY_DEFAULTS.rpcRateLimitRpm,
  };

  // Validate the configuration
  return executionConfigSchema.parse(config);
}

// ============================================
// VALIDATION HELPERS
// ============================================

/**
 * Validates that required wallet configuration is present for write operations
 */
export function validateWalletConfig(config: ExecutionConfig): void {
  if (config.executionMode === "WRITE_ENABLED") {
    if (!config.operatorAddress || !config.operatorPrivateKey) {
      throw new Error(
        "WRITE_ENABLED mode requires OPERATOR_WALLET_ADDRESS and OPERATOR_PRIVATE_KEY"
      );
    }
  }
}

/**
 * Returns a safe config object without sensitive data (for logging)
 */
export function getSafeConfig(config: ExecutionConfig): Omit<ExecutionConfig, "operatorPrivateKey"> {
  const { operatorPrivateKey, ...safeConfig } = config;
  return safeConfig;
}
