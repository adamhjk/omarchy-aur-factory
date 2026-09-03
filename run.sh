#!/usr/bin/env bash
# Starts the package-request web UI on http://localhost:3000.
# The app has no authentication and its API executes swamp commands —
# bind beyond localhost only on a network you trust:
#   HOST=0.0.0.0 ./run.sh
set -euo pipefail
cd "$(dirname "$0")/app/omarchy-package-request"

if [[ ! -d node_modules ]]; then
  echo "node_modules missing — run ./setup.sh first." >&2
  exit 1
fi

exec npm run dev -- -H "${HOST:-localhost}"
