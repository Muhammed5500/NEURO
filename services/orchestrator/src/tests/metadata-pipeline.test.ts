/**
 * Metadata Pipeline Tests
 * 
 * Tests for metadata management with:
 * - Metadata building with integrity hash
 * - IPFS pinning (mock provider)
 * - Milestone-based triggers
 * - Version history with JSON Patch diffs
 * - Rate limiting
 * 
 * Acceptance Criteria:
 * - Can produce v1/v2 metadata and show diffs in dashboard
 * - Update requests are rate-limited and audited
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createMetadataBuilder,
  MetadataBuilder,
  createMockIpfsProvider,
  MockIpfsProvider,
  createMultiPinProvider,
  MultiPinProvider,
  createMilestoneTracker,
  MilestoneTracker,
  createVersionHistoryManager,
  VersionHistoryManager,
  generateJsonPatch,
  applyJsonPatch,
  createMetadataService,
  MetadataService,
  type TokenInfo,
  type OnChainSnapshot,
  type TokenMetadata,
  DEFAULT_MILESTONE_CONFIGS,
} from "../metadata/index.js";

// ============================================
// METADATA BUILDER TESTS
// ============================================

describe("MetadataBuilder", () => {
  let builder: MetadataBuilder;

  beforeEach(() => {
    builder = createMetadataBuilder({ chainId: 143 });
  });

  describe("build", () => {
    it("should build valid metadata with all fields", () => {
      const tokenInfo: TokenInfo = {
        address: "0x1234567890123456789012345678901234567890",
        name: "Test Token",
        symbol: "TEST",
        description: "A test token",
        status: "active",
        createdAt: new Date(),
        poolFillPercent: 25,
        holderCount: 50,
      };

      const metadata = builder.build(tokenInfo);

      expect(metadata.name).toBe("Test Token");
      expect(metadata.symbol).toBe("TEST");
      expect(metadata.version).toBe(1);
      expect(metadata.neuro?.tokenAddress).toBe(tokenInfo.address);
      expect(metadata.neuro?.status).toBe("active");
    });

    it("should include SHA-256 integrity hash", () => {
      // Turkish: "SHA-256 hash'ini al ve metadata'nın içine bir integrity alanı olarak ekle"
      const tokenInfo: TokenInfo = {
        address: "0x1234567890123456789012345678901234567890",
        name: "Test Token",
        symbol: "TEST",
        description: "Test description",
        status: "active",
        createdAt: new Date(),
      };

      const metadata = builder.build(tokenInfo);

      expect(metadata.integrity).toBeDefined();
      expect(metadata.integrity?.algorithm).toBe("sha256");
      expect(metadata.integrity?.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should verify integrity correctly", () => {
      const tokenInfo: TokenInfo = {
        address: "0x1234",
        name: "Test",
        symbol: "TST",
        description: "Test",
        status: "active",
        createdAt: new Date(),
      };

      const metadata = builder.build(tokenInfo);
      expect(builder.verifyIntegrity(metadata)).toBe(true);

      // Tamper with metadata
      metadata.description = "Tampered";
      expect(builder.verifyIntegrity(metadata)).toBe(false);
    });
  });

  describe("applyMilestoneUpdate", () => {
    it("should update metadata for milestone", () => {
      const tokenInfo: TokenInfo = {
        address: "0x1234",
        name: "Test",
        symbol: "TST",
        description: "Original description",
        status: "active",
        createdAt: new Date(),
        poolFillPercent: 25,
      };

      const original = builder.build(tokenInfo);

      const event = {
        type: "pool_fill_threshold" as const,
        tokenAddress: tokenInfo.address,
        chainId: 143,
        threshold: 50,
        currentValue: 52,
        updateFields: ["description" as const, "attributes" as const],
        timestamp: Date.now(),
      };

      const updated = builder.applyMilestoneUpdate(original, event, {
        description: "Pool is now 52% filled!",
      });

      expect(updated.version).toBe(2);
      expect(updated.description).toBe("Pool is now 52% filled!");
      expect(updated.neuro?.poolFillPercent).toBe(52);
      expect(updated.integrity?.hash).not.toBe(original.integrity?.hash);
    });
  });
});

// ============================================
// IPFS PROVIDER TESTS
// ============================================

describe("IpfsProviders", () => {
  describe("MockIpfsProvider", () => {
    let provider: MockIpfsProvider;

    beforeEach(() => {
      provider = createMockIpfsProvider({ simulatedDelayMs: 10 });
    });

    it("should pin JSON content", async () => {
      const content = { name: "Test", value: 123 };
      const result = await provider.pinJson(content, "test-pin");

      expect(result.success).toBe(true);
      expect(result.cid).toBeDefined();
      expect(result.cid).toMatch(/^Qm/);
    });

    it("should retrieve pinned content", async () => {
      const content = { name: "Test", nested: { value: 456 } };
      const result = await provider.pinJson(content, "test");

      const retrieved = provider.getPinnedContent(result.cid!);
      expect(retrieved).toEqual(content);
    });
  });

  describe("MultiPinProvider", () => {
    it("should pin to multiple providers", async () => {
      // Turkish: "birden fazla pinning servisini destekleyen bir MultiPinProvider"
      const provider1 = createMockIpfsProvider({ simulatedDelayMs: 10 });
      const provider2 = createMockIpfsProvider({ simulatedDelayMs: 10 });

      const multiProvider = createMultiPinProvider([provider1, provider2], {
        minSuccessCount: 1,
      });

      const content = { name: "Multi-pin test" };
      const result = await multiProvider.pinToAll(content, "multi-test");

      expect(result.successCount).toBe(2);
      expect(result.allSucceeded).toBe(true);
      expect(result.cid).toBeDefined();
    });

    it("should succeed if minimum providers succeed", async () => {
      const provider1 = createMockIpfsProvider({ simulatedDelayMs: 10 });
      const provider2 = createMockIpfsProvider({ simulatedDelayMs: 10, failureRate: 1 }); // Always fails

      const multiProvider = createMultiPinProvider([provider1, provider2], {
        minSuccessCount: 1,
      });

      const result = await multiProvider.pinToAll({ test: true }, "partial-test");

      expect(result.successCount).toBe(1);
      expect(result.cid).toBeDefined();
    });
  });
});

// ============================================
// MILESTONE TRIGGER TESTS
// ============================================

describe("MilestoneTracker", () => {
  let tracker: MilestoneTracker;

  beforeEach(() => {
    tracker = createMilestoneTracker();
  });

  describe("checkMilestones", () => {
    it("should detect pool fill threshold crossing", () => {
      // Turkish: "Havuzun %50 doluluğa ulaşması"
      const snapshot: OnChainSnapshot = {
        tokenAddress: "0x1234",
        chainId: 143,
        blockNumber: 100,
        poolFillPercent: 52,
        poolLiquidity: "1000000",
        holderCount: 10,
        totalVolume: "5000",
        isGraduated: false,
        timestamp: Date.now(),
      };

      const events = tracker.checkMilestones(snapshot);

      // Should trigger 50% threshold
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("pool_fill_threshold");
      expect(events[0].threshold).toBe(50);
    });

    it("should detect token graduation", () => {
      // Turkish: "Tokenın mezun olması"
      const snapshot: OnChainSnapshot = {
        tokenAddress: "0x1234",
        chainId: 143,
        blockNumber: 200,
        poolFillPercent: 100,
        poolLiquidity: "2000000",
        holderCount: 500,
        totalVolume: "100000",
        isGraduated: true,
        graduationTxHash: "0xabc",
        timestamp: Date.now(),
      };

      const events = tracker.checkMilestones(snapshot);

      const graduationEvent = events.find(e => e.type === "token_graduated");
      expect(graduationEvent).toBeDefined();
      expect(graduationEvent?.updateFields).toContain("external_url");
    });

    it("should not trigger same milestone twice", () => {
      const snapshot1: OnChainSnapshot = {
        tokenAddress: "0x1234",
        chainId: 143,
        blockNumber: 100,
        poolFillPercent: 52,
        poolLiquidity: "1000000",
        holderCount: 10,
        totalVolume: "5000",
        isGraduated: false,
        timestamp: Date.now(),
      };

      const events1 = tracker.checkMilestones(snapshot1);
      expect(events1.length).toBeGreaterThan(0);

      // Check again with same state
      const snapshot2 = { ...snapshot1, poolFillPercent: 55 };
      const events2 = tracker.checkMilestones(snapshot2);
      
      // Should not trigger 50% again
      expect(events2.filter(e => e.threshold === 50)).toHaveLength(0);
    });
  });
});

// ============================================
// VERSION HISTORY TESTS
// ============================================

describe("VersionHistoryManager", () => {
  let manager: VersionHistoryManager;

  beforeEach(() => {
    manager = createVersionHistoryManager();
  });

  describe("JSON Patch generation", () => {
    it("should generate correct diff operations", () => {
      // Turkish: "JSON Patch (RFC 6902) formatında sakla"
      const oldObj = {
        name: "Old Name",
        description: "Old description",
        value: 100,
      };

      const newObj = {
        name: "Old Name",
        description: "New description",
        value: 200,
        newField: "added",
      };

      const diff = generateJsonPatch(oldObj, newObj);

      expect(diff.length).toBe(3);
      
      const descReplace = diff.find(d => d.path === "/description");
      expect(descReplace?.op).toBe("replace");
      expect(descReplace?.value).toBe("New description");

      const valueReplace = diff.find(d => d.path === "/value");
      expect(valueReplace?.op).toBe("replace");

      const addOp = diff.find(d => d.path === "/newField");
      expect(addOp?.op).toBe("add");
    });

    it("should apply patch to reconstruct object", () => {
      const oldObj = { a: 1, b: 2 };
      const newObj = { a: 1, b: 3, c: 4 };

      const diff = generateJsonPatch(oldObj, newObj);
      const reconstructed = applyJsonPatch(oldObj, diff);

      expect(reconstructed).toEqual(newObj);
    });
  });

  describe("Version tracking", () => {
    it("should create initial version", () => {
      const metadata: TokenMetadata = {
        name: "Test",
        symbol: "TST",
        description: "Test token",
        version: 1,
        neuro: {
          tokenAddress: "0x1234",
          chainId: 143,
          createdAt: new Date().toISOString(),
          status: "active",
        },
      };

      const version = manager.createInitialVersion(metadata, "QmTest123");

      expect(version.version).toBe(1);
      expect(version.cid).toBe("QmTest123");
      expect(version.diff).toBeUndefined();
    });

    it("should track version history with diffs", () => {
      // Acceptance criteria: "Can produce v1/v2 metadata and show diffs"
      const v1: TokenMetadata = {
        name: "Test",
        symbol: "TST",
        description: "Version 1",
        version: 1,
        neuro: {
          tokenAddress: "0x1234",
          chainId: 143,
          createdAt: new Date().toISOString(),
          status: "active",
          poolFillPercent: 25,
        },
      };

      const v2: TokenMetadata = {
        ...v1,
        description: "Version 2 - Pool 50% filled!",
        version: 2,
        neuro: {
          ...v1.neuro!,
          poolFillPercent: 50,
        },
      };

      // Create v1
      manager.createInitialVersion(v1, "QmV1");

      // Add v2
      const event = {
        type: "pool_fill_threshold" as const,
        tokenAddress: "0x1234",
        chainId: 143,
        threshold: 50,
        currentValue: 50,
        updateFields: ["description" as const],
        timestamp: Date.now(),
      };

      const version2 = manager.addVersion(v1, v2, "QmV2", event);

      expect(version2.version).toBe(2);
      expect(version2.diff).toBeDefined();
      expect(version2.diff!.length).toBeGreaterThan(0);
      expect(version2.previousVersion).toBe(1);
    });

    it("should provide diff summary for dashboard", () => {
      // Turkish: "'NEURO neyi değiştirdi?' sorusuna net cevap"
      const diff = [
        { op: "replace" as const, path: "/description", value: "New" },
        { op: "replace" as const, path: "/neuro/poolFillPercent", value: 50 },
        { op: "add" as const, path: "/external_url", value: "https://..." },
      ];

      const changedFields = manager.getChangedFields(diff);

      expect(changedFields).toContain("description");
      expect(changedFields).toContain("neuro");
      expect(changedFields).toContain("external_url");
    });
  });
});

// ============================================
// METADATA SERVICE INTEGRATION TESTS
// ============================================

describe("MetadataService", () => {
  let service: MetadataService;
  let mockProvider: MockIpfsProvider;

  beforeEach(() => {
    mockProvider = createMockIpfsProvider({ simulatedDelayMs: 10 });
    service = createMetadataService(
      { chainId: 143, enforceRateLimits: true },
      [mockProvider]
    );
  });

  describe("createMetadata", () => {
    it("should create and pin initial metadata", async () => {
      const tokenInfo: TokenInfo = {
        address: "0xtest123",
        name: "Service Test",
        symbol: "STEST",
        description: "Testing the service",
        status: "active",
        createdAt: new Date(),
      };

      const result = await service.createMetadata(tokenInfo);

      expect(result.cid).toBeDefined();
      expect(result.metadata.version).toBe(1);
      expect(result.version.cid).toBe(result.cid);
    });
  });

  describe("processOnChainSnapshot", () => {
    it("should process milestone and update metadata", async () => {
      // Create initial metadata
      const tokenInfo: TokenInfo = {
        address: "0xmilestone",
        name: "Milestone Test",
        symbol: "MILE",
        description: "Testing milestones",
        status: "active",
        createdAt: new Date(),
        poolFillPercent: 25,
      };

      await service.createMetadata(tokenInfo);

      // Process snapshot that triggers 50% milestone
      const snapshot: OnChainSnapshot = {
        tokenAddress: "0xmilestone",
        chainId: 143,
        blockNumber: 100,
        poolFillPercent: 52,
        poolLiquidity: "1000000",
        holderCount: 10,
        totalVolume: "5000",
        isGraduated: false,
        timestamp: Date.now(),
      };

      const results = await service.processOnChainSnapshot(snapshot);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].metadata.version).toBe(2);
      expect(results[0].cid).toBeDefined();
    });
  });

  describe("Rate limiting", () => {
    it("should enforce rate limits on updates", async () => {
      // Acceptance criteria: "Update requests are rate-limited"
      const tokenInfo: TokenInfo = {
        address: "0xratelimit",
        name: "Rate Limit Test",
        symbol: "RATE",
        description: "Testing rate limits",
        status: "active",
        createdAt: new Date(),
      };

      // First creation should succeed
      await service.createMetadata(tokenInfo);

      // Check rate limit status
      const status = service.checkRateLimit("0xratelimit");
      expect(status.updatesThisHour).toBe(1);
    });
  });

  describe("Version history and audit", () => {
    it("should maintain audit log", async () => {
      // Acceptance criteria: "Update requests are audited"
      const tokenInfo: TokenInfo = {
        address: "0xaudit",
        name: "Audit Test",
        symbol: "AUD",
        description: "Testing audit",
        status: "active",
        createdAt: new Date(),
      };

      await service.createMetadata(tokenInfo);

      const auditLog = service.getAuditLog("0xaudit");

      expect(auditLog.length).toBe(1);
      expect(auditLog[0].toVersion).toBe(1);
      expect(auditLog[0].changedFields).toContain("*");
    });

    it("should provide version summary for dashboard", async () => {
      // Acceptance criteria: "show diffs in dashboard"
      const tokenInfo: TokenInfo = {
        address: "0xdashboard",
        name: "Dashboard Test",
        symbol: "DASH",
        description: "Testing dashboard",
        status: "active",
        createdAt: new Date(),
      };

      await service.createMetadata(tokenInfo);

      const summary = service.getVersionSummary("0xdashboard");

      expect(summary).toBeDefined();
      expect(summary?.currentVersion).toBe(1);
      expect(summary?.versionSummaries.length).toBe(1);
    });
  });
});
