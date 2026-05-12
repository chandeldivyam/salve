-- Move Atlas credentials off-public so Zero's `FOR TABLES IN SCHEMA public`
-- replication never sees them. See packages/db/src/schema/migration.ts header
-- for why a separate schema beats column-list publications here.
CREATE SCHEMA IF NOT EXISTS "secrets";
--> statement-breakpoint
CREATE TABLE "secrets"."migration_credential" (
	"run_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"api_key" text NOT NULL,
	"base_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secrets"."migration_webhook_credential" (
	"subscription_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"signing_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Backfill from the soon-to-be-dropped sources before we strip the columns.
-- has_api_key remains as the UI-safe presence flag.
INSERT INTO "secrets"."migration_credential" (run_id, workspace_id, api_key, base_url)
SELECT id, workspace_id, params ->> 'apiKey', params ->> 'baseUrl'
FROM "migration_run"
WHERE has_api_key = true
  AND params ? 'apiKey'
  AND (params ->> 'apiKey') IS NOT NULL
  AND (params ->> 'apiKey') <> ''
ON CONFLICT (run_id) DO NOTHING;
--> statement-breakpoint
UPDATE "migration_run"
SET params = params - 'apiKey' - 'baseUrl'
WHERE has_api_key = true;
--> statement-breakpoint
INSERT INTO "secrets"."migration_webhook_credential" (subscription_id, workspace_id, signing_secret)
SELECT id, workspace_id, signing_secret
FROM "migration_webhook_subscription"
WHERE signing_secret IS NOT NULL AND signing_secret <> ''
ON CONFLICT (subscription_id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE "migration_webhook_subscription" DROP COLUMN "signing_secret";
