CREATE TABLE "calendar_guard" (
	"email" text PRIMARY KEY NOT NULL,
	"delegates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calendar_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduling_offer" ADD COLUMN "restricted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduling_offer" ADD COLUMN "offered_slots" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_guard" ADD CONSTRAINT "calendar_guard_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;