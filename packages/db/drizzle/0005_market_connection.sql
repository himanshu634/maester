CREATE TABLE "market_connection" (
	"provider" text PRIMARY KEY NOT NULL,
	"client_id" text,
	"secret_ciphertext" text NOT NULL,
	"secret_last4" text NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"checked_at" timestamp (3) with time zone NOT NULL,
	"last_error_code" text,
	"saved_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"saved_by_user_id" text,
	CONSTRAINT "market_connection_provider" CHECK ("market_connection"."provider" in ('dhan', 'fred'))
);
--> statement-breakpoint
ALTER TABLE "market_connection" ADD CONSTRAINT "market_connection_saved_by_user_id_user_id_fk" FOREIGN KEY ("saved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;