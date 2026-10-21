import { z } from "zod";
import { Uuid } from "./common.js";

// The twin of apps/eval's EvalRequestModel (maester_eval/eval_wire.py). Both read
// fixtures/eval/request.json, so a change to one side fails the other's tests. The objects are strict because
// the Python models forbid extra fields, and the patterns say `[0-9]`, not `\d`, so both regex engines read them alike.

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** A filing of the corpus, by the id the manifest gives it and the sha256 of its PDF. */
export const EvalDocumentRef = z.strictObject({ filing: z.string(), sha256: Sha256 });
export type EvalDocumentRef = z.infer<typeof EvalDocumentRef>;

/** A question and the filings it is searched within. Its text comes from a filing's reader: it is never logged. */
export const EvalQuestion = z.strictObject({
  id: z.string().regex(/^q[0-9]{3}$/),
  query: z.string().min(1).max(500),
  scope: z.array(z.string()).min(1),
});
export type EvalQuestion = z.infer<typeof EvalQuestion>;

/** What `maester-eval` hands to the worker's index:candidate and eval commands. */
export const EvalRequest = z.strictObject({
  version: z.literal(1),
  documents: z.array(EvalDocumentRef),
  questions: z.array(EvalQuestion),
});
export type EvalRequest = z.infer<typeof EvalRequest>;

/** Where a page's text came from: its items' sources, read from `items_text_layer` and `items_ocr`. */
export const PageSource = z.enum(["text_layer", "ocr", "mixed", "none"]);
export type PageSource = z.infer<typeof PageSource>;

/**
 * A filing of the request as the workspace holds it for one model. A filing that is not stored has a null
 * `documentId`; one with no complete or partial revision for the model has a null `revisionId`, no versions, no
 * chunks and no pages.
 */
export const EvalDocument = z.strictObject({
  filing: z.string(),
  sha256: Sha256,
  documentId: Uuid.nullable(),
  revisionId: Uuid.nullable(),
  state: z.enum(["complete", "partial"]).nullable(),
  versions: z
    .strictObject({
      indexVersion: z.string(),
      doclingVersion: z.string(),
      ocrEngine: z.string(),
      readerOptions: z.string(),
      chunkerVersion: z.string(),
    })
    .nullable(),
  /** The revision's chunk count; 0 when `revisionId` is null. */
  chunks: z.number().int().min(0),
  pages: z.array(z.strictObject({ page: z.number().int().min(1), source: PageSource })),
});
export type EvalDocument = z.infer<typeof EvalDocument>;

/** What `eval sources` writes: the request's filings as the workspace holds them for one model. */
export const EvalSources = z.strictObject({
  version: z.literal(1),
  model: z.string(),
  documents: z.array(EvalDocument),
});
export type EvalSources = z.infer<typeof EvalSources>;

/** A page of a filing: PDF pages, counted from 1. */
export const PageRef = z.strictObject({ filing: z.string(), page: z.number().int().min(1) });
export type PageRef = z.infer<typeof PageRef>;

/**
 * What `eval rank` writes: the sources, and for each question the pages of each branch's ranking, one entry per
 * chunk in rank order (a page with two chunks shows twice), with no text. Empty when a scope filing has no revision.
 */
export const EvalRankings = EvalSources.extend({
  rankings: z.array(
    z.strictObject({ questionId: z.string(), vector: z.array(PageRef), keyword: z.array(PageRef), hybrid: z.array(PageRef) }),
  ),
});
export type EvalRankings = z.infer<typeof EvalRankings>;

/**
 * What `eval bench` writes: the time to embed `chunks` chunks (the batches after the warm-up) in batches of `batch`,
 * and the median time of one query sent alone.
 */
export const EvalBench = z.strictObject({
  version: z.literal(1),
  model: z.string(),
  batch: z.number().int().min(1),
  chunks: z.number().int().min(0),
  warmupChunks: z.number().int().min(0),
  seconds: z.number().min(0),
  queries: z.number().int().min(0),
  queryMillisMedian: z.number().min(0),
});
export type EvalBench = z.infer<typeof EvalBench>;
