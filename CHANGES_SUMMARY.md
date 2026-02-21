# Changes Summary

## 1. DM Proximity-Based Consequences ✅

**Problem:** Lines 234 and 235 (DM statements) weren't being considered as potential consequences because they didn't match pattern-based detection (no explicit "you see", "you can", etc.).

**Solution:** Added a second pass in consequence detection that marks any DM statement within 5 lines of a PC intent as a potential consequence.

### Changes Made:

#### A. New Consequence Type: `dm_statement`
- **File:** [src/causal/types.ts](src/causal/types.ts)
- Added `"dm_statement"` to ConsequenceType union
- Added `"other"` for explicit fallback cases
- Updated [src/causal/intentGraphTypes.ts](src/causal/intentGraphTypes.ts) to match

#### B. Two-Pass Consequence Extraction
- **File:** [src/causal/extractIntentConsequenceNodes.ts](src/causal/extractIntentConsequenceNodes.ts)
- **Pass 1:** Pattern-matched consequences (roll, information, deterministic, commitment)
  - High confidence, linguistically validated
- **Pass 2:** Proximity-based consequences (dm_statement)
  - Any DM statement within 5 lines of detected intent
  - Marked as type `"dm_statement"` for downstream filtering
  - Only added if not already pattern-matched

### Results:

For the C2E20 session example:

**Before:**
```
L233 (intent) → [L237 @ d=4 score=0.620]

L234, L235 (DM statements) ignored
```

**After:**
```
L233 (intent) → [L234 @ d=1 score=0.821] ✅ NEW
            → [L235 @ d=2 score=0.404] ✅ NEW  
            → [L237 @ d=4 score=0.145] (now lower due to distance)

L234 marked as dm_statement type
L235 marked as dm_statement type
```

Session metrics with new approach:
- Intent nodes: 277 (unchanged)
- Consequence nodes: 581 (↑ from 118) 
- Edges: 4270 (↑ from 816)
- Distance-first scoring ensures nearby responses win even without lexical overlap

---

## 2. Tools Organization & Documentation ✅

**Problem:** 17 tools scattered in `src/tools/` with no clear usage documentation or organization.

**Solution:** Created organizational structure with subfolders and comprehensive documentation.

### Directory Structure:

```
src/tools/
├── README.md                    (Overview + quick reference)
├── scaffold/
│   └── INDEX.md                (Event scaffold building)
├── debug/
│   └── INDEX.md                (Intent graph & causal loops)
├── export/
│   └── INDEX.md                (Annotated transcripts, beats)
├── analysis/
│   └── INDEX.md                (Event metrics, word frequency, memory)
├── admin/
│   └── INDEX.md                (Cleanup, reset, labeling)
└── [Original tool files remain in place for now]
```

### Documentation Added:

1. **Main README:** [src/tools/README.md](src/tools/README.md)
   - Directory structure overview
   - Quick reference for all major tools
   - Key concepts (scaffold, intent graph, legacy loops)
   - Common patterns and code snippets

2. **Folder INDEX files:**
   - Each subfolder has INDEX.md pointing to relevant tools
   - Usage examples and flag descriptions
   - Purpose and workflow

3. **Tool-level documentation:**
   - **debug-intent-graph.ts:** Full CLI reference, scoring formula, output details
   - **debug-causal-loops.ts:** Legacy system note, all flags documented
   - **export-annotated-transcript.ts:** Output format, features, examples

### Tools by Category:

| Category | Tools | Purpose |
|----------|-------|---------|
| **Scaffold** | compile-transcripts, compile-scaffold, compile-and-export-events | Event/scene segmentation |
| **Debug** | debug-intent-graph, debug-causal-loops | Analysis & tuning |
| **Export** | export-annotated-transcript, generate-beats | Visualization & output |
| **Analysis** | event-type-metrics, review-memory, scan-names, etc. | Session analysis |
| **Admin** | label-scaffold, cleanup-aliases, reset-memories | Maintenance |

---

## Testing & Verification

### Intent Graph - C2E20 Session
```
$ npx tsx src/tools/debug-intent-graph.ts --session C2E20 --printCandidateBreakdownAt 234

Sessions metrics:
  Intent nodes: 277
  Consequence nodes: 581 (including dm_statement)
  Edges: 4270
  
Candidate breakdown for L234:
  [0.821] L233 [pc_jamison] d=1 ✓
  [0.500] L232 [pc_jamison] d=2 ✓
  [0.291] L231 [pc_jamison] d=3 ✓
```

### Annotated Transcript Export
```
$ npx tsx src/tools/export-annotated-transcript.ts --session C2E20 --minScore 0

L233 (intent) now shows:
  → L234 [score=0.821 d=1] "He's been taken into custody."
  → L235 [score=0.404 d=2] "We, and we were..."
  → L237 [score=0.145 d=4] "It seems your lot is very good..."

L234 (consequence) marked as [dm_statement]
L235 (consequence) marked as [dm_statement]
```

✅ Both L234 and L235 are now properly considered as consequences!

---

## Files Modified

- [src/causal/types.ts](src/causal/types.ts) - Added dm_statement type
- [src/causal/intentGraphTypes.ts](src/causal/intentGraphTypes.ts) - Updated ConsequenceNode type
- [src/causal/extractIntentConsequenceNodes.ts](src/causal/extractIntentConsequenceNodes.ts) - Added second pass for DM proximity
- [src/tools/debug-intent-graph.ts](src/tools/debug-intent-graph.ts) - Added documentation header
- [src/tools/debug-causal-loops.ts](src/tools/debug-causal-loops.ts) - Added documentation header
- [src/tools/export-annotated-transcript.ts](src/tools/export-annotated-transcript.ts) - Added documentation header
- [src/tools/README.md](src/tools/README.md) - Created comprehensive overview
- [src/tools/scaffold/INDEX.md](src/tools/scaffold/INDEX.md) - Created
- [src/tools/debug/INDEX.md](src/tools/debug/INDEX.md) - Created
- [src/tools/export/INDEX.md](src/tools/export/INDEX.md) - Created
- [src/tools/analysis/INDEX.md](src/tools/analysis/INDEX.md) - Created
- [src/tools/admin/INDEX.md](src/tools/admin/INDEX.md) - Created

---

## Next Steps

1. Consider filtering weak dm_statement consequences in downstream analysis
   - They have lower confidence (no pattern match)
   - Keep for exploration, but flag for filtering

2. Further tune the 5-line proximity window
   - Current: fixed at 5 lines
   - Could make dynamic based on event boundaries

3. Archive or migrate legacy causal loop system
   - Currently kept for comparison
   - No longer recommended for new analysis

