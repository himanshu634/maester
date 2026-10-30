import type { BrokerManifest } from "@maester/contracts";

/**
 * What the page and the host know about Angel One (SmartAPI) without running the plugin. It is
 * switched off until a live sign-in has been tried (the design's §5): listed, never offered.
 */
export const manifest: BrokerManifest = {
  id: "angel",
  name: "Angel One",
  enabled: false,
  notOfferedReason: "Not offered until Maester has tried a live Angel One sign-in.",
  hosts: ["smartapi.angelone.in", "apiconnect.angelone.in"],
  copy: {
    pickerLine: "Sign in on Angel One’s page each day. SmartAPI is free.",
    lasts: "Until midnight",
    cost: "Free (SmartAPI)",
    formLede: "Angel One lets an app read your holdings once you create a free SmartAPI app of your own and sign in to it each day.",
    steps: [
      "Sign in at smartapi.angelone.in and create an app.",
      "Paste the redirect URL below into the app’s redirect URL.",
      "Copy the app’s API key into the field below.",
      "Save, then sign in on Angel One’s page. You come back here.",
    ],
    saveNote: "Maester asks Angel One only for your holdings. It never places an order.",
    signedOutNote: "Angel One signs Maester out every night at midnight.",
  },
  // The publisher login needs the key and no secret.
  credentials: [{ key: "apiKey", label: "API key", hint: "From your app’s page on SmartAPI.", secret: false, minLength: 6, maxLength: 64 }],
  credentialShown: "apiKey",
  signIn: { kind: "redirect" },
  signedOutStatuses: [401, 403],
};
