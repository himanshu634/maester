import { describe, expect, it } from "vitest";
import { Connection, ConnectionList, ConnectionProvider, SaveDhanConnectionRequest, SaveFredConnectionRequest } from "../src/index.js";

describe("connection contract", () => {
  it("names the two providers", () => {
    expect(ConnectionProvider.options).toEqual(["dhan", "fred"]);
  });

  it("bounds the Dhan client ID and token", () => {
    expect(SaveDhanConnectionRequest.safeParse({ clientId: "1000001", accessToken: "x".repeat(20) }).success).toBe(true);
    expect(SaveDhanConnectionRequest.safeParse({ clientId: "", accessToken: "x".repeat(20) }).success).toBe(false);
    expect(SaveDhanConnectionRequest.safeParse({ clientId: "1".repeat(33), accessToken: "x".repeat(20) }).success).toBe(false);
    expect(SaveDhanConnectionRequest.safeParse({ clientId: "1000001", accessToken: "x".repeat(19) }).success).toBe(false);
    expect(SaveDhanConnectionRequest.safeParse({ clientId: "1000001", accessToken: "x".repeat(4097) }).success).toBe(false);
  });

  it("takes a FRED key of 32 lower-case letters and digits", () => {
    expect(SaveFredConnectionRequest.safeParse({ apiKey: "abcdefghijklmnopqrstuvwxyz012345" }).success).toBe(true);
    expect(SaveFredConnectionRequest.safeParse({ apiKey: "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" }).success).toBe(false);
    expect(SaveFredConnectionRequest.safeParse({ apiKey: "abc" }).success).toBe(false);
    expect(SaveFredConnectionRequest.safeParse({ apiKey: "abcdefghijklmnopqrstuvwxyz0123456" }).success).toBe(false);
  });

  it("does not echo the rejected value in a validation message", () => {
    const secret = "ZZsecretUPPER0123456789ABCDEFGHI";
    const r = SaveFredConnectionRequest.safeParse({ apiKey: secret });
    expect(JSON.stringify(r.error?.issues)).not.toContain(secret);
  });

  it("parses a list of two connections", () => {
    const empty = { clientId: null, last4: null, expiresAt: null, checkedAt: null, lastRead: null, notice: null };
    const list = ConnectionList.parse({ items: [{ provider: "dhan", state: "not_connected", ...empty }, { provider: "fred", state: "not_connected", ...empty }] });
    expect(list.items).toHaveLength(2);
    expect(Connection.safeParse({ provider: "dhan", state: "connected", ...empty, last4: "abcd", notice: "DATA_PLAN_INACTIVE" }).success).toBe(true);
    expect(Connection.safeParse({ provider: "dhan", state: "weird", ...empty }).success).toBe(false);
  });
});
