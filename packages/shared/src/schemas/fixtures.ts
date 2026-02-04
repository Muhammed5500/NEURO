/**
 * Schema Test Fixtures
 * Pre-built payloads for testing schema validation
 */

import type { NewsItem } from "./news-item.js";
import type { SocialSignal } from "./social-signal.js";
import type { IngestionEvent } from "./ingestion-event.js";
import type { EmbeddingRecord } from "./embedding-record.js";
import type { AgentOpinion } from "./agent-opinion.js";
import type { ConsensusDecision } from "./consensus-decision.js";
import type { ExecutionPlan, GasConfig } from "./execution-plan.js";
import type { AuditLogEvent } from "./audit-log-event.js";
import { CURRENT_SCHEMA_VERSION, MONAD_MAINNET_CHAIN_ID } from "./common.js";

// ============================================
// HELPER FUNCTIONS
// ============================================

const generateUuid = () => crypto.randomUUID();
const generateTimestamp = () => new Date().toISOString();

// ============================================
// GAS CONFIG FIXTURE
// ============================================

export function createGasConfigFixture(overrides?: Partial<GasConfig>): GasConfig {
  return {
    gasLimit: "250000",
    maxFeePerGas: "50000000000", // 50 gwei
    maxPriorityFeePerGas: "2000000000", // 2 gwei
    gasBufferPercent: 15,
    estimatedGasCostWei: "10875000000000000",
    estimatedGasCostMon: 0.010875,
    maxGasCostWei: "12506250000000000",
    maxGasCostMon: 0.01250625,
    ...overrides,
  };
}

// ============================================
// NEWS ITEM FIXTURES
// ============================================

export function createNewsItemFixture(overrides?: Partial<NewsItem>): NewsItem {
  const now = generateTimestamp();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: generateUuid(),
    createdAt: now,
    title: "Test News Article",
    content: "This is test content for the news article.",
    summary: "Test summary",
    source: "twitter",
    sourceUrl: "https://twitter.com/test/status/123",
    author: "testuser",
    category: "protocol",
    tags: ["test", "monad"],
    sentiment: "neutral",
    sentimentScore: 0.0,
    relevanceScore: 0.5,
    importance: "medium",
    mentionedTokens: [],
    mentionedAddresses: [],
    language: "en",
    publishedAt: now,
    fetchedAt: now,
    processed: false,
    ...overrides,
  };
}

// ============================================
// SOCIAL SIGNAL FIXTURES
// ============================================

export function createSocialSignalFixture(overrides?: Partial<SocialSignal>): SocialSignal {
  const now = generateTimestamp();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: generateUuid(),
    createdAt: now,
    platform: "twitter",
    signalType: "mention",
    content: "Test social signal content",
    authorId: "12345",
    authorUsername: "testuser",
    authorFollowers: 1000,
    authorVerified: false,
    isInfluencer: false,
    likes: 10,
    retweets: 5,
    replies: 2,
    mentionedAddresses: [],
    sentiment: "neutral",
    signalStrength: 0.5,
    confidence: 0.5,
    postedAt: now,
    fetchedAt: now,
    processed: false,
    ...overrides,
  };
}

// ============================================
// INGESTION EVENT FIXTURES
// ============================================

export function createIngestionEventFixture(overrides?: Partial<IngestionEvent>): IngestionEvent {
  const now = generateTimestamp();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: generateUuid(),
    createdAt: now,
    sourceType: "nadfun_api",
    sourceId: "test-source",
    sourceName: "Test Source",
    dataType: "market_data",
    payload: { test: true },
    payloadSize: 100,
    status: "pending",
    retryCount: 0,
    maxRetries: 3,
    isValid: true,
    validationErrors: [],
    priority: "medium",
    isDuplicate: false,
    ingestedAt: now,
    ...overrides,
  };
}

// ============================================
// EMBEDDING RECORD FIXTURES
// ============================================

export function createEmbeddingRecordFixture(overrides?: Partial<EmbeddingRecord>): EmbeddingRecord {
  const now = generateTimestamp();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: generateUuid(),
    createdAt: now,
    sourceType: "news_item",
    sourceId: generateUuid(),
    content: "Test content for embedding",
    contentHash: "sha256:abc123",
    contentLength: 25,
    embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
    embeddingDimension: 5,
    embeddingModel: "text-embedding-ada-002",
    collectionName: "neuro_memories",
    metadata: {},
    tags: [],
    isChunked: false,
    generatedAt: now,
    ...overrides,
  };
}

// ============================================
// AGENT OPINION FIXTURES
// ============================================

export function createAgentOpinionFixture(overrides?: Partial<AgentOpinion>): AgentOpinion {
  const now = generateTimestamp();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: generateUuid(),
    createdAt: now,
    agentType: "market_analyzer",
    agentId: "test-agent",
    agentVersion: "1.0.0",
    recommendation: "hold",
    sentiment: "neutral",
    confidenceScore: 0.5,
    riskScore: 0.5,
    riskLevel: "medium",
    riskFactors: [],
    reasoning: "Test reasoning",
    keyInsights: [],
    supportingEvidence: [],
    modelUsed: "gpt-4",
    analysisStartedAt: now,
    analysisCompletedAt: now,
    analysisDurationMs: 1000,
    isStale: false,
    ...overrides,
  };
}

// ============================================
// CONSENSUS DECISION FIXTURES
// ============================================

export function createConsensusDecisionFixture(overrides?: Partial<ConsensusDecision>): ConsensusDecision {
  const now = generateTimestamp();
  const expiry = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: generateUuid(),
    createdAt: now,
    contextDescription: "Test decision context",
    opinionIds: [generateUuid()],
    opinionCount: 1,
    consensusMethod: "majority_vote",
    consensusThreshold: 0.6,
    consensusReached: true,
    finalRecommendation: "hold",
    finalSentiment: "neutral",
    aggregatedConfidence: 0.6,
    aggregatedRiskScore: 0.4,
    agreementScore: 0.8,
    riskLevel: "medium",
    riskSummary: "Test risk summary",
    consolidatedReasoning: "Test reasoning",
    keyFactors: [],
    disssentingViews: [],
    requiresManualApproval: true,
    approvalStatus: "pending",
    decisionMadeAt: now,
    expiresAt: expiry,
    ...overrides,
  };
}

// ============================================
// EXECUTION PLAN FIXTURES
// ============================================

export function createExecutionPlanFixture(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  const now = generateTimestamp();
  const expiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: generateUuid(),
    createdAt: now,
    chainId: MONAD_MAINNET_CHAIN_ID,
    chainName: "Monad Mainnet",
    executionType: "token_buy",
    description: "Test execution plan",
    from: "0x1234567890123456789012345678901234567890",
    to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    value: "100000000000000000", // 0.1 MON in Wei
    valueMon: 0.1,
    gasConfig: createGasConfigFixture(),
    riskLevel: "medium",
    riskFactors: [],
    requiresApproval: true,
    status: "draft",
    retryCount: 0,
    maxRetries: 3,
    plannedAt: now,
    expiresAt: expiry,
    simulated: false,
    ...overrides,
  };
}

// ============================================
// AUDIT LOG EVENT FIXTURES
// ============================================

export function createAuditLogEventFixture(overrides?: Partial<AuditLogEvent>): AuditLogEvent {
  const now = generateTimestamp();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: generateUuid(),
    createdAt: now,
    action: "custom",
    category: "system",
    actorType: "system",
    actorId: "test-system",
    description: "Test audit event",
    details: {},
    relatedIds: {},
    success: true,
    severity: "low",
    clientInfo: {},
    eventTimestamp: now,
    retentionDays: 90,
    tags: [],
    ...overrides,
  };
}

// ============================================
// BATCH FIXTURES
// ============================================

export const fixtures = {
  newsItem: createNewsItemFixture,
  socialSignal: createSocialSignalFixture,
  ingestionEvent: createIngestionEventFixture,
  embeddingRecord: createEmbeddingRecordFixture,
  agentOpinion: createAgentOpinionFixture,
  consensusDecision: createConsensusDecisionFixture,
  executionPlan: createExecutionPlanFixture,
  auditLogEvent: createAuditLogEventFixture,
  gasConfig: createGasConfigFixture,
};
