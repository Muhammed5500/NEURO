/**
 * Metadata Version History
 * 
 * Maintains immutable history of metadata versions with JSON Patch diffs.
 * 
 * Turkish: "eski versiyon ile yeni versiyon arasındaki farkı (diff) JSON Patch (RFC 6902) formatında sakla"
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import * as crypto from "crypto";
import type {
  TokenMetadata,
  MetadataVersion,
  MetadataHistory,
  JsonPatchOperation,
  MilestoneEvent,
  MilestoneEventType,
  PinResult,
} from "./types.js";

const historyLogger = logger.child({ component: "version-history" });

// ============================================
// JSON PATCH UTILITIES (RFC 6902)
// ============================================

/**
 * Generate JSON Patch operations between two objects
 * Turkish: "JSON Patch (RFC 6902) formatında"
 */
export function generateJsonPatch(
  oldObj: object,
  newObj: object,
  basePath = ""
): JsonPatchOperation[] {
  const operations: JsonPatchOperation[] = [];
  
  const oldKeys = new Set(Object.keys(oldObj));
  const newKeys = new Set(Object.keys(newObj));

  // Find removed keys
  for (const key of oldKeys) {
    if (!newKeys.has(key)) {
      operations.push({
        op: "remove",
        path: `${basePath}/${escapeJsonPointer(key)}`,
      });
    }
  }

  // Find added or changed keys
  for (const key of newKeys) {
    const path = `${basePath}/${escapeJsonPointer(key)}`;
    const oldValue = (oldObj as any)[key];
    const newValue = (newObj as any)[key];

    if (!oldKeys.has(key)) {
      // Added
      operations.push({
        op: "add",
        path,
        value: newValue,
      });
    } else if (!deepEqual(oldValue, newValue)) {
      // Changed
      if (
        typeof oldValue === "object" &&
        typeof newValue === "object" &&
        oldValue !== null &&
        newValue !== null &&
        !Array.isArray(oldValue) &&
        !Array.isArray(newValue)
      ) {
        // Recurse for nested objects
        operations.push(...generateJsonPatch(oldValue, newValue, path));
      } else {
        // Replace
        operations.push({
          op: "replace",
          path,
          value: newValue,
        });
      }
    }
  }

  return operations;
}

/**
 * Apply JSON Patch operations to an object
 */
export function applyJsonPatch(obj: object, operations: JsonPatchOperation[]): object {
  let result = JSON.parse(JSON.stringify(obj)); // Deep clone

  for (const op of operations) {
    const pathParts = parseJsonPointer(op.path);
    
    switch (op.op) {
      case "add":
      case "replace":
        setValueAtPath(result, pathParts, op.value);
        break;
      case "remove":
        removeValueAtPath(result, pathParts);
        break;
      case "move":
        if (op.from) {
          const fromParts = parseJsonPointer(op.from);
          const value = getValueAtPath(result, fromParts);
          removeValueAtPath(result, fromParts);
          setValueAtPath(result, pathParts, value);
        }
        break;
      case "copy":
        if (op.from) {
          const fromParts = parseJsonPointer(op.from);
          const value = getValueAtPath(result, fromParts);
          setValueAtPath(result, pathParts, JSON.parse(JSON.stringify(value)));
        }
        break;
      case "test":
        const actual = getValueAtPath(result, pathParts);
        if (!deepEqual(actual, op.value)) {
          throw new Error(`Test failed at ${op.path}`);
        }
        break;
    }
  }

  return result;
}

// JSON Pointer helpers
function escapeJsonPointer(str: string): string {
  return str.replace(/~/g, "~0").replace(/\//g, "~1");
}

function unescapeJsonPointer(str: string): string {
  return str.replace(/~1/g, "/").replace(/~0/g, "~");
}

function parseJsonPointer(pointer: string): string[] {
  if (!pointer.startsWith("/")) return [];
  return pointer.slice(1).split("/").map(unescapeJsonPointer);
}

function getValueAtPath(obj: any, path: string[]): any {
  let current = obj;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
}

function setValueAtPath(obj: any, path: string[], value: any): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key];
  }
  current[path[path.length - 1]] = value;
}

function removeValueAtPath(obj: any, path: string[]): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    current = current[path[i]];
    if (current === null || current === undefined) return;
  }
  delete current[path[path.length - 1]];
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return a === b;
  
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  
  if (keysA.length !== keysB.length) return false;
  
  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  
  return true;
}

// ============================================
// VERSION HISTORY MANAGER
// ============================================

export class VersionHistoryManager {
  private readonly histories: Map<string, MetadataHistory> = new Map();

  constructor() {
    historyLogger.info("VersionHistoryManager initialized");
  }

  /**
   * Get history key
   */
  private getKey(tokenAddress: string, chainId: number): string {
    return `${chainId}:${tokenAddress.toLowerCase()}`;
  }

  /**
   * Get or create history for token
   */
  getHistory(tokenAddress: string, chainId: number): MetadataHistory | undefined {
    return this.histories.get(this.getKey(tokenAddress, chainId));
  }

  /**
   * Create initial version
   */
  createInitialVersion(
    metadata: TokenMetadata,
    cid: string,
    pinResults?: PinResult[]
  ): MetadataVersion {
    const version: MetadataVersion = {
      version: 1,
      cid,
      contentHash: this.computeContentHash(metadata),
      triggeredBy: "manual_request",
      createdAt: Date.now(),
      pinnedAt: Date.now(),
      pinResults,
    };

    // Initialize history
    const key = this.getKey(metadata.neuro!.tokenAddress, metadata.neuro!.chainId);
    const history: MetadataHistory = {
      tokenAddress: metadata.neuro!.tokenAddress,
      chainId: metadata.neuro!.chainId,
      currentVersion: 1,
      currentCid: cid,
      versions: [version],
      totalUpdates: 1,
      lastUpdatedAt: Date.now(),
    };

    this.histories.set(key, history);

    historyLogger.info({
      tokenAddress: metadata.neuro!.tokenAddress,
      version: 1,
      cid,
    }, "Initial version created");

    return version;
  }

  /**
   * Add new version with diff
   * Turkish: "'NEURO neyi değiştirdi?' sorusuna net cevap verir"
   */
  addVersion(
    oldMetadata: TokenMetadata,
    newMetadata: TokenMetadata,
    newCid: string,
    event: MilestoneEvent,
    pinResults?: PinResult[]
  ): MetadataVersion {
    const key = this.getKey(newMetadata.neuro!.tokenAddress, newMetadata.neuro!.chainId);
    let history = this.histories.get(key);

    if (!history) {
      // Create history if doesn't exist
      return this.createInitialVersion(newMetadata, newCid, pinResults);
    }

    // Generate diff
    // Turkish: "eski versiyon ile yeni versiyon arasındaki farkı sakla"
    const diff = generateJsonPatch(oldMetadata, newMetadata);
    const previousVersion = history.versions[history.versions.length - 1];

    const version: MetadataVersion = {
      version: history.currentVersion + 1,
      cid: newCid,
      contentHash: this.computeContentHash(newMetadata),
      diff,
      previousVersion: previousVersion.version,
      previousCid: previousVersion.cid,
      triggeredBy: event.type,
      milestoneEvent: event,
      createdAt: Date.now(),
      pinnedAt: Date.now(),
      pinResults,
    };

    // Update history
    history.versions.push(version);
    history.currentVersion = version.version;
    history.currentCid = newCid;
    history.totalUpdates++;
    history.lastUpdatedAt = Date.now();

    historyLogger.info({
      tokenAddress: newMetadata.neuro!.tokenAddress,
      version: version.version,
      cid: newCid,
      diffOperations: diff.length,
      triggeredBy: event.type,
    }, "New version added");

    return version;
  }

  /**
   * Get version by number
   */
  getVersion(
    tokenAddress: string,
    chainId: number,
    versionNumber: number
  ): MetadataVersion | undefined {
    const history = this.getHistory(tokenAddress, chainId);
    return history?.versions.find(v => v.version === versionNumber);
  }

  /**
   * Get diff between two versions
   */
  getDiffBetweenVersions(
    tokenAddress: string,
    chainId: number,
    fromVersion: number,
    toVersion: number
  ): JsonPatchOperation[] {
    const history = this.getHistory(tokenAddress, chainId);
    if (!history) return [];

    // Collect all diffs between versions
    const allDiffs: JsonPatchOperation[] = [];
    
    for (let v = fromVersion + 1; v <= toVersion; v++) {
      const version = history.versions.find(ver => ver.version === v);
      if (version?.diff) {
        allDiffs.push(...version.diff);
      }
    }

    return allDiffs;
  }

  /**
   * Get changed fields summary
   * Turkish: "dashboard'da 'NEURO neyi değiştirdi?' sorusuna net cevap"
   */
  getChangedFields(diff: JsonPatchOperation[]): string[] {
    const fields = new Set<string>();
    
    for (const op of diff) {
      // Extract top-level field from path
      const parts = parseJsonPointer(op.path);
      if (parts.length > 0) {
        fields.add(parts[0]);
      }
    }

    return Array.from(fields);
  }

  /**
   * Format diff for dashboard display
   */
  formatDiffForDisplay(diff: JsonPatchOperation[]): Array<{
    operation: string;
    field: string;
    oldValue?: unknown;
    newValue?: unknown;
  }> {
    return diff.map(op => {
      const parts = parseJsonPointer(op.path);
      const field = parts.join(".");

      switch (op.op) {
        case "add":
          return { operation: "Added", field, newValue: op.value };
        case "remove":
          return { operation: "Removed", field };
        case "replace":
          return { operation: "Changed", field, newValue: op.value };
        case "move":
          return { operation: "Moved", field, oldValue: op.from, newValue: op.path };
        case "copy":
          return { operation: "Copied", field, oldValue: op.from, newValue: op.path };
        default:
          return { operation: op.op, field };
      }
    });
  }

  /**
   * Get version history summary
   */
  getHistorySummary(
    tokenAddress: string,
    chainId: number
  ): {
    currentVersion: number;
    totalUpdates: number;
    lastUpdatedAt: number;
    versionSummaries: Array<{
      version: number;
      cid: string;
      triggeredBy: MilestoneEventType;
      changedFields: string[];
      createdAt: number;
    }>;
  } | null {
    const history = this.getHistory(tokenAddress, chainId);
    if (!history) return null;

    return {
      currentVersion: history.currentVersion,
      totalUpdates: history.totalUpdates,
      lastUpdatedAt: history.lastUpdatedAt,
      versionSummaries: history.versions.map(v => ({
        version: v.version,
        cid: v.cid,
        triggeredBy: v.triggeredBy,
        changedFields: v.diff ? this.getChangedFields(v.diff) : [],
        createdAt: v.createdAt,
      })),
    };
  }

  /**
   * Compute content hash
   */
  private computeContentHash(metadata: TokenMetadata): string {
    const json = JSON.stringify(metadata);
    return crypto.createHash("sha256").update(json).digest("hex");
  }

  /**
   * Export history to JSON
   */
  exportHistory(tokenAddress: string, chainId: number): string | null {
    const history = this.getHistory(tokenAddress, chainId);
    if (!history) return null;
    return JSON.stringify(history, null, 2);
  }

  /**
   * Import history from JSON
   */
  importHistory(json: string): void {
    const history: MetadataHistory = JSON.parse(json);
    const key = this.getKey(history.tokenAddress, history.chainId);
    this.histories.set(key, history);
    historyLogger.info({
      tokenAddress: history.tokenAddress,
      versions: history.versions.length,
    }, "History imported");
  }
}

/**
 * Factory function
 */
export function createVersionHistoryManager(): VersionHistoryManager {
  return new VersionHistoryManager();
}
