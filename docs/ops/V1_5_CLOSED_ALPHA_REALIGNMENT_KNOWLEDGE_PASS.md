# Meepo v1.5 Closed Alpha Realignment (Knowledge Pass)

Date: 2026-03-08

Target branch (requested): `v1.5_finish_line_to_v2`
Current working branch at audit time: `v1.5.1_finish_continued`

## Scope Statement

Closed Alpha success loop:

`/meepo showtime start -> voice capture -> transcript -> /meepo showtime end -> recap -> web archive visibility`

This pass classifies repository surfaces into:

- Category A: keep/harden for deploy
- Category B: roll back or gate
- Category C: defer (non-blocking)

## 1) Repository Audit Summary

### Category A - Core Closed Alpha Infrastructure (KEEP/HARDEN)

Command and lifecycle surface:

- `src/commands/meepo.ts`: canonical `/meepo showtime start|end` lifecycle and system-event emission.
- `src/sessions/sessions.ts`: active-session boundaries, start/end state persistence.
- `src/sessions/lifecycleState.ts`: guild lifecycle derivation.

Voice listen/capture path:

- `src/voice/connection.ts`: voice connect/disconnect and reconnect handling.
- `src/voice/receiver.ts`: Discord PCM subscription and STT capture pipeline.
- `src/voice/stt/provider.ts`, `src/voice/stt/openai.ts`: STT provider abstraction and OpenAI backend.

Transcript + recap pipeline:

- `src/ledger/ledger.ts`: append-only ledger writes.
- `src/ledger/transcripts.ts`: transcript read/build path (bronze + ledger fallback).
- `src/sessions/recapEngine.ts`: recap generation orchestration and artifact upsert.
- `src/sessions/sessionRecaps.ts`: recap persistence and regeneration boundary.

Web archive/read surfaces:

- `apps/web/lib/server/sessionReaders.ts`: scoped session detail/recap/transcript reads.
- `apps/web/lib/server/campaignReaders.ts`: dashboard and campaign/session listing.
- `apps/web/app/api/sessions/[sessionId]/route.ts`: session detail API.
- `apps/web/app/api/sessions/[sessionId]/recap/route.ts`: recap API.
- `apps/web/app/api/sessions/[sessionId]/transcript/route.ts`: transcript API.
- `apps/web/app/dashboard/page.tsx`: dashboard onboarding/session visibility surface.

Deploy/CI control plane:

- `.github/workflows/ci.yml`: `npm run ci:verify` gate.
- `.github/deploy.yml`: verify + EC2 SSH deploy (`sudo /usr/local/bin/deploy-meepo`).
- `package.json`: CI/stopline scripts and bot/web workflows.

### Category B - Experimental/Legacy Surfaces (ROLL BACK OR GATE)

Awaken runtime and wizard scaffolding:

- `src/awakening/**`: engine/prompts/commit actions/reset flows.
- `src/scripts/awakening/**`: scene scripts and runtime content.
- `src/commands/lab.ts`: `/lab awaken` and internal routing wrappers.
- `src/commands/meepo.ts` (awaken-related branches/imports): still imports and surfaces awakening runtime.
- `src/campaign/awakenKeys.ts`: awaken-oriented config key surface.

Legacy command and behavior drift:

- `src/commands/meepoLegacy.ts`: legacy command/event model (`voice_join`, `npc_wake`, etc.).
- `src/bot.ts` auto-awaken path (`AWAKEN-ON-NAME`, autoJoin voice behavior): non-deterministic entrypoint vs showtime doctrine.

Experimental/lab test and docs load:

- `src/tests/test-lab-*.ts`, `src/tests/commands/test-lab-gating.ts`: lab-only maintenance/test burden.
- `docs/LAB_COMMANDS.md`: dev-lab operator surface.

### Category C - Useful But Non-Critical (DEFER)

- Multi-style recap variants and advanced recap controls beyond one stable default (`src/sessions/recapEngine.ts`, `src/sessions/sessionRecaps.ts`).
- Registry builder and awakening identity memory surfaces (`src/awakening/commitActions/*registry*`, related meepoMind wiring).
- Secondary UX polish surfaces in web/session edit affordances that do not gate archive-loop reliability.
- Causal/advanced analysis substrate (`src/causal/**`) until loop reliability metrics are stable.

## 2) Explicit Rollback Plan (ARG/Experimental)

Phase R1: command-surface contraction

- Deprecate public `/meepo awaken` guidance and command copy from help/status paths.
- Keep `showtime start|end` as the only lifecycle contract for Closed Alpha onboarding.
- Gate `/lab` command tree behind explicit env feature flag in non-production only.

Phase R2: runtime path isolation

- Remove auto-awaken message-trigger path in `src/bot.ts`.
- Ensure no session or voice join can occur outside explicit `/meepo showtime start`.

Phase R3: code and test debt reduction

- Move `src/awakening/**` and `src/scripts/awakening/**` behind build/runtime feature flag, or archive branch if full removal is desired.
- Remove or quarantine lab/awakening tests from default CI include list.

Phase R4: docs cleanup

- Rewrite operator docs to remove awaken-first narrative.
- Keep north-star docs (`docs/MEEPO_PRIME.md`, etc.) but mark as deferred/non-executable.

## 3) Session Lifecycle Simplification Plan

Closed Alpha lifecycle contract:

1. `/meepo showtime start`
- Select/create showtime campaign.
- Require invoker in voice channel.
- Join in listen-only mode.
- Start receiver/STT capture.
- Open active session.

2. `/meepo showtime end`
- End active session.
- Stop receiver.
- Leave voice.
- Kick off recap generation.

3. Remove lifecycle ambiguity
- No auto-awaken/auto-join.
- No wizard prerequisite.
- No alternate public command path to start recording.

## 4) EC2 Deploy Readiness Checklist

Repository-controlled checks:

- [x] CI gate exists (`.github/workflows/ci.yml`).
- [x] Deploy pipeline exists (`.github/deploy.yml`).
- [x] Deploy pipeline runs verify before deploy.
- [x] Bot dependencies and scripts pinned in `package.json`.

Externalized infrastructure checks (not fully version-controlled in repo):

- [ ] `/usr/local/bin/deploy-meepo` script is source-controlled and versioned.
- [ ] systemd unit files for bot/web are source-controlled (currently not found in repo).
- [ ] restart policy validated (`Restart=always` or equivalent) for bot + web services.
- [ ] persistent storage mount/backups for `data/` verified on EC2.
- [ ] crash-reconnect drill documented and executed.

Risk note:

- EC2 deploy currently depends on remote host script and service setup not present in this repository; this is a release-governance gap.

## 5) Closed Alpha Architecture Summary

Operational topology:

- Discord control plane (bot runtime): command lifecycle + voice capture + transcript/recap generation.
- Web archive plane (`apps/web`): authenticated campaign/session/transcript/recap visibility.
- Data substrate: SQLite campaign-scoped persistence under `data/`.
- Delivery plane: GitHub Actions -> EC2 remote deploy hook.

Reliability objective:

- Support 10-20 DM pilots with deterministic lifecycle and strong observability around session capture and artifact generation.

## Observability Requirement Check (Gap Matrix)

Required events before invite:

- `SESSION_START`
- `VOICE_JOIN`
- `TRANSCRIPT_BEGIN`
- `TRANSCRIPT_END`
- `TRANSCRIPT_WRITE`
- `RECAP_GENERATE`
- `SESSION_END`

Current state from code sweep:

- present (near-equivalent naming):
  - `SHOWTIME_START`, `SESSION_STARTED` in `src/commands/meepo.ts`
  - `SHOWTIME_END`, `SESSION_ENDED` in `src/commands/meepo.ts`
  - `SESSION_RECAP_GENERATED` debug event in `src/sessions/recapEngine.ts`
- missing/needs explicit standardization in showtime path:
  - `VOICE_JOIN`
  - `TRANSCRIPT_BEGIN`
  - `TRANSCRIPT_END`
  - `TRANSCRIPT_WRITE`
  - canonical `RECAP_GENERATE` event type (currently `SESSION_RECAP_GENERATED`)

Recommendation:

- Add canonical event taxonomy aliases in main showtime path and keep old names as compatibility payload fields during migration.

## Proposed Next Execution Sequence

Renamed execution phases (to match shipped order):

- Phase 1 - Dashboard unblock
- Phase 2 - Showtime-only lifecycle hardening
- Phase 3 - Showtime observability completion
- Phase 4 - Durable guild metadata storage and UI resolution
- Phase 5 - Deploy/runtime asset versioning
- Phase 6 - Full smoke gate

1. Branch alignment
- Move active work to `v1.5_finish_line_to_v2` (or merge current delta into it).

2. Contract lock PR (Phase 2)
- Showtime-only lifecycle contract + auto-awaken removal + `/lab` gate.

3. Observability PR (Phase 3)
- Add missing canonical event emissions (`VOICE_JOIN`, `TRANSCRIPT_*`, `RECAP_GENERATE`) with payload shape tests.

4. Guild metadata durability PR (Phase 4)
- Persist and expose durable guild display metadata for dashboard/session surfaces.

5. Deploy hardening PR (Phase 5)
- Version-control deploy script + systemd units + runbook verification commands.

6. Pilot readiness review (Phase 6)
- Execute end-to-end EC2 smoke: start -> capture -> transcript -> end -> recap -> web visibility.
