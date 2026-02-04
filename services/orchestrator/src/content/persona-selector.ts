/**
 * Persona Selector
 * 
 * Selects appropriate persona based on token characteristics.
 * Outputs consistent style for content generation.
 */

import { orchestratorLogger as logger } from "@neuro/shared";
import type {
  PersonaInput,
  PersonaProfile,
  TokenTag,
  VolatilityLevel,
  AudienceType,
  ToneLevel,
  WritingStyle,
} from "./types.js";

const personaLogger = logger.child({ component: "persona-selector" });

// ============================================
// PREDEFINED PERSONAS
// ============================================

/**
 * Predefined persona profiles for different contexts
 */
export const PERSONAS: Record<string, PersonaProfile> = {
  // Technical/Infrastructure persona
  TECH_ANALYST: {
    id: "tech_analyst",
    name: "Tech Analyst",
    baseTone: "neutral",
    writingStyle: "technical",
    preferredTerms: [
      "architecture", "consensus", "throughput", "latency",
      "optimization", "protocol", "implementation", "benchmark",
    ],
    avoidedTerms: [
      "moon", "lambo", "wagmi", "ngmi", "pump", "dump",
    ],
    emojiFrequency: "minimal",
    preferredEmojis: ["🔧", "⚙️", "📊", "🔬", "💡"],
    preferredHashtags: ["#Monad", "#DeFi", "#Tech", "#OnChain"],
    maxHashtags: 3,
    threadPreference: "thread",
    templateIds: ["technical_thread", "release_notes", "analysis"],
    maxPostLength: 280,
    requiresDataCitation: true,
  },

  // Meme/Community persona
  MEME_ENTHUSIAST: {
    id: "meme_enthusiast",
    name: "Meme Enthusiast",
    baseTone: "neutral",
    writingStyle: "meme",
    preferredTerms: [
      "vibes", "chad", "based", "anon", "fren",
      "bullish", "comfy", "gm", "gn",
    ],
    avoidedTerms: [
      "guarantee", "certain", "definitely", "100%", "trust me",
    ],
    emojiFrequency: "heavy",
    preferredEmojis: ["🚀", "💜", "🔥", "👀", "😤", "🫡", "💪"],
    preferredHashtags: ["#Monad", "#MonadCommunity"],
    maxHashtags: 2,
    threadPreference: "single",
    templateIds: ["meme_post", "alert"],
    maxPostLength: 200,
    requiresDataCitation: false,
  },

  // DeFi/Trading persona
  DEFI_STRATEGIST: {
    id: "defi_strategist",
    name: "DeFi Strategist",
    baseTone: "cautious",
    writingStyle: "professional",
    preferredTerms: [
      "liquidity", "yield", "TVL", "APY", "position",
      "exposure", "risk-adjusted", "alpha", "inefficiency",
    ],
    avoidedTerms: [
      "guaranteed returns", "risk-free", "easy money", "can't lose",
    ],
    emojiFrequency: "minimal",
    preferredEmojis: ["📈", "💹", "🎯", "⚖️", "🔐"],
    preferredHashtags: ["#DeFi", "#Monad", "#OnChainAnalysis"],
    maxHashtags: 3,
    threadPreference: "both",
    templateIds: ["technical_thread", "analysis", "alert"],
    maxPostLength: 280,
    requiresDataCitation: true,
  },

  // Educational persona
  EDUCATOR: {
    id: "educator",
    name: "Educator",
    baseTone: "neutral",
    writingStyle: "educational",
    preferredTerms: [
      "explained", "breakdown", "here's how", "understanding",
      "fundamentals", "concept", "learn", "guide",
    ],
    avoidedTerms: [
      "obvious", "simple", "everyone knows", "duh",
    ],
    emojiFrequency: "moderate",
    preferredEmojis: ["📚", "🎓", "💡", "🧵", "👇", "1️⃣", "2️⃣", "3️⃣"],
    preferredHashtags: ["#Monad", "#CryptoEducation", "#DeFi101"],
    maxHashtags: 3,
    threadPreference: "thread",
    templateIds: ["technical_thread", "release_notes"],
    maxPostLength: 280,
    requiresDataCitation: true,
  },

  // Degen persona (high risk tolerance audience)
  DEGEN_ANALYST: {
    id: "degen_analyst",
    name: "Degen Analyst",
    baseTone: "confident",
    writingStyle: "casual",
    preferredTerms: [
      "alpha", "opportunity", "early", "signal",
      "momentum", "flow", "action", "move",
    ],
    avoidedTerms: [
      "guaranteed", "sure thing", "free money", "can't miss",
      "financial advice", "you should buy",
    ],
    emojiFrequency: "moderate",
    preferredEmojis: ["🔥", "👀", "⚡", "🎯", "📡"],
    preferredHashtags: ["#Monad", "#Alpha", "#OnChain"],
    maxHashtags: 2,
    threadPreference: "single",
    templateIds: ["meme_post", "analysis", "alert"],
    maxPostLength: 240,
    requiresDataCitation: true,
  },
};

// ============================================
// PERSONA SELECTION LOGIC
// ============================================

interface SelectionScore {
  personaId: string;
  score: number;
  reasons: string[];
}

export class PersonaSelector {
  private readonly personas: Map<string, PersonaProfile>;

  constructor(customPersonas?: Record<string, PersonaProfile>) {
    this.personas = new Map(Object.entries({
      ...PERSONAS,
      ...customPersonas,
    }));

    personaLogger.info({
      personaCount: this.personas.size,
    }, "PersonaSelector initialized");
  }

  /**
   * Select the best persona for given input
   */
  selectPersona(input: PersonaInput): PersonaProfile {
    const scores = this.scoreAllPersonas(input);
    
    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);
    
    const best = scores[0];
    const persona = this.personas.get(best.personaId)!;

    personaLogger.info({
      tokenName: input.tokenName,
      selectedPersona: persona.name,
      score: best.score,
      reasons: best.reasons,
    }, "Persona selected");

    return { ...persona };
  }

  /**
   * Get persona by ID
   */
  getPersona(id: string): PersonaProfile | undefined {
    return this.personas.get(id);
  }

  /**
   * List all available personas
   */
  listPersonas(): PersonaProfile[] {
    return Array.from(this.personas.values());
  }

  /**
   * Score all personas for given input
   */
  private scoreAllPersonas(input: PersonaInput): SelectionScore[] {
    const scores: SelectionScore[] = [];

    for (const [id, persona] of this.personas) {
      const { score, reasons } = this.scorePersona(persona, input);
      scores.push({ personaId: id, score, reasons });
    }

    return scores;
  }

  /**
   * Score a single persona against input
   */
  private scorePersona(
    persona: PersonaProfile,
    input: PersonaInput
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // Tag matching
    const tagScore = this.scoreTagMatch(persona, input.tags);
    score += tagScore.score;
    reasons.push(...tagScore.reasons);

    // Volatility matching
    const volScore = this.scoreVolatilityMatch(persona, input.volatility);
    score += volScore.score;
    reasons.push(...volScore.reasons);

    // Audience matching
    const audScore = this.scoreAudienceMatch(persona, input.audience);
    score += audScore.score;
    reasons.push(...audScore.reasons);

    return { score, reasons };
  }

  /**
   * Score based on tag matching
   */
  private scoreTagMatch(
    persona: PersonaProfile,
    tags: TokenTag[]
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // Tech tags -> Tech Analyst or Educator
    if (tags.includes("tech") || tags.includes("infra")) {
      if (persona.id === "tech_analyst") {
        score += 30;
        reasons.push("Tech tag matches Tech Analyst");
      } else if (persona.id === "educator") {
        score += 20;
        reasons.push("Tech tag fits Educator");
      }
    }

    // Meme tag -> Meme Enthusiast
    if (tags.includes("meme")) {
      if (persona.id === "meme_enthusiast") {
        score += 40;
        reasons.push("Meme tag matches Meme Enthusiast");
      } else if (persona.id === "degen_analyst") {
        score += 15;
        reasons.push("Meme can work with Degen");
      }
    }

    // DeFi tag -> DeFi Strategist
    if (tags.includes("defi")) {
      if (persona.id === "defi_strategist") {
        score += 35;
        reasons.push("DeFi tag matches DeFi Strategist");
      } else if (persona.id === "tech_analyst") {
        score += 15;
        reasons.push("DeFi technical overlap");
      }
    }

    // Gaming/NFT -> more casual
    if (tags.includes("gaming") || tags.includes("nft")) {
      if (persona.writingStyle === "casual" || persona.writingStyle === "meme") {
        score += 20;
        reasons.push("Gaming/NFT fits casual style");
      }
    }

    // AI tag -> technical or educational
    if (tags.includes("ai")) {
      if (persona.id === "tech_analyst" || persona.id === "educator") {
        score += 25;
        reasons.push("AI tag fits technical/educational");
      }
    }

    return { score, reasons };
  }

  /**
   * Score based on volatility
   */
  private scoreVolatilityMatch(
    persona: PersonaProfile,
    volatility: VolatilityLevel
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // High volatility -> cautious personas
    if (volatility === "high" || volatility === "extreme") {
      if (persona.baseTone === "cautious" || persona.baseTone === "very_cautious") {
        score += 25;
        reasons.push("High volatility needs cautious tone");
      }
      if (persona.id === "defi_strategist") {
        score += 10;
        reasons.push("DeFi Strategist handles volatility");
      }
    }

    // Low volatility -> can be more confident
    if (volatility === "low") {
      if (persona.baseTone === "neutral" || persona.baseTone === "confident") {
        score += 15;
        reasons.push("Low volatility allows confident tone");
      }
    }

    // Medium volatility -> neutral is best
    if (volatility === "medium") {
      if (persona.baseTone === "neutral") {
        score += 15;
        reasons.push("Medium volatility fits neutral tone");
      }
    }

    return { score, reasons };
  }

  /**
   * Score based on audience
   */
  private scoreAudienceMatch(
    persona: PersonaProfile,
    audience: AudienceType
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    switch (audience) {
      case "retail":
        if (persona.id === "educator" || persona.writingStyle === "educational") {
          score += 25;
          reasons.push("Retail audience needs education");
        }
        break;

      case "degen":
        if (persona.id === "degen_analyst" || persona.id === "meme_enthusiast") {
          score += 30;
          reasons.push("Degen audience matches style");
        }
        break;

      case "institutional":
        if (persona.writingStyle === "professional" || persona.writingStyle === "technical") {
          score += 30;
          reasons.push("Institutional needs professional tone");
        }
        break;

      case "developer":
        if (persona.id === "tech_analyst") {
          score += 35;
          reasons.push("Developer audience matches Tech Analyst");
        }
        break;

      case "general":
        if (persona.writingStyle === "educational" || persona.writingStyle === "casual") {
          score += 15;
          reasons.push("General audience needs accessible style");
        }
        break;
    }

    return { score, reasons };
  }

  /**
   * Adjust persona tone based on confidence score
   * Turkish: "confidenceScore ile senkronize et"
   */
  adjustToneForConfidence(
    persona: PersonaProfile,
    confidenceScore: number
  ): PersonaProfile {
    const adjusted = { ...persona };

    // Map confidence to tone
    if (confidenceScore < 0.6) {
      adjusted.baseTone = "very_cautious";
    } else if (confidenceScore < 0.75) {
      adjusted.baseTone = "cautious";
    } else if (confidenceScore < 0.85) {
      adjusted.baseTone = "neutral";
    } else if (confidenceScore < 0.95) {
      adjusted.baseTone = "confident";
    } else {
      adjusted.baseTone = "very_confident";
    }

    personaLogger.debug({
      originalTone: persona.baseTone,
      adjustedTone: adjusted.baseTone,
      confidenceScore,
    }, "Tone adjusted for confidence");

    return adjusted;
  }
}

/**
 * Factory function
 */
export function createPersonaSelector(
  customPersonas?: Record<string, PersonaProfile>
): PersonaSelector {
  return new PersonaSelector(customPersonas);
}
