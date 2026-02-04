/**
 * Simulation Provider
 * 
 * Mock implementation of OnChainDataProvider for development.
 * Allows the agent to run in dev with simulated data.
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { 
  OnChainDataProvider, 
  MulticallRequest,
} from "./monad-rpc-client.js";
import type { 
  ProviderCapabilities, 
  NetworkState,
  PoolLiquidity,
  HolderAnalysis,
  TransactionPattern,
} from "./types.js";

const simLogger = logger.child({ component: "simulation-provider" });

// ============================================
// SIMULATION SCENARIOS
// ============================================

export interface SimulationScenario {
  name: string;
  description: string;
  networkState: Partial<NetworkState>;
  pools: Record<string, Partial<PoolLiquidity>>;
  transactions?: TransactionPattern[];
  holderData?: Partial<HolderAnalysis>;
}

export const SIMULATION_SCENARIOS: Record<string, SimulationScenario> = {
  HEALTHY_MARKET: {
    name: "Healthy Market",
    description: "Normal market conditions with good liquidity",
    networkState: {
      gasPriceGwei: 25,
      congestionLevel: "low",
    },
    pools: {
      default: {
        totalLiquidityUsd: 50000,
        bondingCurveProgress: 45,
        isGraduated: false,
        volume24h: 25000,
        currentPrice: 0.001,
      },
    },
    holderData: {
      totalHolders: 1500,
      top10HoldersPercent: 35,
      distributionHealth: "healthy",
      riskLevel: "low",
    },
  },

  LOW_LIQUIDITY: {
    name: "Low Liquidity",
    description: "Pool with dangerously low liquidity",
    networkState: {
      gasPriceGwei: 40,
      congestionLevel: "medium",
    },
    pools: {
      default: {
        totalLiquidityUsd: 500,
        bondingCurveProgress: 10,
        isGraduated: false,
        volume24h: 200,
        currentPrice: 0.0001,
      },
    },
    holderData: {
      totalHolders: 50,
      top10HoldersPercent: 85,
      distributionHealth: "whale_dominated",
      riskLevel: "high",
    },
  },

  HIGH_GAS: {
    name: "High Gas",
    description: "Network congestion with high gas prices",
    networkState: {
      gasPriceGwei: 150,
      congestionLevel: "extreme",
    },
    pools: {
      default: {
        totalLiquidityUsd: 30000,
        bondingCurveProgress: 60,
        isGraduated: false,
        volume24h: 15000,
        currentPrice: 0.002,
      },
    },
  },

  NEAR_GRADUATION: {
    name: "Near Graduation",
    description: "Token close to bonding curve graduation",
    networkState: {
      gasPriceGwei: 35,
      congestionLevel: "low",
    },
    pools: {
      default: {
        totalLiquidityUsd: 80000,
        bondingCurveProgress: 92,
        isGraduated: false,
        volume24h: 100000,
        currentPrice: 0.01,
      },
    },
    holderData: {
      totalHolders: 5000,
      top10HoldersPercent: 25,
      distributionHealth: "healthy",
      riskLevel: "low",
    },
  },

  BOT_ACTIVITY: {
    name: "Bot Activity",
    description: "High bot activity with suspicious patterns",
    networkState: {
      gasPriceGwei: 80,
      congestionLevel: "high",
    },
    pools: {
      default: {
        totalLiquidityUsd: 20000,
        bondingCurveProgress: 30,
        volume24h: 500000, // Unusually high volume
        currentPrice: 0.0005,
      },
    },
    transactions: generateBotTransactions(),
    holderData: {
      totalHolders: 200,
      top10HoldersPercent: 60,
      distributionHealth: "concentrated",
      riskLevel: "high",
    },
  },
};

// ============================================
// SIMULATION PROVIDER IMPLEMENTATION
// ============================================

export class SimulationProvider implements OnChainDataProvider {
  readonly name = "SimulationProvider";
  readonly capabilities: ProviderCapabilities;
  
  private scenario: SimulationScenario;
  private blockNumber = 15000000n;
  private customPools: Map<string, Partial<PoolLiquidity>> = new Map();

  constructor(scenarioName: keyof typeof SIMULATION_SCENARIOS = "HEALTHY_MARKET") {
    this.scenario = SIMULATION_SCENARIOS[scenarioName];
    
    // Simulation capabilities
    this.capabilities = {
      supportsMulticall: true,
      supportsBlockSubscriptions: true, // Simulated
      supportsTraceApi: false,
      supportsMonadDb: true, // Simulated
      supportsDeferredExecution: true, // Simulated
      supportsNadFunApi: true,
      supportsBondingCurveQueries: true,
      supportsMempoolQueries: true, // Simulated
      supportsPendingTransactions: true, // Simulated
      supportsHistoricalBlocks: true,
      maxHistoricalBlocks: 10000,
    };

    simLogger.info({ scenario: this.scenario.name }, "SimulationProvider initialized");
  }

  /**
   * Set simulation scenario
   */
  setScenario(scenarioName: keyof typeof SIMULATION_SCENARIOS): void {
    this.scenario = SIMULATION_SCENARIOS[scenarioName];
    simLogger.info({ scenario: this.scenario.name }, "Scenario changed");
  }

  /**
   * Set custom pool data for testing
   */
  setPoolData(tokenAddress: string, data: Partial<PoolLiquidity>): void {
    this.customPools.set(tokenAddress.toLowerCase(), data);
  }

  async getNetworkState(): Promise<NetworkState> {
    // Simulate slight variations
    const baseGwei = this.scenario.networkState.gasPriceGwei || 30;
    const variance = (Math.random() - 0.5) * 10;
    const gasPriceGwei = Math.max(1, baseGwei + variance);
    const gasPrice = BigInt(Math.floor(gasPriceGwei * 1e9));

    this.blockNumber += 1n;

    return {
      chainId: 143,
      blockNumber: this.blockNumber,
      timestamp: Date.now(),
      baseFeePerGas: gasPrice,
      gasPrice,
      gasPriceGwei,
      congestionLevel: this.scenario.networkState.congestionLevel || "low",
    };
  }

  async getGasPrice(): Promise<bigint> {
    const state = await this.getNetworkState();
    return state.gasPrice;
  }

  async getBlockNumber(): Promise<bigint> {
    this.blockNumber += 1n;
    return this.blockNumber;
  }

  async getPoolLiquidity(tokenAddress: string): Promise<PoolLiquidity> {
    const normalizedAddress = tokenAddress.toLowerCase();
    
    // Check for custom pool data first
    const customData = this.customPools.get(normalizedAddress);
    const scenarioData = this.scenario.pools[normalizedAddress] || this.scenario.pools.default;
    const poolData = { ...scenarioData, ...customData };

    // Add some variance for realism
    const liquidityVariance = 1 + (Math.random() - 0.5) * 0.05;
    const priceVariance = 1 + (Math.random() - 0.5) * 0.02;

    const totalLiquidityUsd = (poolData.totalLiquidityUsd || 10000) * liquidityVariance;
    const monReserve = BigInt(Math.floor(totalLiquidityUsd / 2 * 1e18));
    const tokenReserve = BigInt(Math.floor(totalLiquidityUsd / 2 / (poolData.currentPrice || 0.001) * 1e18));

    return {
      tokenAddress,
      tokenSymbol: "SIM",
      tokenReserve,
      monReserve,
      tokenReserveUsd: totalLiquidityUsd / 2,
      monReserveUsd: totalLiquidityUsd / 2,
      totalLiquidityUsd,
      bondingCurveProgress: poolData.bondingCurveProgress || 50,
      graduationThreshold: BigInt(100000 * 1e18), // 100k MON
      isGraduated: poolData.isGraduated || false,
      currentPrice: (poolData.currentPrice || 0.001) * priceVariance,
      pricePerMon: 1 / ((poolData.currentPrice || 0.001) * priceVariance),
      volume24h: poolData.volume24h || 10000,
      volumeChange24h: (Math.random() - 0.5) * 50, // -25% to +25%
      lastUpdatedBlock: this.blockNumber,
      lastUpdatedAt: Date.now(),
    };
  }

  async getHolderAnalysis(tokenAddress: string): Promise<HolderAnalysis> {
    const holderData = this.scenario.holderData || {};
    
    return {
      tokenAddress,
      totalHolders: holderData.totalHolders || 500,
      newHolders24h: Math.floor(Math.random() * 50),
      top10HoldersPercent: holderData.top10HoldersPercent || 40,
      top50HoldersPercent: (holderData.top10HoldersPercent || 40) + 30,
      topHolders: generateSimulatedHolders(10),
      whaleTransactions24h: Math.floor(Math.random() * 10),
      netWhaleFlow24h: (Math.random() - 0.5) * 10000,
      distributionHealth: holderData.distributionHealth || "healthy",
      riskLevel: holderData.riskLevel || "low",
    };
  }

  async getRecentTransactions(
    tokenAddress: string,
    limit: number
  ): Promise<TransactionPattern[]> {
    if (this.scenario.transactions) {
      return this.scenario.transactions.slice(0, limit);
    }
    
    // Generate random transactions
    return generateRandomTransactions(limit, this.blockNumber);
  }

  async multicall<T>(calls: MulticallRequest[]): Promise<T[]> {
    simLogger.debug({ callCount: calls.length }, "Simulated multicall");
    
    // Return empty results for simulation
    return calls.map(() => null as T);
  }

  async isHealthy(): Promise<boolean> {
    return true; // Simulation is always healthy
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateSimulatedHolders(count: number): HolderAnalysis["topHolders"] {
  const holders = [];
  let remainingPercent = 100;
  
  for (let i = 0; i < count; i++) {
    const percent = i === count - 1 
      ? remainingPercent 
      : Math.random() * remainingPercent * 0.3;
    remainingPercent -= percent;
    
    holders.push({
      address: `0x${(i + 1).toString(16).padStart(40, '0')}`,
      balance: BigInt(Math.floor(percent * 1e16)),
      balancePercent: percent,
      isContract: Math.random() > 0.7,
      label: Math.random() > 0.8 ? "Known Whale" : undefined,
    });
  }
  
  return holders.sort((a, b) => b.balancePercent - a.balancePercent);
}

function generateRandomTransactions(count: number, blockNumber: bigint): TransactionPattern[] {
  const txs: TransactionPattern[] = [];
  const types: TransactionPattern["transactionType"][] = ["swap", "transfer", "create", "approve"];
  
  for (let i = 0; i < count; i++) {
    txs.push({
      txHash: `0x${Math.random().toString(16).slice(2).padEnd(64, '0')}`,
      blockNumber: blockNumber - BigInt(i),
      timestamp: Date.now() - i * 12000, // ~12s per block
      from: `0x${Math.random().toString(16).slice(2).padEnd(40, '0')}`,
      to: `0x${Math.random().toString(16).slice(2).padEnd(40, '0')}`,
      methodId: "0x12345678",
      methodName: types[Math.floor(Math.random() * types.length)],
      valueMon: Math.random() * 10,
      transactionType: types[Math.floor(Math.random() * types.length)],
      isSuspicious: false,
      botScore: Math.random() * 0.3,
    });
  }
  
  return txs;
}

function generateBotTransactions(): TransactionPattern[] {
  const txs: TransactionPattern[] = [];
  const now = Date.now();
  const botAddress = "0xB07000000000000000000000000000000000B07";
  
  // Generate sandwich attack pattern
  for (let i = 0; i < 20; i++) {
    // Victim tx
    txs.push({
      txHash: `0xVICTIM${i.toString().padStart(58, '0')}`,
      blockNumber: 15000000n + BigInt(i),
      timestamp: now - i * 3000,
      from: `0xUSER${i.toString().padStart(36, '0')}`,
      to: "0xNADFUN",
      methodId: "0x12345678",
      methodName: "swap",
      valueMon: 0.5 + Math.random() * 2,
      transactionType: "swap",
      isSuspicious: false,
      botScore: 0.1,
    });
    
    // Frontrun
    txs.push({
      txHash: `0xFRONT${i.toString().padStart(59, '0')}`,
      blockNumber: 15000000n + BigInt(i),
      timestamp: now - i * 3000 - 100,
      from: botAddress,
      to: "0xNADFUN",
      methodId: "0x12345678",
      methodName: "swap",
      valueMon: 5 + Math.random() * 10,
      transactionType: "swap",
      isSuspicious: true,
      botScore: 0.95,
    });
    
    // Backrun
    txs.push({
      txHash: `0xBACK${i.toString().padStart(60, '0')}`,
      blockNumber: 15000000n + BigInt(i),
      timestamp: now - i * 3000 + 100,
      from: botAddress,
      to: "0xNADFUN",
      methodId: "0x12345678",
      methodName: "swap",
      valueMon: 5 + Math.random() * 10,
      transactionType: "swap",
      isSuspicious: true,
      botScore: 0.95,
    });
  }
  
  return txs;
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createSimulationProvider(
  scenario?: keyof typeof SIMULATION_SCENARIOS
): SimulationProvider {
  return new SimulationProvider(scenario);
}
