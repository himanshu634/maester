import { closeDb, createDb, runMigrations } from "@maester/db";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = createDb(url);
await runMigrations(db, process.env.MIGRATIONS_FOLDER);
await closeDb(db);
console.log("migrations applied");
