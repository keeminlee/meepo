# Start Here (Closed Alpha P0)

This is the single source of truth for P0 onboarding and acceptance.

## Doctrine Statement

P0 exists to establish the SaaS medium.
The mythic sky/Archivist layer is the product north star, but is not part of P0 success criteria.
Mythology is deferred as runtime/user-facing behavior while infrastructure is made trustworthy enough to host it.

Architecture doctrine:
- Discord is the control plane.
- Web is the archive plane.

## P0 Constitution

1. Session visibility, not recap visibility, is the P0 success gate.
2. Public `/meepo awaken` is optional, minimal, and idempotent.
3. Public `/meepo showtime start` must succeed with zero arguments.
4. Web gives setup/archive guidance; Discord keeps setup guidance minimal and command-first.
5. No cross-guild data leakage is acceptable.
6. Meta campaign exists for runtime continuity and is hidden from the web archive.
7. Closed Alpha lifecycle is listen-only voice: `/meepo showtime start` joins the invoker voice channel to listen, with no awaken prerequisite.
8. `/meepo showtime end` fully completes lifecycle: session finalized, receiver stopped, runtime returned to non-showtime, and voice disconnected if connected.

## Success Criteria

A new DM can do this in `<=10 minutes`:

1. Invite the bot.
2. Run `/meepo showtime start`.
3. See the session in the web dashboard.
4. Optional: run `/meepo awaken` later to seed minimal guild bootstrap metadata.

Canonical loop:
`invite -> showtime start -> dashboard session visibility`

## Contract Steps

### Step 1 - Invite Meepo

Action:
- Invite Meepo with the canonical production link:
  - `https://discord.com/oauth2/authorize?client_id=1470521616747200524&permissions=3214336&integration_type=0&scope=bot+applications.commands`

Expected result:
- Meepo appears in the Discord member list for the guild.

Target time:
- `<=60s`

### Step 2 - Start session

Action:
- Run `/meepo showtime start`.

Expected result:
- Command never blocks on missing campaign input.
- If no campaign exists, `Campaign Alpha` is auto-created.
- Session row is created as durable record.
- Invoker in voice is required for live listen-only capture.
- Bot joins that channel in listen-only mode (no speaking).

Target time:
- `<=30s`

### Step 3 - Verify dashboard visibility

Action:
- Open `https://meepo.online/dashboard`.

Expected result:
- The new session is visible under `Guild -> Campaign -> Sessions`.
- Active and completed sessions are both visible.
- Recap presence is non-gating for P0.

Target time:
- `<=2 minutes` from session start

### Step 4 - Optional awaken bootstrap

Action:
- Run `/meepo awaken` in a guild text channel.

Expected result:
- Guild config exists.
- `awakened = true`.
- `meta_campaign_slug` exists.
- `dm_user_id` is seeded when missing.
- `home_text_channel_id` is seeded when missing.
- No voice config wizard is required or auto-configured.
- Command confirms success.

Target time:
- `<=10s`

## Canonical Entity Contract (P0)

### `guild_config`

- Purpose: durable guild-level control state.
- Scope key: `guild_id`.
- Required fields for P0: `guild_id`, `campaign_slug`, `awakened`, `meta_campaign_slug`.
- Additional tracked fields (non-gating in P0): `dm_user_id`, `dm_role_id`, `home_text_channel_id`, `home_voice_channel_id`, `default_talk_mode`.
- Public awaken write lock in Closed Alpha: sets minimal essentials and never requires `home_voice_channel_id`.
- Written by: Discord command/control paths (not web readers).
- Read by: command guards, lifecycle logic, and web state derivation.
- User-facing: indirectly (drives onboarding and dashboard state).

### `guild_campaigns`

- Purpose: registry of guild-scoped showtime campaign namespaces.
- Scope key: `(guild_id, campaign_slug)`.
- Required fields for P0: `guild_id`, `campaign_slug`, `campaign_name`, `created_at_ms`, `created_by_user_id`.
- Written by: showtime campaign creation/upsert paths.
- Read by: dashboard campaign listing and campaign resolution.
- User-facing: yes (campaign list and names in web).
- Rule: meta campaign is not listed as a user-facing campaign.

### `sessions`

- Purpose: durable session records that power dashboard visibility.
- Scope key: `session_id` with ownership constrained by `guild_id` and `campaign_slug`.
- Required fields for P0: `session_id`, `guild_id`, `campaign_slug`, `label`, `started_at_ms`, `status`, creator/source metadata.
- Written by: showtime start/end lifecycle.
- Read by: dashboard/session detail/archive readers.
- User-facing: yes.

## Naming Translation Rule

Canonical meaning:
- `sessions.label` is the canonical DB field for user-provided/default session naming.

Translation:
- DB: `label`
- Internal runtime/docs: `session label`
- UI display text: `session title`

This translation is semantic only; it does not imply separate source-of-truth fields.

## Dashboard State Engine (Required)

1. Not logged in: Discord login prompt.
2. Logged in, bot not installed: invite prompt.
3. Bot installed, dormant: `/meepo awaken` guidance.
4. Awakened, no sessions: `/meepo showtime start` guidance.
5. Sessions exist: normal dashboard.

## Required Runtime Setup (Operators)

1. Deploy commands:

```bash
npm run deploy:commands
```

2. Start bot:

```bash
npm run dev:bot
```

3. Keep [OPS_TRIAGE.md](OPS_TRIAGE.md) open during onboarding and incidents.
