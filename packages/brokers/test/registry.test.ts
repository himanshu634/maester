import { describe, expect, it } from "vitest";
import { RegistryError, createRegistry } from "../src/registry.js";
import type { BrokerPlugin, RedirectSignIn } from "../src/plugin.js";
import { fakePlugin } from "./fake-plugin.js";

/** A plugin whose manifest is wrong in a way the types allow, so the registry has to catch it. */
const withManifest = (manifest: Record<string, unknown>): BrokerPlugin => ({ ...fakePlugin(), manifest: { ...fakePlugin().manifest, ...manifest } as BrokerPlugin["manifest"] });
const message = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RegistryError);
    return (e as Error).message;
  }
  throw new Error("did not throw");
};

describe("createRegistry", () => {
  it("accepts the fake plugin and is frozen", () => {
    const original = fakePlugin();
    const registry = createRegistry([original]);
    expect([...registry.keys()]).toEqual(["fake"]);

    // The map takes no later change, whatever route it is changed by.
    expect(Object.isFrozen(registry)).toBe(true);
    expect(() => (registry as Map<string, BrokerPlugin>).set("other", original)).toThrow(TypeError);
    expect(() => (registry as Map<string, BrokerPlugin>).delete("fake")).toThrow(TypeError);
    expect(() => (registry as Map<string, BrokerPlugin>).clear()).toThrow(TypeError);
    expect(registry.has("fake")).toBe(true);

    // The registry keeps a frozen copy with the parsed manifest, and leaves the caller's plugin alone.
    const stored = registry.get("fake")!;
    expect(stored).not.toBe(original);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.manifest)).toBe(true);
    expect(Object.isFrozen(stored.manifest.hosts)).toBe(true);
    expect(Object.isFrozen(original)).toBe(false);
    expect(Object.isFrozen(original.manifest)).toBe(false);
    expect(stored.signIn).toBe(original.signIn);
  });

  it("stores the parsed manifest, with its defaults filled in", () => {
    const original = fakePlugin();
    const bare: Record<string, unknown> = { ...original.manifest };
    delete bare.signedOutStatuses;
    const plugin = { ...original, manifest: bare as BrokerPlugin["manifest"] };

    const stored = createRegistry([plugin]).get("fake")!;
    expect(stored.manifest.signedOutStatuses).toEqual([401, 403]);
    expect(plugin.manifest).toBe(bare);
    expect("signedOutStatuses" in bare).toBe(false);
  });

  it("refuses a duplicate id", () => {
    expect(message(() => createRegistry([fakePlugin(), fakePlugin()]))).toBe("broker plugin fake: another plugin has the same id");
  });

  it("refuses credentialShown that is not a credential", () => {
    expect(message(() => createRegistry([fakePlugin({ credentialShown: "apiSecret" })]))).toBe("broker plugin fake: credentialShown is not one of its credentials");
  });

  it("refuses two credentials with one key", () => {
    const twice = fakePlugin({
      credentials: [
        { key: "apiKey", label: "API key", secret: false, minLength: 1, maxLength: 512 },
        { key: "apiKey", label: "Again", secret: true, minLength: 1, maxLength: 512 },
      ],
    });
    expect(message(() => createRegistry([twice]))).toBe("broker plugin fake: two credentials have the key apiKey");
  });

  it("refuses a manifest whose signIn kind disagrees with the plugin's", () => {
    const plugin = fakePlugin();
    const other = { ...plugin, signIn: { ...plugin.signIn, kind: "prompt" } as unknown as RedirectSignIn };
    expect(message(() => createRegistry([other]))).toBe("broker plugin fake: the manifest and the plugin disagree on the sign-in kind");
  });

  it("refuses a manifest that does not parse, naming where and never what", () => {
    const text = message(() => createRegistry([withManifest({ hosts: ["Broker.Test/leak123"] })]));
    expect(text).toBe("broker plugin fake: the manifest is invalid at hosts.0");
    expect(text).not.toContain("leak123");
    expect(message(() => createRegistry([withManifest({ id: undefined })]))).toBe("broker plugin (no id): the manifest is invalid at id");
  });
});
