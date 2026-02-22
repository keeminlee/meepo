# Meepo Bot

Meepo is a diegetic Discord companion for D&D campaigns: it listens in-session, logs an append-only narrative ledger, and supports recap + memory tooling.

## Quick Start

### Prerequisites
- Node.js 18+
- Discord bot token (Message Content intent enabled)
- OpenAI API key

### Install
```bash
npm install
```

### Configure
Create `.env` and set required values:
- `DISCORD_TOKEN`
- `OPENAI_API_KEY`

Useful runtime toggles:
- `BOT_PREFIX` (default `meepo:`)
- `LATCH_SECONDS` (default `90`)
- `LOG_LEVEL`, `LOG_SCOPES`, `LOG_FORMAT`
- `OVERLAY_PORT` (if using OBS overlay)

### Run
```bash
npm run dev:deploy   # register slash commands
npm run dev:bot      # start bot
```

## Core Command Groups

- `meepo`: wake/sleep/status/voice + persona controls
- `session`: lifecycle, transcript, meecap, recap
- `missions` / `meeps`: mission economy and balances

See [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) for command details and readiness status.

## Project Structure

- `src/` application code
- `src/causal/` causal extraction and link tooling
- `src/ledger/` ledger + retrieval pipeline
- `overlay/` OBS/browser overlay assets
- `docs/` product + architecture documentation
- `tools/` CLI utilities for ingestion and debugging

## Documentation

Start with [docs/README.md](docs/README.md) for the documentation map.

High-use references:
- [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md)
- [docs/CAUSAL_CORE_PHYSICS.md](docs/CAUSAL_CORE_PHYSICS.md)
- [LOGGING_REFERENCE.md](LOGGING_REFERENCE.md)
- [causal-debug.md](causal-debug.md)

## License

ISC