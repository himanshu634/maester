import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveWaitlistEmail, schema } from "@maester/db";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

describe("Google sign-in", () => {
  it("signs in a new approved user, with a workspace and a session", async () => {
    await approveWaitlistEmail(ctx.db, "asha@example.com");
    const result = await ctx.googleSignIn({ email: "asha@example.com", name: "Asha Rao" });
    expect(result.status).toBe(302);
    expect(result.location).toMatch(/\/terminal$/);
    const me = await ctx.app.request("/v1/me", { headers: { cookie: result.cookie } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { workspaces: unknown[] }).workspaces).toHaveLength(1);
  });

  it("waitlists an unapproved Google user and creates nothing", async () => {
    const result = await ctx.googleSignIn({ email: "unknown@example.com" });
    expect(result.status).toBe(302);
    expect(result.location).toContain("/login");
    expect(new URL(result.location, "http://localhost").searchParams.get("error")).toBe("WAITLISTED");
    expect(await ctx.db.select().from(schema.user).where(eq(schema.user.email, "unknown@example.com"))).toHaveLength(0);
    const [entry] = await ctx.db.select().from(schema.waitlistEntry).where(eq(schema.waitlistEntry.email, "unknown@example.com"));
    expect(entry).toMatchObject({ status: "pending", source: "google" });
  });

  it("signs in a returning Google user without a second workspace", async () => {
    await approveWaitlistEmail(ctx.db, "returning@example.com");
    await ctx.googleSignIn({ email: "returning@example.com" });
    const again = await ctx.googleSignIn({ email: "returning@example.com" });
    expect(again.location).toMatch(/\/terminal$/);
    const [user] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, "returning@example.com"));
    expect(await ctx.db.select().from(schema.workspace).where(eq(schema.workspace.ownerUserId, user!.id))).toHaveLength(1);
  });

  it("does not accept a client-submitted Google id token (redirect flow only)", async () => {
    const sessionsBefore = (await ctx.db.select().from(schema.session)).length;
    const res = await ctx.app.request("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ provider: "google", idToken: { token: "x" } }),
    });
    expect(res.status).not.toBe(200);
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(((await res.json()) as { code?: string }).code).toBe("ID_TOKEN_NOT_SUPPORTED");
    expect(await ctx.db.select().from(schema.session)).toHaveLength(sessionsBefore);
  });

  it("returns to the error URL when the person cancels at Google", async () => {
    const start = await ctx.app.request("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ provider: "google", callbackURL: "/terminal", errorCallbackURL: "/login" }),
    });
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    const cookie = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const res = await ctx.app.request(`/api/auth/callback/google?error=access_denied&state=${encodeURIComponent(state)}`, { headers: { cookie } });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!, "http://localhost").searchParams.get("error")).toBe("access_denied");
  });
});
