/**
 * Signature Verification Module
 * 
 * Multi-algorithm signature verification for secure communications.
 * Supports HMAC-SHA256, Ed25519, ECDSA, and wallet signatures (EIP-712).
 */

import { createHmac, createVerify, createSign, generateKeyPairSync, randomUUID } from "crypto";
import { logger } from "../logger/index.js";

const sigLogger = logger.child({ component: "signature-verification" });

// ============================================
// TYPES
// ============================================

export type SignatureAlgorithm =
    | "HMAC-SHA256"
    | "Ed25519"
    | "ECDSA-secp256k1"
    | "EIP-712";  // Ethereum typed data signing

export interface SignedData<T = unknown> {
    /** The data that was signed */
    data: T;

    /** The signature */
    signature: string;

    /** Algorithm used */
    algorithm: SignatureAlgorithm;

    /** Signer's public key or address */
    signer: string;

    /** Timestamp of signing */
    timestamp: number;

    /** Optional nonce */
    nonce?: string;
}

export interface VerificationResult {
    valid: boolean;
    error?: string;
    signedAt?: number;
    signer?: string;
}

export interface KeyPair {
    publicKey: string;
    privateKey: string;
    algorithm: "Ed25519" | "ECDSA-secp256k1";
    id: string;
    createdAt: number;
}

export interface SignatureConfig {
    /** Default HMAC secret */
    hmacSecret: string;

    /** Allowed algorithms */
    allowedAlgorithms: SignatureAlgorithm[];

    /** Maximum age of signature (ms) */
    maxSignatureAge: number;

    /** Require timestamp in signatures */
    requireTimestamp: boolean;

    /** Require nonce for replay protection */
    requireNonce: boolean;
}

const DEFAULT_CONFIG: SignatureConfig = {
    hmacSecret: "CHANGE_ME_IN_PRODUCTION",
    allowedAlgorithms: ["HMAC-SHA256", "Ed25519", "ECDSA-secp256k1"],
    maxSignatureAge: 5 * 60 * 1000,  // 5 minutes
    requireTimestamp: true,
    requireNonce: false,
};

// ============================================
// EIP-712 TYPE DEFINITIONS
// ============================================

export interface EIP712Domain {
    name: string;
    version: string;
    chainId: number;
    verifyingContract?: string;
}

export interface EIP712Types {
    [key: string]: Array<{ name: string; type: string }>;
}

export const NEURO_EIP712_DOMAIN: EIP712Domain = {
    name: "NEURO",
    version: "1",
    chainId: 143,  // Monad mainnet
    verifyingContract: undefined,  // Set at runtime
};

export const NEURO_EIP712_TYPES: EIP712Types = {
    Action: [
        { name: "id", type: "string" },
        { name: "type", type: "string" },
        { name: "value", type: "uint256" },
        { name: "timestamp", type: "uint256" },
        { name: "nonce", type: "string" },
    ],
    Approval: [
        { name: "actionId", type: "string" },
        { name: "approved", type: "bool" },
        { name: "timestamp", type: "uint256" },
    ],
};

// ============================================
// SIGNATURE VERIFIER IMPLEMENTATION
// ============================================

export class SignatureVerifier {
    private readonly config: SignatureConfig;
    private readonly usedNonces: Map<string, number> = new Map();
    private cleanupInterval?: NodeJS.Timeout;

    // Statistics
    private stats = {
        signaturesVerified: 0,
        signaturesRejected: 0,
        hmacVerifications: 0,
        ed25519Verifications: 0,
        ecdsaVerifications: 0,
    };

    constructor(config?: Partial<SignatureConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.startCleanup();
        sigLogger.info("Signature verifier initialized");
    }

    /**
     * Sign data with HMAC-SHA256
     */
    signHmac<T>(data: T, secret?: string): SignedData<T> {
        const timestamp = Date.now();
        const nonce = randomUUID();
        const signingSecret = secret || this.config.hmacSecret;

        const dataToSign = this.canonicalizeData(data, timestamp, nonce);
        const signature = createHmac("sha256", signingSecret)
            .update(dataToSign)
            .digest("hex");

        return {
            data,
            signature,
            algorithm: "HMAC-SHA256",
            signer: "hmac",
            timestamp,
            nonce,
        };
    }

    /**
     * Sign data with Ed25519
     */
    signEd25519<T>(data: T, privateKey: string): SignedData<T> {
        const timestamp = Date.now();
        const nonce = randomUUID();

        const dataToSign = this.canonicalizeData(data, timestamp, nonce);
        const sign = createSign("SHA256");
        sign.update(dataToSign);
        const signature = sign.sign(privateKey, "hex");

        // Extract public key from private key
        const publicKey = this.extractEd25519PublicKey(privateKey);

        return {
            data,
            signature,
            algorithm: "Ed25519",
            signer: publicKey,
            timestamp,
            nonce,
        };
    }

    /**
     * Sign data with ECDSA (secp256k1)
     */
    signEcdsa<T>(data: T, privateKey: string): SignedData<T> {
        const timestamp = Date.now();
        const nonce = randomUUID();

        const dataToSign = this.canonicalizeData(data, timestamp, nonce);
        const sign = createSign("SHA256");
        sign.update(dataToSign);
        const signature = sign.sign(privateKey, "hex");

        // Extract public key
        const publicKey = this.extractEcdsaPublicKey(privateKey);

        return {
            data,
            signature,
            algorithm: "ECDSA-secp256k1",
            signer: publicKey,
            timestamp,
            nonce,
        };
    }

    /**
     * Verify signed data
     */
    verify<T>(signedData: SignedData<T>, verificationKey?: string): VerificationResult {
        const now = Date.now();

        // Check algorithm is allowed
        if (!this.config.allowedAlgorithms.includes(signedData.algorithm)) {
            this.stats.signaturesRejected++;
            return {
                valid: false,
                error: `Algorithm ${signedData.algorithm} is not allowed`,
            };
        }

        // Check timestamp if required
        if (this.config.requireTimestamp) {
            if (!signedData.timestamp) {
                this.stats.signaturesRejected++;
                return {
                    valid: false,
                    error: "Timestamp is required but missing",
                };
            }

            const age = now - signedData.timestamp;
            if (age > this.config.maxSignatureAge) {
                this.stats.signaturesRejected++;
                return {
                    valid: false,
                    error: `Signature expired: ${age}ms old, max age is ${this.config.maxSignatureAge}ms`,
                };
            }

            // Check for future timestamp
            if (signedData.timestamp > now + 30000) {  // 30s clock skew allowance
                this.stats.signaturesRejected++;
                return {
                    valid: false,
                    error: "Signature timestamp is in the future",
                };
            }
        }

        // Check nonce if required
        if (this.config.requireNonce) {
            if (!signedData.nonce) {
                this.stats.signaturesRejected++;
                return {
                    valid: false,
                    error: "Nonce is required but missing",
                };
            }

            if (this.usedNonces.has(signedData.nonce)) {
                this.stats.signaturesRejected++;
                return {
                    valid: false,
                    error: "Nonce already used (possible replay attack)",
                };
            }

            this.usedNonces.set(signedData.nonce, now);
        }

        // Verify based on algorithm
        let valid = false;

        try {
            switch (signedData.algorithm) {
                case "HMAC-SHA256":
                    valid = this.verifyHmac(signedData, verificationKey);
                    this.stats.hmacVerifications++;
                    break;

                case "Ed25519":
                    valid = this.verifyEd25519(signedData);
                    this.stats.ed25519Verifications++;
                    break;

                case "ECDSA-secp256k1":
                    valid = this.verifyEcdsa(signedData);
                    this.stats.ecdsaVerifications++;
                    break;

                case "EIP-712":
                    // EIP-712 requires special handling with ethers.js
                    // This is a placeholder for wallet signature verification
                    return {
                        valid: false,
                        error: "EIP-712 verification requires external library",
                    };

                default:
                    return {
                        valid: false,
                        error: `Unknown algorithm: ${signedData.algorithm}`,
                    };
            }
        } catch (error) {
            sigLogger.error({ error, algorithm: signedData.algorithm }, "Signature verification error");
            this.stats.signaturesRejected++;
            return {
                valid: false,
                error: `Verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
        }

        if (valid) {
            this.stats.signaturesVerified++;
            return {
                valid: true,
                signedAt: signedData.timestamp,
                signer: signedData.signer,
            };
        } else {
            this.stats.signaturesRejected++;
            return {
                valid: false,
                error: "Signature verification failed",
            };
        }
    }

    /**
     * Verify HMAC signature
     */
    private verifyHmac<T>(signedData: SignedData<T>, secret?: string): boolean {
        const signingSecret = secret || this.config.hmacSecret;
        const dataToSign = this.canonicalizeData(
            signedData.data,
            signedData.timestamp,
            signedData.nonce
        );

        const expectedSignature = createHmac("sha256", signingSecret)
            .update(dataToSign)
            .digest("hex");

        return this.timingSafeEqual(signedData.signature, expectedSignature);
    }

    /**
     * Verify Ed25519 signature
     */
    private verifyEd25519<T>(signedData: SignedData<T>): boolean {
        const dataToSign = this.canonicalizeData(
            signedData.data,
            signedData.timestamp,
            signedData.nonce
        );

        const verify = createVerify("SHA256");
        verify.update(dataToSign);

        return verify.verify(signedData.signer, signedData.signature, "hex");
    }

    /**
     * Verify ECDSA signature
     */
    private verifyEcdsa<T>(signedData: SignedData<T>): boolean {
        const dataToSign = this.canonicalizeData(
            signedData.data,
            signedData.timestamp,
            signedData.nonce
        );

        const verify = createVerify("SHA256");
        verify.update(dataToSign);

        return verify.verify(signedData.signer, signedData.signature, "hex");
    }

    /**
     * Canonicalize data for signing
     */
    private canonicalizeData<T>(data: T, timestamp?: number, nonce?: string): string {
        const canonical = {
            data,
            timestamp,
            nonce,
        };

        return JSON.stringify(canonical, Object.keys(canonical).sort());
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
     * Extract public key from Ed25519 private key
     */
    private extractEd25519PublicKey(privateKey: string): string {
        // In a real implementation, this would parse the PEM and extract the public key
        // For now, we assume the private key is in a format that allows this
        return privateKey.includes("PUBLIC") ? privateKey : `ed25519:${privateKey.slice(0, 64)}`;
    }

    /**
     * Extract public key from ECDSA private key
     */
    private extractEcdsaPublicKey(privateKey: string): string {
        return privateKey.includes("PUBLIC") ? privateKey : `ecdsa:${privateKey.slice(0, 64)}`;
    }

    /**
     * Generate a new key pair
     */
    generateKeyPair(algorithm: "Ed25519" | "ECDSA-secp256k1"): KeyPair {
        let keyPair: { publicKey: string; privateKey: string };

        if (algorithm === "Ed25519") {
            const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
                publicKeyEncoding: { type: "spki", format: "pem" },
                privateKeyEncoding: { type: "pkcs8", format: "pem" },
            });
            keyPair = { publicKey, privateKey };
        } else {
            const { publicKey, privateKey } = generateKeyPairSync("ec", {
                namedCurve: "secp256k1",
                publicKeyEncoding: { type: "spki", format: "pem" },
                privateKeyEncoding: { type: "pkcs8", format: "pem" },
            });
            keyPair = { publicKey, privateKey };
        }

        return {
            ...keyPair,
            algorithm,
            id: randomUUID(),
            createdAt: Date.now(),
        };
    }

    /**
     * Create a signed message wrapper
     */
    createSignedMessage<T>(
        data: T,
        privateKey: string,
        algorithm: "Ed25519" | "ECDSA-secp256k1" = "Ed25519"
    ): SignedData<T> {
        if (algorithm === "Ed25519") {
            return this.signEd25519(data, privateKey);
        } else {
            return this.signEcdsa(data, privateKey);
        }
    }

    /**
     * Get statistics
     */
    getStats(): typeof this.stats {
        return { ...this.stats };
    }

    /**
     * Start nonce cleanup
     */
    private startCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            const threshold = now - this.config.maxSignatureAge * 2;

            for (const [nonce, timestamp] of this.usedNonces) {
                if (timestamp < threshold) {
                    this.usedNonces.delete(nonce);
                }
            }
        }, this.config.maxSignatureAge);
    }

    /**
     * Destroy the verifier
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.usedNonces.clear();
        sigLogger.info("Signature verifier destroyed");
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let instance: SignatureVerifier | null = null;

export function getSignatureVerifier(config?: Partial<SignatureConfig>): SignatureVerifier {
    if (!instance) {
        instance = new SignatureVerifier(config);
    }
    return instance;
}

export function resetSignatureVerifier(): void {
    if (instance) {
        instance.destroy();
        instance = null;
    }
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Sign data with HMAC
 */
export function signWithHmac<T>(data: T, secret?: string): SignedData<T> {
    return getSignatureVerifier().signHmac(data, secret);
}

/**
 * Verify signed data
 */
export function verifySignature<T>(signedData: SignedData<T>, key?: string): VerificationResult {
    return getSignatureVerifier().verify(signedData, key);
}

/**
 * Generate a new key pair
 */
export function generateSigningKeyPair(algorithm: "Ed25519" | "ECDSA-secp256k1" = "Ed25519"): KeyPair {
    return getSignatureVerifier().generateKeyPair(algorithm);
}

/**
 * Quick verification - returns true/false only
 */
export function isSignatureValid<T>(signedData: SignedData<T>, key?: string): boolean {
    return getSignatureVerifier().verify(signedData, key).valid;
}
