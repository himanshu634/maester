import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiskObjectStore } from "@maester/storage";
import { createApp } from "../src/app.js";
import { silentLogger } from "../src/logger.js";
import { testEnv } from "./env.js";

const deps = (env: ReturnType<typeof testEnv>, store: unknown = null) =>
  ({ env, logger: silentLogger, db: null as never, auth: null as never, store: store as never, dispatcher: null as never });

describe("dev upload page", () => {
  it("is served outside production", async () => {
    const res = await createApp(deps(testEnv())).request("/dev/upload");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("EventSource");
  });

  it("is absent in production", async () => {
    const res = await createApp(deps(testEnv({ NODE_ENV: "production" }))).request("/dev/upload");
    expect(res.status).toBe(404);
  });
});

describe("dev blob routes", () => {
  const KEY = "workspaces/w1/documents/d1/original.pdf";
  let root: string;
  let store: DiskObjectStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "maester-dev-blobs-"));
    const env = testEnv({ STORAGE_DRIVER: "disk", STORAGE_DIR: root, BETTER_AUTH_URL: "http://localhost:8787" });
    store = new DiskObjectStore(root, { baseUrl: env.BETTER_AUTH_URL, secret: env.DISPATCH_SECRET!, pathPrefix: "/dev/blobs" });
    app = createApp(deps(env, store));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores a signed PUT and serves it back through a signed GET", async () => {
    const upload = await store.signUpload(KEY, { contentType: "application/pdf", contentLength: 5, expiresInSeconds: 900 });
    const put = await app.request(upload.url, { method: "PUT", headers: { "content-type": "application/pdf" }, body: "%PDF-" });
    expect(put.status).toBe(200);
    expect(await store.exists(KEY)).toBe(true);

    const download = await store.signDownload(KEY, { expiresInSeconds: 300 });
    const get = await app.request(download.url);
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("application/pdf");
    expect(await get.text()).toBe("%PDF-");
  });

  it("refuses an unsigned or tampered URL", async () => {
    const unsigned = await app.request(`http://localhost:8787/dev/blobs/${KEY}`, { method: "PUT", body: "%PDF-" });
    expect(unsigned.status).toBe(403);

    const upload = await store.signUpload(KEY, { contentType: "application/pdf", contentLength: 5, expiresInSeconds: 900 });
    const tampered = upload.url.replace(KEY, "workspaces/w2/documents/d2/original.pdf");
    expect((await app.request(tampered, { method: "PUT", body: "%PDF-" })).status).toBe(403);
  });

  it("refuses a PUT URL replayed as a GET", async () => {
    const upload = await store.signUpload(KEY, { contentType: "application/pdf", contentLength: 5, expiresInSeconds: 900 });
    expect((await app.request(upload.url)).status).toBe(403);
  });

  it("returns 404 for a signed GET of an object that was never uploaded", async () => {
    const download = await store.signDownload(KEY, { expiresInSeconds: 300 });
    expect((await app.request(download.url)).status).toBe(404);
  });

  it("is absent when the gcs driver is selected", async () => {
    const gcs = createApp(deps(testEnv()));
    const res = await gcs.request(`http://localhost:8787/dev/blobs/${KEY}`, { method: "PUT", body: "%PDF-" });
    expect(res.status).toBe(404);
  });
});
