import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { answered, runTool } from "../errors.js";
import type { ServerDeps } from "../server.js";
import { describeTool } from "./rules.js";

/** M1 has no calculation registry; this is what an agent is told instead of working a figure out itself. */
export const NO_METRICS_SENTENCE =
  "Maester has no named calculations yet. Do not work out growth, margins, ratios or any other figure from the facts; say that Maester cannot calculate it yet.";

const MetricsAnswerSchema = z.object({ metrics: z.array(z.never()), note: z.string() });

export function registerListMetrics(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "list_metrics",
    {
      title: "List named calculations",
      description: describeTool(
        "The named calculations Maester can run (growth, margins, ratios): id, version, what each measures and its inputs. Today there are none.",
        "If the list is empty, say that Maester cannot calculate the figure yet; never work it out from the facts yourself.",
      ),
      outputSchema: MetricsAnswerSchema.shape,
      annotations: { readOnlyHint: true },
    },
    () => runTool("list_metrics", deps.logger, async () => answered({ metrics: [], note: NO_METRICS_SENTENCE }, NO_METRICS_SENTENCE, 0)),
  );
}
