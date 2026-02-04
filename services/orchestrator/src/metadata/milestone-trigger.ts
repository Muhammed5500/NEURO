/**
 * Milestone Trigger Model
 * 
 * Defines on-chain events that can trigger metadata refresh.
 * 
 * Turkish: "Metadata güncellemelerini sadece zaman bazlı değil, on-chain olaylara bağla"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  MilestoneEvent,
  MilestoneConfig,
  MilestoneEventType,
  MetadataUpdateField,
  TokenMetadata,
} from "./types.js";
import { DEFAULT_MILESTONE_CONFIGS } from "./types.js";

const milestoneLogger = logger.child({ component: "milestone-trigger" });

// ============================================
// ON-CHAIN STATE SNAPSHOT
// ============================================

/**
 * Snapshot of on-chain state for milestone checking
 */
export interface OnChainSnapshot {
  tokenAddress: string;
  chainId: number;
  blockNumber: number;
  
  // Pool metrics
  poolFillPercent: number;
  poolLiquidity: string;
  
  // Token metrics
  holderCount: number;
  totalVolume: string;
  price?: number;
  
  // Status
  isGraduated: boolean;
  graduationTxHash?: string;
  
  // Timestamp
  timestamp: number;
}

// ============================================
// MILESTONE TRACKER
// ============================================

/**
 * Tracks crossed milestones per token to prevent duplicate triggers
 */
interface MilestoneState {
  tokenAddress: string;
  crossedMilestones: Set<string>;
  lastChecked: number;
  previousSnapshot?: OnChainSnapshot;
}

export class MilestoneTracker {
  private readonly configs: MilestoneConfig[];
  private readonly states: Map<string, MilestoneState> = new Map();

  constructor(configs?: MilestoneConfig[]) {
    this.configs = configs || DEFAULT_MILESTONE_CONFIGS;

    milestoneLogger.info({
      configCount: this.configs.length,
      enabledCount: this.configs.filter(c => c.enabled).length,
    }, "MilestoneTracker initialized");
  }

  /**
   * Check for milestone events based on on-chain snapshot
   * Turkish: "on-chain olaylara bağla"
   */
  checkMilestones(snapshot: OnChainSnapshot): MilestoneEvent[] {
    const events: MilestoneEvent[] = [];
    const stateKey = `${snapshot.chainId}:${snapshot.tokenAddress}`;
    
    // Get or create state
    let state = this.states.get(stateKey);
    if (!state) {
      state = {
        tokenAddress: snapshot.tokenAddress,
        crossedMilestones: new Set(),
        lastChecked: 0,
      };
      this.states.set(stateKey, state);
    }

    for (const config of this.configs) {
      if (!config.enabled) continue;

      const milestoneKey = this.getMilestoneKey(config);
      
      // Skip already crossed milestones
      if (state.crossedMilestones.has(milestoneKey)) continue;

      // Check if milestone is crossed
      const event = this.checkSingleMilestone(config, snapshot, state.previousSnapshot);
      
      if (event) {
        events.push(event);
        state.crossedMilestones.add(milestoneKey);
        
        milestoneLogger.info({
          tokenAddress: snapshot.tokenAddress,
          type: event.type,
          threshold: event.threshold,
          currentValue: event.currentValue,
        }, "Milestone crossed");
      }
    }

    // Update state
    state.lastChecked = Date.now();
    state.previousSnapshot = snapshot;

    return events;
  }

  /**
   * Check a single milestone configuration
   */
  private checkSingleMilestone(
    config: MilestoneConfig,
    current: OnChainSnapshot,
    previous?: OnChainSnapshot
  ): MilestoneEvent | null {
    switch (config.type) {
      case "pool_fill_threshold":
        // Turkish: "Havuzun %50 doluluğa ulaşması"
        if (config.threshold !== undefined && current.poolFillPercent >= config.threshold) {
          // Only trigger if we crossed the threshold (wasn't already above)
          if (!previous || previous.poolFillPercent < config.threshold) {
            return this.createEvent(config, current, current.poolFillPercent);
          }
        }
        break;

      case "holder_count_threshold":
        if (config.threshold !== undefined && current.holderCount >= config.threshold) {
          if (!previous || previous.holderCount < config.threshold) {
            return this.createEvent(config, current, current.holderCount);
          }
        }
        break;

      case "volume_threshold":
        if (config.threshold !== undefined) {
          const volume = parseFloat(current.totalVolume);
          if (volume >= config.threshold) {
            const prevVolume = previous ? parseFloat(previous.totalVolume) : 0;
            if (prevVolume < config.threshold) {
              return this.createEvent(config, current, volume);
            }
          }
        }
        break;

      case "token_graduated":
        // Turkish: "Tokenın mezun olması"
        if (current.isGraduated) {
          if (!previous || !previous.isGraduated) {
            return this.createEvent(config, current, undefined, current.graduationTxHash);
          }
        }
        break;

      case "price_milestone":
        if (config.threshold !== undefined && current.price !== undefined) {
          if (current.price >= config.threshold) {
            if (!previous || !previous.price || previous.price < config.threshold) {
              return this.createEvent(config, current, current.price);
            }
          }
        }
        break;
    }

    return null;
  }

  /**
   * Create milestone event
   */
  private createEvent(
    config: MilestoneConfig,
    snapshot: OnChainSnapshot,
    currentValue?: number,
    txHash?: string
  ): MilestoneEvent {
    return {
      type: config.type,
      tokenAddress: snapshot.tokenAddress,
      chainId: snapshot.chainId,
      threshold: config.threshold,
      currentValue,
      updateFields: config.updateFields,
      blockNumber: snapshot.blockNumber,
      txHash,
      timestamp: Date.now(),
    };
  }

  /**
   * Get unique key for milestone config
   */
  private getMilestoneKey(config: MilestoneConfig): string {
    return `${config.type}:${config.threshold || "none"}`;
  }

  /**
   * Generate description update based on milestone
   */
  generateDescription(
    config: MilestoneConfig,
    event: MilestoneEvent,
    currentMetadata: TokenMetadata
  ): string {
    if (config.descriptionTemplate) {
      return config.descriptionTemplate
        .replace("{percent}", event.currentValue?.toString() || "")
        .replace("{value}", event.currentValue?.toString() || "")
        .replace("{threshold}", event.threshold?.toString() || "")
        .replace("{name}", currentMetadata.name)
        .replace("{symbol}", currentMetadata.symbol);
    }

    // Default descriptions
    switch (event.type) {
      case "pool_fill_threshold":
        return `${currentMetadata.name} has reached ${event.currentValue}% pool fill!`;
      case "holder_count_threshold":
        return `${currentMetadata.name} now has ${event.currentValue}+ holders!`;
      case "token_graduated":
        return `${currentMetadata.name} has graduated and is now trading on DEX!`;
      default:
        return currentMetadata.description;
    }
  }

  /**
   * Get config for event type
   */
  getConfig(type: MilestoneEventType, threshold?: number): MilestoneConfig | undefined {
    return this.configs.find(
      c => c.type === type && (threshold === undefined || c.threshold === threshold)
    );
  }

  /**
   * Reset milestone state for a token
   */
  resetTokenState(tokenAddress: string, chainId: number): void {
    const key = `${chainId}:${tokenAddress}`;
    this.states.delete(key);
    milestoneLogger.debug({ tokenAddress, chainId }, "Token milestone state reset");
  }

  /**
   * Create manual update event
   */
  createManualEvent(
    tokenAddress: string,
    chainId: number,
    updateFields: MetadataUpdateField[]
  ): MilestoneEvent {
    return {
      type: "manual_request",
      tokenAddress,
      chainId,
      updateFields,
      timestamp: Date.now(),
    };
  }

  /**
   * Create time-based refresh event
   */
  createTimeElapsedEvent(
    tokenAddress: string,
    chainId: number,
    updateFields: MetadataUpdateField[] = ["description", "attributes"]
  ): MilestoneEvent {
    return {
      type: "time_elapsed",
      tokenAddress,
      chainId,
      updateFields,
      timestamp: Date.now(),
    };
  }
}

/**
 * Factory function
 */
export function createMilestoneTracker(
  configs?: MilestoneConfig[]
): MilestoneTracker {
  return new MilestoneTracker(configs);
}
