CREATE TYPE "public"."channel_kind" AS ENUM('email', 'chat', 'whatsapp', 'sms', 'instagram', 'facebook', 'api_webhook');--> statement-breakpoint
CREATE TABLE "channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" "channel_kind" NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_workspace_kind_idx" ON "channel" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE INDEX "channel_workspace_default_idx" ON "channel" USING btree ("workspace_id","kind","is_default");--> statement-breakpoint

ALTER TABLE "ticket" ADD COLUMN "closed_by_id" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_closed_by_id_user_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "sending_domain" ADD COLUMN "provider_meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "sending_domain_workspace_idx" ON "sending_domain" USING btree ("workspace_id");--> statement-breakpoint

ALTER TABLE "email_channel" RENAME TO "email_channel_legacy";--> statement-breakpoint
INSERT INTO "channel" ("id", "workspace_id", "kind", "name", "is_default", "config", "created_at", "updated_at")
SELECT
	"id",
	"workspace_id",
	'email'::"channel_kind",
	"name",
	"is_default" = 'true',
	'{}'::jsonb,
	"created_at",
	"updated_at"
FROM "email_channel_legacy";--> statement-breakpoint

INSERT INTO "channel" ("id", "workspace_id", "kind", "name", "is_default", "config", "created_at", "updated_at")
SELECT
	gen_random_uuid(),
	source."workspace_id",
	'email'::"channel_kind",
	'Default email',
	true,
	'{}'::jsonb,
	now(),
	now()
FROM (
	SELECT DISTINCT "workspace_id" FROM "outbound_message"
	UNION
	SELECT DISTINCT "workspace_id" FROM "suppression"
) source
WHERE NOT EXISTS (
	SELECT 1
	FROM "channel" c
	WHERE c."workspace_id" = source."workspace_id"
		AND c."kind" = 'email'::"channel_kind"
);--> statement-breakpoint

CREATE TABLE "email_channel" (
	"channel_id" uuid PRIMARY KEY NOT NULL,
	"sending_domain_id" uuid,
	"from_name" text,
	"signature" text,
	"default_priority" "ticket_priority" DEFAULT 'normal' NOT NULL,
	"threading_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"new_ticket_after_closed_days" integer DEFAULT 14 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "email_channel" ("channel_id", "sending_domain_id", "created_at", "updated_at")
SELECT "id", "sending_domain_id", "created_at", "updated_at"
FROM "email_channel_legacy";--> statement-breakpoint
ALTER TABLE "email_channel" ADD CONSTRAINT "email_channel_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_channel" ADD CONSTRAINT "email_channel_sending_domain_id_sending_domain_id_fk" FOREIGN KEY ("sending_domain_id") REFERENCES "public"."sending_domain"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_channel_sending_domain_idx" ON "email_channel" USING btree ("sending_domain_id");--> statement-breakpoint

CREATE TABLE "email_address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"sending_domain_id" uuid NOT NULL,
	"local_part" text NOT NULL,
	"full_address" text NOT NULL,
	"can_send" boolean DEFAULT true NOT NULL,
	"can_receive" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"default_team_id" text,
	"label" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_address" ADD CONSTRAINT "email_address_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_address" ADD CONSTRAINT "email_address_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_address" ADD CONSTRAINT "email_address_sending_domain_id_sending_domain_id_fk" FOREIGN KEY ("sending_domain_id") REFERENCES "public"."sending_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_address_workspace_idx" ON "email_address" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "email_address_channel_idx" ON "email_address" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_address_channel_local_part_unique" ON "email_address" USING btree ("channel_id","local_part");--> statement-breakpoint
CREATE UNIQUE INDEX "email_address_full_address_unique" ON "email_address" USING btree ("full_address");--> statement-breakpoint
INSERT INTO "email_address" (
	"id",
	"workspace_id",
	"channel_id",
	"sending_domain_id",
	"local_part",
	"full_address",
	"can_send",
	"can_receive",
	"is_default",
	"label",
	"created_at",
	"updated_at"
)
SELECT
	gen_random_uuid(),
	ec."workspace_id",
	ec."id",
	ec."sending_domain_id",
	lower(ec."inbound_localpart"),
	lower(ec."inbound_localpart") || '@' || lower(sd."domain"),
	true,
	true,
	true,
	ec."name",
	ec."created_at",
	ec."updated_at"
FROM "email_channel_legacy" ec
JOIN "sending_domain" sd ON sd."id" = ec."sending_domain_id"
WHERE ec."sending_domain_id" IS NOT NULL
	AND ec."inbound_localpart" IS NOT NULL;--> statement-breakpoint
DROP TABLE "email_channel_legacy";--> statement-breakpoint

ALTER TABLE "outbound_message" RENAME TO "outbound_message_legacy";--> statement-breakpoint
CREATE TABLE "outbound_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"email_address_id" uuid,
	"ticket_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"provider_message_id" text,
	"status" "outbound_message_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"provider_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "outbound_message" (
	"id",
	"workspace_id",
	"channel_id",
	"ticket_id",
	"message_id",
	"provider_message_id",
	"status",
	"error",
	"sent_at",
	"delivered_at",
	"provider_meta",
	"created_at",
	"updated_at"
)
SELECT
	om."id",
	om."workspace_id",
	c."id",
	om."ticket_id",
	om."message_id",
	om."ses_message_id",
	om."status",
	om."error",
	om."sent_at",
	om."delivered_at",
	jsonb_build_object(
		'rfcMessageID', om."rfc_message_id",
		'fromAddress', om."from_address",
		'toAddress', om."to_address",
		'replyTo', om."reply_to",
		'subject', om."subject"
	),
	om."created_at",
	om."updated_at"
FROM "outbound_message_legacy" om
JOIN LATERAL (
	SELECT "id"
	FROM "channel" c
	WHERE c."workspace_id" = om."workspace_id"
		AND c."kind" = 'email'::"channel_kind"
	ORDER BY c."is_default" DESC, c."created_at" ASC
	LIMIT 1
) c ON true;--> statement-breakpoint
DROP TABLE "outbound_message_legacy";--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_email_address_id_email_address_id_fk" FOREIGN KEY ("email_address_id") REFERENCES "public"."email_address"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_message_message_unique" ON "outbound_message" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_message_channel_provider_unique" ON "outbound_message" USING btree ("channel_id","provider_message_id");--> statement-breakpoint
CREATE INDEX "outbound_message_ticket_idx" ON "outbound_message" USING btree ("workspace_id","ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "outbound_message_status_idx" ON "outbound_message" USING btree ("workspace_id","status","created_at");--> statement-breakpoint

ALTER TABLE "suppression" RENAME TO "suppression_legacy";--> statement-breakpoint
CREATE TABLE "suppression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"channel_id" uuid,
	"target" text NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"provider_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "suppression" ("id", "workspace_id", "target", "reason", "provider_meta", "created_at")
SELECT "id", "workspace_id", "email_address", "reason", '{}'::jsonb, "created_at"
FROM "suppression_legacy";--> statement-breakpoint
DROP TABLE "suppression_legacy";--> statement-breakpoint
ALTER TABLE "suppression" ADD CONSTRAINT "suppression_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression" ADD CONSTRAINT "suppression_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression" ADD CONSTRAINT "suppression_workspace_channel_target_unique" UNIQUE NULLS NOT DISTINCT("workspace_id","channel_id","target");--> statement-breakpoint
CREATE INDEX "suppression_workspace_idx" ON "suppression" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "suppression_target_idx" ON "suppression" USING btree ("target");--> statement-breakpoint

CREATE TABLE "webhook_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text,
	"channel_id" uuid,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"provider_message_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_event_source_provider_idx" ON "webhook_event" USING btree ("source","provider_message_id");--> statement-breakpoint
CREATE INDEX "webhook_event_workspace_idx" ON "webhook_event" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_event_unprocessed_idx" ON "webhook_event" USING btree ("processed_at");--> statement-breakpoint

CREATE TABLE "customer_channel_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"external_identifier" text NOT NULL,
	"provider_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_channel_identity" ADD CONSTRAINT "customer_channel_identity_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_channel_identity" ADD CONSTRAINT "customer_channel_identity_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_channel_identity" ADD CONSTRAINT "customer_channel_identity_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_channel_identity_channel_external_unique" ON "customer_channel_identity" USING btree ("channel_id","external_identifier");--> statement-breakpoint
CREATE INDEX "customer_channel_identity_workspace_customer_idx" ON "customer_channel_identity" USING btree ("workspace_id","customer_id");
