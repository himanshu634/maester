import { BrokerError, at, sessionExpiry, text } from "../../kit/index.js";
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
    // Task 2 reads the holdings.
    async holdings() {
      throw new BrokerError("BROKER_UNAVAILABLE", "read: not built yet");
    },
  },
};
