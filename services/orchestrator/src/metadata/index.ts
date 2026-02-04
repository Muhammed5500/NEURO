/**
 * Metadata Module Exports
 * 
 * Provides token metadata management for the NEURO orchestrator:
 * - Metadata building with SHA-256 integrity
 * - Multi-provider IPFS pinning
 * - Milestone-based triggers
 * - Version history with JSON Patch diffs
 * - Rate limiting and audit logging
 */

// Types
export * from "./types.js";

// Metadata builder
export * from "./metadata-builder.js";

// IPFS providers
export * from "./ipfs-provider.js";

// Milestone triggers
export * from "./milestone-trigger.js";

// Version history
export * from "./version-history.js";

// Main service
export * from "./metadata-service.js";
