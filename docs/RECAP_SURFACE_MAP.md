# RECAP_SURFACE_MAP

Status: Sprint D1 deliverable (discovery-only)
Date: 2026-03-10

## Scope and D1 non-goals

D1 scope is inventory, classification, and risk mapping for recap/meecap surfaces.

D1 stopline (explicit):
- D1 may add docs, comments, and audit helpers.
- D1 must not change runtime recap behavior, fallback order, persistence behavior, or command/web outputs.

Code-first evidence rule:
- Code is authoritative for D1 mapping.
- Docs are evidence only.
- If docs and code differ, D1 records the disagreement and defers resolution to C1/B1/A1.

Lifecycle note (closed-alpha protection):
- D1 distinguishes lifecycle correctness from recap/artifact correctness.
- A path may intentionally keep session-end success decoupled from async recap/artifact outcomes.
- Reference behavior: showtime end should succeed independently from async artifact failures ([docs/V1_RELEASE_CHECKLIST.md](docs/V1_RELEASE_CHECKLIST.md#L103)).

## Inventory schema and frozen taxonomies

Inventory schema used in this document:

- ENTRYPOINT table:
  - `entrypoint_name | trigger_type | source_file | invocation_symbol | generation_method | write_targets | behavioral_ambiguity_flags | notes`
- STORE table:
  - `store | write_role | written_by | read_by | status | notes`
- READ PRECEDENCE + SHAPE matrix:
  - `reader | precedence_order | layer_source | field_shape | style_semantics | metadata/provenance | null/empty behavior | drift_notes`
- DEPENDENCY CASCADE map:
  - `surface | class | downstreams | code_owner | runtime_owner | ops_doc_owner | decision | rationale`

Frozen trigger taxonomy:
- `lifecycle`
- `command`
- `web_api`
- `cli_offline`
- `worker`

Frozen write-role taxonomy:
- `canonical_truth`
- `compatibility_truth`
- `derived_output`
- `debug_export_only`

Behavioral ambiguity flags (used below):
- `writes_truth_directly`
- `writes_derived_maybe_treated_as_truth`
- `synthesizes_missing_views`
- `fallback_mapping_differs`
- `bypasses_canonical_sessionRecaps_api`
- `regenerate_semantics_differs`

## Generation entrypoint table

| entrypoint_name | trigger_type | source_file | invocation_symbol | generation_method | write_targets | behavioral_ambiguity_flags | notes |
|---|---|---|---|---|---|---|---|
| showtime end async recap path | lifecycle | [src/commands/meepo.ts](src/commands/meepo.ts#L1799) | `kickoffShowtimeArtifactsAsync()` -> `generateSessionRecap()` from recapEngine | recapEngine single-style final pass (default guild style) | `session_artifacts(recap_final)`, `session_artifacts(megameecap_base)`, filesystem meecaps exports | `writes_derived_maybe_treated_as_truth`, `bypasses_canonical_sessionRecaps_api` | invoked from showtime end handler at [src/commands/meepo.ts](src/commands/meepo.ts#L2307) |
| /meepo sessions recap | command | [src/commands/meepo.ts](src/commands/meepo.ts#L2497) | `handleSessionsRecap()` -> `generateSessionRecap()` from recapEngine | recapEngine single-style pass | `session_artifacts(recap_final)`, possibly base artifact sync, filesystem final output | `writes_derived_maybe_treated_as_truth`, `bypasses_canonical_sessionRecaps_api`, `regenerate_semantics_differs` | has in-flight dedupe + cooldown rails in command surface |
| web recap regenerate API | web_api | [apps/web/lib/server/sessionReaders.ts](apps/web/lib/server/sessionReaders.ts#L313) | `regenerateWebSessionRecap()` -> `regenerateSessionRecap()` from sessionRecaps | sessionRecaps 3-style orchestration over recapEngine | `session_recaps` canonical row (plus recapEngine artifact side-effects from underlying style generation) | `writes_truth_directly` | route entrypoint [apps/web/app/api/sessions/[sessionId]/regenerate/route.ts](apps/web/app/api/sessions/%5BsessionId%5D/regenerate/route.ts#L12) |
| canonical service API (module) | command/web_api/cli_offline (shared module call) | [src/sessions/sessionRecaps.ts](src/sessions/sessionRecaps.ts#L277) | `generateSessionRecap()` | loops styles `concise|balanced|detailed`, validates non-empty, upserts canonical contract | `session_recaps` | `writes_truth_directly` | orchestration facade currently not yet universal for all command/lifecycle paths |
| canonical regenerate API (module) | command/web_api/cli_offline (shared module call) | [src/sessions/sessionRecaps.ts](src/sessions/sessionRecaps.ts#L362) | `regenerateSessionRecap()` | force true generation + optional reason stamp in meta_json | `session_recaps` | `writes_truth_directly` | web path currently uses this; command showtime path does not |
| legacy /session recap | command | [src/commands/session.ts](src/commands/session.ts#L321) | `if (sub === "recap")` | summarizes stored meecap narrative via LLM (`chat`) | none (response-only) | `regenerate_semantics_differs` | depends on `meecaps.meecap_narrative` existence |
| legacy /session meecap | command | [src/commands/session.ts](src/commands/session.ts#L473) | `if (sub === "meecap")` -> `generateMeecapStub()` | narrative or v1_json meecap generation | `meecaps`, `meecap_beats`, filesystem meecap narrative export | `writes_derived_maybe_treated_as_truth` | legacy lane; may be consumed by legacy recap command |
| recap:test tool | cli_offline | [src/tools/recap-test.ts](src/tools/recap-test.ts#L1) | `main()` -> sessionRecaps generate/regenerate | canonical sessionRecaps generation/regeneration | `session_recaps` (and underlying recapEngine side-effects) | `writes_truth_directly` | offline validation tool |
| worker-triggered recap generation | worker | none found in active runtime code sweep | none found | none found | none found | none | worker docs exist ([docs/MEGAMEECAP_WORKER.md](docs/MEGAMEECAP_WORKER.md)), but D1 found no direct runtime recap generation entrypoint wired as worker trigger |

## Persistence store table

| store | write_role | written_by | read_by | status | notes |
|---|---|---|---|---|---|
| `session_recaps` | `canonical_truth` | sessionRecaps upsert path [src/sessions/sessionRecaps.ts](src/sessions/sessionRecaps.ts#L407) | bot `getSessionRecap()` [src/sessions/sessionRecaps.ts](src/sessions/sessionRecaps.ts#L250), web `readSessionRecap()` [apps/web/lib/server/readData/archiveReadStore.ts](apps/web/lib/server/readData/archiveReadStore.ts#L687), recap:test | canonical | 3-view contract (`concise_text`, `balanced_text`, `detailed_text`) [src/db/schema.sql](src/db/schema.sql#L223) |
| `session_artifacts` row `artifact_type='recap_final'` | `compatibility_truth` | recapEngine [src/sessions/recapEngine.ts](src/sessions/recapEngine.ts#L306) | bot legacy fallback [src/sessions/sessionRecaps.ts](src/sessions/sessionRecaps.ts#L108), web fallback [apps/web/lib/server/readData/archiveReadStore.ts](apps/web/lib/server/readData/archiveReadStore.ts#L752), command status/list surfaces | compatibility | historically treated as final recap lane in command surfaces; blueprint target is derived-only |
| `session_artifacts` row `artifact_type='megameecap_base'` | `derived_output` | recapEngine base cache sync [src/sessions/recapEngine.ts](src/sessions/recapEngine.ts#L367) and [src/sessions/recapEngine.ts](src/sessions/recapEngine.ts#L438) | command status/detail helpers and artifact locator | derived | base cache for final pass orchestration |
| filesystem exports under campaign meecaps dir | `derived_output` | recapEngine + megameecap IO [src/sessions/recapEngine.ts](src/sessions/recapEngine.ts#L272) | artifact locator status/read [src/sessions/megameecapArtifactLocator.ts](src/sessions/megameecapArtifactLocator.ts#L169) | derived | includes legacy filename fallback behavior |
| `meecaps` | `compatibility_truth` | `/session meecap` [src/commands/session.ts](src/commands/session.ts#L473) | `/session recap` [src/commands/session.ts](src/commands/session.ts#L321), bot/web fallback layers | legacy compatibility | narrative + optional json lane [src/db/schema.sql](src/db/schema.sql#L244) |
| `meecap_beats` | `derived_output` | beats derivation in legacy meecap command flow [src/commands/session.ts](src/commands/session.ts#L501) | downstream tools/lanes; not canonical recap read path | derived | normalized beat artifacts [src/db/schema.sql](src/db/schema.sql#L257) |
| offline replay/chunk worker artifacts | `debug_export_only` | documented worker/offline replay docs lane | operator diagnostics docs/tools | debug/export | evidence in [docs/MEGAMEECAP_WORKER.md](docs/MEGAMEECAP_WORKER.md#L100); not mapped as active recap truth path |

## Read precedence + field-shape drift matrix

### Reader A: bot canonical accessor

Source: `getSessionRecap()` in [src/sessions/sessionRecaps.ts](src/sessions/sessionRecaps.ts#L250)

| reader | precedence_order | layer_source | field_shape | style_semantics | metadata/provenance | null/empty behavior | drift_notes |
|---|---|---|---|---|---|---|---|
| bot `getSessionRecap` | 1 | `session_recaps` | full `SessionRecap` with all views, engine/source hash/strategy/meta | all styles real outputs | created/updated from canonical row | n/a | baseline canonical |
| bot `getSessionRecap` | 2 | `session_artifacts.recap_final` | mapped into same `SessionRecap` shape | concise/balanced/detailed all synthesized to same legacy body | created/updated from artifact created time; keeps artifact meta if present | returns non-empty for all 3 views due synthesis | diverges from B1 target (`balanced-only`) |
| bot `getSessionRecap` | 3 | `meecaps.meecap_narrative` | mapped into same `SessionRecap` shape | concise/balanced/detailed all synthesized to same narrative | source_hash null, strategy legacy marker | returns non-empty for all 3 views due synthesis | diverges from B1 target (`balanced-only`) |

### Reader B: web archive read store

Source: `readSessionRecap()` in [apps/web/lib/server/readData/archiveReadStore.ts](apps/web/lib/server/readData/archiveReadStore.ts#L687)

| reader | precedence_order | layer_source | field_shape | style_semantics | metadata/provenance | null/empty behavior | drift_notes |
|---|---|---|---|---|---|---|---|
| web `readSessionRecap` | 1 | `session_recaps` | `ArchiveRecap` with `source:"canonical"` and full view set | all styles real outputs | canonical row metadata preserved | n/a | baseline canonical |
| web `readSessionRecap` | 2 | `session_artifacts.recap_final` | `ArchiveRecap` with `source:"legacy_artifact"` | balanced real, concise/detailed set to empty string | created/updated from artifact created time | concise/detailed explicit empty strings | aligned to B1 target behavior |
| web `readSessionRecap` | 3 | `meecaps.meecap_narrative` | `ArchiveRecap` with `source:"legacy_meecap"` | balanced real, concise/detailed set to empty string | source_hash null, strategy legacy marker, meta null | concise/detailed explicit empty strings | aligned to B1 target behavior |

Drift summary (code-verified):
- Fallback order is aligned between bot and web (`session_recaps -> recap_final -> meecap`).
- Fallback style-shape semantics are not aligned:
  - bot synthesizes all three views with legacy body.
  - web sets balanced only and empties concise/detailed.
- This is a B1 prerequisite freeze item.

## Dependency cascade map

| surface | class | downstreams | code_owner | runtime_owner | ops_doc_owner | decision | rationale |
|---|---|---|---|---|---|---|---|
| `src/sessions/recapEngine.ts` direct command/lifecycle usage | production code | command showtime + sessions recap | unassigned (sessions/runtime) | unassigned (sessions/runtime) | unassigned (ops/docs) | migrate | bypasses canonical sessionRecaps facade in key triggers |
| `src/sessions/sessionRecaps.ts` canonical facade | production code | web regenerate + recap:test + future unified service | unassigned (sessions/runtime) | unassigned (sessions/runtime) | unassigned (ops/docs) | retain/migrate-to-single-boundary | target canonical boundary |
| `/meepo sessions recap` command path | command handler | user-facing Discord recap generation | unassigned (sessions/runtime) | unassigned (sessions/runtime) | unassigned (ops/docs) | migrate | currently writes compatibility lane via recapEngine path |
| showtime async kickoff recap path | lifecycle | launch-critical closed-alpha loop | unassigned (sessions/runtime) | unassigned (sessions/runtime) | unassigned (ops/docs) | migrate cautiously | keep lifecycle success semantics while converging recap path |
| `/session recap` legacy command | command handler | DM recap flow from meecap narrative | unassigned (sessions/runtime) | unassigned (sessions/runtime) | unassigned (ops/docs) | shim then deprecate | legacy consumer semantics differ from canonical contract |
| `/session meecap` legacy command | command handler | meecap + beats pipelines | unassigned (sessions/runtime) | unassigned (sessions/runtime) | unassigned (ops/docs) | quarantine or retain (non-recap use) | may still serve non-recap downstreams |
| web recap/regenerate routes | web routes | session detail recap visibility + regenerate action | unassigned (web/archive) | unassigned (web/archive) | unassigned (ops/docs) | retain + align semantics | already on canonical regenerate path |
| recap/test and recap-adjacent tools | tools/CLI | manual QA and migration checks | unassigned (sessions/runtime) | unassigned (sessions/runtime) | unassigned (ops/docs) | retain | useful for contract verification |
| recap contract/fallback tests | tests | protects compatibility and canonical behavior | unassigned (sessions/runtime) | unassigned (sessions/runtime) | unassigned (ops/docs) | retain and expand in B1/C1 | needed to freeze semantics |
| release/state/ops docs with recap truth claims | docs/runbooks | operator expectations + release gates | unassigned (ops/docs) | unassigned (ops/docs) | unassigned (ops/docs) | update when code converges | docs currently include mixed-era claims |

## Risk register

1. Behavioral ambiguity: dual truth perception
- `session_artifacts.recap_final` still written by active command/lifecycle routes and consumed by readers.
- Risk: compatibility lane treated as operational truth.

2. Behavioral ambiguity: fallback mapping drift
- bot fallback synthesizes all views from legacy body.
- web fallback returns balanced-only with empty concise/detailed.
- Risk: inconsistent UX/API contract between bot and web for same legacy session.

3. Behavioral ambiguity: boundary bypass
- active command/lifecycle routes call recapEngine directly, bypassing sessionRecaps canonical orchestration boundary.
- Risk: non-equivalent generation semantics persist.

4. Regenerate semantics mismatch
- web regenerate uses canonical force path with reason metadata.
- command `/meepo sessions recap` uses command cooldown/dedupe semantics and style-specific generation.
- Risk: operator confusion and uneven protections.

5. Docs vs code drift
- docs contain both canonicalized and compatibility-era statements.
- Risk: implementation decisions based on stale or aspirational docs.

6. Lifecycle coupling risk
- release contract expects showtime end success independent from async artifact failures.
- Risk during A1/A3: accidental coupling of session-end success to recap generation result.

## Completeness appendix

Method:
- Searched for these tokens across workspace using code search: `session_recaps`, `recap_final`, `generateSessionRecap`, `regenerateSessionRecap`, `meecap`, `session_artifacts`, `recapEngine`, `/regenerate`, `/recap`.
- Runtime surfaces mapped into tables above.

Reconciliation rule:
- A hit is reconciled only if it is either:
  - represented in this document tables, or
  - listed below as excluded with rationale.

### Mapped hit classes

- Runtime recap generation/read paths:
  - [src/commands/meepo.ts](src/commands/meepo.ts)
  - [src/commands/session.ts](src/commands/session.ts)
  - [src/sessions/recapEngine.ts](src/sessions/recapEngine.ts)
  - [src/sessions/sessionRecaps.ts](src/sessions/sessionRecaps.ts)
  - [src/sessions/sessions.ts](src/sessions/sessions.ts)
  - [apps/web/lib/server/readData/archiveReadStore.ts](apps/web/lib/server/readData/archiveReadStore.ts)
  - [apps/web/lib/server/sessionReaders.ts](apps/web/lib/server/sessionReaders.ts)
  - [apps/web/app/api/sessions/[sessionId]/recap/route.ts](apps/web/app/api/sessions/%5BsessionId%5D/recap/route.ts)
  - [apps/web/app/api/sessions/[sessionId]/regenerate/route.ts](apps/web/app/api/sessions/%5BsessionId%5D/regenerate/route.ts)
- Schema/migrations and storage contracts:
  - [src/db/schema.sql](src/db/schema.sql)
  - [src/db.ts](src/db.ts)
- Offline/tools surfaces:
  - [src/tools/recap-test.ts](src/tools/recap-test.ts)
- Tests that encode current behavior:
  - [src/tests/test-session-recaps-api.ts](src/tests/test-session-recaps-api.ts)
  - [src/tests/test-web-phase55-authority-and-recaps.ts](src/tests/test-web-phase55-authority-and-recaps.ts)
  - recapEngine and command contract tests under [src/tests](src/tests)

### Excluded hits (explicit)

1. Build/index artifacts
- `apps/web/tsconfig.tsbuildinfo`
- Rationale: generated build metadata, not runtime surface.

2. Historical or planning docs
- [CHANGELOG.md](CHANGELOG.md)
- [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md)
- [docs/MEGAMEECAP_CANONIZATION_BLUEPRINT.md](docs/MEGAMEECAP_CANONIZATION_BLUEPRINT.md)
- [docs/old/HANDOFF.md](docs/old/HANDOFF.md)
- [docs/ops/V1_5_CLOSED_ALPHA_REALIGNMENT_KNOWLEDGE_PASS.md](docs/ops/V1_5_CLOSED_ALPHA_REALIGNMENT_KNOWLEDGE_PASS.md)
- Rationale: evidence inputs; not authoritative runtime path definitions.

3. Type/API declarations only
- `apps/web/lib/api/types.ts`
- Rationale: interface declarations, no generation behavior.

4. UI copy and route references
- `src/ui/metaMeepoVoice.ts`
- [docs/MAP.md](docs/MAP.md)
- Rationale: string/docs references only.

Unreconciled active-runtime hits: none identified in D1 sweep.

## Open questions / unresolved ambiguities blocking C1

1. Fallback shape freeze decision
- Should bot fallback semantics be changed to match web (`legacy_* => balanced-only + empty concise/detailed`) before C1 contract lock?
- Blocker reason: C1 API contract and command/API parity depend on this.

2. Write-role policy for `session_artifacts.recap_final`
- During B1, does `recap_final` remain `compatibility_truth` temporarily or become strictly `derived_output` immediately with mirror policy?
- Blocker reason: determines adapter behavior and stopline policy.

3. Canonical boundary enforcement scope
- Should command/lifecycle paths be forced onto sessionRecaps in C1, or postponed fully to A1/A2?
- Blocker reason: C1 non-invasive requirement vs boundary consistency.

4. Cooldown/dedupe parity
- Should web regenerate adopt shared dedupe/cooldown semantics, or remain independent action path?
- Blocker reason: cross-surface semantics and operator expectations.

5. Lifecycle success contract during cutover
- How to preserve showtime end success independence while converging recap generation boundary?
- Blocker reason: closed-alpha release contract guardrail.
