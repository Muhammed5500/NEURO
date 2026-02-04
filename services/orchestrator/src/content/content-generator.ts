/**
 * Content Generator
 * 
 * Generates social media content with:
 * - Persona-based styling
 * - Confidence-linked tone
 * - On-chain fact injection
 * - Policy compliance
 * - Required disclosures
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as crypto from "crypto";
import type {
  PersonaProfile,
  GeneratedPost,
  OnChainFacts,
  ToneLevel,
  TemplateType,
  PolicyCheckResult,
} from "./types.js";
import {
  CONFIDENCE_TONE_MAPPINGS,
  FACT_INJECTION_TEMPLATES,
} from "./types.js";
import {
  POST_TEMPLATES,
  TEMPLATE_PARTS,
  getTemplate,
  getRandomHook,
  getRandomInterpretation,
  getCloser,
} from "./templates.js";
import { ContentPolicyEngine, createContentPolicyEngine } from "./content-policy.js";
import { PersonaSelector, createPersonaSelector } from "./persona-selector.js";

const generatorLogger = logger.child({ component: "content-generator" });

// ============================================
// CONTENT GENERATOR CONFIG
// ============================================

export interface ContentGeneratorConfig {
  // Policy enforcement
  enforcePolicy: boolean;
  
  // Disclosure
  alwaysAddDisclosure: boolean;
  
  // On-chain data
  requireOnChainFacts: boolean;
  
  // Token info
  tokenName?: string;
  tokenSymbol?: string;
}

const DEFAULT_CONFIG: ContentGeneratorConfig = {
  enforcePolicy: true,
  alwaysAddDisclosure: true,
  requireOnChainFacts: true,
};

// ============================================
// CONTENT GENERATOR
// ============================================

export class ContentGenerator {
  private readonly config: ContentGeneratorConfig;
  private readonly policyEngine: ContentPolicyEngine;
  private readonly personaSelector: PersonaSelector;

  constructor(config?: Partial<ContentGeneratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.policyEngine = createContentPolicyEngine();
    this.personaSelector = createPersonaSelector();

    generatorLogger.info("ContentGenerator initialized");
  }

  /**
   * Generate a post with persona and confidence-linked tone
   * 
   * Turkish: "Tweetin tonunu, ConsensusDecision içindeki confidenceScore ile senkronize et"
   */
  async generatePost(
    templateType: TemplateType,
    persona: PersonaProfile,
    confidenceScore: number,
    context: {
      tokenName: string;
      tokenSymbol: string;
      analysisResult?: string;
      keyInsights?: string[];
    },
    onChainFacts?: OnChainFacts
  ): Promise<GeneratedPost> {
    const postId = crypto.randomUUID();
    
    // Get confidence-adjusted tone
    const adjustedTone = this.getToneForConfidence(confidenceScore);
    
    // Get template
    const template = getTemplate(templateType);
    if (!template) {
      throw new Error(`Template not found: ${templateType}`);
    }

    // Generate content based on template type
    let content: string;
    let isThread = false;
    let threadParts: string[] | undefined;

    switch (templateType) {
      case "technical_thread":
        const threadResult = this.generateTechnicalThread(
          persona,
          adjustedTone,
          context,
          onChainFacts
        );
        content = threadResult.combined;
        isThread = true;
        threadParts = threadResult.parts;
        break;

      case "meme_post":
        content = this.generateMemePost(
          persona,
          adjustedTone,
          context,
          onChainFacts
        );
        break;

      case "release_notes":
        content = this.generateReleaseNotes(
          persona,
          adjustedTone,
          context,
          onChainFacts
        );
        break;

      case "analysis":
        content = this.generateAnalysisPost(
          persona,
          adjustedTone,
          context,
          onChainFacts
        );
        break;

      case "alert":
        content = this.generateAlertPost(
          persona,
          adjustedTone,
          context,
          onChainFacts
        );
        break;

      default:
        content = this.generateAnalysisPost(
          persona,
          adjustedTone,
          context,
          onChainFacts
        );
    }

    // Add disclosure
    // Turkish: "Her paylaşımın sonuna otomatik olarak şeffaflık ibaresi ekle"
    const contentWithDisclosure = this.config.alwaysAddDisclosure
      ? this.policyEngine.addDisclosure(content, isThread ? "thread" : "default")
      : content;

    // Check policy
    const policyCheck = this.policyEngine.checkContent(contentWithDisclosure);

    // Enforce if configured
    if (this.config.enforcePolicy && !policyCheck.passed) {
      // Try to sanitize
      const { sanitized, changesApplied } = this.policyEngine.sanitizeContent(contentWithDisclosure);
      const recheckResult = this.policyEngine.checkContent(sanitized);

      if (!recheckResult.passed) {
        throw new Error(
          `Content failed policy check after sanitization: ${recheckResult.violations.map(v => v.reason).join(", ")}`
        );
      }

      generatorLogger.info({
        changesApplied,
      }, "Content sanitized to pass policy");
    }

    // Build facts list
    const factsIncluded: string[] = [];
    if (onChainFacts) {
      if (onChainFacts.currentGasGwei) factsIncluded.push("gas");
      if (onChainFacts.poolLiquidity) factsIncluded.push("liquidity");
      if (onChainFacts.volume24h) factsIncluded.push("volume");
      if (onChainFacts.holders) factsIncluded.push("holders");
      if (onChainFacts.price) factsIncluded.push("price");
    }

    const post: GeneratedPost = {
      id: postId,
      content,
      contentWithDisclosure,
      isThread,
      threadParts,
      template: templateType,
      persona: persona.id,
      tone: adjustedTone,
      confidenceScore,
      factsIncluded,
      policyCheck,
      generatedAt: Date.now(),
    };

    generatorLogger.info({
      postId,
      template: templateType,
      persona: persona.id,
      tone: adjustedTone,
      confidenceScore,
      factsIncluded,
      policyPassed: policyCheck.passed,
    }, "Post generated");

    return post;
  }

  /**
   * Get tone level for confidence score
   * Turkish: "güven skoru 0.85 ise temkinli, 0.95 ise emin"
   */
  getToneForConfidence(confidenceScore: number): ToneLevel {
    for (const mapping of CONFIDENCE_TONE_MAPPINGS) {
      if (confidenceScore >= mapping.minConfidence && confidenceScore < mapping.maxConfidence) {
        return mapping.tone;
      }
    }
    // Edge case for exactly 1.0
    if (confidenceScore >= 1.0) {
      return "very_confident";
    }
    return "cautious";
  }

  /**
   * Get language patterns for tone
   */
  getLanguagePatternsForTone(tone: ToneLevel): string[] {
    const mapping = CONFIDENCE_TONE_MAPPINGS.find(m => m.tone === tone);
    return mapping?.languagePatterns || [];
  }

  /**
   * Generate on-chain facts string
   * Turkish: "Monad ana ağından çekilen gerçek verileri entegre et"
   */
  formatOnChainFacts(facts: OnChainFacts): string {
    const lines: string[] = [];

    if (facts.currentGasGwei !== undefined) {
      lines.push(FACT_INJECTION_TEMPLATES.gas.replace("{gasGwei}", facts.currentGasGwei.toString()));
    }

    if (facts.poolLiquidity && facts.liquidityDepth) {
      lines.push(
        FACT_INJECTION_TEMPLATES.liquidity
          .replace("{liquidityDepth}", facts.liquidityDepth.charAt(0).toUpperCase() + facts.liquidityDepth.slice(1))
          .replace("{liquidityAmount}", facts.poolLiquidity)
      );
    }

    if (facts.volume24h) {
      lines.push(FACT_INJECTION_TEMPLATES.volume.replace("{volume}", facts.volume24h));
    }

    if (facts.holders) {
      lines.push(FACT_INJECTION_TEMPLATES.holders.replace("{holders}", facts.holders.toLocaleString()));
    }

    if (facts.price !== undefined) {
      lines.push(FACT_INJECTION_TEMPLATES.price.replace("{value}", facts.price.toFixed(6)));
    }

    return lines.join("\n");
  }

  // ============================================
  // TEMPLATE GENERATORS
  // ============================================

  /**
   * Generate technical thread
   */
  private generateTechnicalThread(
    persona: PersonaProfile,
    tone: ToneLevel,
    context: {
      tokenName: string;
      tokenSymbol: string;
      analysisResult?: string;
      keyInsights?: string[];
    },
    facts?: OnChainFacts
  ): { combined: string; parts: string[] } {
    const parts: string[] = [];
    const symbol = context.tokenSymbol;

    // 1. Hook tweet
    const hook = getRandomHook(tone).replace("$TOKEN", `$${symbol}`);
    parts.push(`🧵 Thread: ${hook}`);

    // 2. Context tweet
    parts.push(
      `1/ On-chain analysis for $${symbol}\n\n` +
      `${this.getContextText(tone, context)}`
    );

    // 3. Data tweet with on-chain facts
    // Turkish: "içine Monad ana ağından çekilen gerçek verileri entegre et"
    if (facts) {
      parts.push(
        `2/ Current on-chain state:\n\n` +
        this.formatOnChainFacts(facts)
      );
    } else {
      parts.push(
        `2/ Key metrics under analysis:\n\n` +
        `Gathering on-chain data...`
      );
    }

    // 4. Key insights
    if (context.keyInsights && context.keyInsights.length > 0) {
      parts.push(
        `3/ Key observations:\n\n` +
        context.keyInsights.map((i, idx) => `${idx + 1}. ${i}`).join("\n")
      );
    }

    // 5. Analysis/interpretation
    const interpretation = getRandomInterpretation(tone);
    parts.push(
      `4/ Analysis:\n\n` +
      `${context.analysisResult || interpretation}`
    );

    // 6. Conclusion with disclosure
    parts.push(
      `5/ Summary:\n\n` +
      `Based on the on-chain data, ${this.getSummaryText(tone, symbol)}\n\n` +
      `Always DYOR.`
    );

    return {
      combined: parts.join("\n\n---\n\n"),
      parts,
    };
  }

  /**
   * Generate meme-style post
   */
  private generateMemePost(
    persona: PersonaProfile,
    tone: ToneLevel,
    context: {
      tokenName: string;
      tokenSymbol: string;
      analysisResult?: string;
      keyInsights?: string[];
    },
    facts?: OnChainFacts
  ): string {
    const symbol = context.tokenSymbol;
    const emojis = persona.preferredEmojis;
    const emoji1 = emojis[0] || "🔥";
    const emoji2 = emojis[1] || "👀";

    let content = `$${symbol} ${emoji1}\n\n`;

    // Add a fact if available
    // Turkish: "gerçek verileri entegre et"
    if (facts) {
      if (facts.liquidityDepth) {
        content += `On-chain data shows liquidity looking ${facts.liquidityDepth} ${emoji2}\n\n`;
      } else if (facts.currentGasGwei) {
        content += `Gas at ${facts.currentGasGwei} gwei - chain is active ${emoji2}\n\n`;
      }
    }

    // Add tone-appropriate observation
    // Turkish: "analitik bir yaklaşım zorunlu"
    const interpretation = getRandomInterpretation(tone);
    content += `${interpretation}`;

    return content;
  }

  /**
   * Generate release notes
   */
  private generateReleaseNotes(
    persona: PersonaProfile,
    tone: ToneLevel,
    context: {
      tokenName: string;
      tokenSymbol: string;
      analysisResult?: string;
      keyInsights?: string[];
    },
    facts?: OnChainFacts
  ): string {
    const symbol = context.tokenSymbol;

    let content = `📢 Analysis Update: $${symbol}\n\n`;

    // What's new
    content += `What the data shows:\n`;
    if (context.keyInsights) {
      context.keyInsights.slice(0, 3).forEach(insight => {
        content += `• ${insight}\n`;
      });
    } else {
      content += `• Updated on-chain metrics\n`;
      content += `• Latest activity analysis\n`;
    }

    // Technical details with facts
    // Turkish: "Monad ana ağından çekilen gerçek verileri entegre et"
    if (facts) {
      content += `\nOn-chain snapshot:\n`;
      content += this.formatOnChainFacts(facts);
      content += `\n`;
    }

    // Impact/interpretation
    content += `\nAssessment:\n`;
    content += getRandomInterpretation(tone);

    return content;
  }

  /**
   * Generate analysis post
   */
  private generateAnalysisPost(
    persona: PersonaProfile,
    tone: ToneLevel,
    context: {
      tokenName: string;
      tokenSymbol: string;
      analysisResult?: string;
      keyInsights?: string[];
    },
    facts?: OnChainFacts
  ): string {
    const symbol = context.tokenSymbol;
    const hook = getRandomHook(tone).replace("$TOKEN", `$${symbol}`);

    let content = `${hook}\n\n`;

    // Add on-chain facts
    // Turkish: "gerçek verileri entegre et"
    if (facts) {
      content += this.formatOnChainFacts(facts);
      content += `\n\n`;
    }

    // Add interpretation
    // Turkish: "analitik bir yaklaşım zorunlu"
    content += getRandomInterpretation(tone);

    return content;
  }

  /**
   * Generate alert post
   */
  private generateAlertPost(
    persona: PersonaProfile,
    tone: ToneLevel,
    context: {
      tokenName: string;
      tokenSymbol: string;
      analysisResult?: string;
      keyInsights?: string[];
    },
    facts?: OnChainFacts
  ): string {
    const symbol = context.tokenSymbol;

    let content = `🚨 On-Chain Alert: $${symbol}\n\n`;

    // Alert reason
    if (context.keyInsights && context.keyInsights[0]) {
      content += `${context.keyInsights[0]}\n\n`;
    } else {
      content += `Notable activity detected\n\n`;
    }

    // Facts
    // Turkish: "gerçek verileri entegre et"
    if (facts) {
      content += this.formatOnChainFacts(facts);
      content += `\n\n`;
    }

    // Cautious interpretation (alerts should always be cautious)
    content += getRandomInterpretation("cautious");

    return content;
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private getContextText(
    tone: ToneLevel,
    context: { tokenName: string; tokenSymbol: string }
  ): string {
    const texts = {
      very_cautious: `Early stage analysis - more data collection needed for ${context.tokenName}`,
      cautious: `Preliminary analysis underway for ${context.tokenName}`,
      neutral: `Analyzing current on-chain activity for ${context.tokenName}`,
      confident: `Strong data patterns emerging for ${context.tokenName}`,
      very_confident: `Comprehensive analysis of ${context.tokenName} metrics`,
    };
    return texts[tone];
  }

  private getSummaryText(tone: ToneLevel, symbol: string): string {
    const texts = {
      very_cautious: `$${symbol} shows early signals that warrant further monitoring`,
      cautious: `$${symbol} metrics suggest developing activity worth watching`,
      neutral: `$${symbol} on-chain data indicates noteworthy patterns`,
      confident: `$${symbol} data strongly supports the observed trend`,
      very_confident: `$${symbol} shows exceptional alignment across all metrics`,
    };
    return texts[tone];
  }
}

/**
 * Factory function
 */
export function createContentGenerator(
  config?: Partial<ContentGeneratorConfig>
): ContentGenerator {
  return new ContentGenerator(config);
}
