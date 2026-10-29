import { BrokerManifest } from "@maester/contracts";
import type { BrokerPlugin } from "./plugin.js";

/** A plugin is wrong in a way that stops the API at start. The message names the plugin and why. */
export class RegistryError extends Error {
  constructor(id: string, why: string) {
    super(`broker plugin ${id}: ${why}`);
  }
}

/** Plugin by broker id. Read-only: see `createRegistry`. */
export type BrokerRegistry = ReadonlyMap<string, BrokerPlugin>;

/** A `Map` that takes its entries once, when it is made, and refuses every later change. */
class FrozenMap<K, V> extends Map<K, V> {
  constructor(entries: Iterable<readonly [K, V]>) {
    super();
    for (const [key, value] of entries) Map.prototype.set.call(this, key, value);
    Object.freeze(this);
  }
  override set(): never {
    throw new TypeError("the broker registry is read-only");
  }
  override delete(): never {
    throw new TypeError("the broker registry is read-only");
  }
  override clear(): never {
    throw new TypeError("the broker registry is read-only");
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/**
 * Builds the registry the API starts with. Each manifest is parsed with `BrokerManifest`, and the
 * parsed copy (defaults filled in) is what the registry keeps, on a frozen copy of the plugin: the
 * caller's own objects are never changed. It throws a `RegistryError` for a manifest that does not
 * parse, a repeated id, a `credentialShown` that is not a credential, two credentials with one key,
 * or a `signIn.kind` that differs between the manifest and the plugin.
 */
export function createRegistry(plugins: readonly BrokerPlugin[]): BrokerRegistry {
  const entries: [string, BrokerPlugin][] = [];
  const seen = new Set<string>();
  for (const plugin of plugins) {
    const parsed = BrokerManifest.safeParse(plugin.manifest);
    if (!parsed.success) {
      // Only where the manifest is wrong, never zod's text: it can quote a value.
      const where = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(manifest)"))].join(", ");
      throw new RegistryError(typeof plugin.manifest?.id === "string" ? plugin.manifest.id : "(no id)", `the manifest is invalid at ${where}`);
    }
    const manifest = parsed.data;
    const fail = (why: string): never => {
      throw new RegistryError(manifest.id, why);
    };
    if (seen.has(manifest.id)) fail("another plugin has the same id");
    seen.add(manifest.id);
    const keys = new Set<string>();
    for (const credential of manifest.credentials) {
      if (keys.has(credential.key)) fail(`two credentials have the key ${credential.key}`);
      keys.add(credential.key);
    }
    if (!keys.has(manifest.credentialShown)) fail("credentialShown is not one of its credentials");
    if (manifest.signIn.kind !== plugin.signIn.kind) fail("the manifest and the plugin disagree on the sign-in kind");
    entries.push([manifest.id, Object.freeze({ ...plugin, manifest: deepFreeze(manifest) })]);
  }
  return new FrozenMap(entries);
}
