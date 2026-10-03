import { sql } from "drizzle-orm";
import { bigint, check, integer, pgTable, text } from "drizzle-orm/pg-core";
import { ts } from "./platform.js";

/** Who may create an account. Approved emails get one; everyone else is recorded here. */
export const waitlistEntry = pgTable(
  "waitlist_entry",
  {
    /** Lower-cased; normalizeEmail() runs before every read and write. */
    email: text("email").primaryKey(),
    status: text("status", { enum: ["pending", "approved"] }).notNull(),
    source: text("source", { enum: ["google", "email", "admin"] }).notNull(),
    requestedAt: ts("requested_at").notNull().defaultNow(),
    approvedAt: ts("approved_at"),
  },
  (t) => [
    check("waitlist_entry_status", sql`${t.status} in ('pending', 'approved')`),
    check("waitlist_entry_source", sql`${t.source} in ('google', 'email', 'admin')`),
  ],
);

/** Better Auth's database rate limiter (model "rateLimit"). */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export type WaitlistEntryRow = typeof waitlistEntry.$inferSelect;
