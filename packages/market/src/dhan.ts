import { SCRIP_MASTER_URL, NIFTY_OPTION_UNDERLYING } from "./instruments.js";
import { equityIdsFrom, goldContractsFrom, parseScripMaster, type ScripRow } from "./scrip.js";
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

export class HttpDhanSource implements DhanSource {
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly baseUrl: string;
  private readonly interval: number;
  private nextAt = 0;
  private scrip: Promise<ScripRow[]> | undefined;

  constructor(private readonly opts: DhanOptions) {
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.baseUrl = opts.baseUrl ?? "https://api.dhan.co/v2";
    this.interval = 1000 / Math.max(opts.requestsPerSecond, 0.001);
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
        // Not JSON; the status decides.
      }
      const code = typeof data.errorCode === "string" ? data.errorCode : undefined;
      const message = typeof data.errorMessage === "string" ? data.errorMessage : "";
      if (res.status === 401 || (code && TOKEN_CODES.has(code))) throw new MarketSourceError("DHAN_TOKEN_EXPIRED", "Dhan refused the access token");
      if (res.status === 429 || (code && RATE_CODES.has(code))) {
        const wait = BACKOFF_MS[attempt];
        if (wait === undefined) throw new MarketSourceError("DHAN_RATE_LIMITED", "Dhan rate limit reached");
        await this.sleep(wait);
        continue;
      }
      if (refusal && res.status >= 400 && res.status < 500) throw new MarketSourceError(refusal, `Dhan refused the request${code ? ` (${code})` : ""}`);
      if (!res.ok || code) {
        // DH-902 and 806 mean the Data API is not subscribed; that is not an expired token.
        throw new MarketSourceError("SOURCE_UNAVAILABLE", `Dhan answered ${res.status}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}`);
      }
      return data;
    }
  }

  private auth(): Record<string, string> {
    return { "access-token": this.opts.accessToken, "client-id": this.opts.clientId };
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
    return out;
  }

  async putCallRatio(): Promise<number> {
    const underlying = { UnderlyingScrip: NIFTY_OPTION_UNDERLYING.scrip, UnderlyingSeg: NIFTY_OPTION_UNDERLYING.seg };
    const list = await this.post("/optionchain/expirylist", underlying);
    const expiries = (Array.isArray(list.data) ? (list.data as unknown[]) : []).filter((e): e is string => typeof e === "string").sort();
    const today = ist(this.now() / 1000);
    const expiry = expiries.find((e) => e >= today) ?? expiries[0];
    if (!expiry) throw new MarketSourceError("SOURCE_UNAVAILABLE", "Dhan listed no Nifty expiry");
    const chain = await this.post("/optionchain", { ...underlying, Expiry: expiry });
    const oc = ((chain.data as Json | undefined)?.oc ?? {}) as Record<string, { ce?: { oi?: number }; pe?: { oi?: number } }>;
    let calls = 0;
    let puts = 0;
    for (const strike of Object.values(oc)) {
      calls += Number(strike.ce?.oi) || 0;
      puts += Number(strike.pe?.oi) || 0;
    }
    if (calls <= 0) throw new MarketSourceError("SOURCE_UNAVAILABLE", "Dhan returned no call open interest");
    return puts / calls;
  }

  private scripMaster(): Promise<ScripRow[]> {
    this.scrip ??= (async () => {
      let res: Response;
      try {
        res = await this.fetchFn(SCRIP_MASTER_URL);
      } catch {
        throw new MarketSourceError("SOURCE_UNAVAILABLE", "The Dhan scrip master could not be downloaded");
      }
      if (!res.ok) throw new MarketSourceError("SOURCE_UNAVAILABLE", `The Dhan scrip master answered ${res.status}`);
      return parseScripMaster(await res.text());
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
    const clientId = typeof d.dhanClientId === "string" ? d.dhanClientId : this.opts.clientId;

    // tokenValidity: "DD/MM/YYYY HH:MM", zone not stated in the docs, read as IST.
    let tokenExpiresAt: string | null = null;
    const tv = typeof d.tokenValidity === "string" ? /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2})$/.exec(d.tokenValidity) : null;
    if (tv) {
      const ms = istMs(`${tv[3]}-${tv[2]}-${tv[1]}`, `${tv[4]}:00`);
      if (Number.isFinite(ms)) tokenExpiresAt = new Date(ms).toISOString();
    }

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
    const d = await this.call("POST", "/RenewToken", undefined, { "access-token": this.opts.accessToken, dhanClientId: this.opts.clientId }, "DHAN_TOKEN_EXPIRED");
    const accessToken = typeof d.accessToken === "string" ? d.accessToken : typeof d.access_token === "string" ? d.access_token : "";
    if (!accessToken) throw new MarketSourceError("SOURCE_UNAVAILABLE", "Dhan renewed the token but sent no new one");
    // The response shape is not in the docs; read an expiry only if one is there and parses (zone-less read as IST).
    const raw = typeof d.expiryTime === "string" ? d.expiryTime : typeof d.tokenValidity === "string" ? d.tokenValidity : "";
    const ms = /Z|[+-]\d{2}:\d{2}$/.test(raw) ? Date.parse(raw) : Date.parse(`${raw}+05:30`);
    return { accessToken, expiresAt: raw && Number.isFinite(ms) ? new Date(ms).toISOString() : null };
  }
}
