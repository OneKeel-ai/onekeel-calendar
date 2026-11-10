CREATE TABLE "scheduling_offer" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type_id" text NOT NULL,
	"created_by" text,
	"title" text,
	"guests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "offer_id" text;--> statement-breakpoint
ALTER TABLE "scheduling_offer" ADD CONSTRAINT "scheduling_offer_event_type_id_event_type_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_offer" ADD CONSTRAINT "scheduling_offer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduling_offer_content_idx" ON "scheduling_offer" USING btree ("created_by","event_type_id","content_hash");--> statement-breakpoint
CREATE INDEX "scheduling_offer_event_type_idx" ON "scheduling_offer" USING btree ("event_type_id");--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_offer_id_scheduling_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."scheduling_offer"("id") ON DELETE set null ON UPDATE no action;