import { BrokerError, at, decimal, sessionExpiry, text } from "../../kit/index.js";
import type { BrokerPlugin } from "../../plugin.js";
import { answer } from "./answer.js";
import { manifest } from "./manifest.js";

const LOGIN = "https://smartapi.angelone.in/publisher-login";
export const PROFILE_URL = "https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/getProfile";
export const HOLDINGS_URL = "https://apiconnect.angelone.in/rest/secure/angelbroking/portfolio/v1/getHolding";

/** A value the host should always have: a saved field, or what the return gave. A missing one is a bug, so the message names the key and never a value. */
function required(from: Record<string, string>, key: string): string {
  const value = from[key];
  if (typeof value !== "string" || value === "") throw new BrokerError("BROKER_UNAVAILABLE", `the saved ${key} is missing`);
  return value;
}

/**
 * The headers every Angel One call sends. The key and the token go in as they are. The client
 * address headers (`X-ClientLocalIP`, `X-ClientPublicIP`, `X-MACAddress`) are left out: Maester has
 * no address of its own to give and does not make one up.
 */
export function angelHeaders(apiKey: string, accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "X-PrivateKey": apiKey,
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/**
 * The symbol Maester looks a close up by. Angel One prints an NSE share as `SBIN-EQ`; the NSE
 * symbol is `SBIN`. Only the trailing `-EQ` goes, and only on NSE. Any other suffix (`-BE`, `-SM`)
 * stays, so that share finds no NSE close and shows "—", never another share's close. BSE symbols
 * are used as they are.
 */
export function symbolOf(raw: string, exchange: string): string {
  return exchange === "NSE" && raw.endsWith("-EQ") ? raw.slice(0, -"-EQ".length) : raw;
}

/**
 * Angel One (SmartAPI), through the publisher login: the investor saves the app's key, signs in on
 * Angel One's page and comes back with an `auth_token`. One profile call checks the token and names
 * the account; the token works until midnight. Holdings are read and nothing else: there is no
 * order or fund call here.
 */
export const angel: BrokerPlugin = {
  manifest,
  signIn: {
    kind: "redirect",
    // The return address is not sent: the investor pastes it into the SmartAPI app, as with Zerodha.
    loginUrl: ({ creds, state }) => `${LOGIN}?api_key=${encodeURIComponent(required(creds, "apiKey"))}&state=${encodeURIComponent(state)}`,
    readReturn: (query) => {
      // A blank state is no state, and the host refuses a return that has none.
      const state = query.state?.trim() || null;
      const authToken = query.auth_token?.trim();
      // The feed token is not read: Maester streams nothing.
      if (!authToken) return { state, refused: true };
      return { state, payload: { authToken } };
    },
    async complete({ creds, payload, http, now }) {
      const accessToken = required(payload, "authToken");
      const data = answer(await http.get(PROFILE_URL, { headers: angelHeaders(required(creds, "apiKey"), accessToken) }), "sign-in");
      return {
        accessToken,
        accountId: text(at(data, "clientcode"), "clientcode"),
        signedInAt: now,
        // Angel One signs every session out at midnight; a sign-in just past midnight lasts until the next one.
        expiresAt: sessionExpiry({ kind: "daily", at: "00:00", timeZone: "Asia/Kolkata" }, now),
      };
    },
  },
  reads: {
    async holdings({ creds, session, http }) {
      const data = answer(await http.get(HOLDINGS_URL, { headers: angelHeaders(required(creds, "apiKey"), session.accessToken) }), "read");
      // `[]` is an account with no holdings. Anything else, `null` included, is not a list: "no holdings" is a figure, so it is
      // said only for the shape known to mean it.
      if (!Array.isArray(data)) throw new BrokerError("BROKER_ANSWER_UNREADABLE", "the holdings answer has no list");
      // Every figure is the string Angel One printed. Nothing is worked out here, and two lines for one share are not added
      // together: the host refuses a read that lists the same ISIN on the same exchange twice.
      return data.map((item: unknown) => {
        const exchange = text(at(item, "exchange"), "exchange");
        const lastPrice = at(item, "ltp");
        return {
          isin: text(at(item, "isin"), "isin"),
          exchange,
          // Angel One's own spelling varies (`tradingsymbol`, `tradingSymbol`), and the value can be `null`: one such line fails the read.
          symbol: symbolOf(text(at(item, "tradingsymbol") ?? at(item, "tradingSymbol"), "tradingsymbol"), exchange),
          quantity: decimal(at(item, "quantity"), "quantity"),
          // Kept apart from `quantity` (a share bought today is quantity 0, t1quantity 5): the engine adds them.
          t1Quantity: decimal(at(item, "t1quantity") ?? 0, "t1quantity"),
          // An absent average price is "0", which the financial engine reads as an unknown cost, so one such line does not
          // fail the whole read. A price that is present but not a decimal is still unreadable.
          averagePrice: decimal(at(item, "averageprice") ?? 0, "averageprice"),
          lastPrice: lastPrice == null ? null : decimal(lastPrice, "ltp"),
        };
      });
    },
  },
};
