import type { BrokerDefinition } from "@maester/contracts";
import dhan from "../definitions/dhan.json" with { type: "json" };
import kite from "../definitions/kite.json" with { type: "json" };
import { parseDefinition } from "./definitions.js";

/**
 * The definitions that ship with Maester, imported so a bundled API carries them. A folder named
 * by BROKER_DEFINITIONS_DIR adds to them and replaces any with the same id.
 */
export function builtInDefinitions(): Map<string, BrokerDefinition> {
  const out = new Map<string, BrokerDefinition>();
  for (const [file, json] of [["definitions/kite.json", kite], ["definitions/dhan.json", dhan]] as const) {
    const def = parseDefinition(json, file);
    out.set(def.id, def);
  }
  return out;
}
