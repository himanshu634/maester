import { z } from "zod";

export const TextSource = z.enum(["text_layer", "ocr", "mixed", "xbrl"]);
export type TextSource = z.infer<typeof TextSource>;
export const ChunkKind = z.enum(["prose", "table"]);
export type ChunkKind = z.infer<typeof ChunkKind>;
export const PageNoneReason = z.enum(["NO_TEXT", "OCR_FAILED", "OCR_BUDGET", "PAGE_UNREADABLE"]);
export type PageNoneReason = z.infer<typeof PageNoneReason>;

/** 1-based page number. */
const PageNumber = z.number().int().min(1);

export const IndexerVersions = z.strictObject({
  doclingVersion: z.string(),
  ocrEngine: z.string(),
  readerOptions: z.string(),
  chunkerVersion: z.string(),
  /** The model id whose tokenizer the indexer loaded. */
  tokenizer: z.string(),
});
export type IndexerVersions = z.infer<typeof IndexerVersions>;

const pageFields = {
  pageNumber: PageNumber,
  text: z.string(),
  itemsTextLayer: z.number().int().min(0),
  itemsOcr: z.number().int().min(0),
  noneReason: PageNoneReason.nullable(),
};

/** One page of a cached range read. */
export const RangePage = z.strictObject(pageFields);
export type RangePage = z.infer<typeof RangePage>;

/** The cached result of reading a page range: Docling's document plus where each item's text came from. */
export const RangeRead = z.strictObject({
  firstPage: PageNumber,
  lastPage: PageNumber,
  /** The whole PDF's page count. */
  pageCount: PageNumber,
  ocrOn: z.boolean(),
  versions: IndexerVersions,
  /** Docling's `export_to_dict()`; opaque on the wire. */
  document: z.record(z.string(), z.unknown()),
  /** By item `self_ref`. */
  itemSources: z.record(z.string(), TextSource),
  pages: z.array(RangePage),
});
export type RangeRead = z.infer<typeof RangeRead>;

export const ChunkRequest = z.strictObject({
  read: RangeRead,
  sectionPathBefore: z.array(z.string()),
  embeddingModel: z.string(),
});
export type ChunkRequest = z.infer<typeof ChunkRequest>;

/** One line of the indexer's NDJSON response stream. */
export const IndexerEvent = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("started"),
    versions: IndexerVersions,
    pageCount: PageNumber,
    firstPage: PageNumber,
    lastPage: PageNumber,
  }),
  z.strictObject({
    type: z.literal("page"),
    ...pageFields,
    sectionPathAfter: z.array(z.string()),
  }),
  z.strictObject({
    type: z.literal("chunk"),
    pageNumber: PageNumber,
    seq: z.number().int().min(0),
    kind: ChunkKind,
    textSource: TextSource,
    sectionPath: z.array(z.string()),
    basis: z.enum(["consolidated", "standalone"]).nullable(),
    text: z.string(),
    tokenCount: z.number().int().min(0),
  }),
  z.strictObject({ type: z.literal("progress"), stage: z.string(), percent: z.number().min(0).max(100) }),
  z.strictObject({ type: z.literal("heartbeat") }),
  z.strictObject({
    type: z.literal("result"),
    /** Null from `/v1/chunk`, which reads nothing. */
    read: RangeRead.nullable(),
    ocrPages: z.number().int().min(0),
  }),
  z.strictObject({ type: z.literal("error"), code: z.string(), retryable: z.boolean(), message: z.string() }),
]);
export type IndexerEvent = z.infer<typeof IndexerEvent>;

/**
 * The text that is embedded for a chunk: the section path's entries, one per line, then the chunk text;
 * just the text when the path is empty. The indexer has the same function (maester_indexer.contracts).
 */
export function contextualize(sectionPath: readonly string[], text: string): string {
  return sectionPath.length === 0 ? text : `${sectionPath.join("\n")}\n${text}`;
}
