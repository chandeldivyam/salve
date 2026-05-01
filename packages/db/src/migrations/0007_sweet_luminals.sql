CREATE TYPE "public"."customer_note_object_type" AS ENUM('customer', 'ticket');--> statement-breakpoint
CREATE TABLE "custom_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'api' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text
);
--> statement-breakpoint
CREATE TABLE "customer_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"object_type" "customer_note_object_type" NOT NULL,
	"object_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"body_html" text NOT NULL,
	"body_text" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_by_id" text NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "first_seen_at" timestamp with time zone;--> statement-breakpoint
UPDATE "customer" SET "first_seen_at" = "created_at" WHERE "first_seen_at" IS NULL;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_event" ADD CONSTRAINT "custom_event_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_event" ADD CONSTRAINT "custom_event_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_note" ADD CONSTRAINT "customer_note_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_note" ADD CONSTRAINT "customer_note_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_note" ADD CONSTRAINT "customer_note_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_event_customer_idx" ON "custom_event" USING btree ("workspace_id","customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "custom_event_workspace_idx" ON "custom_event" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "custom_event_name_idx" ON "custom_event" USING btree ("workspace_id","event_name");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_event_idem_idx" ON "custom_event" USING btree ("workspace_id","idempotency_key") WHERE "custom_event"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "customer_note_customer_idx" ON "customer_note" USING btree ("workspace_id","customer_id","deleted_at","created_at");--> statement-breakpoint
CREATE INDEX "customer_note_object_idx" ON "customer_note" USING btree ("workspace_id","object_type","object_id");
