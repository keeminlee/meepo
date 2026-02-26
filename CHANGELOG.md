# Changelog

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