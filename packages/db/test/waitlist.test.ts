import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, type Db } from "../src/client.js";
import { admitOrWaitlist, approveWaitlistEmail, normalizeEmail } from "../src/queries/waitlist.js";
import * as schema from "../src/schema/index.js";
import { testDb, truncateAll } from "./helpers.js";

let db: Db;
beforeEach(async () => {
  db ??= await testDb();
  await truncateAll(db);
});
afterAll(() => closeDb(db));

const rows = (email: string) => db.select().from(schema.waitlistEntry).where(eq(schema.waitlistEntry.email, email));

describe("waitlist", () => {
  it("normalises email addresses", () => {
    expect(normalizeEmail("  Meera.Iyer@Example.COM ")).toBe("meera.iyer@example.com");
  });

  it("waitlists an unknown email and records it once", async () => {
    expect(await admitOrWaitlist(db, { email: "new@example.com", source: "google" })).toBe("waitlisted");
    const [row] = await rows("new@example.com");
    expect(row).toMatchObject({ status: "pending", source: "google", approvedAt: null });
  });

  it("keeps one row and the first request time across retries", async () => {
    await admitOrWaitlist(db, { email: "again@example.com", source: "google" });
    const [first] = await rows("again@example.com");
    for (let i = 0; i < 5; i++) await admitOrWaitlist(db, { email: "Again@Example.com", source: "email" });
    const all = await rows("again@example.com");
    expect(all).toHaveLength(1);
    expect(all[0]!.requestedAt.getTime()).toBe(first!.requestedAt.getTime());
    expect(all[0]!.source).toBe("google");
  });

  it("admits an approved email whatever its case", async () => {
    await approveWaitlistEmail(db, "meera.iyer@example.com");
    expect(await admitOrWaitlist(db, { email: "Meera.Iyer@Example.com", source: "email" })).toBe("approved");
  });

  it("approves a pending email and never downgrades it", async () => {
    await admitOrWaitlist(db, { email: "late@example.com", source: "email" });
    await approveWaitlistEmail(db, "LATE@example.com");
    expect(await admitOrWaitlist(db, { email: "late@example.com", source: "google" })).toBe("approved");
    const [row] = await rows("late@example.com");
    expect(row!.status).toBe("approved");
    expect(row!.approvedAt).toBeInstanceOf(Date);
  });

  it("keeps the first approval time when an email is approved again", async () => {
    await approveWaitlistEmail(db, "twice@example.com");
    const first = new Date("2026-01-15T09:30:00Z");
    await db.update(schema.waitlistEntry).set({ approvedAt: first }).where(eq(schema.waitlistEntry.email, "twice@example.com"));
    await approveWaitlistEmail(db, "Twice@Example.com");
    const [row] = await rows("twice@example.com");
    expect(row!.status).toBe("approved");
    expect(row!.approvedAt!.getTime()).toBe(first.getTime());
  });
});
