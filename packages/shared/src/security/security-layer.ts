/**
 * NEURO Security Layer - Comprehensive Security Module
 * 
 * This module integrates all security components for defense in depth:
 * 
 * Layer 1: Input Sanitization
 *   - Content sanitization pipeline
 *   - Adversarial pattern detection
 * 
 * Layer 2: Signature Verification
 *   - Zero-trust message bus
 *   - Proof of intent
 *   - Multi-algorithm signatures
 * 
 * Layer 3: Anomaly Detection
 *   - Real-time behavioral analysis
 *   - Pattern detection
 *   - Auto-response triggers
 * 
 * Layer 4: Access Control
 *   - Allowlist/blocklist management
 *   - Rate limiting
 *   - Session management
 * 
 * Layer 5: Circuit Breakers
 *   - Kill switch integration
 *   - Emergency response
 * 
 * Turkish: "Sadece tek bir filtre değil, katmanlı bir savunma yapısı kur."
 */

// ============================================
// RE-EXPORTS FROM SECURITY MODULES
// ============================================

// Adversarial Pattern Database
export {
    AdversarialPatternDatabase,
    getAdversarialPatternDatabase,
    resetAdversarialPatternDatabase,
    scanForAdversarialPatterns,
    isTextSafe,
    type AdversarialPattern,
    type PatternCategory,
    type PatternMatch,
    type ScanResult,
} from "./adversarial-patterns.js";

// Content Sanitization
export {
    sanitize,
    sanitizeText,
    isContentSafe,
    sanitizeNewsContent,
    sanitizeSocialPost,
    sanitizeTokenMetadata,
    sanitizeUserInput,
    sanitizeBatch,
    SanitizationBlockedError,
    type SanitizationOptions,
    type SanitizationResult,
    type BatchSanitizationResult,
} from "./content-sanitizer.js";

// Zero-Trust Message Bus
export {
    ZeroTrustMessageBus,
    getMessageBus,
    resetMessageBus,
    createSecureMessage,
    validateSecureMessage,
    extractSecurePayload,
    createChannel,
    Channels,
    MessageValidationError,
    type SecureMessage,
    type MessageEnvelope,
    type MessageValidationResult,
    type MessageBusConfig,
    type ChannelState,
} from "./message-bus.js";

// Proof of Intent
export {
    ProofOfIntentManager,
    getPoIManager,
    resetPoIManager,
    hashAction,
    verifyProofOfIntent,
    createActionCard,
    type ProofOfIntent,
    type ActionCard,
    type ActionType,
    type PoIVerificationResult,
    type OperatorKeyPair,
} from "./proof-of-intent.js";

// Rate Limiting
export {
    RateLimiter,
    getRateLimiter,
    resetRateLimiter,
    checkRateLimit,
    checkRateLimits,
    createRateLimitMiddleware,
    DEFAULT_RULES as DEFAULT_RATE_LIMIT_RULES,
    type RateLimitRule,
    type RateLimitContext,
    type RateLimitResult,
} from "./rate-limiter.js";

// Anomaly Detection
export {
    AnomalyDetector,
    getAnomalyDetector,
    resetAnomalyDetector,
    detectAnomalies,
    onAnomaly,
    onKillSwitchTrigger,
    type AnomalyEvent,
    type AnomalyType,
    type AnomalyAction,
    type AnomalyRule,
    type DetectionContext,
} from "./anomaly-detector.js";

// Signature Verification
export {
    SignatureVerifier,
    getSignatureVerifier,
    resetSignatureVerifier,
    signWithHmac,
    verifySignature,
    generateSigningKeyPair,
    isSignatureValid,
    type SignedData,
    type VerificationResult,
    type KeyPair,
    type SignatureAlgorithm,
} from "./signature-verification.js";

// Allowlist Management
export {
    AllowlistManager,
    getAllowlistManager,
    resetAllowlistManager,
    isAddressAllowed,
    isTokenAllowed,
    isSourceAllowed,
    allowAddress,
    blockAddress,
    initializeDefaultAllowlists,
    type AllowlistType,
    type AllowlistEntry,
    type BlocklistEntry,
    type AllowlistCheckResult,
} from "./allowlist-manager.js";

// ============================================
// UNIFIED SECURITY LAYER
// ============================================

import { getAdversarialPatternDatabase } from "./adversarial-patterns.js";
import { sanitize, type SanitizationResult } from "./content-sanitizer.js";
import { getMessageBus, type SecureMessage, type MessageValidationResult } from "./message-bus.js";
import { getPoIManager, type ProofOfIntent, type ActionCard, type PoIVerificationResult } from "./proof-of-intent.js";
import { getRateLimiter, type RateLimitResult } from "./rate-limiter.js";
import { getAnomalyDetector, type AnomalyEvent } from "./anomaly-detector.js";
import { getSignatureVerifier, type SignedData, type VerificationResult } from "./signature-verification.js";
import { getAllowlistManager, type AllowlistCheckResult } from "./allowlist-manager.js";
import { logger } from "../logger/index.js";

const securityLogger = logger.child({ component: "security-layer" });

export interface SecurityCheckResult {
    allowed: boolean;
    layer: string;
    reason?: string;
    details?: Record<string, unknown>;
}

export interface FullSecurityCheckResult {
    allowed: boolean;
    failedAt?: string;
    results: {
        sanitization?: SanitizationResult;
        rateLimit?: RateLimitResult;
        allowlist?: AllowlistCheckResult;
        signature?: VerificationResult;
        anomalies?: AnomalyEvent[];
    };
    processingTimeMs: number;
}

/**
 * Unified Security Layer
 * 
 * Provides a single interface for all security checks.
 */
export class SecurityLayer {
    private readonly patterns = getAdversarialPatternDatabase();
    private readonly messageBus = getMessageBus();
    private readonly poiManager = getPoIManager();
    private readonly rateLimiter = getRateLimiter();
    private readonly anomalyDetector = getAnomalyDetector();
    private readonly signatureVerifier = getSignatureVerifier();
    private readonly allowlistManager = getAllowlistManager();

    /**
     * Perform full security check on incoming content
     */
    async checkContent(
        content: string,
        context: {
            source?: string;
            entityId: string;
            entityType: "ip" | "user" | "session" | "wallet" | "token";
            rateRuleId?: string;
        }
    ): Promise<FullSecurityCheckResult> {
        const startTime = Date.now();
        const results: FullSecurityCheckResult["results"] = {};

        // Layer 1: Content Sanitization
        const sanitizationResult = sanitize(content, {
            blockOnHighSeverity: true,
            auditLog: true,
        });
        results.sanitization = sanitizationResult;

        if (sanitizationResult.blocked) {
            return {
                allowed: false,
                failedAt: "sanitization",
                results,
                processingTimeMs: Date.now() - startTime,
            };
        }

        // Layer 2: Rate Limiting
        if (context.rateRuleId) {
            const rateLimitResult = this.rateLimiter.check(context.rateRuleId, {
                identifier: context.entityId,
            });
            results.rateLimit = rateLimitResult;

            if (!rateLimitResult.allowed) {
                return {
                    allowed: false,
                    failedAt: "rateLimit",
                    results,
                    processingTimeMs: Date.now() - startTime,
                };
            }
        }

        // Layer 3: Source Allowlist Check
        if (context.source) {
            const allowlistResult = this.allowlistManager.isAllowed("source", context.source);
            results.allowlist = allowlistResult;

            if (!allowlistResult.allowed) {
                return {
                    allowed: false,
                    failedAt: "allowlist",
                    results,
                    processingTimeMs: Date.now() - startTime,
                };
            }
        }

        // Layer 4: Anomaly Detection
        const anomalies = await this.anomalyDetector.processEvent(
            context.entityId,
            context.entityType,
            { contentLength: content.length }
        );
        results.anomalies = anomalies;

        // Check for critical anomalies
        const criticalAnomalies = anomalies.filter(a => a.severity === "critical");
        if (criticalAnomalies.length > 0) {
            return {
                allowed: false,
                failedAt: "anomalyDetection",
                results,
                processingTimeMs: Date.now() - startTime,
            };
        }

        return {
            allowed: true,
            results,
            processingTimeMs: performance.now() - startTime,
        };
    }

    /**
     * Validate a signed message through the zero-trust bus
     */
    validateMessage<T>(message: SecureMessage<T>): MessageValidationResult {
        return this.messageBus.validateMessage(message);
    }

    /**
     * Validate proof of intent for dashboard action
     */
    validateApproval(proof: ProofOfIntent, actionCard?: ActionCard): PoIVerificationResult {
        return this.poiManager.verifyProof(proof, actionCard);
    }

    /**
     * Verify a signature
     */
    verifySignature<T>(signedData: SignedData<T>, key?: string): VerificationResult {
        return this.signatureVerifier.verify(signedData, key);
    }

    /**
     * Check rate limit
     */
    checkRateLimit(ruleId: string, identifier: string): RateLimitResult {
        return this.rateLimiter.check(ruleId, { identifier });
    }

    /**
     * Check if address is allowed
     */
    isAddressAllowed(address: string): AllowlistCheckResult {
        return this.allowlistManager.isAllowed("address", address);
    }

    /**
     * Get security stats from all components
     */
    getStats(): Record<string, unknown> {
        return {
            patterns: this.patterns.getStats(),
            messageBus: this.messageBus.getStats(),
            proofOfIntent: this.poiManager.getStats(),
            rateLimit: this.rateLimiter.getStats(),
            anomalyDetector: this.anomalyDetector.getStats(),
            signatureVerifier: this.signatureVerifier.getStats(),
            allowlistManager: this.allowlistManager.getStats(),
        };
    }

    /**
     * Initialize all security components
     */
    async initialize(): Promise<void> {
        securityLogger.info("Initializing security layer...");

        // Initialize default allowlists
        const { initializeDefaultAllowlists } = await import("./allowlist-manager.js");
        initializeDefaultAllowlists();

        // Set up anomaly detector event handlers
        this.anomalyDetector.on("kill_switch_trigger", async (data: { reason: string; anomaly: AnomalyEvent }) => {
            securityLogger.warn({
                reason: data.reason,
                anomaly: data.anomaly.type,
            }, "Kill switch triggered by anomaly detector");

            // Import and activate kill switch from base security module - use dynamic import to avoid circular dependency
            try {
                const { activateKillSwitch } = await import("./index.js");
                activateKillSwitch("anomaly-detector", data.reason);
            } catch (error) {
                securityLogger.error({ error }, "Failed to activate kill switch");
            }
        });

        securityLogger.info("Security layer initialized");
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let securityLayerInstance: SecurityLayer | null = null;

export function getSecurityLayer(): SecurityLayer {
    if (!securityLayerInstance) {
        securityLayerInstance = new SecurityLayer();
    }
    return securityLayerInstance;
}

export function resetSecurityLayer(): void {
    securityLayerInstance = null;
}

// ============================================
// QUICK ACCESS FUNCTIONS
// ============================================

/**
 * Perform a quick security check on content
 */
export async function quickSecurityCheck(
    content: string,
    entityId: string
): Promise<boolean> {
    const result = await getSecurityLayer().checkContent(content, {
        entityId,
        entityType: "user",
    });
    return result.allowed;
}

/**
 * Initialize the security layer
 */
export async function initializeSecurity(): Promise<void> {
    await getSecurityLayer().initialize();
}
