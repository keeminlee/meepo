#!/usr/bin/env bash
set -euo pipefail

# DEPRECATED
# Use deploy/ec2/deploy-meepo.sh as the canonical production deploy entrypoint.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$#" -gt 0 ]; then
  export BRANCH="$1"
  shift
fi

echo "[deploy] DEPRECATED: forwarding to deploy/ec2/deploy-meepo.sh" >&2
exec /bin/bash "$ROOT_DIR/deploy/ec2/deploy-meepo.sh" "$@"