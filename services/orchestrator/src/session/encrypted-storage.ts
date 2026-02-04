/**
 * Encrypted Session Storage
 * 
 * Turkish: "Oturum anahtarları bellekte (RAM) şifreli olarak tutulmalı
 * ve işlem bittikten sonra clear_memory ile temizlenmelidir."
 * 
 * Uses AES-256-GCM for encryption with secure key derivation.
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as crypto from "crypto";
import type { SessionKeyConfig, EncryptedSession } from "./types.js";

const storageLogger = logger.child({ component: "encrypted-storage" });

// ============================================
// ENCRYPTION CONFIGURATION
// ============================================

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT_LENGTH = 32;

// ============================================
// SECURE MEMORY BUFFER
// ============================================

/**
 * Secure buffer that can be explicitly cleared
 * Turkish: "clear_memory ile temizlenmelidir"
 */
class SecureBuffer {
  private buffer: Buffer;
  private cleared = false;

  constructor(data: Buffer | string) {
    if (typeof data === "string") {
      this.buffer = Buffer.from(data, "utf8");
    } else {
      this.buffer = Buffer.from(data);
    }
  }

  getData(): Buffer {
    if (this.cleared) {
      throw new Error("Buffer has been cleared");
    }
    return this.buffer;
  }

  clear(): void {
    if (!this.cleared) {
      // Overwrite with zeros
      crypto.randomFillSync(this.buffer);
      this.buffer.fill(0);
      this.cleared = true;
    }
  }

  isCleared(): boolean {
    return this.cleared;
  }
}

// ============================================
// ENCRYPTED SESSION STORAGE
// ============================================

export class EncryptedSessionStorage {
  private readonly masterKey: SecureBuffer;
  private readonly sessions: Map<string, EncryptedSession> = new Map();
  private readonly decryptedCache: Map<string, { data: SecureBuffer; expiresAt: number }> = new Map();
  
  // Cache TTL (how long decrypted sessions stay in memory)
  private readonly cacheTtlMs: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(masterKeyHex?: string, cacheTtlMs = 60000) {
    // Generate or use provided master key
    if (masterKeyHex) {
      this.masterKey = new SecureBuffer(Buffer.from(masterKeyHex, "hex"));
    } else {
      this.masterKey = new SecureBuffer(crypto.randomBytes(KEY_LENGTH));
    }
    
    this.cacheTtlMs = cacheTtlMs;
    
    // Start cleanup interval
    this.cleanupInterval = setInterval(
      () => this.cleanupDecryptedCache(),
      Math.min(cacheTtlMs, 30000)
    );

    storageLogger.info("EncryptedSessionStorage initialized");
  }

  /**
   * Store a session (encrypts before storing)
   */
  store(session: SessionKeyConfig): void {
    const encrypted = this.encrypt(JSON.stringify(session));
    
    const encryptedSession: EncryptedSession = {
      sessionId: session.sessionId,
      encryptedData: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      createdAt: Date.now(),
    };

    this.sessions.set(session.sessionId, encryptedSession);
    
    storageLogger.debug({
      sessionId: session.sessionId,
    }, "Session stored encrypted");
  }

  /**
   * Retrieve and decrypt a session
   */
  retrieve(sessionId: string): SessionKeyConfig | null {
    // Check decrypted cache first
    const cached = this.decryptedCache.get(sessionId);
    if (cached && cached.expiresAt > Date.now()) {
      try {
        const data = cached.data.getData().toString("utf8");
        return JSON.parse(data) as SessionKeyConfig;
      } catch {
        // Cache corrupted, remove it
        cached.data.clear();
        this.decryptedCache.delete(sessionId);
      }
    }

    // Get encrypted session
    const encrypted = this.sessions.get(sessionId);
    if (!encrypted) {
      return null;
    }

    // Decrypt
    const decrypted = this.decrypt(
      encrypted.encryptedData,
      encrypted.iv,
      encrypted.tag
    );

    if (!decrypted) {
      storageLogger.warn({ sessionId }, "Failed to decrypt session");
      return null;
    }

    // Parse
    const session = JSON.parse(decrypted) as SessionKeyConfig;

    // Cache decrypted for short period
    const secureData = new SecureBuffer(decrypted);
    this.decryptedCache.set(sessionId, {
      data: secureData,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return session;
  }

  /**
   * Update a session
   */
  update(session: SessionKeyConfig): void {
    // Clear old cached version
    const cached = this.decryptedCache.get(session.sessionId);
    if (cached) {
      cached.data.clear();
      this.decryptedCache.delete(session.sessionId);
    }

    // Re-encrypt and store
    this.store(session);
  }

  /**
   * Delete a session and clear from memory
   * Turkish: "clear_memory ile temizlenmelidir"
   */
  delete(sessionId: string): void {
    // Clear from decrypted cache
    const cached = this.decryptedCache.get(sessionId);
    if (cached) {
      cached.data.clear();
      this.decryptedCache.delete(sessionId);
    }

    // Remove encrypted version
    this.sessions.delete(sessionId);

    storageLogger.debug({ sessionId }, "Session deleted and cleared from memory");
  }

  /**
   * Clear all sessions from memory
   * Turkish: "clear_memory ile temizlenmelidir"
   */
  clearAll(): number {
    let count = 0;

    // Clear all decrypted caches
    for (const [sessionId, cached] of this.decryptedCache) {
      cached.data.clear();
      count++;
    }
    this.decryptedCache.clear();

    // Clear encrypted sessions
    count = this.sessions.size;
    this.sessions.clear();

    storageLogger.info({ count }, "All sessions cleared from memory");
    return count;
  }

  /**
   * Get all session IDs
   */
  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Check if session exists
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get session count
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Shutdown and clear all memory
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Clear all sessions
    this.clearAll();

    // Clear master key
    this.masterKey.clear();

    storageLogger.info("EncryptedSessionStorage shutdown and memory cleared");
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private encrypt(plaintext: string): { ciphertext: string; iv: string; tag: string } {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = this.deriveKey(iv);

    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    let ciphertext = cipher.update(plaintext, "utf8", "hex");
    ciphertext += cipher.final("hex");
    const tag = cipher.getAuthTag().toString("hex");

    // Clear derived key from memory
    key.fill(0);

    return {
      ciphertext,
      iv: iv.toString("hex"),
      tag,
    };
  }

  private decrypt(ciphertext: string, ivHex: string, tagHex: string): string | null {
    try {
      const iv = Buffer.from(ivHex, "hex");
      const tag = Buffer.from(tagHex, "hex");
      const key = this.deriveKey(iv);

      const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      decipher.setAuthTag(tag);

      let plaintext = decipher.update(ciphertext, "hex", "utf8");
      plaintext += decipher.final("utf8");

      // Clear derived key from memory
      key.fill(0);

      return plaintext;
    } catch (error) {
      storageLogger.warn({ error }, "Decryption failed");
      return null;
    }
  }

  private deriveKey(salt: Buffer): Buffer {
    // Use HKDF to derive a unique key per session
    return crypto.hkdfSync(
      "sha256",
      this.masterKey.getData(),
      salt,
      "session-key",
      KEY_LENGTH
    );
  }

  private cleanupDecryptedCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, cached] of this.decryptedCache) {
      if (cached.expiresAt <= now) {
        cached.data.clear();
        this.decryptedCache.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      storageLogger.debug({ cleaned }, "Cleared expired decrypted sessions from cache");
    }
  }
}

/**
 * Factory function
 */
export function createEncryptedStorage(
  masterKeyHex?: string,
  cacheTtlMs?: number
): EncryptedSessionStorage {
  return new EncryptedSessionStorage(masterKeyHex, cacheTtlMs);
}
