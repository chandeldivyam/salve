CREATE TYPE "public"."migration_run_status" AS ENUM('pending', 'discovering', 'backfilling', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "migration_external_id_map" (
	"workspace_id" text NOT NULL,
	"source" text NOT NULL,
	"entity_type" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text NOT NULL,
	"run_id" text,
	"payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_run" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source" text NOT NULL,
	"status" "migration_run_status" DEFAULT 'pending' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "migration_external_id_map" ADD CONSTRAINT "migration_external_id_map_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_run" ADD CONSTRAINT "migration_run_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "migration_eim_pk" ON "migration_external_id_map" USING btree ("workspace_id","source","entity_type","source_id");--> statement-breakpoint
CREATE INDEX "migration_eim_target_idx" ON "migration_external_id_map" USING btree ("workspace_id","source","entity_type","target_id");--> statement-breakpoint
CREATE INDEX "migration_run_workspace_idx" ON "migration_run" USING btree ("workspace_id","started_at");