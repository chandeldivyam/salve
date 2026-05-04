CREATE TYPE "public"."view_kind" AS ENUM('inbox');--> statement-breakpoint
CREATE TYPE "public"."view_scope" AS ENUM('workspace', 'personal');--> statement-breakpoint
CREATE TABLE "builtin_view_member" (
	"builtin_key" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "builtin_view_member_builtin_key_user_id_workspace_id_pk" PRIMARY KEY("builtin_key","user_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" "view_kind" DEFAULT 'inbox' NOT NULL,
	"scope" "view_scope" DEFAULT 'workspace' NOT NULL,
	"owner_id" text,
	"label" text NOT NULL,
	"description" text,
	"icon" text,
	"color" text,
	"query" jsonb NOT NULL,
	"sort" jsonb NOT NULL,
	"group_by" text,
	"display_props" jsonb,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "view_member" (
	"view_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "view_member_view_id_user_id_pk" PRIMARY KEY("view_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "builtin_view_member" ADD CONSTRAINT "builtin_view_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builtin_view_member" ADD CONSTRAINT "builtin_view_member_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view" ADD CONSTRAINT "view_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view" ADD CONSTRAINT "view_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_member" ADD CONSTRAINT "view_member_view_id_view_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."view"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_member" ADD CONSTRAINT "view_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_member" ADD CONSTRAINT "view_member_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "builtin_view_member_user_idx" ON "builtin_view_member" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "view_workspace_idx" ON "view" USING btree ("workspace_id","archived_at");--> statement-breakpoint
CREATE INDEX "view_owner_idx" ON "view" USING btree ("owner_id","scope");--> statement-breakpoint
CREATE INDEX "view_member_user_idx" ON "view_member" USING btree ("user_id","workspace_id");