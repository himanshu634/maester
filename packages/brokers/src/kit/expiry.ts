/**
 * When a sign-in stops working. `daily`: at a fixed local time each day (Zerodha: 06:00 in
 * Asia/Kolkata). `hours`: a fixed number of hours after sign-in.
 */
export type BrokerSessionExpiry = { kind: "daily"; at: string; timeZone: string } | { kind: "hours"; hours: number };

/** Minutes the zone is ahead of UTC at `instant`. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The local calendar day of `instant` in the zone, as [year, month (1–12), day]. */
function localDay(instant: Date, timeZone: string): [number, number, number] {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant).split("-").map(Number);
  return [y!, m!, d!];
}

/** The instant a local wall-clock time happens in the zone. */
function zoned(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const first = new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60_000);
  // A second pass settles a guess that crossed a daylight-saving change.
  return new Date(guess.getTime() - offsetMinutes(first, timeZone) * 60_000);
}

/** When a sign-in made at `signedInAt` stops working, by the plugin's rule. */
export function sessionExpiry(rule: BrokerSessionExpiry, signedInAt: Date): Date {
  if (rule.kind === "hours") return new Date(signedInAt.getTime() + rule.hours * 3_600_000);
  const [hh, mm] = rule.at.split(":").map(Number) as [number, number];
  const [y, m, d] = localDay(signedInAt, rule.timeZone);
  const today = zoned(y, m, d, hh, mm, rule.timeZone);
  if (today.getTime() > signedInAt.getTime()) return today;
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return zoned(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), hh, mm, rule.timeZone);
}
