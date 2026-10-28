// The kit, which is all a plugin may import: `BrokerError`, the HTTP client (the host makes one,
// locked to the broker), the value readers and the expiry rule.
export * from "./kit/index.js";
// The plugin contract, and the holding line a plugin returns (the contracts' type, under one name).
export type { BrokerHoldingLine, BrokerPlugin, BrokerSession, Credentials, ReadCtx, RedirectSignIn, ReturnRead } from "./plugin.js";
export { RegistryError, createRegistry, type BrokerRegistry } from "./registry.js";
// What the API calls: it never calls a plugin's own methods except `signIn.readReturn`.
export { completeSignIn, loginUrlFor, readHoldings, toBrokerError } from "./host.js";
export { defaultRegistry, plugins } from "./plugins/index.js";
