# Known Deploy Failures

Date: 2026-03-14

This catalog lists common production deploy failures, how they present, and the verified operator response.

## Dependency Tree Corruption

Symptom:
- `npm ci` fails in root or `apps/web` after otherwise normal git sync.

Likely cause:
- Stale `node_modules` state conflicts with the expected lockfile tree.

Recovery:

```bash
cd /home/meepo/meepo-bot
rm -rf node_modules apps/web/node_modules
npm ci
cd apps/web
npm ci
```

## Stale Install Artifacts

Symptom:
- A commit that should be reproducible deploys differently from a previous deployment.

Likely cause:
- Leftover directories or ignored artifacts survived a prior deploy.

Recovery:

```bash
cd /home/meepo/meepo-bot
git clean -ffd
rm -rf node_modules apps/web/node_modules apps/web/.next
npm ci
cd apps/web
npm ci
```

## Broken Next Build Cache

Symptom:
- `next build` mismatch, stale assets, or a web bundle that does not match the checked-out commit.

Likely cause:
- `.next` contains stale build output from a prior run.

Recovery:

```bash
cd /home/meepo/meepo-bot/apps/web
rm -rf .next
npm run build
```

## Missing Lockfile

Symptom:
- Install fails immediately because `package-lock.json` is absent.

Likely cause:
- Incomplete checkout, incorrect branch state, or accidental repository drift.

Recovery:

```bash
cd /home/meepo/meepo-bot
git fetch origin --prune
git checkout main
git reset --hard origin/main
test -f package-lock.json
test -f apps/web/package-lock.json
```

## Disk Pressure During Install Or Build

Symptom:
- `npm ci` or `npm run build` fails with extraction, write, or ENOSPC-style errors.

Likely cause:
- Insufficient free space on the root filesystem.

Recovery:

```bash
df -Pk /
cd /home/meepo/meepo-bot
rm -rf node_modules apps/web/node_modules apps/web/.next
```

Free space must be restored before retrying install/build.

## Web Env Contract Drift

Symptom:
- Web service starts incorrectly, OAuth callbacks break, or auth preflight fails.

Likely cause:
- `/etc/meepo/meepo-web.env` is missing required production values.

Recovery:

```bash
/bin/bash /home/meepo/meepo-bot/deploy/ec2/auth-runtime-preflight.sh
grep -E "^(NODE_ENV|NEXTAUTH_URL|AUTH_URL|AUTH_TRUST_HOST|AUTH_SECRET|DEV_WEB_BYPASS)=" /etc/meepo/meepo-web.env
```

## Bot Env Missing Discord Deploy Inputs

Symptom:
- `npm run deploy:commands` fails with missing application ID or token errors.

Likely cause:
- `/etc/meepo/meepo-bot.env` is missing `DISCORD_TOKEN` or `DISCORD_APPLICATION_ID`.

Recovery:

```bash
grep -E "^(DISCORD_TOKEN|DISCORD_APPLICATION_ID|DISCORD_CLIENT_ID)=" /etc/meepo/meepo-bot.env
cd /home/meepo/meepo-bot
set -a
. /etc/meepo/meepo-bot.env
set +a
npm run deploy:commands
```

## Service Restart Failure

Symptom:
- One or both units fail health checks after deploy.

Likely cause:
- Invalid env, startup regression, or dependency/build mismatch.

Recovery:

```bash
sudo systemctl restart meepo-bot
sudo systemctl restart meepo-web
sudo journalctl -u meepo-bot -n 200 --no-pager
sudo journalctl -u meepo-web -n 200 --no-pager
```

## Command Manifest Mismatch

Symptom:
- Production Discord commands do not match the current repo manifest even though app deploy succeeded.

Likely cause:
- Command deploy step failed, env was incomplete, or Discord propagation has not completed yet.

Recovery:

```bash
cd /home/meepo/meepo-bot
set -a
. /etc/meepo/meepo-bot.env
set +a
npm run deploy:commands
```

Then validate `/starstory showtime start` and allow for global propagation delay.