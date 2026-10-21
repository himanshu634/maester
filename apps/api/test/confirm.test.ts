import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfirmCompanyResponse, JobTypes } from "@maester/contracts";
import { getCurrentClassification, schema } from "@maester/db";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

const send = (cookie: string, body: unknown) => ({
  method: "POST", headers: { cookie, "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body),
});
const confirmUrl = (ws: string) => `/v1/workspaces/${ws}/companies/confirm`;
const NEW = { displayName: "Synthetic Cements Limited", country: "IN" };
const CIN = "L26940MH2001PLC123456";

/** A stored document held for a company, printing the given codes. */
async function seedHeld(
  w: { workspaceId: string; userId: string },
  format: "pdf" | "xbrl",
  codes: Partial<typeof schema.documentClassification.$inferInsert>,
  over: Partial<typeof schema.document.$inferInsert> = {},
) {
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.document).values({
    id, workspaceId: w.workspaceId, originalName: `r.${format === "pdf" ? "pdf" : "xml"}`, declaredSize: 10, declaredMime: format === "pdf" ? "application/pdf" : "text/xml",
    format, storageKey: `workspaces/${w.workspaceId}/documents/${id}/original.${format === "pdf" ? "pdf" : "xml"}`, state: "stored", intakeState: "needs_company",
    createdByUserId: w.userId, ...over,
  });
  await ctx.db.insert(schema.documentClassification).values({
    id: crypto.randomUUID(), workspaceId: w.workspaceId, documentId: id, kind: "financial_results", periodEnd: "2025-09-30", setBy: "maester",
    companyNameAsPrinted: "Synthetic Cements Limited", xbrlFormat: format === "xbrl" ? "in-capmkt/ind_as" : null, ...codes,
  });
  return id;
}

const docRow = async (id: string) => (await ctx.db.select().from(schema.document).where(eq(schema.document.id, id)))[0]!;
const jobsOf = async (ws: string, id: string) => (await ctx.db.select().from(schema.job).where(and(eq(schema.job.workspaceId, ws), eq(schema.job.subjectId, id)))).map((j) => j.type).sort();

describe("POST /companies/confirm", () => {
  it("confirms a printed identity once for every held file printing it, and starts each file's next step", async () => {
    const a = await ctx.signUp("confirm-a@example.com");
    const b = await ctx.signUp("confirm-b@example.com");
    const cons = await seedHeld(a, "xbrl", { bseCode: "500999", basis: "consolidated" });
    const stand = await seedHeld(a, "xbrl", { bseCode: "500999", basis: "standalone" });
    const pdf = await seedHeld(a, "pdf", { bseCode: "500999", cin: CIN, statementsFound: [{ statement: "income_statement", basis: "consolidated", pages: [2] }] });
    const other = await seedHeld(a, "pdf", { bseCode: "500123" });
    const foreign = await seedHeld(b, "xbrl", { bseCode: "500999", basis: "consolidated" });

    const res = await ctx.app.request(confirmUrl(a.workspaceId), send(a.cookie, { identity: { bseCode: "500999" }, company: { new: NEW } }));
    expect(res.status).toBe(200);
    const body = ConfirmCompanyResponse.parse(await res.json());
    expect(body.confirmed).toBe(3);

    const [company] = await ctx.db.select().from(schema.company).where(eq(schema.company.id, body.companyId));
    expect(company).toMatchObject({ workspaceId: a.workspaceId, displayName: NEW.displayName, bseCode: "500999", cin: null });

    for (const id of [cons, stand, pdf]) {
      const current = await getCurrentClassification(ctx.db, a.workspaceId, id);
      expect(current).toMatchObject({ companyId: body.companyId, setBy: "investor", readsUnderId: current!.id });
      expect((await docRow(id)).companyId).toBe(body.companyId);
    }
    // The instances are read; the PDF waits for them, as decideIntake decides.
    for (const id of [cons, stand]) {
      expect((await docRow(id)).intakeState).toBe("reading");
      expect(await jobsOf(a.workspaceId, id)).toEqual([JobTypes.DOCUMENT_XBRL]);
    }
    expect((await docRow(pdf)).intakeState).toBe("waiting_for_xbrl");
    expect(await jobsOf(a.workspaceId, pdf)).toEqual([]);

    // Another identity and another workspace are untouched.
    expect((await docRow(other)).intakeState).toBe("needs_company");
    expect((await getCurrentClassification(ctx.db, a.workspaceId, other))!.companyId).toBeNull();
    expect((await docRow(foreign)).intakeState).toBe("needs_company");
    expect((await getCurrentClassification(ctx.db, b.workspaceId, foreign))!.companyId).toBeNull();
    expect(await jobsOf(b.workspaceId, foreign)).toEqual([]);
  });

  it("a second confirm of the same identity to the company answers 0 and changes nothing", async () => {
    const a = await ctx.signUp("confirm-twice@example.com");
    const x = await seedHeld(a, "xbrl", { isin: "INE999Z01011", basis: "consolidated" });
    const first = ConfirmCompanyResponse.parse(await (await ctx.app.request(confirmUrl(a.workspaceId), send(a.cookie, { identity: { isin: "INE999Z01011" }, company: { new: NEW } }))).json());
    expect(first.confirmed).toBe(1);
    const jobs = await ctx.db.select().from(schema.job).where(eq(schema.job.workspaceId, a.workspaceId));

    const res = await ctx.app.request(confirmUrl(a.workspaceId), send(a.cookie, { identity: { isin: "INE999Z01011" }, company: { id: first.companyId } }));
    expect(res.status).toBe(200);
    expect(ConfirmCompanyResponse.parse(await res.json())).toEqual({ companyId: first.companyId, confirmed: 0 });
    expect(await ctx.db.select().from(schema.job).where(eq(schema.job.workspaceId, a.workspaceId))).toHaveLength(jobs.length);
    expect(await ctx.db.select().from(schema.documentClassification).where(eq(schema.documentClassification.documentId, x))).toHaveLength(2);
  });

  it("matches any given identifier, and only a held file that has no company", async () => {
    const a = await ctx.signUp("confirm-any@example.com");
    const byCin = await seedHeld(a, "pdf", { cin: CIN });
    const byNse = await seedHeld(a, "pdf", { nseSymbol: "SYNCEM" });
    const idle = await seedHeld(a, "pdf", { cin: CIN }, { intakeState: "read" });
    const companyId = crypto.randomUUID();
    await ctx.db.insert(schema.company).values({ id: companyId, workspaceId: a.workspaceId, displayName: "Existing Limited", country: "IN", createdByUserId: a.userId });
    const owned = await seedHeld(a, "pdf", { cin: CIN, companyId }, { intakeState: "needs_company" });
    const res = await ctx.app.request(confirmUrl(a.workspaceId), send(a.cookie, { identity: { cin: CIN, nseSymbol: "SYNCEM" }, company: { id: companyId } }));
    expect(ConfirmCompanyResponse.parse(await res.json())).toEqual({ companyId, confirmed: 2 });
    for (const id of [byCin, byNse]) expect((await getCurrentClassification(ctx.db, a.workspaceId, id))!.companyId).toBe(companyId);
    expect((await docRow(idle)).intakeState).toBe("read");
    expect((await getCurrentClassification(ctx.db, a.workspaceId, idle))!.companyId).toBeNull();
    expect((await getCurrentClassification(ctx.db, a.workspaceId, owned))!.setBy).toBe("maester");
  });

  it("two confirms at once release each held file once, and neither fails", async () => {
    const a = await ctx.signUp("confirm-race@example.com");
    const ids = [await seedHeld(a, "xbrl", { bseCode: "500994", basis: "consolidated" }), await seedHeld(a, "xbrl", { bseCode: "500994", basis: "standalone" }), await seedHeld(a, "pdf", { bseCode: "500994" })];
    const companyId = await ctx.createCompany(a.workspaceId, a.cookie, "Race Limited");
    const confirm = () => ctx.app.request(confirmUrl(a.workspaceId), send(a.cookie, { identity: { bseCode: "500994" }, company: { id: companyId } }));
    const results = await Promise.all([confirm(), confirm()]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const counts = await Promise.all(results.map(async (r) => ConfirmCompanyResponse.parse(await r.json()).confirmed));
    expect(counts.reduce((n, c) => n + c, 0)).toBe(3);
    for (const id of ids) expect(await ctx.db.select().from(schema.documentClassification).where(eq(schema.documentClassification.documentId, id))).toHaveLength(2);
    expect(await jobsOf(a.workspaceId, ids[0]!)).toEqual([JobTypes.DOCUMENT_XBRL]);
  });

  it("two confirms of one identity to two companies at once: the first wins every file, the second answers 0", async () => {
    const a = await ctx.signUp("confirm-race-two@example.com");
    const ids = [await seedHeld(a, "xbrl", { bseCode: "500993", basis: "consolidated" }), await seedHeld(a, "pdf", { bseCode: "500993" })];
    const first = await ctx.createCompany(a.workspaceId, a.cookie, "Race One Limited");
    const second = await ctx.createCompany(a.workspaceId, a.cookie, "Race Two Limited");
    const confirm = (companyId: string) => ctx.app.request(confirmUrl(a.workspaceId), send(a.cookie, { identity: { bseCode: "500993" }, company: { id: companyId } }));
    const results = await Promise.all([confirm(first), confirm(second)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const bodies = await Promise.all(results.map(async (r) => ConfirmCompanyResponse.parse(await r.json())));
    expect(bodies.map((b) => b.confirmed).sort()).toEqual([0, 2]);
    const winner = bodies.find((b) => b.confirmed === 2)!.companyId;
    for (const id of ids) {
      expect((await getCurrentClassification(ctx.db, a.workspaceId, id))!.companyId).toBe(winner);
      expect((await docRow(id)).companyId).toBe(winner);
      expect(await ctx.db.select().from(schema.documentClassification).where(eq(schema.documentClassification.documentId, id))).toHaveLength(2);
    }
  });

  it("skips a held file whose answers changed to codes the identity does not name while the confirm waited for it", async () => {
    const a = await ctx.signUp("confirm-moved@example.com");
    const held = await seedHeld(a, "pdf", { bseCode: "500992" });
    const companyId = await ctx.createCompany(a.workspaceId, a.cookie, "Moved Limited");
    // Another writer holds the document's lock and writes new answers that print another code, still with no company.
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    const writer = ctx.db.transaction(async (tx) => {
      await tx.select().from(schema.document).where(eq(schema.document.id, held)).for("update");
      await tx.insert(schema.documentClassification).values({
        id: crypto.randomUUID(), workspaceId: a.workspaceId, documentId: held, kind: "financial_results", periodEnd: "2025-09-30", setBy: "investor",
        bseCode: "500111", createdAt: sql`clock_timestamp()`,
      });
      locked();
      await released;
    });
    await isLocked;
    const pending = ctx.app.request(confirmUrl(a.workspaceId), send(a.cookie, { identity: { bseCode: "500992" }, company: { id: companyId } }));
    await new Promise((r) => setTimeout(r, 200));
    release();
    await writer;
    const res = await pending;
    expect(ConfirmCompanyResponse.parse(await res.json())).toEqual({ companyId, confirmed: 0 });
    expect((await getCurrentClassification(ctx.db, a.workspaceId, held))!).toMatchObject({ companyId: null, bseCode: "500111" });
  });

  it("does not take a duplicate of a held file", async () => {
    const a = await ctx.signUp("confirm-dup@example.com");
    const original = await seedHeld(a, "pdf", { bseCode: "500998" });
    const dup = await seedHeld(a, "pdf", { bseCode: "500998" }, { intakeState: "duplicate", duplicateOfDocumentId: original });
    const res = await ctx.app.request(confirmUrl(a.workspaceId), send(a.cookie, { identity: { bseCode: "500998" }, company: { new: NEW } }));
    expect(ConfirmCompanyResponse.parse(await res.json()).confirmed).toBe(1);
    expect((await docRow(dup)).intakeState).toBe("duplicate");
  });

  it("with no held document answers confirmed 0, still 200", async () => {
    const a = await ctx.signUp("confirm-none@example.com");
    const res = await ctx.app.request(confirmUrl(a.workspaceId), send(a.cookie, { identity: { bseCode: "500001" }, company: { new: { ...NEW, displayName: "Nobody Limited" } } }));
    expect(res.status).toBe(200);
    expect(ConfirmCompanyResponse.parse(await res.json()).confirmed).toBe(0);
  });

  it("refuses an empty identity, an unknown identifier shape, or no company with 400", async () => {
    const a = await ctx.signUp("confirm-400@example.com");
    for (const body of [
      { identity: {}, company: { new: NEW } },
      { identity: { bseCode: "12" }, company: { new: NEW } },
      { identity: { bseCode: "500999" }, company: {} },
      { identity: { bseCode: "500999" } },
    ]) {
      const res = await ctx.app.request(confirmUrl(a.workspaceId), send(a.cookie, body));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("answers 400 for a company that is not in this workspace, even when nothing is held", async () => {
    const a = await ctx.signUp("confirm-foreign-co@example.com");
    const b = await ctx.signUp("confirm-foreign-co-b@example.com");
    const theirs = await ctx.createCompany(b.workspaceId, b.cookie);
    const res = await ctx.app.request(confirmUrl(a.workspaceId), send(a.cookie, { identity: { bseCode: "500999" }, company: { id: theirs } }));
    expect(res.status).toBe(400);
  });

  it("answers 409 CONFLICT for a company name or code already used, and leaves the held files held", async () => {
    const a = await ctx.signUp("confirm-409@example.com");
    const held = await seedHeld(a, "pdf", { bseCode: "500997" });
    await ctx.createCompany(a.workspaceId, a.cookie, "Taken Limited");
    const name = await ctx.app.request(confirmUrl(a.workspaceId), send(a.cookie, { identity: { bseCode: "500997" }, company: { new: { ...NEW, displayName: "taken limited" } } }));
    expect(name.status).toBe(409);
    expect(((await name.json()) as { error: { code: string } }).error.code).toBe("CONFLICT");

    const ok = await ctx.app.request(confirmUrl(a.workspaceId), send(a.cookie, { identity: { bseCode: "500995" }, company: { new: { ...NEW, displayName: "Code Holder Limited" } } }));
    expect(ok.status).toBe(200);
    const code = await ctx.app.request(confirmUrl(a.workspaceId), send(a.cookie, { identity: { bseCode: "500995" }, company: { new: { ...NEW, displayName: "Another Name Limited" } } }));
    expect(code.status).toBe(409);
    expect((await docRow(held)).intakeState).toBe("needs_company");
  });

  it("gives a new company the identity's codes, filling the others from the company", async () => {
    const a = await ctx.signUp("confirm-codes@example.com");
    await seedHeld(a, "pdf", { bseCode: "500996" });
    const res = await ctx.app.request(confirmUrl(a.workspaceId), send(a.cookie, {
      identity: { bseCode: "500996" }, company: { new: { ...NEW, displayName: "Codes Limited", bseCode: "500111", nseSymbol: "CODES", cin: CIN } },
    }));
    const { companyId } = ConfirmCompanyResponse.parse(await res.json());
    const [company] = await ctx.db.select().from(schema.company).where(eq(schema.company.id, companyId));
    expect(company).toMatchObject({ bseCode: "500996", nseSymbol: "CODES", cin: CIN });
  });

  it("needs a session and a workspace of the caller", async () => {
    const a = await ctx.signUp("confirm-auth@example.com");
    const b = await ctx.signUp("confirm-auth-b@example.com");
    const body = { identity: { bseCode: "500999" }, company: { new: NEW } };
    const anon = await ctx.app.request(confirmUrl(a.workspaceId), { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });
    expect(anon.status).toBe(401);
    expect((await ctx.app.request(confirmUrl(a.workspaceId), send(b.cookie, body))).status).toBe(404);
  });
});
