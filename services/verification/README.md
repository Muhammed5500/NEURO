# NEURO Verification Service

Cross-check and verification service for the NEURO multi-agent trading system.

## Overview

The verification service provides tools for validating information before making trading decisions. It includes:

1. **WebSearchProvider Interface** - Abstraction for web search verification
2. **MockWebSearchProvider** - Mock implementation for testing
3. **Cross-Check Service** - Orchestrates multiple verification checks
4. **CrossCheckReport** - Structured report attached to decisions

```
                    ┌─────────────────────┐
                    │  Input Signal       │
                    │  (News/Social/Claim)│
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
    ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
    │  Recycled News  │ │ Multi-Source│ │ Copy-Pasta      │
    │  Checker        │ │ Checker     │ │ Detector        │
    └────────┬────────┘ └──────┬──────┘ └────────┬────────┘
              │                │                  │
              │    ┌───────────────────┐         │
              │    │ Domain Diversity  │         │
              │    │ Checker           │         │
              │    └─────────┬─────────┘         │
              │              │                   │
              │    ┌───────────────────┐         │
              │    │ Temporal          │         │
              │    │ Consistency       │         │
              │    └─────────┬─────────┘         │
              │              │                   │
              └──────────────┼───────────────────┘
                             ▼
                   ┌─────────────────────┐
                   │  CrossCheckReport   │
                   │  - overallRiskLevel │
                   │  - shouldBlock      │
                   │  - shouldDowngrade  │
                   │  - findings[]       │
                   └─────────────────────┘
```

## Checkers

### 1. Recycled News Checker (Temporal Consistency)

**Turkish Rule**: "Haberin orijinal yayınlanma tarihi ile sosyal medyadaki yayılma hızı arasındaki farkı kontrol et. Eğer haber 6 saat eskiyse ama yeniymiş gibi trend oluyorsa HIGH_RISK olarak işaretle."

- Detects old/recycled news being pushed as new
- Flags news older than 6 hours trending as fresh
- Calculates temporal gap between publication and trending
- Risk levels: LOW → MEDIUM → HIGH → CRITICAL

```typescript
const checker = createRecycledNewsChecker(searchProvider, {
  staleThresholdHours: 6, // News older than 6h is "stale"
});

const result = await checker.check({
  title: "Breaking News",
  content: "...",
  trendingAt: new Date().toISOString(),
});

if (result.isFakeFresh) {
  console.log("WARNING: Stale news being pushed as fresh!");
}
```

### 2. Multi-Source Confirmation Checker

**Acceptance Criteria**: "If Scout marks high importance but no other sources confirm, Adversarial downgrades or blocks"

- Verifies claims with multiple independent sources
- Requires N sources for high-importance claims (default: 3)
- Checks ownership groups to ensure true independence
- Calculates credibility scores for sources

```typescript
const checker = createMultiSourceChecker(searchProvider, {
  minSourcesForHighImportance: 3,
  minSourcesForMediumImportance: 2,
});

const result = await checker.check({
  claim: "Major protocol upgrade announced",
  originalSource: "twitter.com",
  importance: "high",
});

if (!result.requirementMet) {
  console.log("CAUTION: Insufficient confirmation for high-importance claim!");
}
```

### 3. Phrase Matching (Copy-Pasta) Detector

**Turkish Rule**: "Aynı cümlenin 10 farklı bot hesabında aynı anda paylaşılıp paylaşılmadığını kontrol eden bir 'Copy-Pasta' dedektörü ekle"

- Detects identical phrases across multiple accounts
- Identifies coordinated bot amplification
- Analyzes posting time windows for coordination
- Flags new accounts with low followers

```typescript
const checker = createPhraseMatchingChecker({
  minAccountsForSuspicion: 10, // 10 accounts = suspicious
  coordinatedTimeWindowMinutes: 30,
});

const result = checker.check(socialPosts);

if (result.coordinatedAmplification) {
  console.log(`ALERT: Bot coordination detected! ${result.botAccountCount} bots`);
}
```

### 4. Domain Diversity Checker

**Turkish Rule**: "Teyit alınan kaynakların sadece farklı olması yetmez, farklı IP bloklarında veya farklı sahiplik yapılarında (farklı haber ağları) olduklarını doğrulamaya çalışan bir 'çeşitlilik skoru' ekle."

- Checks source diversity beyond just different domains
- Identifies same ownership groups (e.g., News Corp owns WSJ, Barron's, MarketWatch)
- Considers IP block diversity
- Calculates weighted diversity score

```typescript
const checker = createDomainDiversityChecker({
  minOwnershipGroups: 3,
});

const result = await checker.check([
  "wsj.com", "barrons.com", "marketwatch.com" // All News Corp!
]);

console.log(`Diversity: ${result.diversityScore * 100}%`);
// Low score because all same ownership
```

## CrossCheckReport Schema

The output of verification is a `CrossCheckReport`:

```typescript
interface CrossCheckReport {
  id: string;
  subject: {
    type: "news" | "social" | "claim";
    title: string;
    content: string;
    source: string;
  };
  
  // Individual checks
  recycledNewsCheck?: RecycledNewsCheck;
  multiSourceCheck?: MultiSourceCheck;
  domainDiversityCheck?: DomainDiversityCheck;
  phraseMatchingCheck?: PhraseMatchingCheck;
  temporalConsistencyCheck?: TemporalConsistencyCheck;
  
  // Overall assessment
  overallRiskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  overallScore: number; // 0 = suspicious, 1 = verified
  
  // Decision impact
  shouldBlock: boolean;
  shouldDowngrade: boolean;
  
  // Human-readable output
  summary: string;
  findings: string[];
  recommendations: string[];
}
```

## Integration with Adversarial Agent

The CrossCheckService integrates with the Adversarial Agent:

```typescript
// In adversarial-agent.ts
const crossCheckService = createCrossCheckService({
  useMockProvider: process.env.USE_MOCK_PROVIDER === "true",
  staleThresholdHours: 6,
  minSourcesForHighImportance: 3,
});

adversarialAgent.setCrossCheckService(crossCheckService);

// Cross-check results affect trap confidence:
// - shouldBlock = true → trapConfidence >= 0.90 (VETO)
// - No multi-source confirmation → trapConfidence increased
// - Coordinated amplification → trapConfidence >= 0.85
// - Recycled news → trapConfidence increased
```

## Testing

```bash
# Run all verification tests
pnpm test

# Run specific checker tests
pnpm test --filter recycled-news
pnpm test --filter multi-source
pnpm test --filter phrase-matching
```

### Mock Scenarios

The `MockWebSearchProvider` includes predefined scenarios:

- `CONFIRMED_NEWS` - News confirmed by multiple sources
- `RECYCLED_NEWS` - Old news being recycled
- `NO_CONFIRMATION` - Single source, no confirmation
- `COORDINATED_SPAM` - Bot-like coordinated posts
- `LOW_DIVERSITY` - All sources same ownership
- `NO_RESULTS` - No search results

```typescript
const mockProvider = createMockProviderForScenario("COORDINATED_SPAM");
const checker = createPhraseMatchingChecker();
// ... test with predefined bot posts
```

## Configuration

### Environment Variables

```bash
# Cross-check service
USE_MOCK_PROVIDER=false
STALE_THRESHOLD_HOURS=6
MIN_SOURCES_HIGH_IMPORTANCE=3
MIN_ACCOUNTS_FOR_SUSPICION=10
MIN_OWNERSHIP_GROUPS=3
```

## Directory Structure

```
services/verification/
├── src/
│   ├── types/
│   │   └── cross-check-report.ts   # Report schema
│   ├── providers/
│   │   ├── web-search-provider.ts  # Provider interface
│   │   └── mock-web-search-provider.ts
│   ├── checkers/
│   │   ├── recycled-news-checker.ts
│   │   ├── multi-source-checker.ts
│   │   ├── phrase-matching-checker.ts
│   │   ├── domain-diversity-checker.ts
│   │   └── temporal-consistency-checker.ts
│   ├── verifiers/                  # Existing verifiers
│   │   ├── transaction-verifier.ts
│   │   ├── balance-verifier.ts
│   │   └── price-verifier.ts
│   ├── __tests__/
│   │   ├── recycled-news-checker.test.ts
│   │   ├── multi-source-checker.test.ts
│   │   └── phrase-matching-checker.test.ts
│   ├── cross-check-service.ts      # Orchestration
│   └── index.ts
└── README.md
```

## License

MIT
