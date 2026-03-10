#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/meepo/meepo-bot}"
BRANCH="${BRANCH:-main}"
BOT_SERVICE="${BOT_SERVICE:-meepo-bot}"
WEB_SERVICE="${WEB_SERVICE:-meepo-web}"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "[deploy] expected git repo at $APP_DIR"
  exit 1
fi

echo "[deploy] app_dir=$APP_DIR branch=$BRANCH"

cd "$APP_DIR"
git fetch --prune origin
git fetch --force --tags origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "[deploy] installing root dependencies"
npm ci

echo "[deploy] building web app"
cd "$APP_DIR/apps/web"
rm -rf .next
npm ci
NEXT_PUBLIC_APP_VERSION="$(git -C "$APP_DIR" describe --tags --abbrev=0 2>/dev/null || true)"
if [ -z "${NEXT_PUBLIC_APP_VERSION:-}" ]; then
  NEXT_PUBLIC_APP_VERSION="$(git -C "$APP_DIR" rev-parse --short HEAD)"
fi
export NEXT_PUBLIC_APP_VERSION
echo "[deploy] NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION"
npm run build

cd "$APP_DIR"

echo "[deploy] running auth runtime preflight"
/bin/bash "$APP_DIR/deploy/ec2/auth-runtime-preflight.sh"

echo "[deploy] reloading systemd"
sudo systemctl daemon-reload

echo "[deploy] restarting services"
sudo systemctl restart "$BOT_SERVICE"
sudo systemctl restart "$WEB_SERVICE"

echo "[deploy] waiting for service health"
sudo systemctl is-active --quiet "$BOT_SERVICE"
sudo systemctl is-active --quiet "$WEB_SERVICE"

echo "[deploy] done"
