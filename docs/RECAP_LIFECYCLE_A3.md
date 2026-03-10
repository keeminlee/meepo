# Recap Lifecycle Tightening A3

Status: A3 implemented
Date: 2026-03-10

## Goal

Tighten recap lifecycle semantics while preserving showtime end safety and recap compatibility behavior.

## Implemented

1. Explicit recap readiness state model for session detail surfaces.

- Added readiness states: `pending | ready | failed`.
- Canonical/web session detail now includes `recapReadiness`.

Files:
- `apps/web/lib/server/readData/archiveReadStore.ts`
- `apps/web/lib/server/sessionReaders.ts`
- `apps/web/lib/types.ts`
- `apps/web/lib/mappers/sessionMappers.ts`
- `apps/web/components/session/session-header.tsx`

2. Deterministic recap readiness transition events in showtime async flow.

- Added `SESSION_RECAP_STATUS` lifecycle events in async kickoff path:
  - `pending` at kickoff
  - `pending` when retry is scheduled
  - `ready` when generation succeeds
  - `failed` when retry budget is exhausted

File:
- `src/commands/meepo.ts`

3. Bounded retry policy for post-session recap generation failure.

- Added bounded attempts and retry delay constants.
- Recap generation during showtime artifact kickoff retries deterministically before terminal failure.

File:
- `src/commands/meepo.ts`

## Read Model Contract Notes

`readSessionRecapReadiness(...)` reads the latest `system,SESSION_RECAP_STATUS` event and applies deterministic fallback when status events are absent:

- recap row exists => `ready`
- session active/completed with no recap row => `pending`
- otherwise => `failed`

## Preserved Semantics

- Session-end safety remains unchanged: `/meepo showtime end` finalization remains decoupled from async recap generation result.
- Fallback precedence and compatibility mapping remain unchanged from B1.

## Tests Updated

- `src/tests/test-meepo-showtime-end-leaves-voice.ts`
  - asserts readiness transitions for success and failure paths
- `src/tests/test-meepo-awaken-ordering.ts`
  - retry-aware failure mock behavior
- `src/tests/test-web-phase55-authority-and-recaps.ts`
  - canonical detail readiness assertions

## Validation

Executed and passed:

- `npx vitest run src/tests/test-meepo-showtime-end-leaves-voice.ts src/tests/test-meepo-awaken-ordering.ts src/tests/test-web-phase55-authority-and-recaps.ts`
- `npm run typecheck`

Result:

- Test Files: 3 passed
- Tests: 20 passed
