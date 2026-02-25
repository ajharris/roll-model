#!/usr/bin/env bash
set -euo pipefail

APP_ID="${AMPLIFY_APP_ID:-d15hzi11jeckui}"
BRANCH_NAME="${AMPLIFY_BRANCH_NAME:-main}"
AWS_REGION="${AMPLIFY_REGION:-ca-central-1}"
SITE_URL="${AMPLIFY_SITE_URL:-}"
START_JOB=1
JOB_ID="${AMPLIFY_JOB_ID:-}"
POLL_SECONDS="${AMPLIFY_POLL_SECONDS:-15}"
LOG_LOOKBACK_MINUTES="${AMPLIFY_LOG_LOOKBACK_MINUTES:-30}"
LOG_MAX_ITEMS="${AMPLIFY_LOG_MAX_ITEMS:-200}"

usage() {
  cat <<'EOF'
Usage: bash scripts/amplify-release-debug.sh [options]

Options:
  --app-id ID           Amplify app id (default: env AMPLIFY_APP_ID or d15hzi11jeckui)
  --branch NAME         Amplify branch name (default: env AMPLIFY_BRANCH_NAME or main)
  --region REGION       AWS region for Amplify/CloudWatch (default: env AMPLIFY_REGION or ca-central-1)
  --site-url URL        Full site URL (default: https://<branch>.<app-id>.amplifyapp.com)
  --job-id ID           Attach to an existing job id instead of starting one
  --no-start            Do not start a release job; attach to newest running/pending job
  --poll-seconds N      Poll interval while waiting for job (default: 15)
  --log-lookback-min N  CloudWatch lookback window in minutes (default: 30)
  --help                Show this help

Examples:
  bash scripts/amplify-release-debug.sh
  bash scripts/amplify-release-debug.sh --no-start
  bash scripts/amplify-release-debug.sh --job-id 71
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-id)
      APP_ID="$2"
      shift 2
      ;;
    --branch)
      BRANCH_NAME="$2"
      shift 2
      ;;
    --region)
      AWS_REGION="$2"
      shift 2
      ;;
    --site-url)
      SITE_URL="$2"
      shift 2
      ;;
    --job-id)
      JOB_ID="$2"
      START_JOB=0
      shift 2
      ;;
    --no-start)
      START_JOB=0
      shift
      ;;
    --poll-seconds)
      POLL_SECONDS="$2"
      shift 2
      ;;
    --log-lookback-min|--log-lookback-minutes)
      LOG_LOOKBACK_MINUTES="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

for cmd in aws curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
done

if [[ -z "$SITE_URL" ]]; then
  SITE_URL="https://${BRANCH_NAME}.${APP_ID}.amplifyapp.com"
fi

LOG_GROUP_NAME="/aws/amplify/${APP_ID}"

echo "Amplify app:    ${APP_ID}"
echo "Branch:         ${BRANCH_NAME}"
echo "Region:         ${AWS_REGION}"
echo "Site URL:       ${SITE_URL}"
echo "CloudWatch log: ${LOG_GROUP_NAME}"

aws_amplify() {
  aws amplify --region "$AWS_REGION" "$@"
}

aws_logs() {
  aws logs --region "$AWS_REGION" "$@"
}

list_recent_jobs() {
  aws_amplify list-jobs \
    --app-id "$APP_ID" \
    --branch-name "$BRANCH_NAME" \
    --max-results 10 \
    --query "jobSummaries[].{id:jobId,status:status,start:startTime,end:endTime}" \
    --output table || true
}

find_active_job_id() {
  aws_amplify list-jobs \
    --app-id "$APP_ID" \
    --branch-name "$BRANCH_NAME" \
    --max-results 20 \
    --query "jobSummaries[?status=='RUNNING' || status=='PENDING'] | [0].jobId" \
    --output text
}

start_release_job() {
  local out rc
  set +e
  out="$(aws_amplify start-job \
    --app-id "$APP_ID" \
    --branch-name "$BRANCH_NAME" \
    --job-type RELEASE \
    --query "jobSummary.jobId" \
    --output text 2>&1)"
  rc=$?
  set -e

  if [[ $rc -eq 0 ]]; then
    echo "$out"
    return 0
  fi

  if grep -q "already have pending or running jobs" <<<"$out"; then
    echo "Amplify reports an existing pending/running job; attaching to it." >&2
    find_active_job_id
    return 0
  fi

  echo "$out" >&2
  return "$rc"
}

get_job_status() {
  aws_amplify get-job \
    --app-id "$APP_ID" \
    --branch-name "$BRANCH_NAME" \
    --job-id "$1" \
    --query "job.summary.status" \
    --output text
}

print_job_summary() {
  aws_amplify get-job \
    --app-id "$APP_ID" \
    --branch-name "$BRANCH_NAME" \
    --job-id "$1" \
    --query "job.summary.{id:jobId,status:status,commit:commitId,start:startTime,end:endTime}" \
    --output table || true
}

wait_for_job() {
  local job_id="$1"
  local status elapsed start_epoch
  start_epoch="$(date +%s)"

  while true; do
    status="$(get_job_status "$job_id" || echo UNKNOWN)"
    elapsed=$(( $(date +%s) - start_epoch ))
    echo "Job ${job_id} status: ${status} (${elapsed}s)"

    case "$status" in
      SUCCEED|FAILED|CANCELLED)
        break
        ;;
      RUNNING|PENDING)
        sleep "$POLL_SECONDS"
        ;;
      *)
        sleep "$POLL_SECONDS"
        ;;
    esac
  done

  echo
  echo "Final job summary:"
  print_job_summary "$job_id"

  [[ "$status" == "SUCCEED" ]]
}

http_probe() {
  local label="$1"
  local url="$2"
  local body_file headers_file code
  body_file="$(mktemp)"
  headers_file="$(mktemp)"

  set +e
  code="$(curl -sS -L -o "$body_file" -D "$headers_file" -w '%{http_code}' "$url")"
  local rc=$?
  set -e

  echo
  echo "== ${label} =="
  echo "URL: ${url}"

  if [[ $rc -ne 0 ]]; then
    echo "curl failed with exit code ${rc}"
    rm -f "$body_file" "$headers_file"
    return 1
  fi

  echo "HTTP: ${code}"
  grep -iE '^(content-type|x-powered-by|x-cache|x-amz-cf-id|etag):' "$headers_file" || true

  if [[ "$code" != "200" ]]; then
    echo "--- body (first 40 lines) ---"
    sed -n '1,40p' "$body_file"
  elif [[ "$label" == "/api/env" ]]; then
    if command -v jq >/dev/null 2>&1; then
      jq . "$body_file" || cat "$body_file"
    else
      cat "$body_file"
    fi
  fi

  rm -f "$body_file" "$headers_file"
  [[ "$code" == "200" ]]
}

print_recent_logs() {
  local start_ms log_json now_epoch
  now_epoch="$(date +%s)"
  start_ms=$(( (now_epoch - (LOG_LOOKBACK_MINUTES * 60)) * 1000 ))
  log_json="$(mktemp)"

  echo
  echo "== Recent CloudWatch logs (${LOG_LOOKBACK_MINUTES} min) =="
  if ! aws_logs filter-log-events \
    --log-group-name "$LOG_GROUP_NAME" \
    --start-time "$start_ms" \
    --max-items "$LOG_MAX_ITEMS" \
    --output json >"$log_json" 2>/dev/null; then
    echo "Could not fetch CloudWatch logs from ${LOG_GROUP_NAME}."
    rm -f "$log_json"
    return 0
  fi

  if command -v jq >/dev/null 2>&1; then
    local event_count
    event_count="$(jq '.events | length' "$log_json" 2>/dev/null || echo 0)"
    echo "Events fetched: ${event_count}"
    jq -r '.events[].message' "$log_json" 2>/dev/null \
      | sed 's/\r//g' \
      | grep -E 'FrontendConfigError|Starting request using compute deployment_id|START RequestId|REPORT RequestId|NEXT_PUBLIC_' \
      | tail -n 40 || true

    local latest_deployment
    latest_deployment="$(
      jq -r '.events[].message' "$log_json" 2>/dev/null \
        | sed -n 's/.*compute deployment_id: \([^ ]*\) .*/\1/p' \
        | tail -n 1
    )"
    if [[ -n "$latest_deployment" ]]; then
      echo "Latest deployment_id seen in logs: ${latest_deployment}"
    fi
  else
    echo "jq not found; showing raw text summary."
    aws_logs filter-log-events \
      --log-group-name "$LOG_GROUP_NAME" \
      --start-time "$start_ms" \
      --max-items 50 \
      --query "events[].message" \
      --output text | tr '\t' '\n' | tail -n 40 || true
  fi

  rm -f "$log_json"
}

echo
echo "Recent jobs:"
list_recent_jobs

if [[ -z "$JOB_ID" ]]; then
  if [[ "$START_JOB" -eq 1 ]]; then
    echo
    echo "Starting Amplify RELEASE job..."
    JOB_ID="$(start_release_job)"
  else
    echo
    echo "Looking for existing RUNNING/PENDING job..."
    JOB_ID="$(find_active_job_id)"
  fi
fi

if [[ -z "$JOB_ID" || "$JOB_ID" == "None" ]]; then
  echo "No job id available (no active job found, and no new job started)." >&2
  exit 1
fi

echo "Using job id: ${JOB_ID}"

JOB_OK=0
if wait_for_job "$JOB_ID"; then
  JOB_OK=1
else
  JOB_OK=0
fi

ts="$(date +%s)"
ROOT_OK=0
API_ENV_OK=0

if http_probe "/api/env" "${SITE_URL}/api/env?cachebust=${ts}"; then
  API_ENV_OK=1
fi

if http_probe "/" "${SITE_URL}/?cachebust=${ts}"; then
  ROOT_OK=1
fi

print_recent_logs

echo
echo "== Summary =="
echo "Amplify job ${JOB_ID}: $([[ $JOB_OK -eq 1 ]] && echo SUCCEED || echo NOT_SUCCEED)"
echo "/api/env:         $([[ $API_ENV_OK -eq 1 ]] && echo OK || echo FAIL)"
echo "/:                $([[ $ROOT_OK -eq 1 ]] && echo OK || echo FAIL)"

if [[ $JOB_OK -eq 1 && $ROOT_OK -eq 1 ]]; then
  exit 0
fi

exit 1
