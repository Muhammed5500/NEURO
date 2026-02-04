# @neuro/execution

Blockchain execution service for NEURO - Monad Mainnet & nad.fun API integration.

## Features

- **Monad Client**: Viem-based client configured for Monad Mainnet (Chain ID: 143)
- **nad.fun Integration**: Full API client for token operations
- **Gas Calculator**: Monad-specific gas estimation with 15% safety buffer
- **Transaction Manager**: Transaction lifecycle with finality handling
- **Security Controls**: Kill switch, execution modes, and approval workflow

## Prerequisites

- Node.js 20+
- Monad RPC access
- nad.fun API access

## Installation

```bash
pnpm install
```

## Configuration

Set environment variables in `.env`:

```env
# Monad Mainnet
MONAD_RPC_URL=https://rpc.monad.xyz
MONAD_CHAIN_ID=143

# nad.fun API
NADFUN_API_URL=https://api.nadapp.net
NADFUN_API_KEY=your-api-key

# Security
EXECUTION_MODE=READ_ONLY
MANUAL_APPROVAL=true
KILL_SWITCH_ENABLED=false

# Wallets
OPERATOR_WALLET_ADDRESS=0x...
OPERATOR_PRIVATE_KEY=0x...
```

## Run Commands

```bash
# Development
pnpm dev

# Production
pnpm build
pnpm start

# Tests
pnpm test

# Type checking
pnpm typecheck
```

## Architecture

```
services/execution/
├── src/
│   ├── index.ts                 # Entry point
│   ├── config.ts                # Configuration
│   ├── client/
│   │   └── monad-client.ts      # Viem client for Monad
│   ├── gas/
│   │   └── gas-calculator.ts    # Monad gas calculation
│   ├── nadfun/
│   │   ├── nadfun-api.ts        # REST API client
│   │   └── nadfun-mainnet.ts    # Main integration
│   └── transactions/
│       └── transaction-manager.ts
└── README.md
```

## Monad-Specific Handling

### Gas Calculation

Monad charges based on GAS LIMIT, not gas used. All estimates include a 15% buffer:

```typescript
import { calculateGasWithBuffer } from "@neuro/shared";

const estimate = calculateGasWithBuffer(gasLimit, 15);
// estimate.gasLimitWithBuffer includes safety margin
```

### Economic Finality

Wait 800ms (2 blocks) before confirming transactions:

```typescript
import { waitForFinality } from "@neuro/shared";

await waitForFinality(); // 800ms delay
```

### Storage Costs

SLOAD-cold on Monad is 8100 gas (4x Ethereum). The gas calculator accounts for this.

## Security

- Default mode: `READ_ONLY` (all writes disabled)
- Manual approval required for all mainnet writes
- Kill switch instantly disables all write paths
