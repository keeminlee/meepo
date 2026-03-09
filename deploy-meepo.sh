#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-main}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd git
require_cmd npm
require_cmd curl
require_cmd systemctl

if ! sudo -n true >/dev/null 2>&1; then
  echo "sudo must be passwordless for deploy user (required for systemctl restart)." >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "[deploy] syncing repository to origin/$BRANCH"
git fetch origin --prune
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
git clean -fd

echo "[deploy] installing root dependencies"
npm ci --no-audit --no-fund

echo "[deploy] building web app"
cd "$WEB_DIR"
npm ci --no-audit --no-fund
rm -rf .next
npm run build

cd "$ROOT_DIR"

echo "[deploy] reloading systemd and restarting services"
sudo systemctl daemon-reload
sudo systemctl restart meepo-web
sudo systemctl restart meepo-bot

echo "[deploy] validating service health"
wait_for_active() {
  local unit="$1"
  local attempts="${2:-20}"
  local delay_secs="${3:-1}"

  for ((i=1; i<=attempts; i++)); do
    if sudo systemctl is-active --quiet "$unit"; then
      return 0
    fi
    sleep "$delay_secs"
  done

  echo "$unit is not active" >&2
  sudo journalctl -u "$unit" -n 200 --no-pager || true
  return 1
}

wait_for_http() {
  local url="$1"
  local attempts="${2:-30}"
  local delay_secs="${3:-1}"

  for ((i=1; i<=attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay_secs"
  done

  echo "Web health check failed at $url" >&2
  return 1
}

wait_for_active meepo-web
wait_for_active meepo-bot
wait_for_http http://127.0.0.1:3000

echo "[deploy] success: $BRANCH deployed"