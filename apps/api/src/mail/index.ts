import type { Env } from "../env.js";
import type { Logger } from "../logger.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Development: the message, link included, goes to the log. */
export class ConsoleMailer implements Mailer {
  constructor(private readonly logger: Logger) {}
  async send(message: MailMessage): Promise<void> {
    this.logger.info({ to: message.to, subject: message.subject, text: message.text }, "mail (console driver, not sent)");
  }
}

/** Production: Resend's HTTP API. */
export class ResendMailer implements Mailer {
  private readonly fetch: typeof fetch;
  constructor(private readonly options: { apiKey: string; from: string; fetch?: typeof fetch }) {
    this.fetch = options.fetch ?? fetch;
  }
  async send(message: MailMessage): Promise<void> {
    const res = await this.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.options.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
    });
    if (!res.ok) throw new Error(`resend refused the message: ${res.status} ${await res.text()}`);
  }
}

/** Tests: keeps every message and lets a test wait for one. */
export class RecordingMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
  async waitFor(to: string, timeoutMs = 2000): Promise<MailMessage> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = [...this.sent].reverse().find((m) => m.to === to);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`no mail to ${to} within ${timeoutMs}ms`);
  }
}

export function createMailer(env: Env, logger: Logger): Mailer {
  if (env.MAIL_DRIVER === "resend") return new ResendMailer({ apiKey: env.RESEND_API_KEY!, from: env.MAIL_FROM! });
  return new ConsoleMailer(logger);
}
