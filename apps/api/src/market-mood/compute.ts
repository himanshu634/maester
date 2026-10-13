// apps/api/src/market-mood/compute.ts
/**
 * Market mood, worked out from stored daily series (docs/superpowers/specs/2026-10-06-market-mood-design.md, "Method").
 * Pure: no database, no clock. Every reading is ranked against its own previous 2 years; the mood
 * is the plain mean of the scored readings present, and only with at least 5 of 7.
 */
import type { FetchStatus, MarketMood, MissingReason, MoodBand, Reading, ReadingDetail, ReadingFamily, ReadingKey } from "@maester/contracts";

export type Point = { day: string; value: number; source: string };
export type SeriesMap = Record<string, Point[]>;

const WINDOW = 500;
const MIN_RANK_DAYS = 250;
const MIN_SCORED = 5;
const STALE_DAYS = 4;
const HISTORY_SESSIONS = 250;

type Def = {
  key: ReadingKey;
  family: ReadingFamily;
  scored: boolean;
  /** High values mean caution: score = 100 − rank. */
  invert: boolean;
  /** Sessions back for `previous`. */
  previous: number;
  /** Indian readings make the mood provisional when behind; global ones do not. */
  indian: boolean;
  /** Null: no source connected yet. */
  build: ((s: SeriesMap) => Point[]) | null;
  /** Source label shown when nothing is stored yet. */
  label: string;
};

/** Indexed read for an index already known to be in range. */
const pt = (p: Point[], i: number): Point => p[i]!;

const raw = (name: string) => (s: SeriesMap) => s[name] ?? [];

export const RAW_SERIES = ["nifty50", "india_vix", "us_vix", "gold_mcx", "usd_inr", "nifty_pcr_oi", "n500_above_200d_pct", "n500_net_highs_pct"];

function trend(s: SeriesMap): Point[] {
  const n = s.nifty50 ?? [];
  const out: Point[] = [];
  let sum = 0;
  for (let i = 0; i < n.length; i++) {
    sum += pt(n, i).value;
    if (i >= 125) sum -= pt(n, i - 125).value;
    if (i >= 124) out.push({ day: pt(n, i).day, value: (pt(n, i).value / (sum / 125) - 1) * 100, source: pt(n, i).source });
  }
  return out;
}

function goldVsNifty(s: SeriesMap): Point[] {
  const gold = s.gold_mcx ?? [];
  const nifty = s.nifty50 ?? [];
  const out: Point[] = [];
  for (let i = 20; i < nifty.length; i++) {
    const day = pt(nifty, i).day;
    const baseDay = pt(nifty, i - 20).day;
    const gi = atOrBefore(gold, day);
    const gb = atOrBefore(gold, baseDay);
    if (gi < 0 || gb < 0) continue;
    // Gold borrows the Nifty's day, so a gold price too old to be current is never paired with it:
    // otherwise a gold series that stopped would go on looking current and be scored.
    if (daysBetween(pt(gold, gi).day, day) > STALE_DAYS || daysBetween(pt(gold, gb).day, baseDay) > STALE_DAYS) continue;
    const g = (pt(gold, gi).value / pt(gold, gb).value - 1) * 100;
    const n = (pt(nifty, i).value / pt(nifty, i - 20).value - 1) * 100;
    out.push({ day, value: g - n, source: "Worked out from Dhan · MCX gold future and NSE close" });
  }
  return out;
}

export const READINGS: Def[] = [
  { key: "india_vix", family: "fear", scored: true, invert: true, previous: 5, indian: true, build: raw("india_vix"), label: "Dhan · NSE close" },
  { key: "us_vix", family: "fear", scored: true, invert: true, previous: 5, indian: false, build: raw("us_vix"), label: "FRED · Cboe VIX close" },
  { key: "nifty_pcr", family: "fear", scored: false, invert: false, previous: 5, indian: true, build: raw("nifty_pcr_oi"), label: "Dhan · NSE option chain, nearest expiry" },
  { key: "fpi_flows", family: "money", scored: true, invert: false, previous: 20, indian: true, build: null, label: "No source connected yet" },
  { key: "dii_flows", family: "money", scored: false, invert: false, previous: 20, indian: true, build: null, label: "No source connected yet" },
  { key: "nifty_trend", family: "breadth", scored: true, invert: false, previous: 20, indian: true, build: trend, label: "Dhan · NSE close" },
  { key: "n500_above_200d", family: "breadth", scored: true, invert: false, previous: 20, indian: true, build: raw("n500_above_200d_pct"), label: "Worked out from Dhan · NSE closes" },
  { key: "n500_net_highs", family: "breadth", scored: true, invert: false, previous: 20, indian: true, build: raw("n500_net_highs_pct"), label: "Worked out from Dhan · NSE closes" },
  { key: "usd_inr", family: "havens", scored: false, invert: false, previous: 20, indian: false, build: raw("usd_inr"), label: "FRED · Federal Reserve noon rate, New York" },
  { key: "gold_vs_nifty", family: "havens", scored: true, invert: true, previous: 20, indian: true, build: goldVsNifty, label: "Worked out from Dhan · MCX gold future and NSE close" },
];

/** Share of `window` below `value`, counting equal values as half, as a whole percent (half up). */
export function percentileRank(window: number[], value: number): number {
  let below = 0, equal = 0;
  for (const v of window) { if (v < value) below++; else if (v === value) equal++; }
  return Math.floor(((2 * below + equal) * 50) / window.length + 0.5);
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Index of the last point on or before `day`, or −1. Points are oldest first. */
function atOrBefore(p: Point[], day: string): number {
  let lo = 0, hi = p.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pt(p, mid).day <= day) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

function rankAt(p: Point[], i: number): { rank: number | null; days: number } {
  const window = p.slice(Math.max(0, i - WINDOW), i).map((x) => x.value);
  return { rank: window.length >= MIN_RANK_DAYS ? percentileRank(window, pt(p, i).value) : null, days: window.length };
}

export function bandOf(score: number): MoodBand {
  return score < 20 ? "very_cautious" : score < 40 ? "cautious" : score < 60 ? "middling" : score < 80 ? "eager" : "very_eager";
}

export function readingSeries(key: ReadingKey, s: SeriesMap): Point[] {
  const def = READINGS.find((d) => d.key === key)!;
  return def.build ? def.build(s) : [];
}

function readingOn(def: Def, p: Point[], session: string | null): Reading {
  const base = { key: def.key, family: def.family, scored: def.scored, source: p.at(-1)?.source ?? def.label };
  const empty = (missing: MissingReason): Reading => ({ ...base, value: null, day: null, previous: null, rank: null, rankDays: 0, score: null, missing });
  if (!def.build) return empty("no_source");
  const i = session ? atOrBefore(p, session) : p.length - 1;
  if (i < 0) return empty("no_data");
  const { rank, days } = rankAt(p, i);
  const stale = session !== null && daysBetween(pt(p, i).day, session) > STALE_DAYS;
  const score = def.scored && rank !== null && !stale ? (def.invert ? 100 - rank : rank) : null;
  const prev = i >= def.previous ? { value: pt(p, i - def.previous).value, day: pt(p, i - def.previous).day, sessions: def.previous } : null;
  const missing: MissingReason | null = stale ? "stale" : rank === null ? "not_enough_history" : null;
  return { ...base, value: pt(p, i).value, day: pt(p, i).day, previous: prev, rank, rankDays: days, score, missing };
}

function moodOf(readings: Reading[]): { score: number | null; count: number } {
  const scores = readings.filter((r) => r.scored && r.score !== null).map((r) => r.score!);
  if (scores.length < MIN_SCORED) return { score: null, count: scores.length };
  return { score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), count: scores.length };
}

export function computeMood(s: SeriesMap, fetch: FetchStatus): MarketMood {
  const built = READINGS.map((def) => ({ def, points: def.build ? def.build(s) : [] }));
  const sessionsList = (s.nifty50 ?? []).map((p) => p.day);
  const latestSession = sessionsList.at(-1) ?? null;
  const readings = built.map(({ def, points }) => readingOn(def, points, latestSession));
  const { score, count } = moodOf(readings);

  const scoredDays = readings.filter((r) => r.scored && r.score !== null && r.day).map((r) => r.day!);
  const asOf = scoredDays.length ? (scoredDays.sort()[0] ?? null) : null;
  const provisional = latestSession !== null && built.some(({ def }, k) => def.indian && def.scored && readings[k]!.score !== null && readings[k]!.day! < latestSession);

  const history: MarketMood["history"] = [];
  for (const day of sessionsList.slice(-HISTORY_SESSIONS)) {
    const m = moodOf(built.map(({ def, points }) => readingOn(def, points, day)));
    if (m.score !== null) history.push({ day, score: m.score });
  }
  const atOrBelowShare = score !== null && history.length
    ? Math.round((history.filter((h) => h.score <= score).length / history.length) * 100)
    : null;

  return { score, band: score === null ? null : bandOf(score), scoredCount: count, asOf, latestSession, provisional, readings, history, atOrBelowShare, fetch };
}

export function readingDetail(key: ReadingKey, s: SeriesMap, fetch: FetchStatus): ReadingDetail {
  const mood = computeMood(s, fetch);
  const reading = mood.readings.find((r) => r.key === key)!;
  const series = readingSeries(key, s).slice(-WINDOW).map(({ day, value }) => ({ day, value }));
  return { reading, series };
}
