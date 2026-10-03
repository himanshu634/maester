import type { MailMessage } from "./index.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const IGNORE = "If you did not ask for this, you can ignore this email.";

function message(subject: string, lines: string[], url: string, button: string, footer = IGNORE): Omit<MailMessage, "to"> {
  const text = [...lines, "", url, "", footer].join("\n");
  const html = [
    `<p>${lines.map(esc).join("</p><p>")}</p>`,
    `<p><a href="${esc(url)}">${esc(button)}</a></p>`,
    `<p>${esc(footer)}</p>`,
  ].join("");
  return { subject, text, html };
}

// Neither template uses the name: whoever signs up chooses it, so it must never reach
// someone else's inbox. The signature keeps it so callers stay unchanged.

export const confirmEmail = ({ url }: { name: string; url: string }) =>
  message(
    "Confirm your email for Maester",
    ["Hello,", "Someone asked to open a Maester account with this email address.", "If it was you, open this link to confirm it. It works for one hour."],
    url,
    "Confirm your email",
    "If it wasn't you, don't open the link. Ignore this email and the account will not open.",
  );

export const resetPassword = ({ url }: { name: string; url: string }) =>
  message("Reset your Maester password", ["Hello,", "Open this link to set a new password. It works once, for one hour."], url, "Set a new password");
