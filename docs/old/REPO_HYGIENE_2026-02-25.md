# Repo Hygiene Notes (2026-02-25)

This note captures hygiene actions taken to reduce dead/legacy tooling noise.

## Deleted

- `src/tools/old_or_not_now/debug-causal-loops.ts`
- `src/tools/old_or_not_now/extractConvoCandidates.ts`
- `src/tools/old_or_not_now/reset-meepo-memories.ts`
- `src/tools/old_or_not_now/review-convo-memory.ts`
- `tools/_oneoffs/temp-list-ingested.ts`
- `tools/debug-link-295.ts`

## Why

- Files were legacy or one-off scripts with no active CI/runtime integration.
- Keeping them increased dead-code surface and stale guidance risk.

## Policy

- New one-off scripts should not be committed under `tools/_oneoffs/` unless accompanied by `tools/_oneoffs/README.md` justification.
- `src/tools/old_or_not_now/` is treated as disallowed by hygiene stopline.

## Recovery

- Full history is recoverable via git if any script is needed again.
