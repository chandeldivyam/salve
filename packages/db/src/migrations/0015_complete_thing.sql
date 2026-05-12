CREATE TABLE "migration_event_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text,
	"source" text NOT NULL,
	"subscription_id" text,
	"event_type" text NOT NULL,
	"delivery_key" text NOT NULL,
	"atlas_timestamp" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"error_kind" text
);
--> statement-breakpoint
CREATE TABLE "migration_webhook_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text,
	"source" text NOT NULL,
	"event" text NOT NULL,
	"remote_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"signing_secret" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "migration_run" ADD COLUMN "has_api_key" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "migration_event_inbox" ADD CONSTRAINT "migration_event_inbox_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_webhook_subscription" ADD CONSTRAINT "migration_webhook_subscription_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "migration_event_inbox_dedup" ON "migration_event_inbox" USING btree ("workspace_id","delivery_key");--> statement-breakpoint
CREATE INDEX "migration_event_inbox_pending" ON "migration_event_inbox" USING btree ("workspace_id","processed_at") WHERE processed_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "migration_webhook_sub_unique" ON "migration_webhook_subscription" USING btree ("workspace_id","source","event");--> statement-breakpoint
CREATE INDEX "migration_eim_imported_ticket_gate_idx" ON "migration_external_id_map" USING btree ("workspace_id","entity_type","target_id");