/**
 * Monitoring Module Exports
 * 
 * Provides bonding curve saturation monitoring and advisory signals:
 * - Bonding curve tracking
 * - Attention decay analysis
 * - Volume/liquidity divergence detection
 * - Action card generation (requires manual approval)
 */

// Types
export * from "./types.js";

// Bonding curve tracker
export * from "./curve-tracker.js";

// Attention analyzer
export * from "./attention-analyzer.js";

// Divergence detector
export * from "./divergence-detector.js";

// Action card generator
export * from "./action-card-generator.js";

// Main advisory service
export * from "./advisory-service.js";
