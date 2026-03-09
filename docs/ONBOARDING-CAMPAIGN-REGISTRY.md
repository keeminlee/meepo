# Campaign-Scoped Registry + Rei Persona — Onboarding

## Quick reference

- **Registry path (canonical)**: `data/registry/g_<guild>__c_<campaign>/` (for example `data/registry/g_823798700232015882__c_homebrew_campaign_2/`).
- **Legacy registry path**: `data/registry/<campaign_slug>/` remains compatibility-read fallback during migration windows.
- **Default campaign**: Set `DEFAULT_CAMPAIGN_SLUG` in `.env` when no guild or `--campaign` is provided.
- **Meta campaign slug**: Stored in `guild_config.meta_campaign_slug` and created once from guild identity at `/meepo awaken`; this is the durable ambient/meta home.
- **Showtime campaigns**: Stored in `guild_campaigns` per guild and created/reused via `/meepo showtime start`.

## Scope model doctrine

- `guild_config.meta_campaign_slug` is ambient/meta only.
- Showtime canon campaigns are explicit records in `guild_campaigns`.
- Showtime is never implicitly inferred from meta scope.
- One active session per guild remains unchanged.
- Canonical campaign materialization paths are guild-scoped (`guild_id + campaign_slug`); slug-only paths are not authoritative.
- Legacy fallback/default campaign behavior remains for compatibility reads only; new writes should use canonical scope creation and collision rules.

## Panda server: Rei + own registry

1. **Invite the bot** to Panda's server.
2. **Set default persona to Rei** (DM-only):
   - `/meepo guild-config set key: default-persona value: rei`
3. **Optional — set campaign slug** if the auto-derived slug isn’t desired:
   - `/meepo guild-config set key: campaign-slug value: pandas-dd-server`
4. **Awaken**: `/meepo awaken` — initializes ambient runtime and persists durable `meta_campaign_slug`.
5. **Start showtime** with explicit campaign intent:
  - create: `/meepo showtime start campaign_name:"Echoes of Avernus"`
  - reuse: `/meepo showtime start campaign:echoes_of_avernus`

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

All tools print `Campaign: <slug>` at start. Canonical pending/registry files live under scoped roots (`data/registry/g_<guild>__c_<campaign>/`).

Migration helper:

```bash
npx tsx src/tools/migrate-campaign-scope-paths.ts --dry-run
npx tsx src/tools/migrate-campaign-scope-paths.ts
```

## Verification

- **debug-persona**: `/meepo debug-persona` shows `active_persona_id`, `mindspace`, and **campaign_slug**.
- **No cross-campaign writes**: Run scan-names/review-names for campaign A, then for campaign B; confirm only `data/registry/<B>/` (and A’s folder) are touched; no writes under A when running for B.
- **Regression**: Run the same tools for another campaign (e.g. Faeterra); confirm no files in Panda’s campaign folder are modified.

## Notes

- **cleanup-canonical-aliases** still uses a single registry path; consider adding `--campaign` for consistency in a follow-up.
- **Overlay / other tools** that call `loadRegistry()` without a campaign use the default campaign; pass `campaignSlug` where guild context is available.
