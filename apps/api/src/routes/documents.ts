import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  CreateUploadRequest,
  JobTypes,
  ListQuery,
  type CreateUploadResponse,
  type DownloadResponse,
  type FinalizeResponse,
} from "@maester/contracts";
import { getDocument, getLatestJobForSubject, listDocuments, schema, type DocumentRow } from "@maester/db";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError } from "../errors.js";
import { createJob } from "../jobs/create.js";
import { toDocument, toJob } from "../serialize.js";
import { validate } from "../validation.js";

export function storageKeyFor(workspaceId: string, documentId: string): string {
  return `workspaces/${workspaceId}/documents/${documentId}/original.pdf`;
}

function sanitiseName(name: string): string {
  return name.replace(/[\\/]/g, "_").replace(/[^\x20-\x7E]/g, "_").slice(0, 255);
}

export function documentRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();

  r.post("/uploads", validate("json", CreateUploadRequest), async (c) => {
    const input = c.req.valid("json");
    const workspace = c.get("workspace");
    if (input.size > deps.env.MAX_UPLOAD_BYTES) {
      throw new HttpError("UPLOAD_TOO_LARGE", `uploads are limited to ${deps.env.MAX_UPLOAD_BYTES} bytes`, [{ path: "size", message: "too large" }]);
    }
    const id = crypto.randomUUID();
    const storageKey = storageKeyFor(workspace.id, id);
    const [row] = await deps.db
      .insert(schema.document)
      .values({
        id,
        workspaceId: workspace.id,
        originalName: sanitiseName(input.originalName),
        declaredSize: input.size,
        declaredMime: input.mimeType,
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
      document: toDocument(row!, null),
      upload: { method: "PUT", url: signed.url, headers: signed.headers, expiresAt: signed.expiresAt.toISOString() },
    };
    return c.json(body, 201);
  });

  r.post("/:id/finalize", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, c.req.param("id"));
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
    const body: FinalizeResponse = { document: toDocument(current, job), job: toJob(job) };
    return c.json(body);
  });

  r.get("/", validate("query", ListQuery), async (c) => {
    const q = c.req.valid("query");
    const workspace = c.get("workspace");
    const page = await listDocuments(deps.db, workspace.id, { cursor: q.cursor, limit: q.limit });
    const items = await Promise.all(
      page.items.map(async (d) => toDocument(d, await getLatestJobForSubject(deps.db, workspace.id, "document", d.id))),
    );
    return c.json({ items, nextCursor: page.nextCursor });
  });

  r.get("/:id", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, c.req.param("id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    const job = await getLatestJobForSubject(deps.db, workspace.id, "document", doc.id);
    return c.json(toDocument(doc, job));
  });

  r.get("/:id/download", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, c.req.param("id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    if (doc.state !== "stored") throw new HttpError("INVALID_STATE", `document is ${doc.state}`);
    const signed = await deps.store.signDownload(doc.storageKey, { expiresInSeconds: deps.env.DOWNLOAD_URL_TTL_SECONDS });
    const body: DownloadResponse = { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
    return c.json(body);
  });

  return r;
}
