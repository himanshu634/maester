import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobTypes } from "@maester/contracts";
import { schema } from "@maester/db";
import { createJob } from "../src/jobs/create.js";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

async function collect(res: Response, until: (text: string) => boolean, timeoutMs = 5000): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (until(text)) break;
  }
  await reader.cancel().catch(() => undefined);
  return text;
}

function parseJobEvents(text: string): { state: string; progress: { stage?: string } }[] {
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("event: job"))
    .map((block) => JSON.parse(block.split("\n").find((l) => l.startsWith("data: "))!.slice(6)));
}

describe("job events", () => {
  it("streams the initial state, a change, then done", async () => {
    const a = await ctx.signUp("e1@example.com");
    const job = await createJob(ctx.db, ctx.dispatcher, { workspaceId: a.workspaceId, type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: crypto.randomUUID() });

    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/jobs/${job.id}/events`, { headers: { cookie: a.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    setTimeout(async () => {
      await ctx.db.update(schema.job).set({ state: "running", progress: { stage: "hashing" }, updatedAt: new Date() }).where(eq(schema.job.id, job.id));
      setTimeout(async () => {
        await ctx.db.update(schema.job).set({ state: "succeeded", finishedAt: new Date(), updatedAt: new Date() }).where(eq(schema.job.id, job.id));
      }, 150);
    }, 150);

    const text = await collect(res, (t) => t.includes("event: done"));
    const events = parseJobEvents(text);
    expect(events[0]!.state).toBe("queued");
    expect(events.some((e) => e.state === "running" && e.progress.stage === "hashing")).toBe(true);
    expect(events[events.length - 1]!.state).toBe("succeeded");
  });

  it("returns 404 for another workspace's job", async () => {
    const a = await ctx.signUp("e2@example.com");
    const b = await ctx.signUp("e3@example.com");
    const job = await createJob(ctx.db, ctx.dispatcher, { workspaceId: a.workspaceId, type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: crypto.randomUUID() });
    const res = await ctx.app.request(`/v1/workspaces/${b.workspaceId}/jobs/${job.id}/events`, { headers: { cookie: b.cookie } });
    expect(res.status).toBe(404);
  });
});
