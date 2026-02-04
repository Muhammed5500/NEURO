/**
 * Risk Agent
 * 
 * Comprehensive risk assessment across all dimensions.
 * Acts as the risk management function in the multi-agent system.
 */

import { BaseAgent, AGENT_RESPONSE_FORMAT } from "./base-agent.js";
import type { OrchestratorConfig } from "../config.js";
import type { InputSignals } from "../graph/state.js";

export class RiskAgent extends BaseAgent {
  constructor(config: OrchestratorConfig) {
    super("risk", config);
  }

  protected buildSystemPrompt(_signals: InputSignals): string {
    return `You are the RISK AGENT in the NEURO multi-agent trading system.

Your role is to provide COMPREHENSIVE RISK ASSESSMENT:
1. Market risk: Volatility, liquidity, correlation
2. Execution risk: Slippage, gas, timing
3. Smart contract risk: Rug pull indicators, contract safety
4. Information risk: Fake news, manipulation, FUD
5. Position sizing risk: Appropriate trade size for conditions

You are the CONSERVATIVE voice in the system. Your job is to:
- Identify risks others might miss
- Quantify potential downsides
- Suggest risk mitigation measures
- Recommend appropriate position sizes
- Flag when risk/reward is unfavorable

RISK FACTORS TO ALWAYS CONSIDER:
1. Token age (newer = higher risk)
2. Team doxxed status
3. Liquidity lock status
4. Contract verification
5. Holder concentration
6. Social proof authenticity
7. Historical rug patterns
8. Market timing risk

POSITION SIZING RULES:
- Maximum 2% of portfolio on any single trade
- Reduce size with higher risk scores
- Never exceed $1 MON on unverified tokens
- Consider slippage in position planning

Your confidence score reflects certainty in risk assessment:
- High (0.8+): Clear risk picture, well-documented factors
- Medium (0.5-0.8): Some uncertainty in risk factors
- Low (<0.5): Unable to fully assess risks

Your RISK SCORE (0-1) represents overall danger:
- 0.0-0.3: Low risk (rare for memecoins)
- 0.3-0.5: Moderate risk (proceed with caution)
- 0.5-0.7: High risk (reduce position or avoid)
- 0.7-1.0: Extreme risk (strong avoid recommendation)

${AGENT_RESPONSE_FORMAT}`;
  }

  protected buildUserPrompt(signals: InputSignals, query: string): string {
    const newsSection = this.formatNewsSignals(signals);
    const socialSection = this.formatSocialSignals(signals);
    const onChainSection = this.formatOnChainSignals(signals);
    const memorySection = this.formatMemorySignals(signals);
    
    const targetInfo = signals.targetToken 
      ? `\nTarget Token: ${signals.targetToken.symbol} (${signals.targetToken.address})`
      : "";

    return `RISK ASSESSMENT REQUEST: ${query}${targetInfo}

=== NEWS SIGNALS ===
${newsSection}

=== SOCIAL SIGNALS ===
${socialSection}

=== ON-CHAIN DATA ===
${onChainSection}

=== HISTORICAL RISK PATTERNS ===
${memorySection}

Based on ALL available data, provide your RISK assessment.

Think step by step:
1. What are the primary risk factors?
2. What is the worst-case scenario?
3. What is the probability of significant loss?
4. What position size would be appropriate?
5. What risk mitigation measures should be taken?

IMPORTANT: You must produce a comprehensive riskFactors array covering:
- liquidity_risk
- volatility_risk
- manipulation_risk
- smart_contract_risk
- timing_risk

Your riskScore should be calculated based on weighted average of all factors.

Remember to include your complete chain of thought in the response.`;
  }
}
