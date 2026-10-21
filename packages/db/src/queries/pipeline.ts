import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../client.js";
import { documentClassification, type ClassificationRow } from "../schema/classification.js";
import { job, document, type DocumentRow, type JobRow } from "../schema/platform.js";
import type { WarningJson } from "../schema/extraction.js";

/** The current figures of a document, as the pipeline needs them: where they were read from, and what the read warned of. */
export interface PipelineRevision {
  id: string;
  source: "pdf" | "xbrl";
  state: "complete" | "partial";
  warnings: WarningJson;
}

/** A document's text index for one embedding model, with counts. `building` is a build in progress, with no finished index yet. */
export interface PipelineIndex {
  state: "building" | "complete" | "partial";
  pageCount: number | null;
  pagesRead: number;
  pagesOcr: number;
  chunks: number;
  /** Distinct elements among the chunks whose text came from XBRL. */
  xbrlBlocks: number;
}

/** Everything `computePipeline` reads about one document. Loaded in batches by `loadPipelineInputs`. */
export interface PipelineInput {
  document: DocumentRow;
  /** The newest classification. */
  classification: ClassificationRow | null;
  /** The current extraction revision, as `getCurrentRevision` picks it. */
  revision: PipelineRevision | null;
  /** The newest job on the document itself, whatever its type. */
  latestJob: JobRow | null;
  /** The newest `document.xbrl` job. */
  xbrlJob: Pick<JobRow, "state"> | null;
  /** The newest `document.index` job. */
  indexJob: Pick<JobRow, "state"> | null;
  index: PipelineIndex | null;
  /** `document.index` jobs queued before the index job, in the order the worker claims them; null unless that job is queued. */
  ahead: number | null;
}

type ByDocument<T> = Map<string, T>;

const uuidList = (ids: string[]): SQL => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

/**
 * What the pipeline of each document needs, in seven queries whatever the number of documents: the documents,
 * their newest classifications, current extraction revisions, newest jobs (the document's, `document.xbrl` and
 * `document.index`, the last with its place in the queue), and the text index for `embeddingModel` with its counts.
 * Every query is scoped to the workspace; an id of another workspace gets no entry. The index is the finished
 * (`complete` or `partial`) revision of the model, else the one being built.
 */
export async function loadPipelineInputs(
  db: Db,
  workspaceId: string,
  documentIds: string[],
  opts: { embeddingModel: string },
): Promise<Map<string, PipelineInput>> {
  const ids = [...new Set(documentIds)];
  if (ids.length === 0) return new Map();
  const list = uuidList(ids);

  const documents = await db.select().from(document).where(and(eq(document.workspaceId, workspaceId), inArray(document.id, ids)));

  const classifications = await db
    .selectDistinctOn([documentClassification.documentId])
    .from(documentClassification)
    .where(and(eq(documentClassification.workspaceId, workspaceId), inArray(documentClassification.documentId, ids)))
    .orderBy(documentClassification.documentId, desc(documentClassification.createdAt), desc(documentClassification.id));

  // `getCurrentRevision`: with a classification, the newest read under its `reads_under_id` (none when it has none);
  // without one, the document's newest revision.
  const revisions = await db.execute<{ document_id: string; id: string; source: PipelineRevision["source"]; state: PipelineRevision["state"]; warnings: WarningJson }>(sql`
    select distinct on (r.document_id) r.document_id, r.id, r.source::text as source, r.state::text as state, r.warnings
    from extraction_revision r
    left join lateral (
      select dc.reads_under_id from document_classification dc
      where dc.workspace_id = r.workspace_id and dc.document_id = r.document_id
      order by dc.created_at desc, dc.id desc
      limit 1
    ) c on true
    where r.workspace_id = ${workspaceId} and r.document_id in (${list})
      and (c.reads_under_id is not null and r.classification_id = c.reads_under_id
           or not exists (select 1 from document_classification x where x.workspace_id = r.workspace_id and x.document_id = r.document_id))
    order by r.document_id, r.created_at desc, r.id desc`);

  const latestJobs = await db
    .selectDistinctOn([job.subjectId])
    .from(job)
    .where(and(eq(job.workspaceId, workspaceId), eq(job.subjectType, "document"), inArray(job.subjectId, ids)))
    .orderBy(job.subjectId, desc(job.createdAt), desc(job.id));

  const xbrlJobs = await db
    .selectDistinctOn([job.subjectId], { documentId: job.subjectId, state: job.state })
    .from(job)
    .where(and(eq(job.workspaceId, workspaceId), eq(job.type, "document.xbrl"), eq(job.subjectType, "document"), inArray(job.subjectId, ids)))
    .orderBy(job.subjectId, desc(job.createdAt), desc(job.id));

  // The place in the queue is taken in the workspace's own jobs, as the worker orders them: `run_after`, then `created_at`.
  const indexJobs = await db.execute<{ document_id: string; state: JobRow["state"]; ahead: number | null }>(sql`
    select l.document_id, l.state::text as state,
      case when l.state = 'queued' then (
        select count(*)::int from job o
        where o.workspace_id = l.workspace_id and o.type = 'document.index' and o.state = 'queued'
          and (o.run_after, o.created_at) < (l.run_after, l.created_at)
      ) end as ahead
    from (
      select distinct on (j.subject_id) j.subject_id as document_id, j.workspace_id, j.state, j.run_after, j.created_at
      from job j
      where j.workspace_id = ${workspaceId} and j.type = 'document.index' and j.subject_type = 'document_index' and j.subject_id in (${list})
      order by j.subject_id, j.created_at desc, j.id desc
    ) l`);

  const indexes = await db.execute<{
    document_id: string; state: PipelineIndex["state"]; page_count: number | null; pages_read: number; pages_ocr: number; chunks: number; xbrl_blocks: number;
  }>(sql`
    select l.document_id, l.state, l.page_count, l.pages_read, l.pages_ocr, n.chunks, n.xbrl_blocks
    from (
      select distinct on (r.document_id) r.id, r.workspace_id, r.document_id, r.state::text as state, r.page_count, r.pages_read, r.pages_ocr
      from document_index_revision r
      where r.workspace_id = ${workspaceId} and r.embedding_model = ${opts.embeddingModel} and r.document_id in (${list})
      order by r.document_id, (r.state in ('complete', 'partial')) desc, r.created_at desc, r.id desc
    ) l
    cross join lateral (
      select count(*)::int as chunks,
             (count(distinct c.element) filter (where c.text_source = 'xbrl'))::int as xbrl_blocks
      from document_chunk c
      where c.workspace_id = l.workspace_id and c.revision_id = l.id
    ) n`);

  const classificationOf: ByDocument<ClassificationRow> = new Map(classifications.map((c) => [c.documentId, c]));
  const revisionOf: ByDocument<PipelineRevision> = new Map(
    revisions.rows.map((r) => [r.document_id, { id: r.id, source: r.source, state: r.state, warnings: r.warnings }]),
  );
  const latestJobOf: ByDocument<JobRow> = new Map(latestJobs.map((j) => [j.subjectId, j]));
  const xbrlJobOf = new Map(xbrlJobs.map((j) => [j.documentId, { state: j.state }]));
  const indexJobOf = new Map(indexJobs.rows.map((j) => [j.document_id, { state: j.state, ahead: j.ahead }]));
  const indexOf: ByDocument<PipelineIndex> = new Map(
    indexes.rows.map((i) => [
      i.document_id,
      { state: i.state, pageCount: i.page_count, pagesRead: i.pages_read, pagesOcr: i.pages_ocr, chunks: i.chunks, xbrlBlocks: i.xbrl_blocks },
    ]),
  );

  return new Map(
    documents.map((d) => {
      const indexJob = indexJobOf.get(d.id);
      return [
        d.id,
        {
          document: d,
          classification: classificationOf.get(d.id) ?? null,
          revision: revisionOf.get(d.id) ?? null,
          latestJob: latestJobOf.get(d.id) ?? null,
          xbrlJob: xbrlJobOf.get(d.id) ?? null,
          indexJob: indexJob ? { state: indexJob.state } : null,
          index: indexOf.get(d.id) ?? null,
          ahead: indexJob?.ahead ?? null,
        },
      ];
    }),
  );
}
