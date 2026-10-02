import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { admitOrWaitlist, ensurePersonalWorkspace, schema, type Db } from "@maester/db";
import type { Env } from "./env.js";

export function createAuth({ db, env }: { db: Db; env: Env }) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    basePath: "/api/auth",
    trustedOrigins: env.ALLOWED_ORIGINS,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        rateLimit: schema.rateLimit,
      },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    socialProviders: env.GOOGLE_CLIENT_ID
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET! } }
      : {},
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    // On in production; elsewhere only with AUTH_RATE_LIMIT=on. Without a forwarded address
    // Better Auth keys every development and test request to 127.0.0.1, so a shared bucket
    // would trip the ordinary test suites.
    rateLimit: {
      enabled: env.NODE_ENV === "production" || env.AUTH_RATE_LIMIT === "on",
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
      },
    },
    advanced: {
      cookiePrefix: "maester",
      useSecureCookies: env.NODE_ENV === "production",
      defaultCookieAttributes: { sameSite: "lax" },
      // nginx forwards the browser's address. With more than one address in the header,
      // Better Auth walks from the right past trustedProxies; with none configured it
      // gives up and the limiter skips the request (TRUSTED_PROXIES is set in deploy).
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"], trustedProxies: env.TRUSTED_PROXIES },
    },
    databaseHooks: {
      user: {
        create: {
          // The waitlist gate: covers email sign-up and the Google callback alike.
          before: async (user, context) => {
            const source = context?.path === "/sign-up/email" ? "email" : "google";
            const verdict = await admitOrWaitlist(db, { email: user.email, source });
            if (verdict !== "approved") {
              throw new APIError("FORBIDDEN", {
                code: "WAITLISTED",
                message: "Maester is open to invited investors for now. This email is on the list.",
              });
            }
            return { data: user };
          },
          after: async (user) => {
            await ensurePersonalWorkspace(db, { userId: user.id, userName: user.name });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
