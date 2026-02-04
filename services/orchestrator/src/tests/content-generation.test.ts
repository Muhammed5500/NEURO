/**
 * Content Generation Tests
 * 
 * Tests for persona selection and content generation with:
 * - Persona consistency
 * - Content policy compliance
 * - Confidence-linked tone
 * - On-chain fact injection
 * - Disclosure requirements
 * 
 * Acceptance Criteria:
 * - Persona engine outputs consistent style
 * - Generated posts include disclosures and avoid prohibited claims
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createPersonaSelector,
  PersonaSelector,
  createContentPolicyEngine,
  ContentPolicyEngine,
  createContentGenerator,
  ContentGenerator,
  POST_TEMPLATES,
  CONFIDENCE_TONE_MAPPINGS,
  DEFAULT_DISCLOSURE,
  type PersonaInput,
  type OnChainFacts,
} from "../content/index.js";

// ============================================
// PERSONA SELECTOR TESTS
// ============================================

describe("PersonaSelector", () => {
  let selector: PersonaSelector;

  beforeEach(() => {
    selector = createPersonaSelector();
  });

  describe("selectPersona", () => {
    it("should select Tech Analyst for tech tags", () => {
      // Acceptance criteria: "Persona engine outputs consistent style"
      const input: PersonaInput = {
        tokenName: "TechToken",
        tokenSymbol: "TECH",
        tags: ["tech", "infra"],
        volatility: "medium",
        audience: "developer",
      };

      const persona = selector.selectPersona(input);

      expect(persona.id).toBe("tech_analyst");
      expect(persona.writingStyle).toBe("technical");
    });

    it("should select Meme Enthusiast for meme tags", () => {
      const input: PersonaInput = {
        tokenName: "MemeToken",
        tokenSymbol: "MEME",
        tags: ["meme"],
        volatility: "high",
        audience: "degen",
      };

      const persona = selector.selectPersona(input);

      expect(persona.id).toBe("meme_enthusiast");
      expect(persona.writingStyle).toBe("meme");
    });

    it("should select DeFi Strategist for defi tags", () => {
      const input: PersonaInput = {
        tokenName: "DeFiToken",
        tokenSymbol: "DEFI",
        tags: ["defi"],
        volatility: "medium",
        audience: "institutional",
      };

      const persona = selector.selectPersona(input);

      expect(persona.id).toBe("defi_strategist");
      expect(persona.writingStyle).toBe("professional");
    });

    it("should output consistent style elements", () => {
      // Acceptance criteria: "Persona engine outputs consistent style"
      const input: PersonaInput = {
        tokenName: "TestToken",
        tokenSymbol: "TEST",
        tags: ["tech"],
        volatility: "low",
        audience: "general",
      };

      const persona = selector.selectPersona(input);

      // Should have all required style elements
      expect(persona.baseTone).toBeDefined();
      expect(persona.writingStyle).toBeDefined();
      expect(persona.preferredTerms).toBeInstanceOf(Array);
      expect(persona.avoidedTerms).toBeInstanceOf(Array);
      expect(persona.preferredEmojis).toBeInstanceOf(Array);
      expect(persona.templateIds).toBeInstanceOf(Array);
    });
  });

  describe("adjustToneForConfidence", () => {
    it("should adjust to very_cautious for low confidence", () => {
      // Turkish: "güven skoru 0.85 ise temkinli"
      const input: PersonaInput = {
        tokenName: "Test",
        tokenSymbol: "TEST",
        tags: ["tech"],
        volatility: "medium",
        audience: "general",
      };

      const persona = selector.selectPersona(input);
      const adjusted = selector.adjustToneForConfidence(persona, 0.5);

      expect(adjusted.baseTone).toBe("very_cautious");
    });

    it("should adjust to cautious for 0.6-0.75 confidence", () => {
      const input: PersonaInput = {
        tokenName: "Test",
        tokenSymbol: "TEST",
        tags: ["tech"],
        volatility: "medium",
        audience: "general",
      };

      const persona = selector.selectPersona(input);
      const adjusted = selector.adjustToneForConfidence(persona, 0.7);

      expect(adjusted.baseTone).toBe("cautious");
    });

    it("should adjust to confident for high confidence", () => {
      // Turkish: "0.95 ise emin bir dil"
      const input: PersonaInput = {
        tokenName: "Test",
        tokenSymbol: "TEST",
        tags: ["tech"],
        volatility: "medium",
        audience: "general",
      };

      const persona = selector.selectPersona(input);
      const adjusted = selector.adjustToneForConfidence(persona, 0.9);

      expect(adjusted.baseTone).toBe("confident");
    });
  });
});

// ============================================
// CONTENT POLICY TESTS
// ============================================

describe("ContentPolicyEngine", () => {
  let engine: ContentPolicyEngine;

  beforeEach(() => {
    engine = createContentPolicyEngine();
  });

  describe("checkContent - Prohibited Claims", () => {
    it("should detect guaranteed returns language", () => {
      // Acceptance criteria: "avoid prohibited claims"
      const content = "This token has guaranteed returns! Buy now for 100% profit!";
      const result = engine.checkContent(content, false);

      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.type === "guaranteed_returns")).toBe(true);
    });

    it("should detect shill language", () => {
      // Turkish: "No-Shill Policy"
      const content = "Buy now before it's too late! Ape in immediately!";
      const result = engine.checkContent(content, false);

      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.type === "shill_language")).toBe(true);
    });

    it("should detect FOMO-inducing language", () => {
      const content = "Last chance! Don't miss this opportunity! Act fast!";
      const result = engine.checkContent(content, false);

      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.type === "fomo_inducing")).toBe(true);
    });

    it("should detect price predictions", () => {
      const content = "This token will reach $100 by next month!";
      const result = engine.checkContent(content, false);

      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.type === "price_prediction")).toBe(true);
    });

    it("should detect impersonation attempts", () => {
      const content = "We are the official team and this is endorsed by Monad";
      const result = engine.checkContent(content, false);

      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.type === "impersonation")).toBe(true);
    });
  });

  describe("checkContent - Analytical Approach", () => {
    it("should warn when missing analytical phrases", () => {
      // Turkish: "analitik bir yaklaşım zorunlu"
      const content = "This token looks interesting! Check it out!";
      const result = engine.checkContent(content, true);

      expect(result.warnings.some(w => w.type === "missing_analytical_approach")).toBe(true);
    });

    it("should pass when analytical phrases present", () => {
      const content = "On-chain data shows interesting activity patterns. 🤖 NEURO AI | NFA";
      const result = engine.checkContent(content, true);

      expect(result.warnings.some(w => w.type === "missing_analytical_approach")).toBe(false);
    });
  });

  describe("checkContent - Disclosure", () => {
    it("should require disclosure", () => {
      // Acceptance criteria: "Generated posts include disclosures"
      const content = "Analysis of $TOKEN metrics shows interesting patterns";
      const result = engine.checkContent(content, false);

      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.type === "missing_disclosure")).toBe(true);
    });

    it("should pass with disclosure", () => {
      // Turkish: "[NEURO AI Autonomous Post - Not Financial Advice]"
      const content = "On-chain data shows patterns. 🤖 [NEURO AI Autonomous Post - Not Financial Advice]";
      const result = engine.checkContent(content, true);

      expect(result.violations.some(v => v.type === "missing_disclosure")).toBe(false);
    });
  });

  describe("addDisclosure", () => {
    it("should add disclosure to content", () => {
      // Turkish: "Her paylaşımın sonuna otomatik olarak şeffaflık ibaresi ekle"
      const content = "Analysis of $TOKEN";
      const withDisclosure = engine.addDisclosure(content);

      expect(withDisclosure).toContain("NEURO AI");
      expect(withDisclosure).toContain("Not Financial Advice");
    });

    it("should not double-add disclosure", () => {
      const content = "Analysis 🤖 NEURO AI | NFA";
      const withDisclosure = engine.addDisclosure(content);

      expect(withDisclosure).toBe(content);
    });
  });

  describe("sanitizeContent", () => {
    it("should replace prohibited phrases", () => {
      const content = "Buy now before it moons! Guaranteed returns!";
      const { sanitized, changesApplied } = engine.sanitizeContent(content);

      expect(sanitized).not.toContain("buy now");
      expect(sanitized).not.toContain("guaranteed returns");
      expect(changesApplied.length).toBeGreaterThan(0);
    });
  });
});

// ============================================
// CONTENT GENERATOR TESTS
// ============================================

describe("ContentGenerator", () => {
  let generator: ContentGenerator;

  beforeEach(() => {
    generator = createContentGenerator({
      enforcePolicy: false, // Disable for testing individual features
      alwaysAddDisclosure: true,
    });
  });

  describe("getToneForConfidence", () => {
    it("should return very_cautious for low confidence", () => {
      expect(generator.getToneForConfidence(0.5)).toBe("very_cautious");
    });

    it("should return cautious for 0.6-0.75", () => {
      // Turkish: "Kesin olmamakla birlikte bir trend seziyorum"
      expect(generator.getToneForConfidence(0.7)).toBe("cautious");
    });

    it("should return neutral for 0.75-0.85", () => {
      expect(generator.getToneForConfidence(0.8)).toBe("neutral");
    });

    it("should return confident for 0.85-0.95", () => {
      // Turkish: "Veriler çok güçlü bir sinyal veriyor"
      expect(generator.getToneForConfidence(0.9)).toBe("confident");
    });

    it("should return very_confident for 0.95+", () => {
      expect(generator.getToneForConfidence(0.98)).toBe("very_confident");
    });
  });

  describe("formatOnChainFacts", () => {
    it("should format on-chain facts correctly", () => {
      // Turkish: "Monad ana ağından çekilen gerçek verileri entegre et"
      const facts: OnChainFacts = {
        currentGasGwei: 10,
        blockNumber: 12345,
        networkCongestion: "low",
        poolLiquidity: "2.5M MON",
        liquidityDepth: "deep",
        fetchedAt: Date.now(),
      };

      const formatted = generator.formatOnChainFacts(facts);

      expect(formatted).toContain("Gas: 10 gwei");
      expect(formatted).toContain("Liquidity: Deep (2.5M MON)");
    });
  });

  describe("generatePost", () => {
    it("should generate analysis post with disclosure", async () => {
      // Acceptance criteria: "Generated posts include disclosures"
      const persona = createPersonaSelector().selectPersona({
        tokenName: "TestToken",
        tokenSymbol: "TEST",
        tags: ["tech"],
        volatility: "medium",
        audience: "general",
      });

      const post = await generator.generatePost(
        "analysis",
        persona,
        0.8,
        {
          tokenName: "TestToken",
          tokenSymbol: "TEST",
        }
      );

      expect(post.contentWithDisclosure).toContain("NEURO AI");
      expect(post.template).toBe("analysis");
      expect(post.tone).toBe("neutral"); // 0.8 confidence = neutral
    });

    it("should include on-chain facts when provided", async () => {
      // Turkish: "gerçek verileri entegre et"
      const persona = createPersonaSelector().selectPersona({
        tokenName: "TestToken",
        tokenSymbol: "TEST",
        tags: ["defi"],
        volatility: "medium",
        audience: "general",
      });

      const facts: OnChainFacts = {
        currentGasGwei: 15,
        blockNumber: 99999,
        networkCongestion: "medium",
        poolLiquidity: "1M MON",
        liquidityDepth: "moderate",
        fetchedAt: Date.now(),
      };

      const post = await generator.generatePost(
        "analysis",
        persona,
        0.85,
        {
          tokenName: "TestToken",
          tokenSymbol: "TEST",
        },
        facts
      );

      expect(post.content).toContain("15 gwei");
      expect(post.factsIncluded).toContain("gas");
      expect(post.factsIncluded).toContain("liquidity");
    });

    it("should generate thread for technical_thread template", async () => {
      const persona = createPersonaSelector().selectPersona({
        tokenName: "TestToken",
        tokenSymbol: "TEST",
        tags: ["tech"],
        volatility: "low",
        audience: "developer",
      });

      const post = await generator.generatePost(
        "technical_thread",
        persona,
        0.9,
        {
          tokenName: "TestToken",
          tokenSymbol: "TEST",
          keyInsights: ["Insight 1", "Insight 2"],
        }
      );

      expect(post.isThread).toBe(true);
      expect(post.threadParts).toBeDefined();
      expect(post.threadParts!.length).toBeGreaterThan(1);
    });

    it("should adjust tone based on confidence score", async () => {
      // Turkish: "confidenceScore ile senkronize et"
      const persona = createPersonaSelector().selectPersona({
        tokenName: "TestToken",
        tokenSymbol: "TEST",
        tags: ["tech"],
        volatility: "medium",
        audience: "general",
      });

      // Low confidence
      const lowConfidencePost = await generator.generatePost(
        "analysis",
        persona,
        0.55,
        { tokenName: "TestToken", tokenSymbol: "TEST" }
      );
      expect(lowConfidencePost.tone).toBe("very_cautious");

      // High confidence
      const highConfidencePost = await generator.generatePost(
        "analysis",
        persona,
        0.92,
        { tokenName: "TestToken", tokenSymbol: "TEST" }
      );
      expect(highConfidencePost.tone).toBe("confident");
    });
  });
});

// ============================================
// INTEGRATION TESTS
// ============================================

describe("Content Generation Integration", () => {
  it("should generate policy-compliant content end-to-end", async () => {
    // Full pipeline test
    const selector = createPersonaSelector();
    const policyEngine = createContentPolicyEngine();
    const generator = createContentGenerator({
      enforcePolicy: true,
      alwaysAddDisclosure: true,
    });

    // Select persona
    const persona = selector.selectPersona({
      tokenName: "IntegrationToken",
      tokenSymbol: "INT",
      tags: ["defi"],
      volatility: "medium",
      audience: "retail",
    });

    // Adjust for confidence
    const adjustedPersona = selector.adjustToneForConfidence(persona, 0.75);

    // Generate post
    const post = await generator.generatePost(
      "analysis",
      adjustedPersona,
      0.75,
      {
        tokenName: "IntegrationToken",
        tokenSymbol: "INT",
        keyInsights: ["Liquidity is growing", "Volume trending up"],
      },
      {
        currentGasGwei: 8,
        blockNumber: 123456,
        networkCongestion: "low",
        poolLiquidity: "500K MON",
        liquidityDepth: "moderate",
        fetchedAt: Date.now(),
      }
    );

    // Verify policy compliance
    // Acceptance criteria: "Generated posts include disclosures and avoid prohibited claims"
    expect(post.policyCheck.passed).toBe(true);
    expect(post.contentWithDisclosure).toContain("NEURO AI");
    
    // Should not contain prohibited language
    expect(post.contentWithDisclosure).not.toMatch(/buy now/i);
    expect(post.contentWithDisclosure).not.toMatch(/guaranteed/i);
    expect(post.contentWithDisclosure).not.toMatch(/will reach \$/i);
  });

  it("should maintain consistent style across multiple posts", async () => {
    // Acceptance criteria: "Persona engine outputs consistent style"
    const selector = createPersonaSelector();
    const generator = createContentGenerator();

    const persona = selector.selectPersona({
      tokenName: "StyleToken",
      tokenSymbol: "STYLE",
      tags: ["meme"],
      volatility: "high",
      audience: "degen",
    });

    // Generate multiple posts
    const posts = await Promise.all([
      generator.generatePost("meme_post", persona, 0.8, { tokenName: "StyleToken", tokenSymbol: "STYLE" }),
      generator.generatePost("meme_post", persona, 0.8, { tokenName: "StyleToken", tokenSymbol: "STYLE" }),
      generator.generatePost("meme_post", persona, 0.8, { tokenName: "StyleToken", tokenSymbol: "STYLE" }),
    ]);

    // All should use same persona
    posts.forEach(post => {
      expect(post.persona).toBe(persona.id);
      expect(post.template).toBe("meme_post");
    });
  });
});
