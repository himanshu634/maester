import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Company, paginated } from "@maester/contracts";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

const post = (cookie: string, path: string, body: unknown) =>
  ctx.app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });

describe("companies", () => {
  it("creates, lists and reads a company", async () => {
    const a = await ctx.signUp("c1@example.com");
    const res = await post(a.cookie, `/v1/workspaces/${a.workspaceId}/companies`, { displayName: "  Synthetic Industries  ", country: "IN" });
    expect(res.status).toBe(201);
    const company = Company.parse(await res.json());
    expect(company.displayName).toBe("Synthetic Industries");

    const list = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/companies`, { headers: { cookie: a.cookie } });
    expect(paginated(Company).parse(await list.json()).items.map((c) => c.id)).toEqual([company.id]);

    const one = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/companies/${company.id}`, { headers: { cookie: a.cookie } });
    expect(Company.parse(await one.json()).id).toBe(company.id);
  });

  it("rejects a duplicate name case-insensitively within a workspace, but not across workspaces", async () => {
    const a = await ctx.signUp("c2@example.com");
    const b = await ctx.signUp("c3@example.com");
    expect((await post(a.cookie, `/v1/workspaces/${a.workspaceId}/companies`, { displayName: "Acme", country: "IN" })).status).toBe(201);
    const dup = await post(a.cookie, `/v1/workspaces/${a.workspaceId}/companies`, { displayName: "ACME", country: "IN" });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: { code: string } }).error.code).toBe("CONFLICT");
    expect((await post(b.cookie, `/v1/workspaces/${b.workspaceId}/companies`, { displayName: "Acme", country: "IN" })).status).toBe(201);
  });

  it("validates the country code", async () => {
    const a = await ctx.signUp("c4@example.com");
    const res = await post(a.cookie, `/v1/workspaces/${a.workspaceId}/companies`, { displayName: "X", country: "india" });
    expect(res.status).toBe(400);
  });

  it("does not expose another workspace's company, nor accept it for an upload", async () => {
    const a = await ctx.signUp("c5@example.com");
    const b = await ctx.signUp("c6@example.com");
    const foreign = await ctx.createCompany(b.workspaceId, b.cookie);
    const read = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/companies/${foreign}`, { headers: { cookie: a.cookie } });
    expect(read.status).toBe(404);

    const upload = await post(a.cookie, `/v1/workspaces/${a.workspaceId}/documents/uploads`, {
      companyId: foreign, originalName: "fy24.pdf", size: 10, mimeType: "application/pdf",
    });
    expect(upload.status).toBe(400);
    const body = (await upload.json()) as { error: { code: string; fields: { path: string }[] } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.fields[0]!.path).toBe("companyId");
  });
});
