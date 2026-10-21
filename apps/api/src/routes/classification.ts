import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  ChangeClassificationRequest,
  JobTypes,
  type ClassificationChanged,
  type ClassifyJobResponse,
  type DocumentClassification,
} from "@maester/contracts";
import { getCurrentClassification, getDocument, listEvidence, schema, type ClassificationRow } from "@maester/db";
import { decideIntake, redecidePdfsAfterXbrl } from "@maester/jobs";
import type { AppDeps, AppEnv } from "../app.js";
import { documentPipelines } from "../documents/pipeline.js";
import { writeInvestorClassification } from "../documents/reclassify.js";
import { HttpError, isUniqueViolation } from "../errors.js";
import { createJob } from "../jobs/create.js";
import { uuidParam } from "../middleware/params.js";
import { toClassification, toDocument, toEvidence, toJob } from "../serialize.js";
import { validate } from "../validation.js";

export function classificationRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();

  r.get("/:id/classification", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, uuidParam(c, "id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    const current = await getCurrentClassification(deps.db, workspace.id, doc.id);
    if (!current) throw new HttpError("NOT_FOUND", "document has not been identified yet");
    const evidence = await listEvidence(deps.db, workspace.id, current.id);
    const body: DocumentClassification = { classification: toClassification(current), evidence: evidence.map(toEvidence) };
    return c.json(body);
  });

  r.post("/:id/classification", validate("json", ChangeClassificationRequest), async (c) => {
    const input = c.req.valid("json");
    const workspace = c.get("workspace");
    const userId = c.get("user").id;
    const documentId = uuidParam(c, "id");

    let created: { row: ClassificationRow; read: boolean };
    try {
      created = await deps.db.transaction((tx) => writeInvestorClassification(tx, workspace.id, userId, documentId, input));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError("CONFLICT", "a company with this name or identifier already exists", [{ path: "company.new", message: "already exists" }]);
      }
      throw err;
    }

    await decideIntake(deps.db, deps.dispatcher, created.row, { read: created.read });
    const doc = (await getDocument(deps.db, workspace.id, documentId))!;
    // An instance's new answers may release the PDFs that wait on XBRL, or send a covered one back to be read.
    if (doc.format === "xbrl") await redecidePdfsAfterXbrl(deps.db, deps.dispatcher, workspace.id);
    const { input: loaded, pipeline } = (await documentPipelines(deps.db, workspace.id, [documentId], deps.env.EMBEDDING_MODEL)).get(documentId)!;
    const evidence = await listEvidence(deps.db, workspace.id, created.row.id);
    const body: ClassificationChanged = {
      document: toDocument(doc, loaded.latestJob, created.row, pipeline),
      classification: toClassification(created.row),
      evidence: evidence.map(toEvidence),
    };
    return c.json(body);
  });

  r.post("/:id/classify", async (c) => {
    const workspace = c.get("workspace");
    const doc = await getDocument(deps.db, workspace.id, uuidParam(c, "id"));
    if (!doc) throw new HttpError("NOT_FOUND", "document not found");
    if (doc.state !== "stored") throw new HttpError("INVALID_STATE", `document is ${doc.state}; only stored documents can be classified`);
    await deps.db
      .update(schema.document)
      .set({ intakeState: "identifying", updatedAt: sql`now()` })
      .where(and(eq(schema.document.id, doc.id), eq(schema.document.workspaceId, workspace.id)));
    const job = await createJob(deps.db, deps.dispatcher, {
      workspaceId: workspace.id,
      type: JobTypes.DOCUMENT_CLASSIFY,
      subjectType: "document",
      subjectId: doc.id,
      pipelineVersion: `manual-${crypto.randomUUID()}`,
    });
    const body: ClassifyJobResponse = { job: toJob(job) };
    return c.json(body, 202);
  });

  return r;
}
