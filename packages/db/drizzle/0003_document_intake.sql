CREATE TYPE "public"."intake_state" AS ENUM('identifying', 'duplicate', 'needs_company', 'needs_kind', 'kept', 'reading', 'read', 'identify_failed', 'read_failed');--> statement-breakpoint
CREATE TYPE "public"."classification_kind" AS ENUM('annual_report', 'financial_results', 'other', 'not_sure');--> statement-breakpoint
CREATE TYPE "public"."classification_set_by" AS ENUM('maester', 'investor');--> statement-breakpoint
CREATE TYPE "public"."evidence_field" AS ENUM('kind', 'other_type', 'company', 'identifier', 'period', 'results_span', 'statements');--> statement-breakpoint
CREATE TYPE "public"."evidence_source" AS ENUM('rule', 'model', 'investor');--> statement-breakpoint
CREATE TYPE "public"."other_document_type" AS ENUM('shareholding_pattern', 'shareholder_notice', 'board_meeting', 'investor_presentation', 'earnings_call', 'governance_filing', 'announcement', 'offer_document', 'unlisted_type');--> statement-breakpoint
CREATE TYPE "public"."results_span" AS ENUM('quarter', 'half_year', 'nine_months', 'full_year');--> statement-breakpoint
CREATE TABLE "classification_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"classification_id" uuid NOT NULL,
	"field" "evidence_field" NOT NULL,
	"source" "evidence_source" NOT NULL,
	"rule_id" text,
	"page_index" integer,
	"quote" text,
	"text_layer_match" boolean
);
--> statement-breakpoint
CREATE TABLE "document_classification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" "classification_kind" NOT NULL,
	"other_type" "other_document_type",
	"results_span" "results_span",
	"period_end" date,
	"period_label" text,
	"company_id" uuid,
	"company_name_as_printed" text,
	"cin" text,
	"bse_code" text,
	"nse_symbol" text,
	"statements_found" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"set_by" "classification_set_by" NOT NULL,
	"set_by_user_id" text,
	"job_id" uuid,
	"reads_under_id" uuid,
	"rules_version" text,
	"model" text,
	"prompt_version" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_classification_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "cin" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "bse_code" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "nse_symbol" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "intake_state" "intake_state";--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "duplicate_of_document_id" uuid;--> statement-breakpoint
ALTER TABLE "extraction_revision" ADD COLUMN "classification_id" uuid;--> statement-breakpoint
ALTER TABLE "classification_evidence" ADD CONSTRAINT "classification_evidence_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_evidence" ADD CONSTRAINT "classification_evidence_classification_id_document_classification_id_fk" FOREIGN KEY ("classification_id") REFERENCES "public"."document_classification"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_classification" ADD CONSTRAINT "document_classification_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_classification" ADD CONSTRAINT "document_classification_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_classification" ADD CONSTRAINT "document_classification_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_classification" ADD CONSTRAINT "document_classification_set_by_user_id_user_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_classification" ADD CONSTRAINT "document_classification_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_classification" ADD CONSTRAINT "document_classification_reads_under_id_document_classification_id_fk" FOREIGN KEY ("reads_under_id") REFERENCES "public"."document_classification"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classification_evidence_classification" ON "classification_evidence" USING btree ("classification_id");--> statement-breakpoint
CREATE INDEX "document_classification_document_created" ON "document_classification" USING btree ("workspace_id","document_id","created_at");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_duplicate_of_document_id_document_id_fk" FOREIGN KEY ("duplicate_of_document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_revision" ADD CONSTRAINT "extraction_revision_classification_id_document_classification_id_fk" FOREIGN KEY ("classification_id") REFERENCES "public"."document_classification"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_workspace_cin" ON "company" USING btree ("workspace_id","cin") WHERE "company"."cin" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "company_workspace_bse" ON "company" USING btree ("workspace_id","bse_code") WHERE "company"."bse_code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "company_workspace_nse" ON "company" USING btree ("workspace_id","nse_symbol") WHERE "company"."nse_symbol" is not null;