/**
 * Nonce Manager
 * 
 * Manages nonces atomically to prevent collisions at high transaction rates.
 * 
 * Turkish: "Monad'ın yüksek hızında nonce çakışması yaşamamak için her gönderim
 * denemesinde nonce kontrolünü atomik olarak gerçekleştiren bir yapı kur."
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { NonceReservation, SubmissionAuditEntry } from "./types.js";
import { NonceCollisionError } from "./types.js";

const nonceLogger = logger.child({ component: "nonce-manager" });

// ============================================
// NONCE MANAGER CONFIGURATION
// ============================================

export interface NonceManagerConfig {
  // How long a nonce reservation is valid (ms)
  reservationTimeoutMs: number;
  
  // How often to clean expired reservations (ms)
  cleanupIntervalMs: number;
  
  // Maximum pending reservations per address
  maxPendingPerAddress: number;
}

const DEFAULT_CONFIG: NonceManagerConfig = {
  reservationTimeoutMs: 60000, // 1 minute
  cleanupIntervalMs: 10000, // 10 seconds
  maxPendingPerAddress: 10,
};

// ============================================
// NONCE MANAGER
// ============================================

export class NonceManager {
  private readonly config: NonceManagerConfig;
  
  // In-memory nonce tracking
  // In production, this would use Redis or similar for distributed locking
  private readonly pendingNonces: Map<string, NonceReservation[]> = new Map();
  private readonly confirmedNonces: Map<string, number> = new Map();
  
  // Lock for atomic operations
  private readonly locks: Map<string, Promise<void>> = new Map();
  
  // Cleanup interval
  private cleanupInterval?: NodeJS.Timeout;
  
  // Audit callback
  private auditCallback?: (entry: Omit<SubmissionAuditEntry, "id" | "timestamp">) => void;

  constructor(config?: Partial<NonceManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Start cleanup interval
    this.cleanupInterval = setInterval(
      () => this.cleanupExpiredReservations(),
      this.config.cleanupIntervalMs
    );

    nonceLogger.info("NonceManager initialized");
  }

  /**
   * Set audit callback for logging
   */
  setAuditCallback(
    callback: (entry: Omit<SubmissionAuditEntry, "id" | "timestamp">) => void
  ): void {
    this.auditCallback = callback;
  }

  /**
   * Reserve a nonce atomically
   * Turkish: "nonce kontrolünü atomik olarak gerçekleştiren"
   */
  async reserveNonce(
    address: string,
    getNetworkNonce: () => Promise<number>,
    correlationId: string
  ): Promise<NonceReservation> {
    const normalizedAddress = address.toLowerCase();
    
    // Acquire lock for this address
    await this.acquireLock(normalizedAddress);
    
    try {
      // Get pending reservations for this address
      const pending = this.pendingNonces.get(normalizedAddress) || [];
      
      // Check max pending limit
      if (pending.length >= this.config.maxPendingPerAddress) {
        throw new Error(`Max pending nonces (${this.config.maxPendingPerAddress}) reached for ${address}`);
      }

      // Get network nonce
      const networkNonce = await getNetworkNonce();
      
      // Calculate next nonce (network nonce + pending count)
      const nextNonce = networkNonce + pending.length;
      
      // Check for collision with confirmed nonces
      const lastConfirmed = this.confirmedNonces.get(normalizedAddress);
      if (lastConfirmed !== undefined && nextNonce <= lastConfirmed) {
        throw new NonceCollisionError(
          address,
          lastConfirmed + 1,
          nextNonce,
          correlationId
        );
      }

      // Create reservation
      const now = Date.now();
      const reservation: NonceReservation = {
        address: normalizedAddress,
        nonce: nextNonce,
        reservedAt: now,
        expiresAt: now + this.config.reservationTimeoutMs,
        correlationId,
        released: false,
      };

      // Store reservation
      pending.push(reservation);
      this.pendingNonces.set(normalizedAddress, pending);

      // Audit log
      this.audit({
        correlationId,
        action: "nonce_acquired",
        from: address,
        success: true,
        metadata: { nonce: nextNonce, networkNonce, pendingCount: pending.length },
      });

      nonceLogger.debug({
        address,
        nonce: nextNonce,
        correlationId,
      }, "Nonce reserved");

      return reservation;
    } finally {
      this.releaseLock(normalizedAddress);
    }
  }

  /**
   * Confirm a nonce was used successfully
   */
  async confirmNonce(
    reservation: NonceReservation,
    txHash?: string
  ): Promise<void> {
    const { address, nonce, correlationId } = reservation;
    
    await this.acquireLock(address);
    
    try {
      // Update confirmed nonce
      const currentConfirmed = this.confirmedNonces.get(address);
      if (currentConfirmed === undefined || nonce > currentConfirmed) {
        this.confirmedNonces.set(address, nonce);
      }

      // Remove from pending
      this.removeReservation(reservation);

      // Audit log
      this.audit({
        correlationId,
        txHash,
        action: "nonce_released",
        from: address,
        success: true,
        metadata: { nonce, confirmed: true },
      });

      nonceLogger.debug({
        address,
        nonce,
        txHash,
        correlationId,
      }, "Nonce confirmed");
    } finally {
      this.releaseLock(address);
    }
  }

  /**
   * Release a nonce reservation (on failure)
   */
  async releaseNonce(
    reservation: NonceReservation,
    reason?: string
  ): Promise<void> {
    const { address, nonce, correlationId } = reservation;
    
    await this.acquireLock(address);
    
    try {
      // Remove from pending
      this.removeReservation(reservation);

      // Audit log
      this.audit({
        correlationId,
        action: "nonce_released",
        from: address,
        success: true,
        metadata: { nonce, confirmed: false, reason },
      });

      nonceLogger.debug({
        address,
        nonce,
        reason,
        correlationId,
      }, "Nonce released (not confirmed)");
    } finally {
      this.releaseLock(address);
    }
  }

  /**
   * Get current nonce state for an address
   */
  getNonceState(address: string): {
    lastConfirmed?: number;
    pendingCount: number;
    reservations: NonceReservation[];
  } {
    const normalizedAddress = address.toLowerCase();
    const pending = this.pendingNonces.get(normalizedAddress) || [];
    
    return {
      lastConfirmed: this.confirmedNonces.get(normalizedAddress),
      pendingCount: pending.length,
      reservations: [...pending],
    };
  }

  /**
   * Reset nonce tracking for an address (e.g., after chain reorg)
   */
  async resetAddress(address: string): Promise<void> {
    const normalizedAddress = address.toLowerCase();
    
    await this.acquireLock(normalizedAddress);
    
    try {
      this.pendingNonces.delete(normalizedAddress);
      this.confirmedNonces.delete(normalizedAddress);
      
      nonceLogger.info({ address }, "Nonce state reset");
    } finally {
      this.releaseLock(normalizedAddress);
    }
  }

  /**
   * Shutdown the nonce manager
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    nonceLogger.info("NonceManager shutdown");
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private removeReservation(reservation: NonceReservation): void {
    const pending = this.pendingNonces.get(reservation.address) || [];
    const index = pending.findIndex(
      r => r.nonce === reservation.nonce && r.correlationId === reservation.correlationId
    );
    
    if (index >= 0) {
      pending.splice(index, 1);
      reservation.released = true;
      
      if (pending.length === 0) {
        this.pendingNonces.delete(reservation.address);
      } else {
        this.pendingNonces.set(reservation.address, pending);
      }
    }
  }

  private cleanupExpiredReservations(): void {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [address, reservations] of this.pendingNonces.entries()) {
      const active = reservations.filter(r => r.expiresAt > now);
      const expired = reservations.length - active.length;
      
      if (expired > 0) {
        cleanedCount += expired;
        
        if (active.length === 0) {
          this.pendingNonces.delete(address);
        } else {
          this.pendingNonces.set(address, active);
        }
        
        nonceLogger.debug({
          address,
          expired,
          remaining: active.length,
        }, "Expired nonce reservations cleaned");
      }
    }

    if (cleanedCount > 0) {
      nonceLogger.debug({ cleanedCount }, "Nonce cleanup completed");
    }
  }

  private async acquireLock(key: string): Promise<void> {
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }
    
    let resolve: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    this.locks.set(key, promise);
    
    // Store resolve for releaseLock
    (promise as any)._resolve = resolve;
  }

  private releaseLock(key: string): void {
    const promise = this.locks.get(key);
    if (promise) {
      this.locks.delete(key);
      (promise as any)._resolve?.();
    }
  }

  private audit(entry: Omit<SubmissionAuditEntry, "id" | "timestamp">): void {
    if (this.auditCallback) {
      this.auditCallback(entry);
    }
  }
}

/**
 * Factory function
 */
export function createNonceManager(
  config?: Partial<NonceManagerConfig>
): NonceManager {
  return new NonceManager(config);
}
