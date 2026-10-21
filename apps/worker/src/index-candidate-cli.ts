import { runIndexCandidate } from "./index-candidate.js";

process.exit(await runIndexCandidate(process.argv.slice(2)));
