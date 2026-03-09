# Closed Alpha Phase 5 Deploy/Runtime Asset Versioning

Date: 2026-03-08

Phase 5 goal: remove deploy/runtime ambiguity by versioning deployment hooks and service units in-repo.

## What Is Now Version-Controlled

- Deploy hook:
  - `deploy/ec2/deploy-meepo.sh`
- Runtime asset installer:
  - `deploy/ec2/install-runtime-assets.sh`
- Systemd units:
  - `deploy/systemd/meepo-bot.service`
  - `deploy/systemd/meepo-web.service`
- Environment templates:
  - `deploy/env/meepo-bot.env.example`
  - `deploy/env/meepo-web.env.example`
- GitHub deploy workflow now executes the in-repo deploy hook:
  - `.github/deploy.yml`

## Runtime Contract

Canonical deploy path on EC2:

1. Repo exists at `APP_DIR` (default `/home/meepo/meepo-bot`).
2. Workflow SSH step runs:
   - `/bin/bash $APP_DIR/deploy/ec2/deploy-meepo.sh`
3. Deploy script performs:
   - `git fetch` + checkout/reset to target branch (`main` by default)
   - root dependency install (`npm ci`)
   - web clean build (`apps/web`, `rm -rf .next`, `npm ci`, `npm run build`)
   - `systemctl daemon-reload`
   - restart `meepo-bot` and `meepo-web`
   - service active checks

Identity and auth safety are unchanged:
- deploy/runtime versioning does not alter JWT/session payload contracts.

## First-Time Host Install

Run once on EC2 after pulling latest repo:

```bash
cd /home/meepo/meepo-bot
bash deploy/ec2/install-runtime-assets.sh
```

This installs:
- units into `/etc/systemd/system/`
- deploy hook into `/usr/local/bin/deploy-meepo` (compat shim)
- env templates into `/etc/meepo/` (non-destructive if files already exist)

Then set secrets in:
- `/etc/meepo/meepo-bot.env`
- `/etc/meepo/meepo-web.env`

## Operational Checks

```bash
sudo systemctl status meepo-bot --no-pager
sudo systemctl status meepo-web --no-pager
sudo journalctl -u meepo-bot -n 120 --no-pager
sudo journalctl -u meepo-web -n 120 --no-pager
```

## Exit Gate (Phase 5)

Phase 5 is complete when:
- deploy hook is in repo and used by workflow
- systemd unit definitions are in repo
- env template contracts are in repo
- host install/reload procedure is documented and repeatable
