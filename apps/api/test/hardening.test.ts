import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { approveWaitlistEmail, schema } from "@maester/db";
import { createTestContext, type TestContext } from "./context.js";

// Each test builds its own context: createTestContext truncates every table, rate_limit included.
async function withContext(overrides: Partial<NodeJS.ProcessEnv>, run: (ctx: TestContext) => Promise<void>) {
  const ctx = await createTestContext(overrides);
  try {
    await run(ctx);
  } finally {
    await ctx.close();
  }
}

const json = (body: object, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", origin: "http://localhost", ...headers },
  body: JSON.stringify(body),
});

describe("redirect targets", () => {
  it("refuses a Google sign-in whose callback or error callback leaves the site", async () => {
    await withContext({}, async (ctx) => {
      const social = (body: object) => ctx.app.request("/api/auth/sign-in/social", json({ provider: "google", ...body }));

      const callback = await social({ callbackURL: "https://evil.example", errorCallbackURL: "/login" });
      expect(callback.status).toBe(403);
      expect(((await callback.json()) as { code: string }).code).toBe("INVALID_CALLBACK_URL");

      const errorCallback = await social({ callbackURL: "/terminal", errorCallbackURL: "//evil.example" });
      expect(errorCallback.status).toBe(403);
      expect(((await errorCallback.json()) as { code: string }).code).toBe("INVALID_ERROR_CALLBACK_URL");

      // The same request with same-site paths goes on to Google.
      expect((await social({ callbackURL: "/terminal", errorCallbackURL: "/login" })).status).toBe(200);
    });
  });
});

describe("cross-origin sign-out", () => {
  it("refuses a sign-out from another origin and leaves the session working", async () => {
    await withContext({}, async (ctx) => {
      const { cookie } = await ctx.signUp("cross-origin@example.com");
      const out = await ctx.app.request("/api/auth/sign-out", { method: "POST", headers: { cookie, origin: "https://evil.example" } });
      expect(out.status).toBe(403);
      expect(((await out.json()) as { code: string }).code).toBe("INVALID_ORIGIN");
      expect((await ctx.app.request("/v1/me", { headers: { cookie } })).status).toBe(200);
    });
  });
});

describe("rate limit and X-Forwarded-For", () => {
  it("keys on the address nearest the trusted proxies, so a client prefix opens no new bucket", async () => {
    await withContext({ AUTH_RATE_LIMIT: "on" }, async (ctx) => {
      // TRUSTED_PROXIES is 10.0.0.0/8 in tests: reading from the right, 10.0.0.5 is skipped
      // and 203.0.113.9 is the client. Whatever the client put in front never counts.
      const attempt = (forwardedFor: string) =>
        ctx.app.request("/api/auth/sign-in/email", json({ email: "x@example.com", password: "wrong-password" }, { "x-forwarded-for": forwardedFor }));
      for (let i = 0; i < 5; i++) expect((await attempt("1.1.1.1, 203.0.113.9, 10.0.0.5")).status).not.toBe(429);
      expect((await attempt("2.2.2.2, 203.0.113.9, 10.0.0.5")).status).toBe(429);
      // A different client behind the same proxy still has its own bucket.
      expect((await attempt("198.51.100.7, 10.0.0.5")).status).not.toBe(429);
    });
  });
});

describe("production session cookie", () => {
  it("is __Secure-maester.session_token, HttpOnly, Secure, SameSite=Lax, Path=/", async () => {
    // testEnv already supplies what production requires: Google credentials, TRUSTED_PROXIES
    // and MAIL_DRIVER=resend with a key and sender. The context records mail instead of sending it.
    await withContext({ NODE_ENV: "production" }, async (ctx) => {
      const forwarded = { "x-forwarded-for": "198.51.100.20" };
      const email = "production@example.com";
      await approveWaitlistEmail(ctx.db, email);
      const signUp = await ctx.app.request("/api/auth/sign-up/email", json({ name: "P", email, password: "correct-horse-battery" }, forwarded));
      expect(signUp.status).toBe(200);
      await ctx.db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email));

      const signIn = await ctx.app.request("/api/auth/sign-in/email", json({ email, password: "correct-horse-battery" }, forwarded));
      expect(signIn.status).toBe(200);
      const session = signIn.headers.getSetCookie().find((c) => c.startsWith("__Secure-maester.session_token="));
      expect(session).toBeDefined();
      const attributes = session!.split(";").slice(1).map((a) => a.trim().toLowerCase());
      expect(attributes).toContain("httponly");
      expect(attributes).toContain("secure");
      expect(attributes).toContain("samesite=lax");
      expect(attributes).toContain("path=/");
    });
  });
});
