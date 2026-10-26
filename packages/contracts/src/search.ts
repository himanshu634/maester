import { z } from "zod";
import { ChunkKind, TextSource } from "./document-index.js";

/** One passage of a document found by search. It carries text and where it came from, never a figure. */
export const SearchHit = z.strictObject({
  documentId: z.uuid(),
  documentName: z.string(),
  companyId: z.uuid().nullable(),
  companyName: z.string().nullable(),
  /** 1-based; null only for a future XBRL chunk. */
  pageNumber: z.number().int().min(1).nullable(),
  element: z.string().nullable(),
  sectionPath: z.array(z.string()),
  textSource: TextSource,
  kind: ChunkKind,
  text: z.string(),
  /** 1-based place in the vector branch; null when only the keyword branch found it. */
  vectorRank: z.number().int().min(1).nullable(),
  /** 1-based place in the keyword branch; null when only the vector branch found it. */
  keywordRank: z.number().int().min(1).nullable(),
});
export type SearchHit = z.infer<typeof SearchHit>;

export const SearchResults = z.strictObject({ items: z.array(SearchHit) });
export type SearchResults = z.infer<typeof SearchResults>;
