/**
 * Run Record Storage
 * 
 * Stores immutable run records for:
 * - Deterministic replay
 * - Audit trail
 * - Debugging
 * 
 * Turkish: "Her ajanın karara varırken kullandığı 'Düşünce Zinciri' (Chain of Thought)
 * metni, Mainnet denetimi için run_record içinde saklanmalı."
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type { 
  RunRecord, 
  InputSignals, 
  AgentOpinionWithCoT, 
  FinalDecision 
} from "../graph/state.js";
import { computeInputChecksum } from "../graph/state.js";
import type { ConsensusConfig } from "../consensus/consensus-engine.js";
import fs from "fs/promises";
import path from "path";

// ============================================
// RUN RECORD STORE INTERFACE
// ============================================

export interface RunRecordStore {
  save(record: RunRecord): Promise<void>;
  load(runId: string): Promise<RunRecord | null>;
  list(options?: { limit?: number; offset?: number }): Promise<RunRecord[]>;
  verify(runId: string): Promise<boolean>;
}

// ============================================
// FILE SYSTEM STORE (Development)
// ============================================

export class FileSystemRunRecordStore implements RunRecordStore {
  private basePath: string;

  constructor(basePath: string = "./data/run_records") {
    this.basePath = basePath;
  }

  async save(record: RunRecord): Promise<void> {
    // Ensure directory exists
    await fs.mkdir(this.basePath, { recursive: true });

    // Create file path with date prefix for organization
    const date = new Date(record.startedAt);
    const dateDir = path.join(
      this.basePath,
      date.getFullYear().toString(),
      (date.getMonth() + 1).toString().padStart(2, "0"),
      date.getDate().toString().padStart(2, "0")
    );
    await fs.mkdir(dateDir, { recursive: true });

    const filePath = path.join(dateDir, `${record.id}.json`);

    // Write atomically (write to temp, then rename)
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(record, null, 2), "utf-8");
    await fs.rename(tempPath, filePath);

    logger.info({ runId: record.id, path: filePath }, "Run record saved");
  }

  async load(runId: string): Promise<RunRecord | null> {
    // Search for the file (we need to search by date directories)
    const files = await this.findRecordFiles();
    
    for (const file of files) {
      if (file.includes(runId)) {
        try {
          const content = await fs.readFile(file, "utf-8");
          return JSON.parse(content) as RunRecord;
        } catch (error) {
          logger.error({ error, runId }, "Failed to load run record");
          return null;
        }
      }
    }

    return null;
  }

  async list(options: { limit?: number; offset?: number } = {}): Promise<RunRecord[]> {
    const { limit = 50, offset = 0 } = options;
    const files = await this.findRecordFiles();
    
    // Sort by filename (which includes timestamp)
    files.sort().reverse();

    const records: RunRecord[] = [];
    const targetFiles = files.slice(offset, offset + limit);

    for (const file of targetFiles) {
      try {
        const content = await fs.readFile(file, "utf-8");
        records.push(JSON.parse(content) as RunRecord);
      } catch (error) {
        logger.warn({ error, file }, "Failed to parse run record file");
      }
    }

    return records;
  }

  async verify(runId: string): Promise<boolean> {
    const record = await this.load(runId);
    if (!record) return false;

    // Recompute checksum and compare
    const computedChecksum = computeInputChecksum(
      record.inputs.signals,
      record.inputs.query
    );

    return computedChecksum === record.checksum;
  }

  private async findRecordFiles(): Promise<string[]> {
    const files: string[] = [];

    try {
      await this.walkDir(this.basePath, files);
    } catch (error) {
      // Directory might not exist yet
      logger.debug({ error }, "Error walking run records directory");
    }

    return files;
  }

  private async walkDir(dir: string, files: string[]): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.walkDir(fullPath, files);
        } else if (entry.name.endsWith(".json") && !entry.name.endsWith(".tmp")) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Ignore errors for missing directories
    }
  }
}

// ============================================
// RUN RECORD BUILDER
// ============================================

export class RunRecordBuilder {
  private runId: string;
  private version: string;
  private inputs: RunRecord["inputs"] | null = null;
  private agentOpinions: AgentOpinionWithCoT[] = [];
  private decision: FinalDecision | null = null;
  private auditLog: RunRecord["auditLog"] = [];
  private startedAt: string;
  private completedAt: string | null = null;

  constructor(runId: string, version: string = "1.0.0") {
    this.runId = runId;
    this.version = version;
    this.startedAt = new Date().toISOString();
    this.addAuditEntry("run_started", { runId });
  }

  setInputs(
    signals: InputSignals,
    query: string,
    config: ConsensusConfig
  ): this {
    this.inputs = {
      signals,
      query,
      config: {
        confidenceThreshold: config.confidenceThreshold,
        adversarialVetoThreshold: config.adversarialVetoThreshold,
        consensusMethod: "confidence_weighted",
      },
    };
    this.addAuditEntry("inputs_set", { 
      signalCounts: {
        news: signals.news.length,
        social: signals.social.length,
        memory: signals.memory.length,
        hasOnchain: !!signals.onchain,
      },
      query: query.slice(0, 100),
    });
    return this;
  }

  addAgentOpinion(opinion: AgentOpinionWithCoT): this {
    this.agentOpinions.push(opinion);
    this.addAuditEntry("agent_opinion_added", {
      role: opinion.role,
      recommendation: opinion.recommendation,
      confidence: opinion.confidenceScore,
      isTrap: opinion.isTrap,
      trapConfidence: opinion.trapConfidence,
    });
    return this;
  }

  setDecision(decision: FinalDecision): this {
    this.decision = decision;
    this.addAuditEntry("decision_made", {
      status: decision.status,
      recommendation: decision.recommendation,
      confidence: decision.confidence,
      adversarialVeto: decision.adversarialVeto,
    });
    return this;
  }

  addAuditEntry(event: string, details: Record<string, unknown>): this {
    this.auditLog.push({
      timestamp: new Date().toISOString(),
      event,
      details,
    });
    return this;
  }

  build(): RunRecord {
    this.completedAt = new Date().toISOString();
    
    if (!this.inputs) {
      throw new Error("Inputs not set");
    }

    const startTime = new Date(this.startedAt).getTime();
    const endTime = new Date(this.completedAt).getTime();

    this.addAuditEntry("run_completed", {
      totalDurationMs: endTime - startTime,
      agentCount: this.agentOpinions.length,
      hasDecision: !!this.decision,
    });

    return {
      id: this.runId,
      version: this.version,
      inputs: this.inputs,
      agentOpinions: this.agentOpinions,
      decision: this.decision,
      auditLog: this.auditLog,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      totalDurationMs: endTime - startTime,
      checksum: computeInputChecksum(this.inputs.signals, this.inputs.query),
    };
  }
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

export function createRunRecordStore(basePath?: string): RunRecordStore {
  return new FileSystemRunRecordStore(basePath);
}

export function createRunRecordBuilder(runId: string): RunRecordBuilder {
  return new RunRecordBuilder(runId);
}
