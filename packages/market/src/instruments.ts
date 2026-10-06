import type { Instrument } from "./sources.js";

// Values from docs/research/2026-10-06-dhan-api-notes.md, checked 6 Oct 2026, from docs, not yet called live.
// The ids of the two indices come from the scrip master CSV (NSE segment I); a name does not match them, only the id.

/** NIFTY 50: trading symbol "NIFTY", custom symbol "Nifty 50". */
export const NIFTY_50: Instrument = { securityId: "13", exchangeSegment: "IDX_I", instrument: "INDEX" };
/** INDIA VIX. */
export const INDIA_VIX: Instrument = { securityId: "21", exchangeSegment: "IDX_I", instrument: "INDEX" };

/**
 * MCX gold has no fixed id: it changes at every expiry (495213 was GOLD-04Dec2026-FUT on 6 Oct 2026).
 * Pick contracts from the scrip master by this exact SM_SYMBOL_NAME; GOLDM, GOLDGUINEA, GOLDPETAL and GOLDTEN are others.
 */
export const MCX_GOLD_NAME = "GOLD";

/** The option chain call takes the number, where the history call takes a string. */
export const NIFTY_OPTION_UNDERLYING = { scrip: 13, seg: "IDX_I" } as const;

export const SCRIP_MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master.csv";
