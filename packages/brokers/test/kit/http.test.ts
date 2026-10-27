import { BrokerManifest } from "@maester/contracts";
import { describe, expect, it, vi } from "vitest";
import { BrokerError, createBrokerHttp } from "../../src/kit/index.js";

const manifest = BrokerManifest.parse({
  id: "testbroker",
  name: "Test Broker",
  enabled: true,
  hosts: ["broker.test"],
  copy: { pickerLine: "Sign in.", lasts: "A day", cost: "Free", formLede: "Create an app.", steps: ["Do it."], signedOutNote: "Signed out." },
  credentials: [{ key: "apiKey", label: "API key", secret: false }],
  credentialShown: "apiKey",
  signIn: { kind: "redirect" },
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const rejection = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

describe("createBrokerHttp", () => {
  it("refuses http and other hosts before fetch is called", async () => {
    const fetch = vi.fn();
    const http = createBrokerHttp(manifest, { phase: "read", fetch });
    for (const url of ["http://broker.test/x", "https://elsewhere.test/x", "https://broker.test.evil.test/x", "not a url"]) {
      expect(await rejection(http.get(url))).toMatchObject({ code: "BROKER_UNAVAILABLE" });
    }
    expect(await rejection(http.post("https://elsewhere.test/x", { form: { a: "b" } }))).toMatchObject({ code: "BROKER_UNAVAILABLE" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps a signed-out status to BROKER_SIGNED_OUT on a read and BROKER_REFUSED on sign-in", async () => {
    for (const status of [401, 403]) {
      const read = createBrokerHttp(manifest, { phase: "read", fetch: vi.fn(async () => json(status, {})) });
      expect(await rejection(read.get("https://broker.test/h"))).toMatchObject({ code: "BROKER_SIGNED_OUT" });
      const signIn = createBrokerHttp(manifest, { phase: "sign-in", fetch: vi.fn(async () => json(status, {})) });
      expect(await rejection(signIn.post("https://broker.test/s", { form: { a: "b" } }))).toMatchObject({ code: "BROKER_REFUSED" });
    }
  });

  it("follows the manifest's own signedOutStatuses", async () => {
    const custom = { ...manifest, signedOutStatuses: [419] };
    const read = createBrokerHttp(custom, { phase: "read", fetch: vi.fn(async () => json(419, {})) });
    expect(await rejection(read.get("https://broker.test/h"))).toMatchObject({ code: "BROKER_SIGNED_OUT" });
    // 403 is not in this list, so it is just an error answer.
    const other = createBrokerHttp(custom, { phase: "read", fetch: vi.fn(async () => json(403, {})) });
    expect(await rejection(other.get("https://broker.test/h"))).toMatchObject({ code: "BROKER_UNAVAILABLE" });
  });

  it("maps 400 on sign-in to BROKER_REFUSED and 500 to BROKER_UNAVAILABLE", async () => {
    const bad = createBrokerHttp(manifest, { phase: "sign-in", fetch: vi.fn(async () => json(400, {})) });
    expect(await rejection(bad.post("https://broker.test/s", { form: { a: "b" } }))).toMatchObject({ code: "BROKER_REFUSED" });
    const down = createBrokerHttp(manifest, { phase: "sign-in", fetch: vi.fn(async () => json(500, {})) });
    expect(await rejection(down.post("https://broker.test/s", { form: { a: "b" } }))).toMatchObject({ code: "BROKER_UNAVAILABLE" });
    // A 400 on a read is not a refusal of anything: it is an error answer.
    const read = createBrokerHttp(manifest, { phase: "read", fetch: vi.fn(async () => json(400, {})) });
    expect(await rejection(read.get("https://broker.test/h"))).toMatchObject({ code: "BROKER_UNAVAILABLE" });
  });

  it("never puts the URL or the broker's text in the message", async () => {
    const thrown = vi.fn(async () => {
      throw new TypeError("fetch failed for https://broker.test/h?api_key=leak123");
    });
    const err = await rejection(createBrokerHttp(manifest, { phase: "read", fetch: thrown }).get("https://broker.test/h?api_key=leak123"));
    expect(err).toBeInstanceOf(BrokerError);
    expect((err as BrokerError).code).toBe("BROKER_UNAVAILABLE");
    expect((err as BrokerError).message).toBe("read: Test Broker could not be reached");
    expect((err as BrokerError).message).not.toContain("leak123");

    // Nor does an answer's own text, or a refused URL, reach one.
    const angry = json(500, { message: "token leak456 is bad" });
    const status = await rejection(createBrokerHttp(manifest, { phase: "read", fetch: vi.fn(async () => angry) }).get("https://broker.test/h"));
    expect((status as BrokerError).message).not.toContain("leak456");
    const refused = await rejection(createBrokerHttp(manifest, { phase: "read", fetch: vi.fn() }).get("https://elsewhere.test/h?api_key=leak789"));
    expect((refused as BrokerError).message).not.toContain("leak789");
    expect((refused as BrokerError).message).not.toContain("elsewhere");
  });

  it('sends a form url-encoded and json as JSON, with redirect "error"', async () => {
    const fetch = vi.fn(async () => json(200, { ok: true }));
    const http = createBrokerHttp(manifest, { phase: "sign-in", fetch });

    expect(await http.post("https://broker.test/form", { headers: { "X-Version": "3" }, form: { api_key: "k 1", request_token: "t&2" } })).toEqual({ ok: true });
    const [formUrl, formInit] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(formUrl).toBe("https://broker.test/form");
    expect(formInit).toMatchObject({ method: "POST", redirect: "error", body: "api_key=k+1&request_token=t%262" });
    expect(formInit.headers).toEqual({ "X-Version": "3", "Content-Type": "application/x-www-form-urlencoded" });
    expect(formInit.signal).toBeInstanceOf(AbortSignal);

    await http.post("https://broker.test/json", { json: { a: "b", n: 1 } });
    const [, jsonInit] = fetch.mock.calls[1]! as unknown as [string, RequestInit];
    expect(jsonInit).toMatchObject({ method: "POST", redirect: "error", body: JSON.stringify({ a: "b", n: 1 }) });
    expect(jsonInit.headers).toEqual({ "Content-Type": "application/json" });

    await http.get("https://broker.test/get", { headers: { Authorization: "token a:b" } });
    const [, getInit] = fetch.mock.calls[2]! as unknown as [string, RequestInit];
    expect(getInit).toMatchObject({ method: "GET", redirect: "error", headers: { Authorization: "token a:b" } });
    expect(getInit.body).toBeUndefined();
  });

  it("times a request out after timeoutMs", async () => {
    const hangs = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted at https://broker.test/h?api_key=leak123")))));
    const http = createBrokerHttp(manifest, { phase: "read", fetch: hangs as unknown as typeof globalThis.fetch, timeoutMs: 10 });
    const err = await rejection(http.get("https://broker.test/h"));
    expect(err).toMatchObject({ code: "BROKER_UNAVAILABLE", message: "read: Test Broker could not be reached" });
  });

  it("calls a body that is not JSON BROKER_ANSWER_UNREADABLE", async () => {
    const http = createBrokerHttp(manifest, { phase: "read", fetch: vi.fn(async () => new Response("<html>nope</html>", { status: 200 })) });
    expect(await rejection(http.get("https://broker.test/h"))).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
  });
});
