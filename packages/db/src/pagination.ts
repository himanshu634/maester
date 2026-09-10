export type CursorValue = { createdAt: Date; id: string };

export function encodeCursor(v: CursorValue): string {
  return Buffer.from(JSON.stringify({ c: v.createdAt.toISOString(), i: v.id })).toString("base64url");
}

export function decodeCursor(s: string): CursorValue | null {
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as { c?: unknown; i?: unknown };
    if (typeof parsed.c !== "string" || typeof parsed.i !== "string") return null;
    const createdAt = new Date(parsed.c);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: parsed.i };
  } catch {
    return null;
  }
}
