# @neuro/shared

Shared utilities, schemas, security policies, and logging for NEURO.

## Features

- **Constants**: Monad Mainnet configuration, nad.fun API endpoints
- **Schemas**: Zod validation schemas for all data types
- **Security**: Kill switch, execution modes, gas calculation
- **Logger**: Pino-based structured logging
- **Types**: TypeScript type definitions

## Installation

```bash
pnpm install
```

## Exports

```typescript
// All exports
import { ... } from "@neuro/shared";

// Specific exports
import { ... } from "@neuro/shared/schemas";
import { ... } from "@neuro/shared/security";
import { ... } from "@neuro/shared/logger";
import { ... } from "@neuro/shared/constants";
```

## Constants

```typescript
import { MONAD_MAINNET, NADFUN_API, GAS_CONFIG, FINALITY } from "@neuro/shared";

// Monad Mainnet (Chain ID: 143)
MONAD_MAINNET.chainId     // 143
MONAD_MAINNET.rpcUrl      // "https://rpc.monad.xyz"

// nad.fun API
NADFUN_API.baseUrl        // "https://api.nadapp.net"

// Gas (Monad-specific)
GAS_CONFIG.sloadCold      // 8100n (4x Ethereum)
GAS_CONFIG.defaultBufferPercentage // 15

// Finality
FINALITY.waitMs           // 800 (2 blocks)
```

## Schemas

```typescript
import { tokenSchema, transactionRequestSchema, envSchema } from "@neuro/shared";

// Validate token
const token = tokenSchema.parse(data);

// Validate environment
const env = envSchema.parse(process.env);
```

## Security

```typescript
import {
  activateKillSwitch,
  deactivateKillSwitch,
  isKillSwitchActive,
  canWrite,
  calculateGasWithBuffer,
} from "@neuro/shared";

// Kill switch
activateKillSwitch("admin", "Emergency");
if (isKillSwitchActive()) {
  // All writes blocked
}

// Check if writes allowed
if (canWrite()) {
  // Proceed with transaction
}

// Gas calculation (Monad charges by gas limit)
const estimate = calculateGasWithBuffer(100000n, 15);
// estimate.gasLimitWithBuffer = 115000n
```

## Logger

```typescript
import { logger, createServiceLogger, audit } from "@neuro/shared";

// Basic logging
logger.info("Message");
logger.error({ error }, "Failed");

// Service-specific
const myLogger = createServiceLogger("my-service");
myLogger.info("Service started");

// Audit logging
audit({
  action: "APPROVE_TRANSACTION",
  entityType: "transaction",
  entityId: "tx-123",
  actor: "admin@neuro",
});
```

## Architecture

```
packages/shared/
├── src/
│   ├── index.ts           # Main exports
│   ├── constants/
│   │   └── index.ts       # Monad, nad.fun configs
│   ├── logger/
│   │   └── index.ts       # Pino logger
│   ├── schemas/
│   │   └── index.ts       # Zod schemas
│   ├── security/
│   │   └── index.ts       # Kill switch, gas calc
│   └── types/
│       └── index.ts       # TypeScript types
└── README.md
```
