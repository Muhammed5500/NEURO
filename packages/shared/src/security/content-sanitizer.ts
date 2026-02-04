/**
 * Content Sanitization Module
 * 
 * Defense in Depth - Layer 1: Input Sanitization
 * Turkish: "Girdi seviyesinde Sanitization"
 * 
 * Three-stage pipeline:
 * 1. Encoding normalization (Unicode/base64 attacks)
 * 2. Pattern filtering (Injection patterns)
 * 3. Structural validation (Schema enforcement)
 */

import * as crypto from "crypto";

// ============================================
// SANITIZATION TYPES
// ============================================

export interface SanitizationOptions {
  /** Enable Unicode normalization */
  normalizeUnicode?: boolean;
  /** Decode base64 encoded content */
  decodeBase64?: boolean;
  /** Maximum content length */
  maxLength?: number;
  /** Remove HTML tags */
  stripHtml?: boolean;
  /** Remove control characters */
  removeControlChars?: boolean;
  /** Check for injection patterns */
  checkInjectionPatterns?: boolean;
  /** Strict mode - reject any suspicious content */
  strictMode?: boolean;
}

export interface SanitizationResult {
  /** Sanitized content */
  content: string;
  /** Whether content was modified */
  wasModified: boolean;
  /** List of removed/blocked patterns */
  blockedPatterns: string[];
  /** Risk score (0-100) */
  riskScore: number;
  /** Detailed flags */
  flags: SanitizationFlag[];
  /** Content hash for integrity */
  contentHash: string;
}

export type SanitizationFlag =
  | "UNICODE_HOMOGRAPH"
  | "BASE64_ENCODED"
  | "CONTROL_CHARACTERS"
  | "HTML_INJECTION"
  | "PROMPT_INJECTION"
  | "EXCESSIVE_LENGTH"
  | "SUSPICIOUS_ENCODING"
  | "NESTED_ENCODING"
  | "INVISIBLE_CHARACTERS";

// ============================================
// CONTENT SANITIZER
// ============================================

export class ContentSanitizer {
  private readonly defaultOptions: Required<SanitizationOptions> = {
    normalizeUnicode: true,
    decodeBase64: true,
    maxLength: 50000,
    stripHtml: true,
    removeControlChars: true,
    checkInjectionPatterns: true,
    strictMode: false,
  };

  // Unicode homograph attack characters
  private readonly homographMap = new Map<string, string>([
    ["\u0430", "a"], // Cyrillic а
    ["\u0435", "e"], // Cyrillic е
    ["\u043e", "o"], // Cyrillic о
    ["\u0440", "p"], // Cyrillic р
    ["\u0441", "c"], // Cyrillic с
    ["\u0443", "y"], // Cyrillic у
    ["\u0445", "x"], // Cyrillic х
    ["\u0456", "i"], // Cyrillic і
    ["\u04bb", "h"], // Cyrillic һ
    // Greek letters
    ["\u03b1", "a"], // Greek α
    ["\u03b5", "e"], // Greek ε
    ["\u03bf", "o"], // Greek ο
  ]);

  // Invisible/zero-width characters
  private readonly invisibleChars = [
    "\u200B", // Zero-width space
    "\u200C", // Zero-width non-joiner
    "\u200D", // Zero-width joiner
    "\uFEFF", // BOM
    "\u2060", // Word joiner
    "\u00AD", // Soft hyphen
  ];

  constructor(private options: SanitizationOptions = {}) {
    this.options = { ...this.defaultOptions, ...options };
  }

  /**
   * Main sanitization pipeline
   */
  sanitize(input: string, options?: SanitizationOptions): SanitizationResult {
    const opts = { ...this.defaultOptions, ...this.options, ...options };
    const flags: SanitizationFlag[] = [];
    const blockedPatterns: string[] = [];
    let content = input;
    let wasModified = false;
    let riskScore = 0;

    // Stage 1: Encoding Normalization
    const stage1 = this.stage1EncodingNormalization(content, opts, flags);
    content = stage1.content;
    wasModified = wasModified || stage1.modified;
    riskScore += stage1.riskIncrease;

    // Stage 2: Pattern Filtering
    if (opts.checkInjectionPatterns) {
      const stage2 = this.stage2PatternFiltering(content, flags, blockedPatterns);
      content = stage2.content;
      wasModified = wasModified || stage2.modified;
      riskScore += stage2.riskIncrease;
    }

    // Stage 3: Structural Validation
    const stage3 = this.stage3StructuralValidation(content, opts, flags);
    content = stage3.content;
    wasModified = wasModified || stage3.modified;
    riskScore += stage3.riskIncrease;

    // Cap risk score
    riskScore = Math.min(100, riskScore);

    // Generate content hash for integrity
    const contentHash = crypto.createHash("sha256").update(content).digest("hex");

    return {
      content,
      wasModified,
      blockedPatterns,
      riskScore,
      flags,
      contentHash,
    };
  }

  /**
   * Stage 1: Encoding Normalization
   * Handles Unicode tricks, base64 encoding, homograph attacks
   */
  private stage1EncodingNormalization(
    content: string,
    opts: Required<SanitizationOptions>,
    flags: SanitizationFlag[]
  ): { content: string; modified: boolean; riskIncrease: number } {
    let modified = false;
    let riskIncrease = 0;
    let result = content;

    // Unicode normalization (NFC form)
    if (opts.normalizeUnicode) {
      const normalized = result.normalize("NFC");
      if (normalized !== result) {
        modified = true;
        riskIncrease += 5;
      }
      result = normalized;
    }

    // Detect and replace homograph characters
    for (const [homograph, replacement] of this.homographMap) {
      if (result.includes(homograph)) {
        result = result.split(homograph).join(replacement);
        if (!flags.includes("UNICODE_HOMOGRAPH")) {
          flags.push("UNICODE_HOMOGRAPH");
          riskIncrease += 15;
        }
        modified = true;
      }
    }

    // Remove invisible characters
    for (const char of this.invisibleChars) {
      if (result.includes(char)) {
        result = result.split(char).join("");
        if (!flags.includes("INVISIBLE_CHARACTERS")) {
          flags.push("INVISIBLE_CHARACTERS");
          riskIncrease += 10;
        }
        modified = true;
      }
    }

    // Detect base64 encoded content (potential hidden payloads)
    if (opts.decodeBase64) {
      const base64Pattern = /\b[A-Za-z0-9+/]{20,}={0,2}\b/g;
      const matches = result.match(base64Pattern);
      
      if (matches) {
        for (const match of matches) {
          try {
            const decoded = Buffer.from(match, "base64").toString("utf8");
            // Check if decoded content is readable text
            if (this.isReadableText(decoded)) {
              // Check decoded content for injection
              if (this.containsInjectionPattern(decoded)) {
                result = result.replace(match, "[BLOCKED_BASE64]");
                flags.push("BASE64_ENCODED");
                riskIncrease += 25;
                modified = true;
              }
            }
          } catch {
            // Not valid base64, ignore
          }
        }
      }
    }

    return { content: result, modified, riskIncrease };
  }

  /**
   * Stage 2: Pattern Filtering
   * Uses AdversarialPatternDatabase
   */
  private stage2PatternFiltering(
    content: string,
    flags: SanitizationFlag[],
    blockedPatterns: string[]
  ): { content: string; modified: boolean; riskIncrease: number } {
    let modified = false;
    let riskIncrease = 0;
    let result = content;

    const patterns = AdversarialPatternDatabase.getAllPatterns();

    for (const pattern of patterns) {
      const matches = result.match(pattern.regex);
      if (matches) {
        for (const match of matches) {
          blockedPatterns.push(`${pattern.name}: ${match.substring(0, 50)}...`);
          result = result.replace(pattern.regex, "[BLOCKED]");
          riskIncrease += pattern.severity === "critical" ? 40 : 
                          pattern.severity === "high" ? 25 : 
                          pattern.severity === "medium" ? 15 : 5;
          modified = true;
        }
        if (!flags.includes("PROMPT_INJECTION")) {
          flags.push("PROMPT_INJECTION");
        }
      }
    }

    return { content: result, modified, riskIncrease };
  }

  /**
   * Stage 3: Structural Validation
   */
  private stage3StructuralValidation(
    content: string,
    opts: Required<SanitizationOptions>,
    flags: SanitizationFlag[]
  ): { content: string; modified: boolean; riskIncrease: number } {
    let modified = false;
    let riskIncrease = 0;
    let result = content;

    // Control character removal
    if (opts.removeControlChars) {
      // eslint-disable-next-line no-control-regex
      const controlCharRegex = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
      if (controlCharRegex.test(result)) {
        result = result.replace(controlCharRegex, "");
        flags.push("CONTROL_CHARACTERS");
        riskIncrease += 10;
        modified = true;
      }
    }

    // HTML stripping
    if (opts.stripHtml) {
      const htmlTagRegex = /<[^>]*>/g;
      if (htmlTagRegex.test(result)) {
        result = result.replace(htmlTagRegex, "");
        flags.push("HTML_INJECTION");
        riskIncrease += 15;
        modified = true;
      }
    }

    // Length enforcement
    if (result.length > opts.maxLength) {
      result = result.substring(0, opts.maxLength);
      flags.push("EXCESSIVE_LENGTH");
      riskIncrease += 5;
      modified = true;
    }

    return { content: result, modified, riskIncrease };
  }

  private isReadableText(text: string): boolean {
    // Check if text contains mostly printable ASCII characters
    const printableRatio = (text.match(/[\x20-\x7E]/g) || []).length / text.length;
    return printableRatio > 0.7;
  }

  private containsInjectionPattern(text: string): boolean {
    const patterns = AdversarialPatternDatabase.getAllPatterns();
    return patterns.some(p => p.regex.test(text));
  }
}

// ============================================
// ADVERSARIAL PATTERN DATABASE
// ============================================

export interface InjectionPattern {
  name: string;
  regex: RegExp;
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  category: "jailbreak" | "instruction" | "encoding" | "social";
}

/**
 * Adversarial Pattern Database
 * Turkish: "DAN, jailbreak, ignore instructions gibi paternleri içeren dinamik bir 'Yasaklılar Listesi'"
 */
export class AdversarialPatternDatabase {
  private static patterns: InjectionPattern[] = [
    // CRITICAL: Direct instruction override
    {
      name: "IGNORE_INSTRUCTIONS",
      regex: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/gi,
      severity: "critical",
      description: "Attempt to override system instructions",
      category: "instruction",
    },
    {
      name: "DISREGARD_INSTRUCTIONS",
      regex: /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/gi,
      severity: "critical",
      description: "Attempt to disregard system instructions",
      category: "instruction",
    },
    {
      name: "FORGET_INSTRUCTIONS",
      regex: /forget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/gi,
      severity: "critical",
      description: "Attempt to make AI forget instructions",
      category: "instruction",
    },

    // CRITICAL: Jailbreak patterns
    {
      name: "DAN_JAILBREAK",
      regex: /\b(DAN|Do\s+Anything\s+Now)\b/gi,
      severity: "critical",
      description: "DAN jailbreak attempt",
      category: "jailbreak",
    },
    {
      name: "DEVELOPER_MODE",
      regex: /\b(developer|dev)\s*mode\s*(enabled?|on|activate)/gi,
      severity: "critical",
      description: "Developer mode activation attempt",
      category: "jailbreak",
    },
    {
      name: "JAILBREAK_KEYWORD",
      regex: /\bjailbreak(ed|ing)?\b/gi,
      severity: "high",
      description: "Direct jailbreak mention",
      category: "jailbreak",
    },
    {
      name: "HYPOTHETICAL_BYPASS",
      regex: /hypothetically,?\s+(if|what\s+if|imagine)\s+you\s+(were|could|had)/gi,
      severity: "high",
      description: "Hypothetical scenario to bypass restrictions",
      category: "jailbreak",
    },
    {
      name: "ROLEPLAY_ATTACK",
      regex: /pretend\s+(you('re|are)|to\s+be)\s+(an?\s+)?evil|malicious|unrestricted/gi,
      severity: "critical",
      description: "Malicious roleplay request",
      category: "jailbreak",
    },

    // HIGH: Instruction manipulation
    {
      name: "SYSTEM_PROMPT_ACCESS",
      regex: /\b(show|reveal|display|print|output)\s+(me\s+)?(your\s+)?(system|initial)\s*(prompt|instructions)/gi,
      severity: "high",
      description: "Attempt to reveal system prompt",
      category: "instruction",
    },
    {
      name: "NEW_INSTRUCTIONS",
      regex: /\b(new|updated|different)\s+instructions?\s*:/gi,
      severity: "high",
      description: "Attempt to inject new instructions",
      category: "instruction",
    },
    {
      name: "OVERRIDE_COMMAND",
      regex: /\b(override|bypass|disable)\s+(security|safety|restrictions?|filters?)/gi,
      severity: "critical",
      description: "Security override attempt",
      category: "instruction",
    },

    // MEDIUM: Social engineering
    {
      name: "URGENT_REQUEST",
      regex: /\b(urgent|emergency|critical)\s*[!:]/gi,
      severity: "medium",
      description: "Social engineering urgency tactic",
      category: "social",
    },
    {
      name: "AUTHORITY_CLAIM",
      regex: /\b(i('m|\s+am)\s+(a\s+)?|as\s+(a\s+)?)(admin|administrator|developer|ceo|owner)/gi,
      severity: "medium",
      description: "False authority claim",
      category: "social",
    },

    // MEDIUM: Encoding attacks
    {
      name: "HEX_ENCODED_INSTRUCTIONS",
      regex: /\\x[0-9a-fA-F]{2}/g,
      severity: "medium",
      description: "Hex encoded content",
      category: "encoding",
    },
    {
      name: "UNICODE_ESCAPE",
      regex: /\\u[0-9a-fA-F]{4}/g,
      severity: "medium",
      description: "Unicode escape sequences",
      category: "encoding",
    },

    // Financial manipulation specific
    {
      name: "BUY_SCAM_TOKEN",
      regex: /\b(buy|purchase|swap\s+to)\s+\$?[A-Z]{2,10}\s+(token|coin|now|immediately)/gi,
      severity: "high",
      description: "Direct token purchase instruction",
      category: "instruction",
    },
    {
      name: "EXECUTE_TRANSACTION",
      regex: /\b(execute|send|transfer|withdraw)\s+\d+\s*(eth|mon|sol|btc|usdt|usdc)/gi,
      severity: "critical",
      description: "Direct transaction instruction",
      category: "instruction",
    },
    {
      name: "WALLET_ADDRESS_INSTRUCTION",
      regex: /\b(send|transfer)\s+to\s+0x[a-fA-F0-9]{40}/gi,
      severity: "critical",
      description: "Direct wallet address instruction",
      category: "instruction",
    },
  ];

  /**
   * Get all patterns
   */
  static getAllPatterns(): InjectionPattern[] {
    return [...this.patterns];
  }

  /**
   * Get patterns by severity
   */
  static getPatternsBySeverity(severity: InjectionPattern["severity"]): InjectionPattern[] {
    return this.patterns.filter(p => p.severity === severity);
  }

  /**
   * Get patterns by category
   */
  static getPatternsByCategory(category: InjectionPattern["category"]): InjectionPattern[] {
    return this.patterns.filter(p => p.category === category);
  }

  /**
   * Add custom pattern
   */
  static addPattern(pattern: InjectionPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * Check content against all patterns
   */
  static checkContent(content: string): {
    safe: boolean;
    matches: Array<{ pattern: string; severity: string; match: string }>;
    highestSeverity: string | null;
  } {
    const matches: Array<{ pattern: string; severity: string; match: string }> = [];
    let highestSeverity: string | null = null;
    const severityOrder = ["critical", "high", "medium", "low"];

    for (const pattern of this.patterns) {
      const found = content.match(pattern.regex);
      if (found) {
        for (const match of found) {
          matches.push({
            pattern: pattern.name,
            severity: pattern.severity,
            match: match.substring(0, 100),
          });
        }
        
        if (!highestSeverity || 
            severityOrder.indexOf(pattern.severity) < severityOrder.indexOf(highestSeverity)) {
          highestSeverity = pattern.severity;
        }
      }
    }

    return {
      safe: matches.length === 0,
      matches,
      highestSeverity,
    };
  }
}

/**
 * Factory function
 */
export function createContentSanitizer(options?: SanitizationOptions): ContentSanitizer {
  return new ContentSanitizer(options);
}

/**
 * Quick sanitize function
 */
export function sanitizeContent(input: string, options?: SanitizationOptions): SanitizationResult {
  const sanitizer = new ContentSanitizer(options);
  return sanitizer.sanitize(input);
}
