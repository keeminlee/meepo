# Ops Triage (Closed Alpha P0)

Use this checklist whenever onboarding or archive access fails.

Primary objective: identify `guild_id`, `campaign_slug`, `session_id`, and auth state in minutes.

## Quick Triage Flow

1. Confirm `guild_id`.
- Source from Discord server context first.
- If user provides only server name, map to guild ID before deeper checks.

2. Confirm campaign scope.
- Identify active `campaign_slug` for that guild.
- Verify whether the slug is showtime or meta campaign scope.

3. Confirm session record.
- Verify target `session_id` exists under the expected `guild_id + campaign_slug` scope.
- If session missing, re-check if user ended the session with `/meepo showtime end`.

4. Confirm auth state.
- Verify user is signed in with Discord.
- Verify user belongs to guild in `authorizedGuildIds`.
- Verify unauthorized route behavior is deny-by-default (404-style/no data leakage).

5. Confirm artifact status.
- Transcript status: available/missing/unavailable.
- Recap status: available/missing/unavailable.
- If recap missing immediately after end, allow up to 2 minutes before escalation.

## Failure Buckets

1. Auth failure
- Symptoms: dashboard empty, unauthorized session URL, no campaigns visible.
- First checks: sign-in state, guild membership, `authorizedGuildIds` filtering.

2. Awaken failure
- Symptoms: `/meepo showtime start` blocked, Meepo remains dormant.
- First checks: rerun `/meepo awaken`, verify guild setup persisted.

3. Session start/end failure
- Symptoms: no active session starts, end command reports no active session.
- First checks: lifecycle state, command permissions, correct guild channel context.

4. Recap visibility delay/failure
- Symptoms: session present but recap unavailable.
- First checks: transcript exists, artifact generation started, wait budget (`<=2 minutes`) respected.

## Event Contract Map

These lifecycle events are emitted as `source=system` rows (`tags=system,<EVENT_TYPE>`) and should be triaged directly.

1. `SHOWTIME_START`
- Required payload fields: `event_type`, `guild_id`, `campaign_slug`, `session_id`.
- Optional payload field: `trace_id`.

2. `SHOWTIME_END`
- Required payload fields: `event_type`, `guild_id`, `campaign_slug`, `session_id`.
- Optional payload field: `trace_id`.

3. `VOICE_LEAVE`
- Required payload fields: `event_type`, `guild_id`, `campaign_slug`, `session_id`.
- Optional payload fields: `trace_id`, `reason`.

4. `SHOWTIME_ARTIFACT_KICKOFF`
- Required payload fields: `event_type`, `guild_id`, `campaign_slug`, `session_id`, `stage`.
- Optional payload fields: `trace_id`, `strategy`, `error`.

5. Auth deny events
- P0 note: explicit auth-deny event rows are not yet standardized across all web deny paths.
- Triage via API status/code first (`401 unauthorized`, `404 not_found` in scoped routes) and correlate with request logs.

## Operator Recording Template

- Incident time (UTC):
- Reporter:
- guild_id:
- campaign_slug:
- session_id:
- User auth state:
- `authorizedGuildIds` contains guild: yes/no
- Transcript status:
- Recap status:
- User-visible error/copy:
- Root cause:
- Resolution:
- Preventive follow-up:

## P0 Escalation Rules

1. Escalate immediately if unauthorized data is visible across guild boundaries.
2. Escalate if fresh DM cannot complete canonical loop in `<=10 minutes`.
3. Escalate if three consecutive onboarding attempts fail at the same step.

## Deploy Triage References

For deploy-specific incidents, use these operator docs.

- `docs/runtime/ops/PRODUCTION_RUNBOOK.md`
- `docs/runtime/ops/KNOWN_DEPLOY_FAILURES.md`
- `docs/runtime/ops/DEPLOY_FLOW.md`
