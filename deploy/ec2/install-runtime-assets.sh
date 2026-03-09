#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/meepo/meepo-bot}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
ENV_DIR="${ENV_DIR:-/etc/meepo}"

if [ ! -d "$APP_DIR" ]; then
  echo "[install] app dir missing: $APP_DIR"
  exit 1
fi

echo "[install] creating env dir: $ENV_DIR"
sudo mkdir -p "$ENV_DIR"

echo "[install] installing systemd units"
sudo install -m 0644 "$APP_DIR/deploy/systemd/meepo-bot.service" "$SYSTEMD_DIR/meepo-bot.service"
sudo install -m 0644 "$APP_DIR/deploy/systemd/meepo-web.service" "$SYSTEMD_DIR/meepo-web.service"

echo "[install] installing deploy hook"
sudo install -m 0755 "$APP_DIR/deploy/ec2/deploy-meepo.sh" /usr/local/bin/deploy-meepo

echo "[install] writing env templates (non-destructive)"
if [ ! -f "$ENV_DIR/meepo-bot.env" ]; then
  sudo install -m 0600 "$APP_DIR/deploy/env/meepo-bot.env.example" "$ENV_DIR/meepo-bot.env"
fi
if [ ! -f "$ENV_DIR/meepo-web.env" ]; then
  sudo install -m 0600 "$APP_DIR/deploy/env/meepo-web.env.example" "$ENV_DIR/meepo-web.env"
fi

echo "[install] reloading and enabling services"
sudo systemctl daemon-reload
sudo systemctl enable meepo-bot
sudo systemctl enable meepo-web

echo "[install] complete"
