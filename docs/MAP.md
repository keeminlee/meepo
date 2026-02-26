# Meepo System Map (v1.0.0)

This map is system-first. It answers:

1. Where do I go when X breaks?
2. What is the authoritative live flow from Discord -> ledger -> recall -> response?

## v1.0.0 Consolidation Note

- Config is centralized under `src/config/*`.
- `src/voice/**` is config-only (no direct `process.env` reads).
- Canonical env contract now prefers centralized keys (for example `DATA_DB_PATH`, `TTS_CHUNK_SIZE_CHARS`) with deprecated aliases warned at boot.

## 0. Golden Rules

- Meepo is diegetic: witness posture, no omniscient claims.
- Voice-first runtime authority; ledger is source of truth.
- Keep runtime state and boot/config concerns separated.

## 1. Entry Points

- Runtime boot: `src/bot.ts`
- DB bootstrap and migrations: `src/db.ts`, `src/db/schema.sql`
- Command router: `src/commands/index.ts`
- Config loading + redacted snapshot: `src/config/env.ts`, `src/config/redact.ts`, `src/config/types.ts`
- Voice attach and connection lifecycle: `src/voice/connection.ts`

## 2. Live Loop (Voice)

Discord voice -> receiver -> STT -> wake/trigger -> prompts -> LLM -> TTS -> speaker

- Receive and frame audio: `src/voice/receiver.ts`
- STT providers and text normalization: `src/voice/stt/*`
- Wake and trigger gates: `src/meepo/wakePhrase.ts`, `src/voice/wakeword.ts`, `src/meepo/triggers.ts`
- Prompt assembly and model call: `src/llm/prompts.ts`, `src/llm/client.ts`
- TTS synthesis: `src/voice/tts/*`
- Playback: `src/voice/speaker.ts`
- Reply orchestration: `src/voice/voiceReply.ts`

Entrypoints:
- `src/voice/connection.ts`
- `src/voice/receiver.ts`
- `src/voice/voiceReply.ts`

Reads/Writes:
- Reads guild runtime state (awake/form/reply mode) and config (`cfg.voice`, `cfg.stt`, `cfg.tts`).
- Writes ledger entries and voice/system events via `src/ledger/*`.

Common failure modes:
- No transcript: STT gate drops audio (short/quiet/cooldown/blocked phrase).
- No reply: Meepo asleep, not connected, cooldown active, or latch/anchor gating misses.
- No playback: TTS provider disabled/misconfigured or speaker/player lifecycle issue.

Where to debug:
- `src/voice/receiver.ts` (STT gating + queueing)
- `src/voice/stt/openai.ts`, `src/voice/tts/openai.ts` (provider behavior)
- `src/voice/speaker.ts` (playback pipeline)
- `src/voice/voiceReply.ts` (preconditions + reply mode path)

## 3. Ledger & Sessions (Truth Layer)

- Ledger write/read core: `src/ledger/ledger.ts`
- Transcript assembly for downstream systems: `src/ledger/transcripts.ts`
- Session lifecycle and runtime: `src/sessions/*`
- Session command surface: `src/commands/session.ts`

If behavior disagrees with memory or recap output, inspect this layer first.

Entrypoints:
- `src/ledger/ledger.ts`
- `src/sessions/sessions.ts`
- `src/commands/session.ts`

Reads/Writes:
- Reads/writes SQLite core session + ledger tables via `src/db.ts`.
- Emits transcript slices and context windows consumed by prompts, recall, and causal tools.

Common failure modes:
- Session scope mismatch (wrong guild/label/session_id).
- Missing or malformed transcript ranges causing weak context.
- Label/ingest confusion leading to wrong recap source.

Where to debug:
- `src/sessions/sessions.ts`
- `src/ledger/transcripts.ts`
- `src/commands/session.ts`
- `src/db/schema.sql` (schema assumptions)

## 4. Prompt Assembly & Recall

- Conversation tail context: `src/recall/buildConvoTailContext.ts`
- Memory context assembly: `src/recall/buildMemoryContext.ts`
- Relevance selection: `src/recall/findRelevantBeats.ts`
- Gold memory retrieval/persistence: `src/gold/goldMemoryRepo.ts`

Entrypoints:
- `src/llm/prompts.ts`
- `src/voice/voiceReply.ts`
- `src/commands/meepo.ts` (manual/status surfacing)

Reads/Writes:
- Reads recall sources (ledger context, GPTcaps/meecaps, gold memory, persona state).
- Writes interaction traces and convo turns back into ledger adjunct tables.

Common failure modes:
- Empty/low-quality recall context causing bland or inconsistent replies.
- Campaign/guild scope mismatch in retrieval.
- Persona/mindspace mismatch causing wrong tone or memory set.

Where to debug:
- `src/llm/prompts.ts`
- `src/recall/*`
- `src/ledger/meepoInteractions.ts`, `src/ledger/meepoConvo.ts`
- `src/gold/goldMemoryRepo.ts`

## 5. Causal Engine (Silver Lane)

The causal engine explains how intent and consequence propagate through a session so recap, reasoning, and diagnostics can rely on an explicit structure rather than loose transcript proximity.

Pipeline:

1. Prepare transcript + eligibility/masks
2. Extract intent/consequence/link candidates
3. Score and allocate links
4. Run hierarchy rounds/anneal
5. Persist and render artifacts

Authoritative index: `src/causal/INDEX.md`

Entrypoints:
- `src/tools/run-causal-cycles.ts`
- `src/causal/runHierarchyRounds.ts`

Reads/Writes:
- Reads transcript + eligibility masks + registry/scaffold context.
- Writes causal artifacts and metrics to `runs/causal/` and persistence tables.

Common failure modes:
- Over-pruned eligibility mask collapsing useful lines.
- Threshold interactions yielding sparse/over-dense links.
- Round/anneal params producing unstable or unintuitive hierarchy.

Where to debug:
- `src/causal/INDEX.md` first
- `src/causal/eligibilityMask.ts`
- `src/causal/extractCausalLinksKernel.ts`, `src/causal/linkLinksKernel.ts`
- `src/causal/annealLinks.ts`, `src/causal/absorbSingletons.ts`

## 6. Overlay

- Overlay server: `src/overlay/server.ts`
- Speaking-state projection: `src/overlay/speakingState.ts`
- Frontend artifact: `overlay/overlay.html`

Entrypoints:
- `src/overlay/server.ts`

Reads/Writes:
- Reads speaking and token/state payloads from runtime events.
- Writes websocket updates to overlay clients.

Common failure modes:
- Overlay server up but no speaking signals emitted.
- Token/state desync with actual voice runtime.

Where to debug:
- `src/overlay/server.ts`
- `src/overlay/speakingState.ts`

## 7. Economy and Missions

- Meeps domain and engine: `src/meeps/*`
- Mission loading and behavior: `src/missions/*`
- Mission data: `economy/missions.yml`

Entrypoints:
- `src/commands/meeps.ts`
- `src/commands/missions.ts`

Reads/Writes:
- Reads mission definitions and current balances/state.
- Writes transaction-like updates to DB-backed runtime records.

Common failure modes:
- Mission config drift (`economy/missions.yml` vs runtime assumptions).
- Balance update confusion from command scope/guild mismatch.

Where to debug:
- `src/meeps/*`
- `src/missions/*`
- `src/commands/meeps.ts`, `src/commands/missions.ts`

## 8. Tools / Offline Jobs

Entrypoints:
- `tools/*.ts` (operational scripts)
- `src/tools/**/*.ts` (causal, registry, gold, scaffold workflows)

Reads/Writes:
- Reads transcripts, events, registry data, and DB snapshots.
- Writes artifacts to `runs/`, `docs/notes/`, `data/*`, and causal output dirs.

Common failure modes:
- Running with wrong campaign/guild scope.
- Using stale session labels/IDs.
- Mixing legacy tools with current causal pipeline expectations.

Where to debug:
- Script header docs + flags in each tool file
- `src/causal/INDEX.md` for silver-lane runs

## 8. Docs Index and Deprecation Rules

- Operational snapshot: `docs/CURRENT_STATE.md`
- Philosophy / north star: `docs/Project_Meepo.md`
- System map (this file): `docs/MAP.md`

Doc placement rule:

- Active docs live under `docs/`
- Research/work notes live under `docs/notes/`
- Historical handoffs live under `docs/old/`

## Appendix: Repo Skeleton

For a raw file-level skeleton, see `docs/REPO_SKELETON.md`.
