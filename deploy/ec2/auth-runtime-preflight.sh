#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/meepo/meepo-bot}"
WEB_ENV_FILE="${WEB_ENV_FILE:-/etc/meepo/meepo-web.env}"
WEB_UNIT="${WEB_UNIT:-meepo-web}"
CANONICAL_ORIGIN="https://meepo.online"

echo "[preflight] app dir: $APP_DIR"
echo "[preflight] env file: $WEB_ENV_FILE"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "[preflight] ERROR: missing git repo at $APP_DIR" >&2
  exit 1
fi

if [ ! -f "$WEB_ENV_FILE" ]; then
  echo "[preflight] ERROR: missing env file: $WEB_ENV_FILE" >&2
  exit 1
fi

echo "[preflight] deployed revision"
git -C "$APP_DIR" rev-parse --abbrev-ref HEAD
git -C "$APP_DIR" rev-parse HEAD

echo "[preflight] validating systemd env source"
systemctl cat "$WEB_UNIT" | grep -q "EnvironmentFile=$WEB_ENV_FILE"

echo "[preflight] required env keys"
grep -E "^(NODE_ENV|NEXTAUTH_URL|AUTH_URL|AUTH_TRUST_HOST|AUTH_SECRET|DEV_WEB_BYPASS)=" "$WEB_ENV_FILE"

echo "[preflight] canonical env assertions"
grep -q "^NODE_ENV=production$" "$WEB_ENV_FILE"
grep -q "^NEXTAUTH_URL=$CANONICAL_ORIGIN$" "$WEB_ENV_FILE"
grep -q "^AUTH_URL=$CANONICAL_ORIGIN$" "$WEB_ENV_FILE"
grep -q "^AUTH_TRUST_HOST=true$" "$WEB_ENV_FILE"
if grep -q "^DEV_WEB_BYPASS=1$" "$WEB_ENV_FILE"; then
  echo "[preflight] ERROR: DEV_WEB_BYPASS must be 0 in production" >&2
  exit 1
fi
if grep -q "^AUTH_SECRET=$" "$WEB_ENV_FILE"; then
  echo "[preflight] ERROR: AUTH_SECRET cannot be empty" >&2
  exit 1
fi

echo "[preflight] checking active nginx vhosts"
ls -1 /etc/nginx/sites-enabled || true

echo "[preflight] checking clean web build artifacts"
if [ -d "$APP_DIR/apps/web/.next" ]; then
  echo "[preflight] note: .next exists on disk (expected post-build), ensure deploy script performs rm -rf .next before build"
else
  echo "[preflight] note: .next directory not present"
fi

echo "[preflight] completed successfully"
