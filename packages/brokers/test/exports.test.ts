import { describe, expect, it } from "vitest";

// Spec §5.5 and §6: `ctx.http` is the only network access a plugin gets. A plugin imports the kit,
// so the kit must not hand out the factory that makes a client for any host it is given; nor may
// the package itself, which re-exports the kit.
describe("what the kit and the package export", () => {
  it.each([
    ["the kit", () => import("../src/kit/index.js")],
    ["the package", () => import("../src/index.js")],
  ])("%s does not export createBrokerHttp", async (_name, load) => {
    const exported = Object.keys(await load());
    expect(exported).not.toContain("createBrokerHttp");
    expect(exported).not.toContain("isBrokerAddress");
    // The kit's values are still there, so this is not passing on an empty module.
    expect(exported).toEqual(expect.arrayContaining(["BrokerError", "at", "decimal", "sessionExpiry", "sha256hex", "text"]));
  });
});
