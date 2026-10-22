import { EmbedderError, servesModel, type Embedder } from "./embedder.js";

export type GateResult =
  | { ok: true }
  | { ok: false; code: "EMBEDDER_MODEL_MISMATCH" | EmbedderError["code"]; served: string | null };

/**
 * Says whether an embedder serves the model it is labelled with, before a query is embedded with it. Arctic and Qwen
 * both answer 1024 values, so the length of a vector cannot tell them apart; only the embedder's own answer can.
 *
 * A success is kept, next to the embedder it was checked against. A check that failed or did not match is not kept,
 * so the next `check()` asks again: TEI can start after its caller (its health check has a 120 s start period), so
 * there is no check at start-up. An error that is not the embedder's is not an answer and is thrown.
 */
export class ServedModelGate {
  private passed = false;

  constructor(private readonly embedder: Embedder) {}

  async check(): Promise<GateResult> {
    if (this.passed) return { ok: true };
    let served: string;
    try {
      served = await this.embedder.servedModel();
    } catch (err) {
      if (err instanceof EmbedderError) return { ok: false, code: err.code, served: null };
      throw err;
    }
    if (!servesModel(served, this.embedder.model)) return { ok: false, code: "EMBEDDER_MODEL_MISMATCH", served };
    this.passed = true;
    return { ok: true };
  }
}
