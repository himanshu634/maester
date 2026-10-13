export type DailyPoint = { day: string; value: number };
export type Instrument = { securityId: string; exchangeSegment: string; instrument: string; expiryCode?: number };
export type GoldContract = Instrument & { expiry: string };

export interface DhanSource {
  /** Daily closes, oldest first. `from` and `to` are inclusive IST days, YYYY-MM-DD. */
  daily(inst: Instrument, from: string, to: string): Promise<DailyPoint[]>;
  /** Nearest Nifty expiry: Σ put OI ÷ Σ call OI. */
  putCallRatio(): Promise<number>;
  /** NSE symbol → NSE_EQ security id. */
  equityIds(): Promise<Map<string, string>>;
  /** Unexpired MCX GOLD futures from the scrip master, earliest expiry first. */
  goldContracts(): Promise<GoldContract[]>;
  profile(): Promise<{ clientId: string; tokenExpiresAt: string | null; dataPlanActive: boolean | null }>;
  /** Expires the current token and issues a new one. Works only for web-generated tokens. */
  renewToken(): Promise<{ accessToken: string; expiresAt: string | null }>;
}

export interface FredSource {
  observations(seriesId: string, from: string): Promise<DailyPoint[]>;
  /** Reads one VIXCLS observation; throws MarketSourceError when the key does not work. */
  check(): Promise<void>;
}

export class MarketSourceError extends Error {
  constructor(
    /**
     * FRED_KEY_REFUSED: FRED answered 400, 401 or 403, which it does for a wrong api_key.
     * DHAN_NO_DATA_PLAN: Dhan answered DH-902 or 806, the Data API subscription is not active.
     */
    readonly code: "DHAN_TOKEN_EXPIRED" | "DHAN_RATE_LIMITED" | "DHAN_NO_DATA_PLAN" | "FRED_KEY_REFUSED" | "SOURCE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "MarketSourceError";
  }
}

/** Epoch seconds → the IST calendar day, YYYY-MM-DD. */
export function ist(epochSeconds: number): string {
  return new Date((epochSeconds + 19_800) * 1000).toISOString().slice(0, 10);
}
