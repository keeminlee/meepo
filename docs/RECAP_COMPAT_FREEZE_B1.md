# Recap Compatibility Freeze B1

Status: B1 implemented
Date: 2026-03-10

## Goal

Freeze fallback semantics for recap compatibility paths so bot and web readers return the same shape for legacy sources.

## Freeze Decision

For legacy recap sources (`session_artifacts.recap_final` and `meecaps.meecap_narrative`):

- `balanced` carries the legacy body.
- `concise` is an empty string.
- `detailed` is an empty string.

Read precedence remains unchanged:
1. canonical `session_recaps`
2. legacy `session_artifacts` (`recap_final`)
3. legacy `meecaps`

## Implementation

Updated canonical session recap fallback mapping:
- `src/sessions/sessionRecaps.ts`

No write paths were deleted or rewired in B1.
No fallback order changes were introduced in B1.

## Tests Updated

- `src/tests/test-session-recaps-api.ts`
  - legacy artifact fallback now asserts balanced-only shape
  - legacy meecap fallback now asserts balanced-only shape
- `src/tests/test-recap-service-contract.ts`
  - legacy artifact contract now asserts balanced-only shape
  - added legacy meecap contract case asserting balanced-only shape

## Validation

- `npx vitest run src/tests/test-session-recaps-api.ts src/tests/test-recap-service-contract.ts src/tests/test-web-phase55-authority-and-recaps.ts`
- `npm run typecheck`

Both passed.
