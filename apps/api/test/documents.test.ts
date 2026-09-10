import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CreateUploadResponse, Document, FinalizeResponse, JobTypes, paginated } from "@maester/contracts";
import { schema } from "@maester/db";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

const post = (cookie: string, body: unknown) => ({
  method: "POST",
  headers: { cookie, "content-type": "application/json", origin: "http://localhost" },
  body: JSON.stringify(body),
});

async function createUpload(ws: string, cookie: string, size = 1234) {
  const res = await ctx.app.request(`/v1/workspaces/${ws}/documents/uploads`, post(cookie, { originalName: "fy24.pdf", size, mimeType: "application/pdf" }));
  return { status: res.status, body: await res.json() };
}

describe("documents", () => {
  it("creates an upload with a signed PUT bound to size and type", async () => {
    const a = await ctx.signUp("d1@example.com");
    const { status, body } = await createUpload(a.workspaceId, a.cookie);
    expect(status).toBe(201);
    const parsed = CreateUploadResponse.parse(body);
    expect(parsed.document.state).toBe("pending_upload");
    expect(parsed.upload.headers["Content-Length"]).toBe("1234");
    expect(parsed.upload.url).toBe(`memory://upload/workspaces/${a.workspaceId}/documents/${parsed.document.id}/original.pdf`);
  });

  it("rejects oversize and non-pdf uploads with stable codes", async () => {
    const a = await ctx.signUp("d2@example.com");
    const big = await createUpload(a.workspaceId, a.cookie, 52428801);
    expect(big.status).toBe(413);
    expect((big.body as { error: { code: string } }).error.code).toBe("UPLOAD_TOO_LARGE");
    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/uploads`, post(a.cookie, { originalName: "x.png", size: 5, mimeType: "image/png" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; fields: { path: string; message: string }[] } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.fields[0]!.path).toBe("mimeType");
  });

  it("finalize requires the object to exist, enqueues verify, and is idempotent", async () => {
    const a = await ctx.signUp("d3@example.com");
    const { body } = await createUpload(a.workspaceId, a.cookie);
    const docId = (body as { document: { id: string } }).document.id;
    const key = `workspaces/${a.workspaceId}/documents/${docId}/original.pdf`;

    const missing = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/finalize`, post(a.cookie, {}));
    expect(missing.status).toBe(409);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("INVALID_STATE");

    await ctx.store.put(key, new TextEncoder().encode("%PDF-1.4"), "application/pdf");
    const first = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/finalize`, post(a.cookie, {}));
    expect(first.status).toBe(200);
    const f = FinalizeResponse.parse(await first.json());
    expect(f.document.state).toBe("uploaded");
    expect(f.job.type).toBe(JobTypes.DOCUMENT_VERIFY);
    expect(ctx.dispatcher.enqueued.some((j) => j.id === f.job.id)).toBe(true);

    const second = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/finalize`, post(a.cookie, {}));
    expect(second.status).toBe(200);
    expect(FinalizeResponse.parse(await second.json()).job.id).toBe(f.job.id);
  });

  it("list is paginated and scoped; detail is 404 across workspaces", async () => {
    const a = await ctx.signUp("d4@example.com");
    const b = await ctx.signUp("d5@example.com");
    for (let i = 0; i < 3; i++) await createUpload(a.workspaceId, a.cookie);
    await createUpload(b.workspaceId, b.cookie);

    const p1 = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents?limit=2`, { headers: { cookie: a.cookie } });
    const page = paginated(Document).parse(await p1.json());
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const p2 = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents?limit=2&cursor=${page.nextCursor}`, { headers: { cookie: a.cookie } });
    expect(paginated(Document).parse(await p2.json()).items).toHaveLength(1);

    const foreign = await ctx.app.request(`/v1/workspaces/${b.workspaceId}/documents/${page.items[0]!.id}`, { headers: { cookie: b.cookie } });
    expect(foreign.status).toBe(404);
  });

  it("download is only available once stored", async () => {
    const a = await ctx.signUp("d6@example.com");
    const { body } = await createUpload(a.workspaceId, a.cookie);
    const docId = (body as { document: { id: string } }).document.id;
    const notYet = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/download`, { headers: { cookie: a.cookie } });
    expect(notYet.status).toBe(409);
    await ctx.db.update(schema.document).set({ state: "stored" }).where(eq(schema.document.id, docId));
    const ok = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/download`, { headers: { cookie: a.cookie } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { url: string }).url).toContain("memory://download/");
  });
});
