import type { BrokerDefinition } from "@maester/contracts";
import dhan from "../definitions/dhan.json" with { type: "json" };
import groww from "../definitions/groww.json" with { type: "json" };
import icici from "../definitions/icici.json" with { type: "json" };
import kite from "../definitions/kite.json" with { type: "json" };
import upstox from "../definitions/upstox.json" with { type: "json" };
import { parseDefinition } from "./definitions.js";

/**
 * The definitions that ship with Maester, imported so a bundled API carries them. A folder named
 * by BROKER_DEFINITIONS_DIR adds to them and replaces any with the same id.
 */
export function builtInDefinitions(): Map<string, BrokerDefinition> {
  const out = new Map<string, BrokerDefinition>();
  for (const [file, json] of [["definitions/kite.json", kite], ["definitions/dhan.json", dhan], ["definitions/upstox.json", upstox], ["definitions/groww.json", groww], ["definitions/icici.json", icici]] as const) {
    const def = parseDefinition(json, file);
    out.set(def.id, def);
  }
  return out;
}
