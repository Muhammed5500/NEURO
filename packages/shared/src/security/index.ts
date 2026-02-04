/**
 * NEURO Security Policies
 * Kill switch, execution mode, and access control
 */

import { SECURITY_DEFAULTS, EXECUTION_MODES, GAS_CONFIG, FINALITY } from "../constants/index.js";
import type { SecurityConfig, KillSwitchState, GasEstimate } from "../types/index.js";
import { logger } from "../logger/index.js";

// ============================================
// SECURITY STATE (In-Memory for Fast Access)
// ============================================

let securityState: SecurityConfig = {
  executionMode: SECURITY_DEFAULTS.executionMode,
  manualApprovalRequired: SECURITY_DEFAULTS.manualApprovalRequired,
  killSwitchEnabled: SECURITY_DEFAULTS.killSwitchEnabled,
  maxSingleTxValueMon: SECURITY_DEFAULTS.maxSingleTxValueMon,
};

let killSwitchState: KillSwitchState = {
  enabled: false,
};

// ============================================
// KILL SWITCH OPERATIONS
// ============================================

/**
 * Activates the kill switch, immediately disabling all write operations
 */
export function activateKillSwitch(enabledBy: string, reason: string): void {
  killSwitchState = {
    enabled: true,
    enabledBy,
    enabledAt: new Date(),
    reason,
  };
  securityState.killSwitchEnabled = true;

  logger.warn({
    event: "KILL_SWITCH_ACTIVATED",
    enabledBy,
    reason,
    timestamp: killSwitchState.enabledAt,
  });
}

/**
 * Deactivates the kill switch (requires explicit confirmation)
 */
export function deactivateKillSwitch(disabledBy: string, confirmationCode: string): boolean {
  // Require a specific confirmation code to prevent accidental deactivation
  // In production, this should be a time-based OTP or hardware key
  if (confirmationCode !== "CONFIRM_DEACTIVATE_KILL_SWITCH") {
    logger.error({
      event: "KILL_SWITCH_DEACTIVATION_FAILED",
      disabledBy,
      reason: "Invalid confirmation code",
    });
    return false;
  }

  const previousState = { ...killSwitchState };
  killSwitchState = {
    enabled: false,
  };
  securityState.killSwitchEnabled = false;

  logger.info({
    event: "KILL_SWITCH_DEACTIVATED",
    disabledBy,
    previousState,
    timestamp: new Date(),
  });

  return true;
}

/**
 * Checks if the kill switch is currently active
 */
export function isKillSwitchActive(): boolean {
  return killSwitchState.enabled;
}

/**
 * Gets the current kill switch state
 */
export function getKillSwitchState(): KillSwitchState {
  return { ...killSwitchState };
}

// ============================================
// EXECUTION MODE OPERATIONS
// ============================================

/**
 * Sets the execution mode
 */
export function setExecutionMode(mode: "READ_ONLY" | "WRITE_ENABLED", setBy: string): boolean {
  // Cannot enable writes if kill switch is active
  if (mode === EXECUTION_MODES.WRITE_ENABLED && killSwitchState.enabled) {
    logger.error({
      event: "EXECUTION_MODE_CHANGE_BLOCKED",
      requestedMode: mode,
      setBy,
      reason: "Kill switch is active",
    });
    return false;
  }

  const previousMode = securityState.executionMode;
  securityState.executionMode = mode;

  logger.info({
    event: "EXECUTION_MODE_CHANGED",
    previousMode,
    newMode: mode,
    setBy,
    timestamp: new Date(),
  });

  return true;
}

/**
 * Gets the current execution mode
 */
export function getExecutionMode(): "READ_ONLY" | "WRITE_ENABLED" {
  return securityState.executionMode;
}

/**
 * Checks if write operations are allowed
 */
export function canWrite(): boolean {
  return (
    !killSwitchState.enabled &&
    securityState.executionMode === EXECUTION_MODES.WRITE_ENABLED
  );
}

/**
 * Checks if manual approval is required
 */
export function isManualApprovalRequired(): boolean {
  return securityState.manualApprovalRequired;
}

// ============================================
// SECURITY CONFIG OPERATIONS
// ============================================

/**
 * Gets the current security configuration
 */
export function getSecurityConfig(): SecurityConfig {
  return { ...securityState };
}

/**
 * Updates security configuration (partial update)
 */
export function updateSecurityConfig(
  updates: Partial<Omit<SecurityConfig, "killSwitchEnabled">>,
  updatedBy: string
): void {
  const previousConfig = { ...securityState };
  securityState = {
    ...securityState,
    ...updates,
  };

  logger.info({
    event: "SECURITY_CONFIG_UPDATED",
    previousConfig,
    newConfig: securityState,
    updatedBy,
    timestamp: new Date(),
  });
}

// ============================================
// TRANSACTION VALIDATION
// ============================================

/**
 * Validates if a transaction can be executed
 */
export function validateTransactionExecution(
  valueMon: number,
  isWrite: boolean
): { allowed: boolean; reason?: string } {
  // Check kill switch
  if (killSwitchState.enabled) {
    return {
      allowed: false,
      reason: `Kill switch is active: ${killSwitchState.reason}`,
    };
  }

  // Check execution mode for write operations
  if (isWrite && securityState.executionMode === EXECUTION_MODES.READ_ONLY) {
    return {
      allowed: false,
      reason: "System is in READ_ONLY mode. Write operations are disabled.",
    };
  }

  // Check transaction value limit
  if (valueMon > securityState.maxSingleTxValueMon) {
    return {
      allowed: false,
      reason: `Transaction value ${valueMon} MON exceeds maximum allowed ${securityState.maxSingleTxValueMon} MON`,
    };
  }

  return { allowed: true };
}

// ============================================
// GAS CALCULATION (MONAD SPECIFIC)
// ============================================

/**
 * Calculates gas with Monad-specific safety buffer
 * CRITICAL: Monad charges based on GAS LIMIT, not gas used
 */
export function calculateGasWithBuffer(
  estimatedGas: bigint,
  bufferPercentage: number = GAS_CONFIG.defaultBufferPercentage
): GasEstimate {
  // Ensure buffer is within acceptable range
  const effectiveBuffer = Math.min(
    Math.max(bufferPercentage, 0),
    GAS_CONFIG.maxBufferPercentage
  );

  // Calculate gas limit with buffer
  const bufferMultiplier = BigInt(100 + effectiveBuffer);
  const gasLimitWithBuffer = (estimatedGas * bufferMultiplier) / 100n;

  // Estimate costs (using max gas price for worst case)
  const maxGasPriceWei = GAS_CONFIG.maxGasPriceGwei * 1_000_000_000n;
  const estimatedCostWei = estimatedGas * maxGasPriceWei;
  const maxCostWei = gasLimitWithBuffer * maxGasPriceWei;

  // Convert to MON (18 decimals)
  const weiPerMon = 10n ** 18n;
  const estimatedCostMon = Number(estimatedCostWei) / Number(weiPerMon);
  const maxCostMon = Number(maxCostWei) / Number(weiPerMon);

  return {
    gasLimit: estimatedGas,
    gasLimitWithBuffer,
    bufferPercentage: effectiveBuffer,
    estimatedCostWei,
    estimatedCostMon,
    maxCostWei,
    maxCostMon,
  };
}

/**
 * Calculates optimal gas for cold storage operations
 * Accounts for Monad's higher SLOAD-cold costs (8100 gas)
 */
export function calculateStorageOptimizedGas(
  baseGas: bigint,
  coldStorageReads: number,
  warmStorageReads: number
): bigint {
  const coldCost = BigInt(coldStorageReads) * GAS_CONFIG.sloadCold;
  const warmCost = BigInt(warmStorageReads) * GAS_CONFIG.sloadWarm;
  return baseGas + coldCost + warmCost;
}

// ============================================
// FINALITY HELPERS
// ============================================

/**
 * Returns the required wait time for economic finality
 */
export function getFinalityWaitMs(): number {
  return FINALITY.waitMs;
}

/**
 * Returns the required block confirmations for economic finality
 */
export function getFinalityBlocks(): number {
  return FINALITY.blocks;
}

/**
 * Creates a promise that resolves after economic finality wait time
 */
export function waitForFinality(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, FINALITY.waitMs));
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initializes security module with configuration
 */
export function initializeSecurity(config: Partial<SecurityConfig>): void {
  securityState = {
    ...securityState,
    ...config,
  };

  logger.info({
    event: "SECURITY_INITIALIZED",
    config: securityState,
    timestamp: new Date(),
  });
}
