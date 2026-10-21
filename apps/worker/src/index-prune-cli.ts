import { runIndexPrune } from "./index-prune.js";

process.exit(await runIndexPrune(process.argv.slice(2)));
