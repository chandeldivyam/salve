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
if [ -z "${AUTH_SECRET:-}" ]; then
  AUTH_SECRET="$(openssl rand -hex 32)"
  echo "AuthSecret: generated"
else
  echo "AuthSecret: from env"
fi
pnpm sst secret set AuthSecret "$AUTH_SECRET" --stage "$STAGE" >/dev/null
echo "AuthSecret: set"

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
