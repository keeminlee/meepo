# Meepo Bot - Current State (March 8, 2026)

For documentation navigation, start at [README.md](README.md).

**Status:** V0 complete, MeepoMind (V0.1) Phase 2-3 in progress + Sprint 3 hardening closure complete + Track B web archive viewer complete  
**Last Updated:** March 8, 2026

## P0 Boundary (Locked)

P0 interpretation:

- P0 is infrastructure-first and reliability-first.
- This does not de-prioritize the mythic product identity.
- Mythic sky/Archivist behavior is deferred as runtime/user-facing behavior until the substrate is trustworthy.

### Implemented for P0

- Guild-scoped identity and authorization boundaries (`guild_id` as primary scope key).
- Minimal awaken bootstrap (`awakened` + `meta_campaign_slug` + DM binding + home text channel durability).
- Guild-scoped campaign registry for showtime workflows.
- Durable session recording and dashboard listing.
- Closed Alpha listen-only lifecycle: public `/meepo awaken` stays minimal, and `/meepo showtime start` joins voice ephemerally from invoker runtime context.
- Lifecycle completion hardening: `/meepo showtime end` finalizes session and safely disconnects voice only when a connection exists.
- Five-state dashboard onboarding guidance.
- Web auth boundary enforcement and deny-by-default out-of-scope access.

### Closed Alpha C4r (Listen-Only Lifecycle)

Public contract:

- `/meepo awaken` is minimal and deterministic for bootstrap.
- `/meepo awaken` writes only canonical essentials:
  - `awakened = true`
  - `meta_campaign_slug` (if missing)
  - `dm_user_id` (if missing)
  - `home_text_channel_id` (if missing)
- `/meepo awaken` does not configure `home_voice_channel_id` or wizard-driven voice bindings.
- `/meepo showtime start` creates/selects campaign, starts session, joins invoker voice channel in listen-only mode, and starts receiver capture.
- `/meepo showtime start` depends on invoker runtime voice context, not persisted voice setup.
- Closed Alpha speaking/performance remains disabled; Meepo is a silent witness.

Deferred lane:

- Richer ritual/onboarding setup remains under `/lab awaken` for experimentation.

Minimal awaken config audit (public `/meepo awaken`):

- required in Closed Alpha:
  - `awakened`
  - `meta_campaign_slug` (if missing)
  - `dm_user_id` (if missing)
  - `home_text_channel_id` (if missing)
- deferred to `/lab awaken` and future onboarding:
  - `dm_role_id`
  - DM display name memory/modal flow
  - registry/player builder writes
- non-public / non-gating in P0 path:
  - `home_voice_channel_id`
  - voice default/binding state

### Deferred to P1+

- Constellation/sky product mechanics as user-facing behavior.
- Prophecy/global sky progression systems.
- Narrative bot interaction layers as success criteria.
- Recap/AI features as launch-gating requirements.

## Phase A Contract Clarifications

### `guild_config` authority

- Authoritative for awakened state: yes.
- Authoritative for meta campaign slug: yes (`meta_campaign_slug`).
- Authoritative for DM/channel preferences: yes when present (`dm_user_id`, `dm_role_id`, `home_*`, `default_talk_mode`).
- Required for P0 success: `guild_id`, `campaign_slug`, `awakened`, `meta_campaign_slug`.
- Non-gating in P0: DM/channel preference completeness.

### `guild_campaigns` scope semantics

- Intended user-facing content: showtime campaigns.
- Meta campaign handling: persisted in `guild_config.meta_campaign_slug`, hidden from web archive browsing.
- Current web filtering rule: exclusion by `meta_campaign_slug` (not by explicit campaign type field).

### `sessions` naming and visibility semantics

- Canonical naming field: `sessions.label`.
- UI wording may render as "session title"; semantics map to the same canonical label.
- Zero-arg `/meepo showtime start`: yes, creates campaign/session without requiring user-supplied label.
- Dashboard visibility rule for P0: row presence under authorized `guild_id + campaign_slug` scope.
- Dashboard inclusion for P0: show both `active` and ended (`completed`/`interrupted`) sessions.

## Campaign Scope Foundations (Current Doctrine)

The runtime now uses a two-layer campaign scope model:

- runtime container: `guild_id`
- ambient/meta scope: `guild_config.meta_campaign_slug` (durable guild home)
- showtime canon scope: guild-scoped showtime campaign records (`guild_campaigns`)

Operational semantics:

- `/meepo awaken` creates or confirms one durable `meta_campaign_slug` for the guild and does not regenerate it on later awakens.
- `/meepo awaken` also seeds `dm_user_id` and `home_text_channel_id` when missing; it does not set voice config.
- `/meepo showtime start` now requires explicit campaign intent:
  - reuse existing showtime campaign via `campaign`
  - create new showtime campaign via `campaign_name`
- showtime sessions bind to explicit showtime campaign slugs (not inferred from meta scope).
- `/meepo showtime start` is Closed Alpha listen-only by contract (runtime-derived voice join, no speaking).
- one active session per guild remains unchanged (`idx_one_active_session_per_guild`).
- legacy/default fallback behavior is compatibility-only; new write paths do not create `homebrew_campaign_*` style slugs.

## Track C Complete (Discord Auth + Secure Scope)

- Web auth uses Auth.js + Discord OAuth as the primary access model.
- Canonical auth context is stable and refresh-aware (`session_snapshot|discord_refresh|session_snapshot_fallback`).
- Guild authorization is ID-driven via `authorizedGuildIds`; guild display metadata is non-authoritative.
- Dashboard/campaign discovery and session object access share the same guild authorization boundary.
- Session detail/transcript/recap/regenerate enforce ownership in reader/action code, not in route handlers.
- Implicit env guild fallback is removed; local fallback requires explicit dev bypass (`DEV_WEB_BYPASS=1` in non-production).

## Campaign Identity Hardening Sprint (Phases 1-4)

Route compatibility doctrine:

- slug-only URLs are preserved for compatibility (`/campaigns/[campaignSlug]/...`)
- slug alone is no longer authoritative campaign identity
- canonical campaign identity is `guild_id + campaign_slug`

Web/API disambiguation contract:

- canonical route disambiguator is `guild_id` query param on slug routes
- active campaign context now persists composite selection (`slug`, `guildId`) rather than slug-only local storage
- server campaign resolution is explicit:
  - if `guild_id` is provided, resolve only that authorized guild scope
  - if `guild_id` is absent and slug matches multiple authorized guilds, return explicit ambiguity (`409 ambiguous_campaign_scope`)

Ambiguity flow doctrine:

- Case A (active context certainty): client has composite selection and passes both `campaign_slug` (route) and `guild_id` (query); no ambiguity remains
- Case B (cold slug URL): server may detect multiple authorized guild matches and returns explicit ambiguity so UI requests guild disambiguation

Storage/materialization hardening (Phase 4):

- canonical campaign data roots are now guild-scoped directory keys:
  - `data/campaigns/g_<guild>__c_<campaign>/...`
  - `data/registry/g_<guild>__c_<campaign>/...`
- legacy slug-only roots are compatibility-read fallback only during migration windows
- migration tool is available for scoped backfill:
  - `npx tsx src/tools/migrate-campaign-scope-paths.ts --dry-run`
  - `npx tsx src/tools/migrate-campaign-scope-paths.ts`

## Track B Complete (Web Archive Viewer)

- Web archive viewer is now first-class under `apps/web` (Next App Router).
- Real web routes:
  - `/`
  - `/dashboard`
  - `/settings`
  - `/campaigns/[campaignSlug]/sessions`
  - `/campaigns/[campaignSlug]/sessions/[sessionId]`
  - `/campaigns/[campaignSlug]/compendium`
- Canonical reads now power dashboard, campaign, and session flows via the internal API boundary.
- Campaign metadata editing is live in web:
  - campaign rename (`PATCH /api/campaigns/[campaignSlug]`) with immutable slug identity
  - session label edit (`PATCH /api/sessions/[sessionId]`) writing canonical `sessions.label`
- Campaign/session display naming is centralized in shared helpers (`apps/web/lib/campaigns/display.ts`).
- Web edit doctrine:
  - campaign rename upsert is allowed only after proving slug ownership in authorized guild scope
  - session label mutation updates canonical session row only (no shadow label store)
  - UI edit flows use optimistic updates with rollback + user-safe error + canonical refetch
- Recap regenerate action and transcript/recap downloads (`.txt` and `.json`) are live on session detail.
- Artifact-aware states are implemented for missing/unavailable recap/transcript conditions.
- Dev bypass for local web scope overrides is available only behind explicit env gate (`DEV_WEB_BYPASS=1`) and non-production mode.
- Known tradeoff: web lint is currently skipped during `next build` (`apps/web/next.config.ts`) to avoid a flat-config/plugin detection mismatch during this milestone checkpoint.

---

## Quick Start

```bash
npm run dev:bot        # Start bot with hot-reload
npm run deploy:commands # Register/update slash commands in Discord (global default)
npx tsc --noEmit      # Type-check code
```

### Test in Discord

```
/meepo awaken                            # One-time init (Dormant -> Awakened + Ambient)
/meepo showtime start                    # Start canon showtime session (Awakened -> Showtime)
/meepo showtime end                      # End active showtime session (Showtime -> Awakened Ambient)
/meepo status                            # Public status + fix hints
/lab doctor                              # Dev diagnostics + next actions (DEV_USER_IDS only)
/meepo settings view                     # Show persisted setup/persona/recap defaults
/meepo sessions list                      # List recent sessions with recap status
/meepo sessions view session:<id>         # Session hub + artifact availability
/meepo sessions recap session:<id> style:balanced  # Generate canon recap final pass (elevated)
meepo: hello                             # Auto-latch responds
<speak: "meepo, help me">               # STT → LLM → TTS closed loop
```

### OBS Overlay

```
http://localhost:7777/overlay            # Browser Source for speaking indicators
```

### Deployment Automation

- GitHub Actions deployment workflow is now tracked at `.github/deploy.yml`.
- Workflow flow: `verify` job runs `npm run ci:verify`, then `deploy` job runs remote EC2 deploy on `main`.
- Command manifest deploy remains available locally via `npm run dev:deploy` (REST-only command registration).

---

## Project Vision

**Meepo** is a **diegetic NPC for Discord D&D sessions** — a witness and embodied presence that:
- Listens and remembers (with guardrails)
- Exists *inside* the world, not above it
- Never hallucinates lore or breaks diegetic boundaries
- Remembers people and relationships, not everything

### What Meepo Is NOT
- A rules engine
- A DM assistant
- An omniscient narrator
- An autonomous agent

### What Meepo IS
- A baby celestial NPC (or transforms into Xoblob the mimic)
- A narrative continuity anchor
- Emotionally shaped by what matters to the party

---

## Architecture Overview

### Foundational Hardening Substrate (Sprint 3)

Meepo now runs on a hardened multi-guild/session/ops substrate focused on reliability and operational legibility:

- recap/request protection: edge + engine dedupe, cooldown, and capacity rails
- recall safety: request throttling + retrieval-shape bounds
- expensive worker safety: keyed back-pressure for hot guild scopes
- failure contract stability: canonical taxonomy + user-safe formatter across command and voice boundaries
- observability enforcement: strict-zone runtime stopline against raw `console.*` plus structured runtime logging in critical paths

This closes the foundational reliability loop before further feature expansion.

### Boot Recovery & Crash-Safe Sessions (Sprint 4)

Sprint 4 hardens unexpected restart behavior so lifecycle state is always reconstructed from DB truth.

Session status authority:

- `sessions.status` values: `active | completed | interrupted`
- at most one active session per guild is enforced by DB index (`idx_one_active_session_per_guild`)

Boot flow contract:

1. Recovery stage (DB mutation):
- scan lingering `active` sessions at boot
- mark them `interrupted`
- emit explicit boot recovery logs
2. Reconciliation stage (runtime derivation only):
- read post-recovery DB truth
- align runtime active-session marker
- never invent or repair persisted session truth

Crash behavior:

- crash during Showtime: prior active session is marked `interrupted`; lifecycle returns to Awakened/Ambient
- crash during Awakened/Ambient with no active session: no session mutation needed
- crash during async artifact generation after showtime end: session remains `completed`; artifact retries are decoupled from session correctness

### Awakening Runtime (v1.6)

Awakening Runtime is the deterministic onboarding interpreter used by `/meepo awaken` and future ritual-style flows.

Execution lifecycle per scene:

1. Render scene
2. Await prompt (when present)
3. Persist prompt input
4. Execute commits
5. Execute runtime actions
6. Transition to next scene

Core guarantees:

- deterministic scene execution
- resumable runtime checkpoints
- engine-owned persistent mutation
- nonce-validated interaction safety

Awaken observability status (current):

- `/meepo awaken` currently emits high-signal stage logs at `info` (`AWAKEN_STAGE`).
- Error-path guardrails remain explicit (`AWAKEN_RESPONSE_GUARDRAIL`, `AWAKEN_PROMPT_RESPONSE_GUARDRAIL`).
- Additional lifecycle markers exist for debugging and can be verbose during active awaken flows.

Capabilities currently supported:

Prompts:

- `choice`
- `modal_text`
- `role_select`
- `channel_select`
- `registry_builder`

Runtime actions:

- `join_voice_and_speak`

Script/runtime features:

- template variable rendering
- capability gating
- deterministic resume
- pending prompt nonce validation

State separation:

- `guild_onboarding_state.progress_json` for prompt/runtime checkpoint state.
- `meepo_mind_memory` + `guild_config` for canonical long-lived identity state.

Progress examples:

- `progress_json.dm_display_name`
- `progress_json.home_channel_id`
- `progress_json.players`
- `progress_json._rb_pending_character_name`

Memory examples:

- `meepo_mind_memory(scope_kind='guild', key='dm_display_name')`
- `guild_config.dm_user_id`

Commit model:

- scripts declare commit intent
- engine executes commit mutation
- append-only setup registry writes (`append_registry_yaml`)

Action model:

- actions execute after commits
- actions execute in script order
- actions never mutate progress state directly
- action failures are non-blocking

Action logs:

- `AWAKEN_ACTION ok type=<type> scene=<scene_id>`
- `AWAKEN_ACTION fail type=<type> scene=<scene_id> code=<error_code>`

Channel drift behavior:

- triggered by `channel_select` post-processing when selected channel changes
- emits departure lines in old channel and arrival lines in new channel
- updates runtime channel context for current run only
- persists selected channel key; runtime channel context is not persisted

See [docs/awakening/ARCHITECTURE.md](awakening/ARCHITECTURE.md) and [docs/awakening/SCRIPTS.md](awakening/SCRIPTS.md).

### Dynamic STT Prompt Refresh (v1.5)

Purpose:

- adapt STT recognition to current campaign vocabulary

Trigger:

- canonical session start enqueues `refresh-stt-prompt`

Behavior:

- reads campaign registry names
- builds deduplicated prompt terms (PC names + Meepo/persona context)
- persists current prompt in guild config runtime state
- forwards prompt override to STT provider at runtime

### Multi-Guild Reliability Snapshot (v1.5)

Target scale and safety posture:

- designed for concurrent multi-guild operation (10-20 guild target)
- guild/session runtime state is isolated per guild
- session lifecycle remains independent per guild

Implementation status against v1.5 reliability requirements:

1. Guild state isolation:
- implemented primarily via `guild_id` scoping plus campaign-scoped DB routing.
- important nuance: not every runtime table stores a literal `campaign_slug` column.
- campaign isolation is enforced by DB routing guardrails and per-campaign DB boundaries, while guild-level isolation is enforced by keyed queries and indexes.

2. Session safety:
- implemented with `sessions.status` (`active | completed | interrupted`).
- boot behavior is crash-safe via recovery (`active -> interrupted`) then runtime reconciliation from DB truth.
- duplicate active sessions are blocked by DB invariant (`idx_one_active_session_per_guild`).

3. Basic rate limiting and cost guardrails:
- recap/summarization requests are guarded by in-flight dedupe, guild capacity caps, and cooldown windows.
- recall paths are guarded by per-user and per-guild request throttles plus queue backpressure.

4. User-facing error surface:
- centralized taxonomy-backed formatter provides safe fallback messages (for example: `"⚠️ Meepo stumbled while writing this memory."`).
- user responses include stable error codes/trace IDs where available and do not expose raw stack traces.

Known gap relative to strict wording:

- if product requirements demand literal `campaign_slug` columns on every listed table, that is not fully implemented because current isolation uses campaign-scoped DB routing instead of universal per-row campaign columns.
- this is a model/contract decision rather than a runtime reliability failure.

### DB Routing Guardrail (Campaign Isolation)

- Runtime DB routing is campaign-scoped and must not silently fall back across campaigns.
- Internal campaign resolution is allowed only at guild-aware entrypoints (functions that already have `guildId`).
- Deep helpers that do not naturally have `guildId` must receive `db` from their caller (or remain tool/offline scoped), rather than resolving campaign internally.
- This prevents accidental default-campaign reads, hidden cross-campaign leaks, and uncontrolled signature creep.

### Dual Knowledge System

**1. Omniscient Ledger** ✅ Complete
- Append-only log of ALL messages (text + voice)
- Narrative authority tiers: `primary` (voice/system), `secondary` (text chatter), `elevated` (DM-marked)
- Source of truth for DM tools and session recaps
- Session-scoped via UUID reference

**2. NPC Mind** 🔄 Phase 2-3 (In Progress)
- Character-centric, emotionally weighted memory
- Shaped by people, love, tenderness, moral fracture
- Built on Meecap beats scored by gravity
- Future: Auto-injected into LLM prompts

### Data Flow

```
Discord Message/Voice
    ↓
Ledger Entry (with narrative_weight)
    ↓
Session-scoped grouping (UUID)
    ↓
[DM Tools] ←→ [Meecap Generation] ←→ [Character Retrieval]
    ↓            ↓                        ↓
Recap      Emotion Beats         LLM Response
```

---

## What's Implemented

### Core Systems ✅

#### Voice & Speech
- **STT (Speech-to-Text):** OpenAI Whisper + domain normalization
- **TTS (Text-to-Speech):** OpenAI gpt-4o-mini-tts with chunking
- **Voice Loop:** Closed STT → LLM → TTS with feedback loop protection
- **Anti-noise Gating:** Configurable threshold to filter background noise
- **Voice State Tracking:** Guild-scoped connection management
- **STT Always-On:** STT automatically enabled when Meepo joins any voice channel

#### Text I/O
- Message reception with auto-latch (90s conversation window)
- Address detection via prefix (`meepo:`) or mention (`@meepo`)
- Command-less natural interaction (just speak in voice channel)

#### Personas
- **Meepo** (default): Baby celestial, replies with "meep" suffix
- **Xoblob**: Transform form (Entity-13V mimic), riddle-based personality
- **StyleSpec system**: Per-persona customizable traits + system prompts

#### LLM Integration
- OpenAI API with graceful fallbacks
- Kill-switch support (disables responses, logs errors)
- Token-limited prompts with safeguards (3000-16000 max tokens depending on task)
- Persona-driven system prompts with registry validation

#### Session Management
- **Meepo State Persistence:** Active state (`is_active=1`) persists across bot restarts
- **Session Lifecycle:**
  - **Dormant -> Awakened:** `/meepo awaken` performs one-time guild initialization and enables Ambient behavior
  - **Awakened Ambient -> Showtime:** `/meepo showtime start` starts a canon live session
  - **Showtime -> Awakened Ambient:** `/meepo showtime end` ends the active showtime session
  - **Manual session tools:** `/session new [--label C2E20]` remains available for DM/admin workflows
  - **Auto-end:** `/meepo sleep` or inactivity timeout (`MEEPO_AUTO_SLEEP_MS`)
- **Session Announcements:** `/meepo announce [--dry_run] [--timestamp] [--label] [--message]` posts Discord reminders with auto-incremented labels
- **Labeling:** Optional user labels (e.g., "C2E06") for reference via `/session label`
- **Offline Ingestion:** Tool to ingest campaign recordings into same DB

#### Ledger & Logging
- SQLite append-only log with deduplication (via message_id index)
- Centralized logger with scopes: `voice`, `stt`, `tts`, `ledger`, `llm`, `db`, `session`, `boot`, `meepo`
- Log levels: `error|warn|info|debug|trace`
- Environment-configurable format (pretty/json)

#### Registry System ✅
- **YAML-based character registry** (source of truth)
  - `data/registry/pcs.yml` — 6 playable characters
  - `data/registry/npcs.yml` — 3 NPCs (includes Meepo)
  - `data/registry/locations.yml` — 3 places
  - `data/registry/ignore.yml` — 79 stopwords for filtering
  - `data/registry/decisions.pending.yml` — Review queue for new candidates
- **Name Discovery Tool:** Offline scanner that proposes new names from ledger
- **Name Normalization:** Regex-based (no LLM), longest-match-first, alias-aware
- **Live Integration:** Voice transcripts normalized at ingest + storage of both raw + normalized

#### Tier S/A Interaction Memory ✅
- **Table:** `meepo_interactions` — guild, session, persona, tier (S/A), trigger, speaker, line anchors, meta_json
- **Tier S:** Within latch window (wake or latched follow-up); **Tier A:** Name mention outside latch
- **Triggers:** wake_phrase, mention, latched_followup, name_mention, direct_question (?), direct_instruction (remember/note/…)
- **Snippet resolution:** Text via ledger message_id; voice via transcript (session + start/end line) or meta.voice_reply_content_snippet
- **Prompt injection:** "LAST TIME YOU SPOKE TO ME" (Tier S quoted snippets) + "RECENT TIMES YOU MENTIONED ME" (Tier A); optional meta.summary for compaction
- **Retrieval:** Last-direct-convo lock (most recent Tier S with current speaker always included), Tier A cap 2, same-speaker preference
- **Debug:** `/meepo interactions` — [DM-only] Last 5 Tier S for you; shows resolution (message_id vs transcript), persona, guild

#### Meecap System ✅
- **Meecap V1 Schema:** Structured post-session segmentation
  - 4-8 scenes (narrative acts)
  - 1-4 beats per scene (emotional memory units)
  - Ledger-ID anchoring (stable references via UUID ranges)
  - Evidence lists for beat justification
- **Generation:** LLM-driven with validated JSON schema
- **Validator:** Comprehensive checks (ID existence, range ordering, evidence non-empty)
- **Regenerable:** Can overwrite via `/session meecap --force`
- **Database Persistence:** UPSERT pattern in `meecaps` table
- **Disk Export:** JSON files for git diffing and Discord review

#### Commands
- `/meepo awaken|showtime start|showtime end|status` — lifecycle contract surface
- `/meepo status` internal debug/trace view includes Meepo context queue telemetry:
  - counts: `queued`, `leased`, `failed`
  - `oldest queued age`
  - `last completed timestamp`
- `/meepo settings show|set|clear` — Persisted home channel config (`home_text_channel_id`, `home_voice_channel_id`)
- `/meepo sessions list|view|recap` — Session hub + canon-gated recap generation under one surface
  - Recap styles: `detailed | balanced | concise`
  - Base cache (`megameecap_base`) is file-canonical and valid only when files exist and `source_hash + base_version` match
  - Final recap (`recap_final`) is DB-canonical with exactly one row per session (most recent style overwrites prior style)
  - Session recap contract API (`src/sessions/sessionRecaps.ts`) now orchestrates all three styles and persists canonical row in `session_recaps`
    - Contract retrieval shape: `views.concise|balanced|detailed` + `generatedAt` + `modelVersion`
    - Regeneration path: `regenerateSessionRecap(sessionId, reason?)` with safe overwrite semantics
    - Typed domain errors: `RECAP_SESSION_NOT_FOUND | RECAP_TRANSCRIPT_UNAVAILABLE | RECAP_GENERATION_FAILED | RECAP_INVALID_OUTPUT`
  - Drift rules:
    - final DB row + missing file => regenerate final (cheap)
    - final file + missing DB row => shown as unindexed; regenerate to canonicalize
  - Storage: `session_artifacts` metadata + file outputs under `data/campaigns/{slug}/exports/meecaps`
  - Migration posture:
    - `session_recaps` is canonical for the new multi-view recap contract
    - `session_artifacts` remains compatibility lane for current `/meepo sessions recap` command surface (no cutover yet)
- `/session new [--label C2E20]` — [DM-only] Start a new session (ends active session first)
- `/session label [label] [--session_id]` — [DM-only] Set label for session
- `/session view scope:all|unlabeled` — [DM-only] List sessions
- `/session meecap [--force] [--source primary|full]` — Generate/regenerate Meecap
- `/session transcript [range]` — Raw transcript view
- `/session label [session_id]` — Assign or view session labels
- `/session view [scope=all|unlabeled]` — List sessions with metadata
- `/deploy-dev` — Register commands in Discord
- `/ping` — Health check

#### Dev-only Commands
- `/lab ...` is development-only and normally hidden from production users.
- Moved from public surface: `/meepo doctor`, `/meepo sleep`, `/goldmem`, `/meeps ...`, `/missions ...`.
- Awakening fallback/debug: `/lab awaken respond text:<...>`, `/lab awaken status`, `/lab awaken reset confirm:RESET`.
- Runtime allowlist gate: `DEV_USER_IDS=<comma-separated-user-ids>`
- Deploy scope gate: `/lab` is deployed only to guilds listed in `DEV_GUILD_IDS=<comma-separated-guild-ids>`.
- Product surface: `/meepo` remains global.

#### Tools (CLI)
- `tools/ingest-media.ts` — Offline media ingestion (extract audio, transcribe, generate session)
- `src/tools/heartbeat/replay.ts` — Deterministic offline heartbeat/action replay (`--campaign`, `--session <id_or_label>`) with optional worker execution
- `src/tools/compile-and-export-events.ts` — Bronze → Silver event compilation
- `src/tools/compile-and-export-events-batch.ts` — Batch compile multiple sessions
- `src/tools/regenerate-meecap-beats.ts` — Regenerate beats table from existing narratives (no LLM)
- `src/tools/scan-names.ts` — Find unknown names in ledger
- `src/tools/review-names.ts` — Interactive CLI for registry triage
- `src/tools/cleanup-canonical-aliases.ts` — Validate alias consistency
- `src/tools/recap-test.ts` — Run recap contract generation/regeneration for a real session id and print stored `session_recaps` views
  - Example: `npm run recap:test -- --guild <guild_id> --session <session_id>`
  - Example regenerate: `npm run recap:test -- --guild <guild_id> --session <session_id> --regenerate --reason manual_qc`

---

## Database Schema

### Core Tables

```sql
-- NPC Instance (one per guild)
npc_instances
  · id (PK), guild_id, name, form_id ('meepo'|'xoblob')
  · reply_mode ('voice'|'text', default 'text') ← runtime reply mode control
  · persona_seed (optional custom traits), created_at_ms, is_active

-- Ledger (immutable source)
ledger_entries
  · id (PK), guild_id, channel_id, message_id (unique index)
  · author_id, author_name, timestamp_ms, content
  · session_id (UUID reference → sessions.session_id)
  · source ('text'|'voice'|'system')
  · narrative_weight ('primary'|'secondary'|'elevated')
  · speaker_id (for voice), audio_chunk_path, t_start_ms, t_end_ms, confidence
  · content_norm (normalized text for consistency)
  · created_at_ms (for deterministic ordering)

-- Speaker Masks (diegetic name sanitization)
speaker_masks
  · guild_id, discord_user_id (composite PK)
  · speaker_mask (TEXT, e.g. 'Narrator', 'Dungeon Master')
  · created_at_ms, updated_at_ms
  · Prevents OOC Discord usernames from leaking into NPC context

-- Sessions (grouped ledger)
sessions
  · session_id (TEXT PRIMARY KEY, UUID) ← the invariant
  · guild_id, label (optional user metadata), source ('live'|'ingest-media')
  · started_at_ms, ended_at_ms
  · started_by_id, started_by_name
  · created_at_ms (immutable creation timestamp, used for "latest ingested" ordering)

-- Meecaps (derived artifact - dual storage)
meecaps
  · session_id (PK → sessions.session_id)
  · meecap_narrative (TEXT, generated prose + transcript)
  · model (model name, e.g. 'claude-opus')
  · created_at_ms, updated_at_ms

-- Meecap Beats (normalized beat rows from narrative)
meecap_beats
  · id (TEXT PK, UUID)
  · session_id (FK → meecaps.session_id, ON DELETE CASCADE)
  · label (TEXT, human-readable session label like "C2E6")
  · beat_index (INT, ordering within session)
  · beat_text (TEXT, narrative text of the beat)
  · line_refs (TEXT, JSON array of line numbers)
  · created_at_ms, updated_at_ms
  · UNIQUE(session_id, beat_index) for stable ordering

✅ Migration Note (Feb 14): meecap_json column removed. Label column added. All 19 C2E sessions backfilled (434 beats).

-- Latches (conversation window state)
latches
  · key (PK), guild_id, channel_id, expires_at_ms
```

### Design Notes
- `session_id` is **generated UUID** (immutable, collision-resistant)
- `label` is user-provided metadata (NOT unique; can have multiple ingests with same label)
- `created_at_ms` determines "latest ingested" session (deterministic ordering)
- All migrations auto-apply on startup with safe defaults
- Messaging deduplication via message_id unique index

---

## Features by Readiness

### ✅ Shipping in V0
- Text + voice I/O (STT+LLM+TTS loop)
- Persona system (Meepo, Xoblob)
- Natural conversation (address-triggered, persistent in bound channel)
- Session tracking (explicit showtime start/end, UUID-based grouping, auto-sleep on inactivity)
- Ledger-first architecture (omniscient + voice-primary)
- Transcript + recap commands (DM-only, range filtering)
- Character registry (YAML, with name discovery tools)
- Meecap generation (scene/beat segmentation, ledger-anchored)
- Batch ingestion tools (offline media → session DB)
- **Unified Transcript Builder** (consolidated Meecap + Events logic) ✨
- **Speaker Mask System** (OOC name sanitization, DM commands, database-backed) ✨ **NEW Feb 14 Eve**
- **Runtime Reply Mode** (voice/text toggling without restart) ✨ **NEW Feb 14 Eve**
- **Auto-Sleep** (configurable inactivity timeout for graceful session cleanup) ✨ **NEW Feb 14 Eve**
- **Memory Recall Pipeline** (registry → events → GPTcap beats → memory capsules) ✨ **NEW Feb 14 Eve**
- **Incremental Memory Seeding** (title-based differential updates) ✨ **NEW Feb 14 Eve**
- **MeepoView Overlay** (OBS streaming overlay with real-time speaking indicators) ✨ **NEW Feb 15**
  - Shows/hides tokens based on Discord voiceStateUpdate (adaptive to who's in voice)
  - Dynamically loads tokens from pcs.yml registry (single source of truth)
  - Scaled 75% larger (140px tokens, 28px gaps) for better OBS visibility
  - WebSocket-based speaking & presence state with auto-reconnect
  - URL: `http://localhost:7777/overlay` (configure as OBS Browser Source)
- **STT Always-On** (STT enabled by default when joining voice, no manual toggle needed) ✨ **NEW Feb 15**
- **Adaptive Presence Tracking** (Overlay visibility tied to voice channel membership) ✨ **NEW Feb 15**
  - voiceStateUpdate handler tracks Discord member joins/leaves
  - Meepo presence tracked separately on join/leave/disconnect
  - Tokens hidden by default, shown only when users are voice-connected
  - No lingering states when users disconnect or bot leaves

### 🔄 Phase 2-3 (In Progress)
- ✅ **Beats Normalization:** Meecap beats now in dedicated table with label column (Feb 14)
- ✅ **Bootstrap Infrastructure:** generate-beats.ts tool and gptcaps filesystem structure (Feb 14)
- ⏳ **Gravity Scoring:** Post-session emotional weight assignment (Costly Love, Tenderness, Moral Fracture)
- ⏳ **Character-Scoped Retrieval:** Filter beats by PC involved, order by gravity
- ⏳ **Memory Integration:** Inject retrieved beats into LLM response prompts
- ⏳ **Gravity Columns:** Add gravity score columns to meecap_beats table
- ⏳ **Character Indexing:** Build efficient PC involvement queries on beats

### ⏳ Future (Deferred)
- Pronoun resolution (for cleaner narrative)
- Topic packs (thematic beat clustering)
- Wanderer routing (advanced state machine)
- Persistent impression tracking (PC-NPC relationship arcs)

---

## Configuration

Required environment variables:

```env
# Discord
DISCORD_TOKEN=<bot_token>
DM_ROLE_ID=<role_id_for_dm_only_commands>

# OpenAI
OPENAI_API_KEY=<api_key>

# Database
DATA_DB_PATH=./data/bot.sqlite

# Session Management
MEEPO_AUTO_SLEEP_MS=1800000         # Auto-sleep after inactivity (ms). 0 = disabled
ANNOUNCEMENT_CHANNEL_ID=<id>        # Discord channel for /meepo announce reminders

# Overlay (OBS)
OVERLAY_PORT=7777                   # HTTP + WebSocket server port
OVERLAY_VOICE_CHANNEL_ID=<id>      # Voice channel used for overlay presence tracking
MEEPO_HOME_VOICE_CHANNEL_ID=<id>   # Optional default for manual voice join flows

# Voice
VOICE_CHUNK_SIZE_MS=60000           # Audio chunk size
VOICE_SILENCE_THRESHOLD_DB=-40      # Noise gate (-40 = aggressive)
VOICE_END_SILENCE_MS=700            # End utterance after silence
VOICE_REPLY_COOLDOWN_MS=5000        # Prevent spam
VOICE_INTERRUPT_ACTIVE_MS=1000      # Sustained speech required before TTS barge-in
VOICE_HUSH_DEFAULT=false            # Start in listen-only mode when true
# Barge-in behavior: normal voice interruption requires ~1s sustained speech;
# explicit stop phrases ("meepo stop", etc.) still interrupt immediately.

# STT/TTS
STT_PROVIDER=openai                 # or 'noop'|'debug'
TTS_ENABLED=true
TTS_CHUNK_SIZE_CHARS=350
TTS_OPENAI_MODEL=gpt-4o-mini-tts

# Logging
LOG_LEVEL=info                      # error|warn|info|debug|trace
LOG_SCOPES=                         # Leave empty for all, or: voice,stt,tts,...
LOG_FORMAT=pretty                   # pretty|json

# Optional
STT_SAVE_AUDIO=false                # Save audio chunks to disk
AUDIO_FX_ENABLED=false              # Audio effects (pitch, reverb)
MEEPO_CONFIG_GUILD_ID=<guild_id>    # For multi-guild setup
```

### Meepo Context Worker Knobs (Sprint 2)

Worker scheduling + throughput controls:

```env
MEEPO_ACTION_WORKER_ENABLED=true
MEEPO_ACTION_WORKER_MAX_PER_TICK=2
MEEPO_ACTION_WORKER_MAX_RUNTIME_MS=300
MEEPO_ACTION_WORKER_LEASE_TTL_MS=3000
MEEPO_ACTION_WORKER_MAX_ATTEMPTS=3
```

- Backoff policy: failed actions are re-queued with exponential delay (`retry_base_ms * 2^(attempt-1)`) until max attempts; once max is reached they move to `failed`.
- `MEEPO_CONTEXT_MINI_FIRST`: when enabled, context snapshot loading prefers latest `mini_meecap` block first.
- Dev inline gate: heartbeat inline action execution is dev-only and controlled by `MEEPO_CONTEXT_INLINE_ACTIONS_DEV`; production path remains enqueue-first with worker execution.
- Runtime note: current code-level env names are `MEEPO_CONTEXT_WORKER_ENABLED`, `MEEPO_CONTEXT_MAX_ACTIONS_PER_TICK`, `MEEPO_CONTEXT_MAX_TOTAL_RUNTIME_MS`, `MEEPO_CONTEXT_LEASE_TTL_MS`, `MEEPO_CONTEXT_MAX_ATTEMPTS`, and `MEEPO_CONTEXT_RETRY_BASE_MS`.
- Meepo action artifacts:
  - `MEEPO_ACTION_LOGGING_ENABLED=true` writes structured `meepo_actions` JSONL + merged `.log` artifacts.
  - `MEEPO_ACTION_LOGGING_INCLUDE_PROMPTS=false` keeps prompt bodies out of artifact logs by default.
  - Online logging writes canon session artifacts only; offline replay writes `offline_replay` variants.

---

## Module Organization

```
src/
├── bot.ts                          # Discord event loop
├── db.ts                           # SQLite + migrations
├── pidlock.ts                      # Single-instance lock
│
├── meepo/
│   ├── state.ts                    # Instance lifecycle (wake/sleep/transform)
│   ├── triggers.ts                 # Address detection
│   ├── nickname.ts                 # Discord nickname management
│   ├── knowledge.ts                # Foundational memories (INITIAL_MEMORIES)
│   └── autoSleep.ts                # Inactivity-based session cleanup
│
├── personas/
│   ├── index.ts                    # Registry + StyleSpec system
│   ├── meepo.ts                    # Default form
│   └── xoblob.ts                   # Transform form
│
├── overlay/
│   ├── server.ts                   # HTTP + WebSocket server for OBS overlay
│   └── speakingState.ts            # Debounced speaking state management
│
├── voice/
│   ├── state.ts                    # Connection state tracking
│   ├── connection.ts               # Voice lifecycle
│   ├── receiver.ts                 # Audio capture + STT
│   ├── speaker.ts                  # TTS output
│   ├── audioFx.ts                  # Optional audio effects
│   ├── voiceReply.ts               # Response pipeline
│   ├── wakeword.ts                 # Trigger detection
│   ├── stt/
│   │   ├── provider.ts             # STT interface
│   │   ├── openai.ts               # Whisper integration
│   │   └── normalize.ts            # Domain normalization
│   └── tts/
│       ├── provider.ts             # TTS interface
│       └── openai.ts               # gpt-4o-mini-tts integration
│
├── ledger/
│   ├── ledger.ts                   # Append-only queries
│   ├── transcripts.ts              # Unified transcript builder (Meecap + Events)
│   ├── speakerSanitizer.ts         # OOC name sanitization (speaker masks)
│   ├── eventSearch.ts              # Event querying by character/location
│   ├── gptcapProvider.ts           # GPTcap loading from filesystem
│   ├── meepo-mind.ts               # Character retrieval + memory seeding
│   └── system.ts                   # System event helper
│
├── latch/
│   └── latch.ts                    # Conversation window state
│
├── sessions/
│   ├── sessions.ts                 # Session CRUD + helpers
│   └── meecap.ts                   # Meecap generation + validation
│
├── ├── normalizeText.ts            # Regex normalization engine
│   └── extractRegistryMatches.ts   # Entity extraction from text

├── recall/
│   ├── findRelevantBeats.ts        # Beat relevance scoring
│   └── buildMemoryContext.ts       # Memory capsule formatter (with WITNESS POSTURE)
│   ├── loadRegistry.ts             # YAML loader
│   ├── types.ts                    # Type definitions
│   └── normalizeText.ts            # Regex normalization engine
│
├── llm/
│   ├── client.ts                   # OpenAI wrapper
│   └── prompts.ts                  # System prompt builder
│
├── commands/
│   ├── meepo.ts                    # Clean /meepo Phase 1A command surface
│   ├── meepoLegacy.ts              # Legacy meepo command surface (used by /lab)
│   ├── lab.ts                      # /lab legacy quarantine namespace
│   ├── session.ts                  # /session subcommands
│   ├── ping.ts                     # /ping
│   ├── deploy-dev.ts               # /deploy-dev
│   └── index.ts                    # Command registry
│
├── utils/
│   └── logger.ts                   # Centralized logging
│
└── tools/
    ├── compile-and-export-events.ts      # Event compilation
    ├── compile-and-export-events-batch.ts # Batch compiler
    ├── generate-beats.ts                 # Beats generation (meecaps ↔ gptcaps)
    ├── regenerate-meecap-beats.ts        # Beats table regeneration
    ├── scan-names.ts                      # Name discovery
    ├── review-names.ts                    # Registry triage
    └── cleanup-canonical-aliases.ts       # Validation
```

---

## Common Workflows

### Test Voice Flow
```bash
LOG_LEVEL=debug LOG_SCOPES=voice npm run dev:bot
# Join voice channel, speak "meepo, hello"
# Watch transcription, LLM call, TTS response in logs
```

### Ingest Campaign Recording
```bash
npx tsx tools/ingest-media.ts \
  --mediaPath "C:\Recordings\C2E06.mp4" \
  --outDb "./data/bot.sqlite" \
  --sessionLabel "C2E06" \
  --maxMinutes 20
```

### Scan & Update Registry
```bash
# Find unknown names in ledger
npx tsx src/tools/scan-names.ts

# Interactively review candidates
npx tsx src/tools/review-names.ts

# Validate aliases
npx tsx src/tools/cleanup-canonical-aliases.ts
```

### Compile Session for Analysis
```bash
# Single session by label
npx tsx src/tools/compile-and-export-events.ts --session C2E06

# All labeled sessions
npx tsx src/tools/compile-and-export-events-batch.ts
```

### View Logs by Scope
```bash
# Voice only
LOG_SCOPES=voice npm run dev:bot

# Multiple scopes
LOG_SCOPES=voice,stt,llm npm run dev:bot

# Trace level
LOG_LEVEL=trace npm run dev:bot
```

---

## Design Principles (Sacred)

1. **Diegetic Primacy** — Meepo exists *inside* the world
2. **Strict Guardrails** — No hallucinated lore, ever
3. **Voice-First Narration** — Speech at the table is primary source
4. **Emotional Memory, Not Omniscience** — Meepo remembers *because* something mattered
5. **Graceful Degradation** — Log errors, don't crash; fallbacks everywhere
6. **Scoped Authority** — NPC Mind only sees what Meepo perceives

---

## Recent Changes (February 14, 2026 - Evening)

### NAL Copilot: Diegetic Integrity & Runtime Configuration ✨
Final polish for V0.1 release focusing on immersion preservation and dynamic configuration:

**Speaker Mask System (OOC Name Firewall):**
- **Problem:** Meepo was using Discord usernames (e.g., "Keemin (DM)") in responses, breaking diegetic immersion
- **Solution:** Per-guild speaker mask database with priority sanitization
  - New `speaker_masks` table with guild+user composite key
  - DM-only commands: `/meepo set-speaker-mask`, `/meepo clear-speaker-mask`
  - `src/ledger/speakerSanitizer.ts` — Centralized sanitization with fallback chain:
    1. Check speaker_masks table first
    2. Fall back to registry (future enhancement)
    3. Default to "Party Member" if no mask found
  - Integrated into all context building: `getVoiceAwareContext()`, `respondToVoiceUtterance()`, text message handlers
  - Persona enhancement: Added OOC NAME FIREWALL to Meepo's styleGuard
    - "Never refer to or address speaker labels like 'Party Member', 'Narrator', 'Dungeon Master', or Discord usernames"

**Reply Mode Migration (Env Var → Runtime Command):**
- **Deprecated:** `MEEPO_VOICE_REPLY_ENABLED` environment variable
- **New:** `/meepo reply mode:voice|text` command for runtime control
  - Added `reply_mode` column to `npc_instances` table (default: 'text')
  - Updated `MeepoInstance` type and `wakeMeepo()` to track mode
  - Modified `voiceReply.ts` and `/meepo say` to check database instead of env var
  - Database migration auto-applies on bot restart
  - Benefits: No restart needed to switch modes, per-instance configuration

**Auto-Sleep Feature:**
- **Problem:** Orphaned sessions when forgetting `/meepo sleep` before stopping bot
- **Solution:** Background inactivity checker with configurable timeout
  - New module: `src/meepo/autoSleep.ts`
    - Runs check every 60 seconds
    - Queries latest ledger timestamp per guild
    - Calls `sleepMeepo()` when inactivity exceeds threshold
  - Configuration: `MEEPO_AUTO_SLEEP_MS` in .env (default: 600000ms / 10 minutes)
  - Set to `0` to disable
  - Integrated into bot startup (`client.once("ready")`)
  - Logs auto-sleep events to console

**Persistent Channel Uptime:**
- **Removed:** Latch mechanism entirely
- **New behavior:**
  - Meepo responds to ALL messages in bound channel (no latch expiry)
  - Requires @mention in other channels
  - Cleaner UX for dedicated #meepo channels
  - Simplified codebase (removed latch imports/checks from bot.ts)

**Memory System Enhancements:**
- **Moved:** `INITIAL_MEMORIES` from `meepo-mind.ts` → `src/meepo/knowledge.ts`
  - Better separation of concerns (knowledge definition vs DB operations)
  - Shared `Memory` type for consistency
- **Fixed:** Memory seeding changed from one-time to incremental
  - Previously: Only seeded if table completely empty
  - Now: Title-based differential seeding
    - Query existing titles from DB
    - Filter `INITIAL_MEMORIES` to only missing titles
    - Insert only new memories
  - Benefits: Can add new memories to `knowledge.ts` without wiping database

**Recall Pipeline Enhancement:**
- **Added:** WITNESS POSTURE guidance to memory capsule injection
  - Appended to `buildMemoryContext()` output in `src/recall/buildMemoryContext.ts`
  - Instructs Meepo on pre vs post-embodiment perspective
  - Emphasizes uncertainty admission and shared party viewpoint
  - Applied to both text and voice recall contexts

**Context Inclusivity:**
- **Fixed:** `getVoiceAwareContext()` now includes `secondary` narrative weight
  - Previously excluded secondary text messages
  - Caused conversation continuity breaks in text chat
  - Now includes: 'primary', 'elevated', 'secondary'

**New Modules:**
- `src/ledger/speakerSanitizer.ts` — OOC name sanitization
- `src/meepo/knowledge.ts` — Meepo's foundational memories
- `src/meepo/autoSleep.ts` — Inactivity-based session cleanup

**Schema Changes:**
- `speaker_masks` table (guild_id, discord_user_id, speaker_mask, timestamps)
- `npc_instances.reply_mode` column (TEXT NOT NULL DEFAULT 'text')
- Both migrations auto-apply on bot restart

**Configuration Changes:**
- `MEEPO_AUTO_SLEEP_MS=600000` added to .env (default 10 minutes)
- `MEEPO_VOICE_REPLY_ENABLED` commented out with deprecation note

---

## Recent Changes (February 14, 2026 - Afternoon)

### Bootstrap Infrastructure & Beats Normalization ✨
Prepared modularity for GPU-enhanced meecaps (gptcaps) bootstrapping by establishing parallel filesystem storage for experimental narratives and beats:

**New Tool:**
- `src/tools/generate-beats.ts` — Unified beats generation for meecaps and gptcaps
  - Supports `--source meecaps|gptcaps` for flexible bootstrap/canonical use
  - For meecaps: reads from filesystem, looks up UUID session_id in DB, inserts beats
  - For gptcaps: pure filesystem mode (no DB dependency, allows offline workflows)
  - Flags: `--db` (insert to meecap_beats), `--force` (overwrite), `--session` (filter by label)
  - Output: `beats_{label}.json` files with self-documenting label field
  - Enhanced logging: NAMING DRIFT detection for filename mismatches

**Schema Enhancements:**
- Added `label TEXT` column to meecap_beats
  - Enables human-readable querying without joins to sessions table
  - Auto-created and backfilled on bot startup
- Updated FK constraint: Added `ON DELETE CASCADE` for safety
  - Prevents orphaned beats if a meecap narrative is deleted

**Type/Storage Updates:**
- `MeecapBeats` type now includes optional `label?: string` field
  - Makes beats self-contained (no need to parse filename for label)
  - Consistent with filesystem naming (both use label)
- `buildBeatsJsonFromNarrative()` now accepts label parameter
  - Label automatically stored in beats JSON output

**Filesystem Restructuring:**
- Renamed all beats files from UUID-based to label-based: `{uuid}.json` → `beats_{label}.json`
  - All 19 C2E sessions now human-readable: `beats_C2E1.json` through `beats_C2E19.json`
  - Regenerated with `generate-beats.ts --source meecaps --db --force` (434 beats total)
- Directory structure now mirrors meecaps naming:
  ```
  data/meecaps/narratives/meecap_C2E6.md
  data/meecaps/beats/beats_C2E6.json
  data/gptcaps/narratives/meecap_C2E6.md    ← future: from ChatGPT
  data/gptcaps/beats/beats_C2E6.json        ← future: derived from gptcap
  ```

**Database Backfill:**
- All 434 beats now have label column populated from sessions table
- Verified: 19 sessions with beat counts: C2E1(24), C2E2(32), ..., C2E19(26)
- Safe, idempotent: can regenerate with --force flag anytime

**Benefits for Bootstrap:**
- Meecaps storage: filesystem-first modularity (can work offline)
- Gptcaps isolation: DB-free, completely separate from canonical data
- Easy promotion: gptcap → meecap is just a filesystem copy + DB insert
- Label consistency: narratives and beats both use same naming convention

**Directory Refactoring:**
- Renamed `data/session-events` → `data/events` (parity with other data dirs)
- Updated 3 references in `compile-and-export-events.ts`

## Recent Changes (February 14, 2026 - Morning)

### Transcript Consolidation Refactoring ✨
Consolidated duplicate transcript-building logic from Meecap and Events tools into a unified `buildTranscript()` utility:

**New Module:**
- `src/ledger/transcripts.ts` — Shared transcript builder
  - Single source of truth for ledger querying
  - Filters: `source IN ('text', 'voice', 'offline_ingest')` + optional `narrative_weight='primary'`
  - Always prefers normalized content (`content_norm` → fallback to raw)
  - Returns `TranscriptEntry[]` with stable `line_index`, `author_name`, `content`, `timestamp_ms`

**Updated Modules:**
- `src/sessions/meecap.ts`
  - `buildMeecapTranscript()` now calls unified builder
  - `generateMeecapNarrative()` refactored to use shared builder
  - `generateMeecapV1Json()` refactored to use shared builder
  - `buildBeatsJsonFromNarrative()` simplified (takes `lineCount` parameter)

- `src/tools/compile-and-export-events.ts`
  - `loadSessionTranscript()` now uses unified builder
  - Fixed potential bug: raw content normalization now guaranteed

- `src/commands/session.ts`
  - `/session meecap` command updated for new architecture

**Benefits:**
- ✅ Single source of truth for filtering logic
- ✅ Consistent content normalization across tools
- ✅ Fixed Events tool edge case (raw content not always normalized)
- ✅ Reduced maintenance burden
- ✅ Clear separation: filtering upstream, formatting downstream

### Meecap Beats Table Migration ✨ **NEW Feb 14**
Restructured meecap storage to support dual-lane Silver architecture (Meecaps + Events as two independent ways to understand sessions):

**Schema Changes:**
- **New `meecap_beats` table** (normalized beat rows)
  - Columns: `id, session_id, beat_index, beat_text, line_refs, created_at_ms, updated_at_ms`
  - One row per beat with stable ordering (UNIQUE on session_id, beat_index)
  - Enables efficient querying for character involvement, gravity scoring, etc.
  - Index on session_id for fast lookups by session

- **Removed `meecap_json` column** from meecaps table
  - Never actually used (was phantom infrastructure for "work already done?" checks)
  - Logic preserved but now hits meecap_beats table instead

**Code Changes:**
- `buildBeatsJsonFromNarrative()` enhanced with `insertToDB` parameter
  - When true, persists beats to meecap_beats table (idempotent, deletes old beats first)
  - Maintains backward compatibility for non-DB usage
  
- `src/commands/session.ts` refactored
  - All `meecap_json` column checks → `meecap_beats` table queries
  - Batch generation now filters on beats existence (not JSON column)
  - Narrative and beats generation now happen in separate steps (clean separation)

**Architecture:**
- **Meecaps = dual product** for humans + machines
  - Narrative: Source of truth, persisted in DB + filesystem (`data/meecaps/narrative/`)
  - Beats: Derived artifact, normalized in DB table + filesystem (`data/meecaps/beats/`)
  - Beats are deterministically extracted from narrative (no LLM cost, regenerable)

- **Why this structure?**
  - Humans read narrative prose (beautiful, coherent, discoverable in Discord)
  - Machines query beats table (efficient filtering for Gold layer future work)
  - Narrative never deleted/moved (beats depend on it)
  - Beats independently queryable (character involvement? beat pagination? gravity? all doable)

**Migration Path:**
- Database migration auto-creates meecap_beats table on bot startup
- Existing narratives preserved; beats need regeneration via:
  - `/session meecap --all` (generates both narrative + beats for missing sessions)
  - `regenerate-meecap-beats.ts` tool (regenerates just beats from existing narratives)
- No data loss; safe rollback possible

---

## What's Next (Phase 3)

### Gravity-Driven Character Retrieval
- Assign gravity scores to Meecap beats (Costly Love, Tenderness, Moral Fracture)
- Build character impression index (which beats involve PC?)
- Implement memory retrieval: When PC speaks, fetch relevant high-gravity beats
- Inject into LLM response prompt as emotional context

### LLM Prompt Enhancement
- Dynamic PC name injection (from registry)
- Gravity-weighted beat context
- Shortened working set (recency + gravity)
- Guard against self-reference (Meepo's own replies)

### Testing & Refinement
- Gravity assignment validation
- Character retrieval latency (query optimization)
- LLM response quality vs context size trade-off
- User feedback loops

---

## Troubleshooting

### Bot won't start
- Check `LOG_LEVEL=debug npm run dev:bot`
- Verify `DISCORD_TOKEN` is set
- Check database file at `DATA_DB_PATH`

### Voice not transcribing
- Verify `STT_PROVIDER=openai` and `OPENAI_API_KEY` set
- Check `LOG_SCOPES=voice,stt` for transcription errors
- Adjust `VOICE_SILENCE_THRESHOLD_DB` (try -50 for less aggressive)

### Meecap failing
- Run `/session meecap --force` to regenerate with fresh logs
- Check database has ledger entries: `SELECT COUNT(*) FROM ledger_entries;`
- Verify registry is valid: `npx tsx src/tools/cleanup-canonical-aliases.ts`

### Recap missing
- Ensure Meecap exists: `/session meecap` first
- Use `--force_meecap` flag to regenerate: `/session recap --force_meecap`

---

## File Tree Reference

```
docs/
├── CURRENT_STATE.md                 ← You are here (unified current state)
├── Project_Meepo.md                 (strategic vision + philosophy)
├── HANDOFF.md                       (Feb 11 snapshot, archived)
├── HANDOFF_V0.md                    (V0 deep-dive, archived)
├── HANDOFF_MEEP_MVP.md              (sprint 1 phases, archived)
└── HANDOFF_MEECAP_FIXES.md          (Feb 13 incremental improvements, archived)

src/db/schema.sql                    (Canonical database schema)
```

---

## Questions or Clarifications?

- **Architecture**: See `Project_Meepo.md`
- **V0 Details**: See `HANDOFF_V0.md`
- **Logging Setup**: See `src/utils/logger.ts` code comments
- **Registry Format**: See `data/registry/*.yml` examples
- **Meecap Schema**: See `src/sessions/meecap.ts` type definitions

**Deprecated docs** (`HANDOFF*` files) remain for historical reference but should not be your primary source.
