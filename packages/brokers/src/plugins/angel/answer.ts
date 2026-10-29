import { BrokerError, at, type HttpPhase } from "../../kit/index.js";

/** The codes Angel One gives when the token is no good: invalid, expired or not allowed. */
export const TOKEN_ERRORS: readonly string[] = ["AG8001", "AG8002", "AG8003"];

/** What a code looks like: two capitals and four digits. Anything else could carry anything, so it is never repeated. */
const CODE = /^[A-Z]{2}\d{4}$/;

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
    const code = at(body, "errorcode") ?? at(body, "errorCode");
    const named = typeof code === "string" && CODE.test(code) ? code : "an error";
    const kind = typeof code === "string" && TOKEN_ERRORS.includes(code) ? (phase === "read" ? "BROKER_SIGNED_OUT" : "BROKER_REFUSED") : "BROKER_UNAVAILABLE";
    throw new BrokerError(kind, `${phase}: Angel One answered ${named}`);
  }
  if (at(body, "status") !== true && at(body, "success") !== true) {
    throw new BrokerError("BROKER_ANSWER_UNREADABLE", `${phase}: Angel One's answer says neither that it worked nor that it failed`);
  }
  return at(body, "data");
}
