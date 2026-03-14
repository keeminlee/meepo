# Meepo Residual Reference Audit

This document records the categories of `Meepo` references that remain acceptable after the StarStory namespace presentation pass.

## Intentionally Retained Categories

- Internal module names and compatibility layers such as `meepo.ts`, `meepoLegacy.ts`, `meepoMind`, and related internal imports.
- Environment variables and config identifiers such as `MEEPO_*`, `BOT_PREFIX=meepo:`, and similar runtime knobs.
- Database, storage, and artifact identifiers that already exist in persisted state and are not directly user-visible.
- Legacy deployment and operational references, including host/runtime labels and deployment notes that still match current infrastructure.
- Lore-bound character references where Meepo clearly refers to the archivist character rather than the platform.

## Acceptable Debt

- Historical sections of long-form architecture docs may still mention `/meepo` when describing older phases or compatibility-era behavior.
- Runtime/auth/docs may still mention `meepo.online` where the canonical-origin cutover has not yet been completed out of repo.
- Internal logging scopes, error types, and worker names may still contain `meepo` until a separate internal cleanup is justified.

## What Should Be Cleaned When Touched

- Web UI branding that presents the platform name to users.
- Product-facing README and current-state docs.
- Discord-facing copy that tells users which public command surface to use.

## Residual Guidance

If a remaining `Meepo` reference is user-visible and clearly means the platform rather than the character, it should be updated when encountered in normal product-facing work.