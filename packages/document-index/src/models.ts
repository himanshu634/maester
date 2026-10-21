export const INDEX_PIPELINE_VERSION = "1";

export function indexPipelineVersion(model: string): string {
  return `${INDEX_PIPELINE_VERSION}:${model}`;
}

/** The width of the vector columns (`vector(1024)`, `halfvec(1024)`). A model keeps at most this many values. */
export const STORED_DIMENSIONS = 1024;

export interface EmbeddingModel {
  /** How many values the embedder answers with for one text. */
  servedDimensions: number;
  /**
   * How many of them Maester keeps: `dimensions <= servedDimensions` and `dimensions <= STORED_DIMENSIONS`. A model
   * that serves more is cut to its first `dimensions` values and renormalised; one that keeps fewer than the column
   * holds is padded with zeros, which changes neither a dot product nor a norm. `toStored` (embedder.ts) does both.
   */
  dimensions: number;
  queryPrefix: string;
  documentPrefix: string;
  /**
   * Where the prefixes come from: "card" (the model's own `config_sentence_transformers.json` prompts), "ours" (a
   * task sentence we wrote, in the format the model card gives) or "none" (the model takes plain text).
   */
  promptsFrom: "card" | "ours" | "none";
}

/**
 * The models Maester can embed with. The first is the live one; the others are candidates that the phase 3 retrieval
 * measurement compares. `packages/contracts/fixtures/index/embedding-models.json` pins this table for the indexer's
 * parity check, and `apps/indexer/models.lock.json` pins the revisions the weights are fetched at.
 */
export const EMBEDDING_MODELS: Record<string, EmbeddingModel> = {
  "Snowflake/snowflake-arctic-embed-l-v2.0": {
    servedDimensions: 1024,
    dimensions: 1024,
    queryPrefix: "query: ",
    documentPrefix: "",
    promptsFrom: "card",
  },
  "Qwen/Qwen3-Embedding-0.6B": {
    servedDimensions: 1024,
    dimensions: 1024,
    // The model card's format is `Instruct: {task}\nQuery:{query}`, with no space after the colon. The task is ours.
    queryPrefix:
      "Instruct: Given an investor's question about an Indian listed company, retrieve the passages of its annual report or financial results that answer it\nQuery:",
    documentPrefix: "",
    promptsFrom: "ours",
  },
  "voyageai/voyage-4-nano": {
    servedDimensions: 2048,
    dimensions: 1024,
    queryPrefix: "Represent the query for retrieving supporting documents: ",
    documentPrefix: "Represent the document for retrieval: ",
    promptsFrom: "card",
  },
  "ibm-granite/granite-embedding-english-r2": {
    servedDimensions: 768,
    dimensions: 768,
    queryPrefix: "",
    documentPrefix: "",
    promptsFrom: "none",
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
