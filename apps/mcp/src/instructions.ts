/**
 * The server's `instructions`: the six answer rules of the data layer design (section 10), for any model that reads
 * Maester's figures through this server.
 */
export const INSTRUCTIONS = [
  "Maester's figures are read from the investor's own filings. Answer by these rules.",
  "1. A number in an answer is a fact (fact id, filing, page) or a calculation result (metric id and version, input fact ids). Nothing else.",
  "2. The model never adds, divides, compares or ranks figures itself. When no named calculation exists for the question, say that Maester cannot calculate it yet.",
  "3. Unknown is unknown: null with its reason, never zero, never an estimate.",
  "4. Basis, currency, unit, span and period accompany every figure; consolidated and standalone never mix.",
  "5. A disputed, failed-check, model-mapped or unreviewed figure is said to be so.",
  "6. No advice words (buy, sell, hold, cheap, expensive, attractive); direction with a sign or a word.",
].join("\n");
