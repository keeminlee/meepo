# Changelog

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