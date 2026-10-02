import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveWaitlistEmail, schema } from "@maester/db";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

const signUpRaw = (email: string) =>
  ctx.app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ name: "Someone", email, password: "correct-horse-battery" }),
  });

describe("waitlist gate", () => {
  it("refuses email sign-up for an email that is not approved and records it", async () => {
    const res = await signUpRaw("stranger@example.com");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("WAITLISTED");
    const users = await ctx.db.select().from(schema.user).where(eq(schema.user.email, "stranger@example.com"));
    expect(users).toHaveLength(0);
    const [entry] = await ctx.db.select().from(schema.waitlistEntry).where(eq(schema.waitlistEntry.email, "stranger@example.com"));
    expect(entry).toMatchObject({ status: "pending", source: "email" });
  });

  it("approves an email through the dev admit route", async () => {
    const admit = await ctx.app.request("/dev/auth/admit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "Dev.Admit@Example.com" }),
    });
    expect(admit.status).toBe(200);
    expect((await signUpRaw("dev.admit@example.com")).status).toBe(200);
    const bad = await ctx.app.request("/dev/auth/admit", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(bad.status).toBe(400);
  });

  it("lets an approved email sign up with a personal workspace", async () => {
    await approveWaitlistEmail(ctx.db, "Invited@Example.com");
    const res = await signUpRaw("invited@example.com");
    expect(res.status).toBe(200);
    const [user] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, "invited@example.com"));
    const workspaces = await ctx.db.select().from(schema.workspace).where(eq(schema.workspace.ownerUserId, user!.id));
    expect(workspaces).toHaveLength(1);
  });
});
