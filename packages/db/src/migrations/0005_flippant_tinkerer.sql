CREATE TABLE "inbound_message_raw" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"provider_message_id" text NOT NULL,
	"raw_blob_s3_key" text NOT NULL,
	"raw_blob_size_bytes" integer,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processed_ticket_id" uuid,
	"processed_message_id" uuid,
	"parse_error" text,
	"skip_reason" text,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"envelope_to" text,
	"destination_address" text,
	"sender_address" text,
	"subject" text,
	"authentication_results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_routing_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"email_address_id" uuid,
	"sender_pattern" text,
	"subject_pattern" text,
	"assign_team_id" text,
	"assign_agent_id" text,
	"set_priority" "ticket_priority",
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_address" ADD COLUMN "signature" text;--> statement-breakpoint
ALTER TABLE "inbound_message_raw" ADD CONSTRAINT "inbound_message_raw_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_message_raw" ADD CONSTRAINT "inbound_message_raw_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_message_raw" ADD CONSTRAINT "inbound_message_raw_processed_ticket_id_ticket_id_fk" FOREIGN KEY ("processed_ticket_id") REFERENCES "public"."ticket"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_message_raw" ADD CONSTRAINT "inbound_message_raw_processed_message_id_message_id_fk" FOREIGN KEY ("processed_message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_routing_rule" ADD CONSTRAINT "inbound_routing_rule_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_routing_rule" ADD CONSTRAINT "inbound_routing_rule_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_routing_rule" ADD CONSTRAINT "inbound_routing_rule_email_address_id_email_address_id_fk" FOREIGN KEY ("email_address_id") REFERENCES "public"."email_address"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_routing_rule" ADD CONSTRAINT "inbound_routing_rule_assign_agent_id_user_id_fk" FOREIGN KEY ("assign_agent_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_message_raw_workspace_provider_unique" ON "inbound_message_raw" USING btree ("workspace_id","provider_message_id");--> statement-breakpoint
CREATE INDEX "inbound_message_raw_unprocessed_idx" ON "inbound_message_raw" USING btree ("workspace_id","received_at") WHERE "inbound_message_raw"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "inbound_message_raw_processed_ticket_idx" ON "inbound_message_raw" USING btree ("workspace_id","processed_ticket_id","received_at");--> statement-breakpoint
CREATE INDEX "inbound_message_raw_processed_message_idx" ON "inbound_message_raw" USING btree ("workspace_id","processed_message_id");--> statement-breakpoint
CREATE INDEX "inbound_message_raw_channel_received_idx" ON "inbound_message_raw" USING btree ("workspace_id","channel_id","received_at");--> statement-breakpoint
CREATE INDEX "inbound_message_raw_destination_idx" ON "inbound_message_raw" USING btree ("workspace_id","destination_address","received_at");--> statement-breakpoint
CREATE INDEX "inbound_routing_rule_workspace_eval_idx" ON "inbound_routing_rule" USING btree ("workspace_id","channel_id","enabled","priority");--> statement-breakpoint
CREATE INDEX "inbound_routing_rule_address_eval_idx" ON "inbound_routing_rule" USING btree ("workspace_id","email_address_id","priority");--> statement-breakpoint
CREATE INDEX "inbound_routing_rule_assign_agent_idx" ON "inbound_routing_rule" USING btree ("workspace_id","assign_agent_id");