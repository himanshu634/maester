import type { Db } from "@maester/db";
import type { EvalRequest, EvalSources } from "@maester/contracts";
import { resolveEvalDocuments } from "./resolve.js";

/** A refusal the command prints as it is: it names flags, models, codes, question ids and filing ids, never document text. */
export class EvalRefusal extends Error {}

/** The request's filings as the workspace holds them for `model`. */
export async function buildSources(db: Db, workspaceId: string, model: string, request: EvalRequest): Promise<EvalSources> {
  return { version: 1, model, documents: await resolveEvalDocuments(db, workspaceId, model, request.documents) };
}

/** `sources 12 documents, 11 with a current revision, 4180 chunks`. */
export function sourcesLine(sources: EvalSources): string {
  const withRevision = sources.documents.filter((d) => d.revisionId !== null).length;
  const chunks = sources.documents.reduce((sum, d) => sum + d.chunks, 0);
  return `sources ${sources.documents.length} documents, ${withRevision} with a current revision, ${chunks} chunks`;
}
