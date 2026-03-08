# Changelog

## v1.10 - 2026-03-07

### Added

- Shipped Track B chronicle archive viewer in `apps/web` using Next App Router.
- Added canonical browse flow across web routes:
  - `/`
  - `/dashboard`
  - `/campaigns/[campaignSlug]`
  - `/sessions/[sessionId]`
- Added internal web API boundary for campaign/session reads and recap regeneration.
- Added session-level recap regenerate UX with pending, success refresh, and user-safe failure messaging.
- Added transcript/recap download actions (`.txt` and `.json`) in session detail.

### Changed

- Migrated web data flow from mock-first adapters to canonical guild-scoped readers through API clients.
- Hardened transcript viewer for long sessions with incremental loading (`Load more lines`) and safer overflow behavior.
- Improved session viewer polish: breadcrumbs, artifact/status chips, and clearer metadata headers.

### B2.5 Hygiene

- Removed Google Fonts CSS `@import` usage in favor of `next/font` in `apps/web` layout.
- Set explicit `outputFileTracingRoot` in `apps/web/next.config.ts` to eliminate lockfile root inference warning.
- Added web-local ESLint flat config and temporarily configured web builds to skip lint during `next build` (`eslint.ignoreDuringBuilds`) as a known milestone tradeoff.

## v1.9 - 2026-03-06

### Sprint 3 Hardening (Operational Closure)

- Completed expensive-job safety rails for recap and retrieval paths:
  - edge + engine in-flight dedupe,
  - recap cooldown with explicit `force` semantics,
  - keyed worker back-pressure for expensive action families.
- Completed user-safe failure taxonomy rollout across priority command/voice surfaces:
  - canonical error codes,
  - deterministic formatter contract (`failureClass`, `retryable`, `correctiveActionRequired`),
  - retry-after/corrective guidance where applicable.
- Completed observability closure in strict runtime zones:
  - structured runtime failure logging normalization,
  - new runtime observability stopline (`stopline:observability-runtime`) wired into CI,
  - concise operational runbook in `docs/OPS_RUNBOOK.md`.

### Reliability Notes

- Voice/reply degradation now uses taxonomy-safe fallback behavior for explicit reply failures.
- Optional enrichment failures degrade quietly with telemetry instead of breaking reply flow.

## v1.8 - 2026-03-04

### Changed

- Renamed user-facing awakening command from `/meepo wake` to `/meepo awaken`.
- Removed public `/meepo awaken session:<...>` surface; awakening no longer accepts manual session option.
- Added dev fallback/debug routes under `/lab awaken`:
  - `/lab awaken respond text:<...>`
  - `/lab awaken status`
- Kept deprecated response alias behavior for stale `/meepo ... response` invocations behind `DEV_USER_IDS` gate, otherwise returns moved guidance.

### Awakening Runtime

- Enforced defer-first interaction pattern for awaken flow (`deferReply` first, prompt UI via `editReply`).
- Ensured prompt rendering occurs after scene say sequence completion.
- Added computed template variables in awakening context assembly:
  - `home_channel` from `home_channel_id` as channel mention
  - `current_channel` from `current_channel_id` as channel mention
- Seeded runtime `current_channel_id` from `interaction.channelId` at run start.

### Tests

- Added regression ordering test for awaken flow interaction sequencing.
- Updated command manifest and lab-gating tests for `/meepo awaken` and `/lab awaken` surface.

## v1.7 - 2026-03-04

### Changed

- Moved dev/maintenance command surface behind `/lab`:
  - `/meepo doctor` → `/lab doctor`
  - `/meepo sleep` → `/lab sleep`
  - `/goldmem` → `/lab goldmem run`
  - `/meeps ...` → `/lab meeps ...`
  - `/missions ...` → `/lab missions ...`
- Public `/meepo` surface now excludes `doctor` and `sleep` subcommands.
- Added stale-command redirect replies for legacy top-level `/goldmem`, `/meeps`, and `/missions` invocations.

### Security

- All moved `/lab` routes remain gated by `DEV_USER_IDS` user allowlist.

## v1.6 - 2026-03-04

### Added

- Completed Awakening Runtime interactive surface for onboarding and ritual-style workflows.
- Prompt primitives: `choice`, `modal_text`, `role_select`, `channel_select`, `registry_builder`.
- Nonce-protected interaction submission model (`scene_id`, `key`, `nonce` validation).
- Ordered runtime action dispatcher with stable grep-friendly action logs.
- Best-effort `join_voice_and_speak` action support.
- Deterministic resume behavior across pending prompts and scene progression.

### Changed

- Channel drift is executed as `channel_select` prompt post-processing with runtime-only channel context switching.
- Typed fallback `/meepo wake response:<text>` now targets pending `modal_text` prompts under DM identity gating.

## v1.5 - 2026-03-04

### Added

- Dynamic STT prompt refresh pipeline via `refresh-stt-prompt` action.
- Per-guild STT prompt generation from campaign registry references.
- Runtime STT prompt state support and provider forwarding by guild.

### Changed

- OpenAI STT path accepts runtime prompt overrides.
- Session start enqueues STT prompt refresh in canonical runtime flow.

## v1.4 - 2026-03-04

### Added

- Setup registry system with append-only YAML writes.
- Setup-phase guardrail for registry mutation safety.
- Atomic registry persistence for deterministic write behavior.

## v1.3 - 2026-03-04

### Added

- Awakening Engine foundations for deterministic onboarding execution.
- Versioned YAML scene scripts and loader path.
- Resumable onboarding state model in onboarding progress storage.
- Engine-owned commit execution model.
- Prompt capability gating with deterministic skip semantics.

## v1.2 - 2026-03-04

### Added

- Heartbeat context substrate and action queue pipeline for canon/ambient ingestion.
- Context action worker + deterministic offline replay tooling for queue drain and artifact regeneration.
- Meepo action observability artifacts (`*.jsonl` + merged `*.log`) and prompt/context/retrieval telemetry events.
- `/lab` UX updates for session/anchor resolution and new `/lab wake run [kind] [label]` flow.

### Changed

- Normalized session kind write semantics to `canon|noncanon` (legacy `chat` rows remain read-compatible).
- Improved overlay startup safety by handling `EADDRINUSE` without crashing bot startup.

### Fixed

- CI stability: `src/tests/test-meepo-context-worker.ts` now mocks env/bootstrap dependencies to avoid `DISCORD_TOKEN` hard-require during test load.
- Replay artifact test reliability: `src/tools/heartbeat/replay.test.ts` now explicitly enables meepo action logging gates for offline artifact assertions.

## v1.1-rc1 - 2026-03-03

### Added

- Centralized `/meepo` app-facing reply strings under [src/ui/metaMeepoVoice.ts](src/ui/metaMeepoVoice.ts) with domain namespaces: `wake`, `sleep`, `talk`, `hush`, `status`, `doctor`, `sessions`, `settings`, `errors`.
- Added tone rail version export: `META_VOICE_VERSION = 1`.
- Added string-boundary regression guard test: `src/tests/test-meepo-voice-boundary.ts`.
- Added voice contract structure test: `src/tests/test-meta-meepo-voice-contract.ts`.

### Changed

- Routed remaining `/meepo` and shared command fallback user-facing errors through `metaMeepoVoice`.
- Updated meepo-facing tests to anchor-token assertions to reduce prose brittleness.
- Documented explicit v1.1 deferral for legacy lab meepo surface in `src/commands/lab.ts`.

## v1.0.0 - 2026-02-26

### Added

- Deterministic Silver-Seq segmentation lane (`src/silver/seq/*`) with artifact-producing tooling.
- Online events compile core (`src/events/compileEvents/*`) reused by live events tooling.
- MegaMeecap v1 modular orchestration (`src/tools/megameecap/*`) with prompt, carry, and IO modules.
- Registry scan/review core extraction (`src/registry/scanNamesCore.ts`, `src/registry/reviewNamesCore.ts`) with focused tests.
- Bronze transcript view contract and provenance handling in transcript builder.

### Quality / Release Gate

- Added explicit smoke gate script: `npm run test:smoke`.
- `npm run ci:verify` now runs smoke tests before full tests.
- Added deterministic fixture-backed smoke tests:
  - `src/tests/smoke/test-megameecap-fixture.ts`
  - `src/tests/smoke/test-silver-seq-fixture.ts`
- Added targeted voice interrupt test:
  - `src/tests/voice/test-voice-interrupt.ts`
- Added release checklist:
  - `docs/V1_RELEASE_CHECKLIST.md`

### WIP Honesty (Known Gaps)

- Some broad test coverage still depends on campaign DB snapshots and is not fixture-only.
- Multiple legacy and v1 tool paths still coexist in places; canonical paths are documented but not fully pruned.
- Smoke tests validate deterministic shape and contracts; they are not full behavioral or load tests.