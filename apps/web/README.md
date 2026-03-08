# Meepo Web Archive (`apps/web`)

This package is the Track B web archive shell for Meepo.

## Runtime

- Framework: Next.js App Router
- Active routes:
  - `/`
  - `/dashboard`
   - `/settings`
   - `/campaigns/[campaignSlug]/sessions`
   - `/campaigns/[campaignSlug]/sessions/[sessionId]`
   - `/campaigns/[campaignSlug]/compendium`
- Route-level shells are implemented with `loading.tsx` and `error.tsx` for main archive routes.

## Campaign Context Stabilization

Campaign context is now enforced by a shared gate:

- `components/guards/active-campaign-gate.tsx`

Resolution order is deterministic:

1. route campaign slug
2. persisted campaign (`localStorage.meepo.activeCampaign`)
3. first real campaign
4. system demo campaign (`demo`) when real campaign count is zero

Doctrine:

- Campaign-scoped pages do not implement their own fallback logic.
- Sidebar campaign-scoped links are never disabled.
- Demo campaign is system-scoped and read-only (`editable=false`, `persisted=false`).
- Unsigned users may access only demo-safe dashboard presentation plus demo sessions/compendium routes.
- Unsigned users cannot resolve into real campaign routes or authenticated campaign data.
- Invalid campaign slug routes remain not-found (no redirect compatibility route).

## Local Run

1. Install dependencies:
   - `npm install`
2. Start dev server:
   - `npm run dev`
3. Open:
   - `http://localhost:3000`

## Auth Setup (Track C Run 1)

Create `apps/web/.env.local` with:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `AUTH_SECRET`
- `NEXTAUTH_URL=http://localhost:3000`

OAuth scopes requested:

- `identify`
- `guilds`

Run 1 uses JWT session strategy (no DB adapter).

## Run 2B Refresh Policy

- Guild authorization is still ID-based (`authorizedGuildIds`) with guild metadata for UI only.
- Discord guild snapshots refresh when stale (TTL from `MEEPO_WEB_DISCORD_GUILDS_TTL_MS`, default `300000`).
- On refresh failure, web auth falls back to session snapshot data (`session_snapshot_fallback`) to keep signed-in browsing available.

## Run 4 Scope Hardening

- Session object access is authorized in reader/action code by proving ownership against full `authorizedGuildIds`.
- Legacy `MEEPO_WEB_GUILD_ID` fallback is removed.
- Local fallback now requires explicit `DEV_WEB_BYPASS=1` plus header/query override.

## Run 5 Closeout

Track C is complete as a Discord-authenticated, guild-scoped archive access layer.

Final doctrine:

- Auth.js + Discord OAuth is the primary auth model.
- Guild authorization is derived from Discord membership and enforced by `authorizedGuildIds`.
- Campaign identity remains `guild_id + campaign_slug`.
- Session object authorization is enforced in reader/action code, not route handlers.
- No implicit env guild fallback exists.
- Dev bypass is explicit local fallback only (`NODE_ENV!=production` and `DEV_WEB_BYPASS=1`).

Run 5 verification matrix:

- `PASS` sign-in substrate and session-backed auth context (`session_snapshot|discord_refresh|session_snapshot_fallback`).
- `PASS` authorized dashboard/campaign discovery filtered by guild membership.
- `PASS` session detail/transcript/recap/regenerate enforce ownership against full authorized guild set.
- `PASS` regenerate denial occurs before recap work starts when session is out of scope.
- `PASS` authenticated session takes precedence over bypass overrides.
- `PASS` signed-in no-data path renders empty state (no error).
- `MANUAL` local Discord login UX smoke.
- `MANUAL` direct unauthorized URL denial smoke from browser session.

## Compendium Surface (R1)

Compendium management is available per campaign at:

- `/campaigns/[campaignSlug]/compendium`

Naming doctrine:

- User-facing terminology is `Compendium`.
- Internal service/API terminology remains `registry`.

Doctrine and guardrails:

- Registry remains campaign-scoped (`data/registry/<campaign_slug>/`).
- YAML remains source of truth; web uses structured mutation adapters.
- No cross-campaign fallback or write-through to another campaign.
- Out-of-scope campaign access returns not-found style denial.

R1 mutation scope (non-destructive):

- add canonical entry
- edit safe fields
- promote pending candidate
- reject pending candidate to ignore
- delete pending item

Not in scope for R1:

- destructive canonical delete

## Regenerate Behavior Audit

Session recap regenerate is an action capability with explicit environment gating.

Requirements:

- `OPENAI_API_KEY` must be configured in the web runtime environment (`apps/web/.env.local` for local development).
- Missing key maps to typed capability-unavailable behavior (`openai_unconfigured`, HTTP `503`).

What regenerate rebuilds:

- Regenerate always rebuilds the full recap contract for the session.
- It generates all style variants (`concise`, `balanced`, `detailed`) in one operation.
- It persists canonical `session_recaps` fields for all three variants.
- It also runs megameecap base/final artifact flow and writes per-style final recap artifacts.

Behavior truth table:

- OpenAI configured + valid session scope: regenerate executes and session recap data refreshes.
- OpenAI missing: regenerate is unavailable and returns typed capability error (`openai_unconfigured`).
- Existing recap missing/unavailable: read UI still loads; regenerate remains the recovery action path.

## Scripts

- `npm run dev` - start local dev server
- `npm run build` - production build
- `npm run start` - run built app
- `npm run typecheck` - TypeScript check
- `npm run lint` - Next lint

## Track B Notes

- B0 currently uses typed mock readers in `lib/server/readers.ts`.
- B1+ will swap reader internals to canonical backend adapters (`src/sessions/*`, `src/ledger/transcripts.ts`) without changing page contracts.
- Legacy Vite implementation is quarantined under `legacy-vite/` and is not part of the active runtime.
