/**
 * Anomaly Detection System
 * 
 * Real-time detection of suspicious patterns and behaviors.
 * Implements system-level monitoring as part of defense in depth.
 * 
 * Turkish: "Girdi seviyesinde Sanitization, işlem seviyesinde Signature 
 * Verification ve sistem seviyesinde Anomaly Detection bir arada çalışmalı."
 */

import { EventEmitter } from "events";
import { logger } from "../logger/index.js";

const anomalyLogger = logger.child({ component: "anomaly-detector" });

// ============================================
// TYPES
// ============================================

export interface AnomalyEvent {
    /** Unique event ID */
    id: string;

    /** Type of anomaly */
    type: AnomalyType;

    /** Severity level */
    severity: "low" | "medium" | "high" | "critical";

    /** Description */
    description: string;

    /** Detection timestamp */
    detectedAt: number;

    /** Related entity (IP, user, session, etc.) */
    entity: {
        type: string;
        id: string;
    };

    /** Detection metrics */
    metrics: Record<string, number>;

    /** Recommended action */
    recommendedAction: AnomalyAction;

    /** Whether auto-response was triggered */
    autoResponseTriggered: boolean;
}

export type AnomalyType =
    | "rapid_requests"           // Too many requests in short time
    | "unusual_value"            // Transaction value anomaly
    | "pattern_deviation"        // Behavior differs from baseline
    | "geographic_anomaly"       // Access from unusual location
    | "time_anomaly"             // Activity at unusual times
    | "sequence_violation"       // Out-of-order operations
    | "authentication_anomaly"   // Suspicious auth patterns
    | "data_exfiltration"        // Large data transfers
    | "privilege_escalation"     // Unauthorized access attempts
    | "liquidity_anomaly"        // Unusual liquidity changes
    | "volume_spike"             // Sudden volume increase
    | "coordinated_activity";    // Multiple entities acting together

export type AnomalyAction =
    | "log_only"
    | "alert"
    | "rate_limit"
    | "require_verification"
    | "block_temporarily"
    | "block_permanently"
    | "trigger_kill_switch";

export interface AnomalyRule {
    id: string;
    type: AnomalyType;
    description: string;
    enabled: boolean;

    /** Detection function */
    detect: (context: DetectionContext) => AnomalyDetectionResult | null;

    /** Severity mapping */
    severity: "low" | "medium" | "high" | "critical";

    /** Auto-response action */
    autoResponse?: AnomalyAction;

    /** Cooldown between triggers (ms) */
    cooldownMs: number;
}

export interface DetectionContext {
    /** Entity identifier */
    entityId: string;

    /** Entity type */
    entityType: "ip" | "user" | "session" | "wallet" | "token";

    /** Current metrics */
    currentMetrics: Record<string, number>;

    /** Historical baseline */
    baseline: Record<string, number>;

    /** Recent events count */
    recentEvents: number;

    /** Time of day (0-23) */
    hourOfDay: number;

    /** Day of week (0-6, Sunday = 0) */
    dayOfWeek: number;

    /** Additional context */
    metadata?: Record<string, unknown>;
}

export interface AnomalyDetectionResult {
    anomalyType: AnomalyType;
    confidence: number;  // 0-1
    description: string;
    metrics: Record<string, number>;
}

export interface EntityMetrics {
    /** Request count in last minute */
    requestsPerMinute: number;

    /** Request count in last hour */
    requestsPerHour: number;

    /** Average value per transaction */
    avgTransactionValue: number;

    /** Max value in session */
    maxTransactionValue: number;

    /** Total value in session */
    totalValue: number;

    /** Failed attempts */
    failedAttempts: number;

    /** Successful attempts */
    successfulAttempts: number;

    /** Last activity timestamp */
    lastActivity: number;

    /** First activity timestamp */
    firstActivity: number;

    /** Custom metrics */
    custom: Record<string, number>;
}

// ============================================
// DEFAULT RULES
// ============================================

const DEFAULT_RULES: AnomalyRule[] = [
    {
        id: "rapid_requests",
        type: "rapid_requests",
        description: "Detects unusually high request rates",
        enabled: true,
        severity: "medium",
        cooldownMs: 60000,
        autoResponse: "rate_limit",
        detect: (ctx) => {
            const threshold = ctx.baseline.requestsPerMinute * 3 || 50;
            if (ctx.currentMetrics.requestsPerMinute > threshold) {
                return {
                    anomalyType: "rapid_requests",
                    confidence: Math.min(1, ctx.currentMetrics.requestsPerMinute / threshold - 1),
                    description: `Request rate ${ctx.currentMetrics.requestsPerMinute}/min exceeds threshold ${threshold}/min`,
                    metrics: { rate: ctx.currentMetrics.requestsPerMinute, threshold },
                };
            }
            return null;
        },
    },
    {
        id: "unusual_value",
        type: "unusual_value",
        description: "Detects transaction values outside normal range",
        enabled: true,
        severity: "high",
        cooldownMs: 300000,
        autoResponse: "require_verification",
        detect: (ctx) => {
            const avgValue = ctx.baseline.avgTransactionValue || 0.1;
            const currentValue = ctx.currentMetrics.transactionValue || 0;

            // Flag if > 10x average or > 1 MON
            if (currentValue > avgValue * 10 || currentValue > 1) {
                return {
                    anomalyType: "unusual_value",
                    confidence: Math.min(1, currentValue / (avgValue * 10)),
                    description: `Transaction value ${currentValue} MON is unusually high (avg: ${avgValue} MON)`,
                    metrics: { value: currentValue, average: avgValue },
                };
            }
            return null;
        },
    },
    {
        id: "failed_auth_burst",
        type: "authentication_anomaly",
        description: "Detects rapid failed authentication attempts",
        enabled: true,
        severity: "high",
        cooldownMs: 900000,  // 15 minutes
        autoResponse: "block_temporarily",
        detect: (ctx) => {
            const threshold = 5;
            if (ctx.currentMetrics.failedAttempts > threshold) {
                return {
                    anomalyType: "authentication_anomaly",
                    confidence: Math.min(1, (ctx.currentMetrics.failedAttempts - threshold) / 10),
                    description: `${ctx.currentMetrics.failedAttempts} failed authentication attempts detected`,
                    metrics: { failed: ctx.currentMetrics.failedAttempts, threshold },
                };
            }
            return null;
        },
    },
    {
        id: "time_anomaly",
        type: "time_anomaly",
        description: "Detects activity during unusual hours",
        enabled: true,
        severity: "low",
        cooldownMs: 3600000,  // 1 hour
        autoResponse: "alert",
        detect: (ctx) => {
            // Flag activity between 2 AM and 5 AM local time
            const unusualHours = [2, 3, 4, 5];
            if (unusualHours.includes(ctx.hourOfDay) && ctx.recentEvents > 10) {
                return {
                    anomalyType: "time_anomaly",
                    confidence: 0.6,
                    description: `Unusual activity detected at ${ctx.hourOfDay}:00`,
                    metrics: { hour: ctx.hourOfDay, events: ctx.recentEvents },
                };
            }
            return null;
        },
    },
    {
        id: "liquidity_drain",
        type: "liquidity_anomaly",
        description: "Detects rapid liquidity decrease (potential rug)",
        enabled: true,
        severity: "critical",
        cooldownMs: 60000,
        autoResponse: "trigger_kill_switch",
        detect: (ctx) => {
            const liquidityDelta = ctx.currentMetrics.liquidityDelta || 0;
            // Alert if > 50% liquidity removed
            if (liquidityDelta < -0.5) {
                return {
                    anomalyType: "liquidity_anomaly",
                    confidence: Math.min(1, Math.abs(liquidityDelta)),
                    description: `${Math.abs(liquidityDelta * 100).toFixed(1)}% liquidity removed`,
                    metrics: { delta: liquidityDelta },
                };
            }
            return null;
        },
    },
    {
        id: "volume_spike",
        type: "volume_spike",
        description: "Detects sudden trading volume increases",
        enabled: true,
        severity: "medium",
        cooldownMs: 300000,
        autoResponse: "alert",
        detect: (ctx) => {
            const avgVolume = ctx.baseline.avgHourlyVolume || 10;
            const currentVolume = ctx.currentMetrics.hourlyVolume || 0;

            if (currentVolume > avgVolume * 5) {
                return {
                    anomalyType: "volume_spike",
                    confidence: Math.min(1, currentVolume / (avgVolume * 10)),
                    description: `Volume spike: ${currentVolume} (avg: ${avgVolume})`,
                    metrics: { current: currentVolume, average: avgVolume },
                };
            }
            return null;
        },
    },
];

// ============================================
// ANOMALY DETECTOR IMPLEMENTATION
// ============================================

export class AnomalyDetector extends EventEmitter {
    private readonly rules: Map<string, AnomalyRule> = new Map();
    private readonly entityMetrics: Map<string, EntityMetrics> = new Map();
    private readonly baselines: Map<string, Record<string, number>> = new Map();
    private readonly recentAnomalies: AnomalyEvent[] = [];
    private readonly cooldowns: Map<string, number> = new Map();

    private cleanupInterval?: NodeJS.Timeout;

    // Statistics
    private stats = {
        eventsProcessed: 0,
        anomaliesDetected: 0,
        autoResponsesTriggered: 0,
        criticalAnomalies: 0,
    };

    constructor(rules: AnomalyRule[] = DEFAULT_RULES) {
        super();

        // Register rules
        for (const rule of rules) {
            this.rules.set(rule.id, rule);
        }

        // Start cleanup
        this.startCleanup();

        anomalyLogger.info({
            rulesCount: this.rules.size,
        }, "Anomaly detector initialized");
    }

    /**
     * Process an event and check for anomalies
     */
    async processEvent(
        entityId: string,
        entityType: DetectionContext["entityType"],
        metrics: Partial<EntityMetrics["custom"]> & { [key: string]: number },
        metadata?: Record<string, unknown>
    ): Promise<AnomalyEvent[]> {
        this.stats.eventsProcessed++;
        const now = Date.now();
        const detected: AnomalyEvent[] = [];

        // Update entity metrics
        this.updateEntityMetrics(entityId, metrics);

        // Get current metrics and baseline
        const currentMetrics = this.getEntityMetrics(entityId);
        const baseline = this.getBaseline(entityId);

        // Build detection context
        const date = new Date();
        const context: DetectionContext = {
            entityId,
            entityType,
            currentMetrics: { ...metrics, ...this.flattenMetrics(currentMetrics) },
            baseline,
            recentEvents: currentMetrics.requestsPerMinute,
            hourOfDay: date.getHours(),
            dayOfWeek: date.getDay(),
            metadata,
        };

        // Run all enabled rules
        for (const rule of this.rules.values()) {
            if (!rule.enabled) continue;

            // Check cooldown
            const cooldownKey = `${rule.id}:${entityId}`;
            const lastTrigger = this.cooldowns.get(cooldownKey);
            if (lastTrigger && now - lastTrigger < rule.cooldownMs) {
                continue;
            }

            try {
                const result = rule.detect(context);

                if (result && result.confidence > 0.3) {  // Minimum confidence threshold
                    const anomaly = this.createAnomalyEvent(
                        result,
                        rule,
                        entityId,
                        entityType,
                        now
                    );

                    detected.push(anomaly);
                    this.recentAnomalies.push(anomaly);
                    this.cooldowns.set(cooldownKey, now);
                    this.stats.anomaliesDetected++;

                    if (rule.severity === "critical") {
                        this.stats.criticalAnomalies++;
                    }

                    // Emit event
                    this.emit("anomaly", anomaly);

                    // Handle auto-response
                    if (rule.autoResponse && result.confidence > 0.7) {
                        await this.handleAutoResponse(rule.autoResponse, anomaly);
                        anomaly.autoResponseTriggered = true;
                        this.stats.autoResponsesTriggered++;
                    }

                    anomalyLogger.warn({
                        anomalyId: anomaly.id,
                        type: anomaly.type,
                        severity: anomaly.severity,
                        entityId,
                        confidence: result.confidence,
                        autoResponse: anomaly.autoResponseTriggered ? rule.autoResponse : null,
                    }, "Anomaly detected");
                }
            } catch (error) {
                anomalyLogger.error({ error, ruleId: rule.id }, "Error in anomaly detection rule");
            }
        }

        return detected;
    }

    /**
     * Create an anomaly event
     */
    private createAnomalyEvent(
        result: AnomalyDetectionResult,
        rule: AnomalyRule,
        entityId: string,
        entityType: DetectionContext["entityType"],
        timestamp: number
    ): AnomalyEvent {
        return {
            id: `anomaly-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
            type: result.anomalyType,
            severity: rule.severity,
            description: result.description,
            detectedAt: timestamp,
            entity: { type: entityType, id: entityId },
            metrics: result.metrics,
            recommendedAction: rule.autoResponse || "log_only",
            autoResponseTriggered: false,
        };
    }

    /**
     * Handle auto-response action
     */
    private async handleAutoResponse(
        action: AnomalyAction,
        anomaly: AnomalyEvent
    ): Promise<void> {
        anomalyLogger.info({
            action,
            anomalyId: anomaly.id,
            entityId: anomaly.entity.id,
        }, "Executing auto-response");

        switch (action) {
            case "log_only":
                // Already logged
                break;

            case "alert":
                this.emit("alert", {
                    type: "anomaly_detected",
                    severity: anomaly.severity,
                    message: anomaly.description,
                    anomaly,
                });
                break;

            case "rate_limit":
                this.emit("rate_limit_request", {
                    entityId: anomaly.entity.id,
                    durationMs: 60000,
                    reason: anomaly.description,
                });
                break;

            case "require_verification":
                this.emit("verification_required", {
                    entityId: anomaly.entity.id,
                    reason: anomaly.description,
                    anomaly,
                });
                break;

            case "block_temporarily":
                this.emit("block_entity", {
                    entityId: anomaly.entity.id,
                    durationMs: 15 * 60 * 1000,  // 15 minutes
                    reason: anomaly.description,
                    permanent: false,
                });
                break;

            case "block_permanently":
                this.emit("block_entity", {
                    entityId: anomaly.entity.id,
                    permanent: true,
                    reason: anomaly.description,
                });
                break;

            case "trigger_kill_switch":
                this.emit("kill_switch_trigger", {
                    reason: `Anomaly: ${anomaly.description}`,
                    anomaly,
                });
                break;
        }
    }

    /**
     * Update entity metrics
     */
    private updateEntityMetrics(entityId: string, metrics: Record<string, number>): void {
        const now = Date.now();
        let entityMetrics = this.entityMetrics.get(entityId);

        if (!entityMetrics) {
            entityMetrics = {
                requestsPerMinute: 0,
                requestsPerHour: 0,
                avgTransactionValue: 0,
                maxTransactionValue: 0,
                totalValue: 0,
                failedAttempts: 0,
                successfulAttempts: 0,
                lastActivity: now,
                firstActivity: now,
                custom: {},
            };
            this.entityMetrics.set(entityId, entityMetrics);
        }

        // Update standard metrics
        entityMetrics.requestsPerMinute++;
        entityMetrics.requestsPerHour++;
        entityMetrics.lastActivity = now;

        // Update value metrics if provided
        if (metrics.transactionValue !== undefined) {
            entityMetrics.totalValue += metrics.transactionValue;
            const txCount = (entityMetrics.successfulAttempts || 1);
            entityMetrics.avgTransactionValue = entityMetrics.totalValue / txCount;
            entityMetrics.maxTransactionValue = Math.max(
                entityMetrics.maxTransactionValue,
                metrics.transactionValue
            );
        }

        // Update success/failure
        if (metrics.success !== undefined) {
            if (metrics.success) {
                entityMetrics.successfulAttempts++;
            } else {
                entityMetrics.failedAttempts++;
            }
        }

        // Update custom metrics
        for (const [key, value] of Object.entries(metrics)) {
            if (!["transactionValue", "success"].includes(key)) {
                entityMetrics.custom[key] = value;
            }
        }
    }

    /**
     * Get entity metrics
     */
    private getEntityMetrics(entityId: string): EntityMetrics {
        return this.entityMetrics.get(entityId) || {
            requestsPerMinute: 0,
            requestsPerHour: 0,
            avgTransactionValue: 0,
            maxTransactionValue: 0,
            totalValue: 0,
            failedAttempts: 0,
            successfulAttempts: 0,
            lastActivity: Date.now(),
            firstActivity: Date.now(),
            custom: {},
        };
    }

    /**
     * Flatten entity metrics for detection context
     */
    private flattenMetrics(metrics: EntityMetrics): Record<string, number> {
        return {
            requestsPerMinute: metrics.requestsPerMinute,
            requestsPerHour: metrics.requestsPerHour,
            avgTransactionValue: metrics.avgTransactionValue,
            maxTransactionValue: metrics.maxTransactionValue,
            totalValue: metrics.totalValue,
            failedAttempts: metrics.failedAttempts,
            successfulAttempts: metrics.successfulAttempts,
            ...metrics.custom,
        };
    }

    /**
     * Get or create baseline for entity
     */
    private getBaseline(entityId: string): Record<string, number> {
        return this.baselines.get(entityId) || {
            requestsPerMinute: 10,
            requestsPerHour: 100,
            avgTransactionValue: 0.1,
            avgHourlyVolume: 10,
        };
    }

    /**
     * Update baseline for entity
     */
    updateBaseline(entityId: string, baseline: Record<string, number>): void {
        const existing = this.baselines.get(entityId) || {};
        this.baselines.set(entityId, { ...existing, ...baseline });
    }

    /**
     * Get recent anomalies
     */
    getRecentAnomalies(limit = 100): AnomalyEvent[] {
        return this.recentAnomalies.slice(-limit);
    }

    /**
     * Get anomalies by severity
     */
    getAnomaliesBySeverity(severity: AnomalyEvent["severity"]): AnomalyEvent[] {
        return this.recentAnomalies.filter(a => a.severity === severity);
    }

    /**
     * Add a custom rule
     */
    addRule(rule: AnomalyRule): void {
        this.rules.set(rule.id, rule);
        anomalyLogger.info({ ruleId: rule.id }, "Anomaly rule added");
    }

    /**
     * Remove a rule
     */
    removeRule(ruleId: string): boolean {
        return this.rules.delete(ruleId);
    }

    /**
     * Enable/disable a rule
     */
    setRuleEnabled(ruleId: string, enabled: boolean): boolean {
        const rule = this.rules.get(ruleId);
        if (rule) {
            rule.enabled = enabled;
            return true;
        }
        return false;
    }

    /**
     * Get statistics
     */
    getStats(): typeof this.stats & {
        rulesCount: number;
        enabledRules: number;
        trackedEntities: number;
        recentAnomaliesCount: number;
    } {
        return {
            ...this.stats,
            rulesCount: this.rules.size,
            enabledRules: Array.from(this.rules.values()).filter(r => r.enabled).length,
            trackedEntities: this.entityMetrics.size,
            recentAnomaliesCount: this.recentAnomalies.length,
        };
    }

    /**
     * Start cleanup interval
     */
    private startCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            const oneHourAgo = now - 60 * 60 * 1000;

            // Reset per-minute counters
            for (const metrics of this.entityMetrics.values()) {
                metrics.requestsPerMinute = 0;
            }

            // Clean old anomalies (keep last 24 hours)
            const oneDayAgo = now - 24 * 60 * 60 * 1000;
            while (this.recentAnomalies.length > 0 &&
                this.recentAnomalies[0].detectedAt < oneDayAgo) {
                this.recentAnomalies.shift();
            }

            // Clean inactive entities (no activity in 1 hour)
            for (const [entityId, metrics] of this.entityMetrics) {
                if (metrics.lastActivity < oneHourAgo) {
                    this.entityMetrics.delete(entityId);
                }
            }

        }, 60 * 1000);  // Run every minute
    }

    /**
     * Destroy the detector
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.removeAllListeners();
        this.entityMetrics.clear();
        this.rules.clear();
        anomalyLogger.info("Anomaly detector destroyed");
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let instance: AnomalyDetector | null = null;

export function getAnomalyDetector(rules?: AnomalyRule[]): AnomalyDetector {
    if (!instance) {
        instance = new AnomalyDetector(rules);
    }
    return instance;
}

export function resetAnomalyDetector(): void {
    if (instance) {
        instance.destroy();
        instance = null;
    }
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Process an event for anomaly detection
 */
export async function detectAnomalies(
    entityId: string,
    entityType: DetectionContext["entityType"],
    metrics: Record<string, number>,
    metadata?: Record<string, unknown>
): Promise<AnomalyEvent[]> {
    return getAnomalyDetector().processEvent(entityId, entityType, metrics, metadata);
}

/**
 * Subscribe to anomaly events
 */
export function onAnomaly(handler: (anomaly: AnomalyEvent) => void): void {
    getAnomalyDetector().on("anomaly", handler);
}

/**
 * Subscribe to kill switch triggers
 */
export function onKillSwitchTrigger(handler: (data: { reason: string; anomaly: AnomalyEvent }) => void): void {
    getAnomalyDetector().on("kill_switch_trigger", handler);
}
