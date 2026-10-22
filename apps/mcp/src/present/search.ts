import { z } from "zod";
import type { SearchHit } from "@maester/contracts";

export const SEARCH_FIGURES_SENTENCE =
  "Passages are context. A number in a passage is not a figure Maester has read or checked; use get_statement or get_fact for figures.";

const TEXT_SOURCE_WORDS = { text_layer: "text layer", ocr: "OCR", mixed: "text layer and OCR", xbrl: "XBRL" } as const;

export const SearchAnswerSchema = z.object({
  figures: z.string(),
  passages: z.array(
    z.object({
      text: z.string(),
      filing: z.string(),
      document_id: z.string(),
      company_id: z.string().nullable(),
      company: z.string().nullable(),
      /** 1-based; null for an XBRL passage. */
      page: z.number().int().min(1).nullable(),
      element: z.string().nullable(),
      section: z.array(z.string()),
      text_source: z.string(),
      kind: z.enum(["prose", "table"]),
      vector_rank: z.number().int().min(1).nullable(),
      keyword_rank: z.number().int().min(1).nullable(),
    }),
  ),
});
export type SearchAnswer = z.infer<typeof SearchAnswerSchema>;

/** Passages as found, unedited: a passage is evidence of what a filing says. The only numbers in a hit are its page and ranks. */
export function presentHits(hits: SearchHit[]): SearchAnswer {
  return {
    figures: SEARCH_FIGURES_SENTENCE,
    passages: hits.map((h) => ({
      text: h.text,
      filing: h.documentName,
      document_id: h.documentId,
      company_id: h.companyId,
      company: h.companyName,
      page: h.pageNumber,
      element: h.element,
      section: h.sectionPath,
      text_source: TEXT_SOURCE_WORDS[h.textSource],
      kind: h.kind,
      vector_rank: h.vectorRank,
      keyword_rank: h.keywordRank,
    })),
  };
}
