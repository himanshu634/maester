import { z } from "zod";
import { DecimalString, IsoTimestamp } from "./common.js";

/**
 * Broker connections (Holdings). A broker is a plugin compiled into the API, in
 * `packages/brokers/src/plugins/`. Its manifest (below) is what the API serves to the web: what the
 * investor is asked for, how they sign in and what the page says. The plugin holds the calls, and
 * every one of them goes to one of the manifest's `hosts` over https. Nothing here describes a call.
 */

export const BrokerId = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/, "a broker id is lower-case letters, digits and -");
export type BrokerId = z.infer<typeof BrokerId>;

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

/** What the page says about signing in with a broker, how long it lasts and what it costs. */
export const BrokerCopy = z.object({
  pickerLine: z.string().min(1).max(160),
  lasts: z.string().min(1).max(80),
  cost: z.string().min(1).max(80),
  formLede: z.string().min(1).max(400),
  steps: z.array(z.string().min(1).max(300)).min(1).max(8),
  saveNote: z.string().max(200).optional(),
  signedOutNote: z.string().min(1).max(200),
});
export type BrokerCopy = z.infer<typeof BrokerCopy>;

/**
 * A broker plugin's manifest: what the page shows and the rules the host enforces around the
 * plugin's code. The plugin compiled into the API holds the calls; the manifest holds no call.
 * Every URL a plugin reaches is https on one of `hosts`. A plugin signs in through the broker's
 * own page (`redirect`) and nothing else, so a manifest with another `signIn` kind is refused.
 */
export const BrokerManifest = z.object({
  id: BrokerId,
  name: z.string().min(1).max(40),
  /** Off: listed as not offered, with `notOfferedReason`, and nothing can be saved or signed in for it. */
  enabled: z.boolean(),
  notOfferedReason: z.string().max(200).optional(),
  /** Every host a call may reach. A URL to any other host is refused before it is sent. */
  hosts: z.array(z.string().regex(/^[a-z0-9.-]+$/)).min(1).max(8),
  copy: BrokerCopy,
  /** What the investor types in. */
  credentials: z.array(BrokerCredentialField).min(1).max(4),
  /** The credential whose last 4 characters name the saved key. */
  credentialShown: z.string(),
  signIn: z.discriminatedUnion("kind", [z.object({ kind: z.literal("redirect") })]),
  /** An answer with one of these statuses means the broker signed Maester out. */
  signedOutStatuses: z.array(z.number().int().min(400).max(599)).default([401, 403]),
});
export type BrokerManifest = z.infer<typeof BrokerManifest>;

/**
 * One holding as a plugin returns it: the facts the broker printed, as decimal strings exactly as
 * sent. A plugin computes nothing; quantity plus T+1, cost, value and gain are worked out in
 * @maester/financial-engine. `lastPrice` is null when the broker sent none.
 */
export const BrokerHoldingLine = z.object({
  isin: z.string().min(1),
  symbol: z.string().min(1),
  exchange: z.string().min(1),
  quantity: DecimalString,
  t1Quantity: DecimalString,
  averagePrice: DecimalString,
  lastPrice: DecimalString.nullable(),
});
export type BrokerHoldingLine = z.infer<typeof BrokerHoldingLine>;

/** What the web is sent about a broker: everything a page shows, none of the calls. */
export const BrokerSummary = z.object({
  id: BrokerId,
  name: z.string(),
  enabled: z.boolean(),
  notOfferedReason: z.string().nullable(),
  copy: BrokerCopy,
  credentials: z.array(BrokerCredentialField.omit({ minLength: true, maxLength: true }).extend({ minLength: z.number(), maxLength: z.number() })),
  /**
   * How the account signs in. One strategy today: the page shows a form for the key, then a sign-in
   * on the broker's own page (`redirect`). A later strategy adds a member here.
   */
  signIn: z.discriminatedUnion("kind", [z.object({ kind: z.literal("redirect") })]),
  /**
   * The address to paste into the broker's app as its redirect URL. Every broker has one today; it
   * stays nullable for a later strategy with no return.
   */
  returnUrl: z.string().nullable(),
});
export type BrokerSummary = z.infer<typeof BrokerSummary>;

export const BrokerList = z.object({ items: z.array(BrokerSummary) });
export type BrokerList = z.infer<typeof BrokerList>;

/**
 * One broker account in the workspace.
 * - `saved`: the key is kept; nobody has signed in yet.
 * - `signed_in`: the broker's sign-in is still good.
 * - `signed_out`: the broker signed Maester out (its daily expiry, or it refused the token).
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

/** The credentials for one broker, keyed by its manifest's credential keys. */
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
