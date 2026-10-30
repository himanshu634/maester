import type { BrokerManifest } from "@maester/contracts";

/** What the page and the host know about Zerodha (Kite Connect) without running the plugin. */
export const kiteManifest: BrokerManifest = {
  id: "kite",
  name: "Zerodha",
  enabled: true,
  hosts: ["kite.zerodha.com", "api.kite.trade"],
  copy: {
    pickerLine: "Sign in on Zerodha’s page each day. Holdings are in the free Personal plan.",
    lasts: "Until 6:00 the next morning",
    cost: "Free (Kite Connect Personal)",
    formLede: "Zerodha lets an app read your holdings once you create a free Kite Connect app of your own and sign in to it each day.",
    steps: [
      "Sign in at developers.kite.trade and create a Personal app. It’s free and includes holdings.",
      "Paste the redirect URL below into the app’s redirect URL.",
      "Copy the app’s API key and secret into the fields below.",
      "Save, then sign in on Zerodha’s page. You come back here.",
    ],
    saveNote: "Maester asks Zerodha only for your holdings. It never places an order.",
    signedOutNote: "Zerodha signs Maester out every morning at 6:00.",
  },
  credentials: [
    { key: "apiKey", label: "API key", hint: "From your app’s page on Kite Connect.", secret: false, minLength: 6, maxLength: 64 },
    { key: "apiSecret", label: "API secret", secret: true, minLength: 6, maxLength: 128 },
  ],
  credentialShown: "apiKey",
  signIn: { kind: "redirect" },
  signedOutStatuses: [403],
};
