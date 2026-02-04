# @neuro/sdk

TypeScript SDK for NEURO - Monad Mainnet (Chain ID: 143) integration.

## Installation

```bash
pnpm add @neuro/sdk
```

## Quick Start

```typescript
import { createNeuroClient } from "@neuro/sdk";

// Create client (connects to Monad Mainnet by default)
const client = createNeuroClient();

// Check connection
const status = await client.getChainStatus();
console.log("Connected:", status.connected);
console.log("Block:", status.blockNumber);

// Get trending tokens
const trending = await client.getTrendingTokens(10);
console.log("Trending tokens:", trending);

// Get token info
const token = await client.getToken("0x...");
console.log("Token:", token);
```

## Configuration

```typescript
const client = createNeuroClient({
  // Custom RPC URL (defaults to https://rpc.monad.xyz)
  rpcUrl: "https://your-rpc.com",
  
  // nad.fun API URL (defaults to https://api.nadapp.net)
  nadfunApiUrl: "https://api.nadapp.net",
  
  // API key for nad.fun (optional)
  nadfunApiKey: "your-api-key",
  
  // Private key for signing transactions (optional)
  privateKey: "0x...",
  
  // Gas buffer percentage (default: 15%)
  // IMPORTANT: Monad charges by gas LIMIT, not gas used
  gasBufferPercent: 15,
});
```

## Features

### Chain Status

```typescript
const status = await client.getChainStatus();
// { connected, chainId, blockNumber, gasPrice, latencyMs }
```

### Tokens

```typescript
// Get token info
const token = await client.getToken("0x...");

// Get trending tokens
const trending = await client.getTrendingTokens(20);

// Get new tokens
const newTokens = await client.getNewTokens(20);
```

### Trading

```typescript
// Get trade quote
const quote = await client.getQuote({
  tokenAddress: "0x...",
  amount: parseEther("0.1"),
}, true); // true = buy, false = sell
```

### Portfolio

```typescript
const portfolio = await client.getPortfolio("0x...");
// { address, tokens, totalValueUsd, totalValueMon }
```

### Balance

```typescript
const balance = await client.getBalance("0x...");
const formatted = await client.getBalanceFormatted("0x..."); // "1.5"
```

### Gas Estimation

```typescript
const gas = await client.estimateGas({
  to: "0x...",
  value: parseEther("0.1"),
});
// { gasLimit, gasLimitWithBuffer, gasCostMon }
```

## Events

```typescript
const unsubscribe = client.on((event) => {
  switch (event.type) {
    case "connected":
      console.log("Connected to chain:", event.chainId);
      break;
    case "blockNumber":
      console.log("New block:", event.blockNumber);
      break;
    case "error":
      console.error("Error:", event.error);
      break;
  }
});

// Later: unsubscribe
unsubscribe();
```

## Monad-Specific Notes

1. **Gas Calculation**: Monad charges based on GAS LIMIT, not gas used. The SDK automatically adds a 15% buffer to all gas estimates.

2. **Finality**: Economic finality on Monad is 800ms (2 blocks). Wait for this before confirming transactions.

3. **Storage Costs**: SLOAD-cold on Monad is 8100 gas (4x Ethereum). The SDK accounts for this in estimates.

## License

MIT
