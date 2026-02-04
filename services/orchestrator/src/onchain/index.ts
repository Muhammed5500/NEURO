/**
 * OnChain Module Exports
 * 
 * Provides on-chain data access for the NEURO orchestrator.
 */

// Types
export * from "./types.js";

// Cache
export * from "./cache.js";

// Providers
export * from "./monad-rpc-client.js";
export * from "./simulation-provider.js";

// Analysis tools
export * from "./bot-radar.js";
export * from "./price-impact.js";

// High-level service
export * from "./onchain-data-service.js";

// ============================================
// PROVIDER FACTORY
// ============================================

import type { OnChainDataProvider } from "./monad-rpc-client.js";
import { MonadRpcClient } from "./monad-rpc-client.js";
import { SimulationProvider, SIMULATION_SCENARIOS } from "./simulation-provider.js";

export interface OnChainProviderConfig {
  // Provider mode
  mode: "production" | "simulation";
  
  // RPC URL (for production)
  rpcUrl?: string;
  chainId?: number;
  
  // Simulation scenario (for dev)
  simulationScenario?: keyof typeof SIMULATION_SCENARIOS;
}

/**
 * Create on-chain data provider based on configuration.
 * Allows switching between production and simulation without code changes.
 */
export function createOnChainProvider(
  config: OnChainProviderConfig
): OnChainDataProvider {
  if (config.mode === "simulation") {
    return new SimulationProvider(config.simulationScenario || "HEALTHY_MARKET");
  }

  if (!config.rpcUrl) {
    throw new Error("RPC URL required for production mode");
  }

  return new MonadRpcClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId || 143,
  });
}

/**
 * Create provider from environment variables
 */
export function createProviderFromEnv(): OnChainDataProvider {
  const useSimulation = process.env.USE_SIMULATION_PROVIDER === "true" ||
                        process.env.NODE_ENV === "development";
  
  if (useSimulation) {
    const scenario = (process.env.SIMULATION_SCENARIO || "HEALTHY_MARKET") as keyof typeof SIMULATION_SCENARIOS;
    return new SimulationProvider(scenario);
  }

  const rpcUrl = process.env.MONAD_RPC_URL;
  if (!rpcUrl) {
    console.warn("MONAD_RPC_URL not set, falling back to simulation provider");
    return new SimulationProvider();
  }

  return new MonadRpcClient({
    rpcUrl,
    chainId: parseInt(process.env.MONAD_CHAIN_ID || "143"),
  });
}
