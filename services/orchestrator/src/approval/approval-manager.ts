/**
 * Approval Manager
 * Handles manual approval workflow for NEURO actions
 */

import { EventEmitter } from "eventemitter3";
import { orchestratorLogger as logger, type ApprovalStatus } from "@neuro/shared";
import type { OrchestratorConfig } from "../config.js";
import type { ProposedAction } from "../graph/state.js";

// ============================================
// TYPES
// ============================================

export interface ApprovalRequest {
  id: string;
  decisionId: string;
  action: ProposedAction;
  reasoning: string;
  createdAt: Date;
  expiresAt: Date;
  status: ApprovalStatus;
  approvedBy?: string;
  rejectedReason?: string;
}

export interface ApprovalResult {
  status: ApprovalStatus;
  approvedBy?: string;
  reason?: string;
}

export interface ApprovalManagerEvents {
  "approval:created": (request: ApprovalRequest) => void;
  "approval:decided": (id: string, result: ApprovalResult) => void;
  "approval:expired": (id: string) => void;
}

// ============================================
// APPROVAL MANAGER
// ============================================

export class ApprovalManager extends EventEmitter<ApprovalManagerEvents> {
  private readonly config: OrchestratorConfig;
  private readonly pendingApprovals: Map<string, ApprovalRequest> = new Map();
  private readonly approvalResolvers: Map<
    string,
    { resolve: (result: ApprovalResult) => void; reject: (error: Error) => void }
  > = new Map();

  constructor(config: OrchestratorConfig) {
    super();
    this.config = config;

    // Start expiration checker
    this.startExpirationChecker();

    logger.info("ApprovalManager initialized");
  }

  // ============================================
  // CREATE APPROVAL REQUEST
  // ============================================

  async createApprovalRequest(params: {
    decisionId: string;
    action: ProposedAction;
    reasoning: string;
  }): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

    const request: ApprovalRequest = {
      id,
      decisionId: params.decisionId,
      action: params.action,
      reasoning: params.reasoning,
      createdAt: now,
      expiresAt,
      status: "pending",
    };

    this.pendingApprovals.set(id, request);

    logger.info({
      approvalId: id,
      decisionId: params.decisionId,
      action: params.action.type,
      expiresAt,
    }, "Approval request created");

    this.emit("approval:created", request);

    // In production, this would also:
    // 1. Persist to database
    // 2. Send notification to dashboard
    // 3. Send webhook/push notification

    return id;
  }

  // ============================================
  // WAIT FOR APPROVAL
  // ============================================

  async waitForApproval(
    approvalId: string,
    timeoutMs: number = 300000
  ): Promise<ApprovalResult> {
    const request = this.pendingApprovals.get(approvalId);
    if (!request) {
      throw new Error(`Approval request ${approvalId} not found`);
    }

    // Already decided
    if (request.status !== "pending") {
      return {
        status: request.status,
        approvedBy: request.approvedBy,
        reason: request.rejectedReason,
      };
    }

    // Wait for decision
    return new Promise((resolve, reject) => {
      // Store resolver
      this.approvalResolvers.set(approvalId, { resolve, reject });

      // Set timeout
      const timeout = setTimeout(() => {
        this.approvalResolvers.delete(approvalId);
        this.expireApproval(approvalId);
        resolve({ status: "expired" });
      }, timeoutMs);

      // Clean up on resolution
      const originalResolve = resolve;
      this.approvalResolvers.set(approvalId, {
        resolve: (result) => {
          clearTimeout(timeout);
          originalResolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  // ============================================
  // APPROVE / REJECT
  // ============================================

  /**
   * Approves a pending request
   * Called from dashboard when operator approves
   */
  approve(approvalId: string, approvedBy: string): void {
    const request = this.pendingApprovals.get(approvalId);
    if (!request) {
      throw new Error(`Approval request ${approvalId} not found`);
    }

    if (request.status !== "pending") {
      throw new Error(`Approval ${approvalId} already decided: ${request.status}`);
    }

    // Check expiration
    if (new Date() > request.expiresAt) {
      this.expireApproval(approvalId);
      throw new Error(`Approval ${approvalId} has expired`);
    }

    request.status = "approved";
    request.approvedBy = approvedBy;

    logger.info({
      approvalId,
      approvedBy,
      action: request.action.type,
    }, "Approval granted");

    const result: ApprovalResult = {
      status: "approved",
      approvedBy,
    };

    this.emit("approval:decided", approvalId, result);

    // Resolve waiting promise
    const resolver = this.approvalResolvers.get(approvalId);
    if (resolver) {
      resolver.resolve(result);
      this.approvalResolvers.delete(approvalId);
    }
  }

  /**
   * Rejects a pending request
   * Called from dashboard when operator rejects
   */
  reject(approvalId: string, rejectedBy: string, reason: string): void {
    const request = this.pendingApprovals.get(approvalId);
    if (!request) {
      throw new Error(`Approval request ${approvalId} not found`);
    }

    if (request.status !== "pending") {
      throw new Error(`Approval ${approvalId} already decided: ${request.status}`);
    }

    request.status = "rejected";
    request.approvedBy = rejectedBy;
    request.rejectedReason = reason;

    logger.info({
      approvalId,
      rejectedBy,
      reason,
      action: request.action.type,
    }, "Approval rejected");

    const result: ApprovalResult = {
      status: "rejected",
      approvedBy: rejectedBy,
      reason,
    };

    this.emit("approval:decided", approvalId, result);

    // Resolve waiting promise
    const resolver = this.approvalResolvers.get(approvalId);
    if (resolver) {
      resolver.resolve(result);
      this.approvalResolvers.delete(approvalId);
    }
  }

  // ============================================
  // EXPIRATION
  // ============================================

  private expireApproval(approvalId: string): void {
    const request = this.pendingApprovals.get(approvalId);
    if (!request || request.status !== "pending") {
      return;
    }

    request.status = "expired";

    logger.warn({
      approvalId,
      action: request.action.type,
    }, "Approval expired");

    this.emit("approval:expired", approvalId);
  }

  private startExpirationChecker(): void {
    setInterval(() => {
      const now = new Date();
      for (const [id, request] of this.pendingApprovals) {
        if (request.status === "pending" && now > request.expiresAt) {
          this.expireApproval(id);
        }
      }
    }, 10000); // Check every 10 seconds
  }

  // ============================================
  // QUERIES
  // ============================================

  getPendingApprovals(): ApprovalRequest[] {
    return Array.from(this.pendingApprovals.values()).filter(
      (r) => r.status === "pending"
    );
  }

  getApproval(id: string): ApprovalRequest | undefined {
    return this.pendingApprovals.get(id);
  }

  getApprovalsByDecision(decisionId: string): ApprovalRequest[] {
    return Array.from(this.pendingApprovals.values()).filter(
      (r) => r.decisionId === decisionId
    );
  }
}
