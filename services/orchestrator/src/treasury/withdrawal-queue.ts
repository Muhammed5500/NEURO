/**
 * Withdrawal Queue with Timelock
 * 
 * Manages withdrawal requests with mandatory timelock:
 * - Minimum 24-hour timelock for all withdrawals
 * - Multisig approval support
 * - Kill switch integration for emergency cancellation
 * 
 * Turkish: "Her çekim işlemi için minimum 24 saatlik withdrawal_queue yapısı"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as crypto from "crypto";
import type {
  WithdrawalRequest,
  WithdrawalStatus,
  BucketType,
  TimelockConfig,
} from "./types.js";
import {
  DEFAULT_TIMELOCK_CONFIG,
  TimelockNotExpiredError,
  WithdrawalCancelledError,
} from "./types.js";

const withdrawalLogger = logger.child({ component: "withdrawal-queue" });

// ============================================
// WITHDRAWAL QUEUE
// ============================================

export class WithdrawalQueue {
  private readonly config: TimelockConfig;
  
  // Pending requests
  private readonly requests: Map<string, WithdrawalRequest> = new Map();
  
  // Kill switch callback
  private killSwitchCallback?: () => boolean;

  constructor(config?: Partial<TimelockConfig>) {
    this.config = { ...DEFAULT_TIMELOCK_CONFIG, ...config };

    withdrawalLogger.info({
      minTimelock: this.config.minTimelockMs,
      requiredApprovals: this.config.requiredApprovals,
    }, "WithdrawalQueue initialized");
  }

  /**
   * Set kill switch check callback
   * Turkish: "Kill Switch ile müdahale etmene zaman tanır"
   */
  setKillSwitchCallback(callback: () => boolean): void {
    this.killSwitchCallback = callback;
  }

  /**
   * Request a withdrawal
   * Turkish: "minimum 24 saatlik withdrawal_queue"
   */
  requestWithdrawal(
    amount: bigint,
    fromBucket: BucketType,
    destinationAddress: string,
    customTimelockMs?: number
  ): WithdrawalRequest {
    const requestId = crypto.randomUUID();
    const now = Date.now();

    // Ensure minimum timelock
    // Turkish: "minimum 24 saatlik"
    let timelockMs = customTimelockMs || this.config.minTimelockMs;
    if (timelockMs < this.config.minTimelockMs) {
      timelockMs = this.config.minTimelockMs;
      withdrawalLogger.warn({
        requested: customTimelockMs,
        applied: timelockMs,
      }, "Requested timelock below minimum, using minimum");
    }
    if (timelockMs > this.config.maxTimelockMs) {
      timelockMs = this.config.maxTimelockMs;
    }

    const request: WithdrawalRequest = {
      id: requestId,
      amount,
      fromBucket,
      destinationAddress,
      requestedAt: now,
      timelockExpiresAt: now + timelockMs,
      executionDeadline: now + timelockMs + this.config.executionWindowMs,
      status: "pending",
      requiredApprovals: this.config.requiredApprovals,
      approvals: [],
    };

    this.requests.set(requestId, request);

    withdrawalLogger.info({
      requestId,
      amount: amount.toString(),
      fromBucket,
      destinationAddress,
      timelockExpiresAt: new Date(request.timelockExpiresAt).toISOString(),
    }, "Withdrawal requested");

    return request;
  }

  /**
   * Approve a withdrawal request (for multisig)
   */
  approveWithdrawal(
    requestId: string,
    approver: string,
    signature?: string
  ): WithdrawalRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Withdrawal request not found: ${requestId}`);
    }

    if (request.status !== "pending") {
      throw new Error(`Cannot approve request in status: ${request.status}`);
    }

    // Check if approver is authorized
    if (this.config.approvers.length > 0 && !this.config.approvers.includes(approver)) {
      throw new Error(`Approver not authorized: ${approver}`);
    }

    // Check if already approved by this approver
    if (request.approvals.some(a => a.approver === approver)) {
      throw new Error(`Already approved by: ${approver}`);
    }

    request.approvals.push({
      approver,
      approvedAt: Date.now(),
      signature,
    });

    withdrawalLogger.info({
      requestId,
      approver,
      approvalsCount: request.approvals.length,
      requiredApprovals: request.requiredApprovals,
    }, "Withdrawal approved");

    return request;
  }

  /**
   * Check if withdrawal is ready for execution
   */
  isReadyForExecution(requestId: string): {
    ready: boolean;
    reason?: string;
  } {
    const request = this.requests.get(requestId);
    if (!request) {
      return { ready: false, reason: "Request not found" };
    }

    const now = Date.now();

    // Check status
    if (request.status !== "pending") {
      return { ready: false, reason: `Invalid status: ${request.status}` };
    }

    // Check kill switch
    // Turkish: "Kill Switch ile müdahale"
    if (this.killSwitchCallback && this.killSwitchCallback()) {
      return { ready: false, reason: "Kill switch is active" };
    }

    // Check timelock
    if (now < request.timelockExpiresAt) {
      return {
        ready: false,
        reason: `Timelock not expired. Remaining: ${Math.ceil((request.timelockExpiresAt - now) / 1000)}s`,
      };
    }

    // Check execution deadline
    if (now > request.executionDeadline) {
      return { ready: false, reason: "Execution deadline passed" };
    }

    // Check approvals
    if (request.approvals.length < request.requiredApprovals) {
      return {
        ready: false,
        reason: `Insufficient approvals: ${request.approvals.length}/${request.requiredApprovals}`,
      };
    }

    return { ready: true };
  }

  /**
   * Mark withdrawal as ready (after timelock expires)
   */
  markReady(requestId: string): WithdrawalRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Withdrawal request not found: ${requestId}`);
    }

    const readiness = this.isReadyForExecution(requestId);
    if (!readiness.ready) {
      throw new Error(readiness.reason);
    }

    request.status = "ready";
    
    withdrawalLogger.info({
      requestId,
      amount: request.amount.toString(),
    }, "Withdrawal marked as ready");

    return request;
  }

  /**
   * Execute a withdrawal
   */
  executeWithdrawal(requestId: string, txHash: string): WithdrawalRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Withdrawal request not found: ${requestId}`);
    }

    const now = Date.now();

    // Final checks
    if (request.status === "cancelled") {
      throw new WithdrawalCancelledError(
        "Withdrawal was cancelled",
        requestId,
        request.cancellationReason || "Unknown"
      );
    }

    if (request.status !== "ready" && request.status !== "pending") {
      throw new Error(`Cannot execute request in status: ${request.status}`);
    }

    // Check timelock (strict enforcement)
    if (now < request.timelockExpiresAt) {
      throw new TimelockNotExpiredError(
        "Timelock has not expired",
        requestId,
        request.timelockExpiresAt,
        now
      );
    }

    // Check kill switch one more time
    if (this.killSwitchCallback && this.killSwitchCallback()) {
      throw new Error("Kill switch is active - cannot execute withdrawal");
    }

    request.status = "executed";
    request.executedAt = now;
    request.txHash = txHash;

    withdrawalLogger.info({
      requestId,
      amount: request.amount.toString(),
      txHash,
      executedAt: new Date(now).toISOString(),
    }, "Withdrawal executed");

    return request;
  }

  /**
   * Cancel a withdrawal
   * Turkish: "Kill Switch ile müdahale"
   */
  cancelWithdrawal(
    requestId: string,
    cancelledBy: string,
    reason: string
  ): WithdrawalRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Withdrawal request not found: ${requestId}`);
    }

    if (request.status === "executed") {
      throw new Error("Cannot cancel executed withdrawal");
    }

    request.status = "cancelled";
    request.cancelledAt = Date.now();
    request.cancelledBy = cancelledBy;
    request.cancellationReason = reason;

    withdrawalLogger.info({
      requestId,
      cancelledBy,
      reason,
    }, "Withdrawal cancelled");

    return request;
  }

  /**
   * Cancel all pending withdrawals (kill switch integration)
   * Turkish: "Kill Switch"
   */
  cancelAllPending(cancelledBy: string, reason: string): number {
    let count = 0;

    for (const request of this.requests.values()) {
      if (request.status === "pending" || request.status === "ready") {
        request.status = "cancelled";
        request.cancelledAt = Date.now();
        request.cancelledBy = cancelledBy;
        request.cancellationReason = reason;
        count++;
      }
    }

    withdrawalLogger.warn({
      cancelledBy,
      reason,
      count,
    }, "All pending withdrawals cancelled");

    return count;
  }

  /**
   * Get a withdrawal request
   */
  getRequest(requestId: string): WithdrawalRequest | undefined {
    return this.requests.get(requestId);
  }

  /**
   * Get all pending requests
   */
  getPendingRequests(): WithdrawalRequest[] {
    return Array.from(this.requests.values())
      .filter(r => r.status === "pending" || r.status === "ready")
      .sort((a, b) => a.timelockExpiresAt - b.timelockExpiresAt);
  }

  /**
   * Get total pending withdrawal amount
   */
  getTotalPendingAmount(): bigint {
    let total = 0n;
    for (const request of this.requests.values()) {
      if (request.status === "pending" || request.status === "ready") {
        total += request.amount;
      }
    }
    return total;
  }

  /**
   * Get pending amount by bucket
   */
  getPendingAmountByBucket(bucket: BucketType): bigint {
    let total = 0n;
    for (const request of this.requests.values()) {
      if (
        (request.status === "pending" || request.status === "ready") &&
        request.fromBucket === bucket
      ) {
        total += request.amount;
      }
    }
    return total;
  }

  /**
   * Expire old requests
   */
  expireOldRequests(): number {
    const now = Date.now();
    let count = 0;

    for (const request of this.requests.values()) {
      if (
        (request.status === "pending" || request.status === "ready") &&
        now > request.executionDeadline
      ) {
        request.status = "expired";
        count++;
      }
    }

    if (count > 0) {
      withdrawalLogger.info({ count }, "Expired withdrawal requests");
    }

    return count;
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    total: number;
    pending: number;
    ready: number;
    executed: number;
    cancelled: number;
    expired: number;
    totalPendingAmount: bigint;
  } {
    const stats = {
      total: this.requests.size,
      pending: 0,
      ready: 0,
      executed: 0,
      cancelled: 0,
      expired: 0,
      totalPendingAmount: 0n,
    };

    for (const request of this.requests.values()) {
      switch (request.status) {
        case "pending":
          stats.pending++;
          stats.totalPendingAmount += request.amount;
          break;
        case "ready":
          stats.ready++;
          stats.totalPendingAmount += request.amount;
          break;
        case "executed":
          stats.executed++;
          break;
        case "cancelled":
          stats.cancelled++;
          break;
        case "expired":
          stats.expired++;
          break;
      }
    }

    return stats;
  }
}

/**
 * Factory function
 */
export function createWithdrawalQueue(
  config?: Partial<TimelockConfig>
): WithdrawalQueue {
  return new WithdrawalQueue(config);
}
