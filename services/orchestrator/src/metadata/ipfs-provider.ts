/**
 * IPFS Pin Provider Interface and Implementations
 * 
 * Provides:
 * - Mock provider for development
 * - Pinata provider for production
 * - Infura provider for production
 * - Multi-provider for redundancy
 * 
 * Turkish: "birden fazla pinning servisini (örn: Pinata + Infura) destekleyen bir MultiPinProvider"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as crypto from "crypto";
import type {
  PinResult,
  MultiPinResult,
  IpfsProviderCapabilities,
} from "./types.js";
import { IpfsPinError } from "./types.js";

const ipfsLogger = logger.child({ component: "ipfs-provider" });

// ============================================
// IPFS PROVIDER INTERFACE
// ============================================

export interface IpfsPinProvider {
  readonly name: string;
  readonly capabilities: IpfsProviderCapabilities;
  
  /**
   * Pin JSON content to IPFS
   */
  pinJson(content: object, name?: string): Promise<PinResult>;
  
  /**
   * Unpin content by CID
   */
  unpin(cid: string): Promise<boolean>;
  
  /**
   * Check if CID is pinned
   */
  isPinned(cid: string): Promise<boolean>;
  
  /**
   * Get gateway URL for CID
   */
  getGatewayUrl(cid: string): string;
  
  /**
   * Health check
   */
  healthCheck(): Promise<boolean>;
}

// ============================================
// MOCK PROVIDER (Development)
// ============================================

export class MockIpfsProvider implements IpfsPinProvider {
  readonly name = "mock";
  readonly capabilities: IpfsProviderCapabilities = {
    supportsPin: true,
    supportsUnpin: true,
    supportsListPins: true,
    supportsGateway: true,
    maxFileSize: 100 * 1024 * 1024, // 100MB
    rateLimitPerMinute: 1000,
  };

  private readonly pins: Map<string, { content: string; name?: string; pinnedAt: number }> = new Map();
  private readonly simulatedDelay: number;
  private readonly failureRate: number;

  constructor(options?: { simulatedDelayMs?: number; failureRate?: number }) {
    this.simulatedDelay = options?.simulatedDelayMs ?? 100;
    this.failureRate = options?.failureRate ?? 0;

    ipfsLogger.info({
      provider: this.name,
      simulatedDelay: this.simulatedDelay,
    }, "MockIpfsProvider initialized");
  }

  async pinJson(content: object, name?: string): Promise<PinResult> {
    const startTime = Date.now();

    // Simulate delay
    await new Promise(r => setTimeout(r, this.simulatedDelay));

    // Simulate random failures
    if (Math.random() < this.failureRate) {
      return {
        success: false,
        provider: this.name,
        error: "Simulated failure",
        timestamp: Date.now(),
        responseTimeMs: Date.now() - startTime,
      };
    }

    // Generate CID from content hash
    const jsonString = JSON.stringify(content);
    const hash = crypto.createHash("sha256").update(jsonString).digest("hex");
    const cid = `Qm${hash.slice(0, 44)}`; // Mock CID format

    // Store pin
    this.pins.set(cid, {
      content: jsonString,
      name,
      pinnedAt: Date.now(),
    });

    ipfsLogger.debug({
      cid,
      name,
      size: jsonString.length,
    }, "Content pinned (mock)");

    return {
      success: true,
      provider: this.name,
      cid,
      timestamp: Date.now(),
      responseTimeMs: Date.now() - startTime,
    };
  }

  async unpin(cid: string): Promise<boolean> {
    await new Promise(r => setTimeout(r, this.simulatedDelay));
    const deleted = this.pins.delete(cid);
    ipfsLogger.debug({ cid, deleted }, "Content unpinned (mock)");
    return deleted;
  }

  async isPinned(cid: string): Promise<boolean> {
    return this.pins.has(cid);
  }

  getGatewayUrl(cid: string): string {
    return `https://mock.ipfs.io/ipfs/${cid}`;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  // Test helper: get pinned content
  getPinnedContent(cid: string): object | null {
    const pin = this.pins.get(cid);
    return pin ? JSON.parse(pin.content) : null;
  }
}

// ============================================
// PINATA PROVIDER (Production)
// ============================================

export interface PinataConfig {
  apiKey: string;
  secretKey: string;
  gateway?: string;
}

export class PinataProvider implements IpfsPinProvider {
  readonly name = "pinata";
  readonly capabilities: IpfsProviderCapabilities = {
    supportsPin: true,
    supportsUnpin: true,
    supportsListPins: true,
    supportsGateway: true,
    maxFileSize: 100 * 1024 * 1024, // 100MB
    rateLimitPerMinute: 180,
  };

  private readonly config: PinataConfig;
  private readonly baseUrl = "https://api.pinata.cloud";

  constructor(config: PinataConfig) {
    this.config = config;

    ipfsLogger.info({
      provider: this.name,
      hasApiKey: !!config.apiKey,
    }, "PinataProvider initialized");
  }

  async pinJson(content: object, name?: string): Promise<PinResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}/pinning/pinJSONToIPFS`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "pinata_api_key": this.config.apiKey,
          "pinata_secret_api_key": this.config.secretKey,
        },
        body: JSON.stringify({
          pinataContent: content,
          pinataMetadata: {
            name: name || `metadata-${Date.now()}`,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Pinata API error: ${response.status} - ${error}`);
      }

      const result = await response.json();

      ipfsLogger.debug({
        cid: result.IpfsHash,
        name,
      }, "Content pinned to Pinata");

      return {
        success: true,
        provider: this.name,
        cid: result.IpfsHash,
        timestamp: Date.now(),
        responseTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      ipfsLogger.warn({ error: message }, "Pinata pin failed");

      return {
        success: false,
        provider: this.name,
        error: message,
        timestamp: Date.now(),
        responseTimeMs: Date.now() - startTime,
      };
    }
  }

  async unpin(cid: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/pinning/unpin/${cid}`, {
        method: "DELETE",
        headers: {
          "pinata_api_key": this.config.apiKey,
          "pinata_secret_api_key": this.config.secretKey,
        },
      });

      return response.ok;
    } catch (error) {
      ipfsLogger.warn({ cid, error }, "Pinata unpin failed");
      return false;
    }
  }

  async isPinned(cid: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/data/pinList?status=pinned&hashContains=${cid}`,
        {
          headers: {
            "pinata_api_key": this.config.apiKey,
            "pinata_secret_api_key": this.config.secretKey,
          },
        }
      );

      if (!response.ok) return false;
      const result = await response.json();
      return result.count > 0;
    } catch {
      return false;
    }
  }

  getGatewayUrl(cid: string): string {
    return this.config.gateway 
      ? `${this.config.gateway}/ipfs/${cid}`
      : `https://gateway.pinata.cloud/ipfs/${cid}`;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/data/testAuthentication`, {
        headers: {
          "pinata_api_key": this.config.apiKey,
          "pinata_secret_api_key": this.config.secretKey,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ============================================
// INFURA PROVIDER (Production)
// ============================================

export interface InfuraConfig {
  projectId: string;
  projectSecret: string;
  gateway?: string;
}

export class InfuraProvider implements IpfsPinProvider {
  readonly name = "infura";
  readonly capabilities: IpfsProviderCapabilities = {
    supportsPin: true,
    supportsUnpin: true,
    supportsListPins: true,
    supportsGateway: true,
    maxFileSize: 100 * 1024 * 1024,
    rateLimitPerMinute: 100,
  };

  private readonly config: InfuraConfig;
  private readonly baseUrl = "https://ipfs.infura.io:5001/api/v0";

  constructor(config: InfuraConfig) {
    this.config = config;

    ipfsLogger.info({
      provider: this.name,
      hasProjectId: !!config.projectId,
    }, "InfuraProvider initialized");
  }

  private getAuthHeader(): string {
    const auth = Buffer.from(
      `${this.config.projectId}:${this.config.projectSecret}`
    ).toString("base64");
    return `Basic ${auth}`;
  }

  async pinJson(content: object, name?: string): Promise<PinResult> {
    const startTime = Date.now();

    try {
      // Infura uses form data
      const formData = new FormData();
      const jsonBlob = new Blob([JSON.stringify(content)], {
        type: "application/json",
      });
      formData.append("file", jsonBlob, name || "metadata.json");

      const response = await fetch(`${this.baseUrl}/add?pin=true`, {
        method: "POST",
        headers: {
          Authorization: this.getAuthHeader(),
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Infura API error: ${response.status} - ${error}`);
      }

      const result = await response.json();

      ipfsLogger.debug({
        cid: result.Hash,
        name,
      }, "Content pinned to Infura");

      return {
        success: true,
        provider: this.name,
        cid: result.Hash,
        timestamp: Date.now(),
        responseTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      ipfsLogger.warn({ error: message }, "Infura pin failed");

      return {
        success: false,
        provider: this.name,
        error: message,
        timestamp: Date.now(),
        responseTimeMs: Date.now() - startTime,
      };
    }
  }

  async unpin(cid: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/pin/rm?arg=${cid}`, {
        method: "POST",
        headers: {
          Authorization: this.getAuthHeader(),
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async isPinned(cid: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/pin/ls?arg=${cid}`, {
        headers: {
          Authorization: this.getAuthHeader(),
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  getGatewayUrl(cid: string): string {
    return this.config.gateway
      ? `${this.config.gateway}/ipfs/${cid}`
      : `https://${this.config.projectId}.ipfs.infura-ipfs.io/ipfs/${cid}`;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/version`, {
        headers: {
          Authorization: this.getAuthHeader(),
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ============================================
// MULTI-PIN PROVIDER
// ============================================

/**
 * Multi-provider that pins to multiple services for redundancy
 * Turkish: "Dosyaların kaybolmaması için birden fazla pinning servisini destekleyen"
 */
export class MultiPinProvider implements IpfsPinProvider {
  readonly name = "multi";
  readonly capabilities: IpfsProviderCapabilities;
  
  private readonly providers: IpfsPinProvider[];
  private readonly requireAllSuccess: boolean;
  private readonly minSuccessCount: number;

  constructor(
    providers: IpfsPinProvider[],
    options?: { requireAllSuccess?: boolean; minSuccessCount?: number }
  ) {
    if (providers.length === 0) {
      throw new Error("MultiPinProvider requires at least one provider");
    }

    this.providers = providers;
    this.requireAllSuccess = options?.requireAllSuccess ?? false;
    this.minSuccessCount = options?.minSuccessCount ?? 1;

    // Aggregate capabilities (use most restrictive)
    this.capabilities = {
      supportsPin: true,
      supportsUnpin: true,
      supportsListPins: true,
      supportsGateway: true,
      maxFileSize: Math.min(...providers.map(p => p.capabilities.maxFileSize)),
      rateLimitPerMinute: Math.min(...providers.map(p => p.capabilities.rateLimitPerMinute)),
    };

    ipfsLogger.info({
      providerCount: providers.length,
      providers: providers.map(p => p.name),
      requireAllSuccess: this.requireAllSuccess,
      minSuccessCount: this.minSuccessCount,
    }, "MultiPinProvider initialized");
  }

  /**
   * Pin to all providers in parallel
   */
  async pinJson(content: object, name?: string): Promise<PinResult> {
    const results = await this.pinToAll(content, name);
    
    // Return result from first successful provider
    const firstSuccess = results.results.find(r => r.success);
    
    if (firstSuccess) {
      return firstSuccess;
    }

    // All failed
    return {
      success: false,
      provider: this.name,
      error: `All providers failed: ${results.results.map(r => `${r.provider}: ${r.error}`).join("; ")}`,
      timestamp: Date.now(),
      responseTimeMs: Math.max(...results.results.map(r => r.responseTimeMs)),
    };
  }

  /**
   * Pin to all providers and return aggregated result
   */
  async pinToAll(content: object, name?: string): Promise<MultiPinResult> {
    const startTime = Date.now();
    
    // Pin to all providers in parallel
    const results = await Promise.all(
      this.providers.map(provider => provider.pinJson(content, name))
    );

    const successCount = results.filter(r => r.success).length;
    const allSucceeded = successCount === this.providers.length;
    
    // Get CID from first successful result
    const firstSuccess = results.find(r => r.success);
    const cid = firstSuccess?.cid || "";

    // Verify all CIDs match (they should for same content)
    const cids = results.filter(r => r.success && r.cid).map(r => r.cid);
    const allMatch = cids.every(c => c === cids[0]);
    
    if (!allMatch && cids.length > 1) {
      ipfsLogger.warn({
        cids,
      }, "CID mismatch across providers");
    }

    // Check success criteria
    const meetsRequirement = this.requireAllSuccess
      ? allSucceeded
      : successCount >= this.minSuccessCount;

    if (!meetsRequirement) {
      ipfsLogger.warn({
        successCount,
        totalProviders: this.providers.length,
        required: this.requireAllSuccess ? "all" : this.minSuccessCount,
      }, "Multi-pin did not meet success requirements");
    }

    ipfsLogger.info({
      cid,
      successCount,
      totalProviders: this.providers.length,
      allSucceeded,
      durationMs: Date.now() - startTime,
    }, "Multi-pin completed");

    return {
      cid,
      results,
      successCount,
      totalProviders: this.providers.length,
      allSucceeded,
    };
  }

  /**
   * Unpin from all providers
   */
  async unpin(cid: string): Promise<boolean> {
    const results = await Promise.all(
      this.providers.map(provider => provider.unpin(cid))
    );
    return results.some(r => r);
  }

  /**
   * Check if pinned on any provider
   */
  async isPinned(cid: string): Promise<boolean> {
    const results = await Promise.all(
      this.providers.map(provider => provider.isPinned(cid))
    );
    return results.some(r => r);
  }

  /**
   * Get gateway URL from first available provider
   */
  getGatewayUrl(cid: string): string {
    return this.providers[0].getGatewayUrl(cid);
  }

  /**
   * Health check all providers
   */
  async healthCheck(): Promise<boolean> {
    const results = await Promise.all(
      this.providers.map(provider => provider.healthCheck())
    );
    // Healthy if at least minSuccessCount providers are healthy
    const healthyCount = results.filter(r => r).length;
    return healthyCount >= this.minSuccessCount;
  }

  /**
   * Get individual provider health
   */
  async getProviderHealth(): Promise<Array<{ name: string; healthy: boolean }>> {
    const results = await Promise.all(
      this.providers.map(async provider => ({
        name: provider.name,
        healthy: await provider.healthCheck(),
      }))
    );
    return results;
  }
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

export function createMockIpfsProvider(
  options?: { simulatedDelayMs?: number; failureRate?: number }
): MockIpfsProvider {
  return new MockIpfsProvider(options);
}

export function createPinataProvider(config: PinataConfig): PinataProvider {
  return new PinataProvider(config);
}

export function createInfuraProvider(config: InfuraConfig): InfuraProvider {
  return new InfuraProvider(config);
}

export function createMultiPinProvider(
  providers: IpfsPinProvider[],
  options?: { requireAllSuccess?: boolean; minSuccessCount?: number }
): MultiPinProvider {
  return new MultiPinProvider(providers, options);
}

/**
 * Create providers from environment configuration
 */
export function createProvidersFromEnv(): IpfsPinProvider[] {
  const providers: IpfsPinProvider[] = [];

  // Check for Pinata
  if (process.env.PINATA_API_KEY && process.env.PINATA_SECRET_KEY) {
    providers.push(createPinataProvider({
      apiKey: process.env.PINATA_API_KEY,
      secretKey: process.env.PINATA_SECRET_KEY,
      gateway: process.env.PINATA_GATEWAY,
    }));
  }

  // Check for Infura
  if (process.env.INFURA_IPFS_PROJECT_ID && process.env.INFURA_IPFS_PROJECT_SECRET) {
    providers.push(createInfuraProvider({
      projectId: process.env.INFURA_IPFS_PROJECT_ID,
      projectSecret: process.env.INFURA_IPFS_PROJECT_SECRET,
      gateway: process.env.INFURA_IPFS_GATEWAY,
    }));
  }

  // Fall back to mock if no providers configured
  if (providers.length === 0) {
    ipfsLogger.warn("No IPFS providers configured, using mock provider");
    providers.push(createMockIpfsProvider());
  }

  return providers;
}
