export const INDEX_PIPELINE_VERSION = "1";

export function indexPipelineVersion(model: string): string {
  return `${INDEX_PIPELINE_VERSION}:${model}`;
}

export interface EmbeddingModel {
  dimensions: 1024;
  queryPrefix: string;
  documentPrefix: string;
}

export const EMBEDDING_MODELS: Record<string, EmbeddingModel> = {
  "Snowflake/snowflake-arctic-embed-l-v2.0": {
    dimensions: 1024,
    queryPrefix: "query: ",
    documentPrefix: "",
  },
};

export function embeddingModel(id: string): EmbeddingModel {
  const found = Object.hasOwn(EMBEDDING_MODELS, id) ? EMBEDDING_MODELS[id] : undefined;
  if (!found) throw new Error(`Unknown embedding model: ${id}`);
  return found;
}

/** The one place a prefix is added; the worker and the API both call it. */
export function embeddingInput(model: string, kind: "query" | "document", text: string): string {
  const m = embeddingModel(model);
  return (kind === "query" ? m.queryPrefix : m.documentPrefix) + text;
}
