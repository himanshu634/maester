import { sql, type SQL } from "drizzle-orm";
import type { SearchHit } from "@maester/contracts";
import type { Db } from "@maester/db";
import { EmbedderError, type Embedder } from "./embedder.js";

const BRANCH_LIMIT = 50;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const RRF_K = 60;

export interface SearchInput {
  workspaceId: string;
  query: string;
  limit?: number;
  companyId?: string;
  documentIds?: string[];
}

export interface Fused {
  id: string;
  score: number;
  /** 1-based place in the vector ranking; null when the vector branch did not return it. */
  vectorRank: number | null;
  keywordRank: number | null;
}

/**
 * Reciprocal rank fusion of two rankings of chunk ids (best first): score is the sum of 1/(k + rank), ranks from 1.
 * Ties go to the better vector rank, then the better keyword rank, then the id.
 */
export function fuse(vector: string[], keyword: string[], k = RRF_K): Fused[] {
  const byId = new Map<string, Fused>();
  const entry = (id: string): Fused => {
    let e = byId.get(id);
    if (!e) byId.set(id, (e = { id, score: 0, vectorRank: null, keywordRank: null }));
    return e;
  };
  vector.forEach((id, i) => {
    const e = entry(id);
    if (e.vectorRank === null) {
      e.vectorRank = i + 1;
      e.score += 1 / (k + i + 1);
    }
  });
  keyword.forEach((id, i) => {
    const e = entry(id);
    if (e.keywordRank === null) {
      e.keywordRank = i + 1;
      e.score += 1 / (k + i + 1);
    }
  });
  const rank = (r: number | null) => r ?? Number.POSITIVE_INFINITY;
  return [...byId.values()].sort(
    (a, b) =>
      b.score - a.score ||
      rank(a.vectorRank) - rank(b.vectorRank) ||
      rank(a.keywordRank) - rank(b.keywordRank) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export interface BranchInput extends Pick<SearchInput, "workspaceId" | "companyId" | "documentIds"> {
  /** The embedding model whose vectors and revisions are searched. */
  model: string;
  /** The query vector. */
  vector: number[];
}

const isFiltered = (i: Pick<SearchInput, "companyId" | "documentIds">) => i.companyId !== undefined || i.documentIds !== undefined;

const toVector = (v: number[]) => `[${v.join(",")}]`;

/** The chunks a search may return: this workspace, a complete or partial revision built for this model, and the filters. */
function scope(input: Pick<BranchInput, "workspaceId" | "model" | "companyId" | "documentIds">, chunk: SQL, revision: SQL): SQL {
  const parts: SQL[] = [
    sql`${chunk}.workspace_id = ${input.workspaceId}`,
    sql`${revision}.state in ('complete', 'partial')`,
    sql`${revision}.embedding_model = ${input.model}`,
  ];
  if (input.companyId) {
    parts.push(sql`${chunk}.document_id in (select d.id from document d where d.workspace_id = ${input.workspaceId} and d.company_id = ${input.companyId})`);
  }
  if (input.documentIds) {
    parts.push(
      input.documentIds.length === 0
        ? sql`false`
        : sql`${chunk}.document_id in (${sql.join(input.documentIds.map((id) => sql`${id}::uuid`), sql`, `)})`,
    );
  }
  return sql.join(parts, sql` and `);
}

/**
 * The vector branch's statement. Unfiltered, it orders by the halfvec expression that the HNSW index is built on, in a
 * materialized CTE, and re-sorts by distance outside it (relaxed-order iterative scans can return rows slightly out of
 * order). Filtered by company or documents, it orders by the full-precision vector, which the HNSW expression index
 * does not serve, so the B-tree on (workspace_id, document_id) filters first and the scan is exact.
 */
export function vectorBranchSql(input: BranchInput, exact = false): SQL {
  const q = toVector(input.vector);
  const where = scope(input, sql`c`, sql`r`);
  const base = sql`from chunk_embedding e
    join document_chunk c on c.id = e.chunk_id
    join document_index_revision r on r.id = c.revision_id
    where e.model = ${input.model} and e.workspace_id = ${input.workspaceId} and ${where}`;
  if (exact || isFiltered(input)) {
    return sql`select c.id as id ${base}
      order by e.embedding <=> ${q}::vector, c.id limit ${BRANCH_LIMIT}`;
  }
  // The scan stays on chunk_embedding alone, so the planner can order it by the index. The revision test is a
  // correlated scalar subquery, which the planner cannot pull up into a join; it runs as a filter on the index scan,
  // where an iterative scan keeps going until it has enough rows that pass it.
  return sql`with nearest as materialized (
      select e.chunk_id as id, e.embedding::halfvec(1024) <=> ${q}::halfvec(1024) as distance
      from chunk_embedding e
      where e.model = ${input.model} and e.workspace_id = ${input.workspaceId}
        and coalesce((
          select true from document_chunk c join document_index_revision r on r.id = c.revision_id
          where c.id = e.chunk_id and ${scope({ workspaceId: input.workspaceId, model: input.model }, sql`c`, sql`r`)}
        ), false)
      order by e.embedding::halfvec(1024) <=> ${q}::halfvec(1024) limit ${BRANCH_LIMIT}
    ) select id from nearest order by distance, id`;
}

/** The keyword branch's statement: the "simple" configuration, so a CIN and a company name match as printed. */
export function keywordBranchSql(input: Omit<BranchInput, "vector"> & { query: string }): SQL {
  const where = scope(input, sql`c`, sql`r`);
  return sql`select c.id as id
    from document_chunk c
    join document_index_revision r on r.id = c.revision_id
    cross join (select websearch_to_tsquery('simple', ${input.query}) as tsq) q
    where c.tsv @@ q.tsq and ${where}
    order by ts_rank(c.tsv, q.tsq) desc, c.id
    limit ${BRANCH_LIMIT}`;
}

const idsOf = (rows: Record<string, unknown>[]): string[] => rows.map((r) => String(r.id));

export async function searchChunks(db: Db, embedder: Embedder, input: SearchInput): Promise<SearchHit[]> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(Number.isFinite(input.limit) ? input.limit! : DEFAULT_LIMIT)));
  const [vector] = await embedder.embed([input.query], "query");
  if (!vector) throw new EmbedderError("EMBEDDING_FAILED", false, "The embedder returned no vector.");
  const branch: BranchInput = {
    workspaceId: input.workspaceId, model: embedder.model, vector,
    ...(input.companyId !== undefined ? { companyId: input.companyId } : {}),
    ...(input.documentIds !== undefined ? { documentIds: input.documentIds } : {}),
  };

  // The branches and the hit load read one snapshot, so a rebuild that completes mid-search cannot delete the chunks
  // the branches found. Postgres takes the snapshot at the first statement that reads (a `set` takes none), and a
  // read-only transaction under repeatable read never fails with a serialization error.
  const { top, rows } = await db.transaction(
    async (tx) => {
      let vectorIds: string[];
      if (isFiltered(input)) {
        vectorIds = idsOf((await tx.execute(vectorBranchSql(branch))).rows);
      } else {
        await tx.execute(sql`set local hnsw.ef_search = 100`);
        await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
        vectorIds = idsOf((await tx.execute(vectorBranchSql(branch))).rows);
        // An iterative scan stops at hnsw.max_scan_tuples, so a model or workspace with few vectors among many can get
        // a short answer. A short answer is checked exactly (the workspace's own chunks are few in that case).
        if (vectorIds.length < BRANCH_LIMIT) vectorIds = idsOf((await tx.execute(vectorBranchSql(branch, true))).rows);
      }
      const keywordIds = idsOf((await tx.execute(keywordBranchSql({ ...branch, query: input.query }))).rows);

      const top = fuse(vectorIds, keywordIds).slice(0, limit);
      if (top.length === 0) return { top, rows: [] };
      const ids = sql.join(top.map((t) => sql`${t.id}::uuid`), sql`, `);
      const rows = (
        await tx.execute(sql`select c.id, c.document_id, d.original_name as document_name, d.company_id, co.display_name as company_name,
            c.page_number, c.element, c.section_path, c.text_source, c.kind, c.text
          from document_chunk c
          join document d on d.id = c.document_id
          left join company co on co.id = d.company_id
          where c.workspace_id = ${input.workspaceId} and c.id in (${ids})`)
      ).rows;
      return { top, rows };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  if (top.length === 0) return [];
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const hits: SearchHit[] = [];
  for (const t of top) {
    const r = byId.get(t.id);
    if (!r) continue;
    hits.push({
      documentId: String(r.document_id),
      documentName: String(r.document_name),
      companyId: r.company_id === null ? null : String(r.company_id),
      companyName: r.company_name === null ? null : String(r.company_name),
      pageNumber: r.page_number === null ? null : Number(r.page_number),
      element: r.element === null ? null : String(r.element),
      sectionPath: r.section_path as string[],
      textSource: r.text_source as SearchHit["textSource"],
      kind: r.kind as SearchHit["kind"],
      text: String(r.text),
      vectorRank: t.vectorRank,
      keywordRank: t.keywordRank,
    });
  }
  return hits;
}
