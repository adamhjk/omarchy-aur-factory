#!/usr/bin/env bash
# Idempotent factory setup: runs the @omarchy/factory-setup converge model.
# Re-run until it reports passed with nothing missing. `./setup.sh --deep`
# additionally builds and vets the generated seed package end-to-end.
set -euo pipefail
cd "$(dirname "$0")/swamp"

if ! command -v swamp >/dev/null 2>&1; then
  echo "swamp is not installed. Install it first:" >&2
  echo "  curl -fsSL https://swamp-club.com/install.sh | sh" >&2
  exit 1
fi

deep=()
if [[ "${1:-}" == "--deep" ]]; then
  deep=(--input deep=true)
fi

swamp model @omarchy/factory-setup method run converge setup "${deep[@]}"

echo
echo "Convergence evidence (re-run ./setup.sh after fixing anything marked missing):"
swamp data get setup setup
