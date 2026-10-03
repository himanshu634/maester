import { readFile } from "node:fs/promises";
import { basename } from "node:path";

// The web origin: it proxies /api/auth, /v1 and /dev to the API, and BETTER_AUTH_URL is this origin.
const API = process.env.API_URL ?? "http://localhost:5173";
const file = process.argv[2];
if (!file) throw new Error("usage: pnpm smoke <file.pdf>");
const email = `smoke-${Date.now()}@example.com`;
const password = "correct-horse-battery";
let cookie = "";

async function call(path: string, body?: unknown, method = body ? "POST" : "GET") {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", origin: API, cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie();
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data as never;
}

// Development only: approve the email, sign up, then confirm the account (the admit route does
// both), because sign-up needs an approved email and sign-in needs a confirmed one.
await call("/dev/auth/admit", { email });
await call("/api/auth/sign-up/email", { name: "Smoke", email, password });
await call("/dev/auth/admit", { email });
await call("/api/auth/sign-in/email", { email, password });
const me = (await call("/v1/me")) as { workspaces: { id: string }[] };
const ws = me.workspaces[0]!.id;
const company = (await call(`/v1/workspaces/${ws}/companies`, { displayName: "Smoke Test Company", country: "IN" })) as { id: string };
const bytes = await readFile(file);
const created = (await call(`/v1/workspaces/${ws}/documents/uploads`, { companyId: company.id, originalName: basename(file), size: bytes.length, mimeType: "application/pdf" })) as {
  document: { id: string }; upload: { url: string; headers: Record<string, string> };
};
const put = await fetch(created.upload.url, { method: "PUT", headers: created.upload.headers, body: bytes });
if (!put.ok) throw new Error(`PUT failed ${put.status} ${await put.text()}`);
const fin = (await call(`/v1/workspaces/${ws}/documents/${created.document.id}/finalize`, {})) as { job: { id: string } };
console.log("job", fin.job.id);

for (let i = 0; i < 60; i++) {
  const job = (await call(`/v1/workspaces/${ws}/jobs/${fin.job.id}`)) as { state: string; progress: unknown };
  console.log(job.state, JSON.stringify(job.progress));
  if (["succeeded", "failed", "cancelled"].includes(job.state)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const doc = (await call(`/v1/workspaces/${ws}/documents/${created.document.id}`)) as { state: string; contentSha256: string | null; rejectionCode: string | null };
console.log("document", doc.state, doc.contentSha256, doc.rejectionCode);
if (doc.state !== "stored") process.exit(1);
