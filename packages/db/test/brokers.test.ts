import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/client.js";
import {
  createBrokerLoginState, finishHoldingRead, forgetBrokerCredentials, getBrokerConnection, latestCloses, latestHoldings, markBrokerError,
  saveBrokerCredentials, saveBrokerSession, startHoldingRead, takeBrokerLoginState,
} from "../src/queries/brokers.js";
import { upsertMarketPoints } from "../src/queries/market.js";
import { ensurePersonalWorkspace } from "../src/queries/workspaces.js";
import { insertUser, testDb, truncateAll } from "./helpers.js";

const db = await testDb();
afterAll(() => closeDb(db));

let workspaceId = "";
beforeEach(async () => {
  await truncateAll(db);
  await insertUser(db, "u1", "u1@example.com");
  workspaceId = (await ensurePersonalWorkspace(db, { userId: "u1", userName: "Ada" })).id;
});

const save = () => saveBrokerCredentials(db, { workspaceId, broker: "kite", credentialsCiphertext: "c1", keyLast4: "1234", savedByUserId: "u1" });
const line = { isin: "INE040A01034", exchange: "NSE", symbol: "HDFCBANK", quantity: "120", t1Quantity: "0", averagePrice: "1512.4", lastPrice: "1742.6" };

describe("broker connections", () => {
  it("a new key ends the sign-in made with the old one", async () => {
    const row = await save();
    await saveBrokerSession(db, row.id, { accountId: "AB1234", tokenCiphertext: "t", signedInAt: new Date(), tokenExpiresAt: new Date(Date.now() + 3_600_000) });
    const again = await saveBrokerCredentials(db, { workspaceId, broker: "kite", credentialsCiphertext: "c2", keyLast4: "5678", savedByUserId: "u1" });
    expect(again.id).toBe(row.id);
    expect(again).toMatchObject({ credentialsCiphertext: "c2", keyLast4: "5678", tokenCiphertext: null, tokenExpiresAt: null, accountId: "AB1234" });
  });

  it("a login nonce works once, and not after it expires", async () => {
    const row = await save();
    const now = new Date();
    await createBrokerLoginState(db, { nonce: "n1", connectionId: row.id, userId: "u1", expiresAt: new Date(now.getTime() + 600_000) });
    expect(await takeBrokerLoginState(db, "n1", now)).toMatchObject({ connectionId: row.id });
    expect(await takeBrokerLoginState(db, "n1", now)).toBeNull();
    await createBrokerLoginState(db, { nonce: "n2", connectionId: row.id, userId: "u1", expiresAt: new Date(now.getTime() - 1) });
    expect(await takeBrokerLoginState(db, "n2", now)).toBeNull();
  });

  it("signed out drops the token; disconnect keeps the account and its reads", async () => {
    const row = await save();
    await saveBrokerSession(db, row.id, { accountId: "AB1234", tokenCiphertext: "t", signedInAt: new Date(), tokenExpiresAt: new Date() });
    const read = await startHoldingRead(db, row.id);
    await finishHoldingRead(db, read, { ok: true, lines: [line] });
    await markBrokerError(db, row.id, "BROKER_SIGNED_OUT");
    expect(await getBrokerConnection(db, workspaceId, "kite")).toMatchObject({ tokenCiphertext: null, lastErrorCode: "BROKER_SIGNED_OUT" });
    await forgetBrokerCredentials(db, row.id);
    expect(await getBrokerConnection(db, workspaceId, "kite")).toMatchObject({ credentialsCiphertext: null, keyLast4: null });
    const [latest] = await latestHoldings(db, [row.id]);
    expect(latest?.lines).toHaveLength(1);
  });

  it("keeps the last good read's lines when a later read fails, as numeric text", async () => {
    const row = await save();
    const good = await startHoldingRead(db, row.id);
    await finishHoldingRead(db, good, { ok: true, lines: [line] });
    await new Promise((r) => setTimeout(r, 5));
    const bad = await startHoldingRead(db, row.id);
    await finishHoldingRead(db, bad, { ok: false, errorCode: "BROKER_UNAVAILABLE" });
    const [latest] = await latestHoldings(db, [row.id]);
    expect(latest?.lastRead).toMatchObject({ id: bad, state: "failed", errorCode: "BROKER_UNAVAILABLE" });
    expect(latest?.lastOk).toMatchObject({ id: good, lineCount: 1 });
    expect(latest?.lines[0]).toMatchObject({ quantity: "120", averagePrice: "1512.4", lastPrice: "1742.6" });
  });

  it("stores an average price the broker did not give as null, not 0", async () => {
    const row = await save();
    const read = await startHoldingRead(db, row.id);
    await finishHoldingRead(db, read, { ok: true, lines: [{ ...line, averagePrice: null, lastPrice: null }] });
    const [latest] = await latestHoldings(db, [row.id]);
    expect(latest?.lines[0]).toMatchObject({ quantity: "120", averagePrice: null, lastPrice: null });
  });
});

describe("latestCloses", () => {
  it("gives each symbol's latest close as text", async () => {
    await upsertMarketPoints(db, [
      { series: "eq:HDFCBANK", day: "2026-10-15", value: 1730.1, source: "Dhan · NSE close" },
      { series: "eq:HDFCBANK", day: "2026-10-16", value: 1742.6, source: "Dhan · NSE close" },
    ]);
    expect(await latestCloses(db, ["HDFCBANK", "TITAN"])).toEqual({ HDFCBANK: { day: "2026-10-16", value: "1742.6", source: "Dhan · NSE close" } });
  });
});
