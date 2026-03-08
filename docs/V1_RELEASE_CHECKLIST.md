# V1 Release Checklist

This checklist is the source of truth for shipping `v1.0.0`.

## 1) Automated Ship Gate

- Run `npm run ci:verify`
- Gate must pass all of the following in order:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test:smoke`
  - `npm run test`
  - `npm run stopline:no-getdb-runtime`
  - `npm run stopline:active-session-boundary`
  - `npm run stopline:runtime-scope-fallbacks`
  - `npm run stopline:observability-runtime`
  - `npm run stopline:no-raw-env`
  - `npm run stopline:repo-hygiene`

## 2) Deterministic Smoke Tests

- `src/tests/smoke/test-megameecap-fixture.ts`
  - Uses fixture transcript only
  - No network / no LLM API calls
  - Verifies output shape and file writes
- `src/tests/smoke/test-silver-seq-fixture.ts`
  - Uses fixture transcript only
  - No network calls
  - Verifies deterministic segmentation + artifact set
- `src/tests/voice/test-voice-interrupt.ts`
  - Verifies playback interrupt on user speech start

Fixture root:

- `src/tests/fixtures/sessions/fixture_v1/`

## 3) Manual Checks (Required)

- Voice interrupt sanity:
  - Active playback is interrupted by live user speech in immediate mode
  - Speaking state clears after interrupt
- Silver-Seq artifact sanity:
  - `params.json`, `transcript_hash.json`, `eligible_mask.json`, `segments.json`, `metrics.json` are present
- MegaMeecap artifact sanity:
  - Baseline markdown + meta JSON always written
  - Final output written when final pass is enabled
- Meepo sessions recap UX sanity (Phase 1D):
  - `/meepo sessions list` shows kind + recap status (`✅` or `—`)
  - `/meepo sessions view session:<id>` shows base cache status + most recent final recap metadata
  - `/meepo sessions recap session:<id> style:<pass>` generates recap only for canon/non-lab sessions
  - Base validity uses `source_hash + base_version`; final validity uses `source_hash + final_style + final_version`
  - Base file cache is reusable across final style changes
  - DB contains one `recap_final` row per session (new style overwrites canonical most recent final)
  - Ambient or lab sessions return friendly canon-only refusal
  - Top-level `/meepo recap` is not present
  - Cache invalidation: base regenerates on hash/version mismatch or missing files; final regenerates on style/version mismatch, missing files, or `force:true`

## 4) Release Metadata

- `CHANGELOG.md` contains V1 scope and known gaps
- Version in `package.json` is `1.0.0`
- Tag readiness: `v1.0.0`

## 5) Go / No-Go

- Go only if:
  - CI gate passes end-to-end
  - Manual checks pass
  - Known gaps are explicitly documented

## 5.1) Deploy Workflow

- GitHub deployment workflow exists at `.github/deploy.yml`.
- Expected pipeline behavior:
  - `verify` runs `npm run ci:verify`
  - `deploy` runs on `main` after verify succeeds
- Local command registration remains available via `npm run dev:deploy` and should use REST-only deploy path.

## 5.2) Awakening Logging Note

- Current awaken runtime includes extensive structured diagnostics for interaction lifecycle hardening.
- During active `/meepo awaken` testing, logs are expected to be chatty; verify key error markers are preserved.
- If terminal noise obscures signal, confirm noisy markers are at `debug` and stage/error signals remain visible.

## 5.3) Lifecycle Contract Alignment (Run 3)

- Runtime contract terms are used consistently in docs and operator notes:
  - `Dormant`
  - `Awakened`
  - `Ambient` (behavior within awakened/no-session)
  - `Showtime`
- Command contract checks:
  - `/meepo awaken` is one-time initialization and does not start a showtime session
  - repeat `/meepo awaken` is harmless guidance
  - `/meepo showtime start` rejects duplicate active-session starts
  - `/meepo showtime end` succeeds independently from async artifact generation failures
- Legacy wizard-flow checks:
  - old awaken component interactions are unreachable in production flow and return migration guidance

## 5.4) Boot Recovery & Crash Safety (Sprint 4)

- Startup runs recovery before reconciliation:
  - recovery mutates DB truth (`active -> interrupted` when needed)
  - reconciliation derives runtime state from post-recovery DB
- Boot logging includes:
  - `[BOOT] Recovering interrupted sessions...`
  - `[BOOT] Marked interrupted: session_id=...`
  - `[BOOT] Recovery complete.`
- Session safety checks:
  - lingering `active` sessions from crashes become `interrupted`
  - `completed` sessions are unchanged by recovery
  - interrupted sessions do not block a fresh showtime start
  - no duplicate active session per guild

## 5.5) Multi-Guild Reliability (v1.5)

- Isolation checks:
  - runtime queries are guild-scoped (`guild_id`) and campaign-scoped DB routing is enforced
  - no silent campaign fallback across guild/campaign boundaries
- Session safety checks:
  - `sessions.status` transitions are constrained to `active -> completed` and `active -> interrupted`
  - duplicate active session starts are rejected (DB + command guards)
- Cost/rate guardrails:
  - recap requests enforce dedupe/capacity/cooldown protections
  - recall request throttles and queue backpressure are active
- User-facing failure contract:
  - memory/recall/recap failures return safe user copy with error code and optional trace id
  - raw stack traces are not surfaced to users

## 5.6) Recap Contract Hardening (Run 3)

- Contract tests:
  - explicit tests validate all-three-view persistence and retrieval (`concise|balanced|detailed`)
  - repeated generation/regeneration verifies overwrite semantics while preserving `created_at_ms`
- Backward compatibility:
  - existing `/meepo sessions recap` command contract tests remain green (no command cutover in Run 3)
- Tooling:
  - `npm run recap:test -- --guild <guild_id> --session <session_id>` prints the stored canonical recap contract
  - `--regenerate [--reason <text>]` path overwrites safely and records regeneration context
- Migration note:
  - `session_recaps` is canonical multi-view recap store
  - `session_artifacts` remains compatibility lane until a later production cutover

## 6) GitHub Release Draft (v1.0.0)

### Release Title (Primary)

`Meepo v1.0.0 — First Public Release: Voice-First Session Memory for D&D`

### Alternate Titles

- `Meepo v1.0.0 — Debut Release (Discord Voice, Ledger, Recaps, and Silver Lanes)`
- `Meepo 1.0 — The First Stable Campaign Companion Release`

### Release Notes (Paste into GitHub)

Meepo `v1.0.0` is the first public GitHub release of Meepo: a diegetic Discord companion for D&D campaigns that listens in-session, preserves narrative continuity, and supports recap + memory workflows.

This debut release stabilizes the core runtime loop, introduces deterministic offline lanes for transcript processing, and hardens the release gate for repeatable quality checks.

#### What’s New in v1.0.0

- Added deterministic Silver-Seq segmentation lane with artifact-producing tooling (`src/silver/seq/*`).
- Added online events compile core reused by live events tooling (`src/events/compileEvents/*`).
- Added MegaMeecap v1 modular orchestration with prompt, carry, and I/O modules (`src/tools/megameecap/*`).
- Extracted registry scan/review core with focused tests (`src/registry/scanNamesCore.ts`, `src/registry/reviewNamesCore.ts`).
- Added bronze transcript view contract + provenance handling in transcript builder.

#### Core Runtime Capabilities

- Discord text + voice integration with STT -> LLM -> TTS closed-loop response flow.
- Session lifecycle and append-only ledger capture for campaign continuity and recap tooling.
- Persona-aware behavior, command surfaces for Meepo/session control, and DM-oriented operational tools.
- OBS overlay support for real-time speaking/presence indicators (`/overlay`, WebSocket updates, registry-driven token loading).
- Campaign-scoped DB routing guardrails to reduce cross-campaign data leakage risk.

#### Tooling and Developer Workflow

- Release gate standardized behind `npm run ci:verify`:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test:smoke`
  - `npm run test`
  - `npm run stopline:no-getdb-runtime`
  - `npm run stopline:active-session-boundary`
  - `npm run stopline:runtime-scope-fallbacks`
  - `npm run stopline:observability-runtime`
  - `npm run stopline:no-raw-env`
  - `npm run stopline:repo-hygiene`
- Added deterministic fixture-backed smoke coverage for MegaMeecap + Silver-Seq.
- Added targeted voice interrupt test coverage.
- CI workflow executes `npm run ci:verify` on push and PR.

#### Install / Runtime Notes

- Version: `1.0.0`
- Runtime: Node.js `22` recommended.
- Required credentials: `DISCORD_TOKEN`, `OPENAI_API_KEY`.
- Core startup:
  - `npm install`
  - `npm run dev:deploy`
  - `npm run dev:bot`

#### Secondary Systems in v1

- Missions and meeps command surfaces are available and usable in v1.
- Economy/mission systems continue to evolve; expect incremental improvements in upcoming releases.

#### Known Gaps (Explicit)

- Some broader test coverage still depends on campaign DB snapshots and is not fully fixture-only.
- Legacy and v1 tool paths still coexist in some areas; canonical paths are documented but not fully pruned.
- Smoke tests validate deterministic contracts and artifact shape, not full behavioral/load characteristics.

#### Thanks and Forward Path

This release establishes Meepo’s baseline as a voice-first narrative companion with deterministic processing lanes and stronger release discipline. Next iterations focus on continued consolidation, deeper fixture-first coverage, and expanded memory/reasoning quality.