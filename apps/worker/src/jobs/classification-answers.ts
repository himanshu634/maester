import type { ClassificationResult, ReportingBasis, XbrlClassification } from "@maester/contracts";

/** One answer's evidence as it is stored. A PDF's has a page and no element; an XBRL instance's has an element and no page. */
export interface StoredEvidence {
  field: ClassificationResult["evidence"][number]["field"];
  source: "rule" | "model";
  ruleId: string | null;
  pageIndex: number | null;
  quote: string | null;
  textLayerMatch: boolean | null;
  element: string | null;
  context: string | null;
}

/**
 * What a classifier answered, from a PDF or from an XBRL instance, in the shape `writeClassification` stores:
 * the PDF result without its page count, plus what only an instance has.
 */
export interface ClassificationAnswers extends Omit<ClassificationResult, "pageCount" | "evidence"> {
  isin: string | null;
  /** The instance's format id, such as `in-capmkt/ind_as`; null for a PDF. */
  xbrlFormat: string | null;
  /** An instance's basis, `unknown` included; null for a PDF, whose bases are in `statementsFound`. */
  basis: ReportingBasis | null;
  evidence: StoredEvidence[];
}

export function answersFromPdf(r: ClassificationResult): ClassificationAnswers {
  return {
    rulesVersion: r.rulesVersion,
    model: r.model,
    promptVersion: r.promptVersion,
    kind: r.kind,
    otherType: r.otherType,
    resultsSpan: r.resultsSpan,
    periodEnd: r.periodEnd,
    periodLabel: r.periodLabel,
    companyNameAsPrinted: r.companyNameAsPrinted,
    cin: r.cin,
    bseCode: r.bseCode,
    nseSymbol: r.nseSymbol,
    isin: null,
    xbrlFormat: null,
    basis: null,
    statementsFound: r.statementsFound,
    warnings: r.warnings,
    evidence: r.evidence.map((e) => ({
      field: e.field, source: e.source, ruleId: e.ruleId, pageIndex: e.pageIndex, quote: e.quote, textLayerMatch: e.textLayerMatch,
      element: null, context: null,
    })),
  };
}

/** An instance is classified by rule alone: no model, no page, and the element and context each answer was read from. */
export function answersFromXbrl(r: XbrlClassification): ClassificationAnswers {
  return {
    rulesVersion: `xbrl-${r.parserVersion}`,
    model: null,
    promptVersion: r.format.id ? `${r.format.id}@${r.mapVersion}` : null,
    kind: r.kind,
    otherType: null,
    resultsSpan: r.resultsSpan,
    periodEnd: r.periodEnd,
    periodLabel: r.periodLabel,
    companyNameAsPrinted: r.companyNameAsPrinted,
    cin: r.cin,
    bseCode: r.bseCode,
    nseSymbol: r.nseSymbol,
    isin: r.isin,
    xbrlFormat: r.format.id,
    basis: r.basis,
    statementsFound: r.statementsFound,
    evidence: r.evidence.map((e) => ({
      field: e.field, source: "rule", ruleId: e.ruleId, pageIndex: null, quote: e.quote, textLayerMatch: null, element: e.element, context: e.context,
    })),
    warnings: r.warnings,
  };
}
