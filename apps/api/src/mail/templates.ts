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

/** Like message(), with more than one link: each one labelled in the text version. */
function messageWithLinks(subject: string, lines: string[], links: { label: string; url: string }[], footer: string): Omit<MailMessage, "to"> {
  const text = [...lines, "", ...links.map((l) => `${l.label}: ${l.url}`), "", footer].join("\n");
  const html = [
    `<p>${lines.map(esc).join("</p><p>")}</p>`,
    ...links.map((l) => `<p><a href="${esc(l.url)}">${esc(l.label)}</a></p>`),
    `<p>${esc(footer)}</p>`,
  ].join("");
  return { subject, text, html };
}

// No template uses the name: whoever signs up chooses it, so it must never reach
// someone else's inbox. The signatures keep it so callers stay unchanged.

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

/**
 * Someone signed up with an address that already has an account. The sign-up answers
 * exactly as a fresh one would; this email tells the owner what happened and what to do.
 */
export const existingAccount = ({ emailVerified, loginUrl, resetUrl }: { name: string; emailVerified: boolean; loginUrl: string; resetUrl: string }) =>
  emailVerified
    ? messageWithLinks(
        "You already have a Maester account",
        [
          "Hello,",
          "Someone tried to create a Maester account with this email address. You already have one.",
          "Sign in, or reset your password if you've forgotten it.",
        ],
        [
          { label: "Sign in", url: loginUrl },
          { label: "Reset your password", url: resetUrl },
        ],
        "If it wasn't you, nothing has changed. You can ignore this email.",
      )
    : messageWithLinks(
        "You already have a Maester account",
        [
          "Hello,",
          "Someone tried to create a Maester account with this email address. An account with this address is already waiting to be confirmed.",
          "The password just chosen was not saved.",
          "To finish, set your own password with Forgot your password. A reset replaces any earlier password and signs out every session.",
        ],
        [
          { label: "Forgot your password", url: resetUrl },
          { label: "Sign in", url: loginUrl },
        ],
        IGNORE,
      );
