import { MarketSourceError, type DailyPoint, type FredSource } from "./sources.js";

export type FredOptions = { apiKey: string; fetch?: typeof globalThis.fetch; baseUrl?: string };

export class HttpFredSource implements FredSource {
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly baseUrl: string;
  readonly #apiKey: string;
  constructor(opts: FredOptions) {
    this.#apiKey = opts.apiKey;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.baseUrl = opts.baseUrl ?? "https://api.stlouisfed.org/fred";
  }

  private async get(params: Record<string, string>): Promise<DailyPoint[]> {
    const url = new URL(`${this.baseUrl}/series/observations`);
    url.search = new URLSearchParams({ ...params, api_key: this.#apiKey, file_type: "json" }).toString();
    let res: Response;
    try {
      res = await this.fetchFn(url.toString(), { signal: AbortSignal.timeout(30_000) });
    } catch {
      // The error text of fetch can carry the URL, and the URL carries the key.
      throw new MarketSourceError("SOURCE_UNAVAILABLE", "FRED could not be reached");
    }
    // FRED answers 400 for a bad api_key; its error text is not passed on (it can echo the key).
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new MarketSourceError("FRED_KEY_REFUSED", `FRED refused the API key (${res.status})`);
    if (res.status !== 200) throw new MarketSourceError("SOURCE_UNAVAILABLE", `FRED answered ${res.status}`);
    let body: { observations?: { date?: string; value?: string }[] };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new MarketSourceError("SOURCE_UNAVAILABLE", "FRED answered with something that is not JSON");
    }
    const out: DailyPoint[] = [];
    for (const o of body.observations ?? []) {
      if (!o.date || o.value === undefined || o.value === ".") continue; // "." is a missing day, never 0
      const value = Number(o.value);
      if (Number.isFinite(value)) out.push({ day: o.date, value });
    }
    return out;
  }

  observations(seriesId: string, from: string): Promise<DailyPoint[]> {
    return this.get({ series_id: seriesId, observation_start: from });
  }

  async check(): Promise<void> {
    await this.get({ series_id: "VIXCLS", sort_order: "desc", limit: "1" });
  }
}
