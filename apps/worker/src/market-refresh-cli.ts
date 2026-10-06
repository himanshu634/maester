import { runMarketRefreshOnce } from "./market/run-once.js";

process.exit(await runMarketRefreshOnce());
