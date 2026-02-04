/**
 * Schema Validation Tests
 * Validates schemas with sample payloads
 */

import { describe, it, expect } from "vitest";
import {
  newsItemSchema,
  newsItemExamples,
  socialSignalSchema,
  socialSignalExamples,
  ingestionEventSchema,
  ingestionEventExamples,
  embeddingRecordSchema,
  embeddingRecordExamples,
  agentOpinionSchema,
  agentOpinionExamples,
  consensusDecisionSchema,
  consensusDecisionExamples,
  executionPlanSchema,
  executionPlanExamples,
  auditLogEventSchema,
  auditLogEventExamples,
  CURRENT_SCHEMA_VERSION,
  MONAD_MAINNET_CHAIN_ID,
} from "../index.js";

describe("Schema Version", () => {
  it("should have current schema version", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe("1.0.0");
  });

  it("should have correct Monad chain ID", () => {
    expect(MONAD_MAINNET_CHAIN_ID).toBe(143);
  });
});

describe("NewsItem Schema", () => {
  it("should validate example payloads", () => {
    for (const example of newsItemExamples) {
      const result = newsItemSchema.safeParse(example);
      expect(result.success).toBe(true);
    }
  });

  it("should reject invalid payload", () => {
    const invalid = {
      schemaVersion: "1.0.0",
      id: "not-a-uuid",
      title: "", // Too short
    };
    const result = newsItemSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("SocialSignal Schema", () => {
  it("should validate example payloads", () => {
    for (const example of socialSignalExamples) {
      const result = socialSignalSchema.safeParse(example);
      expect(result.success).toBe(true);
    }
  });

  it("should validate sentiment values", () => {
    const signal = {
      ...socialSignalExamples[0],
      sentiment: "bullish",
      sentimentScore: 0.85,
    };
    const result = socialSignalSchema.safeParse(signal);
    expect(result.success).toBe(true);
  });
});

describe("IngestionEvent Schema", () => {
  it("should validate example payloads", () => {
    for (const example of ingestionEventExamples) {
      const result = ingestionEventSchema.safeParse(example);
      expect(result.success).toBe(true);
    }
  });
});

describe("EmbeddingRecord Schema", () => {
  it("should validate example payloads", () => {
    for (const example of embeddingRecordExamples) {
      const result = embeddingRecordSchema.safeParse(example);
      expect(result.success).toBe(true);
    }
  });

  it("should require non-empty embedding array", () => {
    const invalid = {
      ...embeddingRecordExamples[0],
      embedding: [], // Empty array
    };
    const result = embeddingRecordSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("AgentOpinion Schema", () => {
  it("should validate example payloads", () => {
    for (const example of agentOpinionExamples) {
      const result = agentOpinionSchema.safeParse(example);
      expect(result.success).toBe(true);
    }
  });

  it("should validate confidence score range", () => {
    const valid = {
      ...agentOpinionExamples[0],
      confidenceScore: 0.5,
    };
    expect(agentOpinionSchema.safeParse(valid).success).toBe(true);

    const invalid = {
      ...agentOpinionExamples[0],
      confidenceScore: 1.5, // Out of range
    };
    expect(agentOpinionSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("ConsensusDecision Schema", () => {
  it("should validate example payloads", () => {
    for (const example of consensusDecisionExamples) {
      const result = consensusDecisionSchema.safeParse(example);
      expect(result.success).toBe(true);
    }
  });

  it("should require at least one opinion ID", () => {
    const invalid = {
      ...consensusDecisionExamples[0],
      opinionIds: [], // Empty array
    };
    const result = consensusDecisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("ExecutionPlan Schema", () => {
  it("should validate example payloads", () => {
    for (const example of executionPlanExamples) {
      const result = executionPlanSchema.safeParse(example);
      expect(result.success).toBe(true);
    }
  });

  it("should default to Monad Mainnet chain ID", () => {
    const plan = executionPlanSchema.parse({
      ...executionPlanExamples[0],
      chainId: undefined, // Should default
    });
    expect(plan.chainId).toBe(143);
  });

  it("should validate Wei amounts as strings", () => {
    const valid = {
      ...executionPlanExamples[0],
      value: "100000000000000000", // Valid Wei string
    };
    expect(executionPlanSchema.safeParse(valid).success).toBe(true);

    const invalid = {
      ...executionPlanExamples[0],
      value: "1.5", // Invalid - contains decimal
    };
    expect(executionPlanSchema.safeParse(invalid).success).toBe(false);
  });

  it("should validate gas config fields", () => {
    const plan = executionPlanSchema.parse(executionPlanExamples[0]);
    
    expect(plan.gasConfig.gasLimit).toBeDefined();
    expect(plan.gasConfig.maxFeePerGas).toBeDefined();
    expect(plan.gasConfig.maxPriorityFeePerGas).toBeDefined();
    expect(plan.gasConfig.gasBufferPercent).toBe(15);
  });
});

describe("AuditLogEvent Schema", () => {
  it("should validate example payloads", () => {
    for (const example of auditLogEventExamples) {
      const result = auditLogEventSchema.safeParse(example);
      expect(result.success).toBe(true);
    }
  });

  it("should validate security events", () => {
    const securityEvent = auditLogEventExamples.find(
      (e) => e.action === "kill_switch_activate"
    );
    expect(securityEvent).toBeDefined();
    expect(securityEvent?.severity).toBe("critical");
  });
});

describe("Cross-Schema References", () => {
  it("should link ConsensusDecision to AgentOpinions", () => {
    const decision = consensusDecisionExamples[0];
    expect(decision.opinionIds.length).toBeGreaterThan(0);
    expect(decision.opinionCount).toBe(decision.opinionIds.length);
  });

  it("should link ExecutionPlan to ConsensusDecision", () => {
    const plan = executionPlanExamples[0];
    expect(plan.consensusDecisionId).toBeDefined();
  });

  it("should link AuditLogEvent to ExecutionPlan", () => {
    const auditEvent = auditLogEventExamples[0];
    expect(auditEvent.relatedIds.executionPlanId).toBeDefined();
  });
});
