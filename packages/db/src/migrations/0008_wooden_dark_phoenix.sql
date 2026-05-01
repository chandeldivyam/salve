ALTER TABLE "customer" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("display_name", '') || ' ' || coalesce("email", ''))) STORED;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("description", ''))) STORED;--> statement-breakpoint
CREATE INDEX "customer_search_vector_idx" ON "customer" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "customer_name_trgm_idx" ON "customer" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customer_display_name_trgm_idx" ON "customer" USING gin ("display_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customer_email_trgm_idx" ON "customer" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ticket_search_vector_idx" ON "ticket" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "ticket_title_trgm_idx" ON "ticket" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ticket_description_trgm_idx" ON "ticket" USING gin ("description" gin_trgm_ops);