import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, loadConnections } from "../src/index.js";

const key = randomBytes(32);
const SECRET = "ZZleakSecret-0123456789abcdef";

describe("encryptSecret and decryptSecret", () => {
  it("gives back the same text", () => {
    expect(decryptSecret(encryptSecret(SECRET, key), key)).toBe(SECRET);
  });

  it("gives a different blob each time, never containing the text", () => {
    const a = encryptSecret(SECRET, key);
    const b = encryptSecret(SECRET, key);
    expect(a).not.toBe(b);
    expect(a).not.toContain(SECRET);
    expect(Buffer.from(a, "base64").toString("latin1")).not.toContain(SECRET);
  });

  it("lays out iv(12) | tag(16) | ciphertext", () => {
    expect(Buffer.from(encryptSecret(SECRET, key), "base64").length).toBe(12 + 16 + Buffer.byteLength(SECRET));
  });

  it("throws on a flipped byte anywhere", () => {
    const raw = Buffer.from(encryptSecret(SECRET, key), "base64");
    for (const i of [0, 12, 28, raw.length - 1]) {
      const bad = Buffer.from(raw);
      bad[i] = bad[i]! ^ 1;
      expect(() => decryptSecret(bad.toString("base64"), key)).toThrow();
    }
  });

  it("throws with the wrong key", () => {
    expect(() => decryptSecret(encryptSecret(SECRET, key), randomBytes(32))).toThrow();
  });

  it("throws on a blob too short to hold iv and tag", () => {
    expect(() => decryptSecret(Buffer.alloc(20).toString("base64"), key)).toThrow();
  });

  it("refuses a key that is not 32 bytes", () => {
    expect(() => encryptSecret(SECRET, randomBytes(16))).toThrow();
  });
});

describe("loadConnections", () => {
  it("decrypts the saved rows by provider", () => {
    const out = loadConnections([
      { provider: "dhan", clientId: "1000001", secretCiphertext: encryptSecret("dhan-token", key) },
      { provider: "fred", clientId: null, secretCiphertext: encryptSecret("fred-key", key) },
    ], key);
    expect(out).toEqual({ dhan: { clientId: "1000001", accessToken: "dhan-token" }, fred: { apiKey: "fred-key" } });
  });

  it("skips a Dhan row with no client ID", () => {
    expect(loadConnections([{ provider: "dhan", clientId: null, secretCiphertext: encryptSecret("dhan-token", key) }], key)).toEqual({ dhan: null, fred: null });
  });

  it("gives null for a provider with no row", () => {
    expect(loadConnections([], key)).toEqual({ dhan: null, fred: null });
  });

  it("names only the provider when a row will not decrypt", () => {
    const blob = encryptSecret("fred-key", randomBytes(32));
    let message = "";
    try {
      loadConnections([{ provider: "fred", clientId: null, secretCiphertext: blob }], key);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/fred/);
    expect(message).not.toContain(blob);
    expect(message).not.toContain("fred-key");
  });
});
