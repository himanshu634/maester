import { describe, expect, it } from "vitest";
import { ConsoleMailer, RecordingMailer, ResendMailer } from "../src/mail/index.js";
import { confirmEmail, resetPassword } from "../src/mail/templates.js";
import { silentLogger } from "../src/logger.js";

describe("mail templates", () => {
  it("say what the confirmation link does and how long it works", () => {
    const m = confirmEmail({ name: "Meera", url: "http://localhost:5173/api/auth/verify-email?token=t" });
    expect(m.subject).toBe("Confirm your email for Maester");
    expect(m.text).toContain("http://localhost:5173/api/auth/verify-email?token=t");
    expect(m.text).toContain("one hour");
    expect(m.html).toContain('href="http://localhost:5173/api/auth/verify-email?token=t"');
    expect(m.text).toContain("Someone asked to open a Maester account with this email address.");
    expect(m.text).toContain("If it wasn't you");
  });

  it("never include the name the person signed up with", () => {
    for (const template of [confirmEmail, resetPassword]) {
      const m = template({ name: "Meera", url: "http://x/r" });
      expect(m.text).not.toContain("Meera");
      expect(m.html).not.toContain("Meera");
      expect(m.text).toContain("Hello,");
    }
  });

  it("escape the URL inside the href", () => {
    const html = resetPassword({ name: "x", url: 'http://x/r?a="b"&c=d' }).html;
    expect(html).toContain('href="http://x/r?a=&quot;b&quot;&amp;c=d"');
    expect(html).not.toContain('a="b"');
  });
});

describe("mailers", () => {
  it("record messages for tests", async () => {
    const mailer = new RecordingMailer();
    void mailer.send({ to: "a@example.com", subject: "s", text: "t", html: "h" });
    expect((await mailer.waitFor("a@example.com")).subject).toBe("s");
  });

  it("post to Resend with the key and sender", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    }) as typeof fetch;
    const mailer = new ResendMailer({ apiKey: "re_test", from: "Maester <hello@example.com>", fetch: fakeFetch });
    await mailer.send({ to: "a@example.com", subject: "s", text: "t", html: "h" });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ from: "Maester <hello@example.com>", to: ["a@example.com"], subject: "s", text: "t", html: "h" });
  });

  it("fail loudly when Resend refuses", async () => {
    const fakeFetch = (async () => new Response("bad", { status: 422 })) as unknown as typeof fetch;
    const mailer = new ResendMailer({ apiKey: "re_test", from: "x@example.com", fetch: fakeFetch });
    await expect(mailer.send({ to: "a@example.com", subject: "s", text: "t", html: "h" })).rejects.toThrow(/422/);
  });

  it("log to the console driver without throwing", async () => {
    await expect(new ConsoleMailer(silentLogger).send({ to: "a@example.com", subject: "s", text: "t", html: "h" })).resolves.toBeUndefined();
  });
});
