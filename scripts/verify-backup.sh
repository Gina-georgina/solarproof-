#!/usr/bin/env bash
#
# verify-backup.sh
#
# Restores the latest Supabase backup into a throwaway project and verifies
# data integrity via smoke queries. Measures restore duration and compares it
# against the RTO target. Exits non-zero (and sends an alert) on failure.
#
# Invoked by the verify-restore CI job (see .github/workflows/verify-restore.yml).
#
# Required environment variables:
#   S3_BUCKET            - S3 bucket holding backups
#   S3_PREFIX            - S3 key prefix for backups (e.g. "backups/")
#   THROWAWAY_DB_URL     - connection string for the throwaway Supabase project
#   SLACK_WEBHOOK_URL    - Slack incoming webhook URL for alerts
#
# Optional environment variables:
#   RTO_TARGET_SECONDS   - RTO target in seconds (default: 3600)
#   AWS_REGION           - AWS region for S3 (default: us-east-1)
#   MIN_READINGS_ROWS    - minimum expected readings rows (default: 1)
#   MIN_CERTIFICATES_ROWS- minimum expected certificates rows (default: 1)
#   MIN_METERS_ROWS      - minimum expected meters rows (default: 1)
#   EXPECTED_SCHEMA_VERSION - expected schema version (optional)
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
RTO_TARGET_SECONDS="${RTO_TARGET_SECONDS:-3600}"
AWS_REGION="${AWS_REGION:-us-east-1}"
MIN_READINGS_ROWS="${MIN_READINGS_ROWS:-1}"
MIN_CERTIFICATES_ROWS="${MIN_CERTIFICATES_ROWS:-1}"
MIN_METERS_ROWS="${MIN_METERS_ROWS:-1}"
EXPECTED_SCHEMA_VERSION="${EXPECTED_SCHEMA_VERSION:-}"

WORK_DIR="$(mktemp -d)"
BACKUP_FILE="${WORK_DIR}/latest-backup.dump"
RESTORE_START_EPOCH=""
RESTORE_DURATION_SECONDS=""

# ---------------------------------------------------------------------------
# Alerting (reuses the alert() pattern from backup-db.sh)
# ---------------------------------------------------------------------------
alert() {
  local message="$1"
  echo "[ALERT] ${message}" >&2

  if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
    local payload
    payload=$(printf '{"text":":rotating_light: Backup verification failed: %s"}' \
      "$(printf '%s' "${message}" | sed 's/\\/\\\\/g; s/"/\\"/g')")

    if ! curl -fsS -X POST \
      -H 'Content-Type: application/json' \
      --data "${payload}" \
      "${SLACK_WEBHOOK_URL}" >/dev/null; then
      echo "[ALERT] Failed to deliver Slack alert" >&2
    fi
  else
    echo "[ALERT] SLACK_WEBHOOK_URL not set; skipping Slack notification" >&2
  fi
}

cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

fail() {
  local message="$1"
  alert "${message}"
  exit 1
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail "Required environment variable ${name} is not set"
  fi
}

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------
require_env S3_BUCKET
require_env S3_PREFIX
require_env THROWAWAY_DB_URL

for bin in aws pg_restore psql; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    fail "Required binary '${bin}' not found in PATH"
  fi
done

echo "==> Backup verification starting"
echo "    RTO target: ${RTO_TARGET_SECONDS}s"

# ---------------------------------------------------------------------------
# 1. Fetch the latest backup object from S3
# ---------------------------------------------------------------------------
echo "==> Locating latest backup in s3://${S3_BUCKET}/${S3_PREFIX}"

LATEST_KEY="$(aws s3api list-objects-v2 \
  --bucket "${S3_BUCKET}" \
  --prefix "${S3_PREFIX}" \
  --region "${AWS_REGION}" \
  --query 'reverse(sort_by(Contents, &LastModified))[0].Key' \
  --output text 2>/dev/null || true)"

if [[ -z "${LATEST_KEY}" || "${LATEST_KEY}" == "None" ]]; then
  fail "No backup objects found in s3://${S3_BUCKET}/${S3_PREFIX}"
fi

echo "    Latest backup: ${LATEST_KEY}"

if ! aws s3 cp "s3://${S3_BUCKET}/${LATEST_KEY}" "${BACKUP_FILE}" \
  --region "${AWS_REGION}" --only-show-errors; then
  fail "Failed to download backup s3://${S3_BUCKET}/${LATEST_KEY}"
fi

if [[ ! -s "${BACKUP_FILE}" ]]; then
  fail "Downloaded backup file is empty: ${LATEST_KEY}"
fi

# ---------------------------------------------------------------------------
# 2. Validate the archive with pg_restore --list
# ---------------------------------------------------------------------------
echo "==> Validating archive with pg_restore --list"

if ! pg_restore --list "${BACKUP_FILE}" >/dev/null 2>"${WORK_DIR}/pg_restore_list.err"; then
  fail "pg_restore --list failed; archive is invalid: $(cat "${WORK_DIR}/pg_restore_list.err")"
fi

echo "    Archive is valid"

# ---------------------------------------------------------------------------
# 3. Restore into the throwaway Supabase project
# ---------------------------------------------------------------------------
echo "==> Restoring into throwaway project"

RESTORE_START_EPOCH="$(date +%s)"

# --clean --if-exists makes the restore idempotent against a reused project.
# --no-owner / --no-privileges avoid role mismatches on the throwaway project.
# --exit-on-error ensures a partial restore is treated as a failure.
if ! pg_restore \
  --dbname="${THROWAWAY_DB_URL}" \
  --clean --if-exists \
  --no-owner --no-privileges \
  --exit-on-error \
  "${BACKUP_FILE}" 2>"${WORK_DIR}/pg_restore.err"; then
  RESTORE_DURATION_SECONDS=$(( $(date +%s) - RESTORE_START_EPOCH ))
  fail "pg_restore failed after ${RESTORE_DURATION_SECONDS}s: $(tail -n 20 "${WORK_DIR}/pg_restore.err")"
fi

RESTORE_DURATION_SECONDS=$(( $(date +%s) - RESTORE_START_EPOCH ))
echo "    Restore completed in ${RESTORE_DURATION_SECONDS}s"

# ---------------------------------------------------------------------------
# 4. Smoke queries to verify data integrity
# ---------------------------------------------------------------------------
echo "==> Running smoke queries"

run_count() {
  local table="$1"
  psql "${THROWAWAY_DB_URL}" -tAq -v ON_ERROR_STOP=1 \
    -c "SELECT count(*) FROM ${table};" 2>"${WORK_DIR}/psql.err" || {
      fail "Smoke query failed for table '${table}': $(cat "${WORK_DIR}/psql.err")"
    }
}

check_min_rows() {
  local table="$1"
  local min_rows="$2"
  local count
  count="$(run_count "${table}")"
  count="${count//[[:space:]]/}"

  if ! [[ "${count}" =~ ^[0-9]+$ ]]; then
    fail "Unexpected row count for '${table}': '${count}'"
  fi

  echo "    ${table}: ${count} rows (min ${min_rows})"

  if (( count < min_rows )); then
    fail "Table '${table}' has ${count} rows, below minimum ${min_rows}"
  fi
}

check_min_rows readings "${MIN_READINGS_ROWS}"
check_min_rows certificates "${MIN_CERTIFICATES_ROWS}"
check_min_rows meters "${MIN_METERS_ROWS}"

# Schema version check (optional; only enforced when EXPECTED_SCHEMA_VERSION set)
SCHEMA_VERSION="$(psql "${THROWAWAY_DB_URL}" -tAq -v ON_ERROR_STOP=1 \
  -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;" \
  2>"${WORK_DIR}/psql.err" || true)"
SCHEMA_VERSION="${SCHEMA_VERSION//[[:space:]]/}"

if [[ -z "${SCHEMA_VERSION}" ]]; then
  fail "Could not read schema version from schema_migrations: $(cat "${WORK_DIR}/psql.err" 2>/dev/null || true)"
fi

echo "    schema version: ${SCHEMA_VERSION}"

if [[ -n "${EXPECTED_SCHEMA_VERSION}" && "${SCHEMA_VERSION}" != "${EXPECTED_SCHEMA_VERSION}" ]]; then
  fail "Schema version mismatch: expected ${EXPECTED_SCHEMA_VERSION}, got ${SCHEMA_VERSION}"
fi

# ---------------------------------------------------------------------------
# 5. Compare restore duration against RTO target
# ---------------------------------------------------------------------------
echo "==> Checking RTO target (${RTO_TARGET_SECONDS}s)"

if (( RESTORE_DURATION_SECONDS > RTO_TARGET_SECONDS )); then
  fail "Restore took ${RESTORE_DURATION_SECONDS}s, exceeding RTO target of ${RTO_TARGET_SECONDS}s"
fi

echo "==> Backup verification succeeded (restore ${RESTORE_DURATION_SECONDS}s <= RTO ${RTO_TARGET_SECONDS}s)"
exit 0