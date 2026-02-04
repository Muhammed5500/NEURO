# NEURO - Autonomous AI Agent for Monad MAINNET

NEURO is an autonomous AI agent that launches and manages tokens on nad.fun, running on **Monad Mainnet (Chain ID: 143)**.

## Architecture

```
neuro-monad/
├── apps/
│   └── dashboard/          # Next.js + Tailwind (Cyberpunk UI)
├── contracts/
│   └── neuro-core/         # Foundry smart contracts
├── packages/
│   ├── sdk/                # TypeScript client + types
│   └── shared/             # Zod schemas, security, logging
├── services/
│   ├── execution/          # TypeScript/Viem - nad.fun Mainnet API
│   ├── ingestion/          # Rust/Tokio - High-speed Data Harvesting
│   ├── memory/             # Vector DB adapter + embeddings
│   ├── orchestrator/       # TypeScript/LangGraph - AI Decision Making
│   └── verification/       # Cross-check agent services
└── scripts/                # Database initialization, utilities
```

## Critical Technical Constraints (Monad Specific)

### Gas Model
Monad charges based on **GAS LIMIT**, not gas used. All execution modules include a 10-15% safety buffer to prevent failed transactions.

### Storage Costs
SLOAD-cold is **8100 gas** (4x higher than Ethereum). Storage access is optimized accordingly.

### Finality
Wait for **800ms (2 blocks)** for "Economic Finality" before confirming financial actions to the UI.

### EVM Version
All contracts use **Prague (Pectra)** EVM version.

## Security Controls

| Control | Default | Description |
|---------|---------|-------------|
| `EXECUTION_MODE` | `READ_ONLY` | Prevents all write operations |
| `MANUAL_APPROVAL` | `true` | Requires human approval for mainnet writes |
| `KILL_SWITCH` | `false` | Emergency stop for all write paths |
| `MAX_SINGLE_TX_VALUE` | `1.0 MON` | Maximum value per transaction |

### Wallet Separation
- **Operator Wallet**: Daily operations, limited funds
- **Treasury Wallet**: Cold storage, large holdings (multi-sig recommended)

## Quick Start

### Prerequisites
- Node.js 20+
- pnpm 9+
- Rust 1.75+ (for ingestion service)
- Foundry (for smart contracts)
- Docker & Docker Compose

### Installation

```bash
# Clone and install dependencies
cd neuro-monad
pnpm install

# Copy environment configuration
cp .env.example .env
# Edit .env with your configuration

# Start infrastructure
docker-compose up -d

# Build all packages
pnpm build
```

### Development

```bash
# Run all services in development mode
pnpm dev

# Run individual services
pnpm dev:dashboard      # Dashboard on http://localhost:3000
pnpm dev:orchestrator   # AI Orchestrator
pnpm dev:execution      # Execution Service
pnpm dev:memory         # Memory Service
pnpm dev:verification   # Verification Service
pnpm dev:ingestion      # Rust Ingestion Service

# Or use Make
make dev
make dev-dashboard
```

### Production

```bash
# Build for production
pnpm build

# Start services
pnpm start
```

### Testing

```bash
# Run all tests
pnpm test

# Test specific components
make test-ts         # TypeScript tests
make test-rust       # Rust tests  
make test-contracts  # Smart contract tests
```

### Smart Contracts

```bash
# Build contracts
make contracts-build

# Test contracts
make contracts-test

# Deploy (local)
make contracts-deploy-local
```

## Configuration

See `.env.example` for all configuration options. Key settings:

```env
# Monad Mainnet
MONAD_CHAIN_ID=143
MONAD_RPC_URL=https://rpc.monad.xyz

# nad.fun API
NADFUN_API_URL=https://api.nadapp.net

# Security (DO NOT CHANGE IN PRODUCTION)
EXECUTION_MODE=READ_ONLY
MANUAL_APPROVAL=true
```

## API Endpoints

### nad.fun Mainnet API
Base URL: `https://api.nadapp.net`

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/market/trending` | Trending tokens |
| `GET /api/v1/market/new` | New token launches |
| `GET /api/v1/tokens/address/{addr}` | Token by address |
| `POST /api/v1/trade/quote` | Get trade quote |
| `POST /api/v1/launch` | Prepare token launch |

## Services

### Dashboard (`apps/dashboard`)
Next.js 15 application with:
- Real-time system monitoring
- Manual approval queue
- Kill switch control
- Market overview
- Activity feed

### Orchestrator (`services/orchestrator`)
LangGraph-based AI agent:
- Market analysis
- Trading decisions
- Risk assessment
- Approval workflow

### Execution (`services/execution`)
Blockchain interaction:
- nad.fun API integration
- Transaction management
- Gas calculation with Monad buffers
- Finality handling

### Ingestion (`services/ingestion`)
Rust service for:
- Real-time market data
- Token monitoring
- News aggregation

## Security

### Kill Switch
Immediately disables all write operations:

```typescript
import { activateKillSwitch } from "@neuro/shared";

activateKillSwitch("operator@neuro", "Security incident detected");
```

### Manual Approval Flow
1. AI proposes action
2. Action queued for approval
3. Operator reviews in dashboard
4. Approve or reject
5. If approved, execution proceeds

## License

MIT
