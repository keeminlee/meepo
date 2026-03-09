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
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "[deploy] installing root dependencies"
npm ci

echo "[deploy] building web app"
cd "$APP_DIR/apps/web"
rm -rf .next
npm ci
export NEXT_PUBLIC_APP_VERSION="$(git -C "$APP_DIR" describe --tags --abbrev=0)"
echo "[deploy] NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION"
npm run build

cd "$APP_DIR"

echo "[deploy] reloading systemd"
sudo systemctl daemon-reload

echo "[deploy] restarting services"
sudo systemctl restart "$BOT_SERVICE"
sudo systemctl restart "$WEB_SERVICE"

echo "[deploy] waiting for service health"
sudo systemctl is-active --quiet "$BOT_SERVICE"
sudo systemctl is-active --quiet "$WEB_SERVICE"

echo "[deploy] done"
