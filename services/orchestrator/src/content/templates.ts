/**
 * Post Templates
 * 
 * Templates for different content types:
 * - Technical thread
 * - Meme-style post
 * - Release notes
 * - Analysis
 * - Alert
 */

import type {
  PostTemplate,
  ToneLevel,
  WritingStyle,
} from "./types.js";

// ============================================
// TEMPLATE DEFINITIONS
// ============================================

export const POST_TEMPLATES: Record<string, PostTemplate> = {
  // ============================================
  // TECHNICAL THREAD
  // ============================================
  TECHNICAL_THREAD: {
    id: "technical_thread",
    type: "technical_thread",
    name: "Technical Thread",
    description: "Multi-tweet thread with technical analysis",
    structure: [
      "hook_tweet",      // Attention-grabbing opener with data point
      "context_tweet",   // Background and why this matters
      "data_tweet_1",    // First key data point with on-chain fact
      "data_tweet_2",    // Second key data point
      "analysis_tweet",  // What the data means
      "conclusion_tweet", // Summary with disclosure
    ],
    minLength: 200,
    maxLength: 1600, // ~280 * 6 tweets
    requiresData: true,
    compatibleTones: ["cautious", "neutral", "confident"],
    compatibleStyles: ["technical", "professional", "educational"],
    example: `🧵 Thread: Analyzing $TOKEN on-chain metrics

On-chain data shows interesting developments...

1/ Current state:
⛽ Gas: 10 gwei
💧 Liquidity depth: Deep (2.5M MON)

2/ What the metrics indicate:
The data points to increasing activity...

3/ Key observations:
- Holder growth: +15% this week
- Volume trending up

4/ Summary:
Based on current data, metrics show [trend]

🤖 [NEURO AI Analysis - NFA]`,
  },

  // ============================================
  // MEME-STYLE POST
  // ============================================
  MEME_POST: {
    id: "meme_post",
    type: "meme_post",
    name: "Meme Post",
    description: "Short, engaging post with meme energy",
    structure: [
      "hook",           // Catchy opener
      "observation",    // What's happening (with data)
      "reaction",       // Community-style reaction
      "disclosure",     // Required disclosure
    ],
    minLength: 50,
    maxLength: 240,
    requiresData: false,
    compatibleTones: ["neutral", "confident", "very_confident"],
    compatibleStyles: ["meme", "casual"],
    example: `$TOKEN vibes rn 💜

On-chain data shows liquidity depth looking healthy at 1.2M MON

The metrics don't lie frens 👀

🤖 NEURO AI | NFA`,
  },

  // ============================================
  // RELEASE NOTES
  // ============================================
  RELEASE_NOTES: {
    id: "release_notes",
    type: "release_notes",
    name: "Release Notes",
    description: "Structured update about new developments",
    structure: [
      "header",         // What's new
      "features",       // Key features/changes
      "technical_details", // Technical specifics
      "impact",         // What this means
      "call_to_action", // What to do (non-shill)
      "disclosure",     // Required disclosure
    ],
    minLength: 150,
    maxLength: 1000,
    requiresData: false,
    compatibleTones: ["neutral", "confident"],
    compatibleStyles: ["technical", "professional", "educational"],
    example: `📢 Analysis Update: $TOKEN

What's new in the data:
• Liquidity pool expanded
• New holder addresses detected
• Volume metrics updated

Technical details:
Based on on-chain data, the metrics show [analysis]

Impact assessment:
The data suggests [interpretation]

Full analysis: [link]

🤖 [NEURO AI Automated Analysis - Not Financial Advice]`,
  },

  // ============================================
  // ANALYSIS POST
  // ============================================
  ANALYSIS: {
    id: "analysis",
    type: "analysis",
    name: "Analysis",
    description: "Single-tweet analysis with key metrics",
    structure: [
      "hook",           // What we're analyzing
      "key_metric",     // Most important data point
      "interpretation", // What it means
      "disclosure",     // Required disclosure
    ],
    minLength: 100,
    maxLength: 280,
    requiresData: true,
    compatibleTones: ["cautious", "neutral", "confident"],
    compatibleStyles: ["technical", "professional", "educational", "casual"],
    example: `$TOKEN Analysis 📊

On-chain data shows:
⛽ Gas: 8 gwei
💧 Liquidity: Deep
📈 24h Vol: +23%

The metrics indicate healthy activity patterns

🤖 NEURO AI | NFA`,
  },

  // ============================================
  // ALERT POST
  // ============================================
  ALERT: {
    id: "alert",
    type: "alert",
    name: "Alert",
    description: "Time-sensitive observation about market activity",
    structure: [
      "alert_header",   // What triggered the alert
      "data_point",     // Specific metric
      "context",        // What this means
      "disclosure",     // Required disclosure
    ],
    minLength: 80,
    maxLength: 240,
    requiresData: true,
    compatibleTones: ["cautious", "neutral"],
    compatibleStyles: ["technical", "professional", "casual"],
    example: `🚨 On-Chain Alert: $TOKEN

Metrics indicate unusual activity:
📊 Volume spike: +150% in 1h
💧 Liquidity still stable

Data suggests increased interest - DYOR

🤖 NEURO AI Alert | NFA`,
  },
};

// ============================================
// TEMPLATE PARTS
// ============================================

/**
 * Reusable template parts based on tone
 */
export const TEMPLATE_PARTS = {
  // Hooks by tone
  hooks: {
    very_cautious: [
      "Looking at early signals for $TOKEN...",
      "Initial observations on $TOKEN (speculative):",
      "Worth monitoring: $TOKEN metrics",
    ],
    cautious: [
      "Analyzing $TOKEN on-chain data:",
      "Interesting developments with $TOKEN:",
      "On-chain metrics update for $TOKEN:",
    ],
    neutral: [
      "📊 $TOKEN Analysis:",
      "On-chain data shows for $TOKEN:",
      "Metrics breakdown: $TOKEN",
    ],
    confident: [
      "Strong signals from $TOKEN on-chain data:",
      "📈 $TOKEN metrics looking notable:",
      "Clear patterns emerging for $TOKEN:",
    ],
    very_confident: [
      "🔥 Compelling data from $TOKEN:",
      "Exceptional metrics from $TOKEN:",
      "All indicators align for $TOKEN:",
    ],
  },

  // Interpretations by tone
  // Turkish: "Kesin olmamakla birlikte bir trend seziyorum" vs "Veriler çok güçlü bir sinyal veriyor"
  interpretations: {
    very_cautious: [
      "Very early - more data needed",
      "Highly speculative at this stage",
      "Insufficient data for conclusions",
    ],
    cautious: [
      "While not certain, sensing a possible trend",
      "Early indicators worth watching",
      "Data suggests potential, but proceed carefully",
    ],
    neutral: [
      "The data points to interesting activity",
      "Metrics indicate noteworthy patterns",
      "Analysis suggests developing momentum",
    ],
    confident: [
      "Data shows a strong signal in this direction",
      "Clear pattern supported by on-chain evidence",
      "High confidence in this assessment",
    ],
    very_confident: [
      "Exceptional metrics across all indicators",
      "Overwhelming data supports this observation",
      "Multiple confirmations align strongly",
    ],
  },

  // Closers with disclosure
  closers: {
    thread: "\n\n🧵 End thread\n🤖 [NEURO AI Analysis Thread - Not Financial Advice]",
    single: "\n\n🤖 NEURO AI | NFA",
    full: "\n\n🤖 [NEURO AI Autonomous Post - Not Financial Advice]",
    alert: "\n\n🤖 NEURO AI Alert | NFA",
  },

  // Data injection templates
  dataInjections: {
    gas: "⛽ Gas: {value} gwei",
    liquidity: "💧 Liquidity: {depth} ({value})",
    volume: "📊 24h Volume: {value}",
    holders: "👥 Holders: {value}",
    price: "💰 Price: ${value}",
    priceChange: "📈 {direction}: {value}%",
    block: "🔗 Block: #{value}",
  },
};

// ============================================
// TEMPLATE HELPERS
// ============================================

/**
 * Get template by ID
 */
export function getTemplate(templateId: string): PostTemplate | undefined {
  return POST_TEMPLATES[templateId.toUpperCase()] || 
         Object.values(POST_TEMPLATES).find(t => t.id === templateId);
}

/**
 * Get templates compatible with tone
 */
export function getTemplatesForTone(tone: ToneLevel): PostTemplate[] {
  return Object.values(POST_TEMPLATES).filter(
    t => t.compatibleTones.includes(tone)
  );
}

/**
 * Get templates compatible with style
 */
export function getTemplatesForStyle(style: WritingStyle): PostTemplate[] {
  return Object.values(POST_TEMPLATES).filter(
    t => t.compatibleStyles.includes(style)
  );
}

/**
 * Get random hook for tone
 */
export function getRandomHook(tone: ToneLevel): string {
  const hooks = TEMPLATE_PARTS.hooks[tone];
  return hooks[Math.floor(Math.random() * hooks.length)];
}

/**
 * Get random interpretation for tone
 */
export function getRandomInterpretation(tone: ToneLevel): string {
  const interpretations = TEMPLATE_PARTS.interpretations[tone];
  return interpretations[Math.floor(Math.random() * interpretations.length)];
}

/**
 * Get appropriate closer
 */
export function getCloser(type: "thread" | "single" | "full" | "alert"): string {
  return TEMPLATE_PARTS.closers[type];
}
