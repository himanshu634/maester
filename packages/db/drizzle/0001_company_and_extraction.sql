CREATE TYPE "public"."check_status" AS ENUM('passed', 'failed', 'not_checked');--> statement-breakpoint
CREATE TYPE "public"."check_type" AS ENUM('subtotal', 'balance_identity');--> statement-breakpoint
CREATE TYPE "public"."extraction_state" AS ENUM('complete', 'partial');--> statement-breakpoint
CREATE TYPE "public"."reporting_basis" AS ENUM('consolidated', 'standalone', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."statement_kind" AS ENUM('balance_sheet', 'income_statement', 'cash_flow');--> statement-breakpoint
CREATE TYPE "public"."value_status" AS ENUM('value', 'dash', 'unparsed');--> statement-breakpoint
CREATE TABLE "company" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"country" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_check" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"check_type" "check_type" NOT NULL,
	"statement" "statement_kind" NOT NULL,
	"basis" "reporting_basis" NOT NULL,
	"section" text,
	"period_label" text NOT NULL,
	"subject_label" text NOT NULL,
	"status" "check_status" NOT NULL,
	"expected" numeric,
	"actual" numeric,
	"detail" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"state" "extraction_state" NOT NULL,
	"pipeline_version" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"page_count" integer NOT NULL,
	"company_name_as_printed" text,
	"coverage" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_revision_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "financial_fact" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"company_id" uuid,
	"statement" "statement_kind" NOT NULL,
	"basis" "reporting_basis" NOT NULL,
	"section" text NOT NULL,
	"line_order" integer NOT NULL,
	"reported_label" text NOT NULL,
	"is_subtotal" boolean NOT NULL,
	"component_labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"period_label" text NOT NULL,
	"period_end" date,
	"as_of_date" date,
	"reported_text" text NOT NULL,
	"reported_value" numeric,
	"value_status" "value_status" NOT NULL,
	"unit_label" text,
	"scale_factor" numeric,
	"currency" text,
	"normalized_value" numeric,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_reference" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"fact_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"page_index" integer NOT NULL,
	"text_layer_match" boolean
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_check" ADD CONSTRAINT "extraction_check_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_check" ADD CONSTRAINT "extraction_check_revision_id_extraction_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."extraction_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_revision" ADD CONSTRAINT "extraction_revision_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_revision" ADD CONSTRAINT "extraction_revision_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_revision" ADD CONSTRAINT "extraction_revision_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_fact" ADD CONSTRAINT "financial_fact_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_fact" ADD CONSTRAINT "financial_fact_revision_id_extraction_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."extraction_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_fact" ADD CONSTRAINT "financial_fact_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_reference" ADD CONSTRAINT "source_reference_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_reference" ADD CONSTRAINT "source_reference_fact_id_financial_fact_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."financial_fact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_reference" ADD CONSTRAINT "source_reference_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_workspace_name" ON "company" USING btree ("workspace_id",lower("display_name"));--> statement-breakpoint
CREATE INDEX "company_workspace_created" ON "company" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "extraction_check_revision" ON "extraction_check" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "extraction_revision_document_created" ON "extraction_revision" USING btree ("workspace_id","document_id","created_at");--> statement-breakpoint
CREATE INDEX "financial_fact_revision_order" ON "financial_fact" USING btree ("revision_id","statement","basis","line_order");--> statement-breakpoint
CREATE UNIQUE INDEX "source_reference_fact" ON "source_reference" USING btree ("fact_id");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;