/**
 * Zero-Trust Message Bus Security
 * 
 * Turkish: "Ajanlar arasındaki tüm mesajlaşmaları geçici bir 'Nonce' ve 'Timestamp' 
 * ile mühürle. Bu, Replay Attack riskini sıfıra indirmeli."
 */

import * as crypto from "crypto";

// ============================================
// SECURE MESSAGE TYPES
// ============================================

export interface SecureMessage<T = unknown> {
  /** Message payload */
  payload: T;
  /** Unique nonce (UUID v4) - single use */
  nonce: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** HMAC-SHA256 signature */
  signature: string;
  /** Monotonic sequence number per channel */
  sequenceNumber: number;
  /** Optional sender identifier */
  senderId?: string;
  /** Optional channel identifier */
  channelId?: string;
}

export interface MessageValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: 
    | "INVALID_SIGNATURE"
    | "EXPIRED_TIMESTAMP"
    | "REPLAY_ATTACK"
    | "INVALID_SEQUENCE"
    | "MISSING_FIELDS"
    | "MALFORMED_MESSAGE";
}

export interface SecureMessageConfig {
  /** HMAC secret key */
  secretKey: string;
  /** Timestamp validity window in ms (default: 30000) */
  timestampWindowMs?: number;
  /** Enable strict sequence checking */
  strictSequence?: boolean;
  /** Maximum nonce cache size */
  maxNonceCacheSize?: number;
}

// ============================================
// SECURE MESSAGE SERVICE
// ============================================

export class SecureMessageService {
  private readonly secretKey: Buffer;
  private readonly timestampWindowMs: number;
  private readonly strictSequence: boolean;
  
  // Nonce cache for replay protection
  private readonly usedNonces: Map<string, number> = new Map();
  private readonly maxNonceCacheSize: number;
  
  // Sequence tracking per channel
  private readonly channelSequences: Map<string, number> = new Map();

  constructor(config: SecureMessageConfig) {
    this.secretKey = Buffer.from(config.secretKey, "hex");
    this.timestampWindowMs = config.timestampWindowMs || 30000;
    this.strictSequence = config.strictSequence ?? true;
    this.maxNonceCacheSize = config.maxNonceCacheSize || 10000;

    // Cleanup old nonces periodically
    setInterval(() => this.cleanupNonces(), 60000);
  }

  /**
   * Create a secure message with nonce, timestamp, and signature
   */
  createMessage<T>(
    payload: T,
    channelId?: string,
    senderId?: string
  ): SecureMessage<T> {
    const nonce = crypto.randomUUID();
    const timestamp = Date.now();
    const sequenceNumber = this.getNextSequence(channelId || "default");

    const message: Omit<SecureMessage<T>, "signature"> = {
      payload,
      nonce,
      timestamp,
      sequenceNumber,
      senderId,
      channelId,
    };

    const signature = this.sign(message);

    return {
      ...message,
      signature,
    };
  }

  /**
   * Validate a secure message
   */
  validateMessage<T>(message: SecureMessage<T>): MessageValidationResult {
    // Check required fields
    if (!message.nonce || !message.timestamp || !message.signature || 
        message.sequenceNumber === undefined) {
      return { valid: false, error: "Missing required fields", errorCode: "MISSING_FIELDS" };
    }

    // Check timestamp freshness
    const now = Date.now();
    const age = now - message.timestamp;
    
    if (age < -5000) {
      // Allow 5 seconds clock skew in the future
      return { 
        valid: false, 
        error: `Message from future: ${age}ms`, 
        errorCode: "EXPIRED_TIMESTAMP" 
      };
    }
    
    if (age > this.timestampWindowMs) {
      return { 
        valid: false, 
        error: `Message too old: ${age}ms exceeds ${this.timestampWindowMs}ms window`, 
        errorCode: "EXPIRED_TIMESTAMP" 
      };
    }

    // Check for replay (nonce reuse)
    if (this.usedNonces.has(message.nonce)) {
      return { 
        valid: false, 
        error: `Nonce already used: ${message.nonce}`, 
        errorCode: "REPLAY_ATTACK" 
      };
    }

    // Check sequence number
    if (this.strictSequence && message.channelId) {
      const lastSequence = this.channelSequences.get(message.channelId) || 0;
      if (message.sequenceNumber <= lastSequence) {
        return { 
          valid: false, 
          error: `Invalid sequence: ${message.sequenceNumber} <= ${lastSequence}`, 
          errorCode: "INVALID_SEQUENCE" 
        };
      }
    }

    // Verify signature
    const expectedSignature = this.sign({
      payload: message.payload,
      nonce: message.nonce,
      timestamp: message.timestamp,
      sequenceNumber: message.sequenceNumber,
      senderId: message.senderId,
      channelId: message.channelId,
    });

    if (!crypto.timingSafeEqual(
      Buffer.from(message.signature, "hex"),
      Buffer.from(expectedSignature, "hex")
    )) {
      return { 
        valid: false, 
        error: "Signature verification failed", 
        errorCode: "INVALID_SIGNATURE" 
      };
    }

    // Mark nonce as used
    this.usedNonces.set(message.nonce, message.timestamp);

    // Update sequence for channel
    if (message.channelId) {
      this.channelSequences.set(message.channelId, message.sequenceNumber);
    }

    return { valid: true };
  }

  /**
   * Create and validate in one step (for inter-service communication)
   */
  async secureTransmit<T, R>(
    payload: T,
    transmitFn: (message: SecureMessage<T>) => Promise<SecureMessage<R>>,
    channelId?: string
  ): Promise<R> {
    const message = this.createMessage(payload, channelId);
    const response = await transmitFn(message);
    
    const validation = this.validateMessage(response);
    if (!validation.valid) {
      throw new Error(`Invalid response: ${validation.error}`);
    }
    
    return response.payload;
  }

  /**
   * Sign a message
   */
  private sign(message: Omit<SecureMessage, "signature">): string {
    const data = JSON.stringify({
      payload: message.payload,
      nonce: message.nonce,
      timestamp: message.timestamp,
      sequenceNumber: message.sequenceNumber,
      senderId: message.senderId,
      channelId: message.channelId,
    });

    return crypto
      .createHmac("sha256", this.secretKey)
      .update(data)
      .digest("hex");
  }

  /**
   * Get next sequence number for channel
   */
  private getNextSequence(channelId: string): number {
    const current = this.channelSequences.get(channelId) || 0;
    const next = current + 1;
    this.channelSequences.set(channelId, next);
    return next;
  }

  /**
   * Cleanup expired nonces
   */
  private cleanupNonces(): void {
    const now = Date.now();
    const expiredThreshold = now - this.timestampWindowMs * 2;

    for (const [nonce, timestamp] of this.usedNonces) {
      if (timestamp < expiredThreshold) {
        this.usedNonces.delete(nonce);
      }
    }

    // Also trim if exceeding max size
    if (this.usedNonces.size > this.maxNonceCacheSize) {
      const entries = Array.from(this.usedNonces.entries())
        .sort((a, b) => a[1] - b[1]);
      
      const toRemove = entries.slice(0, entries.length - this.maxNonceCacheSize);
      for (const [nonce] of toRemove) {
        this.usedNonces.delete(nonce);
      }
    }
  }

  /**
   * Get statistics for monitoring
   */
  getStats(): {
    cachedNonces: number;
    trackedChannels: number;
    timestampWindowMs: number;
  } {
    return {
      cachedNonces: this.usedNonces.size,
      trackedChannels: this.channelSequences.size,
      timestampWindowMs: this.timestampWindowMs,
    };
  }
}

/**
 * Factory function
 */
export function createSecureMessageService(config: SecureMessageConfig): SecureMessageService {
  return new SecureMessageService(config);
}

/**
 * Generate a random secret key
 */
export function generateSecretKey(): string {
  return crypto.randomBytes(32).toString("hex");
}
