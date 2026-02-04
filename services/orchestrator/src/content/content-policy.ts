/**
 * Content Policy Engine
 * 
 * Enforces content policies to ensure compliance:
 * - No misleading claims
 * - No guaranteed returns
 * - No impersonation
 * - Always disclose automated posting
 * 
 * Turkish: "No-Shill Policy" - Analitik yaklaşım zorunlu
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  PolicyCheckResult,
  PolicyViolation,
  PolicyWarning,
  PolicyViolationType,
  DisclosureConfig,
  ToneLevel,
} from "./types.js";
import { DEFAULT_DISCLOSURE, ContentPolicyError } from "./types.js";

const policyLogger = logger.child({ component: "content-policy" });

// ============================================
// PROHIBITED PATTERNS
// ============================================

/**
 * Patterns that indicate prohibited content
 */
const PROHIBITED_PATTERNS: Array<{
  pattern: RegExp;
  type: PolicyViolationType;
  severity: "low" | "medium" | "high" | "critical";
  reason: string;
  replacement?: string;
}> = [
  // Guaranteed returns
  {
    pattern: /\b(guaranteed|certain|definite|sure\s*thing|100%|risk[- ]?free)\s*(returns?|profit|gains?|money)/gi,
    type: "guaranteed_returns",
    severity: "critical",
    reason: "Implies guaranteed financial returns",
    replacement: "potential opportunity",
  },
  {
    pattern: /\b(will|gonna)\s*(moon|10x|100x|1000x|pump)/gi,
    type: "guaranteed_returns",
    severity: "high",
    reason: "Predicts specific price movements",
    replacement: "showing interesting metrics",
  },
  {
    pattern: /\b(can'?t|cannot|won'?t)\s*(lose|fail|go\s*wrong)/gi,
    type: "misleading_claim",
    severity: "critical",
    reason: "Claims no risk of loss",
    replacement: "has interesting risk/reward",
  },

  // Shill language (Turkish: "No-Shill Policy")
  {
    pattern: /\b(buy|ape|grab|load\s*up|get\s*in)\s*(now|immediately|asap|before|quick)/gi,
    type: "shill_language",
    severity: "high",
    reason: "Direct purchase instruction - violates no-shill policy",
    replacement: "worth researching",
  },
  {
    pattern: /\b(don'?t\s*miss|last\s*chance|act\s*fast|hurry|limited\s*time)/gi,
    type: "fomo_inducing",
    severity: "high",
    reason: "Creates artificial urgency (FOMO)",
    replacement: "currently active",
  },
  {
    pattern: /\b(trust\s*me|believe\s*me|i\s*promise)/gi,
    type: "misleading_claim",
    severity: "medium",
    reason: "Personal guarantees are not evidence",
    replacement: "the data suggests",
  },

  // Price predictions
  {
    pattern: /\b(will\s*reach|going\s*to|headed\s*to)\s*\$?\d+/gi,
    type: "price_prediction",
    severity: "high",
    reason: "Specific price predictions are prohibited",
    replacement: "showing momentum",
  },
  {
    pattern: /\bprice\s*target[:\s]*\$?\d+/gi,
    type: "price_prediction",
    severity: "high",
    reason: "Price targets are not allowed",
  },

  // Impersonation indicators
  {
    pattern: /\b(official|verified|endorsed\s*by|partnered\s*with)\b(?!.*\[)/gi,
    type: "impersonation",
    severity: "high",
    reason: "May imply false official status",
  },
  {
    pattern: /\b(we\s*are|i\s*am)\s*(the\s*)?(team|founder|dev|official)/gi,
    type: "impersonation",
    severity: "critical",
    reason: "Impersonating project team",
  },

  // Unverified claims
  {
    pattern: /\b(proven|confirmed|verified)\s*(by\s*experts?|scientifically)/gi,
    type: "unverified_claim",
    severity: "medium",
    reason: "Claims unverified expert validation",
    replacement: "based on on-chain data",
  },

  // Financial advice indicators
  {
    pattern: /\b(you\s*should|i\s*recommend|my\s*advice\s*is)/gi,
    type: "misleading_claim",
    severity: "medium",
    reason: "Sounds like financial advice",
    replacement: "the metrics indicate",
  },
];

/**
 * Required analytical phrases for no-shill compliance
 * Turkish: "'Bu token'ın on-chain verileri şu yönde gelişiyor' gibi analitik bir yaklaşım zorunlu"
 */
const ANALYTICAL_PHRASES = [
  "on-chain data shows",
  "metrics indicate",
  "analysis suggests",
  "data points to",
  "according to on-chain",
  "based on the data",
  "looking at the metrics",
  "the numbers show",
];

// ============================================
// CONTENT POLICY ENGINE
// ============================================

export interface ContentPolicyConfig {
  // Strictness
  strictMode: boolean;
  
  // Disclosure
  disclosure: DisclosureConfig;
  
  // Thresholds
  maxViolationsBeforeReject: number;
  allowMediumViolations: boolean;
}

const DEFAULT_CONFIG: ContentPolicyConfig = {
  strictMode: true,
  disclosure: DEFAULT_DISCLOSURE,
  maxViolationsBeforeReject: 0, // Zero tolerance for critical
  allowMediumViolations: false,
};

export class ContentPolicyEngine {
  private readonly config: ContentPolicyConfig;

  constructor(config?: Partial<ContentPolicyConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    policyLogger.info({
      strictMode: this.config.strictMode,
    }, "ContentPolicyEngine initialized");
  }

  /**
   * Check content against all policies
   */
  checkContent(
    content: string,
    requiresAnalyticalApproach = true
  ): PolicyCheckResult {
    const violations: PolicyViolation[] = [];
    const warnings: PolicyWarning[] = [];
    const suggestedFixes: string[] = [];

    // Check prohibited patterns
    for (const rule of PROHIBITED_PATTERNS) {
      const matches = content.matchAll(rule.pattern);
      
      for (const match of matches) {
        violations.push({
          type: rule.type,
          severity: rule.severity,
          location: {
            start: match.index!,
            end: match.index! + match[0].length,
          },
          problematicText: match[0],
          reason: rule.reason,
          suggestedReplacement: rule.replacement,
        });

        if (rule.replacement) {
          suggestedFixes.push(
            `Replace "${match[0]}" with "${rule.replacement}"`
          );
        }
      }
    }

    // Check for analytical approach requirement
    // Turkish: "analitik bir yaklaşım zorunlu olsun"
    if (requiresAnalyticalApproach) {
      const hasAnalyticalPhrase = ANALYTICAL_PHRASES.some(
        phrase => content.toLowerCase().includes(phrase.toLowerCase())
      );

      if (!hasAnalyticalPhrase) {
        warnings.push({
          type: "missing_analytical_approach",
          message: "Content should include analytical phrases based on data",
          suggestion: "Add phrases like 'on-chain data shows' or 'metrics indicate'",
        });
      }
    }

    // Check for disclosure
    const hasDisclosure = this.checkDisclosure(content);
    if (!hasDisclosure) {
      violations.push({
        type: "missing_disclosure",
        severity: "high",
        location: { start: content.length, end: content.length },
        problematicText: "",
        reason: "Missing required AI/automation disclosure",
      });
      suggestedFixes.push("Add disclosure: " + this.config.disclosure.templates.default);
    }

    // Determine if passed
    const criticalViolations = violations.filter(v => v.severity === "critical");
    const highViolations = violations.filter(v => v.severity === "high");
    const mediumViolations = violations.filter(v => v.severity === "medium");

    let passed = true;
    if (criticalViolations.length > 0) {
      passed = false;
    } else if (highViolations.length > this.config.maxViolationsBeforeReject) {
      passed = false;
    } else if (!this.config.allowMediumViolations && mediumViolations.length > 0) {
      passed = false;
    }

    const result: PolicyCheckResult = {
      passed,
      violations,
      warnings,
      suggestedFixes,
    };

    policyLogger.debug({
      passed,
      violationCount: violations.length,
      warningCount: warnings.length,
    }, "Content policy check complete");

    return result;
  }

  /**
   * Check if content has required disclosure
   * Turkish: "[NEURO AI Autonomous Post - Not Financial Advice]"
   */
  checkDisclosure(content: string): boolean {
    const disclosurePatterns = [
      /\bNEURO\s*AI\b/i,
      /\bautomated?\s*(post|analysis|content)\b/i,
      /\bNFA\b/,
      /\bnot\s*financial\s*advice\b/i,
      /\bAI\s*(generated|automated|autonomous)\b/i,
      /🤖/,
    ];

    return disclosurePatterns.some(pattern => pattern.test(content));
  }

  /**
   * Add disclosure to content
   * Turkish: "Her paylaşımın sonuna otomatik olarak şeffaflık ibaresi ekle"
   */
  addDisclosure(
    content: string,
    type: "default" | "short" | "thread" = "default"
  ): string {
    // Check if already has disclosure
    if (this.checkDisclosure(content)) {
      return content;
    }

    const disclosure = this.config.disclosure.templates[type];
    
    switch (this.config.disclosure.position) {
      case "prefix":
        return disclosure + this.config.disclosure.separator + content;
      case "suffix":
        return content + disclosure;
      case "both":
        return disclosure + this.config.disclosure.separator + content + disclosure;
      default:
        return content + disclosure;
    }
  }

  /**
   * Sanitize content by removing/replacing violations
   */
  sanitizeContent(content: string): {
    sanitized: string;
    changesApplied: string[];
  } {
    let sanitized = content;
    const changesApplied: string[] = [];

    // Apply replacements in reverse order to preserve indices
    const allMatches: Array<{
      start: number;
      end: number;
      original: string;
      replacement: string;
    }> = [];

    for (const rule of PROHIBITED_PATTERNS) {
      if (!rule.replacement) continue;
      
      const matches = content.matchAll(rule.pattern);
      for (const match of matches) {
        allMatches.push({
          start: match.index!,
          end: match.index! + match[0].length,
          original: match[0],
          replacement: rule.replacement,
        });
      }
    }

    // Sort by position descending
    allMatches.sort((a, b) => b.start - a.start);

    // Apply replacements
    for (const { start, end, original, replacement } of allMatches) {
      sanitized = sanitized.slice(0, start) + replacement + sanitized.slice(end);
      changesApplied.push(`"${original}" → "${replacement}"`);
    }

    return { sanitized, changesApplied };
  }

  /**
   * Validate tone appropriateness
   */
  validateTone(content: string, expectedTone: ToneLevel): PolicyWarning[] {
    const warnings: PolicyWarning[] = [];

    // Check for overconfident language when tone should be cautious
    if (expectedTone === "cautious" || expectedTone === "very_cautious") {
      const overconfidentPatterns = [
        /\b(definitely|certainly|absolutely|undoubtedly)\b/gi,
        /\b(massive|huge|incredible|amazing)\s*(opportunity|potential)/gi,
      ];

      for (const pattern of overconfidentPatterns) {
        if (pattern.test(content)) {
          warnings.push({
            type: "tone_mismatch",
            message: "Content tone is more confident than expected",
            suggestion: `Use more cautious language for ${expectedTone} tone`,
          });
          break;
        }
      }
    }

    // Check for overly cautious language when tone should be confident
    if (expectedTone === "confident" || expectedTone === "very_confident") {
      const overcautiousPatterns = [
        /\b(might|may|possibly|perhaps|maybe)\b/gi,
        /\b(not sure|uncertain|unclear)\b/gi,
      ];

      let cautiousCount = 0;
      for (const pattern of overcautiousPatterns) {
        const matches = content.match(pattern);
        if (matches) {
          cautiousCount += matches.length;
        }
      }

      if (cautiousCount > 3) {
        warnings.push({
          type: "tone_mismatch",
          message: "Content is too cautious for expected confidence level",
          suggestion: `Use more assertive language for ${expectedTone} tone`,
        });
      }
    }

    return warnings;
  }

  /**
   * Enforce policy - throws if violations found
   */
  enforcePolicy(content: string): void {
    const result = this.checkContent(content);
    
    if (!result.passed) {
      policyLogger.warn({
        violations: result.violations.map(v => ({
          type: v.type,
          severity: v.severity,
          text: v.problematicText,
        })),
      }, "Content policy violation");

      throw new ContentPolicyError(
        `Content violates policy: ${result.violations.length} violation(s) found`,
        result.violations
      );
    }
  }
}

/**
 * Factory function
 */
export function createContentPolicyEngine(
  config?: Partial<ContentPolicyConfig>
): ContentPolicyEngine {
  return new ContentPolicyEngine(config);
}
