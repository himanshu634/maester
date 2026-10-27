export { BrokerClient, type BrokerHoldingLine, type BrokerSession, type Credentials, type ReadSession } from "./client.js";
export { builtInDefinitions } from "./built-in.js";
export { DefinitionError, checkDefinition, loadDefinitions, parseDefinition } from "./definitions.js";
export { BrokerError, type BrokerErrorCode } from "./errors.js";
export { sessionExpiry } from "./kit/expiry.js";
// The plugin contract and its host. `Credentials` and `BrokerSession` (above, from client.ts) have the
// same shape as the ones in plugin.ts, and `BrokerHoldingLine` stays the old type until the old
// client goes; this export then moves to plugin.ts and the contracts' schema.
export type { BrokerPlugin, ReadCtx, RedirectSignIn, ReturnRead } from "./plugin.js";
export { RegistryError, createRegistry, type BrokerRegistry } from "./registry.js";
export { completeSignIn, loginUrlFor, readHoldings, toBrokerError } from "./host.js";
export { defaultRegistry, plugins } from "./plugins/index.js";
