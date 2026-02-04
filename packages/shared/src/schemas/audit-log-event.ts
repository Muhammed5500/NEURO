/**
 * AuditLogEvent Schema
 * Comprehensive audit logging for security and compliance
 * 
 * @version 1.0.0
 * @backward-compatibility
 * - v1.0.0: Initial schema
 */

import { z } from "zod";
import {
  createVersionedSchema,
  addressSchema,
  txHashSchema,
  uuidSchema,
  severitySchema,
  CURRENT_SCHEMA_VERSION,
} from "./common.js";

// ============================================
// SCHEMA DEFINITION
// ============================================

export const auditActionSchema = z.enum([
  // System actions
  "system_start",
  "system_stop",
  "config_change",
  "kill_switch_activate",
  "kill_switch_deactivate",
  "execution_mode_change",
  
  // Authentication/Authorization
  "login",
  "logout",
  "permission_grant",
  "permission_revoke",
  
  // Decision workflow
  "decision_created",
  "decision_approved",
  "decision_rejected",
  "decision_expired",
  
  // Execution
  "execution_planned",
  "execution_approved",
  "execution_rejected",
  "execution_submitted",
  "execution_confirmed",
  "execution_failed",
  "execution_cancelled",
  
  // Data operations
  "data_ingested",
  "data_processed",
  "data_deleted",
  
  // Wallet operations
  "wallet_connected",
  "wallet_disconnected",
  "balance_checked",
  
  // Agent actions
  "agent_opinion_created",
  "consensus_reached",
  
  // Security events
  "security_alert",
  "rate_limit_exceeded",
  "validation_failed",
  "suspicious_activity",
  
  // Custom
  "custom",
]);

export type AuditAction = z.infer<typeof auditActionSchema>;

export const auditCategorySchema = z.enum([
  "system",
  "security",
  "authentication",
  "decision",
  "execution",
  "data",
  "wallet",
  "agent",
  "error",
]);

export type AuditCategory = z.infer<typeof auditCategorySchema>;

export const auditLogEventSchema = createVersionedSchema({
  // Action classification
  action: auditActionSchema,
  category: auditCategorySchema,
  
  // Actor information
  actorType: z.enum(["system", "user", "agent", "api", "scheduler"]),
  actorId: z.string(),
  actorName: z.string().optional(),
  actorAddress: addressSchema.optional(),
  
  // Target information
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  targetName: z.string().optional(),
  
  // Event details
  description: z.string(),
  details: z.record(z.unknown()).default({}),
  
  // Related entities
  relatedIds: z.object({
    decisionId: uuidSchema.optional(),
    executionPlanId: uuidSchema.optional(),
    transactionHash: txHashSchema.optional(),
    sessionId: z.string().optional(),
  }).default({}),
  
  // Result
  success: z.boolean(),
  errorMessage: z.string().optional(),
  errorCode: z.string().optional(),
  
  // Risk/Severity
  severity: severitySchema,
  
  // Client information
  clientInfo: z.object({
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
    origin: z.string().optional(),
  }).default({}),
  
  // Chain information (if applicable)
  chainId: z.number().int().optional(),
  blockNumber: z.number().int().optional(),
  
  // Timing
  eventTimestamp: z.string().datetime(),
  processingTimestamp: z.string().datetime().optional(),
  
  // Retention
  retentionDays: z.number().int().min(1).default(90),
  
  // Tags for querying
  tags: z.array(z.string()).default([]),
});

export type AuditLogEvent = z.infer<typeof auditLogEventSchema>;

// ============================================
// FACTORY FUNCTIONS
// ============================================

// Input type for creating audit events - only required fields
export interface CreateAuditLogEventInput {
  action: AuditAction;
  category: z.infer<typeof auditCategorySchema>;
  actorType: "system" | "user" | "agent" | "api" | "scheduler";
  actorId: string;
  description: string;
  success: boolean;
  severity: z.infer<typeof severitySchema>;
  eventTimestamp: string;
  // Optional fields
  actorName?: string;
  actorAddress?: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  details?: Record<string, unknown>;
  relatedIds?: {
    decisionId?: string;
    executionPlanId?: string;
    transactionHash?: string;
    sessionId?: string;
  };
  errorMessage?: string;
  errorCode?: string;
  clientInfo?: {
    ipAddress?: string;
    userAgent?: string;
    origin?: string;
  };
  chainId?: number;
  blockNumber?: number;
  processingTimestamp?: string;
  retentionDays?: number;
  tags?: string[];
}

export function createAuditLogEvent(data: CreateAuditLogEventInput): AuditLogEvent {
  return auditLogEventSchema.parse({
    ...data,
    id: crypto.randomUUID(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    // Apply defaults for optional fields
    details: data.details ?? {},
    relatedIds: data.relatedIds ?? {},
    clientInfo: data.clientInfo ?? {},
    retentionDays: data.retentionDays ?? 90,
    tags: data.tags ?? [],
  });
}

// Convenience factory for common audit events
export const auditHelpers = {
  systemEvent: (action: AuditAction, description: string, details?: Record<string, unknown>) =>
    createAuditLogEvent({
      action,
      category: "system",
      actorType: "system",
      actorId: "neuro-system",
      description,
      details: details || {},
      success: true,
      severity: "low",
      eventTimestamp: new Date().toISOString(),
    }),

  securityEvent: (action: AuditAction, description: string, severity: "low" | "medium" | "high" | "critical", details?: Record<string, unknown>) =>
    createAuditLogEvent({
      action,
      category: "security",
      actorType: "system",
      actorId: "neuro-security",
      description,
      details: details || {},
      success: true,
      severity,
      eventTimestamp: new Date().toISOString(),
      tags: ["security"],
    }),

  executionEvent: (action: AuditAction, executionPlanId: string, success: boolean, details?: Record<string, unknown>) =>
    createAuditLogEvent({
      action,
      category: "execution",
      actorType: "agent",
      actorId: "neuro-executor",
      description: `Execution ${action}: ${executionPlanId}`,
      details: details || {},
      success,
      severity: success ? "low" : "high",
      relatedIds: { executionPlanId },
      eventTimestamp: new Date().toISOString(),
      tags: ["execution"],
    }),
};

// ============================================
// EXAMPLES & FIXTURES
// ============================================

export const auditLogEventExamples: AuditLogEvent[] = [
  {
    schemaVersion: "1.0.0",
    id: "550e8400-e29b-41d4-a716-446655440070",
    createdAt: "2024-01-15T14:15:00Z",
    action: "execution_approved",
    category: "execution",
    actorType: "user",
    actorId: "admin-001",
    actorName: "Admin User",
    targetType: "execution_plan",
    targetId: "550e8400-e29b-41d4-a716-446655440060",
    description: "Manual approval granted for token buy execution",
    details: {
      tokenSymbol: "PEPE",
      valueMon: 0.1,
      riskLevel: "medium",
    },
    relatedIds: {
      executionPlanId: "550e8400-e29b-41d4-a716-446655440060",
      decisionId: "550e8400-e29b-41d4-a716-446655440050",
    },
    success: true,
    severity: "medium",
    clientInfo: {
      ipAddress: "192.168.1.100",
      userAgent: "Mozilla/5.0...",
      origin: "https://dashboard.neuro.local",
    },
    chainId: 143,
    eventTimestamp: "2024-01-15T14:15:00Z",
    processingTimestamp: "2024-01-15T14:15:01Z",
    retentionDays: 90,
    tags: ["execution", "approval", "manual"],
  },
  {
    schemaVersion: "1.0.0",
    id: "550e8400-e29b-41d4-a716-446655440071",
    createdAt: "2024-01-15T14:00:00Z",
    action: "kill_switch_activate",
    category: "security",
    actorType: "user",
    actorId: "admin-001",
    actorName: "Admin User",
    description: "Kill switch activated due to suspicious activity",
    details: {
      reason: "Multiple failed transactions detected",
      previousState: "disabled",
      newState: "enabled",
    },
    relatedIds: {},
    success: true,
    severity: "critical",
    clientInfo: {
      ipAddress: "192.168.1.100",
    },
    eventTimestamp: "2024-01-15T14:00:00Z",
    retentionDays: 365,
    tags: ["security", "kill_switch", "critical"],
  },
];
