import { describe, expect, it } from "vitest";
import { BrokerError } from "../../../src/errors.js";
import { TOKEN_ERRORS, answer } from "../../../src/plugins/angel/answer.js";
import errorOther from "./fixtures/error-other.json";
import errorToken from "./fixtures/error-token.json";

/** What `answer` throws for a body, or null when it returns. */
const thrown = (body: unknown, phase: "read" | "sign-in"): BrokerError | null => {
  try {
    answer(body, phase);
    return null;
  } catch (e) {
    return e as BrokerError;
  }
};

describe("the Angel One answer reader", () => {
  it("names the codes that mean the token is no good", () => {
    expect(TOKEN_ERRORS).toEqual(["AG8001", "AG8002", "AG8003"]);
  });

  it("returns data from a good answer", () => {
    expect(answer({ status: true, data: [1] }, "read")).toEqual([1]);
    expect(answer({ success: true, data: { a: 1 } }, "sign-in")).toEqual({ a: 1 });
  });

  it("reads the success/errorCode envelope", () => {
    const read = thrown(errorToken, "read");
    expect(read).toBeInstanceOf(BrokerError);
    expect(read?.code).toBe("BROKER_SIGNED_OUT");
    expect(thrown(errorToken, "sign-in")?.code).toBe("BROKER_REFUSED");
  });

  it("reads the status/errorcode envelope", () => {
    expect(thrown({ status: false, errorcode: "AG8002" }, "read")?.code).toBe("BROKER_SIGNED_OUT");
    expect(thrown({ status: false, errorcode: "AG8003" }, "read")?.code).toBe("BROKER_SIGNED_OUT");
    expect(thrown({ status: false, errorcode: "AG8002" }, "sign-in")?.code).toBe("BROKER_REFUSED");
  });

  it("any other code is BROKER_UNAVAILABLE", () => {
    for (const phase of ["read", "sign-in"] as const) {
      expect(thrown(errorOther, phase)?.code, phase).toBe("BROKER_UNAVAILABLE");
      expect(thrown({ status: false }, phase)?.code, phase).toBe("BROKER_UNAVAILABLE");
    }
  });

  it("reads the code from whichever key holds a non-empty one", () => {
    // An empty `errorcode` beside a real `errorCode` is the real code: `??` would have stopped at "".
    for (const body of [
      { success: false, errorcode: "", errorCode: "AG8001" },
      { status: false, errorcode: "AG8001", errorCode: "" },
      { status: false, errorcode: null, errorCode: "AG8001" },
      { status: false, errorcode: 8001, errorCode: "AG8001" },
    ]) {
      expect(thrown(body, "read")?.code, JSON.stringify(body)).toBe("BROKER_SIGNED_OUT");
      expect(thrown(body, "sign-in")?.code, JSON.stringify(body)).toBe("BROKER_REFUSED");
      expect(thrown(body, "read")?.message, JSON.stringify(body)).toBe("read: Angel One answered AG8001");
    }
    // Both keys empty is no code at all.
    expect(thrown({ success: false, errorcode: "", errorCode: "" }, "read")?.message).toBe("read: Angel One answered an error");
  });

  it("a false flag is a failure even when the other flag says true", () => {
    expect(thrown({ status: true, success: false }, "read")?.code).toBe("BROKER_UNAVAILABLE");
    expect(thrown({ status: false, success: true }, "read")?.code).toBe("BROKER_UNAVAILABLE");
    expect(thrown({ status: true, success: false, errorCode: "AG8001" }, "read")?.code).toBe("BROKER_SIGNED_OUT");
  });

  it("a body with neither flag is unreadable", () => {
    for (const body of [{}, null, "text", { status: "true" }, { success: "true" }, [], 7, { data: [1] }]) {
      const err = thrown(body, "read");
      expect(err, JSON.stringify(body)).toBeInstanceOf(BrokerError);
      expect(err?.code, JSON.stringify(body)).toBe("BROKER_ANSWER_UNREADABLE");
    }
  });

  it("names the phase and the code, and an error when the code is not one Angel One prints", () => {
    expect(thrown(errorToken, "read")?.message).toBe("read: Angel One answered AG8001");
    expect(thrown(errorOther, "sign-in")?.message).toBe("sign-in: Angel One answered AB1004");
    expect(thrown({ status: false }, "read")?.message).toBe("read: Angel One answered an error");
    // A code that is not two capitals and four digits could carry anything, so it is not repeated.
    for (const errorcode of ["secret-key-123", "ag8001", "AG80011", "", 8001, null]) {
      expect(thrown({ status: false, errorcode }, "read")?.message, String(errorcode)).toBe("read: Angel One answered an error");
    }
  });

  it("never passes Angel One's text on", () => {
    for (const body of [errorToken, errorOther]) {
      for (const phase of ["read", "sign-in"] as const) {
        const message = thrown(body, phase)?.message ?? "";
        expect(message).not.toContain("Invalid Token");
        expect(message).not.toContain("Something Went Wrong");
      }
    }
  });
});
