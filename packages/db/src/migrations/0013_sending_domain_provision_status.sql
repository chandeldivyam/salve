CREATE TYPE "public"."sending_domain_provision_status" AS ENUM('pending', 'provisioning', 'provisioned', 'failed');--> statement-breakpoint
ALTER TABLE "sending_domain" ADD COLUMN "provision_status" "sending_domain_provision_status" DEFAULT 'provisioned' NOT NULL;
