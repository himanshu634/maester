import { fakePlugin } from "../fake-plugin.js";
import { runConformance } from "../conformance.js";

// The suite on a plugin shaped unlike Kite: the token comes back in the return, and `complete`
// checks it with one profile call. It shows the suite holds no Kite-only assumption.
runConformance(fakePlugin(), {
  creds: { apiKey: "KEY123" },
  goodReturn: { token: "TOKEN456", state: "nonce-1" },
  refusedReturn: { state: "nonce-1" },
  answers: {
    "https://broker.test/profile": { status: 200, body: { data: { id: "AB1234" } } },
    "https://broker.test/holdings": {
      status: 200,
      body: {
        data: [
          { isin: "INE002A01018", symbol: "RELIANCE", exchange: "NSE", quantity: 10, t1Quantity: 0, averagePrice: 2400.5, lastPrice: 2500 },
          { isin: "INE009A01021", symbol: "INFY", exchange: "NSE", quantity: "5", t1Quantity: "1", averagePrice: "1500", lastPrice: null },
        ],
      },
    },
  },
  expectedLines: [
    { isin: "INE002A01018", symbol: "RELIANCE", exchange: "NSE", quantity: "10", t1Quantity: "0", averagePrice: "2400.5", lastPrice: "2500" },
    { isin: "INE009A01021", symbol: "INFY", exchange: "NSE", quantity: "5", t1Quantity: "1", averagePrice: "1500", lastPrice: null },
  ],
  signInAt: new Date("2026-10-27T05:00:00Z"),
  expectedExpiry: "2026-10-27T18:30:00.000Z",
});
