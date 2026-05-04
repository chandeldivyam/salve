ALTER TABLE "apikey" ADD COLUMN "principal_kind" text;--> statement-breakpoint
ALTER TABLE "apikey" ADD COLUMN "principal_id" text;--> statement-breakpoint
CREATE INDEX "apikey_principal_idx" ON "apikey" USING btree ("principal_kind","principal_id");