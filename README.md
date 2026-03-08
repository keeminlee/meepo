# Meepo Bot
**DISCORD APP LINK: https://discord.com/oauth2/authorize?client_id=1470521616747200524&permissions=3214336&integration_type=0&scope=bot+applications.commands**

**Meepo** is a diegetic AI companion for tabletop RPG campaigns.  
She sits quietly beside your party in Discord, listens as the story unfolds, and preserves the adventure in an append-only narrative ledger.

During the game, Meepo roleplays alongside your table as a small in-world presence.  
After the game, she remembers what happened — helping you revisit moments, generate recaps, and build a living chronicle of your campaign.

The goal is simple:

> **Your adventures should never be forgotten.**

---

## Quick Start

For first-time setup, start here:  
➡ **[docs/START_HERE.md](docs/START_HERE.md)**

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

Once running, invite Meepo to your Discord server and awaken her with:

```
/meepo awaken
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

Run 1 auth note:

- Web login now uses Discord OAuth (`identify guilds`) via Auth.js session cookies.
- `DEV_WEB_BYPASS` remains available for explicit local fallback while Track C is in progress.

Current web build note:

- `next build` in `apps/web` currently skips lint (`eslint.ignoreDuringBuilds`) as a temporary milestone tradeoff.

---

## Core Command Groups

Meepo’s primary interactions are organized into a few command families.

### Presence & Interaction
```
meepo awaken | status | talk | hush | help
```

### Configuration
```
meepo settings view | set
```

### Campaign Memory
```
meepo sessions list | view | recap
```

See **[docs/CURRENT_STATE.md](docs/CURRENT_STATE.md)** for full command details and current readiness status.

---

## What Meepo Does

Meepo quietly builds a structured memory of your campaign as it unfolds.

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
- [docs/CAUSAL_CORE_PHYSICS.md](docs/CAUSAL_CORE_PHYSICS.md)
- [docs/notes/ops/LOGGING_REFERENCE.md](docs/notes/ops/LOGGING_REFERENCE.md)
- [docs/notes/causal/causal-debug.md](docs/notes/causal/causal-debug.md)

---

## Philosophy

Meepo isn’t meant to replace a Dungeon Master or automate storytelling.

Instead, she acts as a **companion to the table** — a quiet witness to the adventure who helps preserve what happened.

Campaigns often span months or years, and many stories fade once the game ends.

Meepo exists so that, years later, someone can still ask:

> *“Remember when we fought the giant basilisk?”*

…and the story is still there.

---

## License

ISC
