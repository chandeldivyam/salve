CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Partial index: the only queue scan we ever do is "rows not yet processed".
-- drizzle-kit 0.31 doesn't expose partial indexes natively; declare it raw.
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("processed_at") WHERE "processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_workspace_idx" ON "outbox" USING btree ("workspace_id","created_at");