import { sql } from "drizzle-orm";
import { closeDb, createDb, runMigrations } from "@maester/db";
import { MemoryObjectStore } from "@maester/storage";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import { RecordingDispatcher } from "../src/dispatch/index.js";
import { silentLogger } from "../src/logger.js";
import { testEnv } from "./env.js";

export async function createTestContext() {
  const env = testEnv();
  const db = createDb(env.DATABASE_URL);
  await runMigrations(db);
  await db.execute(sql`TRUNCATE TABLE "job", "document", "membership", "workspace", "session", "account", "verification", "user" CASCADE`);
  const store = new MemoryObjectStore();
  const dispatcher = new RecordingDispatcher();
  const auth = createAuth({ db, env });
  const app = createApp({ env, logger: silentLogger, db, auth, store, dispatcher }, { sse: { pollMs: 50, heartbeatMs: 1000, maxLifetimeMs: 10000 } });

  async function signUp(email: string) {
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

  return { app, db, store, dispatcher, env, signUp, close: () => closeDb(db) };
}
export type TestContext = Awaited<ReturnType<typeof createTestContext>>;
