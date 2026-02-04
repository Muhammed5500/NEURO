/**
 * Consensus Engine Tests
 * 
 * Tests the core business rules:
 * 1. Confidence threshold (0.85 minimum for EXECUTE)
 * 2. Adversarial veto power (90%+ trap confidence)
 */

import { describe, it, expect } from "vitest";
import { 
  ConsensusEngine, 
  DEFAULT_CONSENSUS_CONFIG,
  type ConsensusConfig,
} from "../consensus/consensus-engine.js";
import type { AgentOpinionWithCoT } from "../graph/state.js";

// ============================================
// TEST HELPERS
// ============================================

function createOpinion(
  role: AgentOpinionWithCoT["role"],
  overrides: Partial<AgentOpinionWithCoT> = {}
): AgentOpinionWithCoT {
  const now = new Date().toISOString();
  return {
    role,
    agentId: `${role}-agent-v1`,
    recommendation: "buy",
    sentiment: "bullish",
    confidenceScore: 0.85,
    riskScore: 0.3,
    chainOfThought: `Analysis by ${role} agent...`,
    keyInsights: [`Insight from ${role}`],
    evidenceUsed: ["evidence1"],
    riskFactors: [],
    startedAt: now,
    completedAt: now,
    durationMs: 1000,
    modelUsed: "gpt-4",
    ...overrides,
  };
}

function createAllAgentOpinions(
  overrides: Record<string, Partial<AgentOpinionWithCoT>> = {}
): AgentOpinionWithCoT[] {
  const roles: AgentOpinionWithCoT["role"][] = [
    "scout", "macro", "onchain", "risk", "adversarial"
  ];
  return roles.map(role => createOpinion(role, overrides[role] || {}));
}

// ============================================
// TESTS
// ============================================

describe("ConsensusEngine", () => {
  describe("Confidence Threshold", () => {
    it("should EXECUTE when average confidence >= 0.85", () => {
      const engine = new ConsensusEngine();
      const opinions = createAllAgentOpinions({
        scout: { confidenceScore: 0.90 },
        macro: { confidenceScore: 0.88 },
        onchain: { confidenceScore: 0.85 },
        risk: { confidenceScore: 0.87, riskScore: 0.25 },
        adversarial: { confidenceScore: 0.86, isTrap: false, trapConfidence: 0.1 },
      });

      const decision = engine.buildConsensus(opinions);
      
      expect(decision.status).toBe("EXECUTE");
      expect(decision.averageConfidence).toBeGreaterThanOrEqual(0.85);
    });

    it("should REJECT/NEED_MORE_DATA when average confidence < 0.85", () => {
      const engine = new ConsensusEngine();
      const opinions = createAllAgentOpinions({
        scout: { confidenceScore: 0.70 },
        macro: { confidenceScore: 0.75 },
        onchain: { confidenceScore: 0.65 },
        risk: { confidenceScore: 0.72 },
        adversarial: { confidenceScore: 0.68, isTrap: false, trapConfidence: 0.1 },
      });

      const decision = engine.buildConsensus(opinions);
      
      expect(decision.status).not.toBe("EXECUTE");
      expect(["REJECT", "NEED_MORE_DATA", "MANUAL_REVIEW"]).toContain(decision.status);
      expect(decision.averageConfidence).toBeLessThan(0.85);
    });

    it("should require custom threshold when configured", () => {
      const config: Partial<ConsensusConfig> = {
        confidenceThreshold: 0.90,
      };
      const engine = new ConsensusEngine(config);
      
      // Opinions with 0.87 average (above 0.85 but below 0.90)
      const opinions = createAllAgentOpinions({
        scout: { confidenceScore: 0.88 },
        macro: { confidenceScore: 0.87 },
        onchain: { confidenceScore: 0.86 },
        risk: { confidenceScore: 0.88 },
        adversarial: { confidenceScore: 0.86, isTrap: false, trapConfidence: 0.1 },
      });

      const decision = engine.buildConsensus(opinions);
      
      expect(decision.status).not.toBe("EXECUTE");
    });
  });

  describe("Adversarial Veto Power", () => {
    it("should REJECT when adversarial agent detects trap with 90%+ confidence", () => {
      const engine = new ConsensusEngine();
      
      // All other agents are bullish with high confidence
      const opinions = createAllAgentOpinions({
        scout: { confidenceScore: 0.95, recommendation: "buy" },
        macro: { confidenceScore: 0.92, recommendation: "buy" },
        onchain: { confidenceScore: 0.90, recommendation: "buy" },
        risk: { confidenceScore: 0.88, recommendation: "buy", riskScore: 0.2 },
        // But adversarial says TRAP!
        adversarial: { 
          confidenceScore: 0.95, 
          recommendation: "avoid",
          isTrap: true, 
          trapConfidence: 0.92,
          trapReasons: ["Coordinated bot activity", "Honeypot contract pattern"],
        },
      });

      const decision = engine.buildConsensus(opinions);
      
      expect(decision.status).toBe("REJECT");
      expect(decision.adversarialVeto).toBe(true);
      expect(decision.vetoReason).toContain("Coordinated bot activity");
    });

    it("should NOT veto when trap confidence is below 90%", () => {
      const engine = new ConsensusEngine();
      
      const opinions = createAllAgentOpinions({
        scout: { confidenceScore: 0.90 },
        macro: { confidenceScore: 0.88 },
        onchain: { confidenceScore: 0.87 },
        risk: { confidenceScore: 0.86, riskScore: 0.3 },
        // Adversarial suspects trap but not confident enough
        adversarial: { 
          confidenceScore: 0.85, 
          isTrap: true, 
          trapConfidence: 0.75, // Below 90% threshold
          trapReasons: ["Some suspicious activity"],
        },
      });

      const decision = engine.buildConsensus(opinions);
      
      expect(decision.adversarialVeto).toBe(false);
      // Could still be EXECUTE if other conditions met
    });

    it("should use custom veto threshold when configured", () => {
      const config: Partial<ConsensusConfig> = {
        adversarialVetoThreshold: 0.80, // Lower threshold
      };
      const engine = new ConsensusEngine(config);
      
      const opinions = createAllAgentOpinions({
        scout: { confidenceScore: 0.90 },
        macro: { confidenceScore: 0.88 },
        onchain: { confidenceScore: 0.87 },
        risk: { confidenceScore: 0.86, riskScore: 0.25 },
        adversarial: { 
          confidenceScore: 0.85, 
          isTrap: true, 
          trapConfidence: 0.82, // Above 80% custom threshold
          trapReasons: ["Suspicious"],
        },
      });

      const decision = engine.buildConsensus(opinions);
      
      expect(decision.status).toBe("REJECT");
      expect(decision.adversarialVeto).toBe(true);
    });
  });

  describe("Minimum Agents", () => {
    it("should require minimum agents for consensus", () => {
      const engine = new ConsensusEngine({ minAgentsRequired: 3 });
      
      // Only 2 agents
      const opinions = [
        createOpinion("scout", { confidenceScore: 0.90 }),
        createOpinion("macro", { confidenceScore: 0.88 }),
      ];

      const decision = engine.buildConsensus(opinions);
      
      expect(decision.status).toBe("NEED_MORE_DATA");
      expect(decision.rationale).toContain("Insufficient agents");
    });
  });

  describe("Agreement Score", () => {
    it("should require minimum agreement between agents", () => {
      const engine = new ConsensusEngine({ agreementThreshold: 0.6 });
      
      // Agents disagree
      const opinions = createAllAgentOpinions({
        scout: { recommendation: "buy", confidenceScore: 0.90 },
        macro: { recommendation: "sell", confidenceScore: 0.88 },
        onchain: { recommendation: "hold", confidenceScore: 0.87 },
        risk: { recommendation: "avoid", confidenceScore: 0.86, riskScore: 0.3 },
        adversarial: { recommendation: "monitor", confidenceScore: 0.85, isTrap: false, trapConfidence: 0.1 },
      });

      const decision = engine.buildConsensus(opinions);
      
      // Low agreement should prevent EXECUTE
      expect(decision.agreementScore).toBeLessThan(0.6);
      expect(decision.status).not.toBe("EXECUTE");
    });
  });

  describe("Risk Score", () => {
    it("should REJECT when average risk score is too high", () => {
      const engine = new ConsensusEngine();
      
      const opinions = createAllAgentOpinions({
        scout: { confidenceScore: 0.90, riskScore: 0.8 },
        macro: { confidenceScore: 0.88, riskScore: 0.75 },
        onchain: { confidenceScore: 0.87, riskScore: 0.85 },
        risk: { confidenceScore: 0.86, riskScore: 0.9 },
        adversarial: { confidenceScore: 0.85, riskScore: 0.7, isTrap: false, trapConfidence: 0.2 },
      });

      const decision = engine.buildConsensus(opinions);
      
      expect(decision.status).toBe("REJECT");
      expect(decision.averageRiskScore).toBeGreaterThan(0.7);
    });
  });

  describe("Hold/Avoid Recommendations", () => {
    it("should REJECT when majority recommends hold", () => {
      const engine = new ConsensusEngine();
      
      const opinions = createAllAgentOpinions({
        scout: { recommendation: "hold", confidenceScore: 0.90 },
        macro: { recommendation: "hold", confidenceScore: 0.88 },
        onchain: { recommendation: "hold", confidenceScore: 0.87 },
        risk: { recommendation: "hold", confidenceScore: 0.86, riskScore: 0.3 },
        adversarial: { recommendation: "hold", confidenceScore: 0.85, isTrap: false, trapConfidence: 0.1 },
      });

      const decision = engine.buildConsensus(opinions);
      
      expect(decision.status).toBe("REJECT");
      expect(decision.recommendation).toBe("hold");
    });

    it("should REJECT when majority recommends avoid", () => {
      const engine = new ConsensusEngine();
      
      const opinions = createAllAgentOpinions({
        scout: { recommendation: "avoid", confidenceScore: 0.90 },
        macro: { recommendation: "avoid", confidenceScore: 0.88 },
        onchain: { recommendation: "avoid", confidenceScore: 0.87 },
        risk: { recommendation: "avoid", confidenceScore: 0.86, riskScore: 0.3 },
        adversarial: { recommendation: "avoid", confidenceScore: 0.85, isTrap: false, trapConfidence: 0.1 },
      });

      const decision = engine.buildConsensus(opinions);
      
      expect(decision.status).toBe("REJECT");
      expect(decision.recommendation).toBe("avoid");
    });
  });
});
