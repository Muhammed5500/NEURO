/**
 * CrossCheckReport Types
 * 
 * Report attached to decisions after verification.
 * Contains all verification results for audit and decision-making.
 */

import { z } from "zod";

// ============================================
// RISK LEVELS
// ============================================

export const crossCheckRiskLevel = z.enum([
  "LOW",
  "MEDIUM", 
  "HIGH",
  "CRITICAL",
]);

export type CrossCheckRiskLevel = z.infer<typeof crossCheckRiskLevel>;

// ============================================
// RECYCLED NEWS CHECK
// ============================================

export const recycledNewsCheckSchema = z.object({
  // Is this news recycled/old?
  isRecycled: z.boolean(),
  
  // Original publication date (if found)
  originalPublicationDate: z.string().datetime().optional(),
  
  // How old is the original news (hours)
  ageHours: z.number().optional(),
  
  // Is it being presented as new when it's old?
  // Turkish: "haber 6 saat eskiyse ama yeniymiş gibi trend oluyorsa"
  isFakeFresh: z.boolean(),
  
  // Time difference between original and social spread
  temporalGapHours: z.number().optional(),
  
  // Canonical URLs found for this story
  canonicalUrls: z.array(z.string()),
  
  // Duplicate content hashes found
  duplicateHashes: z.array(z.string()),
  
  // Risk level for recycled news
  riskLevel: crossCheckRiskLevel,
  
  // Explanation
  explanation: z.string(),
});

export type RecycledNewsCheck = z.infer<typeof recycledNewsCheckSchema>;

// ============================================
// MULTI-SOURCE CONFIRMATION
// ============================================

export const sourceConfirmationSchema = z.object({
  // Source URL
  url: z.string().url(),
  
  // Source domain
  domain: z.string(),
  
  // Source name/outlet
  sourceName: z.string(),
  
  // Is this an independent source?
  isIndependent: z.boolean(),
  
  // Publication timestamp
  publishedAt: z.string().datetime().optional(),
  
  // Similarity score with original claim (0-1)
  similarityScore: z.number().min(0).max(1),
  
  // Source credibility score (0-1)
  credibilityScore: z.number().min(0).max(1),
  
  // Domain ownership group (for diversity)
  ownershipGroup: z.string().optional(),
});

export type SourceConfirmation = z.infer<typeof sourceConfirmationSchema>;

export const multiSourceCheckSchema = z.object({
  // Total sources found
  totalSourcesFound: z.number().int().min(0),
  
  // Independent sources confirmed
  independentSourcesConfirmed: z.number().int().min(0),
  
  // Minimum required for high importance
  minimumRequired: z.number().int().min(1),
  
  // Is the requirement met?
  requirementMet: z.boolean(),
  
  // Individual source confirmations
  sources: z.array(sourceConfirmationSchema),
  
  // Risk level
  riskLevel: crossCheckRiskLevel,
  
  // Explanation
  explanation: z.string(),
});

export type MultiSourceCheck = z.infer<typeof multiSourceCheckSchema>;

// ============================================
// DOMAIN DIVERSITY SCORE
// ============================================

export const domainDiversityCheckSchema = z.object({
  // Unique domains
  uniqueDomains: z.number().int().min(0),
  
  // Unique ownership groups (different news networks)
  // Turkish: "farklı sahiplik yapılarında (farklı haber ağları)"
  uniqueOwnershipGroups: z.number().int().min(0),
  
  // Unique IP blocks (ASN diversity)
  // Turkish: "farklı IP bloklarında"
  uniqueIpBlocks: z.number().int().min(0),
  
  // Diversity score (0-1)
  // Higher = more diverse sources
  diversityScore: z.number().min(0).max(1),
  
  // Domain details
  domains: z.array(z.object({
    domain: z.string(),
    ownershipGroup: z.string(),
    ipBlock: z.string().optional(),
    country: z.string().optional(),
  })),
  
  // Risk level
  riskLevel: crossCheckRiskLevel,
  
  // Explanation
  explanation: z.string(),
});

export type DomainDiversityCheck = z.infer<typeof domainDiversityCheckSchema>;

// ============================================
// PHRASE MATCHING (COPY-PASTA DETECTION)
// ============================================

export const copyPastaMatchSchema = z.object({
  // The repeated phrase
  phrase: z.string(),
  
  // How many accounts posted this exact phrase
  accountCount: z.number().int().min(1),
  
  // Time window these posts appeared (minutes)
  timeWindowMinutes: z.number().min(0),
  
  // Are these likely bots?
  likelyBots: z.boolean(),
  
  // Account details
  accounts: z.array(z.object({
    accountId: z.string(),
    platform: z.string(),
    postedAt: z.string().datetime(),
    followerCount: z.number().int().optional(),
    accountAge: z.string().optional(),
    isNewAccount: z.boolean().optional(),
  })),
});

export type CopyPastaMatch = z.infer<typeof copyPastaMatchSchema>;

export const phraseMatchingCheckSchema = z.object({
  // Total suspicious phrases detected
  suspiciousPhraseCount: z.number().int().min(0),
  
  // Total bot-like accounts identified
  botAccountCount: z.number().int().min(0),
  
  // Is there coordinated amplification?
  // Turkish: "Aynı cümlenin 10 farklı bot hesabında aynı anda paylaşılıp paylaşılmadığını kontrol et"
  coordinatedAmplification: z.boolean(),
  
  // Phrase matches found
  matches: z.array(copyPastaMatchSchema),
  
  // Risk level
  riskLevel: crossCheckRiskLevel,
  
  // Explanation
  explanation: z.string(),
});

export type PhraseMatchingCheck = z.infer<typeof phraseMatchingCheckSchema>;

// ============================================
// TEMPORAL CONSISTENCY CHECK
// ============================================

export const temporalConsistencyCheckSchema = z.object({
  // Original news publication time
  originalPublicationTime: z.string().datetime().optional(),
  
  // First social media mention
  firstSocialMention: z.string().datetime().optional(),
  
  // Time when trending started
  trendingStartTime: z.string().datetime().optional(),
  
  // Hours between original publication and trending
  // Turkish: "Haberin orijinal yayınlanma tarihi ile sosyal medyadaki yayılma hızı"
  publicationToTrendingHours: z.number().optional(),
  
  // Is the news old but being pushed as new?
  // Turkish: "haber 6 saat eskiyse ama yeniymiş gibi trend oluyorsa HIGH_RISK"
  staleNewsBeingPushed: z.boolean(),
  
  // Threshold for "stale" news (hours)
  staleThresholdHours: z.number(),
  
  // Risk level
  riskLevel: crossCheckRiskLevel,
  
  // Explanation
  explanation: z.string(),
});

export type TemporalConsistencyCheck = z.infer<typeof temporalConsistencyCheckSchema>;

// ============================================
// FULL CROSS-CHECK REPORT
// ============================================

export const crossCheckReportSchema = z.object({
  // Report ID
  id: z.string().uuid(),
  
  // What was being checked
  subject: z.object({
    type: z.enum(["news", "social", "claim"]),
    title: z.string(),
    content: z.string(),
    source: z.string(),
    originalTimestamp: z.string().datetime().optional(),
  }),
  
  // Individual checks
  recycledNewsCheck: recycledNewsCheckSchema.optional(),
  multiSourceCheck: multiSourceCheckSchema.optional(),
  domainDiversityCheck: domainDiversityCheckSchema.optional(),
  phraseMatchingCheck: phraseMatchingCheckSchema.optional(),
  temporalConsistencyCheck: temporalConsistencyCheckSchema.optional(),
  
  // Overall assessment
  overallRiskLevel: crossCheckRiskLevel,
  overallScore: z.number().min(0).max(1), // 0 = very suspicious, 1 = fully verified
  
  // Should this block the decision?
  shouldBlock: z.boolean(),
  
  // Should this downgrade the importance?
  shouldDowngrade: z.boolean(),
  downgradedTo: z.enum(["low", "medium", "high"]).optional(),
  
  // Summary for decision rationale
  summary: z.string(),
  
  // Detailed findings
  findings: z.array(z.string()),
  
  // Recommendations
  recommendations: z.array(z.string()),
  
  // Metadata
  checkedAt: z.string().datetime(),
  checkDurationMs: z.number().int().min(0),
});

export type CrossCheckReport = z.infer<typeof crossCheckReportSchema>;

// ============================================
// FACTORY FUNCTION
// ============================================

export function createCrossCheckReport(
  data: Omit<CrossCheckReport, "id" | "checkedAt">
): CrossCheckReport {
  return crossCheckReportSchema.parse({
    ...data,
    id: crypto.randomUUID(),
    checkedAt: new Date().toISOString(),
  });
}
