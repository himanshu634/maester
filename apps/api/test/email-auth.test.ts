import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveWaitlistEmail, schema } from "@maester/db";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

const post = (path: string, body: object, headers: Record<string, string> = {}) =>
  ctx.app.request(path, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...headers }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]!).filter((c) => !c.endsWith("=")).join("; ");
const linkIn = (text: string) => text.match(/https?:\/\/\S+/)![0];
const pathOf = (link: string) => { const u = new URL(link); return u.pathname + u.search; };

describe("email confirmation", () => {
  it("refuses sign-in until the email is confirmed, then the link signs you in", async () => {
    await approveWaitlistEmail(ctx.db, "confirm@example.com");
    expect((await post("/api/auth/sign-up/email", { name: "C", email: "confirm@example.com", password: "correct-horse-battery", callbackURL: "/verify-email?next=%2Fterminal" })).status).toBe(200);

    // sendOnSignIn mails a second link from this attempt: give it the same callback.
    const early = await post("/api/auth/sign-in/email", { email: "confirm@example.com", password: "correct-horse-battery", callbackURL: "/verify-email?next=%2Fterminal" });
    expect(early.status).toBe(403);
    expect(((await early.json()) as { code: string }).code).toBe("EMAIL_NOT_VERIFIED");

    const mail = await ctx.mailer.waitFor("confirm@example.com");
    expect(mail.subject).toBe("Confirm your email for Maester");
    const visit = await ctx.app.request(pathOf(linkIn(mail.text)));
    expect(visit.status).toBe(302);
    expect(visit.headers.get("location")).toContain("/verify-email?next=%2Fterminal");
    const me = await ctx.app.request("/v1/me", { headers: { cookie: cookieOf(visit) } });
    expect(me.status).toBe(200);
  });

  it("signs nobody in when a used confirmation link is opened again", async () => {
    // Confirmation links are signed tokens, valid for the hour; a second visit only redirects.
    await approveWaitlistEmail(ctx.db, "again@example.com");
    await post("/api/auth/sign-up/email", { name: "A", email: "again@example.com", password: "correct-horse-battery", callbackURL: "/verify-email" });
    const link = pathOf(linkIn((await ctx.mailer.waitFor("again@example.com")).text));
    await ctx.app.request(link);
    const again = await ctx.app.request(link);
    expect(again.status).toBe(302);
    expect(cookieOf(again)).not.toContain("maester.session_token");
  });

  it("sends a spoiled link back with an error", async () => {
    const res = await ctx.app.request("/api/auth/verify-email?token=not-a-token&callbackURL=%2Fverify-email");
    expect(new URL(res.headers.get("location")!, "http://localhost").searchParams.get("error")).toBe("INVALID_TOKEN");
  });
});

describe("password reset", () => {
  it("emails a link, sets the new password and revokes old sessions", async () => {
    const { cookie } = await ctx.signUp("reset@example.com");
    expect((await post("/api/auth/request-password-reset", { email: "reset@example.com", redirectTo: "/reset-password" })).status).toBe(200);
    const mail = await ctx.mailer.waitFor("reset@example.com");
    expect(mail.subject).toBe("Reset your Maester password");

    const landing = await ctx.app.request(pathOf(linkIn(mail.text)));
    const token = new URL(landing.headers.get("location")!, "http://localhost").searchParams.get("token")!;
    expect(token).toBeTruthy();
    expect((await post("/api/auth/reset-password", { newPassword: "a-new-long-password", token })).status).toBe(200);

    expect((await ctx.app.request("/v1/me", { headers: { cookie } })).status).toBe(401);
    expect((await post("/api/auth/sign-in/email", { email: "reset@example.com", password: "a-new-long-password" })).status).toBe(200);
  });

  it("refuses a reset link used a second time and keeps the first new password", async () => {
    await ctx.signUp("reuse@example.com");
    await post("/api/auth/request-password-reset", { email: "reuse@example.com", redirectTo: "/reset-password" });
    const landing = await ctx.app.request(pathOf(linkIn((await ctx.mailer.waitFor("reuse@example.com")).text)));
    const token = new URL(landing.headers.get("location")!, "http://localhost").searchParams.get("token")!;
    expect((await post("/api/auth/reset-password", { newPassword: "first-new-password", token })).status).toBe(200);
    expect((await post("/api/auth/reset-password", { newPassword: "second-new-password", token })).status).not.toBe(200);

    expect((await post("/api/auth/sign-in/email", { email: "reuse@example.com", password: "second-new-password" })).status).not.toBe(200);
    expect((await post("/api/auth/sign-in/email", { email: "reuse@example.com", password: "first-new-password" })).status).toBe(200);
  });

  it("answers the same for an email with no account", async () => {
    const res = await post("/api/auth/request-password-reset", { email: "nobody@example.com", redirectTo: "/reset-password" });
    expect(res.status).toBe(200);
  });
});

describe("sign-up for an address that already has an account", () => {
  const EXISTING = "You already have a Maester account";
  const mailsTo = (to: string, subject: string) => ctx.mailer.sent.filter((m) => m.to === to && m.subject === subject);
  async function waitForMail(to: string, subject: string) {
    for (let i = 0; i < 100 && mailsTo(to, subject).length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    return mailsTo(to, subject);
  }
  // The duplicate answer is synthetic: compare its shape, not its id or timestamps.
  const shapeOf = async (res: Response) => {
    const body = (await res.json()) as { token: unknown; user: Record<string, unknown> };
    return { status: res.status, keys: Object.keys(body).sort(), token: body.token, userKeys: Object.keys(body.user).sort(), emailVerified: body.user.emailVerified };
  };
  const signUpAs = (email: string, password: string) => post("/api/auth/sign-up/email", { name: "Someone", email, password, callbackURL: "/verify-email" });

  it("answers like a fresh sign-up and mails the confirmed owner once", async () => {
    await approveWaitlistEmail(ctx.db, "fresh-shape@example.com");
    const fresh = await shapeOf(await signUpAs("fresh-shape@example.com", "correct-horse-battery"));

    await ctx.signUp("owner@example.com");
    const duplicate = await signUpAs("owner@example.com", "another-password");
    const dupShape = await shapeOf(duplicate);
    expect(dupShape).toEqual(fresh);
    expect(dupShape.status).toBe(200);
    expect(dupShape.token).toBeNull();

    const mails = await waitForMail("owner@example.com", EXISTING);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain("You already have one.");
    expect(mails[0]!.text).toContain("http://localhost/login");
    expect(mails[0]!.text).toContain("http://localhost/forgot-password");
    // The owner's password is unchanged.
    expect((await post("/api/auth/sign-in/email", { email: "owner@example.com", password: "another-password" })).status).not.toBe(200);
  });

  it("answers like a fresh sign-up and tells an unconfirmed owner to reset", async () => {
    await approveWaitlistEmail(ctx.db, "fresh-shape-2@example.com");
    const fresh = await shapeOf(await signUpAs("fresh-shape-2@example.com", "correct-horse-battery"));

    await approveWaitlistEmail(ctx.db, "waiting@example.com");
    await signUpAs("waiting@example.com", "first-password");
    const duplicate = await shapeOf(await signUpAs("waiting@example.com", "second-password"));
    expect(duplicate).toEqual(fresh);

    const mails = await waitForMail("waiting@example.com", EXISTING);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain("waiting to be confirmed");
    expect(mails[0]!.text).toContain("The password just chosen was not saved.");
    expect(mails[0]!.text).toContain("http://localhost/forgot-password");

    // What the email promises: a reset replaces the earlier password, and only confirming
    // the address remains.
    expect((await post("/api/auth/request-password-reset", { email: "waiting@example.com", redirectTo: "/reset-password" })).status).toBe(200);
    const reset = await waitForMail("waiting@example.com", "Reset your Maester password");
    expect(reset).toHaveLength(1);
    const landing = await ctx.app.request(pathOf(linkIn(reset[0]!.text)));
    const token = new URL(landing.headers.get("location")!, "http://localhost").searchParams.get("token")!;
    expect((await post("/api/auth/reset-password", { newPassword: "owner-chosen-password", token })).status).toBe(200);
    expect((await post("/api/auth/sign-in/email", { email: "waiting@example.com", password: "first-password" })).status).toBe(401);
    const owner = await post("/api/auth/sign-in/email", { email: "waiting@example.com", password: "owner-chosen-password" });
    expect(owner.status).toBe(403);
    expect(((await owner.json()) as { code: string }).code).toBe("EMAIL_NOT_VERIFIED");
  });
});

describe("takeover guard", () => {
  it("removes an unconfirmed password when the real owner signs in with Google", async () => {
    await approveWaitlistEmail(ctx.db, "victim@example.com");
    // The attacker registers the victim's approved email and never confirms it.
    await post("/api/auth/sign-up/email", { name: "Attacker", email: "victim@example.com", password: "attacker-password" });

    const google = await ctx.googleSignIn({ email: "victim@example.com", name: "Victim" });
    expect(google.location).toMatch(/\/terminal$/);
    expect((await ctx.app.request("/v1/me", { headers: { cookie: google.cookie } })).status).toBe(200);

    const attacker = await post("/api/auth/sign-in/email", { email: "victim@example.com", password: "attacker-password" });
    expect(attacker.status).not.toBe(200);
    const [user] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, "victim@example.com"));
    const accounts = await ctx.db.select().from(schema.account).where(eq(schema.account.userId, user!.id));
    expect(accounts.map((a) => a.providerId)).toEqual(["google"]);
    expect(user!.emailVerified).toBe(true);
  });
});

describe("Google email confirmation", () => {
  // Trusted-provider linking ignores Google's email_verified claim, and the takeover guard
  // assumes Google confirmed the address, so a profile without it is refused outright.
  it("refuses a Google profile whose email is not confirmed and creates nothing", async () => {
    await approveWaitlistEmail(ctx.db, "unconfirmed-google@example.com");
    const google = await ctx.googleSignIn({ email: "unconfirmed-google@example.com", emailVerified: false });
    expect(google.status).toBe(302);
    const location = new URL(google.location, "http://localhost");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("GOOGLE_EMAIL_NOT_VERIFIED");
    expect(google.cookie).not.toContain("maester.session_token");
    expect(await ctx.db.select().from(schema.user).where(eq(schema.user.email, "unconfirmed-google@example.com"))).toHaveLength(0);
  });

  it("leaves an unconfirmed password account alone when the Google email is not confirmed", async () => {
    await approveWaitlistEmail(ctx.db, "half@example.com");
    await post("/api/auth/sign-up/email", { name: "Someone", email: "half@example.com", password: "someone-password" });

    const google = await ctx.googleSignIn({ email: "half@example.com", emailVerified: false });
    expect(new URL(google.location, "http://localhost").searchParams.get("error")).toBe("GOOGLE_EMAIL_NOT_VERIFIED");
    expect(google.cookie).not.toContain("maester.session_token");
    const [user] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, "half@example.com"));
    const accounts = await ctx.db.select().from(schema.account).where(eq(schema.account.userId, user!.id));
    expect(accounts.map((a) => a.providerId)).toEqual(["credential"]);
    expect(user!.emailVerified).toBe(false);
  });
});

describe("rate limit", () => {
  it("answers 429 after five sign-in attempts a minute from one address", async () => {
    const limited = await createTestContext({ AUTH_RATE_LIMIT: "on" });
    try {
      const attempt = (address = "203.0.113.9") =>
        limited.app.request("/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": address },
          body: JSON.stringify({ email: "x@example.com", password: "wrong-password" }),
        });
      for (let i = 0; i < 5; i++) expect((await attempt()).status).not.toBe(429);
      expect((await attempt()).status).toBe(429);
      // The bucket is per address: another forwarded address is not limited yet.
      const other = await attempt("198.51.100.7");
      expect(other.status).not.toBe(429);
    } finally {
      await limited.close();
    }
  });
});
