// pnpm --filter @maester/db waitlist:approve <email>
import { closeDb, createDb } from "./client.js";
import { approveWaitlistEmail, normalizeEmail } from "./queries/waitlist.js";

const email = process.argv[2];
const url = process.env.DATABASE_URL;
if (!email || !email.includes("@")) throw new Error("usage: waitlist:approve <email>");
if (!url) throw new Error("DATABASE_URL is required");
const db = createDb(url);
await approveWaitlistEmail(db, email);
await closeDb(db);
console.log(`approved ${normalizeEmail(email)}`);
