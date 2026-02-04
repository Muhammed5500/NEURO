/**
 * Scout Agent
 * 
 * Analyzes news and social signals to identify opportunities and threats.
 * First-line analyst that gathers intelligence from external sources.
 */

import { BaseAgent, AGENT_RESPONSE_FORMAT } from "./base-agent.js";
import type { OrchestratorConfig } from "../config.js";
import type { InputSignals } from "../graph/state.js";

export class ScoutAgent extends BaseAgent {
  constructor(config: OrchestratorConfig) {
    super("scout", config);
  }

  protected buildSystemPrompt(_signals: InputSignals): string {
    return `You are the SCOUT AGENT in the NEURO multi-agent trading system.

Your role is to analyze NEWS and SOCIAL signals to identify:
1. Breaking news that could impact token prices
2. Influential social media posts and trends
3. Emerging narratives and memes
4. Early signs of coordinated promotion (potential pump schemes)
5. Sentiment shifts in the community

You specialize in:
- Speed: Identifying relevant information quickly
- Signal vs Noise: Filtering out irrelevant information
- Source credibility: Weighing information by source quality
- Narrative detection: Understanding the story being told

CRITICAL RULES:
1. Be skeptical of overly positive news without substance
2. Weight influencer posts by their track record
3. Look for coordinated posting patterns (possible manipulation)
4. Consider the timing of news relative to price movements
5. Note if multiple sources are reporting the same information

Your confidence score should reflect:
- High (0.8+): Multiple credible sources, clear narrative, verifiable facts
- Medium (0.5-0.8): Some credible sources, developing story
- Low (<0.5): Single source, unverified claims, suspicious timing

${AGENT_RESPONSE_FORMAT}`;
  }

  protected buildUserPrompt(signals: InputSignals, query: string): string {
    const newsSection = this.formatNewsSignals(signals);
    const socialSection = this.formatSocialSignals(signals);
    const memorySection = this.formatMemorySignals(signals);
    
    const targetInfo = signals.targetToken 
      ? `\nTarget Token: ${signals.targetToken.symbol} (${signals.targetToken.address})`
      : "";

    return `ANALYSIS REQUEST: ${query}${targetInfo}

=== NEWS SIGNALS ===
${newsSection}

=== SOCIAL SIGNALS ===
${socialSection}

=== HISTORICAL SIMILAR EVENTS ===
${memorySection}

Based on the above signals, provide your SCOUT analysis.

Think step by step:
1. What is the main narrative being pushed?
2. How credible are the sources?
3. Is there coordination or organic interest?
4. What does historical data suggest about similar situations?
5. What is your overall assessment?

Remember to include your complete chain of thought in the response.`;
  }
}
