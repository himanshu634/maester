import type { BrokerPlugin } from "../plugin.js";
import { createRegistry, type BrokerRegistry } from "../registry.js";
import { kite } from "./kite/plugin.js";

export { kite };

/** Every broker compiled into the API. Adding a broker is adding its folder here and one entry below. */
export const plugins: readonly BrokerPlugin[] = [kite];

/** The registry the API starts with. It throws a `RegistryError` when a plugin is wrong, so a bad plugin stops the start. */
export function defaultRegistry(): BrokerRegistry {
  return createRegistry(plugins);
}
