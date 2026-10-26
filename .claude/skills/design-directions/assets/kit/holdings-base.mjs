// Shared pieces for the Broker Connections canvas (holdings.mjs), 2026-10-19.
// Shell copied from financials.mjs (TerminalShell as built 13 Oct 2026), with Holdings live.
// Holdings are synthetic and internally consistent: every value is quantity × close, worked in
// paise as integers here so the mock adds up; the product computes them in financial-engine-ts.
import { T, FONT, NUM, esc, el, div, row, col, muted, spacer, button, link, tag } from "./lib.mjs"

export const FONTS = "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&amp;family=Caveat:wght@400..700&amp;display=swap"
export const HAND = "'Caveat', 'Bradley Hand', cursive"

// ---------- type ----------
export const appH1 = (t, size = 40, style = {}) =>
  el("h1", { margin: 0, fontStretch: "125%", fontWeight: 800, fontSize: size, lineHeight: 1.1, letterSpacing: "-0.02em", ...style }, esc(t))
export const h2 = (t, style = {}) =>
  el("h2", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: 22, lineHeight: 1.1, letterSpacing: "-0.02em", ...style }, esc(t))
export const h3 = (t, style = {}) => el("h3", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: 22, lineHeight: 1.2, ...style }, esc(t))
export const body = (t, style = {}) => el("p", { margin: 0, fontSize: 17, lineHeight: 1.5, maxWidth: 640, ...style }, esc(t))
export const note = (t, style = {}) => el("p", { margin: 0, fontSize: 14, lineHeight: 1.45, color: T.inkMuted, ...style }, esc(t))
export const strong = (t, style = {}) => el("p", { margin: 0, fontSize: 17, lineHeight: 1.5, fontWeight: 700, ...style }, esc(t))
export const synth = (inv) => tag("Synthetic example", { inverted: inv, style: { color: inv ? T.paper : T.ink } })

// ---------- terminal shell ----------
const ACCOUNT = "asha@example.com"
const GROUPS = [
  ["Overview", "Holdings", "Market mood"],
  ["Research", "Watchlist", "Documents", "Analyst"],
]
const FOOT = ["Activity", "Settings"]

function navItem(label, { current, soon }) {
  const base = { display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 44, padding: "0 12px", margin: "0 -12px", fontSize: 17, textDecoration: "none", gap: 8 }
  const style = current ? { ...base, fontWeight: 700, color: T.paper, background: T.ink } : { ...base, color: T.ink }
  const lab = el("span", current ? {} : { textDecoration: "underline", textUnderlineOffset: "3px", textDecorationThickness: "1.5px" }, esc(label))
  const kids = [lab]
  if (soon) kids.push(el("span", { fontSize: 14, color: current ? T.paperMuted : T.inkMuted }, "Soon"))
  return el("a", style, kids, { href: "#", ...(current ? { "aria-current": "page" } : {}) })
}
function railNav({ active, holdingsLive }) {
  const live = new Set(["Market mood", "Research", "Documents", "Settings", ...(holdingsLive ? ["Holdings"] : [])])
  const items = (labels) => labels.map((l) => navItem(l, { current: l === active, soon: !live.has(l) }))
  return col({ width: 224, flexShrink: 0, borderRight: `2px solid ${T.ink}`, boxSizing: "border-box", alignSelf: "stretch" }, [
    row({ height: 56, padding: "0 24px", borderBottom: `2px solid ${T.ink}`, flexShrink: 0, boxSizing: "border-box" }, [
      el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink }, "Maester", { href: "#" }),
    ]),
    col({ padding: "16px 24px", gap: 4, borderBottom: `1px solid ${T.inkMuted}` }, [muted("Workspace"), div({ fontWeight: 700, fontSize: 16 }, "Personal")]),
    el("nav", { display: "flex", flexDirection: "column", padding: "20px 24px" }, [
      col({}, items(GROUPS[0])),
      col({ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.inkMuted}` }, items(GROUPS[1])),
    ], { "aria-label": "Terminal" }),
    spacer(),
    el("nav", { display: "flex", flexDirection: "column", padding: "0 24px 20px" }, [div({ borderTop: `1px solid ${T.inkMuted}`, marginBottom: 12 }), ...items(FOOT)], { "aria-label": "Account pages" }),
    col({ padding: "16px 24px 24px", gap: 8, borderTop: `2px solid ${T.ink}` }, [
      muted("Signed in as"),
      div({ fontSize: 16, fontWeight: 700, overflowWrap: "anywhere" }, ACCOUNT),
      button("Sign out", { variant: "outline", style: { alignSelf: "flex-start", fontSize: 16 } }),
    ]),
  ])
}
const context = (synthetic = true) =>
  row({ minHeight: 56, padding: "8px 24px", gap: 16, borderBottom: `2px solid ${T.ink}`, flexShrink: 0, boxSizing: "border-box", justifyContent: "space-between" }, [div({ fontWeight: 700, fontSize: 16 }, "Personal"), synthetic ? synth() : ""])

export function appPage({ w = 1440, h = 900, active = "Holdings", holdingsLive = true, content, mainStyle = {}, synthetic = true }) {
  return div({ display: "flex", flexDirection: "row", alignItems: "stretch", width: w, height: h ?? "auto", minHeight: 900, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper, boxSizing: "border-box" }, [
    railNav({ active, holdingsLive }),
    col({ flex: 1, minWidth: 0 }, [
      context(synthetic),
      el("main", { display: "flex", flexDirection: "column", padding: "32px 24px 48px", gap: 28, minWidth: 0, ...mainStyle }, content),
    ]),
  ])
}
export function appPhone({ w = 390, h = 844, content, synthetic = true }) {
  return div({ display: "flex", flexDirection: "column", width: w, height: h ?? "auto", minHeight: 844, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper, boxSizing: "border-box" }, [
    row({ height: 56, padding: "0 16px 0 24px", borderBottom: `2px solid ${T.ink}`, flexShrink: 0, justifyContent: "space-between", boxSizing: "border-box" }, [
      el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink }, "Maester", { href: "#" }),
      button("Menu", { variant: "outline", style: { padding: "0 16px", fontSize: 16 } }),
    ]),
    context(synthetic),
    el("main", { display: "flex", flexDirection: "column", padding: "24px 24px 40px", gap: 24, minWidth: 0 }, content),
  ])
}

// ---------- pieces ----------
export const aLink = (t, style = {}) => link(t, { style: { fontSize: 17, ...style } })
export function notice({ title, lines = [], actions = [], inverted = false, style = {} }) {
  return col({ border: `2px solid ${inverted ? T.paper : T.ink}`, padding: "16px 20px", gap: 8, ...style }, [
    strong(title),
    ...lines.map((l) => body(l)),
    actions.length ? row({ gap: 16, marginTop: 8, flexWrap: "wrap" }, actions) : "",
  ])
}
export function field(label, { value = "", hint, error, password = false, copy = false, w = "100%" } = {}) {
  const input = row({ alignItems: "stretch", width: w, maxWidth: "100%" }, [
    div({ flex: 1, minWidth: 0, minHeight: 44, border: `${error ? 3 : 2}px solid ${T.ink}`, background: T.paper, padding: "0 12px", display: "flex", alignItems: "center", fontSize: 16, boxSizing: "border-box", overflow: "hidden", whiteSpace: "nowrap", ...NUM }, esc(value)),
    password ? button("Show", { variant: "outline", style: { minHeight: 44, borderLeft: 0, padding: "0 16px", fontSize: 16 } }) : "",
    copy ? button("Copy", { variant: "outline", style: { minHeight: 44, borderLeft: 0, padding: "0 16px", fontSize: 16 } }) : "",
  ])
  return col({ gap: 6, width: "100%" }, [
    div({ fontWeight: 700, fontSize: 16 }, esc(label)),
    hint ? note(hint) : "",
    input,
    error ? div({ fontWeight: 700, fontSize: 16 }, esc(error)) : "",
  ])
}
export function steps(items, { inverted = false } = {}) {
  return el("ol", { margin: 0, padding: 0, listStyle: "none", borderTop: `2px solid ${inverted ? T.paper : T.ink}` },
    items.map((s, i) =>
      el("li", { display: "grid", gridTemplateColumns: "32px minmax(0, 1fr)", gap: 12, padding: "12px 0", borderBottom: `1px solid ${inverted ? T.paper : T.inkMuted}`, fontSize: 16, lineHeight: 1.45 }, [
        div({ fontWeight: 700, ...NUM }, String(i + 1)),
        div({}, s),
      ]),
    ),
  )
}
// Accordion row as SettingsItem draws it: name, a muted summary, the state in words, + or −.
export function itemRow({ title, summary, state, bold = false, open = false, phone = false }) {
  return row({ minHeight: 64, gap: 16, padding: "12px 0", borderTop: `2px solid ${T.ink}`, alignItems: "center" }, [
    col({ flex: 1, minWidth: 0, gap: 2 }, [
      div({ fontStretch: "110%", fontWeight: 700, fontSize: phone ? 20 : 22, lineHeight: 1.2 }, esc(title)),
      phone ? div({ fontSize: 16, fontWeight: bold ? 700 : 400 }, esc(state)) : note(summary, { fontSize: 16 }),
    ]),
    phone ? "" : div({ fontSize: 16, fontWeight: bold ? 700 : 400, textAlign: "right" }, esc(state)),
    div({ fontSize: 22, fontWeight: 700, width: 20, textAlign: "center" }, open ? "−" : "+"),
  ])
}

// ---------- the synthetic portfolio (₹, NSE closes on Fri 16 Oct 2026, all synthetic) ----------
// Prices and costs in paise. Accounts: Zerodha (Kite) AB1234, Dhan 1100482211, Groww 6F2K9Q.
export const CLOSES = {
  "HDFC Bank": 174260, Infosys: 161825, ITC: 42185, "Larsen & Toubro": 361240, "Asian Paints": 248890, Titan: 351275,
}
export const SECTOR = { "HDFC Bank": "Banks", Infosys: "IT services", ITC: "Consumer staples", "Larsen & Toubro": "Construction", "Asian Paints": "Consumer goods", Titan: "Consumer goods" }
export const ACCOUNTS = {
  kite: { broker: "Zerodha", via: "Kite Connect", id: "AB1234", lots: { "HDFC Bank": [120, 151240], Infosys: [80, 140215], ITC: [400, 41230], "Larsen & Toubro": [25, 321000] } },
  dhan: { broker: "Dhan", via: "DhanHQ", id: "1100482211", lots: { "HDFC Bank": [30, 168800], "Asian Paints": [40, 286050], Infosys: [20, 175500] } },
  groww: { broker: "Groww", via: "Groww Trade API", id: "6F2K9Q", lots: { ITC: [150, 43800], Titan: [15, 335000] } },
}
const INR = (paise, { dp = 2 } = {}) => {
  const neg = paise < 0
  const abs = Math.abs(paise)
  const rupees = Math.floor(abs / 100)
  const p = String(abs % 100).padStart(2, "0")
  const s = rupees.toLocaleString("en-IN") + (dp ? "." + p : "")
  return (neg ? "−" : "") + "₹" + s
}
export const inr = INR
export const inr0 = (paise) => INR(Math.round(paise / 100) * 100, { dp: 0 })
export const qty = (n) => n.toLocaleString("en-IN")
// Percentage to one place from integers: round half up.
export const pct1 = (part, whole) => {
  const tenths = Math.floor((part * 1000 + Math.floor(whole / 2)) / whole)
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`
}

/** Rows per company across the given accounts: quantity, cost, value, and where it is held. */
export function combine(keys) {
  const by = {}
  for (const k of keys) {
    for (const [name, [q, avg]] of Object.entries(ACCOUNTS[k].lots)) {
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
export const total = (rows, key = "value") => rows.reduce((s, r) => s + r[key], 0)
export const shortName = { kite: "Zerodha", dhan: "Dhan", groww: "Groww" }
