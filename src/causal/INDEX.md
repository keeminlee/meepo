# Causal Engine Index

This is the authoritative quick map for the causal engine.

## What it consumes

- Session transcript lines (from ledger/transcript assembly)
- Eligibility masks and regime filters
- Registry/speaker context used during extraction
- Runtime parameters for scoring, locality, thresholds, and rounds

## What it outputs

- Intent/consequence links and higher-order hierarchy nodes
- Round artifacts (metrics, pairs, traces, outlines)
- Persisted causal records and markdown/json/tsv exports

## Pipeline in 10 lines

1. Build transcript and eligibility context
2. Detect intent and consequence candidates
3. Score local candidate pairs
4. Allocate links under threshold/masking constraints
5. Persist round-1 causal links
6. Build higher-order links from existing links
7. Reweight and anneal/absorb context
8. Repeat across configured rounds
9. Persist per-round metrics and graph artifacts
10. Render timeline/hierarchy outlines for inspection

## Where to tweak what

Eligibility / masking:
- `src/causal/eligibilityMask.ts`
- `src/causal/pruneRegimes.ts`
- `src/causal/classifyChunkOoc.ts`

Intent detection:
- `src/causal/detectIntent.ts`
- `src/causal/extractIntentConsequenceNodes.ts`

Consequence detection:
- `src/causal/detectConsequence.ts`
- `src/causal/extractIntentConsequenceNodes.ts`

Lexical scoring:
- `src/causal/lexicalSignals.ts`
- `src/causal/textFeatures.ts`
- `src/causal/evidenceStrength.ts`

Mass / strength and neighborhood boost:
- `src/causal/evidenceStrength.ts`
- `src/causal/scoreEdgesForward.ts`
- `src/causal/reweightEdgesBackward.ts`
- `src/causal/extractCausalLinksKernel.ts`

Anneal / absorb:
- `src/causal/annealLinks.ts`
- `src/causal/absorbSingletons.ts`
- `src/causal/attachSingletonContext.ts`

Persistence / artifacts:
- `src/causal/persistCausalLinks.ts`
- `src/causal/writeCausalArtifacts.ts`
- `src/causal/writeHierarchyArtifacts.ts`
- `src/causal/renderTimelineOutline.ts`
- `src/causal/renderHierarchyOutline.ts`

## Golden invariants

- Transcript line indexing and anchor identity must remain stable across phases (no reindexing between extraction and persistence).
- Eligibility gating is authoritative; masked lines must not leak into claimed causal links.
- Cause->effect direction must remain forward in timeline unless a tool explicitly marks exceptional back-links.
- Mass/strength updates must be deterministic for the same inputs + params (no hidden randomness in scoring/allocation).
- Artifacts and persisted outputs must carry enough provenance (session + params/hash) to reproduce a run.

## Where to change scoring

- `src/causal/evidenceStrength.ts`
- `src/causal/scoreEdgesForward.ts`
- `src/causal/reweightEdgesBackward.ts`
- `src/causal/extractCausalLinksKernel.ts`

## Where to change eligibility and masking

- `src/causal/eligibilityMask.ts`
- `src/causal/pruneRegimes.ts`
- `src/causal/classifyChunkOoc.ts`
- `src/causal/detectIntent.ts`
- `src/causal/detectConsequence.ts`

## Where artifacts are written

- Writers: `src/causal/writeCausalArtifacts.ts`, `src/causal/writeHierarchyArtifacts.ts`
- CLI entry: `src/tools/run-causal-cycles.ts`
- Default output root: `runs/causal/`

## Related docs

- System map: `docs/MAP.md`
- Core physics reference: `docs/CAUSAL_CORE_PHYSICS.md`
- Deep math notes: `src/causal/CAUSAL_LEVER_MATH.md`
