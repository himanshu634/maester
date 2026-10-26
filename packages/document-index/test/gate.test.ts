import { describe, expect, it, vi } from "vitest";
import { EmbedderError, FakeEmbedder, ServedModelGate, type Embedder } from "../src/index.js";

const MODEL = "Snowflake/snowflake-arctic-embed-l-v2.0";
const QWEN_FOLDER = "/models/embed/Qwen/Qwen3-Embedding-0.6B";

describe("ServedModelGate", () => {
  it("passes when the embedder serves the model it is labelled with, and asks once", async () => {
    const embedder = new FakeEmbedder(MODEL, { serves: `/models/embed/${MODEL}` });
    const asked = vi.spyOn(embedder, "servedModel");
    const gate = new ServedModelGate(embedder);
    expect(await gate.check()).toEqual({ ok: true });
    expect(await gate.check()).toEqual({ ok: true });
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("names the other model when the embedder serves one, and asks again next time", async () => {
    const embedder = new FakeEmbedder(MODEL, { serves: QWEN_FOLDER });
    const asked = vi.spyOn(embedder, "servedModel");
    const gate = new ServedModelGate(embedder);
    expect(await gate.check()).toEqual({ ok: false, code: "EMBEDDER_MODEL_MISMATCH", served: QWEN_FOLDER });
    expect(await gate.check()).toEqual({ ok: false, code: "EMBEDDER_MODEL_MISMATCH", served: QWEN_FOLDER });
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it("gives the embedder's error code, then passes once the embedder answers (TEI starting late)", async () => {
    let calls = 0;
    const late: Embedder = {
      model: MODEL,
      embed: async () => [],
      servedModel: async () => {
        calls += 1;
        if (calls === 1) throw new EmbedderError("EMBEDDER_UNAVAILABLE", true, "The embedder is starting.");
        return MODEL;
      },
    };
    const gate = new ServedModelGate(late);
    expect(await gate.check()).toEqual({ ok: false, code: "EMBEDDER_UNAVAILABLE", served: null });
    expect(await gate.check()).toEqual({ ok: true });
    expect(await gate.check()).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("lets an error that is not the embedder's through", async () => {
    const broken: Embedder = { model: MODEL, embed: async () => [], servedModel: async () => { throw new TypeError("bug"); } };
    await expect(new ServedModelGate(broken).check()).rejects.toThrow("bug");
  });
});
