import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const MESSAGE = "Plugins reach the network only through ctx.http (spec §5.5)";

const eslint = new ESLint({ cwd: packageRoot });
const lint = async (code: string, filePath: string) => {
  const [result] = await eslint.lintText(code, { filePath: `${packageRoot}${filePath}` });
  return result?.messages ?? [];
};
const rulesOf = (messages: { ruleId: string | null }[]) => messages.map((m) => m.ruleId);

describe("plugin lint guard (spec §5.5)", () => {
  const bad = `import https from "node:https";\nexport const get = () => fetch("https://x");\nexport const ref = () => https;\n`;

  it("bans fetch and node:https inside a plugin", async () => {
    const messages = await lint(bad, "src/plugins/x/bad.ts");
    const errors = messages.filter((m) => m.severity === 2);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(rulesOf(errors)).toContain("no-restricted-globals");
    expect(rulesOf(errors)).toContain("no-restricted-imports");
    for (const m of errors.filter((e) => e.ruleId?.startsWith("no-restricted"))) {
      expect(m.message).toContain(MESSAGE);
    }
  });

  it("leaves the same code alone outside plugins", async () => {
    const messages = await lint(bad, "src/host.ts");
    expect(rulesOf(messages)).not.toContain("no-restricted-globals");
    expect(rulesOf(messages)).not.toContain("no-restricted-imports");
  });

  it.each(["fetch", "XMLHttpRequest", "WebSocket", "process"])("bans the global %s inside a plugin", async (name) => {
    const messages = await lint(`export const x = () => ${name};\n`, "src/plugins/x/bad.ts");
    expect(rulesOf(messages)).toContain("no-restricted-globals");
  });

  it.each([
    "node:http", "node:https", "node:net", "node:tls", "node:fs", "node:fs/promises", "node:child_process",
    "http", "https", "net", "tls", "fs", "fs/promises", "child_process", "undici",
  ])("bans importing %s inside a plugin", async (name) => {
    const messages = await lint(`import * as m from "${name}";\nexport const x = m;\n`, "src/plugins/x/bad.ts");
    expect(rulesOf(messages)).toContain("no-restricted-imports");
  });

  // The allow-list: a plugin imports relative modules and @maester/contracts, and nothing else, so
  // a module nobody thought to list is refused all the same.
  it.each(["node:http2", "dns", "node:dns", "worker_threads", "node:module", "node:crypto", "zod", "@maester/db", "@maester/contracts/brokers", "."])(
    "bans the bare import %s inside a plugin, unlisted",
    async (name) => {
      const messages = await lint(`import "${name}";\n`, "src/plugins/x/bad.ts");
      const errors = messages.filter((m) => m.ruleId === "no-restricted-imports");
      expect(errors.length, name).toBeGreaterThan(0);
      for (const m of errors) expect(m.message).toContain(MESSAGE);
    },
  );

  it.each([
    ["a dynamic import", `export const x = () => import("node:https");\n`, "no-restricted-syntax"],
    ["require", `export const x = () => require("http");\n`, "no-restricted-syntax"],
    ["globalThis.fetch", `export const x = () => globalThis.fetch("https://x");\n`, "no-restricted-syntax"],
    ["globalThis['fetch']", `export const x = () => globalThis["fetch"]("https://x");\n`, "no-restricted-syntax"],
    ["an alias of globalThis", `const g = globalThis;\nexport const x = () => g;\n`, "no-restricted-globals"],
    ["global.fetch", `export const x = () => global.fetch("https://x");\n`, "no-restricted-globals"],
    ["the factory by name", `import { createBrokerHttp } from "../../kit/http.js";\nexport const x = createBrokerHttp;\n`, "no-restricted-imports"],
    ["the factory by name, renamed", `import { createBrokerHttp as make } from "../../kit/http.js";\nexport const x = make;\n`, "no-restricted-syntax"],
    ["the factory by name, from another module", `import { createBrokerHttp } from "./reexport.js";\nexport const x = createBrokerHttp;\n`, "no-restricted-syntax"],
    ["the factory's module, as a namespace", `import * as h from "../../kit/http.js";\nexport const x = h;\n`, "no-restricted-imports"],
    ["the host", `import { readHoldings } from "../../host.js";\nexport const x = readHoldings;\n`, "no-restricted-imports"],
    ["the host, by a longer path", `import { readHoldings } from "./../../kit/../host.js";\nexport const x = readHoldings;\n`, "no-restricted-imports"],
    ["the package's index", `import { readHoldings } from "../../index.js";\nexport const x = readHoldings;\n`, "no-restricted-imports"],
    ["the package's index, as a folder", `import { readHoldings } from "../..";\nexport const x = readHoldings;\n`, "no-restricted-imports"],
  ])("bans %s inside a plugin", async (_what, code, rule) => {
    const messages = await lint(code, "src/plugins/x/bad.ts");
    const errors = messages.filter((m) => m.ruleId === rule);
    expect(errors.length, code).toBeGreaterThan(0);
    for (const m of errors) expect(m.message).toContain(MESSAGE);
  });

  it("allows what a plugin needs: its own folder, the kit, the contract and @maester/contracts", async () => {
    const code = [
      `import type { BrokerManifest } from "@maester/contracts";`,
      `import { BrokerError, at, type BrokerHttp } from "../../kit/index.js";`,
      `import type { BrokerPlugin } from "../../plugin.js";`,
      `import { kiteManifest } from "./manifest.js";`,
      `export const x: [BrokerManifest | null, BrokerHttp | null, BrokerPlugin | null] = [null, null, null];`,
      `export const y = [BrokerError, at, kiteManifest];`,
      "",
    ].join("\n");
    const messages = await lint(code, "src/plugins/x/good.ts");
    expect(messages.filter((m) => m.severity === 2)).toEqual([]);
  });

  it("finds nothing in the real plugins", async () => {
    const results = await eslint.lintFiles(["src/plugins/**/*.ts"]);
    expect(results.map((r) => r.filePath.slice(packageRoot.length)).sort()).toEqual(
      expect.arrayContaining(["src/plugins/index.ts", "src/plugins/kite/manifest.ts", "src/plugins/kite/plugin.ts"]),
    );
    const errors = results.flatMap((r) => r.messages.map((m) => `${r.filePath.slice(packageRoot.length)}: ${m.ruleId} ${m.message}`));
    expect(errors).toEqual([]);
  });
});
