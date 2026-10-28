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
});
