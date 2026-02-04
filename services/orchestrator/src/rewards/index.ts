/**
 * Rewards Module Exports
 * 
 * Optional reward system for the NEURO orchestrator:
 * - Epoch-based caps with burn policy
 * - Reputation-weighted multipliers
 * - Anti-gaming penalties
 * - Oracle verification
 * - Audit logging
 */

// Types
export * from "./types.js";

// Epoch manager
export * from "./epoch-manager.js";

// Reputation system
export * from "./reputation-system.js";

// Oracle interface and implementations
export * from "./oracle.js";

// Main reward service
export * from "./reward-service.js";
