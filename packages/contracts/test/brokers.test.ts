import { describe, expect, it } from "vitest";
import { BrokerCopy, BrokerHoldingLine, BrokerManifest, BrokerSummary } from "../src/index.js";

const copy = {
  pickerLine: "Zerodha, through your own Kite Connect app.",
  lasts: "Until 06:00 each day",
  cost: "Kite Connect costs ₹500 a month",
  formLede: "Maester reads what you hold. It can’t place an order or move money.",
  steps: ["Open your Kite Connect app.", "Paste the redirect address.", "Copy the API key and secret here."],
  signedOutNote: "Zerodha signs every app out at 06:00.",
};

const kiteManifest = {
  id: "kite",
  name: "Zerodha",
  enabled: true,
  hosts: ["kite.zerodha.com", "api.kite.trade"],
  copy,
  credentials: [
    { key: "apiKey", label: "API key", secret: false },
    { key: "apiSecret", label: "API secret", secret: true },
  ],
  credentialShown: "apiKey",
  signIn: { kind: "redirect" },
};

const line = {
  isin: "INE002A01018",
  symbol: "RELIANCE",
  exchange: "NSE",
  quantity: "10",
  t1Quantity: "0",
  averagePrice: "2450.50",
  lastPrice: "2890.15",
};

describe("BrokerManifest", () => {
  it("parses a Kite-shaped manifest and defaults signedOutStatuses to [401, 403]", () => {
    const parsed = BrokerManifest.parse(kiteManifest);
    expect(parsed.id).toBe("kite");
    expect(parsed.signIn).toEqual({ kind: "redirect" });
    expect(parsed.signedOutStatuses).toEqual([401, 403]);
    expect(parsed.credentials[0]).toMatchObject({ key: "apiKey", minLength: 1, maxLength: 512 });
  });

  it("keeps signedOutStatuses it is given", () => {
    expect(BrokerManifest.parse({ ...kiteManifest, signedOutStatuses: [401] }).signedOutStatuses).toEqual([401]);
  });

  it("refuses an empty credentials list", () => {
    expect(BrokerManifest.safeParse({ ...kiteManifest, credentials: [] }).success).toBe(false);
  });

  it("refuses a signIn kind other than redirect", () => {
    expect(BrokerManifest.safeParse({ ...kiteManifest, signIn: { kind: "direct" } }).success).toBe(false);
    expect(BrokerManifest.safeParse({ ...kiteManifest, signIn: { kind: "settings-connection", provider: "dhan" } }).success).toBe(false);
  });
});

describe("BrokerCopy", () => {
  it("parses the copy a manifest holds", () => {
    expect(BrokerCopy.parse(copy)).toEqual(copy);
  });
});

describe("BrokerHoldingLine", () => {
  it("parses a line with decimal strings", () => {
    expect(BrokerHoldingLine.parse(line)).toEqual(line);
  });

  it.each(["1e3", "NaN"])("refuses %s as a quantity", (bad) => {
    expect(BrokerHoldingLine.safeParse({ ...line, quantity: bad }).success).toBe(false);
  });

  it("refuses the number 120 as a quantity", () => {
    expect(BrokerHoldingLine.safeParse({ ...line, quantity: 120 }).success).toBe(false);
  });

  it.each(["t1Quantity", "averagePrice", "lastPrice"] as const)("refuses 1e3, NaN and a number in %s", (field) => {
    for (const bad of ["1e3", "NaN", 120]) {
      expect(BrokerHoldingLine.safeParse({ ...line, [field]: bad }).success).toBe(false);
    }
  });

  it.each(["averagePrice", "lastPrice"] as const)("accepts %s null", (field) => {
    expect(BrokerHoldingLine.parse({ ...line, [field]: null })[field]).toBeNull();
  });

  it.each(["averagePrice", "lastPrice"] as const)("refuses a missing %s: null says the broker sent none, absent says nothing was read", (field) => {
    const without: Partial<typeof line> = { ...line };
    delete without[field];
    expect(BrokerHoldingLine.safeParse(without).success).toBe(false);
  });
});

describe("BrokerSummary", () => {
  const summary = {
    id: "kite",
    name: "Zerodha",
    enabled: true,
    notOfferedReason: null,
    copy,
    credentials: [{ key: "apiKey", label: "API key", secret: false, minLength: 6, maxLength: 64 }],
    signIn: { kind: "redirect" },
    returnUrl: "https://maester.example/v1/brokers/kite/return",
  };

  it("parses a broker that signs in on its own page", () => {
    expect(BrokerSummary.parse(summary).signIn).toEqual({ kind: "redirect" });
  });

  it("refuses the direct and Settings-connection sign-ins, which no plugin has", () => {
    expect(BrokerSummary.safeParse({ ...summary, signIn: { kind: "direct" } }).success).toBe(false);
    expect(BrokerSummary.safeParse({ ...summary, signIn: { kind: "settings-connection", provider: "dhan" } }).success).toBe(false);
  });

  it("keeps returnUrl nullable, for a later sign-in with no return", () => {
    expect(BrokerSummary.parse({ ...summary, returnUrl: null }).returnUrl).toBeNull();
  });
});
