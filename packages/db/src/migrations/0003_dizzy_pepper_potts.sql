CREATE TYPE "public"."outbound_message_status" AS ENUM('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'suppressed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sending_domain_dmarc_status" AS ENUM('pending', 'present', 'missing', 'failing');--> statement-breakpoint
CREATE TYPE "public"."sending_domain_dns_status" AS ENUM('pending', 'verified', 'failed', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('hard_bounce', 'complaint', 'manual', 'unsubscribe');--> statement-breakpoint
CREATE TABLE "email_channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"inbound_localpart" text,
	"sending_domain_id" uuid,
	"is_default" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"rfc_message_id" text NOT NULL,
	"ses_message_id" text,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"reply_to" text NOT NULL,
	"subject" text NOT NULL,
	"status" "outbound_message_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sending_domain" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"domain" text NOT NULL,
	"ses_identity_arn" text,
	"dkim_tokens" jsonb,
	"mail_from_subdomain" text DEFAULT 'mail' NOT NULL,
	"dns_status" "sending_domain_dns_status" DEFAULT 'pending' NOT NULL,
	"dmarc_status" "sending_domain_dmarc_status" DEFAULT 'pending' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"email_address" text NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "alternate_emails" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_channel" ADD CONSTRAINT "email_channel_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_channel" ADD CONSTRAINT "email_channel_sending_domain_id_sending_domain_id_fk" FOREIGN KEY ("sending_domain_id") REFERENCES "public"."sending_domain"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_domain" ADD CONSTRAINT "sending_domain_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression" ADD CONSTRAINT "suppression_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_channel_inbound_localpart_unique" ON "email_channel" USING btree ("inbound_localpart");--> statement-breakpoint
CREATE INDEX "email_channel_workspace_idx" ON "email_channel" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "outbound_message_rfc_message_id_idx" ON "outbound_message" USING btree ("rfc_message_id");--> statement-breakpoint
CREATE INDEX "outbound_message_ticket_idx" ON "outbound_message" USING btree ("workspace_id","ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sending_domain_workspace_domain_unique" ON "sending_domain" USING btree ("workspace_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_workspace_email_unique" ON "suppression" USING btree ("workspace_id","email_address");