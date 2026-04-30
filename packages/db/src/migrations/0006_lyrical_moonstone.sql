CREATE TYPE "public"."custom_field_category" AS ENUM('ticket', 'customer');--> statement-breakpoint
CREATE TYPE "public"."custom_field_type" AS ENUM('text', 'number', 'decimal', 'boolean', 'date', 'list', 'multi_select', 'agent', 'customer', 'ticket', 'url', 'address', 'dynamic_list', 'dynamic_multi_select');--> statement-breakpoint
CREATE TABLE "custom_field" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"category" "custom_field_category" NOT NULL,
	"type" "custom_field_type" NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dynamic_config" jsonb,
	"default_value" jsonb,
	"rules" jsonb,
	"depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"editable_by" jsonb DEFAULT '["agent","admin"]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"ticket_id" uuid,
	"customer_id" uuid,
	"value" jsonb,
	"updated_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_value_one_target" CHECK (((ticket_id IS NOT NULL)::int + (customer_id IS NOT NULL)::int) = 1)
);
--> statement-breakpoint
CREATE TABLE "customer_tag" (
	"customer_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by_id" text,
	CONSTRAINT "customer_tag_customer_id_tag_id_pk" PRIMARY KEY("customer_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"group_id" uuid,
	"label" text NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_tag" (
	"ticket_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by_id" text,
	CONSTRAINT "ticket_tag_ticket_id_tag_id_pk" PRIMARY KEY("ticket_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "audit_event" ALTER COLUMN "ticket_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "custom_field" ADD CONSTRAINT "custom_field_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_field_id_custom_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tag" ADD CONSTRAINT "customer_tag_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tag" ADD CONSTRAINT "customer_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tag" ADD CONSTRAINT "customer_tag_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tag" ADD CONSTRAINT "customer_tag_added_by_id_user_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_group_id_tag_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."tag_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_group" ADD CONSTRAINT "tag_group_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_tag" ADD CONSTRAINT "ticket_tag_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_tag" ADD CONSTRAINT "ticket_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_tag" ADD CONSTRAINT "ticket_tag_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_tag" ADD CONSTRAINT "ticket_tag_added_by_id_user_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_key_unique" ON "custom_field" USING btree ("workspace_id","category","key");--> statement-breakpoint
CREATE INDEX "custom_field_active_idx" ON "custom_field" USING btree ("workspace_id","category","active");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_value_ticket_unique" ON "custom_field_value" USING btree ("field_id","ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_value_customer_unique" ON "custom_field_value" USING btree ("field_id","customer_id");--> statement-breakpoint
CREATE INDEX "custom_field_value_ticket_idx" ON "custom_field_value" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "custom_field_value_customer_idx" ON "custom_field_value" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "custom_field_value_workspace_idx" ON "custom_field_value" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "customer_tag_tag_idx" ON "customer_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "customer_tag_workspace_idx" ON "customer_tag" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_workspace_label_unique" ON "tag" USING btree ("workspace_id",lower("label"));--> statement-breakpoint
CREATE INDEX "tag_group_idx" ON "tag" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "tag_workspace_idx" ON "tag" USING btree ("workspace_id","archived_at");--> statement-breakpoint
CREATE INDEX "tag_group_workspace_idx" ON "tag_group" USING btree ("workspace_id","archived_at");--> statement-breakpoint
CREATE INDEX "ticket_tag_tag_idx" ON "ticket_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "ticket_tag_workspace_idx" ON "ticket_tag" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_customer_created_idx" ON "audit_event" USING btree ("customer_id","created_at");