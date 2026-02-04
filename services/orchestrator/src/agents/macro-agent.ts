/**
 * Macro Agent
 * 
 * Analyzes broader market trends and macro conditions.
 * Provides context on overall market sentiment and timing.
 */

import { BaseAgent, AGENT_RESPONSE_FORMAT } from "./base-agent.js";
import type { OrchestratorConfig } from "../config.js";
import type { InputSignals } from "../graph/state.js";

export class MacroAgent extends BaseAgent {
  constructor(config: OrchestratorConfig) {
    super("macro", config);
  }

  protected buildSystemPrompt(_signals: InputSignals): string {
    return `You are the MACRO AGENT in the NEURO multi-agent trading system.

Your role is to analyze MACRO MARKET CONDITIONS and provide context:
1. Overall crypto market sentiment (BTC, ETH trends)
2. Monad ecosystem health and activity
3. DeFi/Memecoin sector conditions
4. Volume and liquidity trends
5. Market cycle positioning (accumulation, markup, distribution, markdown)

You specialize in:
- Big picture thinking: Understanding market phases
- Correlation analysis: How tokens move together
- Timing: When conditions favor action vs waiting
- Risk environment: High volatility vs stability periods

CRITICAL RULES:
1. Consider Bitcoin and ETH direction as leading indicators
2. Monad-specific factors matter (new chain, growing ecosystem)
3. Memecoin seasons vs risk-off periods
4. Weekend vs weekday liquidity differences
5. Time zone considerations for trading activity

Your confidence score should reflect:
- High (0.8+): Clear market trend, strong confirmation signals
- Medium (0.5-0.8): Mixed signals, uncertain direction
- Low (<0.5): Choppy markets, no clear trend

${AGENT_RESPONSE_FORMAT}`;
  }

  protected buildUserPrompt(signals: InputSignals, query: string): string {
    const onChainSection = this.formatOnChainSignals(signals);
    const newsSection = this.formatNewsSignals(signals);
    const memorySection = this.formatMemorySignals(signals);
    
    const targetInfo = signals.targetToken 
      ? `\nTarget Token: ${signals.targetToken.symbol} (${signals.targetToken.address})`
      : "";

    return `ANALYSIS REQUEST: ${query}${targetInfo}

=== ON-CHAIN DATA (Monad Network) ===
${onChainSection}

=== MARKET NEWS ===
${newsSection}

=== HISTORICAL CONTEXT ===
${memorySection}

Based on the above data, provide your MACRO analysis.

Think step by step:
1. What is the current market environment?
2. Is this a good time to take risk or be defensive?
3. How does Monad/nad.fun activity look?
4. What macro factors could impact this decision?
5. What is your overall timing assessment?

Remember to include your complete chain of thought in the response.`;
  }
}
