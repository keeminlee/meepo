# Awakening Runtime Architecture

## Overview

The Awakening Runtime is a deterministic scene interpreter used for onboarding and future ritual-style workflows.

Awakening scripts are versioned YAML scene graphs. The engine loads a script version, executes scenes in order, persists progress, and resumes exactly from persisted state after restarts.

## Runtime Guarantees

- Deterministic scene execution.
- Resumable runtime state.
- Engine-owned mutation of persistent state.
- Nonce-protected user interactions.
- Ordered action execution.

## Execution Model

Each scene follows a fixed lifecycle:

Render scene
    │
    ▼
Await prompt (if present)
    │
    ▼
Persist user input
    │
    ▼
Execute commits
    │
    ▼
Execute runtime actions
    │
    ▼
Transition to next scene

This ordering guarantees stable outcomes across restarts.

## Architecture Diagram

Awakening Script (YAML)
        │
        ▼
     AwakenEngine
        │
        ├── prompts/*
        │
        ├── commits/*
        │
        ├── actions/*
        │
        ▼
     guild_onboarding_state
         +
     meepo_mind_memory / guild_config

## State Model

### Progress State

Stored in `guild_onboarding_state.progress_json`.

Used for:

- Prompt answers.
- Temporary runtime state.
- Deterministic resume checkpoints.

Examples:

- `progress_json.dm_display_name`
- `progress_json.home_channel_id`
- `progress_json.players`
- `progress_json._rb_pending_character_name`

Progress state is scene-driven and resumable.

### Memory State

Stored in `meepo_mind_memory` (for keyed identity text) and `guild_config` (for guild-scoped control flags/bindings).

Used for canonical identity and long-lived values.

Examples:

- `meepo_mind_memory(scope_kind='guild', key='dm_display_name')`
- `guild_config.dm_user_id`

### Example Flow

`progress_json.dm_display_name`
        │
        ▼
commit
        │
        ▼
`meepo_mind_memory(dm_display_name)`

## Recovery and Reset

- `/meepo awaken` checks `guild_config.awakened` and returns an explicit already-awakened message when setup is complete.
- `/lab awaken reset confirm:RESET` is the sanctioned recovery path for rerunning onboarding.
- Reset behavior clears onboarding rows (`guild_onboarding_state`, legacy `onboarding_progress` if present) and clears `guild_config.awakened`.
- Reset behavior intentionally preserves sessions, transcripts, and artifacts.

## Commit Model

Commits are declared in script scenes but executed only by the engine.

Execution flow:

persist prompt input
→ execute commits
→ transition scene

Properties:

- Engine-owned commits: scripts declare intent, engine performs mutation.
- Append-only registry policy for setup writes.
- Setup-only mutation guard for registry writes.

Example commit type:

- `append_registry_yaml`

## Prompt System

Prompt primitives:

- `choice` — deterministic button selection.
- `modal_text` — free-text input.
- `role_select` — select DM role.
- `channel_select` — select home or voice channel.
- `registry_builder` — iterative player registration.

Interaction safety checks require a matching pending triple:

- `scene_id`
- `key`
- `nonce`

These values are embedded in interaction IDs and validated on submit.

This prevents stale and cross-scene submissions.

## Runtime Actions

Actions execute after commits.

Dispatcher guarantees:

- Actions run in script order.
- Actions never mutate `progress_json` directly.
- Action failures never halt scene progression.

Log format:

- `AWAKEN_ACTION ok type=<type> scene=<scene_id>`
- `AWAKEN_ACTION fail type=<type> scene=<scene_id> code=<error_code>`

Supported action:

- `join_voice_and_speak` (best-effort)

Failure behavior:

- Emits fallback line.
- Continues scene progression.

## Channel Drift Behavior

Channel drift is prompt post-processing for `channel_select` when `on_change.if_different_channel` is present.

If selected channel differs from current channel:

- Emit departure lines in the old channel.
- Emit arrival lines in the new channel.
- Update runtime channel context.

Runtime-only channel context:

- `runtime.current_channel_id` exists only for the current engine run.
- Persisted state keeps only selected channel values such as `home_channel_id`.

Drift emission is best-effort and non-blocking.

## Dynamic STT Prompt System

Purpose:

Adapt speech recognition prompts to campaign-specific names.

Trigger:

canonical session start
→ enqueue `refresh-stt-prompt`

Behavior:

- Read campaign registry.
- Extract PC names and Meepo/persona references.
- Deduplicate terms.
- Persist current prompt to `guild_config.stt_prompt_current`.

Usage:

STT provider receives the runtime prompt override per guild.

## Design Invariants

The following decisions are stable:

- `/meepo` command surface remains user UX first.
- Registry remains YAML-first.
- Registry writes are append-only.
- Commit execution is engine-owned.
- STT prompts refresh dynamically on session start.
- Prompt interactions require nonce validation.
- Runtime actions never mutate progress state.
