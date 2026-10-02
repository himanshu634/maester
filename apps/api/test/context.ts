import { sql } from "drizzle-orm";
import { vi } from "vitest";
import { approveWaitlistEmail, closeDb, createDb, runMigrations } from "@maester/db";
import { MemoryObjectStore } from "@maester/storage";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import { RecordingDispatcher } from "../src/dispatch/index.js";
import { silentLogger } from "../src/logger.js";
import { testEnv } from "./env.js";

export async function createTestContext(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  const env = testEnv(overrides);
  const db = createDb(env.DATABASE_URL);
  await runMigrations(db);
  await db.execute(sql`TRUNCATE TABLE "job", "document", "membership", "workspace", "session", "account", "verification", "user", "waitlist_entry", "rate_limit" CASCADE`);
  const store = new MemoryObjectStore();
  const dispatcher = new RecordingDispatcher();
  const auth = createAuth({ db, env });
  const app = createApp({ env, logger: silentLogger, db, auth, store, dispatcher }, { sse: { pollMs: 50, heartbeatMs: 1000, maxLifetimeMs: 10000 } });

  async function signUp(email: string) {
    await approveWaitlistEmail(db, email);
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ name: "Test User", email, password: "correct-horse-battery" }),
    });
    if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const me = await app.request("/v1/me", { headers: { cookie } });
    const body = (await me.json()) as { user: { id: string }; workspaces: { id: string }[] };
    return { cookie, userId: body.user.id, workspaceId: body.workspaces[0]!.id };
  }

  async function createCompany(workspaceId: string, cookie: string, displayName = `Company ${crypto.randomUUID()}`) {
    const res = await app.request(`/v1/workspaces/${workspaceId}/companies`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ displayName, country: "IN" }),
    });
    if (res.status !== 201) throw new Error(`create company failed: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { id: string }).id;
  }

  /**
   * Drive Better Auth's Google redirect flow without Google: start sign-in, then
   * call the callback with a stubbed token endpoint returning an unsigned id token.
   */
  async function googleSignIn(profile: { email: string; name?: string; emailVerified?: boolean; sub?: string }) {
    const start = await app.request("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ provider: "google", callbackURL: "/terminal", errorCallbackURL: "/login" }),
    });
    if (start.status !== 200) throw new Error(`social sign-in failed: ${start.status} ${await start.text()}`);
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    const stateCookie = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

    const payload = {
      iss: "https://accounts.google.com",
      aud: env.GOOGLE_CLIENT_ID,
      sub: profile.sub ?? `google-${profile.email}`,
      email: profile.email,
      email_verified: profile.emailVerified ?? true,
      name: profile.name ?? "Google User",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const idToken = `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.`;
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (target.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "ya29.test", id_token: idToken, expires_in: 3600, token_type: "Bearer", scope: "openid email profile" }), { headers: { "content-type": "application/json" } });
      }
      if (target.startsWith("https://")) throw new Error(`unexpected outbound request in test: ${target}`);
      return realFetch(input, init);
    });
    try {
      const callback = await app.request(`/api/auth/callback/google?code=test-code&state=${encodeURIComponent(state)}`, { headers: { cookie: stateCookie } });
      const cookie = callback.headers.getSetCookie().map((c) => c.split(";")[0]!).filter((c) => !c.endsWith("=")).join("; ");
      return { status: callback.status, location: callback.headers.get("location") ?? "", cookie };
    } finally {
      spy.mockRestore();
    }
  }

  return { app, db, store, dispatcher, env, signUp, googleSignIn, createCompany, close: () => closeDb(db) };
}
export type TestContext = Awaited<ReturnType<typeof createTestContext>>;
