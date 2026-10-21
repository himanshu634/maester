ALTER TYPE "public"."intake_state" ADD VALUE 'waiting_for_xbrl';--> statement-breakpoint
ALTER TYPE "public"."check_type" ADD VALUE 'xbrl_in_pdf';--> statement-breakpoint
CREATE TYPE "public"."document_format" AS ENUM('pdf', 'xbrl');--> statement-breakpoint
CREATE TYPE "public"."extraction_source" AS ENUM('pdf', 'xbrl');--> statement-breakpoint
CREATE TYPE "public"."fact_span" AS ENUM('quarter', 'half_year', 'nine_months', 'year', 'other');--> statement-breakpoint
CREATE TABLE "xbrl_source" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"fact_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"element" text NOT NULL,
	"context_id" text NOT NULL,
	"decimals" text,
	"nil" boolean DEFAULT false NOT NULL,
	"concept" text,
	"footnote_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "isin" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "format" "document_format" DEFAULT 'pdf' NOT NULL;--> statement-breakpoint
ALTER TABLE "classification_evidence" ADD COLUMN "element" text;--> statement-breakpoint
ALTER TABLE "classification_evidence" ADD COLUMN "context" text;--> statement-breakpoint
ALTER TABLE "document_classification" ADD COLUMN "isin" text;--> statement-breakpoint
ALTER TABLE "document_classification" ADD COLUMN "xbrl_format" text;--> statement-breakpoint
ALTER TABLE "document_classification" ADD COLUMN "basis" "reporting_basis";--> statement-breakpoint
ALTER TABLE "extraction_check" ADD COLUMN "fact_id" uuid;--> statement-breakpoint
ALTER TABLE "extraction_check" ADD COLUMN "pdf_document_id" uuid;--> statement-breakpoint
ALTER TABLE "extraction_check" ADD COLUMN "pdf_classification_id" uuid;--> statement-breakpoint
ALTER TABLE "extraction_check" ADD COLUMN "page_index" integer;--> statement-breakpoint
ALTER TABLE "extraction_check" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "extraction_check" ADD COLUMN "check_version" integer;--> statement-breakpoint
ALTER TABLE "extraction_revision" ADD COLUMN "source" "extraction_source" DEFAULT 'pdf' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_fact" ADD COLUMN "period_start" date;--> statement-breakpoint
ALTER TABLE "financial_fact" ADD COLUMN "span" "fact_span";--> statement-breakpoint
ALTER TABLE "xbrl_source" ADD CONSTRAINT "xbrl_source_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xbrl_source" ADD CONSTRAINT "xbrl_source_fact_id_financial_fact_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."financial_fact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xbrl_source" ADD CONSTRAINT "xbrl_source_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "xbrl_source_fact" ON "xbrl_source" USING btree ("fact_id");--> statement-breakpoint
ALTER TABLE "extraction_check" ADD CONSTRAINT "extraction_check_fact_id_financial_fact_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."financial_fact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_check" ADD CONSTRAINT "extraction_check_pdf_document_id_document_id_fk" FOREIGN KEY ("pdf_document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_check" ADD CONSTRAINT "extraction_check_pdf_classification_id_document_classification_id_fk" FOREIGN KEY ("pdf_classification_id") REFERENCES "public"."document_classification"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_workspace_isin" ON "company" USING btree ("workspace_id","isin") WHERE "company"."isin" is not null;--> statement-breakpoint
CREATE INDEX "document_workspace_intake" ON "document" USING btree ("workspace_id","intake_state");--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_check_xbrl_pdf" ON "extraction_check" USING btree ("fact_id","pdf_classification_id","check_version") WHERE "extraction_check"."pdf_classification_id" is not null;--> statement-breakpoint
CREATE INDEX "extraction_check_pdf_document" ON "extraction_check" USING btree ("workspace_id","pdf_document_id");--> statement-breakpoint
UPDATE "document" SET "rejection_code" = 'UNSUPPORTED_TYPE' WHERE "rejection_code" = 'NOT_A_PDF';
