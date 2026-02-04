/**
 * CLI Runner
 * 
 * Runs the orchestrator with fixture files for testing.
 * Usage: pnpm orchestrator:run -- --fixture major_news.json
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import { loadOrchestratorConfig } from "../config.js";
import { createAgentGraph, runConsensusGraph } from "../graph/agent-graph.js";
import type { InputSignals } from "../graph/state.js";
import fs from "fs/promises";
import path from "path";

// ============================================
// CLI ARGUMENTS
// ============================================

interface CliArgs {
  fixture?: string;
  query?: string;
  runId?: string;
  verbose?: boolean;
  outputDir?: string;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    
    if (arg === "--fixture" || arg === "-f") {
      args.fixture = argv[++i];
    } else if (arg === "--query" || arg === "-q") {
      args.query = argv[++i];
    } else if (arg === "--run-id" || arg === "-r") {
      args.runId = argv[++i];
    } else if (arg === "--verbose" || arg === "-v") {
      args.verbose = true;
    } else if (arg === "--output-dir" || arg === "-o") {
      args.outputDir = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
NEURO Orchestrator Runner

Usage:
  pnpm orchestrator:run -- [options]

Options:
  -f, --fixture <path>    Load signals from fixture file (JSON)
  -q, --query <text>      Query/task to analyze
  -r, --run-id <id>       Custom run ID (default: auto-generated)
  -v, --verbose           Enable verbose logging
  -o, --output-dir <dir>  Output directory for run records
  -h, --help              Show this help message

Examples:
  pnpm orchestrator:run -- --fixture fixtures/major_news.json
  pnpm orchestrator:run -- --fixture fixtures/pump_signal.json --query "Should we buy?"
  pnpm orchestrator:run -- --fixture fixtures/trap_test.json --verbose
`);
}

// ============================================
// FIXTURE LOADING
// ============================================

async function loadFixture(fixturePath: string): Promise<InputSignals> {
  // Try multiple paths
  const searchPaths = [
    fixturePath,
    path.join(process.cwd(), fixturePath),
    path.join(process.cwd(), "services/orchestrator/fixtures", fixturePath),
    path.join(process.cwd(), "fixtures", fixturePath),
  ];

  let content: string | null = null;
  let loadedPath: string | null = null;

  for (const searchPath of searchPaths) {
    try {
      content = await fs.readFile(searchPath, "utf-8");
      loadedPath = searchPath;
      break;
    } catch {
      // Continue to next path
    }
  }

  if (!content || !loadedPath) {
    throw new Error(`Fixture not found: ${fixturePath}`);
  }

  logger.info({ path: loadedPath }, "Loaded fixture file");

  const fixture = JSON.parse(content);

  // Validate fixture structure
  if (!fixture.news && !fixture.social && !fixture.onchain && !fixture.memory) {
    throw new Error("Invalid fixture: must contain at least one signal type (news, social, onchain, memory)");
  }

  return {
    news: fixture.news || [],
    social: fixture.social || [],
    onchain: fixture.onchain || null,
    memory: fixture.memory || [],
    query: fixture.query,
    targetToken: fixture.targetToken,
  };
}

// ============================================
// OUTPUT FORMATTING
// ============================================

function formatDecision(state: Awaited<ReturnType<typeof runConsensusGraph>>): void {
  console.log("\n" + "=".repeat(80));
  console.log("                    NEURO CONSENSUS DECISION");
  console.log("=".repeat(80) + "\n");

  if (state.error) {
    console.log("❌ ERROR:", state.error);
    return;
  }

  const decision = state.decision;
  if (!decision) {
    console.log("❌ No decision produced");
    return;
  }

  // Status with emoji
  const statusEmoji: Record<string, string> = {
    EXECUTE: "✅",
    REJECT: "❌",
    NEED_MORE_DATA: "🔍",
    MANUAL_REVIEW: "👀",
  };

  console.log(`${statusEmoji[decision.status] || "❓"} STATUS: ${decision.status}`);
  console.log(`📊 RECOMMENDATION: ${decision.recommendation.toUpperCase()}`);
  console.log(`🎯 CONFIDENCE: ${(decision.confidence * 100).toFixed(1)}%`);
  console.log(`⚠️  RISK SCORE: ${(decision.averageRiskScore * 100).toFixed(1)}%`);
  console.log(`🤝 AGREEMENT: ${(decision.agreementScore * 100).toFixed(1)}%`);

  if (decision.adversarialVeto) {
    console.log("\n🚨 ADVERSARIAL VETO TRIGGERED!");
    console.log(`   Reason: ${decision.vetoReason}`);
  }

  if (decision.tokenSymbol) {
    console.log(`\n🪙 TOKEN: ${decision.tokenSymbol} (${decision.tokenAddress})`);
  }

  if (decision.suggestedAmount) {
    const amountMon = parseInt(decision.suggestedAmount) / 1e18;
    console.log(`💰 SUGGESTED AMOUNT: ${amountMon.toFixed(4)} MON`);
    console.log(`📈 SUGGESTED SLIPPAGE: ${decision.suggestedSlippage}%`);
  }

  console.log("\n📝 RATIONALE:");
  console.log("-".repeat(80));
  console.log(decision.rationale);
  console.log("-".repeat(80));

  // Agent summary
  console.log("\n👥 AGENT OPINIONS:");
  for (const opinion of state.agentOpinions) {
    const emoji = opinion.sentiment === "bullish" ? "🟢" : 
                  opinion.sentiment === "bearish" ? "🔴" : "🟡";
    console.log(`  ${emoji} ${opinion.role.toUpperCase().padEnd(12)} | ` +
                `${opinion.recommendation.padEnd(10)} | ` +
                `Conf: ${(opinion.confidenceScore * 100).toFixed(0)}% | ` +
                `Risk: ${(opinion.riskScore * 100).toFixed(0)}%`);
    
    if (opinion.role === "adversarial" && opinion.isTrap) {
      console.log(`     🚨 TRAP DETECTED: ${(opinion.trapConfidence! * 100).toFixed(0)}% confidence`);
    }
  }

  // Run record info
  if (state.runRecord) {
    console.log(`\n💾 RUN RECORD: ${state.runRecord.id}`);
    console.log(`   Checksum: ${state.runRecord.checksum}`);
    console.log(`   Duration: ${state.runRecord.totalDurationMs}ms`);
  }

  console.log("\n" + "=".repeat(80) + "\n");
}

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.fixture) {
    console.error("Error: --fixture is required\n");
    printHelp();
    process.exit(1);
  }

  console.log("\n🧠 NEURO Orchestrator - Multi-Agent Consensus Engine\n");

  // Load config
  const config = loadOrchestratorConfig();
  logger.info({ llmProvider: config.llmProvider }, "Configuration loaded");

  // Load fixture
  const signals = await loadFixture(args.fixture);
  const query = args.query || signals.query || "Analyze this opportunity and recommend action";

  console.log(`📥 Loaded fixture: ${args.fixture}`);
  console.log(`❓ Query: ${query}`);
  console.log(`📰 News signals: ${signals.news.length}`);
  console.log(`📱 Social signals: ${signals.social.length}`);
  console.log(`⛓️  On-chain data: ${signals.onchain ? "Yes" : "No"}`);
  console.log(`🧠 Memory items: ${signals.memory.length}`);

  if (signals.targetToken) {
    console.log(`🎯 Target token: ${signals.targetToken.symbol}`);
  }

  console.log("\n⏳ Running multi-agent consensus...\n");

  // Create graph
  const graph = await createAgentGraph(config, {
    runRecordPath: args.outputDir,
  });

  // Run consensus
  const result = await runConsensusGraph(graph, {
    signals,
    query,
    runId: args.runId,
  });

  // Output results
  formatDecision(result);

  // Exit with appropriate code
  if (result.error) {
    process.exit(1);
  }
  
  if (result.decision?.status === "REJECT") {
    process.exit(2);
  }

  process.exit(0);
}

// Run
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
