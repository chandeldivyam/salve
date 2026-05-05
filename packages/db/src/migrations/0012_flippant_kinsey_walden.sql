ALTER TABLE "message" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "resolved_by_id" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;