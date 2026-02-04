/**
 * Monad Mainnet Client
 * Viem-based client for Monad blockchain interaction
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  webSocket,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Transport,
  type Account,
  type Address,
  parseGwei,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MONAD_MAINNET, executionLogger as logger } from "@neuro/shared";
import type { ExecutionConfig } from "../config.js";

// ============================================
// MONAD MAINNET CHAIN DEFINITION
// ============================================

export const monadMainnet: Chain = {
  id: MONAD_MAINNET.chainId,
  name: MONAD_MAINNET.name,
  nativeCurrency: MONAD_MAINNET.nativeCurrency,
  rpcUrls: {
    default: {
      http: [MONAD_MAINNET.rpcUrl],
      webSocket: [MONAD_MAINNET.rpcUrlWs],
    },
    public: {
      http: [MONAD_MAINNET.rpcUrl],
      webSocket: [MONAD_MAINNET.rpcUrlWs],
    },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url: MONAD_MAINNET.blockExplorer,
    },
  },
  contracts: {},
};

// ============================================
// CLIENT TYPES
// ============================================

export interface MonadClient {
  public: PublicClient<Transport, Chain>;
  wallet?: WalletClient<Transport, Chain, Account>;
  account?: Account;
  config: ExecutionConfig;
}

// ============================================
// CLIENT CREATION
// ============================================

/**
 * Creates a Monad Mainnet client with public and optional wallet clients
 */
export function createMonadClient(config: ExecutionConfig): MonadClient {
  // Create public client for read operations
  const publicClient = createPublicClient({
    chain: monadMainnet,
    transport: http(config.rpcUrl, {
      batch: true,
      retryCount: 3,
      retryDelay: 1000,
    }),
  });

  let walletClient: WalletClient<Transport, Chain, Account> | undefined;
  let account: Account | undefined;

  // Create wallet client only if private key is provided
  // AND execution mode allows writes
  if (config.operatorPrivateKey && config.executionMode === "WRITE_ENABLED") {
    account = privateKeyToAccount(config.operatorPrivateKey as `0x${string}`);
    
    walletClient = createWalletClient({
      account,
      chain: monadMainnet,
      transport: http(config.rpcUrl, {
        batch: true,
        retryCount: 3,
        retryDelay: 1000,
      }),
    });

    logger.info({ address: account.address }, "Wallet client initialized");
  } else {
    logger.info("Running in READ-ONLY mode - no wallet client initialized");
  }

  return {
    public: publicClient,
    wallet: walletClient,
    account,
    config,
  };
}

/**
 * Creates a WebSocket client for real-time subscriptions
 */
export function createMonadWsClient(config: ExecutionConfig): PublicClient<Transport, Chain> {
  return createPublicClient({
    chain: monadMainnet,
    transport: webSocket(config.rpcUrlWs, {
      retryCount: 5,
      retryDelay: 2000,
    }),
  });
}

// ============================================
// CLIENT UTILITIES
// ============================================

/**
 * Gets the current block number
 */
export async function getBlockNumber(client: MonadClient): Promise<bigint> {
  return client.public.getBlockNumber();
}

/**
 * Gets the balance of an address
 */
export async function getBalance(
  client: MonadClient,
  address: Address
): Promise<bigint> {
  return client.public.getBalance({ address });
}

/**
 * Gets the current gas price
 */
export async function getGasPrice(client: MonadClient): Promise<bigint> {
  return client.public.getGasPrice();
}

/**
 * Checks if gas price is within acceptable limits
 */
export async function isGasPriceAcceptable(
  client: MonadClient,
  maxGwei: number = client.config.maxGasPriceGwei
): Promise<boolean> {
  const currentGasPrice = await getGasPrice(client);
  const maxGasPrice = parseGwei(maxGwei.toString());
  return currentGasPrice <= maxGasPrice;
}

/**
 * Gets the transaction count (nonce) for an address
 */
export async function getNonce(
  client: MonadClient,
  address: Address
): Promise<number> {
  return client.public.getTransactionCount({ address });
}

/**
 * Waits for a transaction to be confirmed
 */
export async function waitForTransaction(
  client: MonadClient,
  hash: `0x${string}`,
  confirmations: number = client.config.finalityBlocks
): Promise<{
  status: "success" | "reverted";
  blockNumber: bigint;
  gasUsed: bigint;
}> {
  const receipt = await client.public.waitForTransactionReceipt({
    hash,
    confirmations,
  });

  return {
    status: receipt.status,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };
}

/**
 * Validates that the client is connected to Monad Mainnet
 */
export async function validateConnection(client: MonadClient): Promise<void> {
  const chainId = await client.public.getChainId();
  
  if (chainId !== MONAD_MAINNET.chainId) {
    throw new Error(
      `Invalid chain ID. Expected ${MONAD_MAINNET.chainId} (Monad Mainnet), got ${chainId}`
    );
  }

  logger.info({ chainId }, "Connected to Monad Mainnet");
}
