/**
 * Metrics Module Exports
 * 
 * Provides latency tracking and chain comparison:
 * - Ingestion, consensus, execution latency
 * - Monad vs reference chain comparisons
 * - Dashboard data with source labels
 */

// Types
export * from "./types.js";

// Latency tracker
export * from "./latency-tracker.js";

// Chain comparison
export * from "./chain-comparison.js";

// Main metrics service
export * from "./metrics-service.js";
