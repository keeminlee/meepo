# Recap API Contract C1

Status: C1 stabilization baseline
Date: 2026-03-10

## Goal

Define one canonical recap interface and service boundary, then stabilize read/write behavior at that boundary without deleting legacy paths.

## Canonical Service Boundary

Module:
- `src/sessions/recapService.ts`

Boundary methods:
- `getSessionRecapContract(args)`
- `generateSessionRecapContract(args)`
- `regenerateSessionRecapContract(args)`

These methods provide a stable recap contract regardless of caller surface (command/web/tooling), while preserving existing route behavior during transition.

## Canonical Contract Shape

`SessionRecapContract` fields:
- `concise`
- `balanced`
- `detailed`
- `engine`
- `source_hash`
- `strategy_version`
- `meta_json`
- `generated_at_ms`
- `created_at_ms`
- `updated_at_ms`
- `source` (`canonical | legacy_artifact | legacy_meecap`)

## Boundary Read Behavior (C1)

Read precedence at service boundary:
1. canonical `session_recaps`
2. legacy `session_artifacts` (`recap_final`)
3. legacy `meecaps` narrative

C1 note:
- This preserves existing behavior intentionally.
- Legacy fallback shape drift is a B1 freeze task, not a C1 behavior change.

## Boundary Write Behavior (C1)

- `generateSessionRecapContract` writes canonical recap contract via `sessionRecaps` generation flow.
- `regenerateSessionRecapContract` force-refreshes canonical row and optionally stamps reason metadata.
- Legacy writers remain present for compatibility in existing callers during C1.

## API Surface Stabilization (Web)

Web recap DTO (`apps/web/lib/types.ts`) now includes additive metadata fields:
- `engine`
- `sourceHash`
- `strategyVersion`
- `metaJson`

Mapping source:
- `apps/web/lib/mappers/sessionMappers.ts`

This is additive and non-breaking for current consumers.

## Non-goals in C1

- No legacy path deletion.
- No command rewiring to new boundary yet.
- No fallback order changes.
- No compatibility mapping semantic changes.

Those changes are deferred to B1/A1/A2.
