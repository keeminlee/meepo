# Ops Runbook

## Guardrails

- Recap dedupe:
  - Same canonical key (`guild_id + campaign_slug + session_id + artifact variant`) is deduped at command edge and engine in-flight boundaries.
- Recap cooldown:
  - Immediate repeat recap requests are rate-limited.
  - `force:true` may bypass cooldown only; it does not bypass in-flight dedupe or hard capacity limits.
- Recall throttling:
  - Recall enrichment is throttled by short per-user and per-guild windows.
  - On throttle, reply path continues without optional enrichment.
- Worker back-pressure:
  - Expensive action families apply queue and in-flight caps.
  - Hot guild scope retries/defers rather than stampeding worker execution.

## Failure Taxonomy

Canonical runtime-facing codes in use:

- `ERR_UNKNOWN`
- `ERR_INTERNAL_RUNTIME_FAILURE`
- `ERR_DISCORD_REPLY_FAILED`
- `ERR_DB_BUSY`
- `ERR_WORKER_STALE_LEASE`
- `ERR_LLM_TIMEOUT`
- `ERR_LLM_RATE_LIMIT`
- `ERR_STT_FAILED`
- `ERR_TTS_FAILED`
- `ERR_ARTIFACT_WRITE_FAILED`
- `ERR_INVALID_STATE`
- `ERR_SESSION_CONFLICT`
- `ERR_RECAP_IN_PROGRESS`
- `ERR_RECAP_RATE_LIMITED`
- `ERR_RECAP_CAPACITY_REACHED`
- `ERR_STALE_INTERACTION`
- `ERR_TRANSCRIPT_UNAVAILABLE`
- `ERR_NO_ACTIVE_SESSION`

## Observability Signals

Key operational events and failure signals:

- `SESSION_RECAP_COOLDOWN_BYPASSED`
  - Force used to bypass recap cooldown.
- `action_backpressure_retry`
  - Worker deferred action due to in-flight family cap.
- `action_backpressure_skipped`
  - Enqueue blocked by queue cap/back-pressure.
- `ERR_RECAP_RATE_LIMITED`
  - User hit recap cooldown/rate-limit path.
- `ERR_RECAP_CAPACITY_REACHED`
  - Recap capacity guardrail blocked new work.
- `ERR_INTERNAL_RUNTIME_FAILURE`
  - Catch-all runtime failure at a guarded boundary.

Failure logs in strict runtime zones should include fields when available:

- `event_type`
- `guild_id`
- `campaign_slug`
- `session_id`
- `interaction_id`
- `error_code`
- `failure_class`
- `trace_id`

Notes:

- `error_code` and `failure_class` are for failure events/logs only.
- Non-failure operational events keep stable structured payloads and do not invent failure fields.

## Operational Interpretation

- If you see many `action_backpressure_retry` events:
  - A guild is saturating expensive action workers.
  - Check for bursty triggers or misuse.
  - Consider tuning family limits only after confirming load characteristics.
- If you see frequent `ERR_RECAP_RATE_LIMITED`:
  - Users are retrying recap too aggressively.
  - Validate cooldown UX copy and command guidance.
- If you see repeated `ERR_RECAP_CAPACITY_REACHED`:
  - Recap concurrency limit is being hit.
  - Investigate queue pressure and whether the cap is too low for current traffic.
- If `ERR_INTERNAL_RUNTIME_FAILURE` rises:
  - Triage by `event_type`, `trace_id`, and interaction context.
  - Prioritize recurring signatures over one-off spikes.

## Enforcement

- Stopline: `npm run stopline:observability-runtime`
- Policy:
  - Strict runtime zones fail on raw `console.*`.
  - Structured logger usage is the required path in those zones.

## Deploy Recovery Docs

Production deploy recovery is documented separately.

- `docs/runtime/ops/PRODUCTION_RUNBOOK.md`
- `docs/runtime/ops/KNOWN_DEPLOY_FAILURES.md`
- `docs/runtime/ops/DEPLOY_FLOW.md`
