/**
 * Phrase Matching (Copy-Pasta) Checker Tests
 * 
 * Tests for coordinated bot activity detection.
 * Turkish: "Aynı cümlenin 10 farklı bot hesabında aynı anda paylaşılıp paylaşılmadığını kontrol et"
 */

import { describe, it, expect, beforeEach } from "vitest";
import { 
  PhraseMatchingChecker,
  createPhraseMatchingChecker,
  type SocialPost,
} from "../checkers/phrase-matching-checker.js";

describe("PhraseMatchingChecker", () => {
  let checker: PhraseMatchingChecker;

  beforeEach(() => {
    checker = createPhraseMatchingChecker({
      minAccountsForSuspicion: 10,
      coordinatedTimeWindowMinutes: 30,
    });
  });

  describe("Coordinated Bot Detection", () => {
    it("should detect coordinated copy-pasta from 10+ accounts", () => {
      const now = new Date();
      
      // Create 15 posts with identical content
      const botPosts: SocialPost[] = Array.from({ length: 15 }, (_, i) => ({
        id: `post-${i}`,
        content: "🚀 $TOKEN TO THE MOON! BUY NOW BEFORE IT'S TOO LATE! This is a once in a lifetime opportunity! 🚀",
        authorId: `bot_account_${i}`,
        platform: "twitter",
        postedAt: new Date(now.getTime() + i * 60000).toISOString(), // 1 minute apart
        followerCount: 10 + Math.random() * 50, // Low followers
        accountCreatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days old
      }));

      const result = checker.check(botPosts);

      expect(result.coordinatedAmplification).toBe(true);
      expect(result.botAccountCount).toBeGreaterThan(0);
      expect(result.riskLevel).toBe("CRITICAL");
    });

    it("should not flag organic content with unique phrases", () => {
      const now = new Date();
      
      const organicPosts: SocialPost[] = [
        {
          id: "post-1",
          content: "I really like this token, been following the project for months.",
          authorId: "user_1",
          platform: "twitter",
          postedAt: now.toISOString(),
          followerCount: 5000,
        },
        {
          id: "post-2",
          content: "The technology behind this project is impressive. Solid fundamentals.",
          authorId: "user_2",
          platform: "twitter",
          postedAt: now.toISOString(),
          followerCount: 3000,
        },
        {
          id: "post-3",
          content: "Just did my research. This looks like a legitimate project with good team.",
          authorId: "user_3",
          platform: "twitter",
          postedAt: now.toISOString(),
          followerCount: 8000,
        },
      ];

      const result = checker.check(organicPosts);

      expect(result.coordinatedAmplification).toBe(false);
      expect(result.riskLevel).toBe("LOW");
    });
  });

  describe("Time Window Analysis (Turkish: aynı anda)", () => {
    it("should flag posts within 30-minute window as coordinated", () => {
      const now = new Date();
      
      // 12 posts within 15 minutes
      const quickPosts: SocialPost[] = Array.from({ length: 12 }, (_, i) => ({
        id: `quick-${i}`,
        content: "This token will change everything! Don't miss out on the biggest opportunity!",
        authorId: `account_${i}`,
        platform: "twitter",
        postedAt: new Date(now.getTime() + i * 60000).toISOString(), // 1 minute apart
        followerCount: 20,
        accountCreatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      }));

      const result = checker.check(quickPosts);

      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches[0].timeWindowMinutes).toBeLessThanOrEqual(30);
      expect(result.coordinatedAmplification).toBe(true);
    });

    it("should not flag posts spread over long time periods", () => {
      const now = new Date();
      
      // Same phrase but spread over 24 hours
      const spreadPosts: SocialPost[] = Array.from({ length: 10 }, (_, i) => ({
        id: `spread-${i}`,
        content: "Interesting project worth watching. Not financial advice.",
        authorId: `organic_${i}`,
        platform: "twitter",
        postedAt: new Date(now.getTime() + i * 2 * 60 * 60 * 1000).toISOString(), // 2 hours apart
        followerCount: 1000 + Math.random() * 5000,
      }));

      const result = checker.check(spreadPosts);

      // Time window would be too large
      expect(result.coordinatedAmplification).toBe(false);
    });
  });

  describe("Bot Account Indicators", () => {
    it("should identify new accounts with low followers as likely bots", () => {
      const now = new Date();
      
      const suspiciousPosts: SocialPost[] = Array.from({ length: 11 }, (_, i) => ({
        id: `sus-${i}`,
        content: "MASSIVE PUMP INCOMING! Get in now before the whales!",
        authorId: `new_acc_${i}`,
        platform: "twitter",
        postedAt: new Date(now.getTime() + i * 30000).toISOString(),
        followerCount: 5 + Math.random() * 30, // Very low followers
        accountCreatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days old
      }));

      const result = checker.check(suspiciousPosts);

      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches[0].likelyBots).toBe(true);
      expect(result.matches[0].accounts.some(a => a.isNewAccount)).toBe(true);
    });

    it("should not flag established accounts with high followers", () => {
      const now = new Date();
      
      // Even with similar content, established accounts are less suspicious
      const establishedPosts: SocialPost[] = Array.from({ length: 10 }, (_, i) => ({
        id: `est-${i}`,
        content: "This project has good potential. Worth researching.",
        authorId: `established_${i}`,
        platform: "twitter",
        postedAt: new Date(now.getTime() + i * 60000).toISOString(),
        followerCount: 10000 + Math.random() * 50000,
        accountCreatedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year old
      }));

      const result = checker.check(establishedPosts);

      // Even if phrase matches, established accounts shouldn't be flagged as bots
      if (result.matches.length > 0) {
        expect(result.matches[0].likelyBots).toBe(false);
      }
    });
  });

  describe("Phrase Extraction", () => {
    it("should extract sentences as phrases", () => {
      const phrases = checker.extractPhrases(
        "This is the first sentence. This is the second sentence! And this is the third?"
      );

      expect(phrases.length).toBe(3);
    });

    it("should ignore very short phrases", () => {
      const phrases = checker.extractPhrases("Short. Also short. Tiny.");

      // These are too short to be meaningful
      expect(phrases.length).toBe(0);
    });

    it("should normalize phrases for comparison", () => {
      const phrases1 = checker.extractPhrases("This is a GREAT opportunity for investors!");
      const phrases2 = checker.extractPhrases("This is a great opportunity for investors!");

      // Both should normalize to the same phrase
      expect(phrases1[0]).toBe(phrases2[0]);
    });
  });

  describe("Risk Level Calculation", () => {
    it("should return CRITICAL for coordinated bot activity", () => {
      const now = new Date();
      
      const botPosts: SocialPost[] = Array.from({ length: 12 }, (_, i) => ({
        id: `bot-${i}`,
        content: "BUY NOW! This is going to explode! Don't miss this chance!",
        authorId: `bot_${i}`,
        platform: "twitter",
        postedAt: new Date(now.getTime() + i * 30000).toISOString(),
        followerCount: 15,
        accountCreatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      }));

      const result = checker.check(botPosts);

      expect(result.riskLevel).toBe("CRITICAL");
    });

    it("should return LOW for normal social activity", () => {
      const posts: SocialPost[] = [
        {
          id: "normal-1",
          content: "Interesting news today about the crypto market.",
          authorId: "normal_user",
          platform: "twitter",
          postedAt: new Date().toISOString(),
          followerCount: 2000,
        },
        {
          id: "normal-2",
          content: "I think the market will recover by end of year.",
          authorId: "another_user",
          platform: "twitter",
          postedAt: new Date().toISOString(),
          followerCount: 5000,
        },
      ];

      const result = checker.check(posts);

      expect(result.riskLevel).toBe("LOW");
    });
  });

  describe("Explanation Generation", () => {
    it("should generate alert message for coordinated activity", () => {
      const now = new Date();
      
      const botPosts: SocialPost[] = Array.from({ length: 11 }, (_, i) => ({
        id: `alert-${i}`,
        content: "ALERT: Massive gains incoming! Buy before it moons!",
        authorId: `shill_${i}`,
        platform: "twitter",
        postedAt: new Date(now.getTime() + i * 30000).toISOString(),
        followerCount: 10,
        accountCreatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      }));

      const result = checker.check(botPosts);

      expect(result.explanation).toContain("ALERT");
      expect(result.explanation).toContain("Coordinated");
    });

    it("should indicate no issues for clean data", () => {
      const posts: SocialPost[] = [
        {
          id: "clean-1",
          content: "Just checking out some new projects today.",
          authorId: "clean_user",
          platform: "twitter",
          postedAt: new Date().toISOString(),
          followerCount: 3000,
        },
      ];

      const result = checker.check(posts);

      expect(result.explanation).toContain("No suspicious");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty post list", () => {
      const result = checker.check([]);

      expect(result.suspiciousPhraseCount).toBe(0);
      expect(result.coordinatedAmplification).toBe(false);
      expect(result.riskLevel).toBe("LOW");
    });

    it("should handle single post", () => {
      const result = checker.check([{
        id: "single",
        content: "Just one post here, nothing suspicious.",
        authorId: "single_user",
        platform: "twitter",
        postedAt: new Date().toISOString(),
      }]);

      expect(result.coordinatedAmplification).toBe(false);
    });

    it("should handle posts without account metadata", () => {
      const now = new Date();
      
      const postsNoMeta: SocialPost[] = Array.from({ length: 11 }, (_, i) => ({
        id: `nometa-${i}`,
        content: "Same content across multiple posts without metadata information available.",
        authorId: `unknown_${i}`,
        platform: "unknown",
        postedAt: new Date(now.getTime() + i * 30000).toISOString(),
        // No followerCount or accountCreatedAt
      }));

      const result = checker.check(postsNoMeta);

      // Should still detect phrase pattern even without account metadata
      expect(result.suspiciousPhraseCount).toBeGreaterThan(0);
    });
  });
});
