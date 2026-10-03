// pnpm --filter @maester/db waitlist:approve <email>
import { closeDb, createDb } from "./client.js";
import { approveWaitlistEmail, normalizeEmail } from "./queries/waitlist.js";

const email = process.argv[2];
const url = process.env.DATABASE_URL;
if (!email || !email.includes("@")) {
  console.error("usage: pnpm --filter @maester/db waitlist:approve <email>");
  process.exit(1);
}
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const db = createDb(url);
try {
  await approveWaitlistEmail(db, email);
  console.log(`approved ${normalizeEmail(email)}`);
} finally {
  await closeDb(db);
}
