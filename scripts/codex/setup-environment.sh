#!/usr/bin/env bash
set -euo pipefail

resolve_remote_url() {
  local url=""

  for candidate in "${CODEX_GIT_REMOTE_URL:-}" "${CODEX_REMOTE_URL:-}" "${GIT_REMOTE_URL:-}" "${REPOSITORY_URL:-}"; do
    if [[ -n "${candidate}" ]]; then
      url="${candidate}"
      break
    fi
  done

  if [[ -z "${url}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
    local server_url="${GITHUB_SERVER_URL:-https://github.com}"
    url="${server_url%/}/${GITHUB_REPOSITORY}.git"
  fi

  printf '%s' "${url}"
}

main() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "Not a git repository; skipping remote setup."
    return 0
  fi

  local remote_url
  remote_url="$(resolve_remote_url)"

  if [[ -z "${remote_url}" ]]; then
    echo "No remote URL found in environment; skipping remote setup."
    return 0
  fi

  if git remote get-url origin >/dev/null 2>&1; then
    local existing_url
    existing_url="$(git remote get-url origin)"

    if [[ "${existing_url}" == "${remote_url}" ]]; then
      echo "Origin remote already configured: ${existing_url}"
      return 0
    fi

    git remote set-url origin "${remote_url}"
    echo "Updated origin remote to ${remote_url}"
    return 0
  fi

  git remote add origin "${remote_url}"
  echo "Added origin remote: ${remote_url}"
}

main "$@"
