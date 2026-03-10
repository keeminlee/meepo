# Recap Service Boundary A2

Status: A2 implemented
Date: 2026-03-10

## Goal

Strictly enforce recap generation service-boundary usage for production command/lifecycle surfaces.

## Implemented

1. Command/lifecycle recap generation paths use canonical service entrypoint.

- `src/commands/meepo.ts`
  - showtime async kickoff generation path uses `generateSessionRecapContract(...)`
  - `/meepo sessions recap` uses `generateSessionRecapContract(...)`

2. Removed command-layer recapEngine dependency.

- `src/commands/meepo.ts`
  - removed recapEngine type import from command surface

3. Added stopline guard to prevent boundary bypass.

- `tools/stopline-recap-service-boundary.ps1`
  - fails if `src/commands/**/*.ts` imports `recapEngine.js`
  - fails if `src/commands/**/*.ts` calls `generateSessionRecap(...)` or `regenerateSessionRecap(...)`

4. Added automated stopline regression test.

- `src/tests/test-stopline-recap-service-boundary.ts`

5. Wired enforcement into scripts and CI.

- `package.json`
  - added `stopline:recap-service-boundary`
  - added to `ci:verify`
- `vitest.config.ts`
  - added new stopline test include

## Preserved Semantics

- Session-end safety semantics are preserved.
  - showtime end still succeeds even if async recap generation fails.
- Fallback precedence and compatibility behavior are unchanged.
  - no read-path fallback order/mapping change in A2.

## Validation

- `npm run stopline:recap-service-boundary`
- `npx vitest run src/tests/test-stopline-recap-service-boundary.ts src/tests/test-meepo-sessions-recap-contract.ts src/tests/test-meepo-showtime-end-leaves-voice.ts src/tests/test-meepo-awaken-ordering.ts`
- `npm run typecheck`

All passed.
