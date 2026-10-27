import { BrokerError, at, decimal, sessionExpiry, sha256hex, text } from "../../kit/index.js";
import type { BrokerPlugin } from "../../plugin.js";
import { kiteManifest } from "./manifest.js";

const LOGIN = "https://kite.zerodha.com/connect/login";
const SESSION = "https://api.kite.trade/session/token";
const HOLDINGS = "https://api.kite.trade/portfolio/holdings";
/** Kite Connect's API version, sent on every call. */
const VERSION = { "X-Kite-Version": "3" };

/** A value the host should always have: a saved field, or what the return gave. A missing one is a bug, so the message names the key and never a value. */
function required(from: Record<string, string>, key: string): string {
  const value = from[key];
  if (typeof value !== "string" || value === "") throw new BrokerError("BROKER_UNAVAILABLE", `the saved ${key} is missing`);
  return value;
}

/**
 * Zerodha (Kite Connect): the investor saves the app's key and secret, signs in on Zerodha's page,
 * and comes back with a `request_token`. A session call trades it for an access token that works
 * until 06:00 the next morning, and a 403 means Zerodha has signed Maester out. Holdings are read
 * and nothing else: there is no order or fund call here.
 */
export const kite: BrokerPlugin = {
  manifest: kiteManifest,
  signIn: {
    kind: "redirect",
    loginUrl: ({ creds, state }) =>
      `${LOGIN}?v=3&api_key=${encodeURIComponent(required(creds, "apiKey"))}&redirect_params=${encodeURIComponent(`state=${state}`)}`,
    readReturn: (query) => {
      const state = query.state ?? null;
      const requestToken = query.request_token;
      // A return with no `status` parameter is a good one: Zerodha only adds it to say how a sign-in ended.
      const statusOk = query.status === undefined || query.status === "success";
      if (!state || !requestToken || !statusOk) return { state, refused: true };
      return { state, payload: { requestToken } };
    },
    async complete({ creds, payload, http, now }) {
      const apiKey = required(creds, "apiKey");
      const requestToken = required(payload, "requestToken");
      const answer = await http.post(SESSION, {
        headers: VERSION,
        // The secret is only ever hashed into the checksum; it is never sent.
        form: { api_key: apiKey, request_token: requestToken, checksum: sha256hex(apiKey, requestToken, required(creds, "apiSecret")) },
      });
      const accessToken = at(answer, "data.access_token");
      if (typeof accessToken !== "string" || accessToken === "") throw new BrokerError("BROKER_ANSWER_UNREADABLE", "the sign-in answer has no access token");
      const userId = at(answer, "data.user_id");
      return {
        accessToken,
        accountId: typeof userId === "string" ? userId : null,
        signedInAt: now,
        expiresAt: sessionExpiry({ kind: "daily", at: "06:00", timeZone: "Asia/Kolkata" }, now),
      };
    },
  },
  reads: {
    async holdings({ creds, session, http }) {
      const answer = await http.get(HOLDINGS, { headers: { ...VERSION, Authorization: `token ${required(creds, "apiKey")}:${session.accessToken}` } });
      const list = at(answer, "data");
      if (!Array.isArray(list)) throw new BrokerError("BROKER_ANSWER_UNREADABLE", "the holdings answer has no list");
      // Every figure is the string Kite printed. Nothing is worked out here.
      return list.map((item: unknown) => {
        const lastPrice = at(item, "last_price");
        return {
          isin: text(at(item, "isin"), "isin"),
          symbol: text(at(item, "tradingsymbol"), "tradingsymbol"),
          exchange: text(at(item, "exchange"), "exchange"),
          quantity: decimal(at(item, "quantity"), "quantity"),
          // Kite leaves out a T+1 quantity it has none of: none pending.
          t1Quantity: decimal(at(item, "t1_quantity") ?? 0, "t1_quantity"),
          // An absent average price is "0", as the old client read it. The financial engine reads an average price of 0 as an
          // unknown cost (NO_COST), so the figure shows as unknown, not as zero, and one such line does not fail the whole read
          // and hide every holding. A price that is present but not a decimal is still unreadable.
          averagePrice: decimal(at(item, "average_price") ?? 0, "average_price"),
          lastPrice: lastPrice == null ? null : decimal(lastPrice, "last_price"),
        };
      });
    },
  },
};
