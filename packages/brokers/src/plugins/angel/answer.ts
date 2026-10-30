import { BrokerError, at, type HttpPhase } from "../../kit/index.js";

/** The codes Angel One gives when the token is no good: invalid, expired or not allowed. */
export const TOKEN_ERRORS: readonly string[] = ["AG8001", "AG8002", "AG8003"];

/** What a code looks like: two capitals and four digits. Anything else could carry anything, so it is never repeated. */
const CODE = /^[A-Z]{2}\d{4}$/;

/** The error code of an answer: the first non-empty string of `errorcode` and `errorCode`, whichever envelope it came in. */
function codeOf(body: unknown): string | undefined {
  for (const key of ["errorcode", "errorCode"]) {
    const value = at(body, key);
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

/**
 * Whether an answer carries an error code of any kind, in either spelling. Only an absent, `null` or empty one is none.
 * Used where an answer that says it worked must still be doubted: a code beside it means something went wrong.
 */
export function carriesErrorCode(body: unknown): boolean {
  return ["errorcode", "errorCode"].some((key) => {
    const value = at(body, key);
    return value !== undefined && value !== null && value !== "";
  });
}

/**
 * Reads one SmartAPI answer that came back with HTTP 200 and gives its `data`. Angel One has two
 * envelopes: `{ status, errorcode }` and `{ success, errorCode }`. A refusal is `BROKER_SIGNED_OUT`
 * while reading and `BROKER_REFUSED` while signing in, for a token code; any other code is the
 * broker failing. Angel One's own `message` is never copied into an error.
 */
export function answer(body: unknown, phase: HttpPhase): unknown {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new BrokerError("BROKER_ANSWER_UNREADABLE", `${phase}: Angel One answered with something that is not an object`);
  }
  if (at(body, "status") === false || at(body, "success") === false) {
    const code = codeOf(body);
    const named = code !== undefined && CODE.test(code) ? code : "an error";
    const kind = code !== undefined && TOKEN_ERRORS.includes(code) ? (phase === "read" ? "BROKER_SIGNED_OUT" : "BROKER_REFUSED") : "BROKER_UNAVAILABLE";
    throw new BrokerError(kind, `${phase}: Angel One answered ${named}`);
  }
  if (at(body, "status") !== true && at(body, "success") !== true) {
    throw new BrokerError("BROKER_ANSWER_UNREADABLE", `${phase}: Angel One's answer says neither that it worked nor that it failed`);
  }
  return at(body, "data");
}
