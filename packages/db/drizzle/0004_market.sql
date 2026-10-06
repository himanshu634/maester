CREATE TABLE "market_fetch" (
	"id" uuid PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"started_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp (3) with time zone,
	"points_written" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	CONSTRAINT "market_fetch_state" CHECK ("market_fetch"."state" in ('running', 'ok', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "market_point" (
	"series" text NOT NULL,
	"day" date NOT NULL,
	"value" double precision NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_point_pk" PRIMARY KEY("series","day")
);
--> statement-breakpoint
CREATE INDEX "market_fetch_started_at" ON "market_fetch" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "market_point_day" ON "market_point" USING btree ("day");