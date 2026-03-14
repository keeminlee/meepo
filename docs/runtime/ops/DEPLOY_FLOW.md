# Deploy Flow

Date: 2026-03-14

This document explains the production deployment path from GitHub to the running Meepo services.

## End-To-End Flow

```text
GitHub push to main
  -> GitHub Actions verify job
  -> GitHub Actions deploy job
  -> SSH to EC2 host
  -> deploy/ec2/deploy-meepo.sh
  -> systemd restart of meepo-bot and meepo-web
  -> post-deploy npm run deploy:commands
  -> production validation
```

## Runner Responsibilities

GitHub-hosted runner:
- checks out the repo
- runs `npm ci`
- runs `npm run ci:verify`
- opens SSH connection to the EC2 host
- invokes the remote deploy script
- invokes remote Discord command deployment

EC2 host:
- syncs repo state in the application directory
- installs production dependencies
- builds the web app
- runs auth runtime preflight
- reloads and restarts systemd units
- runs command deployment with production bot credentials

## Canonical Runtime Path

- Workflow entrypoint: `.github/deploy.yml`
- Remote deploy script: `deploy/ec2/deploy-meepo.sh`
- Auth preflight: `deploy/ec2/auth-runtime-preflight.sh`
- Bot service unit: `deploy/systemd/meepo-bot.service`
- Web service unit: `deploy/systemd/meepo-web.service`

The repo-root `deploy-meepo.sh` should be treated as a legacy compatibility path until deprecation is completed.

## Environment Sources

Application restart path:
- `meepo-bot` reads `/etc/meepo/meepo-bot.env` through systemd.
- `meepo-web` reads `/etc/meepo/meepo-web.env` through systemd.

Command deploy path:
- the workflow sources `/etc/meepo/meepo-bot.env` before running `npm run deploy:commands`
- this ensures command deployment uses the same Discord credentials as the runtime bot

## Operator Checks

After a production deploy:

- confirm the GitHub deploy job completes successfully
- confirm the remote deploy stage completed on EC2
- confirm the command deploy step succeeded
- confirm `meepo-bot` and `meepo-web` are active
- confirm `curl -fsS http://127.0.0.1:3000` succeeds on the host
- confirm `/starstory showtime start` exposes the expected campaign parameters
- confirm stale legacy root commands are not present after propagation