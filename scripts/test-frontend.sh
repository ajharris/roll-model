#!/usr/bin/env bash
set -euo pipefail

args=()
for arg in "$@"; do
  if [[ "$arg" == frontend/* ]]; then
    args+=("${arg#frontend/}")
  else
    args+=("$arg")
  fi
done

npm --prefix frontend run test -- "${args[@]}"
