# MegaMeecap Worker Ops Notes

Compact reference for Sprint 2 file-backed MegaMeecap action processing.

## 1) Action Contract: MEGAMEECAP_UPDATE_CHUNK

Enqueue condition:
- Canon scope only.
- Enqueue when canon delta is at least ~250 lines since watermark.
- Heartbeat enqueues one explicit range action per threshold pass.

Payload fields:
- `session_id`
- `scope` (`canon`)
- `range_start_ledger_id`
- `range_end_ledger_id`
- `algo_version`
- `chunk_index` (optional display/ordering only)

Dedupe key:
- Range-truth based.
- Includes: `action_type + session_id + range_start_ledger_id + range_end_ledger_id + algo_version`.
- Excludes: `chunk_index`.

## 2) Receipt/Meta Invariants (Replay + Debug)

Receipt/meta must include:
- `range_start_ledger_id`, `range_end_ledger_id`
- `algo_version`
- `source_hash` (when present)
- timestamp fields (`created_at_ms` and/or `generated_at_ms`)

Watermark rule:
- Watermark advances only to the committed receipt range end for a successful action.
- Retries must not partially advance watermark.
- Replays use receipt state and advance only to recorded committed end.

## 3) Artifact Location and Naming

Root:
- `data/campaigns/<slug>/exports/meecaps/`

Session stem:
- `session-<label_slug_or_session_id>` (current implementation)

Expected files for a completed action:
- Chunk artifact (`...-megameecap-chunk-....md`)
- Base (`...-megameecap-base.md`)
- Final balanced (`...-recap-final-balanced.md`)
- Meta JSON files (`*.meta.json`)

Write guarantee:
- Atomic writes (`tmp` then rename) are required so partial outputs do not surface.

## 4) Failure Modes and Triage

Action appears stuck in leased/processing:
- Check lease TTL and current `lease_until_ms`.
- If expired, worker should re-lease automatically on next tick.

Repeated retries or terminal failure:
- Check `attempts`, `maxAttempts`, and exponential backoff delay.
- Verify last error text and range payload validity.

Action marked done but expected files missing:
- Treat as receipt/meta mismatch (should be rare under atomic writes).
- Inspect action row (`dedupe_key`, payload), latest receipt block, and file timestamps in meecaps export dir.

Primary code touchpoints:
- `src/ledger/meepoContextHeartbeat.ts`
- `src/ledger/meepoContextActions.ts`
- `src/ledger/meepoContextWorker.ts`
- `src/dataPaths.ts`

Deterministic replay utility:
- `npx tsx src/tools/heartbeat/replay.ts --campaign <slug> --session <session_id_or_label>`

## 5) Heartbeat Replay Tool (Developer Infra)

Location:
- `src/tools/heartbeat/replay.ts`

Purpose:
- Rebuild Meepo context from existing ledger rows using runtime heartbeat/action code paths.
- Deterministically enqueue actions, optionally drain worker queue, and verify reducer invariants.

Core usage:
- Default full regeneration:
  - `npx tsx src/tools/heartbeat/replay.ts --campaign <slug> --session <id_or_label>`
- Dry-run (DB-safe full regeneration):
  - `npx tsx src/tools/heartbeat/replay.ts --campaign <slug> --session <id_or_label> --dry-run`
- Optional non-executing queue inspection:
  - `npx tsx src/tools/heartbeat/replay.ts --campaign <slug> --session <id_or_label> --enqueue-only`

Flags:
- Required: `--campaign`, `--session` (accepts session id or label; id match wins over label match)
- Optional: `--from-ledger-id`, `--to-ledger-id`, `--enqueue-only`, `--dry-run`, `--reset-context`, `--reset-receipts`, `--verbose`, `--artifact-dir`, `--heartbeat-mode row|slice`, `--yes`, `--keep-temp`

Mode behavior:
- Default: resets replay state, replays heartbeat reducer, drains queue with runtime lease/backoff rules, and writes artifacts to `exports/meecaps/offline_replay/`.
- `--dry-run`: runs the same full flow against a temporary DB copy; does not mutate campaign DB.
- `--enqueue-only`: replays reducer only and leaves queue populated for inspection.

Safety notes:
- Replay never appends or mutates ledger rows.
- Default flow prompts before LLM-backed regeneration unless `--yes` is passed.
- `--reset-context` clears context state + queued/leased actions.
- `--reset-receipts` extends reset to receipts + completed/failed replay actions for full regeneration.
- Default artifact output is sandboxed to `offline_replay/` under campaign meecaps exports.
- In dry-run mode, artifacts are redirected to temp output unless `--artifact-dir` is provided; temp workspace is removed unless `--keep-temp` is set.

Summary footer:
- Tool prints:
  - `Ledger processed`
  - `Final cursor`
  - `Final watermark`
  - `Queued actions`
  - `Artifacts written`

## 6) `meepo_actions` Logging Artifacts

Runtime knobs:
- `MEEPO_ACTION_LOGGING_ENABLED=true` (default): enables structured queue/action logging artifacts.
- `MEEPO_ACTION_LOGGING_INCLUDE_PROMPTS=false` (default): keeps prompt text out of logs unless explicitly enabled.

Artifact outputs:
- Online worker/heartbeat path (canon sessions only):
  - `...-meepo-actions-online.jsonl`
  - `...-meepo-actions-online.log`
- Offline replay path:
  - `...-meepo-actions-offline-replay.jsonl`
  - `...-meepo-actions-offline-replay.log`

Notes:
- Every event includes `anchor_ledger_id` (range events anchor to range end ledger id).
- Merged `.log` rendering happens at end-of-tick / replay drain boundaries.
- Transcript lines in merged logs are tagged as `[L<ledger_id>]`.