import pino, { type Logger } from "pino";

export type { Logger };

/** stdout carries the MCP protocol and nothing else, so every log line goes to stderr (fd 2). */
export function createLogger(level: string): Logger {
  return pino({ level, messageKey: "message" }, pino.destination({ fd: 2, sync: true }));
}

export const silentLogger: Logger = pino({ level: "silent" });
