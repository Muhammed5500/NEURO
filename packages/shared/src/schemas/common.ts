/**
 * Common Schema Primitives
 * Shared types used across all schemas
 */

import { z } from "zod";

// ============================================
// SCHEMA VERSIONING
// ============================================

export const CURRENT_SCHEMA_VERSION = "1.0.0";

export const schemaVersionSchema = z.string().regex(
  /^\d+\.\d+\.\d+$/,
  "Schema version must be in semver format (e.g., 1.0.0)"
);

// ============================================
// PRIMITIVE SCHEMAS
// ============================================

/** Ethereum address validation */
export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address");

/** Transaction hash validation */
export const txHashSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "Invalid transaction hash");

/** Hex string validation */
export const hexSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]*$/, "Invalid hex string");

/**
 * Wei amount as string for precision preservation
 * CRITICAL: Monad Mainnet requires exact Wei amounts
 */
export const weiAmountSchema = z
  .string()
  .regex(/^\d+$/, "Wei amount must be a numeric string");

/** UUID validation */
export const uuidSchema = z.string().uuid();

/** ISO timestamp */
export const timestampSchema = z.string().datetime();

// ============================================
// CHAIN CONFIGURATION
// ============================================

export const MONAD_MAINNET_CHAIN_ID = 143;

export const chainIdSchema = z.number().int().positive();

// ============================================
// COMMON ENUMS
// ============================================

export const sentimentSchema = z.enum(["bullish", "bearish", "neutral"]);
export type Sentiment = z.infer<typeof sentimentSchema>;

export const severitySchema = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof severitySchema>;

export const statusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);
export type Status = z.infer<typeof statusSchema>;

// ============================================
// BASE SCHEMA WITH VERSIONING
// ============================================

export const baseSchemaFields = {
  schemaVersion: schemaVersionSchema.default(CURRENT_SCHEMA_VERSION),
  id: uuidSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema.optional(),
};

export const createVersionedSchema = <T extends z.ZodRawShape>(shape: T) => {
  return z.object({
    ...baseSchemaFields,
    ...shape,
  });
};
