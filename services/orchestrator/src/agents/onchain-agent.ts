/**
 * OnChain Agent
 * 
 * Turkish: "OnChainAgent, Monad ana ağındaki güncel gaz fiyatlarını ve
 * nad.fun havuzlarındaki likidite derinliğini kontrol ederek karara girdi sağlamalı."
 * 
 * Analyzes on-chain data from Monad mainnet:
 * - Current gas prices and network congestion
 * - nad.fun pool liquidity depth (with bonding curve math)
 * - Bot activity detection (sandwich attacks, clustering)
 * - Token holder distribution and whale activity
 * 
 * Features:
 * - Read-only RPC client adapter (Monad)
 * - Cache layer with short TTL
 * - Capability flags for dev simulation
 * - BotRadar for competitor heuristics
 * - Price impact calculation using bonding curve math
 */

import { BaseAgent, AGENT_RESPONSE_FORMAT } from "./base-agent.js";
import type { OrchestratorConfig } from "../config.js";
import type { InputSignals, AgentOpinionWithCoT } from "../graph/state.js";
import { orchestratorLogger as logger } from "@neuro/shared";

import { 
  OnChainDataService, 
  createOnChainDataService,
  type OnChainAnalysis,
} from "../onchain/onchain-data-service.js";
import type { BotRadarResult, PriceImpact } from "../onchain/types.js";

const agentLogger = logger.child({ agent: "onchain" });

export class OnChainAgent extends BaseAgent {
  private dataService: OnChainDataService | null = null;
  private lastAnalysis: OnChainAnalysis | null = null;

  constructor(config: OrchestratorConfig) {
    super("onchain", config);
  }

  /**
   * Initialize the on-chain data service
   */
  initializeDataService(service?: OnChainDataService): void {
    this.dataService = service || createOnChainDataService();
    agentLogger.info({
      provider: this.dataService.getCapabilities(),
    }, "OnChainAgent data service initialized");
  }

  /**
   * Override analyze to fetch real on-chain data
   */
  async analyze(
    signals: InputSignals,
    query: string
  ): Promise<AgentOpinionWithCoT> {
    // Initialize data service if not already done
    if (!this.dataService) {
      this.initializeDataService();
    }

    // Fetch on-chain analysis if we have a target token
    if (signals.targetToken && this.dataService) {
      try {
        const tradeAmount = this.estimateTradeAmount(signals);
        this.lastAnalysis = await this.dataService.analyzeToken(
          signals.targetToken.address,
          tradeAmount
        );
        
        // Enrich signals with on-chain data
        signals = this.enrichSignalsWithAnalysis(signals, this.lastAnalysis);
      } catch (error) {
        agentLogger.warn({ error }, "Failed to fetch on-chain analysis, using provided signals");
      }
    }

    // Run the base analysis with enriched signals
    return super.analyze(signals, query);
  }

  /**
   * Enrich input signals with real on-chain data
   */
  private enrichSignalsWithAnalysis(
    signals: InputSignals,
    analysis: OnChainAnalysis
  ): InputSignals {
    return {
      ...signals,
      onchain: {
        gasPrice: analysis.network.gasPrice.toString(),
        gasPriceGwei: analysis.network.gasPriceGwei,
        blockNumber: Number(analysis.network.blockNumber),
        networkCongestion: analysis.network.congestionLevel,
        tokenAddress: analysis.pool?.tokenAddress,
        tokenSymbol: analysis.pool?.tokenSymbol,
        poolLiquidity: analysis.pool?.monReserve.toString(),
        poolLiquidityUsd: analysis.pool?.totalLiquidityUsd,
        volume24h: analysis.pool?.volume24h,
        holderCount: analysis.holders?.totalHolders,
        bondingCurveProgress: analysis.pool?.bondingCurveProgress,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Estimate trade amount based on signals
   */
  private estimateTradeAmount(signals: InputSignals): number {
    // Default small trade for analysis
    return 0.1; // 0.1 MON
  }

  protected buildSystemPrompt(_signals: InputSignals): string {
    // Include capability info if available
    const capabilitiesInfo = this.dataService 
      ? `\nPROVIDER CAPABILITIES:\n${JSON.stringify(this.dataService.getCapabilities(), null, 2)}`
      : "";

    return `You are the ON-CHAIN AGENT in the NEURO multi-agent trading system.

Your role is to analyze ON-CHAIN DATA from Monad mainnet and nad.fun:
1. Current gas prices and network congestion
2. nad.fun pool liquidity depth and health
3. Token holder distribution and whale activity
4. Bonding curve progress and graduation status
5. Transaction patterns and volume
6. Bot activity (sandwich attacks, frontrunning, clustering)
7. Price impact calculations

You specialize in:
- Execution feasibility: Can we actually execute at good prices?
- Liquidity analysis: Is there enough depth for our trade size?
- Gas optimization: Is now a good time for transactions?
- Smart money tracking: What are large wallets doing?
- Bot detection: Are bots active that could sandwich our trades?

CRITICAL RULES (Monad Mainnet specific):
1. Monad charges based on GAS LIMIT, not gas used - be conservative
2. SLOAD operations are expensive on Monad (8100 gas vs 2100 on Ethereum)
3. nad.fun bonding curve has specific graduation thresholds
4. Low liquidity = high slippage risk
5. Check holder concentration (top 10 wallets)
6. Recent large sells could indicate insider dumping

LIQUIDITY THRESHOLDS:
- Safe: >$10,000 USD liquidity for small trades (<$100)
- Caution: $1,000-$10,000 liquidity
- Dangerous: <$1,000 liquidity

GAS CONSIDERATIONS:
- Normal: <50 gwei
- Elevated: 50-100 gwei (wait if not urgent)
- High: >100 gwei (avoid unless critical)

BOT ACTIVITY ASSESSMENT:
- None: Safe to trade
- Low: Proceed with caution
- Medium: Use smaller trade sizes
- High: Consider waiting or using MEV protection
- Extreme: DO NOT TRADE

PRICE IMPACT THRESHOLDS:
- <0.5%: Low impact (safe)
- 0.5-1%: Medium impact
- 1-3%: High impact (reduce size)
- >3%: Extreme impact (do not proceed)

Your confidence score should reflect:
- High (0.8+): Good liquidity, low gas, healthy token metrics, no bot activity
- Medium (0.5-0.8): Adequate liquidity, some concerns
- Low (<0.5): Poor liquidity, high gas, suspicious patterns, or bot activity
${capabilitiesInfo}

${AGENT_RESPONSE_FORMAT}`;
  }

  protected buildUserPrompt(signals: InputSignals, query: string): string {
    const onChainSection = this.formatOnChainSignals(signals);
    const memorySection = this.formatMemorySignals(signals);
    
    const targetInfo = signals.targetToken 
      ? `\nTarget Token: ${signals.targetToken.symbol} (${signals.targetToken.address})`
      : "";

    // Include detailed analysis if available
    let detailedAnalysis = "";
    if (this.lastAnalysis) {
      detailedAnalysis = this.formatDetailedAnalysis(this.lastAnalysis);
    } else if (signals.onchain) {
      detailedAnalysis = `
=== QUICK METRICS ASSESSMENT ===
Gas Status: ${this.assessGas(signals.onchain.gasPriceGwei)}
Network Status: ${signals.onchain.networkCongestion.toUpperCase()}
Liquidity Status: ${this.assessLiquidity(signals.onchain.poolLiquidityUsd)}
Bonding Progress: ${signals.onchain.bondingCurveProgress || 0}% (${signals.onchain.bondingCurveProgress && signals.onchain.bondingCurveProgress > 80 ? 'NEAR GRADUATION' : 'not near graduation'})
`;
    }

    return `ANALYSIS REQUEST: ${query}${targetInfo}

=== ON-CHAIN DATA (Monad Mainnet) ===
${onChainSection}
${detailedAnalysis}

=== HISTORICAL ON-CHAIN PATTERNS ===
${memorySection}

Based on the above on-chain data, provide your ON-CHAIN analysis.

Think step by step:
1. Is the network in good condition for transactions?
2. Is there sufficient liquidity for our trade?
3. What is the expected price impact?
4. Is there suspicious bot activity?
5. What do holder patterns suggest?
6. Are there any red flags in the on-chain data?
7. What is your execution feasibility assessment?

Remember to include your complete chain of thought in the response.`;
  }

  /**
   * Format detailed on-chain analysis for the prompt
   */
  private formatDetailedAnalysis(analysis: OnChainAnalysis): string {
    const sections: string[] = [];

    sections.push("=== DETAILED ON-CHAIN ANALYSIS ===");
    sections.push(`Provider: ${analysis.providerUsed}`);
    sections.push(`Analyzed at: ${new Date(analysis.analyzedAt).toISOString()}`);

    // Network state
    sections.push("\n--- Network State ---");
    sections.push(`Block: ${analysis.network.blockNumber}`);
    sections.push(`Gas Price: ${analysis.network.gasPriceGwei.toFixed(2)} gwei`);
    sections.push(`Congestion: ${analysis.network.congestionLevel.toUpperCase()}`);

    // Pool data
    if (analysis.pool) {
      sections.push("\n--- Pool Liquidity ---");
      sections.push(`Total Liquidity: $${analysis.pool.totalLiquidityUsd.toLocaleString()}`);
      sections.push(`MON Reserve: ${(Number(analysis.pool.monReserve) / 1e18).toFixed(4)} MON`);
      sections.push(`Current Price: $${analysis.pool.currentPrice.toFixed(6)}`);
      sections.push(`Bonding Curve: ${analysis.pool.bondingCurveProgress.toFixed(1)}%`);
      sections.push(`Graduated: ${analysis.pool.isGraduated ? "YES" : "NO"}`);
      sections.push(`24h Volume: $${analysis.pool.volume24h.toLocaleString()}`);
    }

    // Price impact
    if (analysis.priceImpact) {
      sections.push("\n--- Price Impact Analysis ---");
      sections.push(`Trade Amount: ${analysis.priceImpact.tradeAmountMon} MON`);
      sections.push(`Impact: ${analysis.priceImpact.priceImpactPercent.toFixed(2)}%`);
      sections.push(`Warning Level: ${analysis.priceImpact.warningLevel.toUpperCase()}`);
      if (analysis.priceImpact.warningMessage) {
        sections.push(`⚠️ ${analysis.priceImpact.warningMessage}`);
      }
    }

    // Bot radar
    if (analysis.botRadar) {
      sections.push("\n--- Bot Radar Analysis ---");
      sections.push(`Activity Level: ${analysis.botRadar.botActivityLevel.toUpperCase()}`);
      sections.push(`Risk Score: ${(analysis.botRadar.riskScore * 100).toFixed(0)}%`);
      sections.push(`Transactions Analyzed: ${analysis.botRadar.totalTransactions}`);
      sections.push(`Sandwich Attacks: ${analysis.botRadar.potentialSandwichCount}`);
      sections.push(`Bot Clusters: ${analysis.botRadar.botClusterCount}`);
      if (analysis.botRadar.recommendations.length > 0) {
        sections.push("Bot Radar Recommendations:");
        analysis.botRadar.recommendations.forEach(rec => {
          sections.push(`  • ${rec}`);
        });
      }
    }

    // Holders
    if (analysis.holders) {
      sections.push("\n--- Holder Analysis ---");
      sections.push(`Total Holders: ${analysis.holders.totalHolders}`);
      sections.push(`Top 10 Hold: ${analysis.holders.top10HoldersPercent.toFixed(1)}%`);
      sections.push(`Distribution: ${analysis.holders.distributionHealth.toUpperCase()}`);
      sections.push(`Risk Level: ${analysis.holders.riskLevel.toUpperCase()}`);
    }

    // Summary
    sections.push("\n--- Overall Assessment ---");
    sections.push(`Good Time to Trade: ${analysis.summary.isGoodTimeToTrade ? "✅ YES" : "❌ NO"}`);
    sections.push(`Overall Risk: ${analysis.summary.overallRisk.toUpperCase()}`);
    sections.push(`Liquidity: ${analysis.summary.liquidityStatus.toUpperCase()}`);
    sections.push(`Gas: ${analysis.summary.gasStatus.toUpperCase()}`);
    sections.push(`Bot Activity: ${analysis.summary.botActivityStatus.toUpperCase()}`);
    
    if (analysis.summary.recommendations.length > 0) {
      sections.push("Recommendations:");
      analysis.summary.recommendations.forEach(rec => {
        sections.push(`  • ${rec}`);
      });
    }

    return sections.join("\n");
  }

  private assessGas(gasPriceGwei: number): string {
    if (gasPriceGwei < 50) return `NORMAL (${gasPriceGwei.toFixed(1)} gwei) - Good for transactions`;
    if (gasPriceGwei < 100) return `ELEVATED (${gasPriceGwei.toFixed(1)} gwei) - Consider waiting`;
    return `HIGH (${gasPriceGwei.toFixed(1)} gwei) - Avoid unless urgent`;
  }

  private assessLiquidity(liquidityUsd?: number): string {
    if (!liquidityUsd) return "UNKNOWN - Unable to assess";
    if (liquidityUsd > 10000) return `SAFE ($${liquidityUsd.toLocaleString()}) - Good depth`;
    if (liquidityUsd > 1000) return `CAUTION ($${liquidityUsd.toLocaleString()}) - Moderate slippage expected`;
    return `DANGEROUS ($${liquidityUsd.toLocaleString()}) - High slippage risk`;
  }
}
