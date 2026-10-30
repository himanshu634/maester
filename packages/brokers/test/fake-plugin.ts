import { BrokerManifest } from "@maester/contracts";
import { BrokerError, at, decimal, sessionExpiry, text } from "../src/kit/index.js";
import type { BrokerPlugin } from "../src/plugin.js";

/**
 * A plugin for tests, on the host `broker.test`, so a test never needs a real broker. It is shaped
 * like a broker whose return carries the token itself (Angel One's shape): `complete` checks the
 * token with one call. Tests reach it as `@maester/brokers/testing`. It imports nothing from vitest.
 *
 * - login: `https://broker.test/login?key=<apiKey>&state=<state>`
 * - return: `token` and `state`; no `token` means the broker refused
 * - complete: `GET /profile` with the token, account `data.id`; the session lasts until 00:00 in Kolkata
 * - holdings: `GET /holdings`, the list at `data`
 *
 * `over` replaces whole fields of the manifest, such as `enabled` or `hosts`.
 */
export function fakePlugin(over: Partial<BrokerManifest> = {}): BrokerPlugin {
  const manifest = BrokerManifest.parse({
    id: "fake",
    name: "Fake broker",
    enabled: true,
    hosts: ["broker.test"],
    copy: {
      pickerLine: "A broker that exists only in tests.",
      lasts: "Until midnight",
      cost: "Free",
      formLede: "Save your key, then sign in on the broker’s page.",
      steps: ["Make a key.", "Paste it here."],
      signedOutNote: "Signed out at midnight.",
    },
    credentials: [{ key: "apiKey", label: "API key", secret: false }],
    credentialShown: "apiKey",
    signIn: { kind: "redirect" },
    ...over,
  });
  return {
    manifest,
    signIn: {
      kind: "redirect",
      loginUrl: ({ creds, state }) => `https://broker.test/login?key=${creds.apiKey}&state=${state}`,
      readReturn: (query) => {
        const state = query.state ?? null;
        return query.token ? { state, payload: { token: query.token } } : { state, refused: true };
      },
      async complete({ payload, http, now }) {
        const token = payload.token ?? "";
        const profile = await http.get("https://broker.test/profile", { headers: { Authorization: `Bearer ${token}` } });
        const id = at(profile, "data.id");
        return {
          accessToken: token,
          accountId: typeof id === "string" ? id : null,
          signedInAt: now,
          expiresAt: sessionExpiry({ kind: "daily", at: "00:00", timeZone: "Asia/Kolkata" }, now),
        };
      },
    },
    reads: {
      async holdings({ session, http }) {
        const answer = await http.get("https://broker.test/holdings", { headers: { Authorization: `Bearer ${session.accessToken}` } });
        const list = at(answer, "data");
        if (!Array.isArray(list)) throw new BrokerError("BROKER_ANSWER_UNREADABLE", "the holdings answer has no list");
        return list.map((item: unknown) => ({
          isin: text(at(item, "isin"), "isin"),
          symbol: text(at(item, "symbol"), "symbol"),
          exchange: text(at(item, "exchange"), "exchange"),
          quantity: decimal(at(item, "quantity"), "quantity"),
          t1Quantity: decimal(at(item, "t1Quantity"), "t1Quantity"),
          averagePrice: at(item, "averagePrice") == null ? null : decimal(at(item, "averagePrice"), "averagePrice"),
          lastPrice: at(item, "lastPrice") == null ? null : decimal(at(item, "lastPrice"), "lastPrice"),
        }));
      },
    },
  };
}
