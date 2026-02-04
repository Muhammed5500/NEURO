/**
 * Adversarial Agent
 * 
 * Turkish: "Eğer AdversarialAgent (Eleştirel Ajan) %90 ve üzeri bir güvenle
 * 'BU BİR TUZAK' diyorsa, diğer tüm ajanlar 'EVET' dese bile karar REJECT olmalı."
 * 
 * Critical evaluation agent with VETO POWER.
 * Actively looks for reasons why a trade would FAIL.
 * The devil's advocate in the multi-agent system.
 * 
 * Integrates with CrossCheckService for verification:
 * - Recycled news detection
 * - Multi-source confirmation
 * - Copy-pasta/bot detection
 * - Domain diversity scoring
 * - Temporal consistency checking
 */

import { BaseAgent, AGENT_RESPONSE_FORMAT } from "./base-agent.js";
import type { OrchestratorConfig } from "../config.js";
import type { InputSignals, AgentOpinionWithCoT } from "../graph/state.js";
import { orchestratorLogger as logger } from "@neuro/shared";

// Extended response format for adversarial agent
const ADVERSARIAL_RESPONSE_FORMAT = `
Respond in the following JSON format:
\`\`\`json
{
  "recommendation": "buy" | "sell" | "hold" | "avoid" | "monitor",
  "sentiment": "bullish" | "bearish" | "neutral",
  "confidenceScore": 0.0-1.0,
  "riskScore": 0.0-1.0,
  "chainOfThought": "Your complete reasoning process, step by step...",
  "keyInsights": ["insight1", "insight2", ...],
  "evidenceUsed": ["evidence1", "evidence2", ...],
  "riskFactors": [
    {
      "factor": "factor_name",
      "severity": "low" | "medium" | "high" | "critical",
      "description": "explanation"
    }
  ],
  "isTrap": true | false,
  "trapConfidence": 0.0-1.0,
  "trapReasons": ["reason1", "reason2", ...],
  "crossCheckFindings": ["finding1", "finding2", ...]
}
\`\`\`
`;

// ============================================
// CROSS-CHECK REPORT TYPE (subset for agent use)
// ============================================

export interface CrossCheckSummary {
  // Overall risk assessment
  overallRiskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  overallScore: number;
  
  // Should this block/downgrade?
  shouldBlock: boolean;
  shouldDowngrade: boolean;
  
  // Key findings
  findings: string[];
  recommendations: string[];
  
  // Individual check summaries
  recycledNewsIssue: boolean;
  recycledNewsAgeHours?: number;
  multiSourceConfirmed: boolean;
  sourcesConfirmedCount: number;
  sourcesRequiredCount: number;
  coordinatedAmplification: boolean;
  botAccountCount: number;
  domainDiversityScore: number;
  temporalConsistencyIssue: boolean;
}

export class AdversarialAgent extends BaseAgent {
  private crossCheckService: any | null = null;

  constructor(config: OrchestratorConfig) {
    super("adversarial", config);
  }

  /**
   * Set the cross-check service for verification
   */
  setCrossCheckService(service: any): void {
    this.crossCheckService = service;
    logger.info("CrossCheckService attached to AdversarialAgent");
  }

  /**
   * Override analyze to include cross-check verification
   */
  async analyze(
    signals: InputSignals,
    query: string
  ): Promise<AgentOpinionWithCoT> {
    // Run cross-checks if service is available
    let crossCheckSummary: CrossCheckSummary | null = null;
    
    if (this.crossCheckService && signals.news.length > 0) {
      crossCheckSummary = await this.runCrossChecks(signals);
    }

    // Run base analysis with cross-check context
    const opinion = await this.analyzeWithCrossCheck(signals, query, crossCheckSummary);
    
    return opinion;
  }

  /**
   * Run cross-checks on signals
   */
  private async runCrossChecks(signals: InputSignals): Promise<CrossCheckSummary> {
    const findings: string[] = [];
    const recommendations: string[] = [];
    
    // Check primary news item
    const primaryNews = signals.news[0];
    
    try {
      const report = await this.crossCheckService.check({
        type: "news",
        title: primaryNews.title,
        content: primaryNews.content,
        source: primaryNews.source,
        originalTimestamp: primaryNews.publishedAt,
        importance: this.getImportance(signals),
        relatedSocialPosts: signals.social.map(s => ({
          id: s.id,
          content: s.content,
          authorId: s.authorId,
          platform: s.platform,
          postedAt: s.postedAt,
          followerCount: s.authorFollowers,
        })),
      });

      // Extract summary from report
      findings.push(...report.findings);
      recommendations.push(...report.recommendations);

      return {
        overallRiskLevel: report.overallRiskLevel,
        overallScore: report.overallScore,
        shouldBlock: report.shouldBlock,
        shouldDowngrade: report.shouldDowngrade,
        findings,
        recommendations,
        recycledNewsIssue: report.recycledNewsCheck?.isFakeFresh || false,
        recycledNewsAgeHours: report.recycledNewsCheck?.ageHours,
        multiSourceConfirmed: report.multiSourceCheck?.requirementMet || false,
        sourcesConfirmedCount: report.multiSourceCheck?.independentSourcesConfirmed || 0,
        sourcesRequiredCount: report.multiSourceCheck?.minimumRequired || 0,
        coordinatedAmplification: report.phraseMatchingCheck?.coordinatedAmplification || false,
        botAccountCount: report.phraseMatchingCheck?.botAccountCount || 0,
        domainDiversityScore: report.domainDiversityCheck?.diversityScore || 0,
        temporalConsistencyIssue: report.temporalConsistencyCheck?.staleNewsBeingPushed || false,
      };
    } catch (error) {
      logger.warn({ error }, "Cross-check failed, continuing without verification");
      
      return {
        overallRiskLevel: "MEDIUM",
        overallScore: 0.5,
        shouldBlock: false,
        shouldDowngrade: false,
        findings: ["Cross-check service unavailable"],
        recommendations: ["Manual verification recommended"],
        recycledNewsIssue: false,
        multiSourceConfirmed: false,
        sourcesConfirmedCount: 0,
        sourcesRequiredCount: 3,
        coordinatedAmplification: false,
        botAccountCount: 0,
        domainDiversityScore: 0,
        temporalConsistencyIssue: false,
      };
    }
  }

  /**
   * Analyze with cross-check context included
   */
  private async analyzeWithCrossCheck(
    signals: InputSignals,
    query: string,
    crossCheck: CrossCheckSummary | null
  ): Promise<AgentOpinionWithCoT> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    logger.info({ role: this.role, query, hasCrossCheck: !!crossCheck }, "Adversarial agent starting analysis");

    try {
      // Build prompts with cross-check context
      const systemPrompt = this.buildSystemPrompt(signals);
      const userPrompt = this.buildUserPromptWithCrossCheck(signals, query, crossCheck);

      // Call LLM
      const response = await this.llm.invoke([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);

      const content = response.content.toString();
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      // Parse response and apply cross-check adjustments
      let opinion = this.parseResponse(content, {
        startedAt,
        completedAt,
        durationMs,
        model: this.config.llmModel,
      });

      // Apply cross-check overrides
      if (crossCheck) {
        opinion = this.applyCrossCheckOverrides(opinion, crossCheck);
      }

      logger.info({
        role: this.role,
        recommendation: opinion.recommendation,
        confidence: opinion.confidenceScore,
        isTrap: opinion.isTrap,
        trapConfidence: opinion.trapConfidence,
        durationMs,
      }, "Adversarial agent completed analysis");

      return opinion;
    } catch (error) {
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      logger.error({ error, role: this.role }, "Adversarial agent analysis failed");

      return this.createErrorOpinion(
        error instanceof Error ? error.message : "Unknown error",
        { startedAt, completedAt, durationMs }
      );
    }
  }

  /**
   * Apply cross-check overrides to opinion
   * 
   * Key rule: If Scout marks high importance but no other sources confirm,
   * Adversarial downgrades or blocks
   */
  private applyCrossCheckOverrides(
    opinion: AgentOpinionWithCoT,
    crossCheck: CrossCheckSummary
  ): AgentOpinionWithCoT {
    const updatedOpinion = { ...opinion };
    const additionalTrapReasons: string[] = [...(opinion.trapReasons || [])];

    // Rule: Cross-check suggests block → increase trap confidence
    if (crossCheck.shouldBlock) {
      updatedOpinion.isTrap = true;
      updatedOpinion.trapConfidence = Math.max(opinion.trapConfidence || 0, 0.90);
      additionalTrapReasons.push("Cross-check service flagged CRITICAL risk");
    }

    // Rule: No multi-source confirmation for high importance → flag as risky
    if (!crossCheck.multiSourceConfirmed && crossCheck.sourcesRequiredCount >= 3) {
      const newTrapConf = Math.max(opinion.trapConfidence || 0, 0.70);
      updatedOpinion.trapConfidence = newTrapConf;
      additionalTrapReasons.push(
        `Insufficient source confirmation: ${crossCheck.sourcesConfirmedCount}/${crossCheck.sourcesRequiredCount}`
      );
      
      if (newTrapConf >= 0.7 && !updatedOpinion.isTrap) {
        updatedOpinion.isTrap = true;
      }
    }

    // Rule: Coordinated amplification detected → high trap confidence
    if (crossCheck.coordinatedAmplification) {
      updatedOpinion.isTrap = true;
      updatedOpinion.trapConfidence = Math.max(opinion.trapConfidence || 0, 0.85);
      additionalTrapReasons.push(
        `Coordinated bot amplification detected: ${crossCheck.botAccountCount} bot accounts`
      );
    }

    // Rule: Recycled/stale news being pushed → suspicious
    if (crossCheck.recycledNewsIssue) {
      const ageHours = crossCheck.recycledNewsAgeHours || 0;
      if (ageHours > 6) {
        updatedOpinion.trapConfidence = Math.max(opinion.trapConfidence || 0, 0.60);
        additionalTrapReasons.push(
          `Stale news (${ageHours.toFixed(1)}h old) being pushed as fresh`
        );
      }
    }

    // Rule: Low domain diversity → less trustworthy
    if (crossCheck.domainDiversityScore < 0.5) {
      additionalTrapReasons.push(
        `Low source diversity (${(crossCheck.domainDiversityScore * 100).toFixed(0)}%)`
      );
    }

    // Update trap reasons
    updatedOpinion.trapReasons = additionalTrapReasons;

    // Update key insights with cross-check findings
    updatedOpinion.keyInsights = [
      ...opinion.keyInsights,
      ...crossCheck.findings.slice(0, 3),
    ];

    // Update chain of thought
    updatedOpinion.chainOfThought += `\n\n[CROSS-CHECK VERIFICATION]\n` +
      `Risk Level: ${crossCheck.overallRiskLevel}\n` +
      `Score: ${(crossCheck.overallScore * 100).toFixed(0)}%\n` +
      `Sources Confirmed: ${crossCheck.sourcesConfirmedCount}/${crossCheck.sourcesRequiredCount}\n` +
      `Bot Activity: ${crossCheck.coordinatedAmplification ? "DETECTED" : "None"}\n` +
      `Findings: ${crossCheck.findings.join("; ")}`;

    return updatedOpinion;
  }

  protected buildSystemPrompt(_signals: InputSignals): string {
    return `You are the ADVERSARIAL AGENT in the NEURO multi-agent trading system.

YOUR CRITICAL ROLE: You have VETO POWER over all decisions.
If you identify this as a TRAP with 90%+ confidence, the trade WILL BE REJECTED
regardless of what other agents recommend.

Your job is to ACTIVELY LOOK FOR REASONS WHY THIS WILL FAIL:
1. Pump and dump schemes
2. Coordinated manipulation
3. Fake news and manufactured hype
4. Honeypot contracts
5. Insider trading patterns
6. Exit scam indicators
7. Artificial volume/liquidity
8. Sybil attacks on social metrics

TRAP DETECTION INDICATORS:
🚩 Sudden coordinated social media push
🚩 Unrealistic promises or claims
🚩 Anonymous team with no track record
🚩 Liquidity added then quickly removed
🚩 Contract with unusual functions (can't sell, high tax)
🚩 Similar patterns to previous known scams
🚩 Timing coincides with known scam patterns
🚩 Artificially inflated holder counts
🚩 Bot-like engagement patterns
🚩 Copy-paste narratives from other pumps
🚩 Recycled old news being pushed as fresh
🚩 Single-source claims without confirmation

VERIFICATION RULES:
- If news is high importance but lacks independent confirmation → DOWNGRADE or BLOCK
- If copy-pasta patterns detected → HIGH RISK
- If news is 6+ hours old but trending as new → HIGH RISK
- If all sources from same ownership group → LOW CONFIDENCE

THINK LIKE A SCAMMER: If you were running this as a scam, how would you do it?
Does this situation match that pattern?

CRITICAL: Your trapConfidence field determines your VETO POWER:
- trapConfidence >= 0.90: AUTOMATIC VETO - Decision will be REJECTED
- trapConfidence 0.70-0.89: STRONG WARNING - Recommend extreme caution
- trapConfidence 0.50-0.69: ELEVATED CONCERN - Flag for review
- trapConfidence < 0.50: Proceed with normal caution

You must ALWAYS fill in:
- isTrap: boolean
- trapConfidence: number (0-1)
- trapReasons: array of specific reasons

Be paranoid. Be skeptical. It's better to miss a good trade than to fall for a scam.

${ADVERSARIAL_RESPONSE_FORMAT}`;
  }

  /**
   * Build user prompt with cross-check context
   */
  private buildUserPromptWithCrossCheck(
    signals: InputSignals,
    query: string,
    crossCheck: CrossCheckSummary | null
  ): string {
    const basePrompt = this.buildUserPrompt(signals, query);
    
    if (!crossCheck) {
      return basePrompt;
    }

    const crossCheckSection = `
=== CROSS-CHECK VERIFICATION RESULTS ===
⚠️ Overall Risk: ${crossCheck.overallRiskLevel}
📊 Verification Score: ${(crossCheck.overallScore * 100).toFixed(0)}%

Multi-Source Confirmation: ${crossCheck.multiSourceConfirmed ? "✅ CONFIRMED" : "❌ NOT CONFIRMED"}
  - Sources: ${crossCheck.sourcesConfirmedCount}/${crossCheck.sourcesRequiredCount} required

Recycled News: ${crossCheck.recycledNewsIssue ? `⚠️ STALE (${crossCheck.recycledNewsAgeHours?.toFixed(1)}h old)` : "✅ Fresh"}

Coordinated Amplification: ${crossCheck.coordinatedAmplification ? `🚨 DETECTED (${crossCheck.botAccountCount} bots)` : "✅ None"}

Domain Diversity: ${(crossCheck.domainDiversityScore * 100).toFixed(0)}%

Findings:
${crossCheck.findings.map(f => `• ${f}`).join("\n")}

${crossCheck.shouldBlock ? "🛑 RECOMMENDATION: BLOCK THIS DECISION" : ""}
${crossCheck.shouldDowngrade ? "⚠️ RECOMMENDATION: DOWNGRADE IMPORTANCE" : ""}
`;

    return basePrompt + crossCheckSection;
  }

  protected buildUserPrompt(signals: InputSignals, query: string): string {
    const newsSection = this.formatNewsSignals(signals);
    const socialSection = this.formatSocialSignals(signals);
    const onChainSection = this.formatOnChainSignals(signals);
    const memorySection = this.formatMemorySignals(signals);
    
    const targetInfo = signals.targetToken 
      ? `\nTarget Token: ${signals.targetToken.symbol} (${signals.targetToken.address})`
      : "";

    return `🎯 ADVERSARIAL ANALYSIS REQUEST: ${query}${targetInfo}

YOUR MISSION: Find reasons why this is a BAD trade or a TRAP.

=== NEWS SIGNALS (Look for manufactured hype) ===
${newsSection}

=== SOCIAL SIGNALS (Look for coordination/bots) ===
${socialSection}

=== ON-CHAIN DATA (Look for suspicious patterns) ===
${onChainSection}

=== HISTORICAL SCAM PATTERNS ===
${memorySection}

ADVERSARIAL ANALYSIS REQUIRED:

Think like someone trying to SCAM you:
1. If this were a pump and dump, what would the playbook look like?
2. Are there signs of coordinated promotion?
3. Does the timing seem suspicious?
4. Are the social signals organic or manufactured?
5. What would make this a honeypot or rug pull?
6. Does this match patterns of previous scams?

YOU MUST DETERMINE:
- isTrap: Is this likely a trap/scam? (true/false)
- trapConfidence: How confident are you it's a trap? (0-1)
- trapReasons: Specific reasons why you think it's a trap

Remember: Your 90%+ trapConfidence triggers an AUTOMATIC VETO.
Be thorough. Be paranoid. Protect the portfolio.

Include your complete chain of thought in the response.`;
  }

  /**
   * Determine importance level from signals
   */
  private getImportance(signals: InputSignals): "low" | "medium" | "high" {
    // High importance if:
    // - Multiple news sources
    // - High engagement social posts
    // - Target token specified
    
    if (signals.news.length >= 3 || signals.targetToken) {
      return "high";
    }
    
    if (signals.news.length >= 2 || signals.social.filter(s => s.isInfluencer).length > 0) {
      return "medium";
    }
    
    return "low";
  }

  /**
   * Check if this agent should veto the decision
   */
  hasVeto(opinion: AgentOpinionWithCoT): boolean {
    return opinion.isTrap === true && (opinion.trapConfidence || 0) >= 0.90;
  }
}
