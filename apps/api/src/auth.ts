import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { ensurePersonalWorkspace, schema, type Db } from "@maester/db";
import type { Env } from "./env.js";

export function createAuth({ db, env }: { db: Db; env: Env }) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    basePath: "/api/auth",
    trustedOrigins: env.ALLOWED_ORIGINS,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: { enabled: true },
    advanced: {
      cookiePrefix: "maester",
      useSecureCookies: env.NODE_ENV === "production",
      defaultCookieAttributes: { sameSite: "lax" },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await ensurePersonalWorkspace(db, { userId: user.id, userName: user.name });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
