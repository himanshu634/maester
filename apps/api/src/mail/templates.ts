import type { MailMessage } from "./index.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function message(subject: string, lines: string[], url: string, button: string): Omit<MailMessage, "to"> {
  const text = [...lines, "", url, "", "If you did not ask for this, you can ignore this email."].join("\n");
  const html = [
    `<p>${lines.map(esc).join("</p><p>")}</p>`,
    `<p><a href="${esc(url)}">${esc(button)}</a></p>`,
    `<p>If you did not ask for this, you can ignore this email.</p>`,
  ].join("");
  return { subject, text, html };
}

export const confirmEmail = ({ name, url }: { name: string; url: string }) =>
  message("Confirm your email for Maester", [`Hello ${name},`, "Open this link to confirm your email and enter the terminal. It works for one hour."], url, "Confirm your email");

export const resetPassword = ({ name, url }: { name: string; url: string }) =>
  message("Reset your Maester password", [`Hello ${name},`, "Open this link to set a new password. It works once, for one hour."], url, "Set a new password");
