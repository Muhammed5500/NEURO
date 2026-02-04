/**
 * Metadata JSON Builder
 * 
 * Builds token metadata JSON with:
 * - ERC-721/ERC-1155 compatibility
 * - Content-addressable integrity (SHA-256)
 * - NEURO-specific extensions
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as crypto from "crypto";
import type {
  TokenMetadata,
  MilestoneEvent,
} from "./types.js";
import { tokenMetadataSchema, MetadataValidationError } from "./types.js";

const builderLogger = logger.child({ component: "metadata-builder" });

// ============================================
// METADATA BUILDER CONFIGURATION
// ============================================

export interface MetadataBuilderConfig {
  // Base URLs
  imageBaseUrl: string;
  externalBaseUrl: string;
  
  // Default values
  defaultImage: string;
  chainId: number;
}

const DEFAULT_CONFIG: MetadataBuilderConfig = {
  imageBaseUrl: "https://assets.neuro.ai/tokens",
  externalBaseUrl: "https://neuro.ai/token",
  defaultImage: "https://assets.neuro.ai/tokens/default.png",
  chainId: 143, // Monad
};

// ============================================
// METADATA BUILDER
// ============================================

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  description: string;
  
  // Optional media
  imageUrl?: string;
  animationUrl?: string;
  
  // Status
  status: "pending" | "active" | "graduated" | "failed";
  
  // On-chain metrics
  poolFillPercent?: number;
  holderCount?: number;
  totalVolume?: string;
  
  // Creator
  creatorAddress?: string;
  
  // Dates
  createdAt: Date;
  graduatedAt?: Date;
  
  // NEURO analysis
  analysisConfidence?: number;
  tags?: string[];
}

export class MetadataBuilder {
  private readonly config: MetadataBuilderConfig;

  constructor(config?: Partial<MetadataBuilderConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    builderLogger.info("MetadataBuilder initialized");
  }

  /**
   * Build complete metadata JSON
   */
  build(
    tokenInfo: TokenInfo,
    version = 1,
    previousCid?: string
  ): TokenMetadata {
    // Build attributes
    const attributes = this.buildAttributes(tokenInfo);

    // Build external URL
    const externalUrl = this.buildExternalUrl(tokenInfo);

    // Build base metadata
    const metadata: TokenMetadata = {
      name: tokenInfo.name,
      symbol: tokenInfo.symbol,
      description: tokenInfo.description,
      
      image: tokenInfo.imageUrl || this.buildImageUrl(tokenInfo),
      animation_url: tokenInfo.animationUrl,
      external_url: externalUrl,
      
      attributes,
      
      neuro: {
        tokenAddress: tokenInfo.address,
        chainId: this.config.chainId,
        createdAt: tokenInfo.createdAt.toISOString(),
        
        creatorAddress: tokenInfo.creatorAddress,
        
        status: tokenInfo.status,
        graduatedAt: tokenInfo.graduatedAt?.toISOString(),
        
        poolFillPercent: tokenInfo.poolFillPercent,
        holderCount: tokenInfo.holderCount,
        totalVolume: tokenInfo.totalVolume,
        
        analysisConfidence: tokenInfo.analysisConfidence,
        tags: tokenInfo.tags,
      },
      
      version,
      previousCid,
    };

    // Add integrity hash
    // Turkish: "SHA-256 hash'ini al ve metadata'nın içine bir integrity alanı olarak ekle"
    metadata.integrity = this.computeIntegrity(metadata);

    // Validate
    this.validate(metadata);

    builderLogger.debug({
      tokenAddress: tokenInfo.address,
      version,
      hasIntegrity: !!metadata.integrity,
    }, "Metadata built");

    return metadata;
  }

  /**
   * Update metadata with milestone changes
   */
  applyMilestoneUpdate(
    currentMetadata: TokenMetadata,
    event: MilestoneEvent,
    updates: Partial<{
      description: string;
      image: string;
      animation_url: string;
      external_url: string;
      attributes: TokenMetadata["attributes"];
      status: "pending" | "active" | "graduated" | "failed";
    }>
  ): TokenMetadata {
    const updated: TokenMetadata = {
      ...currentMetadata,
      ...updates,
      version: currentMetadata.version + 1,
      previousCid: undefined, // Will be set after pinning current version
    };

    // Update NEURO extension with milestone info
    if (updated.neuro) {
      if (event.type === "pool_fill_threshold" && event.currentValue !== undefined) {
        updated.neuro.poolFillPercent = event.currentValue;
      }
      if (event.type === "holder_count_threshold" && event.currentValue !== undefined) {
        updated.neuro.holderCount = event.currentValue;
      }
      if (event.type === "token_graduated") {
        updated.neuro.status = "graduated";
        updated.neuro.graduatedAt = new Date().toISOString();
      }
      if (updates.status) {
        updated.neuro.status = updates.status;
      }
    }

    // Merge attributes if provided
    if (updates.attributes && currentMetadata.attributes) {
      updated.attributes = this.mergeAttributes(
        currentMetadata.attributes,
        updates.attributes
      );
    }

    // Recompute integrity
    updated.integrity = this.computeIntegrity(updated);

    return updated;
  }

  /**
   * Compute SHA-256 integrity hash
   * Turkish: "IPFS'e yüklenen her JSON dosyasının içeriğinin doğruluğunu teyit etmek için"
   */
  computeIntegrity(metadata: Omit<TokenMetadata, "integrity">): TokenMetadata["integrity"] {
    // Create a copy without integrity for hashing
    const forHashing = { ...metadata };
    delete (forHashing as any).integrity;

    // Compute hash
    const jsonString = JSON.stringify(forHashing, null, 2);
    const hash = crypto.createHash("sha256").update(jsonString).digest("hex");

    return {
      algorithm: "sha256",
      hash,
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Verify integrity hash
   */
  verifyIntegrity(metadata: TokenMetadata): boolean {
    if (!metadata.integrity) {
      return false;
    }

    const computed = this.computeIntegrity(metadata);
    return computed.hash === metadata.integrity.hash;
  }

  /**
   * Validate metadata against schema
   */
  validate(metadata: TokenMetadata): void {
    const result = tokenMetadataSchema.safeParse(metadata);
    
    if (!result.success) {
      throw new MetadataValidationError(
        `Invalid metadata: ${result.error.message}`,
        result.error.issues
      );
    }
  }

  /**
   * Serialize metadata to JSON string
   */
  serialize(metadata: TokenMetadata): string {
    return JSON.stringify(metadata, null, 2);
  }

  /**
   * Parse metadata from JSON string
   */
  parse(json: string): TokenMetadata {
    const parsed = JSON.parse(json);
    this.validate(parsed);
    return parsed;
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private buildAttributes(tokenInfo: TokenInfo): TokenMetadata["attributes"] {
    const attributes: NonNullable<TokenMetadata["attributes"]> = [];

    // Status
    attributes.push({
      trait_type: "Status",
      value: tokenInfo.status.charAt(0).toUpperCase() + tokenInfo.status.slice(1),
    });

    // Chain
    attributes.push({
      trait_type: "Chain",
      value: "Monad",
    });

    // Pool fill (if available)
    if (tokenInfo.poolFillPercent !== undefined) {
      attributes.push({
        trait_type: "Pool Fill",
        value: tokenInfo.poolFillPercent,
        display_type: "boost_percentage",
      });
    }

    // Holders (if available)
    if (tokenInfo.holderCount !== undefined) {
      attributes.push({
        trait_type: "Holders",
        value: tokenInfo.holderCount,
        display_type: "number",
      });
    }

    // Created date
    attributes.push({
      trait_type: "Created",
      value: Math.floor(tokenInfo.createdAt.getTime() / 1000),
      display_type: "date",
    });

    // Graduated date (if applicable)
    if (tokenInfo.graduatedAt) {
      attributes.push({
        trait_type: "Graduated",
        value: Math.floor(tokenInfo.graduatedAt.getTime() / 1000),
        display_type: "date",
      });
    }

    // Tags
    if (tokenInfo.tags) {
      tokenInfo.tags.forEach(tag => {
        attributes.push({
          trait_type: "Tag",
          value: tag,
        });
      });
    }

    // Analysis confidence
    if (tokenInfo.analysisConfidence !== undefined) {
      attributes.push({
        trait_type: "NEURO Confidence",
        value: Math.round(tokenInfo.analysisConfidence * 100),
        display_type: "boost_percentage",
      });
    }

    return attributes;
  }

  private buildImageUrl(tokenInfo: TokenInfo): string {
    // Use address-based image URL or default
    return tokenInfo.imageUrl || 
           `${this.config.imageBaseUrl}/${tokenInfo.address.toLowerCase()}.png` ||
           this.config.defaultImage;
  }

  private buildExternalUrl(tokenInfo: TokenInfo): string {
    // Turkish: "Tokenın mezun olması -> external_url eklenmesi"
    if (tokenInfo.status === "graduated") {
      return `${this.config.externalBaseUrl}/${tokenInfo.address}`;
    }
    return `${this.config.externalBaseUrl}/${tokenInfo.address}`;
  }

  private mergeAttributes(
    existing: NonNullable<TokenMetadata["attributes"]>,
    updates: NonNullable<TokenMetadata["attributes"]>
  ): NonNullable<TokenMetadata["attributes"]> {
    const result = [...existing];
    
    for (const update of updates) {
      const existingIndex = result.findIndex(
        a => a.trait_type === update.trait_type
      );
      
      if (existingIndex >= 0) {
        result[existingIndex] = update;
      } else {
        result.push(update);
      }
    }
    
    return result;
  }
}

/**
 * Factory function
 */
export function createMetadataBuilder(
  config?: Partial<MetadataBuilderConfig>
): MetadataBuilder {
  return new MetadataBuilder(config);
}
