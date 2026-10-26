import { SaxesParser } from "saxes";

export type XbrlSniff = "xbrl" | "doctype" | "not_xbrl";

const XBRL_INSTANCE_URI = "http://www.xbrl.org/2003/instance";

/** Thrown from a listener to stop the parser at the first answer. Never escapes `sniffXbrl`. */
class Settled extends Error {}

/**
 * Does the head of a file open an XBRL instance? Looks only at what comes before the root's first tag:
 * a DOCTYPE answers `doctype` (a DTD can declare entities, so Maester refuses it) and the first tag
 * answers `xbrl` or `not_xbrl` by its local name and namespace. A parse error, or no root within the
 * bytes given, answers `not_xbrl`. The parser handles no DTD and reads no entity; it stops at the first answer.
 */
export function sniffXbrl(head: Uint8Array): XbrlSniff {
  let start = 0;
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) start = 3;
  while (start < head.length && (head[start] === 0x20 || head[start] === 0x09 || head[start] === 0x0a || head[start] === 0x0d)) start++;
  if (start >= head.length) return "not_xbrl";

  let answer: XbrlSniff = "not_xbrl";
  const settle = (a: XbrlSniff): never => {
    answer = a;
    throw new Settled();
  };
  const parser = new SaxesParser({ xmlns: true });
  parser.on("error", () => settle("not_xbrl"));
  parser.on("doctype", () => settle("doctype"));
  parser.on("opentag", (tag) => settle(tag.local === "xbrl" && tag.uri === XBRL_INSTANCE_URI ? "xbrl" : "not_xbrl"));
  try {
    parser.write(new TextDecoder("utf-8", { fatal: false }).decode(head.subarray(start), { stream: true }));
  } catch (err) {
    if (!(err instanceof Settled)) return "not_xbrl";
  }
  return answer;
}
