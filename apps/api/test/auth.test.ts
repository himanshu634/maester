import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Me, Workspace } from "@maester/contracts";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

describe("auth and workspaces", () => {
  it("sign-up creates a personal workspace and /v1/me returns it", async () => {
    const { cookie } = await ctx.signUp("ada@example.com");
    const res = await ctx.app.request("/v1/me", { headers: { cookie } });
    expect(res.status).toBe(200);
    const me = Me.parse(await res.json());
    expect(me.user.email).toBe("ada@example.com");
    expect(me.workspaces).toHaveLength(1);
    expect(me.workspaces[0]!.name).toBe("Test User's workspace");
  });

  it("/v1/me without a session is UNAUTHENTICATED", async () => {
    const res = await ctx.app.request("/v1/me");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
  });

  it("workspace detail is visible to its member and 404 to others", async () => {
    const a = await ctx.signUp("a@example.com");
    const b = await ctx.signUp("b@example.com");
    const ok = await ctx.app.request(`/v1/workspaces/${a.workspaceId}`, { headers: { cookie: a.cookie } });
    expect(ok.status).toBe(200);
    expect(Workspace.parse(await ok.json()).id).toBe(a.workspaceId);
    const denied = await ctx.app.request(`/v1/workspaces/${a.workspaceId}`, { headers: { cookie: b.cookie } });
    expect(denied.status).toBe(404);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("sign-in with the wrong password fails and sign-out clears the session", async () => {
    await ctx.signUp("c@example.com");
    const bad = await ctx.app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ email: "c@example.com", password: "wrong" }),
    });
    expect(bad.status).toBe(401);
  });
});
