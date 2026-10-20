CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."chunk_kind" AS ENUM('prose', 'table');--> statement-breakpoint
CREATE TYPE "public"."chunk_text_source" AS ENUM('text_layer', 'ocr', 'mixed', 'xbrl');--> statement-breakpoint
CREATE TYPE "public"."index_revision_state" AS ENUM('building', 'complete', 'partial');--> statement-breakpoint
CREATE TABLE "chunk_embedding" (
	"chunk_id" uuid NOT NULL,
	"model" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunk_embedding_pk" PRIMARY KEY("chunk_id","model")
);
--> statement-breakpoint
CREATE TABLE "document_chunk" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"page_number" integer,
	"element" text,
	"seq" integer NOT NULL,
	"section_path" text[] NOT NULL,
	"kind" "chunk_kind" NOT NULL,
	"text_source" "chunk_text_source" NOT NULL,
	"basis" text,
	"heading_text" text NOT NULL,
	"text" text NOT NULL,
	"token_count" integer NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, heading_text || ' ' || text)) STORED,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunk_revision_page_seq" UNIQUE NULLS NOT DISTINCT("revision_id","page_number","seq")
);
--> statement-breakpoint
CREATE TABLE "document_index_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"state" "index_revision_state" NOT NULL,
	"index_version" text NOT NULL,
	"docling_version" text NOT NULL,
	"ocr_engine" text NOT NULL,
	"reader_options" text NOT NULL,
	"chunker_version" text NOT NULL,
	"embedding_model" text NOT NULL,
	"page_count" integer,
	"pages_read" integer DEFAULT 0 NOT NULL,
	"pages_ocr" integer DEFAULT 0 NOT NULL,
	"warnings" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp (3) with time zone,
	CONSTRAINT "document_index_revision_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "document_page" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"text" text NOT NULL,
	"items_text_layer" integer,
	"items_ocr" integer,
	"none_reason" text,
	"section_path_after" text[] NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_read" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content_sha256" text NOT NULL,
	"first_page" integer NOT NULL,
	"last_page" integer NOT NULL,
	"docling_version" text NOT NULL,
	"ocr_engine" text NOT NULL,
	"reader_options" text NOT NULL,
	"read" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunk_embedding" ADD CONSTRAINT "chunk_embedding_chunk_id_document_chunk_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunk"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunk_embedding" ADD CONSTRAINT "chunk_embedding_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunk" ADD CONSTRAINT "document_chunk_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunk" ADD CONSTRAINT "document_chunk_revision_id_document_index_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."document_index_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunk" ADD CONSTRAINT "document_chunk_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_index_revision" ADD CONSTRAINT "document_index_revision_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_index_revision" ADD CONSTRAINT "document_index_revision_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_index_revision" ADD CONSTRAINT "document_index_revision_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_page" ADD CONSTRAINT "document_page_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_page" ADD CONSTRAINT "document_page_revision_id_document_index_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."document_index_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_read" ADD CONSTRAINT "page_read_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunk_embedding_hnsw" ON "chunk_embedding" USING hnsw (("embedding"::halfvec(1024)) halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX "document_chunk_tsv" ON "document_chunk" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "document_chunk_workspace_document" ON "document_chunk" USING btree ("workspace_id","document_id");--> statement-breakpoint
CREATE INDEX "document_index_revision_document" ON "document_index_revision" USING btree ("workspace_id","document_id","embedding_model","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_index_current" ON "document_index_revision" USING btree ("document_id","embedding_model") WHERE "document_index_revision"."state" in ('complete', 'partial');--> statement-breakpoint
CREATE UNIQUE INDEX "document_page_revision_page" ON "document_page" USING btree ("revision_id","page_number");--> statement-breakpoint
CREATE UNIQUE INDEX "page_read_key" ON "page_read" USING btree ("workspace_id","content_sha256","first_page","last_page","docling_version","ocr_engine","reader_options");