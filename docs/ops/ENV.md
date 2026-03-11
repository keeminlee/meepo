# Environment Contract (Env Purge v1)

This document defines the minimal runtime environment and command deploy contract.

## Runtime Required

- `DISCORD_TOKEN`
- `OPENAI_API_KEY`

## Runtime Optional

- `BOT_PREFIX` (default: `meepo:`)
- `LATCH_SECONDS` (default: `90`)
- `DM_ROLE_ID` (optional legacy global DM role fallback for operator surfaces)
- `DM_USER_IDS` (comma-separated user IDs; global operator allowlist for DM/admin surfaces)
- `DEV_USER_IDS` (comma-separated user IDs; `/lab` runtime allowlist)
- `DEV_GUILD_IDS` (comma-separated guild IDs; `/lab` deploy scope)
- `LOG_LEVEL`, `LOG_SCOPES`, `LOG_FORMAT`
- `OVERLAY_PORT`
- Overlay-specific vars if using overlay features

Access model:
- Operational elevated (`/meepo` DM/admin surfaces): admin permission OR guild-config `dm_role_id` OR guild-config `dm_user_id` OR global `DM_USER_IDS` (with optional `DM_ROLE_ID` fallback).
- Developer elevated (`/lab`): `DEV_USER_IDS` only.

Notes:
- Runtime no longer requires `GUILD_ID` for core startup behavior.
- Startup Meepo restore scans connected guilds rather than a single configured guild.

## Command Deploy Contract

Deployment is a dual-pass operation:

- Global commands are deployed with `Routes.applicationCommands(...)`.
- Dev-only commands (currently `/lab`) are deployed to each guild in `DEV_GUILD_IDS`.

Product visibility contract:

- `/meepo` is global.
- `/lab` is only deployed to `DEV_GUILD_IDS`.
- Runtime execution is still gated by `DEV_USER_IDS`.

Default deploy command:

```bash
npm run deploy:commands
```

### Deploy Env Vars

- `DEV_GUILD_IDS` (comma-separated guild IDs for `/lab` deployment)

Lab deploy behavior:

- if `DEV_GUILD_IDS` is empty, `/lab` deploy is skipped
- if `DEV_GUILD_IDS` has values, `/lab` is deployed to each listed guild
- `/lab` contains dev/maintenance routes including doctor/sleep, meeps, missions, and goldmem.

### Examples

Deploy global + scoped `/lab` (default):

```bash
npm run deploy:commands
```

Deploy `/lab` to explicit dev guilds:

```bash
DEV_GUILD_IDS=<guild_id_1>,<guild_id_2> npm run deploy:commands
```

## Compatibility Notes

- `npm run dev:deploy` remains available and delegates to `deploy:commands`.
- `DISCORD_APPLICATION_ID` (or `DISCORD_CLIENT_ID`) and `DISCORD_TOKEN` are required for deploy.
