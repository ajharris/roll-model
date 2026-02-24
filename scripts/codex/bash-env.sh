#!/usr/bin/env bash

# Source this file in bash to enable a colored prompt with git branch info:
#   source scripts/codex/bash-env.sh

# Only apply to interactive bash shells.
[[ -n "${BASH_VERSION:-}" && $- == *i* ]] || return 0 2>/dev/null || exit 0

__codex_git_branch() {
  local branch

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 0
  fi

  branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  if [[ -z "${branch}" ]]; then
    branch="$(git rev-parse --short HEAD 2>/dev/null || true)"
  fi

  [[ -n "${branch}" ]] && printf ' (%s)' "${branch}"
}

__codex_prompt_command() {
  local exit_code=$?

  local c_reset='\[\e[0m\]'
  local c_userhost='\[\e[1;36m\]'
  local c_path='\[\e[1;34m\]'
  local c_git='\[\e[1;33m\]'
  local c_error='\[\e[1;31m\]'
  local c_ok='\[\e[1;32m\]'

  local status_color="${c_ok}"
  if [[ ${exit_code} -ne 0 ]]; then
    status_color="${c_error}"
  fi

  PS1="${status_color}[\${exit_code}]${c_reset} ${c_userhost}\u@\h${c_reset} ${c_path}\w${c_reset}${c_git}\$(__codex_git_branch)${c_reset}\n$ "
}

PROMPT_COMMAND="__codex_prompt_command"
