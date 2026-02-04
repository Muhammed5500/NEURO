/**
 * Advanced Rate Limiter
 * 
 * Multi-tier rate limiting with sliding windows, token buckets, and velocity tracking.
 * Implements defense in depth for API protection.
 */

import { logger } from "../logger/index.js";

const rateLimitLogger = logger.child({ component: "rate-limiter" });

// ============================================
// TYPES
// ============================================

export interface RateLimitRule {
    /** Rule identifier */
    id: string;

    /** Maximum requests allowed */
    maxRequests: number;

    /** Time window in milliseconds */
    windowMs: number;

    /** Optional: burst allowance above limit */
    burstAllowance?: number;

    /** Optional: penalty duration when exceeded (ms) */
    penaltyDurationMs?: number;

    /** Optional: block entirely vs queue */
    blockOnExceed?: boolean;

    /** Optional: custom key extractor */
    keyExtractor?: (context: RateLimitContext) => string;

    /** Rule description */
    description?: string;
}

export interface RateLimitContext {
    /** Unique identifier for the requester */
    identifier: string;

    /** IP address */
    ip?: string;

    /** User/session ID */
    userId?: string;

    /** API endpoint or action */
    endpoint?: string;

    /** Request method */
    method?: string;

    /** Additional context */
    metadata?: Record<string, unknown>;
}

export interface RateLimitResult {
    /** Whether the request is allowed */
    allowed: boolean;

    /** Number of remaining requests in window */
    remaining: number;

    /** Current request count in window */
    current: number;

    /** Limit for this rule */
    limit: number;

    /** When the window resets (Unix ms) */
    resetAt: number;

    /** If blocked, when the block expires (Unix ms) */
    blockedUntil?: number;

    /** Which rule caused the limit */
    triggeredRule?: string;

    /** Suggested retry-after in seconds (for 429 response) */
    retryAfterSeconds?: number;
}

export interface RateLimitBucket {
    /** Request timestamps in the current window */
    timestamps: number[];

    /** Number of requests in current window */
    count: number;

    /** First request timestamp in window */
    windowStart: number;

    /** If under penalty, when it expires */
    penaltyUntil?: number;

    /** Total requests ever */
    totalRequests: number;

    /** Times this bucket exceeded limit */
    exceedCount: number;
}

// ============================================
// DEFAULT RULES
// ============================================

export const DEFAULT_RULES: RateLimitRule[] = [
    {
        id: "api_global",
        maxRequests: 100,
        windowMs: 60 * 1000,  // 1 minute
        burstAllowance: 20,
        penaltyDurationMs: 60 * 1000,
        description: "Global API rate limit",
    },
    {
        id: "trade_execution",
        maxRequests: 10,
        windowMs: 60 * 1000,  // 1 minute
        penaltyDurationMs: 5 * 60 * 1000,  // 5 minute penalty
        blockOnExceed: true,
        description: "Trade execution limit",
    },
    {
        id: "session_creation",
        maxRequests: 5,
        windowMs: 60 * 60 * 1000,  // 1 hour
        penaltyDurationMs: 24 * 60 * 60 * 1000,  // 24 hour block
        blockOnExceed: true,
        description: "Session creation limit",
    },
    {
        id: "failed_auth",
        maxRequests: 5,
        windowMs: 5 * 60 * 1000,  // 5 minutes
        penaltyDurationMs: 15 * 60 * 1000,  // 15 minute block
        blockOnExceed: true,
        description: "Failed authentication limit",
    },
    {
        id: "kill_switch",
        maxRequests: 3,
        windowMs: 60 * 60 * 1000,  // 1 hour
        penaltyDurationMs: 60 * 60 * 1000,
        description: "Kill switch toggle limit",
    },
    {
        id: "approval_queue",
        maxRequests: 50,
        windowMs: 60 * 1000,
        description: "Approval queue operations",
    },
];

// ============================================
// RATE LIMITER IMPLEMENTATION
// ============================================

export class RateLimiter {
    private readonly rules: Map<string, RateLimitRule> = new Map();
    private readonly buckets: Map<string, Map<string, RateLimitBucket>> = new Map();
    private cleanupInterval?: NodeJS.Timeout;

    // Statistics
    private stats = {
        totalRequests: 0,
        allowedRequests: 0,
        blockedRequests: 0,
        penaltiesApplied: 0,
    };

    constructor(rules: RateLimitRule[] = DEFAULT_RULES) {
        // Register rules
        for (const rule of rules) {
            this.rules.set(rule.id, rule);
        }

        // Start cleanup interval
        this.startCleanup();

        rateLimitLogger.info({
            rulesCount: this.rules.size,
        }, "Rate limiter initialized");
    }

    /**
     * Check if a request is allowed under a specific rule
     */
    check(ruleId: string, context: RateLimitContext): RateLimitResult {
        const rule = this.rules.get(ruleId);
        if (!rule) {
            rateLimitLogger.warn({ ruleId }, "Unknown rate limit rule, allowing by default");
            return {
                allowed: true,
                remaining: Infinity,
                current: 0,
                limit: Infinity,
                resetAt: Date.now(),
            };
        }

        this.stats.totalRequests++;
        const now = Date.now();

        // Get or create bucket for this rule
        let ruleBuckets = this.buckets.get(ruleId);
        if (!ruleBuckets) {
            ruleBuckets = new Map();
            this.buckets.set(ruleId, ruleBuckets);
        }

        // Determine the key for this request
        const key = rule.keyExtractor
            ? rule.keyExtractor(context)
            : context.identifier;

        // Get or create bucket for this key
        let bucket = ruleBuckets.get(key);
        if (!bucket) {
            bucket = {
                timestamps: [],
                count: 0,
                windowStart: now,
                totalRequests: 0,
                exceedCount: 0,
            };
            ruleBuckets.set(key, bucket);
        }

        // Check if under penalty
        if (bucket.penaltyUntil && bucket.penaltyUntil > now) {
            this.stats.blockedRequests++;
            const retryAfterSeconds = Math.ceil((bucket.penaltyUntil - now) / 1000);

            rateLimitLogger.debug({
                ruleId,
                key,
                penaltyUntil: bucket.penaltyUntil,
            }, "Request blocked by penalty");

            return {
                allowed: false,
                remaining: 0,
                current: bucket.count,
                limit: rule.maxRequests,
                resetAt: bucket.penaltyUntil,
                blockedUntil: bucket.penaltyUntil,
                triggeredRule: ruleId,
                retryAfterSeconds,
            };
        }

        // Clean up old timestamps (sliding window)
        const windowStart = now - rule.windowMs;
        bucket.timestamps = bucket.timestamps.filter(ts => ts > windowStart);
        bucket.count = bucket.timestamps.length;

        // Check current count against limit
        const effectiveLimit = rule.maxRequests + (rule.burstAllowance || 0);

        if (bucket.count >= rule.maxRequests) {
            // Check if within burst allowance
            if (bucket.count >= effectiveLimit) {
                // Exceeded even burst - apply penalty if configured
                bucket.exceedCount++;

                if (rule.penaltyDurationMs) {
                    bucket.penaltyUntil = now + rule.penaltyDurationMs;
                    this.stats.penaltiesApplied++;

                    rateLimitLogger.warn({
                        ruleId,
                        key,
                        penaltyDurationMs: rule.penaltyDurationMs,
                        exceedCount: bucket.exceedCount,
                    }, "Rate limit exceeded, penalty applied");
                }

                this.stats.blockedRequests++;

                const retryAfterSeconds = rule.penaltyDurationMs
                    ? Math.ceil(rule.penaltyDurationMs / 1000)
                    : Math.ceil(rule.windowMs / 1000);

                return {
                    allowed: false,
                    remaining: 0,
                    current: bucket.count,
                    limit: rule.maxRequests,
                    resetAt: bucket.penaltyUntil || (bucket.timestamps[0] + rule.windowMs),
                    blockedUntil: bucket.penaltyUntil,
                    triggeredRule: ruleId,
                    retryAfterSeconds,
                };
            }

            // Within burst allowance - warn but allow
            rateLimitLogger.debug({
                ruleId,
                key,
                current: bucket.count,
                limit: rule.maxRequests,
                burst: effectiveLimit,
            }, "Request allowed within burst allowance");
        }

        // Request allowed - record it
        bucket.timestamps.push(now);
        bucket.count++;
        bucket.totalRequests++;
        this.stats.allowedRequests++;

        const remaining = Math.max(0, rule.maxRequests - bucket.count);
        const oldestInWindow = bucket.timestamps[0] || now;
        const resetAt = oldestInWindow + rule.windowMs;

        return {
            allowed: true,
            remaining,
            current: bucket.count,
            limit: rule.maxRequests,
            resetAt,
        };
    }

    /**
     * Check multiple rules at once (all must pass)
     */
    checkAll(ruleIds: string[], context: RateLimitContext): RateLimitResult {
        for (const ruleId of ruleIds) {
            const result = this.check(ruleId, context);
            if (!result.allowed) {
                return result;
            }
        }

        // All rules passed - return aggregated result
        const results = ruleIds.map(id => {
            const rule = this.rules.get(id);
            const bucket = this.buckets.get(id)?.get(context.identifier);
            return { rule, bucket };
        });

        // Find the most restrictive remaining
        let minRemaining = Infinity;
        let nearestReset = Infinity;

        for (const { rule, bucket } of results) {
            if (rule && bucket) {
                const remaining = Math.max(0, rule.maxRequests - bucket.count);
                if (remaining < minRemaining) {
                    minRemaining = remaining;
                }
                const resetAt = (bucket.timestamps[0] || Date.now()) + rule.windowMs;
                if (resetAt < nearestReset) {
                    nearestReset = resetAt;
                }
            }
        }

        return {
            allowed: true,
            remaining: minRemaining === Infinity ? 100 : minRemaining,
            current: 0,
            limit: 0,
            resetAt: nearestReset === Infinity ? Date.now() : nearestReset,
        };
    }

    /**
     * Record a request without checking (for async/background tracking)
     */
    record(ruleId: string, context: RateLimitContext): void {
        const rule = this.rules.get(ruleId);
        if (!rule) return;

        const now = Date.now();

        let ruleBuckets = this.buckets.get(ruleId);
        if (!ruleBuckets) {
            ruleBuckets = new Map();
            this.buckets.set(ruleId, ruleBuckets);
        }

        const key = rule.keyExtractor
            ? rule.keyExtractor(context)
            : context.identifier;

        let bucket = ruleBuckets.get(key);
        if (!bucket) {
            bucket = {
                timestamps: [],
                count: 0,
                windowStart: now,
                totalRequests: 0,
                exceedCount: 0,
            };
            ruleBuckets.set(key, bucket);
        }

        bucket.timestamps.push(now);
        bucket.count++;
        bucket.totalRequests++;
    }

    /**
     * Get current rate limit info without recording
     */
    peek(ruleId: string, context: RateLimitContext): RateLimitResult {
        const rule = this.rules.get(ruleId);
        if (!rule) {
            return {
                allowed: true,
                remaining: Infinity,
                current: 0,
                limit: Infinity,
                resetAt: Date.now(),
            };
        }

        const now = Date.now();
        const ruleBuckets = this.buckets.get(ruleId);
        const key = rule.keyExtractor
            ? rule.keyExtractor(context)
            : context.identifier;

        const bucket = ruleBuckets?.get(key);

        if (!bucket) {
            return {
                allowed: true,
                remaining: rule.maxRequests,
                current: 0,
                limit: rule.maxRequests,
                resetAt: now + rule.windowMs,
            };
        }

        // Check penalty
        if (bucket.penaltyUntil && bucket.penaltyUntil > now) {
            return {
                allowed: false,
                remaining: 0,
                current: bucket.count,
                limit: rule.maxRequests,
                resetAt: bucket.penaltyUntil,
                blockedUntil: bucket.penaltyUntil,
                triggeredRule: ruleId,
            };
        }

        // Calculate current count (sliding window)
        const windowStart = now - rule.windowMs;
        const currentCount = bucket.timestamps.filter(ts => ts > windowStart).length;
        const remaining = Math.max(0, rule.maxRequests - currentCount);
        const oldestInWindow = bucket.timestamps.find(ts => ts > windowStart) || now;

        return {
            allowed: currentCount < rule.maxRequests + (rule.burstAllowance || 0),
            remaining,
            current: currentCount,
            limit: rule.maxRequests,
            resetAt: oldestInWindow + rule.windowMs,
        };
    }

    /**
     * Clear penalty for a specific key
     */
    clearPenalty(ruleId: string, key: string): boolean {
        const bucket = this.buckets.get(ruleId)?.get(key);
        if (bucket && bucket.penaltyUntil) {
            delete bucket.penaltyUntil;
            rateLimitLogger.info({ ruleId, key }, "Penalty cleared");
            return true;
        }
        return false;
    }

    /**
     * Reset a specific bucket
     */
    resetBucket(ruleId: string, key: string): void {
        this.buckets.get(ruleId)?.delete(key);
    }

    /**
     * Add a new rule
     */
    addRule(rule: RateLimitRule): void {
        this.rules.set(rule.id, rule);
        rateLimitLogger.info({ ruleId: rule.id }, "Rate limit rule added");
    }

    /**
     * Remove a rule
     */
    removeRule(ruleId: string): boolean {
        const removed = this.rules.delete(ruleId);
        if (removed) {
            this.buckets.delete(ruleId);
        }
        return removed;
    }

    /**
     * Get all rules
     */
    getRules(): RateLimitRule[] {
        return Array.from(this.rules.values());
    }

    /**
     * Get statistics
     */
    getStats(): typeof this.stats & {
        rulesCount: number;
        activeBuckets: number;
    } {
        let activeBuckets = 0;
        for (const ruleBuckets of this.buckets.values()) {
            activeBuckets += ruleBuckets.size;
        }

        return {
            ...this.stats,
            rulesCount: this.rules.size,
            activeBuckets,
        };
    }

    /**
     * Start cleanup interval
     */
    private startCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            let cleaned = 0;

            for (const [ruleId, ruleBuckets] of this.buckets) {
                const rule = this.rules.get(ruleId);
                if (!rule) continue;

                const windowStart = now - rule.windowMs * 2; // Keep 2x window for safety

                for (const [key, bucket] of ruleBuckets) {
                    // Clean old timestamps
                    bucket.timestamps = bucket.timestamps.filter(ts => ts > windowStart);
                    bucket.count = bucket.timestamps.length;

                    // Remove empty buckets without penalties
                    if (bucket.count === 0 && (!bucket.penaltyUntil || bucket.penaltyUntil < now)) {
                        ruleBuckets.delete(key);
                        cleaned++;
                    }
                }
            }

            if (cleaned > 0) {
                rateLimitLogger.debug({ cleaned }, "Cleaned expired rate limit buckets");
            }
        }, 60 * 1000); // Run every minute
    }

    /**
     * Destroy the rate limiter
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.buckets.clear();
        this.rules.clear();
        rateLimitLogger.info("Rate limiter destroyed");
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let instance: RateLimiter | null = null;

export function getRateLimiter(rules?: RateLimitRule[]): RateLimiter {
    if (!instance) {
        instance = new RateLimiter(rules);
    }
    return instance;
}

export function resetRateLimiter(): void {
    if (instance) {
        instance.destroy();
        instance = null;
    }
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Check a single rate limit rule
 */
export function checkRateLimit(
    ruleId: string,
    identifier: string,
    context?: Partial<RateLimitContext>
): RateLimitResult {
    return getRateLimiter().check(ruleId, { identifier, ...context });
}

/**
 * Check multiple rate limit rules
 */
export function checkRateLimits(
    ruleIds: string[],
    identifier: string,
    context?: Partial<RateLimitContext>
): RateLimitResult {
    return getRateLimiter().checkAll(ruleIds, { identifier, ...context });
}

// ============================================
// EXPRESS MIDDLEWARE (if using Express)
// ============================================

export interface RateLimitMiddlewareOptions {
    ruleId: string;
    keyExtractor?: (req: { ip?: string; headers?: Record<string, string | string[] | undefined> }) => string;
    handler?: (context: { remaining: number; resetAt: number }) => void;
}

/**
 * Create Express-compatible middleware
 */
export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions) {
    const limiter = getRateLimiter();

    return (
        req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
        res: {
            status: (code: number) => { json: (body: unknown) => void };
            setHeader: (name: string, value: string | number) => void;
        },
        next: () => void
    ) => {
        const identifier = options.keyExtractor?.(req) || req.ip || "unknown";
        const result = limiter.check(options.ruleId, { identifier, ip: req.ip });

        // Set rate limit headers
        res.setHeader("X-RateLimit-Limit", result.limit);
        res.setHeader("X-RateLimit-Remaining", result.remaining);
        res.setHeader("X-RateLimit-Reset", Math.ceil(result.resetAt / 1000));

        if (!result.allowed) {
            res.setHeader("Retry-After", result.retryAfterSeconds || 60);
            res.status(429).json({
                error: "Too Many Requests",
                message: `Rate limit exceeded. Try again in ${result.retryAfterSeconds} seconds.`,
                retryAfter: result.retryAfterSeconds,
            });
            return;
        }

        options.handler?.({ remaining: result.remaining, resetAt: result.resetAt });
        next();
    };
}
