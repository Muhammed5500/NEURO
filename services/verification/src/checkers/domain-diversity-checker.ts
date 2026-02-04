/**
 * Domain Diversity Checker
 * 
 * Verifies that sources are truly diverse - not just different domains,
 * but different ownership groups and IP blocks.
 * 
 * Turkish: "Teyit alınan kaynakların sadece farklı olması yetmez, farklı IP bloklarında
 * veya farklı sahiplik yapılarında (farklı haber ağları) olduklarını doğrulamaya
 * çalışan bir 'çeşitlilik skoru' ekle."
 */

import { logger } from "@neuro/shared";
import type { 
  DomainDiversityCheck,
  CrossCheckRiskLevel,
} from "../types/cross-check-report.js";
import { 
  getOwnershipGroup,
  KNOWN_OWNERSHIP_GROUPS,
} from "../providers/web-search-provider.js";

const checkerLogger = logger.child({ checker: "domain-diversity" });

// ============================================
// CONFIGURATION
// ============================================

export interface DomainDiversityCheckerConfig {
  // Minimum ownership groups for good diversity
  minOwnershipGroups: number;
  
  // Weight for unique domains in diversity score
  domainWeight: number;
  
  // Weight for unique ownership groups
  ownershipWeight: number;
  
  // Weight for unique IP blocks
  ipBlockWeight: number;
}

const DEFAULT_CONFIG: DomainDiversityCheckerConfig = {
  minOwnershipGroups: 3,
  domainWeight: 0.3,
  ownershipWeight: 0.5,
  ipBlockWeight: 0.2,
};

// ============================================
// DOMAIN INFO
// ============================================

interface DomainEntry {
  domain: string;
  ownershipGroup: string;
  ipBlock?: string;
  country?: string;
}

// Mock IP block database (in production, would use real DNS/WHOIS)
const MOCK_IP_BLOCKS: Record<string, { ipBlock: string; country: string }> = {
  "coindesk.com": { ipBlock: "AS13335", country: "US" },
  "theblock.co": { ipBlock: "AS16509", country: "US" },
  "decrypt.co": { ipBlock: "AS13335", country: "US" },
  "cointelegraph.com": { ipBlock: "AS16509", country: "US" },
  "reuters.com": { ipBlock: "AS3561", country: "US" },
  "bloomberg.com": { ipBlock: "AS8075", country: "US" },
  "wsj.com": { ipBlock: "AS14618", country: "US" },
  "bbc.com": { ipBlock: "AS2818", country: "GB" },
  "twitter.com": { ipBlock: "AS13414", country: "US" },
  "x.com": { ipBlock: "AS13414", country: "US" },
};

// ============================================
// CHECKER IMPLEMENTATION
// ============================================

export class DomainDiversityChecker {
  private readonly config: DomainDiversityCheckerConfig;

  constructor(config?: Partial<DomainDiversityCheckerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check domain diversity
   */
  async check(domains: string[]): Promise<DomainDiversityCheck> {
    checkerLogger.info({ domainCount: domains.length }, "Checking domain diversity");

    // Normalize domains
    const normalizedDomains = domains.map(d => 
      d.toLowerCase().replace(/^www\./, "")
    );

    // Get unique domains
    const uniqueDomains = [...new Set(normalizedDomains)];

    // Gather domain info
    const domainEntries: DomainEntry[] = await Promise.all(
      uniqueDomains.map(d => this.getDomainInfo(d))
    );

    // Count unique ownership groups
    const ownershipGroups = new Set(domainEntries.map(d => d.ownershipGroup));
    const uniqueOwnershipGroups = ownershipGroups.size;

    // Count unique IP blocks
    const ipBlocks = new Set(domainEntries.map(d => d.ipBlock).filter(Boolean));
    const uniqueIpBlocks = ipBlocks.size;

    // Calculate diversity score
    const diversityScore = this.calculateDiversityScore(
      uniqueDomains.length,
      uniqueOwnershipGroups,
      uniqueIpBlocks
    );

    // Calculate risk level
    const riskLevel = this.calculateRiskLevel(uniqueOwnershipGroups, diversityScore);

    // Generate explanation
    const explanation = this.generateExplanation({
      uniqueDomains: uniqueDomains.length,
      uniqueOwnershipGroups,
      uniqueIpBlocks,
      diversityScore,
    });

    checkerLogger.info({
      uniqueDomains: uniqueDomains.length,
      uniqueOwnershipGroups,
      uniqueIpBlocks,
      diversityScore,
      riskLevel,
    }, "Domain diversity check complete");

    return {
      uniqueDomains: uniqueDomains.length,
      uniqueOwnershipGroups,
      uniqueIpBlocks,
      diversityScore,
      domains: domainEntries,
      riskLevel,
      explanation,
    };
  }

  /**
   * Quick diversity check
   */
  quickCheck(domains: string[]): {
    hasDiversity: boolean;
    ownershipGroupCount: number;
  } {
    const ownershipGroups = new Set(
      domains.map(d => getOwnershipGroup(d))
    );
    
    return {
      hasDiversity: ownershipGroups.size >= this.config.minOwnershipGroups,
      ownershipGroupCount: ownershipGroups.size,
    };
  }

  private async getDomainInfo(domain: string): Promise<DomainEntry> {
    const ownershipGroup = getOwnershipGroup(domain);
    
    // Look up IP block (mock data for now)
    const ipInfo = MOCK_IP_BLOCKS[domain] || await this.lookupIpBlock(domain);

    return {
      domain,
      ownershipGroup,
      ipBlock: ipInfo?.ipBlock,
      country: ipInfo?.country,
    };
  }

  private async lookupIpBlock(domain: string): Promise<{ ipBlock: string; country: string } | undefined> {
    // In production, this would do DNS lookup and WHOIS
    // For now, return undefined for unknown domains
    // This allows the checker to still work with partial data
    return undefined;
  }

  private calculateDiversityScore(
    uniqueDomains: number,
    uniqueOwnershipGroups: number,
    uniqueIpBlocks: number
  ): number {
    // Normalize each factor to 0-1 scale
    // Using diminishing returns: each additional unique adds less
    const domainScore = Math.min(1, uniqueDomains / 5);
    const ownershipScore = Math.min(1, uniqueOwnershipGroups / this.config.minOwnershipGroups);
    const ipBlockScore = Math.min(1, uniqueIpBlocks / 3);

    // Weighted average
    const score = (
      domainScore * this.config.domainWeight +
      ownershipScore * this.config.ownershipWeight +
      ipBlockScore * this.config.ipBlockWeight
    );

    return Math.round(score * 100) / 100;
  }

  private calculateRiskLevel(
    ownershipGroups: number,
    diversityScore: number
  ): CrossCheckRiskLevel {
    // All from same ownership = HIGH risk
    if (ownershipGroups <= 1) {
      return "HIGH";
    }

    // Low diversity score = MEDIUM risk
    if (diversityScore < 0.5) {
      return "MEDIUM";
    }

    // Below minimum ownership groups = MEDIUM risk
    if (ownershipGroups < this.config.minOwnershipGroups) {
      return "MEDIUM";
    }

    return "LOW";
  }

  private generateExplanation(params: {
    uniqueDomains: number;
    uniqueOwnershipGroups: number;
    uniqueIpBlocks: number;
    diversityScore: number;
  }): string {
    const parts: string[] = [];

    parts.push(`${params.uniqueDomains} unique domain(s).`);
    parts.push(`${params.uniqueOwnershipGroups} unique ownership group(s).`);
    
    if (params.uniqueIpBlocks > 0) {
      parts.push(`${params.uniqueIpBlocks} unique IP block(s).`);
    }

    parts.push(`Diversity score: ${(params.diversityScore * 100).toFixed(0)}%.`);

    if (params.uniqueOwnershipGroups <= 1) {
      parts.push("WARNING: All sources from same ownership group!");
    } else if (params.uniqueOwnershipGroups < this.config.minOwnershipGroups) {
      parts.push(`Consider requiring ${this.config.minOwnershipGroups} ownership groups for important claims.`);
    }

    return parts.join(" ");
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createDomainDiversityChecker(
  config?: Partial<DomainDiversityCheckerConfig>
): DomainDiversityChecker {
  return new DomainDiversityChecker(config);
}
