/**
 * SDK Configuration
 */

import { MONAD_MAINNET, NADFUN_API } from "@neuro/shared";

export interface NeuroSDKConfig {
  /** Monad RPC URL - defaults to mainnet */
  rpcUrl?: string;
  
  /** WebSocket RPC URL for subscriptions */
  rpcUrlWs?: string;
  
  /** nad.fun API URL */
  nadfunApiUrl?: string;
  
  /** nad.fun API key (optional) */
  nadfunApiKey?: string;
  
  /** Private key for signing transactions (optional) */
  privateKey?: string;
  
  /** Gas buffer percentage (10-15% recommended for Monad) */
  gasBufferPercent?: number;
}

export const DEFAULT_CONFIG: Required<Omit<NeuroSDKConfig, "nadfunApiKey" | "privateKey">> = {
  rpcUrl: MONAD_MAINNET.rpcUrl,
  rpcUrlWs: MONAD_MAINNET.rpcUrlWs,
  nadfunApiUrl: NADFUN_API.baseUrl,
  gasBufferPercent: 15,
};

export function createConfig(config: NeuroSDKConfig = {}): Required<NeuroSDKConfig> {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    nadfunApiKey: config.nadfunApiKey || "",
    privateKey: config.privateKey || "",
  };
}
