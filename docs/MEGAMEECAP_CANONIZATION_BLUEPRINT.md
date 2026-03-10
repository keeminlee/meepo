# MegaMeecap Canonization Blueprint

Status: Draft for planning
Date: 2026-03-10
Scope: Production + development convergence to a single canonical recap generation route

## 1) Executive Goal

Converge the repository onto one recap generation contract:

- One orchestrator API for recap generation and regeneration.
- One canonical persistence target for read/write truth.
- Optional artifact outputs treated as derived outputs, not contract truth.
- Legacy routes retained only as compatibility adapters during bounded migration windows.

This blueprint is intentionally split across multiple tracks and sprints to reduce risk and preserve operational continuity.

## 2) Current-State Gap Summary

Current route topology (simplified):

1. Showtime end path triggers async artifact kickoff and currently writes single-style recap artifacts.
2. Web regenerate path triggers canonical 3-style generation and writes `session_recaps`.
3. Legacy `/session recap` depends on legacy meecap narrative flow.
4. Legacy `/session meecap` writes legacy meecap structures.
5. Read path is canonical-first with fallbacks for legacy artifact/meecap records.

Consequence:

- Generation routes are not behaviorally equivalent.
- Write targets are split.
- Fallback semantics are mixed across modules.
- Session lifecycle completion is not equivalent to canonical recap availability.

## 3) Target Architecture (North Star)

### 3.1 Canonical Contracts

Canonical recap contract:

- Table: `session_recaps`
- Required views: `concise`, `balanced`, `detailed`
- Stable metadata fields:
  - `engine`
  - `source_hash`
  - `strategy_version`
  - `meta_json` with generation receipts

Canonical generation API:

- `generateSessionRecap(args)` produces all required views and persists canonical row.
- `regenerateSessionRecap(args)` force-refreshes canonical row and records reason/audit metadata.

Canonical read contract:

- Reads prefer canonical row from `session_recaps`.
- Compatibility adapter may map legacy material for bounded period.

### 3.2 Derived Outputs

Treat these as derived outputs only:

- `session_artifacts` entries like `recap_final`
- markdown/json file exports for operator convenience

They are allowed for debugging, exports, and ops triage, but should not be used as source-of-truth recap storage.

### 3.3 Legacy Isolation

Legacy routes should be moved behind explicit compatibility boundaries:

- Legacy command namespace only.
- Legacy read adapter only.
- No new primary writes to legacy recap stores after cutover.

## 4) Program Structure: Tracks and Sprints

Program shape: 4 tracks, 8 sprints (2-week nominal cadence).

Tracks can run in parallel where dependencies permit.

---

### Track A: Canonical Runtime Convergence

Objective: move all active generation entry points to the canonical orchestration path.

#### Sprint A1 - Command Path Rewire (showtime and manual recap)

Deliverables:

- Replace showtime recap generation invocation to call canonical `sessionRecaps` orchestration.
- Keep artifact generation hooks as optional side effects (post-canonical write).
- Preserve existing command UX while changing internal generation route.

Acceptance criteria:

- `/meepo showtime end` results in canonical `session_recaps` write for every completed session with transcript.
- No behavior regression in command-level permissions and messaging.

#### Sprint A2 - Generation Service Boundary

Deliverables:

- Introduce a single domain service module (for example `src/sessions/recapService.ts`) that is the only authorized generation entrypoint.
- Refactor web regenerate and command flows to call that service.
- Add explicit idempotency + dedupe policy at service boundary.

Acceptance criteria:

- One generation call graph in production code (service -> style engine -> canonical persistence).
- Route handlers/commands do not call low-level engine persistence directly.

#### Sprint A3 - Lifecycle Contract Tightening

Deliverables:

- Define explicit lifecycle state for recap readiness (`pending`, `ready`, `failed`) in canonical session detail model.
- Ensure showtime end emits deterministic recap generation events and status transitions.
- Add bounded retry worker policy for post-session recap generation failures.

Acceptance criteria:

- End-session does not silently appear complete when recap generation has failed.
- Operators can distinguish pending vs failed vs ready without log digging.

---

### Track B: Data Canonization and Migration

Objective: establish one durable recap truth store and migrate forward safely.

#### Sprint B1 - Compatibility Adapter Spec Freeze

Deliverables:

- Create written compatibility mapping spec:
  - `legacy_artifact -> balanced only`
  - `legacy_meecap -> balanced only`
  - `concise/detailed` remain empty under legacy fallback
- Align all fallback mappers in all modules to this exact behavior.

Acceptance criteria:

- No module disagreement on legacy-to-canonical view mapping.
- Snapshot tests encode fallback mapping contract.

#### Sprint B2 - Backfill Migrator (Optional but Recommended)

Deliverables:

- Build idempotent migration tool to backfill `session_recaps` from legacy stores where canonical row missing.
- Migration stamps rows with `strategy_version` and `meta_json` migration receipt.
- Dry-run and report mode with counts by source type.

Acceptance criteria:

- Re-runnable migration with no duplicate side effects.
- Ops report contains totals, failures, and skipped reasons.

#### Sprint B3 - Legacy Write Freeze

Deliverables:

- Stop writing new recap truth data to legacy stores.
- Keep legacy tables/artifacts read-only for compatibility window.
- Add stopline checks to reject new direct writes to deprecated recap stores (except explicit migration tooling).

Acceptance criteria:

- CI fails if new primary code paths introduce legacy recap writes.
- Only migration/admin paths can touch deprecated write targets.

---

### Track C: API, UX, and Capability Hardening

Objective: make canonical recap behavior explicit and safe in both prod and dev.

#### Sprint C1 - API Contract V2 Stabilization

Deliverables:

- Publish and lock API response contract for session recap endpoints:
  - `status`
  - `source` (`canonical|legacy_*` during migration only)
  - views and timestamps
  - typed errors for `session_not_found`, `transcript_unavailable`, `generation_failed`, `openai_unconfigured`
- Add contract tests covering command + API parity.

Acceptance criteria:

- Regenerate/read surfaces produce identical canonical shape guarantees.
- Error taxonomy is uniform across routes.

#### Sprint C2 - UX State Clarity

Deliverables:

- Explicit UI states for missing-style and legacy-backed content.
- Standardized regenerate error presentation with typed code and action hints.
- Session detail displays recap provenance during migration window.

Acceptance criteria:

- Users can always tell if recap is canonical or compatibility fallback.
- No ambiguous blank-state copy.

#### Sprint C3 - Dev/Prod Parity Rules

Deliverables:

- Define strict env rules for DATA_ROOT/DB resolution and capability gating.
- Add startup assertions for path validity and schema presence in all runtime entrypoints.
- Document one-liner local setup for canonical recap flow tests.

Acceptance criteria:

- No cwd-dependent recap breakage.
- Local and production use same generation contracts and error semantics.

---

### Track D: Deprecation and Dependency Cascade

Objective: retire legacy recap flows safely and remove dead dependencies.

#### Sprint D1 - Legacy Surface Inventory + Owner Map

Deliverables:

- Full inventory of:
  - legacy commands
  - legacy tables/columns
  - legacy adapters
  - docs/runbooks/tests referencing old contracts
- Ownership mapping (codeowner + runtime owner + ops owner).

Acceptance criteria:

- Every legacy surface has one owner and one retirement decision: migrate, shim, or remove.

#### Sprint D2 - Soft Deprecation Window

Deliverables:

- Add warnings to legacy command paths with migration guidance.
- Feature-flag ability to disable legacy command groups per environment.
- Publish timeline for hard deprecation.

Acceptance criteria:

- Legacy usage metrics available and reviewed weekly.
- Teams can opt into disablement in staging first.

#### Sprint D3 - Hard Deprecation + Cleanup

Deliverables:

- Remove or quarantine legacy recap generation commands from primary surfaces.
- Remove unused dependencies introduced only for legacy pathways.
- Archive deprecation notes and finalize schema cleanup RFC.

Acceptance criteria:

- Canonical route is the only production recap generation route.
- Legacy dependencies are removed or isolated in quarantine modules.

## 5) Dependency Cascade Matrix

### 5.1 Legacy Surface -> Action

1. Legacy `/session recap` path
- Action: deprecate command, migrate users to canonical recap read/regenerate.
- Dependency impacts: meecap narrative dependency, prompt maintenance burden, Discord-only output assumptions.

2. Legacy `/session meecap` recap dependency
- Action: retain only if needed for non-recap features; otherwise quarantine under legacy namespace.
- Dependency impacts: meecap schema validators, beats derivation pipelines, related docs/tests.

3. Direct `session_artifacts.recap_final` reliance as truth
- Action: shift to derived-output role only.
- Dependency impacts: readers relying on artifact-first behavior.

4. Mixed fallback semantics
- Action: unify adapter logic and test fixtures.
- Dependency impacts: session readers, API mappers, tests.

### 5.2 Migration vs Cascade-Deprecation Rule

Use this decision policy:

- Migrate if dependency is active in critical user paths or required by ops workflows.
- Cascade-deprecate if dependency exists only to support deprecated recap generation surfaces.

## 6) Hardening Checklist (Best Practices)

### Runtime and correctness

- Idempotent generation requests keyed by `guild+campaign+session`.
- Deterministic per-style validation and non-empty output guards.
- Explicit receipt metadata for every canonical generation write.
- Strong source hash behavior to avoid stale cache trust.

### Operational resilience

- Retry policy with bounded attempts and structured failure status.
- Durable logging with stable event names and error taxonomy.
- Dashboard/ops visibility for recap pipeline health and lag.

### Security and capability boundaries

- Regenerate remains write-authorized action behind guild/campaign ownership checks.
- OpenAI capability gating performed before expensive generation path.
- Dev bypasses remain explicit, non-production only, and auditable.

### Testing and CI

- Contract tests for canonical read/write/regenerate.
- Regression tests for fallback mappings and deprecation warnings.
- Stopline rules to prevent new legacy recap writes in production code.

## 7) Rollout Strategy

### Phase 0 - Shadow Validation (1 sprint)

- Keep existing paths but run canonical generation in shadow for selected sessions.
- Compare outputs and failure rates without changing user-visible source.

### Phase 1 - Controlled Cutover (2 sprints)

- Enable canonical generation as primary for showtime and web regenerate.
- Keep compatibility read fallback and legacy commands soft-deprecated.

### Phase 2 - Write Freeze + Backfill (1-2 sprints)

- Freeze new legacy writes.
- Run backfill migrator where needed.
- Monitor read-source ratio trending to canonical.

### Phase 3 - Legacy Retirement (2 sprints)

- Disable legacy commands in production.
- Remove legacy write paths and dead dependencies.
- Finalize schema cleanup plan/RFC for later execution window.

## 8) Success Metrics and Exit Gates

Primary success metrics:

- 99%+ recap reads served from canonical `session_recaps` (excluding known historical sessions).
- 100% of new sessions produce canonical recaps through one generation service.
- Regenerate failure rate below defined SLO threshold with typed errors.

Exit gates per program:

1. No production entrypoint bypasses canonical generation service.
2. No new legacy recap writes in CI/static checks.
3. Legacy command usage below deprecation threshold and acknowledged by stakeholders.
4. Runbooks/docs updated and on-call trained.

## 9) Recommended Ownership Model

- Track A owner: Session Runtime team.
- Track B owner: Data Platform/Migrations team.
- Track C owner: Web/API + Product UX team.
- Track D owner: Architecture Governance + Ops.

Weekly convergence sync should include all track owners plus on-call representative.

## 10) Immediate Next Actions (Week 1)

1. Approve this blueprint and lock terminology:
- Canonical generation
- Derived artifacts
- Compatibility adapters
- Legacy quarantine

2. Open implementation epics:
- A1 command rewire
- B1 compatibility mapping freeze
- C1 contract stabilization
- D1 inventory and owner mapping

3. Create stopline guardrails before deep refactors:
- prevent new legacy recap writes
- enforce canonical service usage in production entrypoints

4. Establish migration dashboard:
- canonical vs legacy read source ratio
- recap generation success/failure counters
- regenerate error taxonomy distribution

---

This blueprint is intentionally conservative: converge contracts first, then retire legacy surfaces with measurable safety gates.
