// Round 2 of the broker canvas (2026-10-24): several accounts, two people, the top five brokers.
// Synthetic household, worked in paise as integers so every total adds up. Closes are holdings-base's
// CLOSES, read as Friday 23 Oct 2026's NSE close; "now" is Monday 26 Oct 2026, 09:20 IST.
import { CLOSES } from "./holdings-base.mjs"

export const PEOPLE = { asha: "Asha", ravi: "Ravi" }

// state: in (signed in today) · out (signed out, needs a sign-in) · approve (Groww: approve today)
export const ACCTS = [
  { key: "z1", broker: "Zerodha", bk: "kite", person: "asha", label: "Asha", id: "AB1234", state: "in", read: "Today, 08:55", readShort: "today 08:55", lots: { "HDFC Bank": [120, 151240], Infosys: [80, 140215], ITC: [400, 41230], "Larsen & Toubro": [25, 321000] } },
  { key: "z2", broker: "Zerodha", bk: "kite", person: "ravi", label: "Ravi", id: "RK5521", state: "out", read: "Fri 23 Oct, 16:10", readShort: "Fri 16:10", lots: { "HDFC Bank": [60, 161000], Titan: [10, 330000] } },
  { key: "g1", broker: "Groww", bk: "groww", person: "asha", label: "Asha", id: "6F2K9Q", state: "approve", read: "Fri 23 Oct, 16:02", readShort: "Fri 16:02", lots: { ITC: [150, 43800], Titan: [15, 335000] } },
  { key: "a1", broker: "Angel One", bk: "angel", person: "ravi", label: "Ravi", id: "R123456", state: "out", read: "Fri 23 Oct, 15:58", readShort: "Fri 15:58", lots: { "Asian Paints": [30, 270000], ITC: [200, 42000] } },
  { key: "u1", broker: "Upstox", bk: "upstox", person: "asha", label: "Asha", id: "7ABC12", state: "in", read: "Today, 09:02", readShort: "today 09:02", lots: { Infosys: [20, 175500] } },
  { key: "i1", broker: "ICICI Direct", bk: "icici", person: "ravi", label: "Ravi", id: "8500123456", state: "in", read: "Today, 09:05", readShort: "today 09:05", lots: { "Larsen & Toubro": [10, 350000], "HDFC Bank": [40, 145000] } },
]
export const byKey = Object.fromEntries(ACCTS.map((a) => [a.key, a]))
export const accName = (a) => `${a.broker} · ${a.label}`
export const needsYou = (a) => a.state !== "in"

/** Rows per company across the given account keys: quantity, cost, value, and where each part is held. */
export function combineAccts(keys = ACCTS.map((a) => a.key)) {
  const by = {}
  for (const k of keys) {
    const a = byKey[k]
    for (const [name, [q, avg]] of Object.entries(a.lots)) {
      by[name] ??= { name, q: 0, cost: 0, at: [] }
      by[name].q += q
      by[name].cost += q * avg
      by[name].at.push([k, q])
    }
  }
  const rows = Object.values(by).map((r) => ({ ...r, value: r.q * CLOSES[r.name] }))
  rows.sort((a, b) => b.value - a.value)
  return rows
}
export const keysOf = (person) => ACCTS.filter((a) => !person || a.person === person).map((a) => a.key)
export const sum = (rows, k = "value") => rows.reduce((s, r) => s + r[k], 0)
export const acctValue = (k) => sum(combineAccts([k]))
