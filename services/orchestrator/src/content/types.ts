/**
 * Content Generation Types
 * 
 * Types for persona selection and content generation with policy compliance.
 */

import { z } from "zod";

// ============================================
// TOKEN CONTEXT
// ============================================

/**
 * Token tags for persona selection
 */
export type TokenTag = "tech" | "meme" | "defi" | "nft" | "gaming" | "ai" | "infra";

/**
 * Volatility levels
 */
export type VolatilityLevel = "low" | "medium" | "high" | "extreme";

/**
 * Target audience
 */
export type AudienceType = "retail" | "degen" | "institutional" | "developer" | "general";

/**
 * Input for persona selection
 */
export interface PersonaInput {
  tokenName: string;
  tokenSymbol: string;
  tags: TokenTag[];
  volatility: VolatilityLevel;
  audience: AudienceType;
  
  // Optional context
  tokenDescription?: string;
  marketCap?: string;
  launchDate?: string;
}

// ============================================
// PERSONA PROFILE
// ============================================

/**
 * Tone spectrum from cautious to confident
 * Turkish: "confidenceScore ile senkronize et"
 */
export type ToneLevel = "very_cautious" | "cautious" | "neutral" | "confident" | "very_confident";

/**
 * Writing style
 */
export type WritingStyle = "technical" | "casual" | "meme" | "professional" | "educational";

/**
 * Persona profile output
 */
export interface PersonaProfile {
  id: string;
  name: string;
  
  // Tone settings
  // Turkish: "güven skoru 0.85 ise temkinli, 0.95 ise emin"
  baseTone: ToneLevel;
  writingStyle: WritingStyle;
  
  // Vocabulary
  preferredTerms: string[];
  avoidedTerms: string[];
  
  // Emoji usage
  emojiFrequency: "none" | "minimal" | "moderate" | "heavy";
  preferredEmojis: string[];
  
  // Structure
  preferredHashtags: string[];
  maxHashtags: number;
  threadPreference: "single" | "thread" | "both";
  
  // Templates to use
  templateIds: string[];
  
  // Constraints
  maxPostLength: number;
  requiresDataCitation: boolean;
}

// ============================================
// CONFIDENCE-LINKED TONE
// ============================================

/**
 * Confidence score mapping to tone
 * Turkish: "Tweetin tonunu, ConsensusDecision içindeki confidenceScore ile senkronize et"
 */
export interface ConfidenceToneMapping {
  minConfidence: number;
  maxConfidence: number;
  tone: ToneLevel;
  languagePatterns: string[];
  hedgingPhrases: string[];
}

export const CONFIDENCE_TONE_MAPPINGS: ConfidenceToneMapping[] = [
  {
    minConfidence: 0,
    maxConfidence: 0.6,
    tone: "very_cautious",
    languagePatterns: [
      "Early signals suggest...",
      "Worth monitoring...",
      "Initial data shows potential...",
    ],
    hedgingPhrases: [
      "This is highly speculative",
      "More data needed",
      "Proceed with extreme caution",
    ],
  },
  {
    minConfidence: 0.6,
    maxConfidence: 0.75,
    tone: "cautious",
    languagePatterns: [
      "Emerging pattern indicates...",
      "Data suggests a possible...",
      "We're seeing early signs of...",
    ],
    // Turkish: "Kesin olmamakla birlikte bir trend seziyorum"
    hedgingPhrases: [
      "While not certain, sensing a trend",
      "Early but interesting",
      "Worth watching closely",
    ],
  },
  {
    minConfidence: 0.75,
    maxConfidence: 0.85,
    tone: "neutral",
    languagePatterns: [
      "Analysis indicates...",
      "The data points to...",
      "Current metrics suggest...",
    ],
    hedgingPhrases: [
      "Based on current data",
      "As always, DYOR",
      "Metrics are looking favorable",
    ],
  },
  {
    minConfidence: 0.85,
    maxConfidence: 0.95,
    tone: "confident",
    languagePatterns: [
      "Strong signals indicate...",
      "Data strongly suggests...",
      "Clear pattern emerging...",
    ],
    // Turkish: "Veriler çok güçlü bir sinyal veriyor"
    hedgingPhrases: [
      "Data shows a strong signal",
      "High confidence in this assessment",
      "Compelling on-chain evidence",
    ],
  },
  {
    minConfidence: 0.95,
    maxConfidence: 1.0,
    tone: "very_confident",
    languagePatterns: [
      "Exceptional metrics across the board...",
      "Overwhelming data confirms...",
      "All indicators align...",
    ],
    hedgingPhrases: [
      "Very high confidence assessment",
      "Robust data support",
      "Multiple confirmations",
    ],
  },
];

// ============================================
// CONTENT POLICY
// ============================================

/**
 * Content policy violations
 */
export type PolicyViolationType =
  | "misleading_claim"
  | "guaranteed_returns"
  | "impersonation"
  | "missing_disclosure"
  | "shill_language"
  | "price_prediction"
  | "fomo_inducing"
  | "unverified_claim";

/**
 * Policy check result
 */
export interface PolicyCheckResult {
  passed: boolean;
  violations: PolicyViolation[];
  warnings: PolicyWarning[];
  suggestedFixes: string[];
}

export interface PolicyViolation {
  type: PolicyViolationType;
  severity: "low" | "medium" | "high" | "critical";
  location: {
    start: number;
    end: number;
  };
  problematicText: string;
  reason: string;
  suggestedReplacement?: string;
}

export interface PolicyWarning {
  type: string;
  message: string;
  suggestion: string;
}

// ============================================
// DISCLOSURE
// ============================================

/**
 * Disclosure templates
 * Turkish: "[NEURO AI Autonomous Post - Not Financial Advice]"
 */
export interface DisclosureConfig {
  // Position
  position: "prefix" | "suffix" | "both";
  
  // Templates
  templates: {
    default: string;
    short: string;
    thread: string;
  };
  
  // Separator
  separator: string;
}

export const DEFAULT_DISCLOSURE: DisclosureConfig = {
  position: "suffix",
  templates: {
    default: "\n\n🤖 [NEURO AI Autonomous Post - Not Financial Advice]",
    short: "🤖 NEURO AI | NFA",
    thread: "🤖 NEURO AI Thread | Automated Analysis | Not Financial Advice",
  },
  separator: "\n\n---\n",
};

// ============================================
// ON-CHAIN FACTS
// ============================================

/**
 * On-chain data for injection
 * Turkish: "Monad ana ağından çekilen gerçek verileri entegre et"
 */
export interface OnChainFacts {
  // Network
  currentGasGwei: number;
  blockNumber: number;
  networkCongestion: "low" | "medium" | "high";
  
  // Token specific
  tokenAddress?: string;
  poolLiquidity?: string;
  liquidityDepth?: "shallow" | "moderate" | "deep";
  price?: number;
  priceChange24h?: number;
  volume24h?: string;
  holders?: number;
  
  // Timestamp
  fetchedAt: number;
}

/**
 * Fact injection templates
 */
export const FACT_INJECTION_TEMPLATES = {
  gas: "⛽ Gas: {gasGwei} gwei",
  liquidity: "💧 Liquidity: {liquidityDepth} ({liquidityAmount})",
  price: "💰 Price: ${price} ({priceChange}%)",
  volume: "📊 24h Volume: {volume}",
  holders: "👥 Holders: {holders}",
  network: "🔗 Monad Block: #{blockNumber}",
};

// ============================================
// POST TEMPLATES
// ============================================

export type TemplateType = "technical_thread" | "meme_post" | "release_notes" | "analysis" | "alert";

export interface PostTemplate {
  id: string;
  type: TemplateType;
  name: string;
  description: string;
  
  // Structure
  structure: string[];
  
  // Constraints
  minLength: number;
  maxLength: number;
  requiresData: boolean;
  
  // Tone compatibility
  compatibleTones: ToneLevel[];
  compatibleStyles: WritingStyle[];
  
  // Example
  example: string;
}

// ============================================
// GENERATED CONTENT
// ============================================

export interface GeneratedPost {
  id: string;
  
  // Content
  content: string;
  contentWithDisclosure: string;
  
  // Thread (if applicable)
  isThread: boolean;
  threadParts?: string[];
  
  // Metadata
  template: TemplateType;
  persona: string;
  tone: ToneLevel;
  confidenceScore: number;
  
  // Facts used
  factsIncluded: string[];
  
  // Policy
  policyCheck: PolicyCheckResult;
  
  // Timing
  generatedAt: number;
  
  // Optional media suggestions
  mediaSuggestions?: string[];
}

// ============================================
// ERRORS
// ============================================

export class ContentPolicyError extends Error {
  constructor(
    message: string,
    public readonly violations: PolicyViolation[]
  ) {
    super(message);
    this.name = "ContentPolicyError";
  }
}

export class PersonaNotFoundError extends Error {
  constructor(
    message: string,
    public readonly requestedTags: TokenTag[]
  ) {
    super(message);
    this.name = "PersonaNotFoundError";
  }
}
