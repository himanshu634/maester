import type { BrokerHoldingLine, BrokerManifest } from "@maester/contracts";
import type { BrokerHttp } from "./kit/http.js";

export type { BrokerHoldingLine } from "@maester/contracts";

/** The fields the investor saved for a broker, by the manifest's credential `key`. */
export type Credentials = Record<string, string>;

/** What a sign-in gives the host to encrypt and keep: the token, whose account it is and when it stops working. */
export type BrokerSession = { accessToken: string; accountId: string | null; signedInAt: Date; expiresAt: Date };

/**
 * What a plugin makes of the broker's return. `state` is null when the broker sent none, and the
 * host then refuses the return. `refused` means the broker says the investor turned the sign-in down.
 */
export type ReturnRead = { state: string | null; payload: Record<string, string> } | { state: string | null; refused: true };

/** The one strategy today: save a key, sign in on the broker's page, come back with a code or a token. */
export type RedirectSignIn = {
  kind: "redirect";
  /** The broker's login page. It must be https on one of the manifest's hosts; the host checks. */
  loginUrl(ctx: { creds: Credentials; state: string; returnUrl: string }): string;
  /** Reads the broker's return. */
  readReturn(query: Record<string, string | undefined>): ReturnRead;
  /** Turns the return into a session, with whatever calls the broker needs, made through `ctx.http`. */
  complete(ctx: { creds: Credentials; payload: Record<string, string>; returnUrl: string; http: BrokerHttp; now: Date }): Promise<BrokerSession>;
};

/** What the host hands a read: the saved fields, the session it decrypted, and an `http` locked to the broker. */
export type ReadCtx = { creds: Credentials; session: { accessToken: string; accountId: string | null }; http: BrokerHttp; now: Date };

/**
 * A broker. The manifest is data the web and the host use without running the plugin; the rest is
 * behaviour. A plugin can sign in and read, and nothing else: there is no way to place an order
 * or move money. The API calls a plugin through `host.ts`, with one exception: the return route
 * calls `signIn.readReturn` directly, because it only reads the query and makes no network call.
 */
export type BrokerPlugin = {
  manifest: BrokerManifest;
  /** A union of strategies; one member today. `signIn.kind` must equal `manifest.signIn.kind`. */
  signIn: RedirectSignIn;
  reads: {
    holdings(ctx: ReadCtx): Promise<BrokerHoldingLine[]>;
    // Later reads (funds, positions, SIPs) are optional members added here, each with its own output schema.
  };
};
