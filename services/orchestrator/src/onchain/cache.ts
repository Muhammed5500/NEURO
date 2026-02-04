/**
 * Cache Layer
 * 
 * Short TTL cache with invalidation for on-chain data.
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { CacheEntry } from "./types.js";

const cacheLogger = logger.child({ component: "onchain-cache" });

// ============================================
// CACHE CONFIGURATION
// ============================================

export interface CacheConfig {
  // Default TTL in milliseconds
  defaultTtlMs: number;
  
  // TTL overrides by key prefix
  ttlOverrides: Record<string, number>;
  
  // Maximum cache size
  maxEntries: number;
  
  // Enable cache logging
  enableLogging: boolean;
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  defaultTtlMs: 5000, // 5 seconds default
  ttlOverrides: {
    "network:": 2000,      // Network state: 2s (changes fast)
    "pool:": 5000,         // Pool data: 5s
    "holder:": 30000,      // Holder data: 30s (changes slower)
    "botRadar:": 10000,    // Bot analysis: 10s
    "priceImpact:": 3000,  // Price impact: 3s
  },
  maxEntries: 1000,
  enableLogging: false,
};

// ============================================
// CACHE IMPLEMENTATION
// ============================================

export class OnChainCache {
  private readonly cache: Map<string, CacheEntry<unknown>> = new Map();
  private readonly config: CacheConfig;
  private hits = 0;
  private misses = 0;

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    
    // Start cleanup interval
    setInterval(() => this.cleanup(), 10000); // Clean every 10s
  }

  /**
   * Get value from cache
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    
    if (!entry) {
      this.misses++;
      if (this.config.enableLogging) {
        cacheLogger.debug({ key }, "Cache miss");
      }
      return null;
    }

    // Check expiry
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      if (this.config.enableLogging) {
        cacheLogger.debug({ key }, "Cache expired");
      }
      return null;
    }

    this.hits++;
    if (this.config.enableLogging) {
      cacheLogger.debug({ key, source: entry.source }, "Cache hit");
    }
    
    return entry.data;
  }

  /**
   * Set value in cache
   */
  set<T>(
    key: string, 
    data: T, 
    options?: { 
      ttlMs?: number; 
      source?: "rpc" | "api" | "simulation";
    }
  ): void {
    // Enforce max entries
    if (this.cache.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    const ttlMs = options?.ttlMs || this.getTtlForKey(key);
    const now = Date.now();

    const entry: CacheEntry<T> = {
      data,
      cachedAt: now,
      expiresAt: now + ttlMs,
      source: options?.source || "rpc",
    };

    this.cache.set(key, entry);
    
    if (this.config.enableLogging) {
      cacheLogger.debug({ key, ttlMs, source: entry.source }, "Cache set");
    }
  }

  /**
   * Invalidate specific key
   */
  invalidate(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted && this.config.enableLogging) {
      cacheLogger.debug({ key }, "Cache invalidated");
    }
    return deleted;
  }

  /**
   * Invalidate all keys matching prefix
   */
  invalidatePrefix(prefix: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    
    if (count > 0 && this.config.enableLogging) {
      cacheLogger.debug({ prefix, count }, "Cache invalidated by prefix");
    }
    
    return count;
  }

  /**
   * Invalidate all entries for a token
   */
  invalidateToken(tokenAddress: string): number {
    const normalizedAddress = tokenAddress.toLowerCase();
    let count = 0;
    
    for (const key of this.cache.keys()) {
      if (key.includes(normalizedAddress)) {
        this.cache.delete(key);
        count++;
      }
    }
    
    return count;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    cacheLogger.info("Cache cleared");
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Get or fetch with cache
   */
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: { ttlMs?: number; source?: "rpc" | "api" | "simulation" }
  ): Promise<T> {
    // Check cache first
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Fetch and cache
    const data = await fetcher();
    this.set(key, data, options);
    return data;
  }

  private getTtlForKey(key: string): number {
    for (const [prefix, ttl] of Object.entries(this.config.ttlOverrides)) {
      if (key.startsWith(prefix)) {
        return ttl;
      }
    }
    return this.config.defaultTtlMs;
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0 && this.config.enableLogging) {
      cacheLogger.debug({ cleaned }, "Cache cleanup");
    }
  }

  private evictOldest(): void {
    // Find oldest entry
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.cachedAt < oldestTime) {
        oldestTime = entry.cachedAt;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      if (this.config.enableLogging) {
        cacheLogger.debug({ key: oldestKey }, "Cache evicted oldest");
      }
    }
  }
}

/**
 * Create cache key for different data types
 */
export const CacheKeys = {
  networkState: (chainId: number) => `network:${chainId}`,
  poolLiquidity: (tokenAddress: string) => `pool:${tokenAddress.toLowerCase()}`,
  priceImpact: (tokenAddress: string, amount: number, direction: string) => 
    `priceImpact:${tokenAddress.toLowerCase()}:${amount}:${direction}`,
  botRadar: (tokenAddress: string, windowSeconds: number) => 
    `botRadar:${tokenAddress.toLowerCase()}:${windowSeconds}`,
  holderAnalysis: (tokenAddress: string) => `holder:${tokenAddress.toLowerCase()}`,
  gasPrice: (chainId: number) => `gas:${chainId}`,
};
