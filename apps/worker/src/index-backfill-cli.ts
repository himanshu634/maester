import { runIndexBackfillOnce } from "./index-backfill.js";

process.exit(await runIndexBackfillOnce(process.argv.slice(2)));
