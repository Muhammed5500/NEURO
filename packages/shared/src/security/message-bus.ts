/**
 * Zero-Trust Message Bus
 * 
 * Secure messaging layer with replay attack protection.
 * 
 * Turkish: "Ajanlar arasındaki tüm mesajlaşmaları (SSE veya dahili bus) 
 * geçici bir 'Nonce' ve 'Timestamp' ile mühürle. Bu, Replay Attack 
 * (tekrarlama saldırıları) riskini sıfıra indirmeli."
 */

import { createHmac, randomUUID } from "crypto";
import { logger } from "../logger/index.js";

const messageBusLogger = logger.child({ component: "zero-trust-message-bus" });

// ============================================
// TYPES
// ============================================

export interface SecureMessage<T = unknown> {
    /** Unique message ID */
    id: string;

    /** Message payload */
    payload: T;

    /** Single-use nonce (UUID v4) */
    nonce: string;

    /** Unix timestamp in milliseconds */
    timestamp: number;

    /** HMAC-SHA256 signature */
    signature: string;

    /** Monotonic sequence number per channel */
    sequenceNumber: number;

    /** Channel/topic identifier */
    channel: string;

    /** Sender identifier */
    senderId: string;
}

export interface MessageEnvelope<T = unknown> extends SecureMessage<T> {
    /** Time-to-live in milliseconds */
    ttl: number;

    /** Priority (0 = lowest, 10 = highest) */
    priority: number;

    /** Optional correlation ID for request-response patterns */
    correlationId?: string;

    /** Indicates if acknowledgment is required */
    requiresAck: boolean;
}

export interface MessageValidationResult {
    valid: boolean;
    error?: string;
    errorCode?: MessageValidationErrorCode;
}

export type MessageValidationErrorCode =
    | "INVALID_SIGNATURE"
    | "EXPIRED_TIMESTAMP"
    | "FUTURE_TIMESTAMP"
    | "DUPLICATE_NONCE"
    | "INVALID_SEQUENCE"
    | "MALFORMED_MESSAGE"
    | "CHANNEL_MISMATCH";

export interface ChannelState {
    lastSequenceNumber: number;
    lastTimestamp: number;
    messageCount: number;
    createdAt: number;
}

export interface MessageBusConfig {
    /** Signing key for HMAC (should be 32+ bytes) */
    signingKey: string;

    /** Message TTL in milliseconds (default: 30000 = 30 seconds) */
    defaultTtl: number;

    /** Maximum clock skew allowed in milliseconds (default: 5000 = 5 seconds) */
    maxClockSkew: number;

    /** How long to store used nonces (should be > TTL) */
    nonceRetentionMs: number;

    /** Enable strict sequence validation */
    strictSequence: boolean;

    /** Maximum nonces to store before cleanup */
    maxNonceCache: number;
}

// ============================================
// DEFAULT CONFIGURATION
// ============================================

const DEFAULT_CONFIG: MessageBusConfig = {
    signingKey: "CHANGE_ME_IN_PRODUCTION_32_BYTES!",
    defaultTtl: 30000,           // 30 seconds
    maxClockSkew: 5000,          // 5 seconds
    nonceRetentionMs: 60000,     // 1 minute
    strictSequence: true,
    maxNonceCache: 100000,
};

// ============================================
// ZERO-TRUST MESSAGE BUS IMPLEMENTATION
// ============================================

export class ZeroTrustMessageBus {
    private readonly config: MessageBusConfig;

    // Nonce tracking (prevents replay attacks)
    private readonly usedNonces: Map<string, number> = new Map();

    // Channel state tracking (sequence validation)
    private readonly channelStates: Map<string, ChannelState> = new Map();

    // Cleanup interval
    private cleanupInterval?: NodeJS.Timeout;

    // Statistics
    private stats = {
        messagesSent: 0,
        messagesReceived: 0,
        messagesRejected: 0,
        replayAttemptsBlocked: 0,
        signatureFailures: 0,
        sequenceViolations: 0,
    };

    constructor(config?: Partial<MessageBusConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        // Validate signing key
        if (this.config.signingKey.length < 32) {
            messageBusLogger.warn("Signing key is less than 32 bytes - consider using a stronger key");
        }

        // Start cleanup interval
        this.startCleanup();

        messageBusLogger.info({
            ttl: this.config.defaultTtl,
            maxClockSkew: this.config.maxClockSkew,
            strictSequence: this.config.strictSequence,
        }, "Zero-trust message bus initialized");
    }

    /**
     * Create a signed message
     */
    createMessage<T>(
        channel: string,
        senderId: string,
        payload: T,
        options?: {
            ttl?: number;
            priority?: number;
            correlationId?: string;
            requiresAck?: boolean;
        }
    ): MessageEnvelope<T> {
        const now = Date.now();
        const nonce = randomUUID();

        // Get/update channel state
        let channelState = this.channelStates.get(channel);
        if (!channelState) {
            channelState = {
                lastSequenceNumber: 0,
                lastTimestamp: now,
                messageCount: 0,
                createdAt: now,
            };
            this.channelStates.set(channel, channelState);
        }

        const sequenceNumber = channelState.lastSequenceNumber + 1;
        channelState.lastSequenceNumber = sequenceNumber;
        channelState.lastTimestamp = now;
        channelState.messageCount++;

        // Build message (without signature first)
        const message: Omit<MessageEnvelope<T>, "signature"> = {
            id: randomUUID(),
            channel,
            senderId,
            payload,
            nonce,
            timestamp: now,
            sequenceNumber,
            ttl: options?.ttl ?? this.config.defaultTtl,
            priority: options?.priority ?? 5,
            correlationId: options?.correlationId,
            requiresAck: options?.requiresAck ?? false,
        };

        // Sign the message
        const signature = this.signMessage(message);

        const signedMessage: MessageEnvelope<T> = {
            ...message,
            signature,
        };

        this.stats.messagesSent++;

        return signedMessage;
    }

    /**
     * Validate a received message
     */
    validateMessage<T>(message: SecureMessage<T>): MessageValidationResult {
        const now = Date.now();

        // 1. Check message structure
        if (!message.id || !message.nonce || !message.signature || !message.channel) {
            this.stats.messagesRejected++;
            return {
                valid: false,
                error: "Malformed message: missing required fields",
                errorCode: "MALFORMED_MESSAGE",
            };
        }

        // 2. Verify signature
        const expectedSignature = this.signMessage(message);
        if (!this.timingSafeEqual(message.signature, expectedSignature)) {
            this.stats.signatureFailures++;
            this.stats.messagesRejected++;
            messageBusLogger.warn({
                messageId: message.id,
                channel: message.channel,
                senderId: message.senderId,
            }, "Message signature verification failed");
            return {
                valid: false,
                error: "Invalid message signature",
                errorCode: "INVALID_SIGNATURE",
            };
        }

        // 3. Check timestamp (not expired)
        const messageAge = now - message.timestamp;
        if (messageAge > this.config.defaultTtl) {
            this.stats.messagesRejected++;
            return {
                valid: false,
                error: `Message expired: ${messageAge}ms old, TTL is ${this.config.defaultTtl}ms`,
                errorCode: "EXPIRED_TIMESTAMP",
            };
        }

        // 4. Check timestamp (not from future)
        if (message.timestamp > now + this.config.maxClockSkew) {
            this.stats.messagesRejected++;
            return {
                valid: false,
                error: `Message timestamp is in the future (clock skew: ${message.timestamp - now}ms)`,
                errorCode: "FUTURE_TIMESTAMP",
            };
        }

        // 5. Check for replay (duplicate nonce)
        if (this.usedNonces.has(message.nonce)) {
            this.stats.replayAttemptsBlocked++;
            this.stats.messagesRejected++;
            messageBusLogger.warn({
                messageId: message.id,
                nonce: message.nonce,
                channel: message.channel,
            }, "Replay attack blocked - duplicate nonce");
            return {
                valid: false,
                error: "Replay attack detected: nonce already used",
                errorCode: "DUPLICATE_NONCE",
            };
        }

        // 6. Check sequence number (if strict)
        if (this.config.strictSequence) {
            const channelState = this.channelStates.get(message.channel);
            if (channelState) {
                // Allow gaps but not backwards movement
                if (message.sequenceNumber <= channelState.lastSequenceNumber) {
                    this.stats.sequenceViolations++;
                    this.stats.messagesRejected++;
                    messageBusLogger.warn({
                        messageId: message.id,
                        channel: message.channel,
                        receivedSeq: message.sequenceNumber,
                        expectedSeq: channelState.lastSequenceNumber + 1,
                    }, "Sequence violation detected");
                    return {
                        valid: false,
                        error: `Sequence violation: received ${message.sequenceNumber}, expected > ${channelState.lastSequenceNumber}`,
                        errorCode: "INVALID_SEQUENCE",
                    };
                }
            }
        }

        // Message is valid - record nonce and update state
        this.usedNonces.set(message.nonce, now);

        // Update channel state
        let channelState = this.channelStates.get(message.channel);
        if (!channelState) {
            channelState = {
                lastSequenceNumber: message.sequenceNumber,
                lastTimestamp: message.timestamp,
                messageCount: 1,
                createdAt: now,
            };
            this.channelStates.set(message.channel, channelState);
        } else {
            channelState.lastSequenceNumber = Math.max(channelState.lastSequenceNumber, message.sequenceNumber);
            channelState.lastTimestamp = message.timestamp;
            channelState.messageCount++;
        }

        this.stats.messagesReceived++;

        return { valid: true };
    }

    /**
     * Validate and extract payload (throws on invalid)
     */
    extractPayload<T>(message: SecureMessage<T>): T {
        const result = this.validateMessage(message);
        if (!result.valid) {
            throw new MessageValidationError(result.error!, result.errorCode!);
        }
        return message.payload;
    }

    /**
     * Sign a message (HMAC-SHA256)
     */
    private signMessage(message: Omit<SecureMessage<unknown>, "signature">): string {
        const dataToSign = JSON.stringify({
            id: message.id,
            channel: message.channel,
            senderId: message.senderId,
            payload: message.payload,
            nonce: message.nonce,
            timestamp: message.timestamp,
            sequenceNumber: message.sequenceNumber,
        });

        return createHmac("sha256", this.config.signingKey)
            .update(dataToSign)
            .digest("hex");
    }

    /**
     * Timing-safe string comparison
     */
    private timingSafeEqual(a: string, b: string): boolean {
        if (a.length !== b.length) {
            return false;
        }

        let result = 0;
        for (let i = 0; i < a.length; i++) {
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return result === 0;
    }

    /**
     * Start periodic cleanup of expired nonces
     */
    private startCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, this.config.nonceRetentionMs);
    }

    /**
     * Clean up expired nonces
     */
    private cleanup(): void {
        const now = Date.now();
        const expirationThreshold = now - this.config.nonceRetentionMs;
        let cleaned = 0;

        for (const [nonce, timestamp] of this.usedNonces) {
            if (timestamp < expirationThreshold) {
                this.usedNonces.delete(nonce);
                cleaned++;
            }
        }

        // Also enforce max cache size
        if (this.usedNonces.size > this.config.maxNonceCache) {
            const excess = this.usedNonces.size - this.config.maxNonceCache;
            const entries = Array.from(this.usedNonces.entries())
                .sort((a, b) => a[1] - b[1]); // Sort by timestamp

            for (let i = 0; i < excess && i < entries.length; i++) {
                this.usedNonces.delete(entries[i][0]);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            messageBusLogger.debug({ cleaned }, "Cleaned expired nonces");
        }
    }

    /**
     * Get statistics
     */
    getStats(): typeof this.stats & {
        usedNonces: number;
        activeChannels: number;
    } {
        return {
            ...this.stats,
            usedNonces: this.usedNonces.size,
            activeChannels: this.channelStates.size,
        };
    }

    /**
     * Get channel state
     */
    getChannelState(channel: string): ChannelState | undefined {
        return this.channelStates.get(channel);
    }

    /**
     * Reset channel state (use with caution)
     */
    resetChannel(channel: string): void {
        this.channelStates.delete(channel);
        messageBusLogger.info({ channel }, "Channel state reset");
    }

    /**
     * Destroy the message bus
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.usedNonces.clear();
        this.channelStates.clear();
        messageBusLogger.info("Message bus destroyed");
    }
}

// ============================================
// VALIDATION ERROR
// ============================================

export class MessageValidationError extends Error {
    constructor(
        message: string,
        public readonly code: MessageValidationErrorCode
    ) {
        super(message);
        this.name = "MessageValidationError";
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let instance: ZeroTrustMessageBus | null = null;

export function getMessageBus(config?: Partial<MessageBusConfig>): ZeroTrustMessageBus {
    if (!instance) {
        instance = new ZeroTrustMessageBus(config);
    }
    return instance;
}

export function resetMessageBus(): void {
    if (instance) {
        instance.destroy();
        instance = null;
    }
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Create a signed message ready for transmission
 */
export function createSecureMessage<T>(
    channel: string,
    senderId: string,
    payload: T
): MessageEnvelope<T> {
    return getMessageBus().createMessage(channel, senderId, payload);
}

/**
 * Validate a received message
 */
export function validateSecureMessage<T>(message: SecureMessage<T>): MessageValidationResult {
    return getMessageBus().validateMessage(message);
}

/**
 * Validate and extract payload (throws on invalid)
 */
export function extractSecurePayload<T>(message: SecureMessage<T>): T {
    return getMessageBus().extractPayload(message);
}

// ============================================
// CHANNEL WRAPPERS
// ============================================

/**
 * Create a channel-specific message wrapper
 */
export function createChannel(channelName: string, senderId: string) {
    const bus = getMessageBus();

    return {
        send<T>(payload: T, options?: Parameters<typeof bus.createMessage>[3]) {
            return bus.createMessage(channelName, senderId, payload, options);
        },

        receive<T>(message: SecureMessage<T>): T {
            if (message.channel !== channelName) {
                throw new MessageValidationError(
                    `Channel mismatch: expected ${channelName}, got ${message.channel}`,
                    "CHANNEL_MISMATCH"
                );
            }
            return bus.extractPayload(message);
        },

        validate<T>(message: SecureMessage<T>): MessageValidationResult {
            if (message.channel !== channelName) {
                return {
                    valid: false,
                    error: `Channel mismatch: expected ${channelName}, got ${message.channel}`,
                    errorCode: "CHANNEL_MISMATCH",
                };
            }
            return bus.validateMessage(message);
        },

        getState(): ChannelState | undefined {
            return bus.getChannelState(channelName);
        },
    };
}

// ============================================
// PREDEFINED CHANNELS
// ============================================

export const Channels = {
    ORCHESTRATOR_DECISION: "orchestrator:decision",
    ORCHESTRATOR_APPROVAL: "orchestrator:approval",
    EXECUTION_REQUEST: "execution:request",
    EXECUTION_RESULT: "execution:result",
    AGENT_OPINION: "agent:opinion",
    AGENT_CONSENSUS: "agent:consensus",
    DASHBOARD_ACTION: "dashboard:action",
    DASHBOARD_EVENT: "dashboard:event",
    SYSTEM_ALERT: "system:alert",
    SYSTEM_HEALTH: "system:health",
} as const;
