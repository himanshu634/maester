// What each broker asks for, as of 19 Oct 2026. Source: docs/research/2026-10-19-broker-apis.md.
// Change a fact there first, then here; the frames read only this table.
export const BROKERS = {
  kite: {
    name: "Zerodha",
    pickerLine: "Sign in on Zerodha’s page each day. Holdings are in the free Personal plan.",
    lasts: "Until 6:00 the next morning",
    costShort: "Free",
    costLong: "Free (Kite Connect Personal)",
    expiryWords: "Zerodha signs Maester out at 6:00 each morning.",
    formLede: "Zerodha lets an app read your holdings once you create a free Kite Connect app of your own and sign in to it each day.",
    steps: [
      "Sign in at developers.kite.trade and create a Personal app. It’s free and includes holdings.",
      "Paste the redirect URL below into the app’s redirect URL.",
      "Copy the app’s API key and secret into the fields below.",
      "Save, then sign in on Zerodha’s page. You come back here.",
    ],
    saveNote: "Maester asks Zerodha only for holdings and positions. It never places an order.",
  },
  dhan: {
    name: "Dhan",
    pickerLine: "Uses your Dhan connection from Settings. Maester renews its token each day.",
    lasts: "24 hours, renewed by Maester",
    costShort: "Free",
    costLong: "Free (Trading API); closes need the Data API, ₹499 a month",
    expiryWords: "Token renewed by Maester; no daily sign-in.",
  },
  groww: {
    name: "Groww",
    pickerLine: "Approve Maester’s key on Groww each day.",
    lasts: "A day (Groww doesn’t say exactly)",
    costShort: "₹499 a month",
    costLong: "₹499 a month + GST, even to read holdings",
    expiryWords: "Approved today.",
  },
  upstox: {
    name: "Upstox",
    pickerLine: "Sign in on Upstox’s page each day. One app per account.",
    lasts: "Until 3:30 the next morning",
    costShort: "Free",
    costLong: "Free",
  },
  fyers: {
    name: "Fyers",
    pickerLine: "Sign in on Fyers’ page each day.",
    lasts: "Until 6:30 the next morning",
    costShort: "Free",
    costLong: "Free (Standard plan)",
  },
  icici: {
    name: "ICICI Direct",
    pickerLine: "Sign in on ICICI Direct’s page each day (Breeze).",
    lasts: "24 hours, or midnight if sooner",
    costShort: "Free",
    costLong: "Free",
  },
  fivepaisa: {
    name: "5paisa",
    pickerLine: "Sign in on 5paisa’s page each day.",
    lasts: "The day",
    costShort: "Not stated",
    costLong: "Not stated by 5paisa",
  },
  angel: {
    name: "Angel One",
    offered: false,
    pickerLine: "Signs in only with your PIN and an authenticator code.",
    lasts: "Until midnight",
    costShort: "Free",
    costLong: "Free (not confirmed)",
  },
  kotak: {
    name: "Kotak Neo",
    offered: false,
    pickerLine: "Signs in only with your MPIN and an authenticator code.",
    lasts: "Not stated",
    costShort: "Free",
    costLong: "Free",
  },
}

export const GROUPS_BY_SIGN_IN = [
  ["Already connected", "The Dhan token you saved in Settings for closes also reads your Dhan holdings.", ["dhan"]],
  ["Sign in on the broker’s page", "You sign in there; Maester never sees your password.", ["kite", "upstox", "fyers", "icici", "fivepaisa"]],
  ["Approve in the broker’s app", "You approve Maester’s key there once a day.", ["groww"]],
  ["Not offered", "These sign in only with your PIN and an authenticator code. Maester doesn’t keep either.", ["angel", "kotak"]],
]
