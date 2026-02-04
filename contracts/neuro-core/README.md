# @neuro/contracts - neuro-core

Smart contracts for NEURO on Monad Mainnet (Chain ID: 143).

## Features

- **NeuroAgent**: Core agent contract with kill switch, operator management, and action execution
- **Kill Switch**: Emergency stop for all write operations
- **Operator/Treasury Separation**: Different wallets for daily operations vs. large holdings
- **Action Approval Flow**: Multi-step execution with owner approval

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Monad RPC access

## Installation

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies
forge install OpenZeppelin/openzeppelin-contracts
forge install foundry-rs/forge-std
```

## Build

```bash
forge build
```

## Test

```bash
# Run all tests
forge test

# Run with verbosity
forge test -vvv

# Run specific test
forge test --match-test test_ActivateKillSwitch

# Gas report
forge test --gas-report
```

## Deploy

```bash
# Set environment variables
export OPERATOR_WALLET_ADDRESS=0x...
export TREASURY_WALLET_ADDRESS=0x...
export DEPLOYER_PRIVATE_KEY=0x...
export MONAD_RPC_URL=https://rpc.monad.xyz

# Deploy to Monad Mainnet
forge script script/Deploy.s.sol --rpc-url $MONAD_RPC_URL --broadcast --verify

# Deploy to local
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
```

## Contracts

### NeuroAgent

Main agent contract implementing:

| Function | Access | Description |
|----------|--------|-------------|
| `activateKillSwitch(reason)` | Operator | Emergency stop |
| `deactivateKillSwitch()` | Owner | Resume operations |
| `setExecutionMode(mode)` | Owner | Switch READ_ONLY/WRITE_ENABLED |
| `proposeAction(...)` | Operator | Queue an action |
| `approveAction(actionId)` | Owner | Approve queued action |
| `executeAction(actionId)` | Operator | Execute approved action |

## Security

- Default execution mode: `READ_ONLY`
- Kill switch immediately pauses all operations
- Actions require owner approval before execution
- Maximum single transaction value limit

## EVM Version

All contracts compiled with EVM version `prague` (Pectra upgrade).

## License

MIT
