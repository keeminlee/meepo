# Campaign-Scoped Registry + Rei Persona — Onboarding

## Quick reference

- **Registry path**: `data/registry/<campaign_slug>/` (e.g. `data/registry/pandas-dd-server/`).
- **Default campaign**: Set `DEFAULT_CAMPAIGN_SLUG` in `.env` when no guild or `--campaign` is provided.
- **Guild campaign**: Stored in `guild_config.campaign_slug` (created from server name on first use, or set via `/meepo guild-config set campaign-slug <slug>`).

## Panda server: Rei + own registry

1. **Invite the bot** to Panda's server.
2. **Set default persona to Rei** (DM-only):
   - `/meepo guild-config set key: default-persona value: rei`
3. **Optional — set campaign slug** if the auto-derived slug isn’t desired:
   - `/meepo guild-config set key: campaign-slug value: pandas-dd-server`
4. **Wake**: `/meepo wake` — Meepo wakes with Rei (or whatever default-persona is set).
5. **Start a session** before using campaign personas: `/session start` (or equivalent). Then `/meepo persona-set persona: rei` works.

## Tool cycle (scan-names + review-names)

- **Explicit campaign**
  ```bash
  npx tsx src/tools/registry/scan-names.ts --campaign pandas-dd-server
  npx tsx src/tools/registry/review-names.ts --campaign pandas-dd-server
  ```
- **From guild ID** (e.g. when offline, using DB)
  ```bash
  npx tsx src/tools/registry/scan-names.ts --campaign auto --guild <DISCORD_GUILD_ID>
  npx tsx src/tools/registry/review-names.ts --campaign auto --guild <DISCORD_GUILD_ID>
  ```
- **Default campaign** (no flags: uses `DEFAULT_CAMPAIGN_SLUG` or `"default"`)
  ```bash
  npx tsx src/tools/registry/scan-names.ts
  npx tsx src/tools/registry/review-names.ts
  ```

All tools print `Campaign: <slug>` at start. Pending and registry files live under `data/registry/<slug>/`.

## Verification

- **debug-persona**: `/meepo debug-persona` shows `active_persona_id`, `mindspace`, and **campaign_slug**.
- **No cross-campaign writes**: Run scan-names/review-names for campaign A, then for campaign B; confirm only `data/registry/<B>/` (and A’s folder) are touched; no writes under A when running for B.
- **Regression**: Run the same tools for another campaign (e.g. Faeterra); confirm no files in Panda’s campaign folder are modified.

## Notes

- **cleanup-canonical-aliases** still uses a single registry path; consider adding `--campaign` for consistency in a follow-up.
- **Overlay / other tools** that call `loadRegistry()` without a campaign use the default campaign; pass `campaignSlug` where guild context is available.
