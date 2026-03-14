# Production Runbook

Date: 2026-03-14

This runbook covers manual recovery for production deploy failures and post-deploy validation.

## Canonical Paths

- Repo path: `deploy/ec2/deploy-meepo.sh`
- Auth preflight: `deploy/ec2/auth-runtime-preflight.sh`
- Bot env: `/etc/meepo/meepo-bot.env`
- Web env: `/etc/meepo/meepo-web.env`
- App directory: `/home/meepo/meepo-bot`

## Standard Validation

Run these checks after any deploy or manual recovery.

```bash
sudo systemctl is-active meepo-bot
sudo systemctl is-active meepo-web
curl -fsS http://127.0.0.1:3000
```

Then validate Discord command parity.

- Confirm the workflow log includes a successful command deploy step.
- Confirm `/starstory showtime start` exposes the expected campaign parameters.
- Confirm stale legacy root commands are not visible after global propagation completes.

## Verified Manual Recovery Sequence

Use this when a deploy leaves the host in an uncertain state.

```bash
cd /home/meepo/meepo-bot
git fetch origin --prune
git fetch origin --force --tags
git checkout main
git reset --hard origin/main

rm -rf node_modules apps/web/node_modules apps/web/.next

npm ci
cd apps/web
npm ci
npm run build

cd /home/meepo/meepo-bot
/bin/bash deploy/ec2/auth-runtime-preflight.sh

sudo systemctl daemon-reload
sudo systemctl restart meepo-bot
sudo systemctl restart meepo-web

sudo systemctl is-active meepo-bot
sudo systemctl is-active meepo-web
curl -fsS http://127.0.0.1:3000
```

If service health is still failing, inspect recent journals.

```bash
sudo journalctl -u meepo-bot -n 200 --no-pager
sudo journalctl -u meepo-web -n 200 --no-pager
```

## Recovery Scenarios

### Corrupted Dependency Tree

Symptoms:
- `npm ci` fails unexpectedly after a previously working deploy.
- Module resolution errors appear even though lockfiles are unchanged.

Recovery:

```bash
cd /home/meepo/meepo-bot
rm -rf node_modules apps/web/node_modules
npm ci
cd apps/web
npm ci
```

### Stale Install Or Build Artifacts

Symptoms:
- Build behavior differs between identical commits.
- Old compiled output appears to survive a fresh deploy.

Recovery:

```bash
cd /home/meepo/meepo-bot
rm -rf node_modules apps/web/node_modules apps/web/.next
npm ci
cd apps/web
npm ci
npm run build
```

### Broken Next Build Cache

Symptoms:
- `next build` mismatch or stale asset behavior after a code change.
- Web deploy appears to finish but the served app does not reflect expected output.

Recovery:

```bash
cd /home/meepo/meepo-bot/apps/web
rm -rf .next
npm run build
```

### Environment Configuration Issues

Symptoms:
- Web service fails immediately after restart.
- Auth routing or callback behavior is inconsistent.
- Command deploy fails with missing Discord credentials.

Recovery:

```bash
test -f /etc/meepo/meepo-bot.env
test -f /etc/meepo/meepo-web.env
/bin/bash /home/meepo/meepo-bot/deploy/ec2/auth-runtime-preflight.sh
```

Then confirm required keys exist.

- Bot env: `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID` or `DISCORD_CLIENT_ID`
- Web env: `NODE_ENV`, `NEXTAUTH_URL`, `AUTH_URL`, `AUTH_TRUST_HOST`, `AUTH_SECRET`

### Command Manifest Mismatch

Symptoms:
- Discord does not expose the current repo command manifest.
- `/starstory showtime start` is missing expected options.

Recovery:

```bash
cd /home/meepo/meepo-bot
set -a
. /etc/meepo/meepo-bot.env
set +a
npm run deploy:commands
```

### Service Restart Failure

Symptoms:
- `systemctl is-active` returns non-zero.
- The health check passes for one service and fails for the other.

Recovery:

```bash
sudo systemctl restart meepo-bot
sudo systemctl restart meepo-web
sudo systemctl is-active meepo-bot
sudo systemctl is-active meepo-web
sudo journalctl -u meepo-bot -n 200 --no-pager
sudo journalctl -u meepo-web -n 200 --no-pager
```

## Escalation

Escalate if any of the following remain unresolved after the manual recovery sequence.

- Both services fail to restart cleanly.
- Auth preflight fails due to production env contract drift.
- Command deploy succeeds locally but production Discord manifests remain stale after propagation time.