# @maester/document-index

The embedding model registry, the one function that adds the query prefix (`embeddingInput`), the text-embeddings-inference client (`TeiEmbedder`) and a deterministic `FakeEmbedder` for tests. `contextualize` is re-exported from `@maester/contracts`.

Test: `pnpm --filter @maester/document-index test`.
