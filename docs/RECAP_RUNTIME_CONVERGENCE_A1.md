# Recap Runtime Convergence A1

Status: A1 implemented
Date: 2026-03-10

## Goal

Move lifecycle and command recap generation entrypoints onto the canonical recap boundary while preserving existing runtime behavior and lifecycle success guarantees.

## Scope Implemented

Rewired recap generation callsites in meepo command surfaces:

- showtime async artifact kickoff now calls canonical boundary:
  - `generateSessionRecapContract(...)`
- `/meepo sessions recap` now calls canonical boundary:
  - `generateSessionRecapContract(...)`

Updated file:
- `src/commands/meepo.ts`

## Behavioral Notes

- No legacy paths were deleted.
- No fallback precedence changes were introduced.
- Showtime end still completes independently of async recap/artifact failure.
- Existing command cooldown/dedupe rails remain in place.

## Compatibility Mapping in Command Output

Because canonical boundary returns the stabilized contract (not legacy recapEngine response shape), command formatting now derives:

- preview text from selected style view (`concise|balanced|detailed`)
- `cacheHit` from `meta_json.styles[style].cacheHit`
- source hash from `source_hash` (or style metadata fallback)
- version fields from `strategy_version` and metadata fallback

## Tests Updated

Adjusted meepo command/lifecycle tests to mock the canonical boundary module instead of recapEngine:

- `src/tests/test-meepo-sessions-recap-contract.ts`
- `src/tests/test-meepo-showtime-end-leaves-voice.ts`
- `src/tests/test-meepo-awaken-ordering.ts`

## Validation

Executed and passed:

- `npx vitest run src/tests/test-meepo-sessions-recap-contract.ts src/tests/test-meepo-showtime-end-leaves-voice.ts src/tests/test-meepo-awaken-ordering.ts`
- `npm run typecheck`
