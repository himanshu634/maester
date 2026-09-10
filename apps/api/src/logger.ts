import pino, { type Logger } from "pino";

const SEVERITY: Record<string, string> = {
  trace: "DEBUG", debug: "DEBUG", info: "INFO", warn: "WARNING", error: "ERROR", fatal: "CRITICAL",
};

export type { Logger };

export function createLogger(level: string): Logger {
  return pino({
    level,
    messageKey: "message",
    formatters: { level: (label) => ({ severity: SEVERITY[label] ?? "DEFAULT" }) },
    redact: { paths: ["req.headers.cookie", "req.headers.authorization"], censor: "[redacted]" },
  });
}

export const silentLogger: Logger = pino({ level: "silent" });
