import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "./logger.js";

export type ToolErrorCode = "NOT_FOUND" | "INVALID_INPUT" | "SEARCH_UNAVAILABLE" | "UNAVAILABLE";

/**
 * An error result. The code and the one sentence travel as text, with no `structuredContent`: a tool with an output
 * schema has its structured content checked by the client even when `isError` is set, and an error has no such shape.
 */
export function toolError(code: ToolErrorCode, sentence: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `${code}: ${sentence}` }] };
}

/** What a tool's handler gives `runTool`: the result, how many items it holds, and the error code when it is an error. */
export type ToolOutcome = { result: CallToolResult; items: number; code?: ToolErrorCode };

export const failed = (code: ToolErrorCode, sentence: string): ToolOutcome => ({ result: toolError(code, sentence), items: 0, code });

/** A success: the structured answer and a short text summary. */
export function answered<T extends Record<string, unknown>>(structured: T, text: string, items: number): ToolOutcome {
  return { result: { content: [{ type: "text", text }], structuredContent: structured }, items };
}

export const UNAVAILABLE_SENTENCE = "Maester's database did not answer.";

/**
 * Runs one tool call and logs one line: tool, milliseconds, items, error code. Never the arguments or the answer (a query
 * or a line name can carry a figure). A thrown error becomes `UNAVAILABLE`; its message, stack and query go nowhere.
 */
export async function runTool(name: string, logger: Logger, fn: () => Promise<ToolOutcome>): Promise<CallToolResult> {
  const started = performance.now();
  let outcome: ToolOutcome;
  try {
    outcome = await fn();
  } catch {
    outcome = failed("UNAVAILABLE", UNAVAILABLE_SENTENCE);
  }
  const line = { tool: name, ms: Math.round(performance.now() - started), items: outcome.items, code: outcome.code ?? null };
  if (outcome.code) logger.warn(line, "tool call failed");
  else logger.info(line, "tool call");
  return outcome.result;
}
