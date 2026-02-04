# NEURO Orchestrator

Multi-Agent Consensus Engine with LangGraph for autonomous decision-making.

## Overview

The orchestrator implements a **5-agent consensus system** where specialized AI agents analyze signals concurrently and produce a unified decision through a consensus mechanism.

```
                    ┌─────────────────┐
                    │  Input Signals  │
                    │  (news/social/  │
                    │   on-chain)     │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │  Scout   │  │  Macro   │  │ OnChain  │
        │  Agent   │  │  Agent   │  │  Agent   │
        └────┬─────┘  └────┬─────┘  └────┬─────┘
              │              │              │
              │    ┌──────────────┐        │
              │    │    Risk      │        │
              │    │    Agent     │        │
              │    └──────┬───────┘        │
              │           │                │
              │  ┌────────────────┐        │
              │  │  Adversarial   │        │
              │  │    Agent       │        │
              │  │  (Veto Power)  │        │
              │  └────────┬───────┘        │
              │           │                │
              └───────────┼────────────────┘
                          ▼
               ┌──────────────────┐
               │ Consensus Engine │
               │  (0.85 threshold)│
               └────────┬─────────┘
                        ▼
               ┌──────────────────┐
               │  Final Decision  │
               │ EXECUTE/REJECT/  │
               │ NEED_MORE_DATA   │
               └──────────────────┘
```

## Agents

### ScoutAgent
- **Role**: Analyzes news and social signals
- **Specialization**: Speed, signal vs noise, source credibility, narrative detection
- **Focus**: Breaking news, influencer posts, emerging trends, coordinated promotion detection

### MacroAgent
- **Role**: Analyzes broader market trends
- **Specialization**: Big picture thinking, correlation analysis, timing, risk environment
- **Focus**: BTC/ETH direction, Monad ecosystem health, memecoin seasons, volume trends

### OnChainAgent
- **Role**: Analyzes Monad mainnet data and nad.fun pools
- **Specialization**: Execution feasibility, liquidity analysis, gas optimization
- **Focus**: Gas prices, pool liquidity depth, holder distribution, bonding curve progress

### RiskAgent
- **Role**: Comprehensive risk assessment
- **Specialization**: Conservative voice, downside quantification, position sizing
- **Focus**: Market risk, execution risk, smart contract risk, information risk

### AdversarialAgent (Veto Power)
- **Role**: Critical evaluation, trap detection
- **Specialization**: Devil's advocate, scam detection
- **Focus**: Pump and dump, honeypots, manipulation, fake news
- **VETO POWER**: 90%+ trap confidence = automatic REJECT

## Consensus Rules

### Confidence Threshold (Turkish Rule 1)
> "Nihai karar (FINAL_DECISION), confidence_score ortalaması 0.85'in altındaysa asla EXECUTE olmamalı; sistem otomatik olarak REJECT veya NEED_MORE_DATA moduna geçmeli."

- **Threshold**: Average confidence must be ≥ 0.85 for EXECUTE
- **Below 0.5**: NEED_MORE_DATA
- **0.5-0.85**: MANUAL_REVIEW or REJECT

### Adversarial Veto (Turkish Rule 2)
> "Eğer AdversarialAgent (Eleştirel Ajan) %90 ve üzeri bir güvenle 'BU BİR TUZAK' diyorsa, diğer tüm ajanlar 'EVET' dese bile karar REJECT olmalı."

- **Veto Trigger**: trapConfidence ≥ 0.90
- **Result**: Automatic REJECT regardless of other agents
- **Rationale**: Includes trap reasons in decision

### Additional Rules
- **Risk Score**: Average risk > 0.7 = REJECT
- **Agreement**: Low agreement between agents = MANUAL_REVIEW
- **Hold/Avoid**: Majority recommending hold/avoid = REJECT

## Run Records (Deterministic Replay)

Every orchestrator run produces an immutable **Run Record** containing:

```typescript
interface RunRecord {
  id: string;
  version: string;
  inputs: {
    signals: InputSignals;
    query: string;
    config: ConsensusConfig;
  };
  agentOpinions: AgentOpinionWithCoT[];  // Chain of Thought included
  decision: FinalDecision;
  auditLog: AuditEntry[];
  checksum: string;  // For replay verification
}
```

**Chain of Thought Audit Trail** (Turkish Rule 4):
> "Her ajanın karara varırken kullandığı 'Düşünce Zinciri' (Chain of Thought) metni, Mainnet denetimi için run_record içinde saklanmalı."

## Quick Start

### Running with Fixtures

```bash
# Run with major news fixture
pnpm orchestrator:run -- --fixture major_news.json

# Run with trap test (should trigger adversarial veto)
pnpm orchestrator:run -- --fixture trap_test.json

# Custom query
pnpm orchestrator:run -- --fixture major_news.json --query "Should we buy PEPE?"

# Verbose output
pnpm orchestrator:run -- --fixture major_news.json --verbose
```

### Output Example

```
🧠 NEURO Orchestrator - Multi-Agent Consensus Engine

📥 Loaded fixture: major_news.json
❓ Query: Major news about Monad ecosystem - should we take action?
📰 News signals: 3
📱 Social signals: 3
⛓️  On-chain data: Yes
🧠 Memory items: 2
🎯 Target token: PEPE

⏳ Running multi-agent consensus...

================================================================================
                    NEURO CONSENSUS DECISION
================================================================================

✅ STATUS: EXECUTE
📊 RECOMMENDATION: BUY
🎯 CONFIDENCE: 87.2%
⚠️  RISK SCORE: 32.4%
🤝 AGREEMENT: 80.0%

🪙 TOKEN: PEPE (0x1234...)
💰 SUGGESTED AMOUNT: 0.15 MON
📈 SUGGESTED SLIPPAGE: 2%

📝 RATIONALE:
--------------------------------------------------------------------------------
EXECUTE approved with 87.2% confidence. Recommendation: BUY. Sentiment: bullish.
Key insights:
• [SCOUT] Strong influencer activity with credible sources
• [MACRO] Monad ecosystem showing healthy growth
• [ONCHAIN] Good liquidity depth, low gas
• [RISK] Acceptable risk/reward ratio
• [ADVERSARIAL] No trap indicators detected
--------------------------------------------------------------------------------

👥 AGENT OPINIONS:
  🟢 SCOUT        | buy        | Conf: 88% | Risk: 30%
  🟢 MACRO        | buy        | Conf: 86% | Risk: 28%
  🟢 ONCHAIN      | buy        | Conf: 89% | Risk: 32%
  🟢 RISK         | buy        | Conf: 85% | Risk: 38%
  🟢 ADVERSARIAL  | buy        | Conf: 88% | Risk: 34%

💾 RUN RECORD: a1b2c3d4-e5f6-...
   Checksum: 7f8e9d0c
   Duration: 4521ms

================================================================================
```

## Configuration

### Environment Variables

```bash
# LLM Configuration
LLM_PROVIDER=openai              # or "anthropic"
LLM_MODEL=gpt-4-turbo           # or "claude-3-opus"
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Consensus Thresholds
CONSENSUS_CONFIDENCE_THRESHOLD=0.85
ADVERSARIAL_VETO_THRESHOLD=0.90
CONSENSUS_AGREEMENT_THRESHOLD=0.60
MIN_AGENTS_FOR_CONSENSUS=3

# Storage
RUN_RECORD_PATH=./data/run_records

# Monad Network
MONAD_RPC_URL=https://rpc.monad.xyz
MONAD_CHAIN_ID=143
```

## API Usage

```typescript
import { 
  createAgentGraph, 
  runConsensusGraph,
  type InputSignals,
} from "@neuro/orchestrator";

// Create the graph
const graph = await createAgentGraph(config, {
  consensusConfig: {
    confidenceThreshold: 0.85,
    adversarialVetoThreshold: 0.90,
  },
});

// Prepare signals
const signals: InputSignals = {
  news: [...],
  social: [...],
  onchain: {...},
  memory: [...],
  targetToken: { address: "0x...", symbol: "PEPE" },
};

// Run consensus
const result = await runConsensusGraph(graph, {
  signals,
  query: "Should we buy this token?",
});

// Check result
if (result.decision?.status === "EXECUTE") {
  console.log("Execute approved!", result.decision);
} else {
  console.log("Decision:", result.decision?.status, result.decision?.rationale);
}

// Access run record for audit
console.log("Run ID:", result.runRecord?.id);
console.log("Agent Chain of Thought:", result.runRecord?.agentOpinions);
```

## Testing

```bash
# Run all tests
pnpm test

# Run consensus tests
pnpm test:consensus

# Type check
pnpm typecheck
```

## Directory Structure

```
services/orchestrator/
├── src/
│   ├── agents/           # AI agent implementations
│   │   ├── base-agent.ts
│   │   ├── scout-agent.ts
│   │   ├── macro-agent.ts
│   │   ├── onchain-agent.ts
│   │   ├── risk-agent.ts
│   │   └── adversarial-agent.ts
│   ├── consensus/        # Consensus engine
│   │   └── consensus-engine.ts
│   ├── graph/           # LangGraph definitions
│   │   ├── agent-graph.ts
│   │   ├── state.ts
│   │   └── nodes/
│   ├── storage/         # Run record storage
│   │   └── run-record-store.ts
│   ├── cli/             # CLI runner
│   │   └── runner.ts
│   └── tests/           # Tests
├── fixtures/            # Test fixtures
│   ├── major_news.json
│   └── trap_test.json
└── data/               # Run records (gitignored)
    └── run_records/
```

## License

MIT
