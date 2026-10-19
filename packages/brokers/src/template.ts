const PLACEHOLDER = /\{([A-Za-z0-9]+)\}/g;

/** The names a template's `{name}` placeholders use. */
export function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]!);
}

/**
 * Fills `{name}` placeholders. A value missing from `values` throws (the definition was checked
 * at load, so this is a bug, not a broker's answer). In a URL, values are URL-encoded.
 */
export function fill(template: string, values: Record<string, string>, { url = false } = {}): string {
  return template.replace(PLACEHOLDER, (_, name: string) => {
    const v = values[name];
    if (v === undefined) throw new Error(`no value for {${name}}`);
    return url ? encodeURIComponent(v) : v;
  });
}

/** Reads a dotted path such as `data.access_token`. */
export function at(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
