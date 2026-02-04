/**
 * NEURO Verification Service
 * Cross-check Agent Services for Security
 * 
 * Features:
 * - WebSearchProvider interface for verification
 * - MockWebSearchProvider for testing
 * - Recycled news detection (temporal consistency)
 * - Multi-source confirmation checking
 * - Copy-pasta/bot detection
 * - Domain diversity scoring
 * - CrossCheckReport generation
 */

import "dotenv/config";

// Export types
export * from "./types/index.js";

// Export providers
export * from "./providers/index.js";

// Export checkers
export * from "./checkers/index.js";

// Export verifiers (existing)
export * from "./verifiers/index.js";

// Export cross-check service
export * from "./cross-check-service.js";

// Export verification manager (existing)
export * from "./verification-manager.js";

import { VerificationManager } from "./verification-manager.js";
import { CrossCheckService, createCrossCheckService } from "./cross-check-service.js";
import { logger } from "@neuro/shared";

const verificationLogger = logger.child({ service: "verification" });

async function main(): Promise<void> {
  verificationLogger.info("Starting NEURO Verification Service...");

  // Initialize existing verification manager
  const manager = new VerificationManager({
    monadRpcUrl: process.env.MONAD_RPC_URL || "https://rpc.monad.xyz",
    nadfunApiUrl: process.env.NADFUN_API_URL || "https://api.nadapp.net",
  });

  await manager.initialize();

  // Initialize cross-check service
  const crossCheckService = createCrossCheckService({
    useMockProvider: process.env.USE_MOCK_PROVIDER === "true",
    staleThresholdHours: parseInt(process.env.STALE_THRESHOLD_HOURS || "6"),
    minSourcesForHighImportance: parseInt(process.env.MIN_SOURCES_HIGH_IMPORTANCE || "3"),
    minAccountsForSuspicion: parseInt(process.env.MIN_ACCOUNTS_FOR_SUSPICION || "10"),
    minOwnershipGroups: parseInt(process.env.MIN_OWNERSHIP_GROUPS || "3"),
  });

  verificationLogger.info({
    staleThresholdHours: parseInt(process.env.STALE_THRESHOLD_HOURS || "6"),
    minSourcesForHighImportance: parseInt(process.env.MIN_SOURCES_HIGH_IMPORTANCE || "3"),
  }, "Cross-check service configured");

  verificationLogger.info("NEURO Verification Service started successfully");

  // Graceful shutdown
  process.on("SIGINT", () => {
    verificationLogger.info("Shutting down NEURO Verification Service...");
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    verificationLogger.fatal({ error }, "Failed to start NEURO Verification Service");
    process.exit(1);
  });
}
