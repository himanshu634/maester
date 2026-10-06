import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, type Db } from "../src/client.js";
import {
  deleteConnection, getConnection, lastMarketReads, listConnections, markConnectionError, saveConnection, upsertMarketPoints,
} from "../src/index.js";
import { insertUser, testDb, truncateAll } from "./helpers.js";

let db: Db;
beforeAll(async () => { db = await testDb(); });
beforeEach(() => truncateAll(db));
afterAll(() => closeDb(db));

const dhan = (over: Partial<Parameters<typeof saveConnection>[1]> = {}) => ({
  provider: "dhan" as const,
  clientId: "1000001",
  secretCiphertext: "c1",
  secretLast4: "abcd",
  expiresAt: new Date("2026-11-05T00:00:00Z"),
  checkedAt: new Date("2026-10-06T10:00:00Z"),
  savedByUserId: null,
  ...over,
});

describe("market connections", () => {
  it("saves, reads, lists in provider order and deletes", async () => {
    await saveConnection(db, { provider: "fred", clientId: null, secretCiphertext: "f1", secretLast4: "wxyz", expiresAt: null, checkedAt: new Date(), savedByUserId: null });
    await saveConnection(db, dhan());
    expect((await listConnections(db)).map((r) => r.provider)).toEqual(["dhan", "fred"]);
    const got = await getConnection(db, "dhan");
    expect(got).toMatchObject({ provider: "dhan", clientId: "1000001", secretCiphertext: "c1", secretLast4: "abcd", lastErrorCode: null });
    expect(got!.savedAt).toBeInstanceOf(Date);
    expect(await deleteConnection(db, "dhan")).toBe(true);
    expect(await deleteConnection(db, "dhan")).toBe(false);
    expect(await getConnection(db, "dhan")).toBeNull();
  });

  it("replaces on a second save, clearing the error and moving savedAt", async () => {
    await saveConnection(db, dhan());
    await markConnectionError(db, "dhan", "DHAN_TOKEN_EXPIRED");
    expect((await getConnection(db, "dhan"))!.lastErrorCode).toBe("DHAN_TOKEN_EXPIRED");
    await db.execute(sql`update market_connection set saved_at = now() - interval '1 day'`);
    const before = (await getConnection(db, "dhan"))!.savedAt;
    await saveConnection(db, dhan({ secretCiphertext: "c2", secretLast4: "efgh", checkedAt: new Date("2026-10-07T10:00:00Z") }));
    const after = (await getConnection(db, "dhan"))!;
    expect(after).toMatchObject({ secretCiphertext: "c2", secretLast4: "efgh", lastErrorCode: null });
    expect(after.checkedAt.toISOString()).toBe("2026-10-07T10:00:00.000Z");
    expect(after.savedAt.getTime()).toBeGreaterThan(before.getTime());
    await markConnectionError(db, "dhan", null);
    expect((await getConnection(db, "dhan"))!.lastErrorCode).toBeNull();
  });

  it("refuses an unknown provider", async () => {
    await expect(db.execute(sql`insert into market_connection (provider, secret_ciphertext, secret_last4, checked_at) values ('other', 'x', 'x', now())`)).rejects.toThrow();
  });

  it("keeps the connection when the user who saved it is deleted", async () => {
    await insertUser(db, "u1", "u1@example.com");
    await saveConnection(db, dhan({ savedByUserId: "u1" }));
    await db.execute(sql`delete from "user" where id = 'u1'`);
    expect((await getConnection(db, "dhan"))!.savedByUserId).toBeNull();
  });

  it("gives the last time each source's readings were stored", async () => {
    expect(await lastMarketReads(db)).toEqual({ dhan: null, fred: null });
    await upsertMarketPoints(db, [
      { series: "india_vix", day: "2026-10-06", value: 17, source: "Dhan · NSE close" },
      { series: "us_vix", day: "2026-10-05", value: 16, source: "FRED · Cboe VIX close" },
    ]);
    const got = await lastMarketReads(db);
    expect(got.dhan).toBeInstanceOf(Date);
    expect(got.fred).toBeInstanceOf(Date);
  });
});
