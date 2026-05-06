#!/usr/bin/env bash
# Trigger an Inngest Cloud app sync after a deploy.
#
# Inngest Cloud needs to know the public serve URL so it can read the function
# manifest. Without this step, functions register lazily on first event but
# the dashboard shows nothing until then. Fast + idempotent.
#
# Usage:
#   STAGE=prod bash scripts/inngest-sync.sh
#   STAGE=staging bash scripts/inngest-sync.sh
#
# Requires INNGEST_API_KEY in the env (the management API token, not the SDK
# event/signing keys). In CI, this comes from a GitHub secret.

set -euo pipefail

STAGE="${STAGE:-prod}"

case "$STAGE" in
  prod)
    URL="https://api.usesalve.com/api/inngest"
    ;;
  staging)
    URL="https://api-staging.usesalve.com/api/inngest"
    ;;
  *)
    echo "Unknown stage: $STAGE" >&2
    exit 1
    ;;
esac

if [ -z "${INNGEST_API_KEY:-}" ]; then
  echo "INNGEST_API_KEY not set in env" >&2
  exit 1
fi

# App ID matches the Inngest client id in apps/api/src/inngest/client.ts.
APP_ID="${INNGEST_APP_ID:-salve}"

echo "Syncing Inngest Cloud app=$APP_ID with $URL..."
RESPONSE=$(curl -fsSL --show-error -X POST \
  -H "Authorization: Bearer $INNGEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$URL\"}" \
  "https://api.inngest.com/v2/apps/$APP_ID/syncs" 2>&1) || {
    echo "Sync failed:" >&2
    echo "$RESPONSE" >&2
    exit 1
  }
# Print response body but never log the API key value.
echo "$RESPONSE"
echo "Sync OK."
