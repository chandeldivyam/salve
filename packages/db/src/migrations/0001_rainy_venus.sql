CREATE TYPE "public"."message_author_type" AS ENUM('customer', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'in_progress', 'snoozed', 'resolved', 'closed');--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"message_id" uuid NOT NULL,
	"s3_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"actor_id" text,
	"kind" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_type" "message_author_type" NOT NULL,
	"author_user_id" text,
	"author_customer_id" uuid,
	"body_html" text NOT NULL,
	"body_text" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"short_id" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'normal' NOT NULL,
	"customer_id" uuid,
	"assignee_id" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_author_customer_id_customer_id_fk" FOREIGN KEY ("author_customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_message_idx" ON "attachment" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "audit_event_ticket_created_idx" ON "audit_event" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_workspace_email_idx" ON "customer" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_workspace_email_unique" ON "customer" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE INDEX "message_ticket_created_idx" ON "message" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_inbox_idx" ON "ticket" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "ticket_assignee_idx" ON "ticket" USING btree ("workspace_id","assignee_id","status");--> statement-breakpoint
CREATE INDEX "ticket_created_at_idx" ON "ticket" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_workspace_short_id_unique" ON "ticket" USING btree ("workspace_id","short_id");--> statement-breakpoint
-- Per-workspace incrementing short_id for tickets. Inserts that leave
-- short_id unset (or 0) get assigned `coalesce(max(short_id),0)+1` scoped to
-- the row's workspace_id. Acquires a row-level advisory lock per workspace
-- to keep concurrent inserts safe; the unique index above is a belt-and-
-- suspenders backstop. (Phase 2a — fine for dev volume; revisit at scale.)
CREATE OR REPLACE FUNCTION assign_ticket_short_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.short_id IS NULL OR NEW.short_id = 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('ticket_short_id:' || NEW.workspace_id));
    SELECT coalesce(max(short_id), 0) + 1 INTO NEW.short_id
      FROM ticket WHERE workspace_id = NEW.workspace_id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ticket_assign_short_id_trg
  BEFORE INSERT ON ticket
  FOR EACH ROW EXECUTE FUNCTION assign_ticket_short_id();