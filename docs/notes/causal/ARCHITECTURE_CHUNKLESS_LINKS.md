# Chunkless Causal Link Architecture - MVP Implementation Guide

> Note: The current canonical mass/strength convergence contract lives in [../../CAUSAL_CORE_PHYSICS.md](../../CAUSAL_CORE_PHYSICS.md). Use this MVP guide as historical implementation context.

## Overview

This document describes the architectural shift from chunk-centered causal loops to a chunkless causal link system.

**Key Changes:**
- **Chunks demoted to gating only** - no longer propagate into link scoring
- **EligibilityMask replaces chunk infrastructure for line-level filtering** - O(1) lookups
- **CausalLink replaces CausalLoop** - simpler, more focused data structure
- **2-pass allocation** - strong intents claim first (one-to-one), weak intents claim after (many-to-one allowed)
- **Local-only scoring** - K_local=8 default, no long-horizon logic

## Architecture Components

### 1. EligibilityMask (`src/causal/types.ts` + `src/causal/eligibilityMask.ts`)

**Purpose:** Line-by-line gating converted from chunk masks.

**Definition (types.ts):**
```typescript
interface EligibilityMask {
  session_id: string;
  eligible_mask: boolean[]; // indexed by transcript line_index
  excluded_ranges: ExcludedRange[];
  compiled_at_ms: number;
}

interface ExcludedRange {
  start_index: number;
  end_index: number;
  reason: "ooc_hard" | "ooc_soft" | "combat" | "transition" | "noise";
}
```

**Build Process (`eligibilityMask.ts`):**
```typescript
buildEligibilityMask(
  transcript: Array<{ line_index: number }>,
  masks: RegimeMasks,
  sessionId: string
): EligibilityMask
```

**Usage:**
```typescript
// Query eligibility of a single line
if (isLineEligible(mask, line_index)) {
  // Include in link allocation
}

// Get exclusion reasons for debugging
const reasons = getExclusionReasons(mask, line_index);
// Returns: ["ooc_hard"] or ["combat"] etc.
```

### 2. CausalLink Type (`src/causal/types.ts`)

**Replaces:** CausalLoop (deprecated, kept for backward compat)

**Definition:**
```typescript
interface CausalLink {
  id: string;                          // UUID
  session_id: string;
  actor: string;                       // PC actor ID
  intent_text: string;
  intent_type: "question" | "declare" | "propose" | "request";
  intent_strength: "strong" | "weak";
  intent_anchor_index: number;
  
  consequence_text: string | null;     // null if unclaimed
  consequence_type: ConsequenceType;
  consequence_anchor_index: number | null;
  
  distance: number | null;             // null if unclaimed
  score: number | null;                // null if unclaimed
  claimed: boolean;                    // true if consequence assigned
  created_at_ms: number;
}
```

**Key Difference from CausalLoop:**
- No chunk_id, chunk_index (chunkless)
- No roll_type, roll_subtype (consequence-level, not loop-level)
- Cleaner intent_strength boolean
- claimed flag makes allocation explicit

### 3. Chunkless Causal Link Kernel (`src/causal/extractCausalLinksKernel.ts`)

**Entry Point:**
```typescript
export function extractCausalLinksKernel(
  input: KernelInput,
  emitTraces: boolean = false
): KernelOutput
```

**Input:**
```typescript
interface KernelInput {
  sessionId: string;
  transcript: TranscriptEntry[];
  eligibilityMask: EligibilityMask;
  actors: ActorLike[];
  dmSpeaker: Set<string>;
  kLocal?: number; // Default 8
  strongMinScore?: number; // Default 0.35
  weakMinScore?: number; // Default 0.1
}
```

**Output:**
```typescript
interface KernelOutput {
  links: CausalLink[];
  traces?: IntentDebugTrace[]; // Optional allocation traces for debugging
}
```

### 4. Core Algorithm: 3-Phase Extraction

#### Phase 1: Detect Intents
```
For each line in transcript:
  if not eligible: skip
  if dm_speaker: skip (becomes consequence)
  if not pc_speaker: skip
  if detectIntent(line.content):
    strength = computeIntentStrength(detection)
    intents.push({ index, actor, text, detection, strength })
```

**Intent Strength Logic:**
- **Strong:** declare, propose, request
- **Weak:** question (default)

#### Phase 2A: Strong Intent Allocation (One-to-One)
```
For each strong intent (sorted by line index):
  candidates = next K_local DM lines (eligible only)
  
  for each candidate:
    score = distanceFirst(distance, lexical_overlap, answer_boost)
  
  best_unclaimed = highest score among unclaimed consequences
  
  if best_unclaimed.score >= STRONG_MIN_SCORE:
    claim best_unclaimed
    create CausalLink with claimed=true
  else:
    create CausalLink with claimed=false (unclaimed strong intent)
```

#### Phase 2B: Weak Intent Allocation (Many-to-One)
```
For each weak intent (sorted by line index):
  candidates = next K_local DM lines (eligible only)
  
  for each candidate:
    score = distanceFirst(distance, lexical_overlap, answer_boost)
  
  best = highest score (claimed or unclaimed - weak can share)
  
  if best.score >= WEAK_MIN_SCORE:
    claim best
    create CausalLink with claimed=true
  else:
    create CausalLink with claimed=false
```

### 5. Scoring Formula

**Distance-First Multiplicative:**
```
distance_score = 1 / (1 + (d / tau)^p)    // Hill curve, tau=2, p=2.2
lexical_score = overlap / max_tokens
answer_boost = 0.15 if isYesNoAnswerLike(...) else 0

final_score = distance_score * (1 + lexical_score * 0.5) + answer_boost
```

**Why Distance-First:**
- Nearby responses win by default, even with zero lexical overlap
- Prevents far commentary from stealing consequences
- More aligned with dialogue dynamics

### 6. Database Schema (`src/db/schema.sql`)

**New Table: causal_links**
```sql
CREATE TABLE IF NOT EXISTS causal_links (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  intent_text TEXT NOT NULL,
  intent_type TEXT NOT NULL,
  intent_strength TEXT NOT NULL,  -- strong | weak
  intent_anchor_index INTEGER NOT NULL,
  consequence_text TEXT,
  consequence_type TEXT,
  consequence_anchor_index INTEGER,
  distance INTEGER,
  score REAL,
  claimed INTEGER NOT NULL,  -- 1 | 0
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX idx_causal_links_session ON causal_links(session_id);
CREATE INDEX idx_causal_links_session_actor ON causal_links(session_id, actor);
CREATE INDEX idx_causal_links_strength ON causal_links(session_id, intent_strength);
```

**Backward Compat:** causal_loops table kept for reference/debugging

## Implementation Checklist for Next Phases

### TODO Phase 3: Database Persistence
- [ ] Add persistCausalLinks() function in DB layer
- [ ] Wire extractCausalLinksKernel → persistCausalLinks
- [ ] Test round-trip: extract → persist → query

### TODO Phase 4: Allocation Trace Debug Tool
- [ ] Enhance export-annotated-transcript.ts with --debugLinksDense flag
- [ ] Render inline allocation decisions showing:
  - All candidates with scores
  - Winner selection reason
  - Contested consequences (multiple bidders)
  - Unclaimed strong intents at end
- [ ] Add eligibility flags next to lines excluded by mask

### TODO Phase 5: Chunked Export Mode
- [ ] When outputting causal_links → events, preserve chunk_id from eligibility
- [ ] Map consequence anchor_index back to owning event/chunk
- [ ] Support event-scoped causal link queries

### TODO Phase 6: Metrics & Analysis
- [ ] Coverage metrics: (claimed links / total intents)
- [ ] Claim success rate by strength
- [ ] Distance distribution vs score distribution
- [ ] Consequence fanout (how many intents claim each consequence)

## Testing Strategy

### Unit Test: Kernel with Fixture
```typescript
// src/tests/test-chunkless-kernel.ts
const result = extractCausalLinksKernel({
  sessionId: "test",
  transcript: [{line_index:0, author_name:"PC", content:"Where is X?"},
               {line_index:1, author_name:"DM", content:"X is here"}],
  eligibilityMask: {
    eligible_mask: [true, true],
    excluded_ranges: [],
    ...
  },
  ...
});

expect(result.links).length(1);
expect(result.links[0].claimed).toBe(true);
expect(result.links[0].distance).toBe(1);
```

### Integration Test: Full Session
```typescript
// Extract + check metrics
const links = extractCausalLinksKernel({...});
const strongLinks = links.filter(l => l.intent_strength === "strong");
const claimed = strongLinks.filter(l => l.claimed).length;

// Should claim ~80% of strong intents
expect(claimed / strongLinks.length).toBeGreaterThan(0.75);
```

### Manual QA: Annotated Transcript
```bash
npx tsx src/tools/export-annotated-transcript.ts --session C2E20 \
  --debugLinksDense --output trace.md
# Review: are intents/consequences paired sensibly?
# Check: strong/weak strength assignments correct?
# Scan: any contested consequences we should reconcile?
```

## Migration Path from CausalLoop

**Option A: Keep Legacy Running (MVP)**
- CausalLink extracts in parallel with CausalLoop
- Two tables queried separately by consumers
- Eventual switchover once CausalLink proven

**Option B: Alias CausalLoop → CausalLink (Aggressive)**
- Deprecate causal_loops queries
- Re-map all CRUD to causal_links
- Tested via adapter pattern

## Key Invariants to Maintain

1. **Deterministic ID generation** - same session/transcript → same link IDs (except timestamp)
2. **One-to-many allocation safety** - strong intents never share, weak intents can
3. **Eligibility enforcement** - no link spans excluded ranges
4. **Local horizon enforcement** - consequences always within K_local lines
5. **No backward jumps** - consequence always comes after intent (line_index)

## Performance Characteristics

- **Time:** O(intents × K_local × scoring) ≈ O(N) where N=transcript length
- **Space:** O(N) for mask + O(links) for output
- **Disk:** One row per claimed intent + unclaimed strong intents

## References

- Original request: "Copilot task list — Pivot to chunkless causal links"
- EligibilityMask concept: "demote chunking to gating-only"
- 2-pass allocation: "strong-first claiming" + "weak many-to-one"
- Scoring: "distance-first multiplicative" with Hill curve tau=2, p=2.2
