import { createHash } from "node:crypto";
import { BrokerError } from "../errors.js";

/** Reads a dotted path such as `data.access_token`. */
export function at(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * A JSON number or string as a decimal string. A number keeps the digits JSON printed (the
 * shortest form that reads back the same); an exponent or anything else is unreadable.
 */
export function decimal(v: unknown, field: string): string {
  const s = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v.trim() : null;
  if (s === null || !DECIMAL.test(s)) throw new BrokerError("BROKER_ANSWER_UNREADABLE", `holding field ${field} is not a decimal`);
  return s;
}

/** A non-empty string, trimmed. */
export function text(v: unknown, field: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new BrokerError("BROKER_ANSWER_UNREADABLE", `holding field ${field} is missing`);
  return v.trim();
}

/** SHA-256 of the parts joined with nothing between them, as lower-case hex (Kite's checksum). */
export function sha256hex(...parts: string[]): string {
  return createHash("sha256").update(parts.join("")).digest("hex");
}
