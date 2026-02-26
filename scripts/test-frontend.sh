#!/usr/bin/env bash
set -euo pipefail

if [[ ! -x "frontend/node_modules/.bin/vitest" ]]; then
  echo "Installing frontend dependencies (vitest not found)..."
  npm --prefix frontend ci --no-audit --no-fund
fi

args=()
for arg in "$@"; do
  if [[ "$arg" == frontend/* ]]; then
    args+=("${arg#frontend/}")
  else
    args+=("$arg")
  fi
done

npm --prefix frontend run test -- "${args[@]}"
