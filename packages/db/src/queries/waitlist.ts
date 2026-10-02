import { eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { waitlistEntry } from "../schema/waitlist.js";

export type WaitlistSource = "google" | "email" | "admin";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The sign-up gate. An approved email may create an account; any other email is
 * recorded as pending (once: a retry never moves requested_at or the source).
 */
export async function admitOrWaitlist(
  db: Db,
  input: { email: string; source: WaitlistSource },
): Promise<"approved" | "waitlisted"> {
  const email = normalizeEmail(input.email);
  await db.insert(waitlistEntry).values({ email, status: "pending", source: input.source }).onConflictDoNothing({ target: waitlistEntry.email });
  const [row] = await db.select({ status: waitlistEntry.status }).from(waitlistEntry).where(eq(waitlistEntry.email, email));
  return row?.status === "approved" ? "approved" : "waitlisted";
}

/** Approve an email, whether or not it asked first. */
export async function approveWaitlistEmail(db: Db, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  await db
    .insert(waitlistEntry)
    .values({ email: normalized, status: "approved", source: "admin", approvedAt: new Date() })
    .onConflictDoUpdate({ target: waitlistEntry.email, set: { status: "approved", approvedAt: new Date() } });
}
