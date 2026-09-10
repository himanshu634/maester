import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Job, JobTypes } from "@maester/contracts";
import { schema } from "@maester/db";
import { createJob } from "../src/jobs/create.js";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

describe("jobs", () => {
  it("createJob is idempotent and enqueues once", async () => {
    const { workspaceId } = await ctx.signUp("j1@example.com");
    const subjectId = crypto.randomUUID();
    const a = await createJob(ctx.db, ctx.dispatcher, { workspaceId, type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId });
    const b = await createJob(ctx.db, ctx.dispatcher, { workspaceId, type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId });
    expect(a.id).toBe(b.id);
    expect(a.state).toBe("queued");
    expect(ctx.dispatcher.enqueued.filter((j) => j.id === a.id)).toHaveLength(1);
  });

  it("GET job is scoped to the workspace", async () => {
    const a = await ctx.signUp("j2@example.com");
    const b = await ctx.signUp("j3@example.com");
    const job = await createJob(ctx.db, ctx.dispatcher, { workspaceId: a.workspaceId, type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: crypto.randomUUID() });
    const ok = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/jobs/${job.id}`, { headers: { cookie: a.cookie } });
    expect(ok.status).toBe(200);
    expect(Job.parse(await ok.json()).id).toBe(job.id);
    const denied = await ctx.app.request(`/v1/workspaces/${b.workspaceId}/jobs/${job.id}`, { headers: { cookie: b.cookie } });
    expect(denied.status).toBe(404);
  });

  it("retry re-enqueues a failed job with extended max attempts and rejects a running one", async () => {
    const a = await ctx.signUp("j4@example.com");
    const job = await createJob(ctx.db, ctx.dispatcher, { workspaceId: a.workspaceId, type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: crypto.randomUUID() });
    await ctx.db.update(schema.job).set({ state: "failed", attempt: 5, lastErrorCode: "BOOM" }).where(eq(schema.job.id, job.id));
    const before = ctx.dispatcher.enqueued.length;
    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/jobs/${job.id}/retry`, { method: "POST", headers: { cookie: a.cookie, origin: "http://localhost" } });
    expect(res.status).toBe(200);
    const body = Job.parse(await res.json());
    expect(body.state).toBe("queued");
    expect(body.maxAttempts).toBe(10);
    expect(ctx.dispatcher.enqueued.length).toBe(before + 1);

    await ctx.db.update(schema.job).set({ state: "running" }).where(eq(schema.job.id, job.id));
    const bad = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/jobs/${job.id}/retry`, { method: "POST", headers: { cookie: a.cookie, origin: "http://localhost" } });
    expect(bad.status).toBe(409);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("INVALID_STATE");
  });
});
