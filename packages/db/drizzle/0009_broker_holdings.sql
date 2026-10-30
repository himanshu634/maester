CREATE TABLE "broker_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"broker" text NOT NULL,
	"credentials_ciphertext" text,
	"key_last4" text,
	"account_id" text,
	"token_ciphertext" text,
	"signed_in_at" timestamp (3) with time zone,
	"token_expires_at" timestamp (3) with time zone,
	"last_error_code" text,
	"saved_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"saved_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "broker_login_state" (
	"nonce" text PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holding_line" (
	"read_id" uuid NOT NULL,
	"isin" text NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"quantity" numeric NOT NULL,
	"t1_quantity" numeric NOT NULL,
	"average_price" numeric NOT NULL,
	"last_price" numeric,
	CONSTRAINT "holding_line_pk" PRIMARY KEY("read_id","isin","exchange")
);
--> statement-breakpoint
CREATE TABLE "holding_read" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"started_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp (3) with time zone,
	"state" text NOT NULL,
	"error_code" text,
	"line_count" integer,
	CONSTRAINT "holding_read_state" CHECK ("holding_read"."state" in ('running', 'ok', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "broker_connection" ADD CONSTRAINT "broker_connection_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_connection" ADD CONSTRAINT "broker_connection_saved_by_user_id_user_id_fk" FOREIGN KEY ("saved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_login_state" ADD CONSTRAINT "broker_login_state_connection_id_broker_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."broker_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_login_state" ADD CONSTRAINT "broker_login_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_line" ADD CONSTRAINT "holding_line_read_id_holding_read_id_fk" FOREIGN KEY ("read_id") REFERENCES "public"."holding_read"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_read" ADD CONSTRAINT "holding_read_connection_id_broker_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."broker_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "broker_connection_workspace_broker" ON "broker_connection" USING btree ("workspace_id","broker");--> statement-breakpoint
CREATE INDEX "holding_read_connection_started" ON "holding_read" USING btree ("connection_id","started_at");