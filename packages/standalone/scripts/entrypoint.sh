#!/bin/bash
set -euo pipefail

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

ARGS=("$@")

if is_truthy "${SKIP_SETUP:-}"; then
  if [[ ! " ${ARGS[*]} " =~ " --skip-setup " ]]; then
    ARGS+=("--skip-setup")
  fi
fi

echo "Starting server..."
exec bun run ./dist/app.js "${ARGS[@]}"
