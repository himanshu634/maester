CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "waitlist_entry" (
	"email" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"requested_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp (3) with time zone,
	CONSTRAINT "waitlist_entry_status" CHECK ("waitlist_entry"."status" in ('pending', 'approved')),
	CONSTRAINT "waitlist_entry_source" CHECK ("waitlist_entry"."source" in ('google', 'email', 'admin'))
);
