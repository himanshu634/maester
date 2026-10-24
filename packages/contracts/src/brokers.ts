import { z } from "zod";
import { DecimalString, IsoTimestamp } from "./common.js";

/**
 * Broker connections (Holdings). A broker is described by one JSON definition the API loads at
 * start (`packages/brokers/definitions/*.json`, plus `BROKER_DEFINITIONS_DIR` when set): what the
 * investor is asked for, how they sign in, and the read-only calls Maester makes. Adding a broker
 * is adding a file; the code only interprets the fixed vocabulary below. Nothing in a definition
 * is executed, and every call it describes goes to one of its own `hosts` over https.
 */

export const BrokerId = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/, "a broker id is lower-case letters, digits and -");
export type BrokerId = z.infer<typeof BrokerId>;

/** `{name}` placeholders. A URL's are URL-encoded; a header's or form field's are used as they are. */
const Template = z.string().min(1).max(2000);
/** A dotted path into a JSON response, such as `data.access_token`. */
const JsonPath = z.string().regex(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/);

/** One thing the investor types in, such as an API key. A secret is shown as a password field. */
export const BrokerCredentialField = z.object({
  key: z.string().regex(/^[a-z][A-Za-z0-9]{0,31}$/),
  label: z.string().min(1).max(60),
  hint: z.string().max(200).optional(),
  secret: z.boolean(),
  minLength: z.number().int().min(1).max(512).default(1),
  maxLength: z.number().int().min(1).max(4096).default(512),
});
export type BrokerCredentialField = z.infer<typeof BrokerCredentialField>;

/** A value worked out from others before a call. `sha256hex` hashes the named values joined with nothing between them. */
export const BrokerDerivedValue = z.object({ sha256hex: z.array(z.string().min(1)).min(1).max(8) });

/**
 * One call. Besides the values each place allows, every call may use `{timestamp}` (epoch seconds),
 * `{isoTimestamp}` (UTC, "2026-10-24T10:23:56.000Z"), both taken once per call, and in `derive`
 * and headers only `{body}`, the body exactly as sent (ICICI Direct signs every request with
 * SHA-256 of the timestamp, the body and the secret). A GET may carry a JSON body (Breeze does).
 */
const Call = z.object({
  method: z.enum(["GET", "POST"]),
  url: Template,
  headers: z.record(z.string(), Template).default({}),
  /** Sent as application/x-www-form-urlencoded. */
  form: z.record(z.string(), Template).optional(),
  /** Sent as application/json, every value a string (empty allowed: Breeze takes "" for "all"). A call has a form or a JSON body, not both. */
  json: z.record(z.string(), z.string().max(2000)).optional(),
  derive: z.record(z.string(), BrokerDerivedValue).default({}),
});

/**
 * When a sign-in stops working. `daily`: at a fixed local time each day (Zerodha: 06:00 in
 * Asia/Kolkata). `hours`: a fixed number of hours after sign-in.
 */
export const BrokerSessionExpiry = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timeZone: z.string().min(1) }),
  z.object({ kind: z.literal("hours"), hours: z.number().int().min(1).max(24 * 366) }),
]);
export type BrokerSessionExpiry = z.infer<typeof BrokerSessionExpiry>;

/** The fields of one holding in the broker's answer. Each names a path inside one list item. */
export const BrokerHoldingFields = z.object({
  isin: JsonPath,
  symbol: JsonPath,
  /** Absent for a broker whose holdings name no exchange (Groww): then the read's `exchangeIs` says which. */
  exchange: JsonPath.optional(),
  quantity: JsonPath,
  t1Quantity: JsonPath.optional(),
  /** Absent only when a `join` supplies it. */
  averagePrice: JsonPath.optional(),
  lastPrice: JsonPath.optional(),
});

/** The market connection providers a broker can sign in through (`market_connection.provider`). */
export const SettingsConnectionProvider = z.enum(["dhan"]);
export type SettingsConnectionProvider = z.infer<typeof SettingsConnectionProvider>;

/**
 * How Maester gets a session.
 * - `redirect`: the investor saves the broker's key, then signs in on the broker's own page,
 *   which sends a code back that a session call exchanges for a token (Zerodha).
 * - `settings-connection`: the broker's token is the one saved in Settings for `provider`, which
 *   the market worker renews (Dhan). There is nothing to save and no sign-in; every read uses
 *   the token Settings holds at that moment.
 */
export const BrokerSignIn = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("redirect"),
    /** The broker's login page. `{state}` is the single-use nonce; `{stateQuery}` is `state=<nonce>`. */
    loginUrl: Template,
    /** The query parameters the broker sends back to Maester's return address. */
    returnParams: z.object({ code: z.string().min(1), state: z.string().min(1), status: z.string().optional(), success: z.string().optional() }),
    /** Exchanges the code for a session. Its templates may use the credentials and `{code}`. */
    session: Call.extend({
      accessToken: JsonPath,
      accountId: JsonPath.optional(),
      expiry: BrokerSessionExpiry,
    }),
  }),
  z.object({ kind: z.literal("settings-connection"), provider: SettingsConnectionProvider }),
  /**
   * `direct`: Maester calls the broker's session endpoint itself with the saved key (Groww, once
   * the investor has approved the key on Groww that day). The session call may also use
   * `{timestamp}`, epoch seconds.
   */
  z.object({
    kind: z.literal("direct"),
    session: Call.extend({
      accessToken: JsonPath,
      accountId: JsonPath.optional(),
      expiry: BrokerSessionExpiry,
    }),
  }),
]);
export type BrokerSignIn = z.infer<typeof BrokerSignIn>;

export const BrokerDefinition = z.object({
  id: BrokerId,
  name: z.string().min(1).max(40),
  /** Off: listed as not offered, with `notOfferedReason`, and nothing can be saved for it. */
  enabled: z.boolean(),
  notOfferedReason: z.string().max(200).optional(),
  /** Every host a call may reach. A URL to any other host is refused before it is sent. */
  hosts: z.array(z.string().regex(/^[a-z0-9.-]+$/)).min(1).max(8),
  /** What the page says about signing in, how long it lasts and what it costs. */
  copy: z.object({
    pickerLine: z.string().min(1).max(160),
    lasts: z.string().min(1).max(80),
    cost: z.string().min(1).max(80),
    formLede: z.string().min(1).max(400),
    steps: z.array(z.string().min(1).max(300)).min(1).max(8),
    saveNote: z.string().max(200).optional(),
    signedOutNote: z.string().min(1).max(200),
  }),
  /** What the investor types in. A broker that signs in through a Settings connection asks for nothing. */
  credentials: z.array(BrokerCredentialField).max(4),
  /** The credential whose last 4 characters name the saved key. Absent when there are no credentials. */
  credentialShown: z.string().optional(),
  signIn: BrokerSignIn,
  reads: z.object({
    /**
     * Templates may use the credentials, `{accessToken}` and `{accountId}` (redirect), or
     * `{accessToken}` and `{clientId}` from the Settings connection (settings-connection).
     * `list` is the JSON path of the array; absent, the answer itself is the array (Dhan).
     */
    holdings: Call.extend({
      list: JsonPath.optional(),
      fields: BrokerHoldingFields,
      /**
       * The exchange every line is on, for an answer that names none. NSE or BSE when the symbol is
       * that exchange's; any other word (ICICI) when the symbol is the broker's own code, which
       * Maester cannot price by symbol.
       */
      exchangeIs: z.string().regex(/^[A-Z]{2,8}$/).optional(),
      /**
       * A second call whose items add figures to the first's, matched on a key (ICICI Direct: demat
       * holdings give the ISIN and quantity, portfolio holdings the average price, both keyed by the
       * broker's stock code). A line with no match keeps an average price of 0, which the engine
       * reads as a cost it does not know.
       */
      join: Call.extend({
        list: JsonPath.optional(),
        key: JsonPath,
        joinKey: JsonPath,
        fields: z.object({ averagePrice: JsonPath.optional(), lastPrice: JsonPath.optional() }),
      }).optional(),
    }),
  }),
  /** An answer with one of these statuses means the broker signed Maester out. */
  signedOutStatuses: z.array(z.number().int().min(400).max(599)).default([401, 403]),
});
export type BrokerDefinition = z.infer<typeof BrokerDefinition>;

/** What the web is sent about a broker: everything a page shows, none of the calls. */
export const BrokerSummary = z.object({
  id: BrokerId,
  name: z.string(),
  enabled: z.boolean(),
  notOfferedReason: z.string().nullable(),
  copy: BrokerDefinition.shape.copy,
  credentials: z.array(BrokerCredentialField.omit({ minLength: true, maxLength: true }).extend({ minLength: z.number(), maxLength: z.number() })),
  /** How the account signs in: the page shows a form and a sign-in for `redirect`, and points at Settings for `settings-connection`. */
  signIn: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("redirect") }),
    z.object({ kind: z.literal("settings-connection"), provider: SettingsConnectionProvider }),
    /** Signs in from Maester itself with the saved key, once the investor has approved it on the broker's side. */
    z.object({ kind: z.literal("direct") }),
  ]),
  /** The address to paste into the broker's app as its redirect URL. Null for a broker with no redirect. */
  returnUrl: z.string().nullable(),
});
export type BrokerSummary = z.infer<typeof BrokerSummary>;

export const BrokerList = z.object({ items: z.array(BrokerSummary) });
export type BrokerList = z.infer<typeof BrokerList>;

/**
 * One broker account in the workspace.
 * - `saved`: the key is kept; nobody has signed in yet.
 * - `signed_in`: the broker's sign-in is still good (for a Settings connection: Settings holds a
 *   token that has not expired and that the broker has not refused).
 * - `signed_out`: the broker signed Maester out (its daily expiry, or it refused the token), or
 *   the Settings connection is missing or expired.
 * - `failing`: the last read failed for another reason.
 */
export const BrokerAccount = z.object({
  broker: BrokerId,
  name: z.string(),
  state: z.enum(["saved", "signed_in", "signed_out", "failing"]),
  accountId: z.string().nullable(),
  keyLast4: z.string().nullable(),
  savedAt: IsoTimestamp,
  signedInAt: IsoTimestamp.nullable(),
  signedOutAt: IsoTimestamp.nullable(),
  lastReadAt: IsoTimestamp.nullable(),
  lastReadCount: z.number().int().nullable(),
  errorCode: z.string().nullable(),
});
export type BrokerAccount = z.infer<typeof BrokerAccount>;

export const BrokerAccountList = z.object({ items: z.array(BrokerAccount) });
export type BrokerAccountList = z.infer<typeof BrokerAccountList>;

/** The credentials for one broker, keyed by its definition's credential keys. */
export const SaveBrokerRequest = z.object({ credentials: z.record(z.string(), z.string().trim().min(1).max(4096)) });
export type SaveBrokerRequest = z.infer<typeof SaveBrokerRequest>;

export const BrokerSignInStart = z.object({ url: z.url() });
export type BrokerSignInStart = z.infer<typeof BrokerSignInStart>;

/** Why a figure is unknown. */
export const HoldingUnknown = z.enum(["NO_CLOSE", "NO_COST"]);
export type HoldingUnknown = z.infer<typeof HoldingUnknown>;

/**
 * One account's part of a row: the facts read from the broker, with when they were read, and its
 * cost, value and gain from @maester/financial-engine (holding_cost, holding_value, holding_gain,
 * holding_gain_percent). `averagePrice` is the broker's own, or holding_average_price when the
 * account holds the ISIN on more than one exchange.
 */
export const HoldingPart = z.object({
  broker: BrokerId,
  accountId: z.string().nullable(),
  quantity: DecimalString,
  averagePrice: DecimalString,
  cost: DecimalString.nullable(),
  value: DecimalString.nullable(),
  gain: DecimalString.nullable(),
  gainPercent: DecimalString.nullable(),
  readAt: IsoTimestamp,
  /** Read before the broker signed Maester out, so it may be older than today. */
  stale: z.boolean(),
});
export type HoldingPart = z.infer<typeof HoldingPart>;

/**
 * One security across the workspace's accounts. Quantity, cost, value and weight are results of
 * named calculations in @maester/financial-engine (`calculations` says which, with versions).
 */
export const HoldingRow = z.object({
  isin: z.string(),
  symbol: z.string(),
  exchange: z.string(),
  parts: z.array(HoldingPart).min(1),
  quantity: DecimalString,
  cost: DecimalString.nullable(),
  close: z.object({ value: DecimalString, day: z.iso.date(), source: z.string() }).nullable(),
  value: DecimalString.nullable(),
  weight: DecimalString.nullable(),
  gain: DecimalString.nullable(),
  gainPercent: DecimalString.nullable(),
  unknown: z.array(HoldingUnknown),
});
export type HoldingRow = z.infer<typeof HoldingRow>;

/** One account's totals over its parts (holdings_by_account), with how many parts each figure covers. */
export const HoldingAccountTotals = z.object({
  broker: BrokerId,
  knownValue: DecimalString.nullable(),
  priced: z.number().int(),
  count: z.number().int(),
  cost: DecimalString.nullable(),
  costed: z.number().int(),
  gain: DecimalString.nullable(),
  gainCovers: z.number().int(),
  gainPercent: DecimalString.nullable(),
});
export type HoldingAccountTotals = z.infer<typeof HoldingAccountTotals>;

export const HoldingsSnapshot = z.object({
  accounts: z.array(BrokerAccount),
  rows: z.array(HoldingRow),
  totals: z.object({
    knownValue: DecimalString.nullable(),
    priced: z.number().int(),
    count: z.number().int(),
    cost: DecimalString.nullable(),
    costed: z.number().int(),
    unrealizedGain: DecimalString.nullable(),
    gainCovers: z.number().int(),
    /** holding_gain_percent over the cost of the rows with both a value and a cost. */
    gainPercent: DecimalString.nullable(),
  }),
  /** One entry per connected account that holds anything, in the order of `accounts`. */
  accountTotals: z.array(HoldingAccountTotals),
  /** The latest NSE close day used, when any row is priced. */
  closeDay: z.iso.date().nullable(),
  calculations: z.array(z.object({ id: z.string(), version: z.number().int() })),
});
export type HoldingsSnapshot = z.infer<typeof HoldingsSnapshot>;
