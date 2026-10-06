import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV = 12;
const TAG = 16;

function checkKey(key: Buffer): void {
  if (key.length !== 32) throw new Error("the connections key must be 32 bytes");
}

/** AES-256-GCM. Returns base64 of iv(12) | tag(16) | ciphertext. A new random iv each time. */
export function encryptSecret(plain: string, key: Buffer): string {
  checkKey(key);
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

/** Throws when the blob is malformed, was changed, or was sealed with another key. */
export function decryptSecret(blob: string, key: Buffer): string {
  checkKey(key);
  const raw = Buffer.from(blob, "base64");
  if (raw.length < IV + TAG) throw new Error("the saved secret is malformed");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV));
  decipher.setAuthTag(raw.subarray(IV, IV + TAG));
  try {
    return Buffer.concat([decipher.update(raw.subarray(IV + TAG)), decipher.final()]).toString("utf8");
  } catch {
    // Node's own message says nothing secret, but keep it fixed.
    throw new Error("the saved secret could not be decrypted");
  }
}
