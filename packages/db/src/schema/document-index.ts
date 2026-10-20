import { sql } from "drizzle-orm";
import {
  customType, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid, vector,
} from "drizzle-orm/pg-core";
import { document, job, ts, workspace } from "./platform.js";

export const indexRevisionState = pgEnum("index_revision_state", ["building", "complete", "partial"]);
export const chunkKind = pgEnum("chunk_kind", ["prose", "table"]);
export const chunkTextSource = pgEnum("chunk_text_source", ["text_layer", "ocr", "mixed", "xbrl"]);

/** A Postgres tsvector column; only ever read in SQL, never from the application. */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** One build of a document's index: the versions it was built with and where it stands. */
export const documentIndexRevision = pgTable(
  "document_index_revision",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    documentId: uuid("document_id").notNull().references(() => document.id),
    jobId: uuid("job_id").notNull().unique().references(() => job.id),
    state: indexRevisionState("state").notNull(),
    indexVersion: text("index_version").notNull(),
    doclingVersion: text("docling_version").notNull(),
    ocrEngine: text("ocr_engine").notNull(),
    readerOptions: text("reader_options").notNull(),
    chunkerVersion: text("chunker_version").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    pageCount: integer("page_count"),
    pagesRead: integer("pages_read").notNull().default(0),
    pagesOcr: integer("pages_ocr").notNull().default(0),
    warnings: text("warnings").array().notNull().default(sql`'{}'`),
    createdAt: ts("created_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
  },
  (t) => [
    index("document_index_revision_document").on(t.workspaceId, t.documentId, t.embeddingModel, t.createdAt),
    uniqueIndex("document_index_current")
      .on(t.documentId, t.embeddingModel)
      .where(sql`${t.state} in ('complete', 'partial')`),
  ],
);

/** The text of one page, kept so a reader can open the page a chunk came from. */
export const documentPage = pgTable(
  "document_page",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    revisionId: uuid("revision_id").notNull().references(() => documentIndexRevision.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    text: text("text").notNull(),
    itemsTextLayer: integer("items_text_layer"),
    itemsOcr: integer("items_ocr"),
    noneReason: text("none_reason"),
    sectionPathAfter: text("section_path_after").array().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("document_page_revision_page").on(t.revisionId, t.pageNumber)],
);

export const documentChunk = pgTable(
  "document_chunk",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    revisionId: uuid("revision_id").notNull().references(() => documentIndexRevision.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => document.id),
    /** Null only for a future XBRL chunk. */
    pageNumber: integer("page_number"),
    /** Null for PDF chunks. */
    element: text("element"),
    seq: integer("seq").notNull(),
    sectionPath: text("section_path").array().notNull(),
    kind: chunkKind("kind").notNull(),
    textSource: chunkTextSource("text_source").notNull(),
    basis: text("basis"),
    /** The section path joined by a space, written by `writeRange`: `array_to_string` is not immutable. */
    headingText: text("heading_text").notNull(),
    text: text("text").notNull(),
    tokenCount: integer("token_count").notNull(),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('simple'::regconfig, heading_text || ' ' || text)`),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("document_chunk_revision_page_seq").on(t.revisionId, t.pageNumber, t.seq),
    index("document_chunk_tsv").using("gin", t.tsv),
    index("document_chunk_workspace_document").on(t.workspaceId, t.documentId),
  ],
);

export const chunkEmbedding = pgTable(
  "chunk_embedding",
  {
    chunkId: uuid("chunk_id").notNull().references(() => documentChunk.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "chunk_embedding_pk", columns: [t.chunkId, t.model] }),
    index("chunk_embedding_hnsw").using("hnsw", sql`(${t.embedding}::halfvec(1024)) halfvec_cosine_ops`),
  ],
);

/** A cached read of a page range of one PDF, so a retry or a rebuild does not read the pages again. */
export const pageRead = pgTable(
  "page_read",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    contentSha256: text("content_sha256").notNull(),
    firstPage: integer("first_page").notNull(),
    lastPage: integer("last_page").notNull(),
    doclingVersion: text("docling_version").notNull(),
    ocrEngine: text("ocr_engine").notNull(),
    readerOptions: text("reader_options").notNull(),
    /** A `RangeRead` from `@maester/contracts`. */
    read: jsonb("read").$type<Record<string, unknown>>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("page_read_key").on(
      t.workspaceId, t.contentSha256, t.firstPage, t.lastPage, t.doclingVersion, t.ocrEngine, t.readerOptions,
    ),
  ],
);

export type IndexRevisionRow = typeof documentIndexRevision.$inferSelect;
