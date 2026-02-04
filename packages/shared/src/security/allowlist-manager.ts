/**
 * Allowlist Manager
 * 
 * Whitelist-based access control for addresses, tokens, sources, and operators.
 * Implements strict allowlist enforcement as part of defense in depth.
 */

import { logger } from "../logger/index.js";

const allowlistLogger = logger.child({ component: "allowlist-manager" });

// ============================================
// TYPES
// ============================================

export type AllowlistType =
    | "address"        // Wallet/contract addresses
    | "token"          // Token addresses
    | "operator"       // Operator IDs
    | "source"         // Data sources (news, social)
    | "ip"             // IP addresses
    | "domain"         // Domain names
    | "api_key";       // API keys

export interface AllowlistEntry {
    /** Unique identifier */
    id: string;

    /** Type of entry */
    type: AllowlistType;

    /** The value being allowlisted */
    value: string;

    /** Human-readable label */
    label?: string;

    /** Why this entry was added */
    reason?: string;

    /** Who added this entry */
    addedBy: string;

    /** When added */
    addedAt: number;

    /** Optional expiry */
    expiresAt?: number;

    /** Whether currently active */
    active: boolean;

    /** Tags for organization */
    tags?: string[];

    /** Additional metadata */
    metadata?: Record<string, unknown>;
}

export interface BlocklistEntry extends Omit<AllowlistEntry, "active"> {
    /** Severity of the block */
    severity: "temporary" | "permanent";

    /** When the block expires (if temporary) */
    unblockAt?: number;
}

export interface AllowlistCheckResult {
    allowed: boolean;
    entry?: AllowlistEntry;
    reason?: string;
}

export interface AllowlistConfig {
    /** If true, reject anything not on allowlist. If false, allow by default */
    strictMode: boolean;

    /** Case-insensitive matching */
    caseInsensitive: boolean;

    /** Log all checks */
    auditLog: boolean;
}

const DEFAULT_CONFIG: AllowlistConfig = {
    strictMode: true,
    caseInsensitive: true,
    auditLog: true,
};

// ============================================
// ALLOWLIST MANAGER IMPLEMENTATION
// ============================================

export class AllowlistManager {
    private readonly config: AllowlistConfig;

    // Allowlists by type
    private readonly allowlists: Map<AllowlistType, Map<string, AllowlistEntry>> = new Map();

    // Blocklists by type
    private readonly blocklists: Map<AllowlistType, Map<string, BlocklistEntry>> = new Map();

    // Statistics
    private stats = {
        checksPerformed: 0,
        allowed: 0,
        blocked: 0,
        entriesAdded: 0,
        entriesRemoved: 0,
    };

    constructor(config?: Partial<AllowlistConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        // Initialize maps for each type
        const types: AllowlistType[] = ["address", "token", "operator", "source", "ip", "domain", "api_key"];
        for (const type of types) {
            this.allowlists.set(type, new Map());
            this.blocklists.set(type, new Map());
        }

        allowlistLogger.info({
            strictMode: this.config.strictMode,
        }, "Allowlist manager initialized");
    }

    /**
     * Normalize value for comparison
     */
    private normalizeValue(value: string): string {
        let normalized = value.trim();
        if (this.config.caseInsensitive) {
            normalized = normalized.toLowerCase();
        }
        return normalized;
    }

    /**
     * Add entry to allowlist
     */
    addToAllowlist(
        type: AllowlistType,
        value: string,
        options: {
            label?: string;
            reason?: string;
            addedBy: string;
            expiresAt?: number;
            tags?: string[];
            metadata?: Record<string, unknown>;
        }
    ): AllowlistEntry {
        const normalizedValue = this.normalizeValue(value);
        const id = `${type}:${normalizedValue}:${Date.now()}`;

        const entry: AllowlistEntry = {
            id,
            type,
            value: normalizedValue,
            label: options.label,
            reason: options.reason,
            addedBy: options.addedBy,
            addedAt: Date.now(),
            expiresAt: options.expiresAt,
            active: true,
            tags: options.tags,
            metadata: options.metadata,
        };

        this.allowlists.get(type)!.set(normalizedValue, entry);
        this.stats.entriesAdded++;

        allowlistLogger.info({
            type,
            value: normalizedValue,
            addedBy: options.addedBy,
        }, "Entry added to allowlist");

        return entry;
    }

    /**
     * Add entry to blocklist
     */
    addToBlocklist(
        type: AllowlistType,
        value: string,
        options: {
            label?: string;
            reason?: string;
            addedBy: string;
            severity: "temporary" | "permanent";
            unblockAt?: number;
            tags?: string[];
            metadata?: Record<string, unknown>;
        }
    ): BlocklistEntry {
        const normalizedValue = this.normalizeValue(value);
        const id = `block:${type}:${normalizedValue}:${Date.now()}`;

        const entry: BlocklistEntry = {
            id,
            type,
            value: normalizedValue,
            label: options.label,
            reason: options.reason,
            addedBy: options.addedBy,
            addedAt: Date.now(),
            severity: options.severity,
            unblockAt: options.unblockAt,
            tags: options.tags,
            metadata: options.metadata,
        };

        this.blocklists.get(type)!.set(normalizedValue, entry);
        this.stats.entriesAdded++;

        allowlistLogger.warn({
            type,
            value: normalizedValue,
            severity: options.severity,
            addedBy: options.addedBy,
        }, "Entry added to blocklist");

        return entry;
    }

    /**
     * Remove from allowlist
     */
    removeFromAllowlist(type: AllowlistType, value: string): boolean {
        const normalizedValue = this.normalizeValue(value);
        const removed = this.allowlists.get(type)!.delete(normalizedValue);

        if (removed) {
            this.stats.entriesRemoved++;
            allowlistLogger.info({ type, value: normalizedValue }, "Entry removed from allowlist");
        }

        return removed;
    }

    /**
     * Remove from blocklist
     */
    removeFromBlocklist(type: AllowlistType, value: string): boolean {
        const normalizedValue = this.normalizeValue(value);
        const removed = this.blocklists.get(type)!.delete(normalizedValue);

        if (removed) {
            this.stats.entriesRemoved++;
            allowlistLogger.info({ type, value: normalizedValue }, "Entry removed from blocklist");
        }

        return removed;
    }

    /**
     * Check if value is allowed
     */
    isAllowed(type: AllowlistType, value: string): AllowlistCheckResult {
        const normalizedValue = this.normalizeValue(value);
        this.stats.checksPerformed++;
        const now = Date.now();

        // First check blocklist (takes precedence)
        const blockEntry = this.blocklists.get(type)!.get(normalizedValue);
        if (blockEntry) {
            // Check if temporary block has expired
            if (blockEntry.severity === "temporary" && blockEntry.unblockAt && blockEntry.unblockAt <= now) {
                // Block has expired, remove it
                this.blocklists.get(type)!.delete(normalizedValue);
            } else {
                this.stats.blocked++;

                if (this.config.auditLog) {
                    allowlistLogger.debug({
                        type,
                        value: normalizedValue,
                        result: "blocked",
                        reason: blockEntry.reason,
                    }, "Allowlist check: blocked");
                }

                return {
                    allowed: false,
                    reason: `Blocked: ${blockEntry.reason || "On blocklist"}`,
                };
            }
        }

        // Then check allowlist
        const allowEntry = this.allowlists.get(type)!.get(normalizedValue);

        if (allowEntry) {
            // Check if entry has expired
            if (allowEntry.expiresAt && allowEntry.expiresAt <= now) {
                this.allowlists.get(type)!.delete(normalizedValue);
            } else if (allowEntry.active) {
                this.stats.allowed++;

                if (this.config.auditLog) {
                    allowlistLogger.debug({
                        type,
                        value: normalizedValue,
                        result: "allowed",
                        label: allowEntry.label,
                    }, "Allowlist check: allowed");
                }

                return {
                    allowed: true,
                    entry: allowEntry,
                };
            }
        }

        // Not on either list - use strict mode setting
        if (this.config.strictMode) {
            this.stats.blocked++;

            if (this.config.auditLog) {
                allowlistLogger.debug({
                    type,
                    value: normalizedValue,
                    result: "blocked",
                    reason: "Not on allowlist (strict mode)",
                }, "Allowlist check: blocked (strict)");
            }

            return {
                allowed: false,
                reason: "Not on allowlist",
            };
        } else {
            this.stats.allowed++;
            return {
                allowed: true,
                reason: "Allowed by default (non-strict mode)",
            };
        }
    }

    /**
     * Bulk check multiple values
     */
    checkBulk(type: AllowlistType, values: string[]): Map<string, AllowlistCheckResult> {
        const results = new Map<string, AllowlistCheckResult>();

        for (const value of values) {
            results.set(value, this.isAllowed(type, value));
        }

        return results;
    }

    /**
     * Get all entries of a type
     */
    getAllowlist(type: AllowlistType): AllowlistEntry[] {
        return Array.from(this.allowlists.get(type)!.values());
    }

    /**
     * Get all blocked entries of a type
     */
    getBlocklist(type: AllowlistType): BlocklistEntry[] {
        return Array.from(this.blocklists.get(type)!.values());
    }

    /**
     * Get entry by value
     */
    getEntry(type: AllowlistType, value: string): AllowlistEntry | undefined {
        const normalizedValue = this.normalizeValue(value);
        return this.allowlists.get(type)!.get(normalizedValue);
    }

    /**
     * Update entry
     */
    updateEntry(
        type: AllowlistType,
        value: string,
        updates: Partial<Pick<AllowlistEntry, "label" | "reason" | "expiresAt" | "active" | "tags" | "metadata">>
    ): AllowlistEntry | undefined {
        const normalizedValue = this.normalizeValue(value);
        const entry = this.allowlists.get(type)!.get(normalizedValue);

        if (entry) {
            Object.assign(entry, updates);
            allowlistLogger.info({ type, value: normalizedValue }, "Allowlist entry updated");
            return entry;
        }

        return undefined;
    }

    /**
     * Bulk add to allowlist
     */
    bulkAddToAllowlist(
        type: AllowlistType,
        values: string[],
        options: {
            label?: string;
            reason?: string;
            addedBy: string;
            tags?: string[];
        }
    ): AllowlistEntry[] {
        return values.map(value => this.addToAllowlist(type, value, options));
    }

    /**
     * Clear all entries of a type
     */
    clear(type: AllowlistType): void {
        this.allowlists.get(type)!.clear();
        this.blocklists.get(type)!.clear();
        allowlistLogger.info({ type }, "Allowlist cleared");
    }

    /**
     * Get counts
     */
    getCounts(): Record<AllowlistType, { allowlist: number; blocklist: number }> {
        const counts: Record<string, { allowlist: number; blocklist: number }> = {};

        for (const type of this.allowlists.keys()) {
            counts[type] = {
                allowlist: this.allowlists.get(type)!.size,
                blocklist: this.blocklists.get(type)!.size,
            };
        }

        return counts as Record<AllowlistType, { allowlist: number; blocklist: number }>;
    }

    /**
     * Get statistics
     */
    getStats(): typeof this.stats {
        return { ...this.stats };
    }

    /**
     * Export allowlist/blocklist as JSON
     */
    export(type: AllowlistType): {
        allowlist: AllowlistEntry[];
        blocklist: BlocklistEntry[];
    } {
        return {
            allowlist: Array.from(this.allowlists.get(type)!.values()),
            blocklist: Array.from(this.blocklists.get(type)!.values()),
        };
    }

    /**
     * Import allowlist entries
     */
    import(
        type: AllowlistType,
        data: { allowlist?: AllowlistEntry[]; blocklist?: BlocklistEntry[] }
    ): { imported: number; errors: number } {
        let imported = 0;
        let errors = 0;

        if (data.allowlist) {
            for (const entry of data.allowlist) {
                try {
                    this.allowlists.get(type)!.set(this.normalizeValue(entry.value), entry);
                    imported++;
                } catch {
                    errors++;
                }
            }
        }

        if (data.blocklist) {
            for (const entry of data.blocklist) {
                try {
                    this.blocklists.get(type)!.set(this.normalizeValue(entry.value), entry);
                    imported++;
                } catch {
                    errors++;
                }
            }
        }

        allowlistLogger.info({ type, imported, errors }, "Allowlist imported");
        return { imported, errors };
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let instance: AllowlistManager | null = null;

export function getAllowlistManager(config?: Partial<AllowlistConfig>): AllowlistManager {
    if (!instance) {
        instance = new AllowlistManager(config);
    }
    return instance;
}

export function resetAllowlistManager(): void {
    instance = null;
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Check if an address is allowed
 */
export function isAddressAllowed(address: string): AllowlistCheckResult {
    return getAllowlistManager().isAllowed("address", address);
}

/**
 * Check if a token is allowed
 */
export function isTokenAllowed(tokenAddress: string): AllowlistCheckResult {
    return getAllowlistManager().isAllowed("token", tokenAddress);
}

/**
 * Check if a source is allowed
 */
export function isSourceAllowed(source: string): AllowlistCheckResult {
    return getAllowlistManager().isAllowed("source", source);
}

/**
 * Add address to allowlist
 */
export function allowAddress(address: string, addedBy: string, options?: {
    label?: string;
    reason?: string;
}): AllowlistEntry {
    return getAllowlistManager().addToAllowlist("address", address, {
        addedBy,
        ...options,
    });
}

/**
 * Block an address
 */
export function blockAddress(address: string, addedBy: string, options?: {
    reason?: string;
    permanent?: boolean;
    durationMs?: number;
}): BlocklistEntry {
    return getAllowlistManager().addToBlocklist("address", address, {
        addedBy,
        severity: options?.permanent ? "permanent" : "temporary",
        unblockAt: options?.durationMs ? Date.now() + options.durationMs : undefined,
        reason: options?.reason,
    });
}

// ============================================
// DEFAULT ALLOWLISTS
// ============================================

/**
 * Initialize default trusted sources
 */
export function initializeDefaultAllowlists(): void {
    const manager = getAllowlistManager();

    // Trusted news sources
    const trustedSources = [
        "coindesk.com",
        "cointelegraph.com",
        "theblock.co",
        "decrypt.co",
        "bloomberg.com",
        "reuters.com",
    ];

    for (const source of trustedSources) {
        manager.addToAllowlist("source", source, {
            addedBy: "system",
            label: "Trusted news source",
            reason: "Pre-approved trusted source",
            tags: ["news", "trusted"],
        });
    }

    // Trusted social accounts (examples)
    const trustedAccounts = [
        "vitalik.eth",
        "molochchan",
    ];

    for (const account of trustedAccounts) {
        manager.addToAllowlist("source", account, {
            addedBy: "system",
            label: "Trusted social account",
            reason: "Pre-approved influencer",
            tags: ["social", "trusted"],
        });
    }

    allowlistLogger.info("Default allowlists initialized");
}
