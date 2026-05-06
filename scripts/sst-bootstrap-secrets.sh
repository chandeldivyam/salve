#!/usr/bin/env bash
# Push runtime secrets into SST's per-stage secret store.
#
# Reads the local root .env (gitignored) and AUTH_SECRET from $AUTH_SECRET
# (or generates a fresh one if unset). Idempotent — safe to re-run.
#
# Usage:
#   STAGE=prod bash scripts/sst-bootstrap-secrets.sh
#   STAGE=staging bash scripts/sst-bootstrap-secrets.sh
#
# Never log secret values. We use `pnpm sst secret set` which writes to SSM
# without echoing to stdout.

set -euo pipefail

STAGE="${STAGE:-prod}"
echo "Bootstrapping secrets for stage: $STAGE"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# AUTH_SECRET / ZERO_AUTH_SECRET — same value, used by Hono + Zero. Auto-generate
# if AUTH_SECRET isn't set in the env. To rotate, unset locally and re-run.
# Idempotent generate-or-keep helper. If $env_name is set in the env, push it
# verbatim; otherwise check if SSM already holds a value (keep it) and only
# generate fresh if neither applies. Stops us from rotating live secrets on
# every script run.
ensure_generated() {
  local secret_name="$1"
  local env_name="$2"
  local provided="${!env_name:-}"
  if [ -n "$provided" ]; then
    pnpm sst secret set "$secret_name" "$provided" --stage "$STAGE" >/dev/null
    echo "$secret_name: from env"
    return
  fi
  if pnpm sst secret list --stage "$STAGE" 2>/dev/null | grep -q "^$secret_name="; then
    echo "$secret_name: already set, keeping"
    return
  fi
  local generated
  generated="$(openssl rand -hex 32)"
  pnpm sst secret set "$secret_name" "$generated" --stage "$STAGE" >/dev/null
  echo "$secret_name: generated"
}

ensure_generated AuthSecret AUTH_SECRET
ensure_generated ZeroAdminPassword ZERO_ADMIN_PASSWORD

set_if_present() {
  local secret_name="$1"
  local env_name="$2"
  local val="${!env_name:-}"
  if [ -n "$val" ]; then
    pnpm sst secret set "$secret_name" "$val" --stage "$STAGE" >/dev/null
    echo "$secret_name: set"
  else
    echo "$secret_name: skipped (env $env_name not set)"
  fi
}

set_if_present InngestEventKey   INNGEST_EVENT_KEY
set_if_present InngestSigningKey INNGEST_SIGNING_KEY
set_if_present InngestApiKey     INNGEST_API_KEY
set_if_present GoogleClientId    GOOGLE_CLIENT_ID
set_if_present GoogleClientSecret GOOGLE_CLIENT_SECRET
set_if_present SesWebhookSecret  SES_WEBHOOK_SECRET

echo "Done."
