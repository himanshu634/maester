import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Job, JobTypes } from "@maester/contracts";
import { schema } from "@maester/db";
import { HttpError } from "../src/errors.js";
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

  it("createJob rejects an idempotency-key collision from another workspace", async () => {
    const a = await ctx.signUp("j1b@example.com");
    const b = await ctx.signUp("j1c@example.com");
    const subjectId = crypto.randomUUID();
    const a1 = await createJob(ctx.db, ctx.dispatcher, { workspaceId: a.workspaceId, type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId });
    const before = ctx.dispatcher.enqueued.length;
    let error: unknown;
    try {
      await createJob(ctx.db, ctx.dispatcher, { workspaceId: b.workspaceId, type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).code).toBe("CONFLICT");
    expect(ctx.dispatcher.enqueued.length).toBe(before);
    expect(a1.workspaceId).toBe(a.workspaceId);
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
    await ctx.db
      .update(schema.job)
      .set({ state: "failed", attempt: 5, lastErrorCode: "BOOM", finishedAt: new Date(), progress: { stage: "x" } })
      .where(eq(schema.job.id, job.id));
    const before = ctx.dispatcher.enqueued.length;
    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/jobs/${job.id}/retry`, { method: "POST", headers: { cookie: a.cookie, origin: "http://localhost" } });
    expect(res.status).toBe(200);
    const body = Job.parse(await res.json());
    expect(body.state).toBe("queued");
    expect(body.maxAttempts).toBe(10);
    expect(body.finishedAt).toBeNull();
    expect(body.progress).toEqual({});
    expect(ctx.dispatcher.enqueued.length).toBe(before + 1);

    await ctx.db.update(schema.job).set({ state: "running" }).where(eq(schema.job.id, job.id));
    const bad = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/jobs/${job.id}/retry`, { method: "POST", headers: { cookie: a.cookie, origin: "http://localhost" } });
    expect(bad.status).toBe(409);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("INVALID_STATE");
  });

  it("malformed :id returns 404, not 500", async () => {
    const a = await ctx.signUp("j6@example.com");
    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/jobs/not-a-uuid`, { headers: { cookie: a.cookie } });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("rejects retrying a freshly queued job but allows it once it has been queued for a while (stuck)", async () => {
    const a = await ctx.signUp("j5@example.com");
    const job = await createJob(ctx.db, ctx.dispatcher, { workspaceId: a.workspaceId, type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: crypto.randomUUID() });

    const tooSoon = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/jobs/${job.id}/retry`, { method: "POST", headers: { cookie: a.cookie, origin: "http://localhost" } });
    expect(tooSoon.status).toBe(409);
    expect(((await tooSoon.json()) as { error: { code: string } }).error.code).toBe("INVALID_STATE");

    await ctx.db.update(schema.job).set({ updatedAt: new Date(Date.now() - 6 * 60 * 1000) }).where(eq(schema.job.id, job.id));
    const before = ctx.dispatcher.enqueued.length;
    const stuck = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/jobs/${job.id}/retry`, { method: "POST", headers: { cookie: a.cookie, origin: "http://localhost" } });
    expect(stuck.status).toBe(200);
    const body = Job.parse(await stuck.json());
    expect(body.state).toBe("queued");
    expect(ctx.dispatcher.enqueued.length).toBe(before + 1);
  });
});
