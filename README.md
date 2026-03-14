# StarStory Platform
**PROD DISCORD APP LINK: https://discord.com/oauth2/authorize?client_id=1470521616747200524&permissions=1051648&integration_type=0&scope=bot+applications.commands**
**DEV DISCORD APP LINK: https://discord.com/oauth2/authorize?client_id=1479618157650907276&permissions=3148800&integration_type=0&scope=bot+applications.commands**


**StarStory** is the platform for preserving tabletop RPG campaigns.  
It sits beside your party in Discord, listens as the story unfolds, and preserves the adventure in an append-only narrative ledger.

During the game, **Meepo** can still appear as the in-world archivist character.  
After the game, StarStory helps you revisit what happened, generate recaps, and build a living chronicle of your campaign.

Naming doctrine:

- StarStory = platform
- Chronicle = archive
- Archivist = system role
- Meepo = archivist character / internal codename

The goal is simple:

> **Your adventures should never be forgotten.**

---

## Quick Start

For first-time setup, start here:  
➡ **[docs/START_HERE.md](docs/START_HERE.md)**

Closed Alpha release control (branch alignment + scope freeze):
➡ **[docs/runtime/ops/CLOSED_ALPHA_PHASE0_RELEASE_CONTROL.md](docs/runtime/ops/CLOSED_ALPHA_PHASE0_RELEASE_CONTROL.md)**

Closed Alpha Phase 5 deploy/runtime versioning (in-repo deploy hook + systemd units):
➡ **[docs/runtime/ops/CLOSED_ALPHA_PHASE5_DEPLOY_RUNTIME_VERSIONING.md](docs/runtime/ops/CLOSED_ALPHA_PHASE5_DEPLOY_RUNTIME_VERSIONING.md)**

### Prerequisites

- Node.js **18+**
- Discord bot token *(Message Content intent enabled)*
- OpenAI API key

### Install

```bash
npm install
```

### Configure

Create a `.env` file and set the required values:

- `DISCORD_TOKEN`
- `OPENAI_API_KEY`

Useful runtime toggles:

- `BOT_PREFIX` (default: `meepo:`)
- `LATCH_SECONDS` (default: `90`)
- `LOG_LEVEL`, `LOG_SCOPES`, `LOG_FORMAT`
- `OVERLAY_PORT` (if using the OBS overlay)

### Run

```bash
npm run deploy:commands   # register slash commands (global by default)
npm run dev:bot      # start the bot
```

To deploy `/lab` into dev guilds, set `DEV_GUILD_IDS` (comma-separated) before deploy:

```bash
DEV_GUILD_IDS=<guild_id_1>,<guild_id_2> npm run deploy:commands
```

Once running, invite StarStory to your Discord server and initialize it with:

```
/starstory awaken
```

### Run Web Archive Viewer (Next.js)

The archive viewer now lives in `apps/web` and uses Next App Router.

```bash
cd apps/web
npm install
npm run dev
```

Web routes:

- `/`
- `/dashboard`
- `/settings`
- `/campaigns/[campaignSlug]/sessions`
- `/campaigns/[campaignSlug]/sessions/[sessionId]`
- `/campaigns/[campaignSlug]/compendium`

Campaign context doctrine:

- Web archive surfaces resolve a mandatory active campaign via shared gate logic.
- Resolution order: route slug -> persisted selection -> first real campaign -> system demo (`demo`).
- Demo campaign appears only when no real campaigns are available.

Useful local web env toggles:

- `DISCORD_CLIENT_ID=<discord_oauth_client_id>`
- `DISCORD_CLIENT_SECRET=<discord_oauth_client_secret>`
- `AUTH_SECRET=<long_random_secret>`
- `NEXTAUTH_URL=http://localhost:3000`
- `DEV_WEB_BYPASS=1` to allow local header/query guild override in non-production

Production auth requirements:

- Runtime canonical-origin cutover is still pending external ops work.
- Current production auth/runtime expects `https://meepo.online` until that cutover is completed.
- See [docs/product/external-cutover-handoff.md](docs/product/external-cutover-handoff.md) for the required out-of-repo follow-up.
- Run `deploy/ec2/auth-runtime-preflight.sh` before production auth troubleshooting.

Run 1 auth note:

- Web login now uses Discord OAuth (`identify guilds`) via Auth.js session cookies.
- `DEV_WEB_BYPASS` remains available for explicit local fallback while Track C is in progress.

Current web build note:

- `next build` in `apps/web` currently skips lint (`eslint.ignoreDuringBuilds`) as a temporary milestone tradeoff.

---

## Core Command Groups

StarStory's current public Discord surface is intentionally narrow.

### Public Root
```
/starstory
```

### Current Public Surface
```
/starstory awaken
/starstory showtime start|end
/starstory settings <subcommand>
/starstory help
/starstory status
```

### Production Surface Rules

- In production, StarStory does not provide ambient conversational text replies in channel chat.
- Public interaction is slash-command and voice/session first.
- `/starstory status` responds ephemerally and shows a concise public status view.
- Dev-only diagnostics and lab/legacy notes are shown only to dev-gated users.
- Use `/lab` for internal diagnostics and debugging routes.
- `/starstory sessions ...` is no longer public.
- `/starstory talk` and `/starstory hush` are retired from the public surface.

See **[docs/CURRENT_STATE.md](docs/CURRENT_STATE.md)** for full command details and current readiness status.

---

## What StarStory Does

StarStory quietly builds a structured memory of your campaign as it unfolds.

- **In-session listening**  
  Captures dialogue and events as they occur.

- **Narrative ledger**  
  Stores campaign history in an append-only structure.

- **Session recaps**  
  Turns raw events into readable summaries.

- **Campaign memory retrieval**  
  Recall characters, past moments, and narrative threads.

- **OBS overlay support**  
  Optional streaming overlays for live games.

Over time, this ledger becomes a **chronicle of the campaign** — a living memory of your table’s story.

---

## Project Structure

```
src/        Application code
src/causal/ Causal extraction and narrative link tooling
src/ledger/ Narrative ledger + retrieval pipeline
overlay/    OBS/browser overlay assets
docs/       Product and architecture documentation
tools/      CLI utilities for ingestion and debugging
```

---

## Documentation

Start with the documentation map:

➡ **[docs/README.md](docs/README.md)**

### Release Docs
- [docs/V1_RELEASE_CHECKLIST.md](docs/V1_RELEASE_CHECKLIST.md)
- [CHANGELOG.md](CHANGELOG.md)

### High-Use References
- [docs/MAP.md](docs/MAP.md)
- [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md)
- [DB routing guardrail](docs/CURRENT_STATE.md#db-routing-guardrail-campaign-isolation)
- [docs/systems/CAUSAL_CORE_PHYSICS.md](docs/systems/CAUSAL_CORE_PHYSICS.md)
- [docs/notes/ops/LOGGING_REFERENCE.md](docs/notes/ops/LOGGING_REFERENCE.md)
- [docs/notes/causal/causal-debug.md](docs/notes/causal/causal-debug.md)

---

## Philosophy

StarStory isn’t meant to replace a Dungeon Master or automate storytelling.

Instead, it acts as a **companion to the table** — a quiet witness to the adventure who helps preserve what happened.

Campaigns often span months or years, and many stories fade once the game ends.

StarStory exists so that, years later, someone can still ask:

> *“Remember when we fought the giant basilisk?”*

…and the story is still there.

---

## License

ISC
