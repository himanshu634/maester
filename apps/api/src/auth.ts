import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { admitOrWaitlist, ensurePersonalWorkspace, schema, type Db } from "@maester/db";
import type { Env } from "./env.js";
import type { Logger } from "./logger.js";
import type { Mailer, MailMessage } from "./mail/index.js";
import { confirmEmail, resetPassword } from "./mail/templates.js";

export function createAuth({ db, env, mailer, logger }: { db: Db; env: Env; mailer: Mailer; logger: Logger }) {
  // Never awaited inside the request: response time must not reveal whether an account exists.
  const send = (to: string, message: Omit<MailMessage, "to">) => {
    void mailer.send({ to, ...message }).catch((err: unknown) => logger.error({ err, to }, "mail failed"));
  };

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
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => send(user.email, resetPassword({ name: user.name, url })),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) => send(user.email, confirmEmail({ name: user.name, url })),
    },
    user: {
      // Runs before a Google identity creates a user, links to one or signs in. Google
      // is a trusted provider, so linking ignores its email_verified claim, and the
      // takeover guard below assumes Google confirmed the address: refuse it unconfirmed.
      // The refusal reaches errorCallbackURL as ?error=GOOGLE_EMAIL_NOT_VERIFIED.
      validateUserInfo: ({ source }) => {
        if (source.method !== "oauth" || source.oauth?.providerId !== "google") return;
        if (source.oauth.profile?.email_verified !== true) {
          return { error: "GOOGLE_EMAIL_NOT_VERIFIED", errorDescription: "Google has not confirmed this email address." };
        }
      },
    },
    socialProviders: env.GOOGLE_CLIENT_ID
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
            // Redirect flow only: refuse a client-submitted id token at /sign-in/social.
            disableIdTokenSignIn: true,
            // Always show Google's account chooser, so "Use another account" can switch.
            prompt: "select_account",
          },
        }
      : {},
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        // Better Auth would refuse to link Google to a user whose email is unconfirmed.
        // Linking is safe here because the takeover guard (databaseHooks.account) first
        // removes that user's unproven password and sessions, and validateUserInfo
        // refuses a Google profile whose email Google has not confirmed.
        requireLocalEmailVerified: false,
      },
    },
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
      // Better Auth walks from the right past trustedProxies. An address it cannot
      // resolve falls into one shared rate-limit bucket for everyone, which is why
      // production requires TRUSTED_PROXIES.
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
      account: {
        create: {
          // The takeover guard. A Google account linking to a user whose email was never
          // confirmed means whoever set that password did not prove they own the address:
          // remove the password and every session, and trust Google's confirmation.
          before: async (account) => {
            if (account.providerId !== "google") return { data: account };
            const [owner] = await db.select({ emailVerified: schema.user.emailVerified }).from(schema.user).where(eq(schema.user.id, account.userId));
            if (owner && !owner.emailVerified) {
              await db.delete(schema.account).where(and(eq(schema.account.userId, account.userId), eq(schema.account.providerId, "credential")));
              await db.delete(schema.session).where(eq(schema.session.userId, account.userId));
              await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, account.userId));
            }
            return { data: account };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
