import { SCRIP_MASTER_URL, NIFTY_OPTION_UNDERLYING } from "./instruments.js";
import { equityIdsFrom, goldContractsFrom, keepScripRow, parseScripMaster, type ScripRow } from "./scrip.js";
import { ist, MarketSourceError, type DailyPoint, type DhanSource, type GoldContract, type Instrument } from "./sources.js";

// Endpoints, headers, field names and error codes: docs/research/2026-10-06-dhan-api-notes.md,
// checked 6 Oct 2026, from docs, not yet called live.

export type DhanOptions = {
  clientId: string;
  accessToken: string;
  requestsPerSecond: number;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  baseUrl?: string;
};

const TOKEN_CODES = new Set(["DH-901", "807"]);
const RATE_CODES = new Set(["DH-904", "805"]);
const API_TIMEOUT_MS = 30_000;
const SCRIP_TIMEOUT_MS = 120_000;
const BACKOFF_MS = [1000, 2000, 4000];

type Json = Record<string, unknown>;

/** `YYYY-MM-DD` plus `days`, by calendar. */
function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A wall-clock time that Dhan states without a zone; read as IST. Returns epoch ms or NaN. */
function istMs(date: string, time: string): number {
  return Date.parse(`${date}T${time}+05:30`);
}

/** "DD/MM/YYYY HH:MM", read as IST, to an ISO UTC string; null when it does not parse. */
function parseTokenValidity(v: unknown): string | null {
  const m = typeof v === "string" ? /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2})$/.exec(v) : null;
  if (!m) return null;
  const ms = istMs(`${m[3]}-${m[2]}-${m[1]}`, `${m[4]}:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export class HttpDhanSource implements DhanSource {
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly baseUrl: string;
  private readonly interval: number;
  private nextAt = 0;
  private scrip: Promise<ScripRow[]> | undefined;
  // Real private fields: JSON.stringify and loggers do not see them.
  readonly #clientId: string;
  readonly #accessToken: string;

  constructor(opts: DhanOptions) {
    if (!(opts.requestsPerSecond > 0) || !Number.isFinite(opts.requestsPerSecond)) throw new Error("requestsPerSecond must be greater than 0");
    this.#clientId = opts.clientId;
    this.#accessToken = opts.accessToken;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.baseUrl = opts.baseUrl ?? "https://api.dhan.co/v2";
    this.interval = 1000 / opts.requestsPerSecond;
  }

  /** Keeps calls at least 1000 / requestsPerSecond ms apart. */
  private async space(): Promise<void> {
    const t = this.now();
    const wait = this.nextAt - t;
    this.nextAt = Math.max(t, this.nextAt) + this.interval;
    if (wait > 0) await this.sleep(wait);
  }

  /**
   * `refusal` is the code for a 4xx that is not a rate limit and names no other cause
   * (RenewToken answers a refusal that way; elsewhere it is a plain failure).
   */
  private async call(method: "GET" | "POST", path: string, body: unknown, headers: Record<string, string>, refusal?: "DHAN_TOKEN_EXPIRED"): Promise<Json> {
    for (let attempt = 0; ; attempt++) {
      await this.space();
      let res: Response;
      try {
        res = await this.fetchFn(`${this.baseUrl}${path}`, {
          method,
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
          headers: { "content-type": "application/json", ...headers },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        throw new MarketSourceError("SOURCE_UNAVAILABLE", "Dhan could not be reached");
      }
      let data: Json = {};
      try {
        const parsed: unknown = await res.json();
        if (parsed && typeof parsed === "object") data = parsed as Json;
      } catch {
        // On an error status the status decides; on a 2xx a body we cannot read is a failure, not an empty answer.
        if (res.ok) throw new MarketSourceError("SOURCE_UNAVAILABLE", "Dhan answered with a body that could not be read");
      }
      // Only the status and a short error code go into messages; never text the server controls.
      const rawCode = typeof data.errorCode === "string" ? data.errorCode : undefined;
      const code = rawCode && /^[A-Za-z0-9-]{1,10}$/.test(rawCode) ? rawCode : undefined;
      if (res.status === 401 || (rawCode && TOKEN_CODES.has(rawCode))) throw new MarketSourceError("DHAN_TOKEN_EXPIRED", "Dhan refused the access token");
      if (res.status === 429 || (rawCode && RATE_CODES.has(rawCode))) {
        const wait = BACKOFF_MS[attempt];
        if (wait === undefined) throw new MarketSourceError("DHAN_RATE_LIMITED", "Dhan rate limit reached");
        await this.sleep(wait);
        continue;
      }
      if (refusal && res.status >= 400 && res.status < 500) throw new MarketSourceError(refusal, `Dhan refused the request${code ? ` (${code})` : ""}`);
      if (!res.ok || rawCode) {
        // DH-902 and 806 mean the Data API is not subscribed; that is not an expired token.
        throw new MarketSourceError("SOURCE_UNAVAILABLE", `Dhan answered ${res.status}${code ? ` ${code}` : ""}`);
      }
      return data;
    }
  }

  private auth(): Record<string, string> {
    return { "access-token": this.#accessToken, "client-id": this.#clientId };
  }

  private post(path: string, body: unknown): Promise<Json> {
    return this.call("POST", path, body, this.auth());
  }

  async daily(inst: Instrument, from: string, to: string): Promise<DailyPoint[]> {
    const data = await this.post("/charts/historical", {
      securityId: inst.securityId,
      exchangeSegment: inst.exchangeSegment,
      instrument: inst.instrument,
      expiryCode: inst.expiryCode,
      oi: false,
      fromDate: from,
      toDate: addDays(to, 1), // toDate is not included
    });
    const close = Array.isArray(data.close) ? (data.close as unknown[]) : [];
    const stamp = Array.isArray(data.timestamp) ? (data.timestamp as unknown[]) : [];
    const out: DailyPoint[] = [];
    for (let i = 0; i < Math.min(close.length, stamp.length); i++) {
      const value = Number(close[i]);
      const t = Number(stamp[i]);
      if (close[i] === null || !Number.isFinite(value) || !Number.isFinite(t)) continue;
      out.push({ day: ist(t), value });
    }
    return out.sort((a, b) => a.day.localeCompare(b.day));
  }

  async putCallRatio(): Promise<number> {
    const underlying = { UnderlyingScrip: NIFTY_OPTION_UNDERLYING.scrip, UnderlyingSeg: NIFTY_OPTION_UNDERLYING.seg };
    const list = await this.post("/optionchain/expirylist", underlying);
    const expiries = (Array.isArray(list.data) ? (list.data as unknown[]) : []).filter((e): e is string => typeof e === "string").sort();
    const today = ist(this.now() / 1000);
    const expiry = expiries.find((e) => e >= today) ?? expiries[0];
    if (!expiry) throw new MarketSourceError("SOURCE_UNAVAILABLE", "Dhan listed no Nifty expiry");
    const chain = await this.post("/optionchain", { ...underlying, Expiry: expiry });
    const oc = ((chain.data as Json | undefined)?.oc ?? {}) as Record<string, { ce?: { oi?: number }; pe?: { oi?: number } } | null>;
    let calls = 0;
    let puts = 0;
    for (const strike of Object.values(oc)) {
      calls += Number(strike?.ce?.oi) || 0;
      puts += Number(strike?.pe?.oi) || 0;
    }
    if (calls <= 0) throw new MarketSourceError("SOURCE_UNAVAILABLE", "Dhan returned no call open interest");
    return puts / calls;
  }

  private scripMaster(): Promise<ScripRow[]> {
    this.scrip ??= (async () => {
      let res: Response;
      try {
        res = await this.fetchFn(SCRIP_MASTER_URL, { signal: AbortSignal.timeout(SCRIP_TIMEOUT_MS) });
      } catch {
        throw new MarketSourceError("SOURCE_UNAVAILABLE", "The Dhan scrip master could not be downloaded");
      }
      if (!res.ok) throw new MarketSourceError("SOURCE_UNAVAILABLE", `The Dhan scrip master answered ${res.status}`);
      // Keep only the rows used (a few thousand of about 200,000).
      let text: string;
      try {
        text = await res.text();
      } catch {
        throw new MarketSourceError("SOURCE_UNAVAILABLE", "The Dhan scrip master could not be downloaded");
      }
      return parseScripMaster(text, keepScripRow);
    })();
    // A failed download is not kept; the next call tries again.
    this.scrip.catch(() => { this.scrip = undefined; });
    return this.scrip;
  }

  async equityIds(): Promise<Map<string, string>> {
    return equityIdsFrom(await this.scripMaster());
  }

  async goldContracts(): Promise<GoldContract[]> {
    return goldContractsFrom(await this.scripMaster(), ist(this.now() / 1000));
  }

  async profile(): Promise<{ clientId: string; tokenExpiresAt: string | null; dataPlanActive: boolean | null }> {
    const d = await this.call("GET", "/profile", undefined, this.auth());
    const clientId = typeof d.dhanClientId === "string" ? d.dhanClientId : this.#clientId;

    // tokenValidity: "DD/MM/YYYY HH:MM", zone not stated in the docs, read as IST.
    const tokenExpiresAt = parseTokenValidity(d.tokenValidity);

    // dataPlan: "Active" or "Deactive"; dataValidity: "YYYY-MM-DD HH:MM:SS.0".
    let dataPlanActive: boolean | null = null;
    if (typeof d.dataPlan === "string") {
      dataPlanActive = d.dataPlan === "Active";
      const dv = typeof d.dataValidity === "string" ? /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/.exec(d.dataValidity) : null;
      const end = dv ? istMs(dv[1]!, dv[2]!) : NaN;
      if (dataPlanActive && Number.isFinite(end) && end <= this.now()) dataPlanActive = false;
    }
    return { clientId, tokenExpiresAt, dataPlanActive };
  }

  async renewToken(): Promise<{ accessToken: string; expiresAt: string | null }> {
    // Expires the current token and issues a new one; the caller must store the new one at once.
    const d = await this.call("POST", "/RenewToken", undefined, { "access-token": this.#accessToken, dhanClientId: this.#clientId }, "DHAN_TOKEN_EXPIRED");
    const accessToken = typeof d.accessToken === "string" ? d.accessToken : typeof d.access_token === "string" ? d.access_token : "";
    if (!accessToken) throw new MarketSourceError("SOURCE_UNAVAILABLE", "Dhan renewed the token but sent no new one");
    // The response shape is not in the docs; read an expiry only if one is there and parses.
    let expiresAt: string | null = null;
    if (typeof d.expiryTime === "string") {
      const ms = /(?:Z|[+-]\d{2}:\d{2})$/.test(d.expiryTime) ? Date.parse(d.expiryTime) : Date.parse(`${d.expiryTime}+05:30`); // zone-less: IST
      if (Number.isFinite(ms)) expiresAt = new Date(ms).toISOString();
    }
    expiresAt ??= parseTokenValidity(d.tokenValidity);
    return { accessToken, expiresAt };
  }
}
