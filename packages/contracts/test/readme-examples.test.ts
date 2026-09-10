import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as contracts from "../src/index.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const pattern = /<!-- schema: (\w+) -->\s*```json\n([\s\S]*?)```/g;
const cases = [...readme.matchAll(pattern)].map((m) => ({ name: m[1]!, json: m[2]! }));

describe("README examples", () => {
  it("has at least one example", () => expect(cases.length).toBeGreaterThan(0));
  for (const c of cases) {
    it(`${c.name} example parses`, () => {
      const schema = (contracts as Record<string, unknown>)[c.name] as { parse: (v: unknown) => unknown };
      expect(schema, `no export named ${c.name}`).toBeDefined();
      expect(() => schema.parse(JSON.parse(c.json))).not.toThrow();
    });
  }
});
