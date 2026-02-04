/**
 * NEURO Execution Service
 * Monad Mainnet & nad.fun Integration
 */

import "dotenv/config";

export * from "./client/monad-client.js";
export * from "./nadfun/nadfun-mainnet.js";
export * from "./nadfun/nadfun-api.js";
export * from "./gas/gas-calculator.js";
export * from "./transactions/transaction-manager.js";
export * from "./config.js";

import { createMonadClient } from "./client/monad-client.js";
import { NadFunMainnet } from "./nadfun/nadfun-mainnet.js";
import { loadConfig } from "./config.js";
import { executionLogger as logger } from "@neuro/shared";

async function main(): Promise<void> {
  logger.info("Starting NEURO Execution Service...");

  const config = loadConfig();
  
  logger.info({
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    executionMode: config.executionMode,
    manualApproval: config.manualApproval,
    killSwitch: config.killSwitchEnabled,
  }, "Configuration loaded");

  // Initialize Monad client
  const monadClient = createMonadClient(config);
  
  // Initialize nad.fun service
  const nadfun = new NadFunMainnet(config, monadClient);

  // Verify connection
  const chainId = await monadClient.public.getChainId();
  logger.info({ chainId }, "Connected to Monad Mainnet");

  // Health check
  const health = await nadfun.healthCheck();
  logger.info({ health }, "nad.fun API health check");

  logger.info("NEURO Execution Service started successfully");

  // Keep process running
  process.on("SIGINT", () => {
    logger.info("Shutting down NEURO Execution Service...");
    process.exit(0);
  });
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    logger.fatal({ error }, "Failed to start NEURO Execution Service");
    process.exit(1);
  });
}
