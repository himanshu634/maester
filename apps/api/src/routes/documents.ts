import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  CreateUploadRequest,
  DOCUMENT_INDEX_SUBJECT,
  FactsQuery,
  JobTypes,
  ListQuery,
  formatForMime,
  type CreateUploadResponse,
  type DocumentFormat,
  type DocumentExtraction,
  type DocumentFacts,
  type DownloadResponse,
  type ExtractResponse,
  type FinalizeResponse,
  type IndexResponse,
} from "@maester/contracts";
import {
  companyIdentity,
  getCompany,
  getCurrentClassification,
  getCurrentRevision,
  getDocument,
  getRevision,
  listChecks,
  listDocuments,
  listFactsWithSources,
  loadWorkspaceXbrlDocs,
  schema,
  type Db,
  type DocumentRow,
} from "@maester/db";
import { indexPipelineVersion } from "@maester/document-index";
import { planPdfNumbers } from "@maester/financial-engine";
import { pdfNumbersInput } from "@maester/jobs";
import type { AppDeps, AppEnv } from "../app.js";
import { documentPipelines } from "../documents/pipeline.js";
import { HttpError } from "../errors.js";
import { createJob, retryJob } from "../jobs/create.js";
import { uuidParam } from "../middleware/params.js";
import { toCheck, toDocument, toFact, toJob, toRevision } from "../serialize.js";
import { validate } from "../validation.js";

export function storageKeyFor(workspaceId: string, documentId: string, format: DocumentFormat): string {
  return `workspaces/${workspaceId}/documents/${documentId}/original.${format === "xbrl" ? "xml" : "pdf"}`;
}

function sanitiseName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 255);
}

/**
 * A results PDF whose numbers XBRL covers, or will once its XBRL settles, is not read by a model: the
 * source rule decides, as intake does. A PDF with no company is read as before (the rule needs one).
 */
async function refuseReadCoveredByXbrl(db: Db, doc: DocumentRow): Promise<void> {
  if (doc.format !== "pdf") return;
  const c = await getCurrentClassification(db, doc.workspaceId, doc.id);
  if (!c?.companyId) return;
  const pdf = pdfNumbersInput(c, await companyIdentity(db, doc.workspaceId, c.companyId));
  if (!pdf) return;
  const plan = planPdfNumbers(pdf, await loadWorkspaceXbrlDocs(db, doc.workspaceId, { companyIds: [c.companyId] }));
  if (plan.action === "skip") throw new HttpError("INVALID_STATE", "this document's numbers come from XBRL");
  if (plan.action === "wait") throw new HttpError("INVALID_STATE", "this document is waiting for its XBRL file");
}

export function documentRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  const pipelineOf = async (workspaceId: string, documentId: string) =>
    (await documentPipelines(deps.db, workspaceId, [documentId], deps.env.EMBEDDING_MODEL)).get(documentId)!.pipeline;

  r.post("/uploads", validate("json", CreateUploadRequest), async (c) => {
    const input = c.req.valid("json");
    const workspace = c.get("workspace");
    if (input.size > deps.env.MAX_UPLOAD_BYTES) {
      throw new HttpError("UPLOAD_TOO_LARGE", `uploads are limited to ${deps.env.MAX_UPLOAD_BYTES} bytes`, [{ path: "size", message: "too large" }]);
    }
    if (input.companyId && !(await getCompany(deps.db, workspace.id, input.companyId))) {
      throw new HttpError("VALIDATION_FAILED", "company not found in this workspace", [{ path: "companyId", message: "unknown company" }]);
    }
    const id = crypto.randomUUID();
    const format = formatForMime(input.mimeType);
    const storageKey = storageKeyFor(workspace.id, id, format);
    const [row] = await deps.db
      .insert(schema.document)
      .values({
        id,
        workspaceId: workspace.id,
        companyId: input.companyId ?? null,
        originalName: sanitiseName(input.originalName),
        declaredSize: input.size,
        declaredMime: input.mimeType,
        format,
        storageKey,
        state: "pending_upload",
        createdByUserId: c.get("user").id,
      })
      .returning();
    const signed = await deps.store.signUpload(storageKey, {
      contentType: input.mimeType,
      contentLength: input.size,
      expiresInSeconds: deps.env.UPLOAD_URL_TTL_SECONDS,
    });
    const body: CreateUploadResponse = {
      document: toDocument(row!, null, null, await pipelineOf(workspace.id, id)),
      upload: { method: "PUT", url: signed.url, headers: signed.headers, expiresAt: signed.expiresAt.toISOString() },
    };
    return c.json(body, 201);
  });

  r.post("/:id/finalize", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, uuidParam(c, "id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    if (doc.state === "rejected") throw new HttpError("INVALID_STATE", "document was rejected; create a new upload");

    let current: DocumentRow = doc;
    if (doc.state === "pending_upload") {
      if (!(await deps.store.exists(doc.storageKey))) {
        throw new HttpError("INVALID_STATE", "upload has not been received yet");
      }
      const [updated] = await deps.db
        .update(schema.document)
        .set({ state: "uploaded", updatedAt: sql`now()` })
        .where(and(eq(schema.document.id, doc.id), eq(schema.document.state, "pending_upload")))
        .returning();
      current = updated ?? (await getDocument(deps.db, workspace.id, doc.id))!;
    }

    const job = await createJob(deps.db, deps.dispatcher, {
      workspaceId: workspace.id,
      type: JobTypes.DOCUMENT_VERIFY,
      subjectType: "document",
      subjectId: current.id,
    });
    const body: FinalizeResponse = { document: toDocument(current, job, null, await pipelineOf(workspace.id, current.id)), job: toJob(job) };
    return c.json(body);
  });

  r.get("/", validate("query", ListQuery), async (c) => {
    const q = c.req.valid("query");
    const workspace = c.get("workspace");
    const page = await listDocuments(deps.db, workspace.id, { cursor: q.cursor, limit: q.limit });
    const views = await documentPipelines(deps.db, workspace.id, page.items.map((d) => d.id), deps.env.EMBEDDING_MODEL);
    const items = page.items.map((d) => {
      const { input, pipeline } = views.get(d.id)!;
      return toDocument(d, input.latestJob, input.classification, pipeline);
    });
    return c.json({ items, nextCursor: page.nextCursor });
  });

  r.get("/:id", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, uuidParam(c, "id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    const { input, pipeline } = (await documentPipelines(deps.db, workspace.id, [doc.id], deps.env.EMBEDDING_MODEL)).get(doc.id)!;
    return c.json(toDocument(doc, input.latestJob, input.classification, pipeline));
  });

  r.get("/:id/download", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, uuidParam(c, "id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    if (doc.state !== "stored") throw new HttpError("INVALID_STATE", `document is ${doc.state}`);
    const signed = await deps.store.signDownload(doc.storageKey, { expiresInSeconds: deps.env.DOWNLOAD_URL_TTL_SECONDS });
    const body: DownloadResponse = { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
    return c.json(body);
  });

  // The PDF itself, for a plain link: "…/file#page=213" opens it at the page, since the browser
  // keeps the fragment across this redirect. Signed for a short while and never cached.
  r.get("/:id/file", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, uuidParam(c, "id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    if (doc.state !== "stored") throw new HttpError("INVALID_STATE", `document is ${doc.state}`);
    const signed = await deps.store.signDownload(doc.storageKey, { expiresInSeconds: deps.env.DOWNLOAD_URL_TTL_SECONDS });
    c.header("Cache-Control", "no-store");
    return c.redirect(signed.url, 302);
  });

  r.post("/:id/extract", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, uuidParam(c, "id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    if (doc.state !== "stored") throw new HttpError("INVALID_STATE", `document is ${doc.state}; only stored documents can be extracted`);
    await refuseReadCoveredByXbrl(deps.db, doc);
    const job = await createJob(deps.db, deps.dispatcher, {
      workspaceId: workspace.id,
      type: doc.format === "xbrl" ? JobTypes.DOCUMENT_XBRL : JobTypes.DOCUMENT_EXTRACT,
      subjectType: "document",
      subjectId: doc.id,
      // Every manual run is a new job and produces a new revision.
      pipelineVersion: `manual-${crypto.randomUUID()}`,
    });
    const body: ExtractResponse = { job: toJob(job) };
    return c.json(body, 202);
  });

  // Queues the text index of a stored document again: the job `verify` makes, found by its key. A failed one is
  // retried with its attempts given back; one that is queued or running is answered as it is.
  r.post("/:id/index", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, uuidParam(c, "id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    if (doc.state !== "stored") throw new HttpError("INVALID_STATE", `document is ${doc.state}; only stored documents are indexed`);
    if (doc.intakeState === "duplicate" || doc.duplicateOfDocumentId !== null) throw new HttpError("INVALID_STATE", "a duplicate is not indexed");
    const job = await createJob(deps.db, deps.dispatcher, {
      workspaceId: workspace.id,
      type: JobTypes.DOCUMENT_INDEX,
      subjectType: DOCUMENT_INDEX_SUBJECT,
      subjectId: doc.id,
      pipelineVersion: indexPipelineVersion(deps.env.EMBEDDING_MODEL),
    });
    if (job.state === "succeeded") throw new HttpError("INVALID_STATE", "the index is built");
    if (job.state === "cancelled") throw new HttpError("INVALID_STATE", "the index job was cancelled");
    const body: IndexResponse = { job: toJob(job.state === "failed" ? await retryJob(deps.db, deps.dispatcher, workspace.id, job.id) : job) };
    return c.json(body, 202);
  });

  r.get("/:id/extraction", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, uuidParam(c, "id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    const revision = await getCurrentRevision(deps.db, workspace.id, doc.id);
    if (!revision) throw new HttpError("NOT_FOUND", "document has no extraction yet");
    const checks = await listChecks(deps.db, workspace.id, revision.id);
    const body: DocumentExtraction = { revision: toRevision(revision), checks: checks.map(toCheck) };
    return c.json(body);
  });

  r.get("/:id/facts", validate("query", FactsQuery), async (c) => {
    const q = c.req.valid("query");
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, uuidParam(c, "id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    const revision = q.revisionId
      ? await getRevision(deps.db, workspace.id, doc.id, q.revisionId)
      : await getCurrentRevision(deps.db, workspace.id, doc.id);
    if (!revision) throw new HttpError("NOT_FOUND", q.revisionId ? "revision not found" : "document has no extraction yet");
    const facts = await listFactsWithSources(deps.db, workspace.id, revision.id);
    const body: DocumentFacts = { revision: toRevision(revision), facts: facts.map(toFact) };
    return c.json(body);
  });

  return r;
}
