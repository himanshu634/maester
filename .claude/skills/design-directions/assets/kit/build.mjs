// node build.mjs [heights.json] → ../canvas/project/*.dc.html, canvas.json, ../canvas/twins/*
// Round 1 of the Maester Terminal Overview canvas (2026-10-02): Today + A/B/C/D.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  T, NUM, esc, el, div, row, col, txt, muted, spacer, display, h1app, h2, h3, figure,
  button, link, tag, synthetic, ledger, spec, bars, weightBar, appShell, phoneShell, publicShell,
  inverted, section, dcHtml, twinHtml,
} from "./lib.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, "..", "canvas")
const HFILE = process.argv.slice(2).find((a) => !a.startsWith("--"))
const heights = HFILE ? JSON.parse(fs.readFileSync(HFILE, "utf8")) : {}
// JSON.parse(fs.readFileSync(process.argv[2], "utf8")) : {}
const MEASURE = process.argv.includes("--measure")

// ---------- synthetic portfolio (internally consistent) ----------
function inr(n, { sign = false } = {}) {
  const neg = n < 0
  const s = Math.round(Math.abs(n)).toString()
  const last3 = s.slice(-3)
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")
  return (neg ? "−" : sign ? "+" : "") + "₹" + (rest ? rest + "," : "") + last3
}
const price = (p) => "₹" + p.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (q) => q.toLocaleString("en-IN")

const BASE = [
  { name: "Meridian Bank", qty: 400, price: 1612.4, cost: 1385.0, sector: "Financials" },
  { name: "Harbour Cements", qty: 120, price: 4280.0, cost: 3610.0, sector: "Materials" },
  { name: "Quill Software", qty: 300, price: 1455.25, cost: 1102.5, sector: "Information technology" },
  { name: "Northgate Pharma", qty: 250, price: 1198.6, cost: 1060.0, sector: "Health care" },
  { name: "Saffron Foods", qty: 900, price: 268.35, cost: 241.2, sector: "Consumer staples" },
  { name: "Kestrel Power", qty: 1500, price: 142.1, cost: 128.4, sector: "Utilities" },
  { name: "Lantern Logistics", qty: 600, price: 318.9, cost: 302.0, sector: null },
  { name: "Coral Chemicals", qty: 180, price: 905.0, cost: null, sector: "Materials" },
  { name: "Tamarind Textiles", qty: 2000, price: null, cost: 96.5, sector: "Consumer discretionary" },
]
function portfolio(list) {
  const hs = list.map((h) => ({ ...h, value: h.price == null ? null : h.qty * h.price }))
  const known = hs.filter((h) => h.value != null).reduce((a, h) => a + h.value, 0)
  hs.forEach((h) => (h.weight = h.value == null ? null : (h.value / known) * 100))
  const withCost = hs.filter((h) => h.value != null && h.cost != null)
  const gain = withCost.reduce((a, h) => a + h.value - h.qty * h.cost, 0)
  const costSum = withCost.reduce((a, h) => a + h.qty * h.cost, 0)
  const sectors = {}
  hs.filter((h) => h.value != null).forEach((h) => (sectors[h.sector || "Sector not set"] = (sectors[h.sector || "Sector not set"] || 0) + h.weight))
  const sectorList = Object.entries(sectors)
    .map(([label, v]) => ({ label, v, muted: label === "Sector not set" }))
    .sort((a, b) => (a.muted - b.muted) || b.v - a.v)
  return { hs, known, gain, gainPct: (gain / costSum) * 100, withCost: withCost.length, priced: hs.filter((h) => h.value != null).length, n: hs.length, sectors: sectorList }
}
const P = portfolio(BASE)
// The quiet-week variant: Tamarind priced, Harbour already reviewed, limit raised to 25%.
const PQ = portfolio(BASE.map((h) => (h.name === "Tamarind Textiles" ? { ...h, price: 102.4 } : h)))
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
const word = (n) => WORDS[n] ?? String(n)
const CASH = 112400
// Sanity: the numbers on every frame come from here.
if (inr(P.known) !== "₹27,03,690") throw new Error("known value drifted: " + inr(P.known))

const AS_OF = "Holdings as of 30 Sep 2026 · prices you entered on 1 Oct · Indian rupees"
const shortName = (s) => (s.length > 18 ? s.replace("Information technology", "IT").replace("Consumer discretionary", "Consumer disc.") : s)

// ---------- shared blocks ----------
function titleBlock({ primary = true, phone = false } = {}) {
  const tags = row({ gap: 8, flexWrap: "wrap" }, [tag("Holdings snapshot"), synthetic()])
  const btn = button("Update holdings", { variant: primary ? "fill" : "outline", style: phone ? { width: "100%" } : {} })
  if (phone)
    return col({ gap: 12 }, [h1app("Long-term", { fontSize: 32 }), tags, muted(AS_OF), btn])
  return row({ alignItems: "flex-end", gap: 24 }, [
    col({ gap: 12, flex: 1, minWidth: 0 }, [row({ gap: 16, alignItems: "center", flexWrap: "wrap" }, [h1app("Long-term"), tags]), muted(AS_OF, { fontSize: 16 })]),
    btn,
  ])
}
const figs = (p) => [
  ["Known value", inr(p.known), `${p.priced} of ${p.n} holdings priced`],
  ["Cash", inr(CASH), "As you entered it on 30 Sep"],
  ["Unrealized gain", inr(p.gain, { sign: true }), `+${p.gainPct.toFixed(1)}% on the ${p.withCost} holdings with a known cost. ${p.n - p.withCost} left out.`],
  ["Valuation coverage", `${p.priced} of ${p.n}`, p.priced < p.n ? "Tamarind Textiles has no price" : "Every holding has a price"],
]
function figureStrip({ size = 40, p = P } = {}) {
  const FIGS = figs(p)
  return div({ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}`, flexShrink: 0 },
    FIGS.map(([l, v, n], i) => col({ gap: 6, padding: "16px 20px 18px", paddingLeft: i ? 20 : 0, borderLeft: i ? `1px solid ${T.inkMuted}` : "0" }, [muted(l), figure(v, size), muted(n)])))
}
const figureSpec = (p = P) => spec(figs(p).map(([l, v, n]) => [l, `<div style="font-weight:700;font-size:22px;${"font-variant-numeric:tabular-nums slashed-zero"}">${esc(v)}</div><div style="color:${T.inkMuted};font-size:14px">${esc(n)}</div>`]), { termW: 112 })

const dash = (why) => `<span title="${esc(why)}">—</span>`
function holdingsLedger({ compact = false, p = P } = {}) {
  const sorted = [...p.hs].sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
  if (compact)
    return ledger({
      label: "Holdings",
      rowPad: "10px 12px",
      cols: [{ label: "Company" }, { label: "Value", w: "96px", align: "right" }, { label: "Weight", w: "56px", align: "right" }],
      rows: sorted.map((h) => [link(h.name), h.value == null ? dash("No price") : inr(h.value), h.weight == null ? dash("No price") : h.weight.toFixed(1) + "%"]),
      total: [`${p.priced} of ${p.n} priced`, inr(p.known), "100%"],
      fontSize: 16,
    })
  return ledger({
    label: "Holdings",
    cols: [{ label: "Company" }, { label: "Quantity", w: "88px", align: "right" }, { label: "Price", w: "104px", align: "right" }, { label: "Value", w: "120px", align: "right" }, { label: "Weight", w: "72px", align: "right" }],
    rows: sorted.map((h) => [link(h.name), qty(h.qty), h.price == null ? dash("No price entered") : price(h.price), h.value == null ? dash("No price entered") : inr(h.value), h.weight == null ? dash("No price entered") : h.weight.toFixed(1) + "%"]),
    total: [`${p.priced} of ${p.n} priced`, "", "", inr(p.known), "100.0%"],
  })
}
const allocation = ({ labelW = 170, p = P } = {}) =>
  col({ gap: 12 }, [
    bars(p.sectors.map((s) => ({ ...s, label: shortName(s.label) })), { labelW }),
    muted(`Share of priced value. The dashed bar is Lantern Logistics, which has no sector yet.${p.priced < p.n ? " Tamarind Textiles stays out until it has a price." : ""}`),
  ])

function itemList(items) {
  return col({ borderTop: `2px solid ${T.ink}` }, items.map((it, i) =>
    col({ gap: 4, padding: "14px 0", borderBottom: `1px solid ${T.inkMuted}` }, [
      row({ gap: 12, justifyContent: "space-between", alignItems: "baseline" }, [txt(it.title, { fontWeight: 700, fontSize: 17 }), it.when ? muted(it.when, { whiteSpace: "nowrap" }) : ""]),
      txt(it.body, { fontSize: 16 }),
      it.action ? div({ fontSize: 16, marginTop: 2 }, link(it.action)) : "",
    ])))
}
const RESEARCH = [
  { title: "Harbour Cements · FY2025 annual report", when: "30 Sep", body: "Operating cash flow fell 18% year on year, from ₹1,412 crore to ₹1,158 crore.", action: "Open page 96" },
  { title: "Quill Software · Q2 results", when: "29 Sep", body: "Revenue up 11% year on year. Read and checked; nothing you follow moved.", action: "Open the results" },
  { title: "Kestrel Power · dividend declared", when: "26 Sep", body: "₹2.50 a share, record date 17 Oct. Expected ₹3,750 on your 1,500 shares.", action: "See the announcement" },
]
const RESEARCH_QUIET = [
  { title: "Harbour Cements · FY2025 annual report", when: "30 Sep", body: "Reviewed by you on 1 Oct. You held and revised the thesis; next review 14 Jan.", action: "See your decision" },
  RESEARCH[1],
  RESEARCH[2],
]
const ISSUES = [
  { title: "Tamarind Textiles has no price", body: "2,000 shares are left out of your value and allocation until you add one.", action: "Add a price" },
  { title: "Coral Chemicals has no cost", body: "Unrealized gain covers 7 holdings instead of 8.", action: "Add the cost" },
  { title: "Lantern Logistics has no sector", body: "Shown as “Sector not set” in allocation.", action: "Set a sector" },
]

// ---------- Today ----------
function today() {
  return publicShell({
    content: [
      h1app("The terminal"),
      txt("You have a session, but the terminal has no screens yet. The first release adds your holdings and the filings behind them.", { maxWidth: 680 }),
    ],
  })
}

// ---------- A · The snapshot, as specified ----------
function A_desk(h) {
  return appShell({ h, content: [
    titleBlock(),
    figureStrip(),
    div({ display: "grid", gridTemplateColumns: "minmax(0, 1.65fr) minmax(0, 1fr)", gap: 40 }, [
      section("Holdings", holdingsLedger(), { aside: link("All holdings", { style: { fontSize: 16 } }) }),
      section("Allocation by sector", allocation()),
    ]),
    div({ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 40 }, [
      section("Research updates", itemList(RESEARCH), { aside: muted("Companies you own") }),
      section("Data to fix", itemList(ISSUES), { aside: muted("3 open") }),
    ]),
  ] })
}
function A_phone(h) {
  return phoneShell({ h, content: [
    titleBlock({ phone: true }),
    figureSpec(),
    section("Holdings", holdingsLedger({ compact: true }), { aside: link("All", { style: { fontSize: 16 } }) }),
    section("Allocation by sector", allocation({ labelW: 118 })),
    section("Research updates", itemList(RESEARCH)),
    section("Data to fix", itemList(ISSUES)),
  ] })
}
function A_empty(h) {
  return appShell({ h, content: [
    row({ gap: 16, alignItems: "center" }, [h1app("Long-term"), synthetic()]),
    muted("Created 2 Oct 2026 · Indian rupees · no holdings yet", { fontSize: 16, marginTop: -20 }),
    div({ border: `2px solid ${T.ink}`, maxWidth: 1000 }, [
      col({ gap: 12, padding: "28px 28px 24px", borderBottom: `2px solid ${T.ink}` }, [
        h2("Add your first holding", 28),
        txt("Maester can only watch what it knows you own. Bring your holdings in once; you can correct them at any time.", { maxWidth: 640 }),
      ]),
      div({ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }, [
        col({ gap: 12, padding: 28, borderRight: `1px solid ${T.inkMuted}` }, [h3("Import a broker export"), txt("A CSV from your broker. You check every row before anything is saved.", { fontSize: 16 }), div({ marginTop: 8 }, button("Choose a file"))]),
        col({ gap: 12, padding: 28 }, [h3("Type them in"), txt("Company, quantity and the date you held them. A price is optional; without one, the holding shows as not valued.", { fontSize: 16 }), div({ marginTop: 8 }, button("Add a holding", { variant: "outline" }))]),
      ]),
    ]),
    col({ gap: 6 }, [
      div({ fontSize: 17 }, link("Explore a synthetic portfolio instead")),
      muted("Read-only. Every company and figure in it is made up.", { fontSize: 16 }),
    ]),
  ] })
}

// ---------- B · The weekly letter ----------
const bandB = (label, children, { last = false, pad = "28px 0" } = {}) =>
  div({ display: "grid", gridTemplateColumns: "200px minmax(0, 1fr)", borderBottom: last ? "0" : `2px solid ${T.ink}` }, [
    div({ padding: "28px 24px", borderRight: `2px solid ${T.ink}`, fontSize: 14, color: T.inkMuted }, esc(label)),
    div({ padding: pad, paddingLeft: 32, paddingRight: 32, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }, children),
  ])
const bandP = (label, children) =>
  col({ gap: 12, padding: "20px 24px 24px", borderBottom: `2px solid ${T.ink}` }, [muted(label), ...children])

function needsRows({ phone = false } = {}) {
  const items = [
    { t: "Harbour Cements", b: "Your review date is Friday 3 Oct, and the FY2025 annual report arrived since you last looked.", a: button("Start the review", { style: phone ? { width: "100%" } : {} }) },
    { t: "Meridian Bank", b: "23.9% of priced value, over the 20% limit you set for any one holding.", a: div({ fontSize: 16 }, link("See the position")) },
  ]
  return col({ borderTop: `1px solid ${T.inkMuted}` }, items.map((it) =>
    phone
      ? col({ gap: 8, padding: "14px 0", borderBottom: `1px solid ${T.inkMuted}` }, [txt(it.t, { fontWeight: 700 }), txt(it.b, { fontSize: 16 }), it.a])
      : div({ display: "grid", gridTemplateColumns: "200px minmax(0, 1fr) 220px", gap: 24, alignItems: "center", padding: "16px 0", borderBottom: `1px solid ${T.inkMuted}` }, [txt(it.t, { fontWeight: 700, fontSize: 20 }), txt(it.b, { fontSize: 17 }), row({ justifyContent: "flex-end" }, it.a)])))
}
const UNKNOWN = [
  ["Tamarind Textiles", `No price, so its 2,000 shares are left out of value. ${link("Add a price")}`],
  ["Coral Chemicals", `No cost, so gain covers 7 holdings. ${link("Add the cost")}`],
  ["Lantern Logistics", `No sector, so it sits under “Sector not set”. ${link("Set a sector")}`],
]
function B_desk(h, { quiet = false } = {}) {
  const p = quiet ? PQ : P
  const sentence = quiet
    ? `${inr(p.known)} across ${word(p.priced)} priced holdings. Nothing needs you this week.`
    : `${inr(p.known)} across ${word(p.priced)} priced holdings. Two things need you this week.`
  const top = bandB("Week of 28 Sep", [
    display(sentence, 60, { maxWidth: 1000, ...NUM }),
    row({ gap: 12, flexWrap: "wrap", marginTop: 4 }, [tag("Holdings snapshot"), synthetic(), muted(AS_OF, { fontSize: 16 })]),
    row({ gap: 16, marginTop: 4 }, [button("Update holdings", { variant: "outline" })]),
  ], { pad: "32px 0 32px" })
  if (quiet)
    return appShell({ h, mainStyle: { padding: 0, gap: 0 }, content: [
      top,
      bandB("What was checked", [
        spec([
          ["New filings", "Harbour Cements FY2025 annual report, reviewed by you on 1 Oct. Quill Software Q2 results, 29 Sep: nothing you follow moved."],
          ["Review dates", "None this week. Next: Northgate Pharma on Tuesday 14 Oct."],
          ["Position limit", `Your largest holding is Meridian Bank at ${PQ.hs[0].weight.toFixed(1)}% of a 25% limit.`],
          ["Prices", "All nine holdings priced on 1 Oct."],
          ["Income", "Kestrel Power dividend of ₹3,750 expected after the 17 Oct record date."],
        ], { termW: 180 }),
        muted("Silence here is a checked answer. Each line says what was looked at."),
      ]),
      bandB("Holdings", [holdingsLedger({ p: PQ })], { last: true }),
    ] })
  return appShell({ h, mainStyle: { padding: 0, gap: 0 }, content: [
    top,
    bandB("Needs you · 2", [needsRows()]),
    bandB("What changed", [itemList(RESEARCH)]),
    bandB("Holdings", [holdingsLedger(), div({ fontSize: 16 }, link("All holdings"))]),
    bandB("Allocation", [div({ maxWidth: 720 }, allocation())]),
    bandB("Not known yet", [spec(UNKNOWN, { termW: 200 })], { last: true }),
  ] })
}
function B_phone(h) {
  return phoneShell({ h, mainStyle: { padding: 0, gap: 0 }, content: [
    bandP("Week of 28 Sep", [
      display(`${inr(P.known)} across ${word(P.priced)} priced holdings. Two things need you this week.`, 34, NUM),
      row({ gap: 8, flexWrap: "wrap" }, [tag("Holdings snapshot"), synthetic()]),
      muted(AS_OF),
      button("Update holdings", { variant: "outline", style: { width: "100%" } }),
    ]),
    bandP("Needs you · 2", [needsRows({ phone: true })]),
    bandP("What changed", [itemList(RESEARCH)]),
    bandP("Holdings", [holdingsLedger({ compact: true })]),
    bandP("Allocation", [allocation({ labelW: 118 })]),
    bandP("Not known yet", [spec(UNKNOWN, { termW: 104 })]),
  ] })
}

// ---------- C · Due this week ----------
const HAIR_INV = `1px solid ${T.paper}`
function dueItem({ phone = false } = {}) {
  return col({ gap: 16, padding: phone ? "20px" : "24px 28px 28px" }, [
    row({ gap: 12, flexWrap: "wrap", alignItems: "baseline" }, [
      div({ fontWeight: 700, fontSize: phone ? 22 : 26, lineHeight: 1.2, fontStretch: "110%", flex: phone ? undefined : 1, minWidth: 0 }, "Review your thesis on Harbour Cements"),
      tag("Due Friday 3 Oct", { inverted: true }),
    ]),
    div({ fontSize: 16, color: T.paperMuted }, "Triggered by the FY2025 annual report, published 30 Sep"),
    spec([
      ["Trigger", "Operating cash flow fell 18% year on year. Your thesis note says the case rests on cash generation."],
      ["Evidence", `Cash flow statement, page 96. ${link("Open the page")}`],
      ["Your call", "Hold, trim or revise the thesis. Maester records what you decide and why. It never trades."],
    ], { termW: phone ? 84 : 140, inverted: true }),
    row({ gap: 12, flexWrap: "wrap" }, [button("Start the review", { inverted: true, style: phone ? { width: "100%" } : {} }), button("Move to next week", { variant: "outline", inverted: true, style: phone ? { width: "100%" } : {} })]),
  ])
}
const MORE_DUE = [
  { t: "Meridian Bank is over your 20% limit", d: "23.9% of priced value · ₹6,44,960", a: "See the position" },
  { t: "Tamarind Textiles has no price", d: "2,000 shares left out of value", a: "Add a price" },
]
function duePanel({ phone = false } = {}) {
  return inverted([
    row({ gap: 16, padding: phone ? "16px 20px" : "18px 28px", borderBottom: `2px solid ${T.paper}`, alignItems: "baseline", flexWrap: "wrap" }, [
      h2("Due this week", phone ? 24 : 28, { color: T.paper }),
      div({ fontSize: 16, color: T.paperMuted }, "3 items, ranked by how much of your portfolio they touch"),
    ]),
    dueItem({ phone }),
    ...MORE_DUE.map((m) =>
      phone
        ? col({ gap: 4, padding: "14px 20px", borderTop: HAIR_INV }, [div({ fontWeight: 700, fontSize: 17 }, esc(m.t)), div({ fontSize: 14, color: T.paperMuted }, esc(m.d)), div({ fontSize: 16 }, link(m.a))])
        : div({ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px 200px", gap: 24, alignItems: "baseline", padding: "16px 28px", borderTop: HAIR_INV }, [div({ fontWeight: 700, fontSize: 17 }, esc(m.t)), div({ fontSize: 16, color: T.paperMuted, ...NUM }, esc(m.d)), div({ fontSize: 16, textAlign: "right" }, link(m.a))]),
    ),
  ])
}
function quietPanel() {
  return inverted([
    col({ gap: 8, padding: "24px 28px", borderBottom: `2px solid ${T.paper}` }, [
      h2("Nothing is due this week", 28, { color: T.paper }),
      div({ fontSize: 17, color: T.paperMuted }, "That is a checked answer, not a quiet feed. Here is what was looked at."),
    ]),
    div({ padding: "8px 28px 24px" }, spec([
      ["New filings", "Harbour Cements annual report, reviewed by you on 1 Oct. Quill Software Q2 results, 29 Sep: nothing crossed a line you set."],
      ["Review dates", "Next one: Northgate Pharma, Tuesday 14 Oct."],
      ["Position limit", `Largest holding is Meridian Bank at ${PQ.hs[0].weight.toFixed(1)}% of your 25% limit.`],
      ["Prices", "All nine holdings priced on 1 Oct."],
    ], { termW: 160, inverted: true })),
  ])
}
function C_desk(h, { quiet = false } = {}) {
  const p = quiet ? PQ : P
  return appShell({ h, content: [
    titleBlock({ primary: false }),
    quiet ? quietPanel() : duePanel(),
    figureStrip({ size: 32, p }),
    div({ display: "grid", gridTemplateColumns: "minmax(0, 1.65fr) minmax(0, 1fr)", gap: 40 }, [
      section("Holdings", holdingsLedger({ p }), { aside: link("All holdings", { style: { fontSize: 16 } }) }),
      section("Allocation by sector", allocation({ p })),
    ]),
    section("Research updates", itemList(quiet ? RESEARCH_QUIET : RESEARCH), { aside: muted("Companies you own") }),
  ] })
}
function C_phone(h) {
  return phoneShell({ h, content: [
    col({ gap: 12 }, [h1app("Long-term", { fontSize: 32 }), row({ gap: 8, flexWrap: "wrap" }, [tag("Holdings snapshot"), synthetic()]), muted(AS_OF)]),
    div({ margin: "0 -24px" }, duePanel({ phone: true })),
    figureSpec(),
    section("Holdings", holdingsLedger({ compact: true }), { aside: link("All", { style: { fontSize: 16 } }) }),
    button("Update holdings", { variant: "outline", style: { width: "100%" } }),
  ] })
}

// ---------- D · One ledger ----------
const NEEDS = {
  "Harbour Cements": { t: "Review due Fri 3 Oct", a: "FY2025 report", strong: true },
  "Quill Software": { t: "Q2 results in, 29 Sep", a: "Open" },
  "Kestrel Power": { t: "Dividend ₹3,750 expected", a: "Details" },
  "Lantern Logistics": { t: "No sector", a: "Set one" },
  "Coral Chemicals": { t: "No cost basis", a: "Add it" },
  "Tamarind Textiles": { t: "No price", a: "Add one", strong: true },
}
const LIMIT = 20
const needOf = (h) => (h.weight != null && h.weight > LIMIT ? { t: `Over your ${LIMIT}% limit`, strong: true } : NEEDS[h.name])
const needCell = (h) => {
  const n = needOf(h)
  if (!n) return `<span style="color:${T.inkMuted}">Nothing new</span>`
  return `<span style="font-weight:${n.strong ? 700 : 400}">${esc(n.t)}</span>${n.a ? ` · ${link(n.a)}` : ""}`
}
function bigLedger(port, { needs = true } = {}) {
  const sorted = [...port.hs].sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
  const max = 25
  return ledger({
    label: "Holdings",
    rowPad: "11px 16px",
    cols: [
      { label: "Company", w: "minmax(0, 1.2fr)" }, { label: "Sector", w: "150px" }, { label: "Quantity", w: "84px", align: "right" },
      { label: "Price", w: "100px", align: "right" }, { label: "Value", w: "112px", align: "right" }, { label: "Weight · mark is your 20% limit", w: "200px", align: "right" },
      ...(needs ? [{ label: "What needs you", w: "minmax(0, 1.3fr)" }] : []),
    ],
    rows: sorted.map((h) => [
      link(h.name), h.sector ? esc(shortName(h.sector)) : `<span style="color:${T.inkMuted}">Not set</span>`, qty(h.qty),
      h.price == null ? dash("No price entered") : price(h.price), h.value == null ? dash("No price entered") : inr(h.value),
      h.weight == null ? dash("No price entered") : weightBar(h.weight, max, 20),
      ...(needs ? [needCell(h)] : []),
    ]),
    total: [`${port.priced} of ${port.n} priced`, "", "", "", inr(port.known), "100.0%", ...(needs ? [`${port.hs.filter((h) => needOf(h)?.strong).length} need a decision`] : [])],
    fontSize: 16,
  })
}
const summaryLine = (port, cash) =>
  div({ fontSize: 22, lineHeight: 1.4, maxWidth: 1060, ...NUM }, `<b>${inr(port.known)}</b> in ${port.priced} of ${port.n} holdings, plus <b>${inr(cash)}</b> cash. <b>${inr(port.gain, { sign: true })}</b> unrealized on the ${port.withCost} with a known cost.`)
function D_desk(h, { port = P, needs = true, title = "Long-term" } = {}) {
  return appShell({ h, content: [
    row({ alignItems: "flex-end", gap: 24 }, [
      col({ gap: 12, flex: 1, minWidth: 0 }, [row({ gap: 16, alignItems: "center", flexWrap: "wrap" }, [h1app(title), tag("Holdings snapshot"), synthetic()]), muted(AS_OF, { fontSize: 16 })]),
      button("Update holdings"),
    ]),
    summaryLine(port, CASH),
    col({ gap: 12 }, [
      row({ gap: 12, flexWrap: "wrap" }, [button("Sort: weight", { variant: "outline", style: { fontSize: 16 } }), button("Group by sector", { variant: "outline", style: { fontSize: 16 } }), spacer(), muted(`${port.n} holdings · unknown shown as —`)]),
      bigLedger(port, { needs }),
      muted(`By sector: ${port.sectors.map((s) => `${shortName(s.label)} ${s.v.toFixed(1)}%`).join(" · ")}`, { fontSize: 16 }),
    ]),
  ] })
}
function D_phone(h) {
  const sorted = [...P.hs].sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
  return phoneShell({ h, content: [
    col({ gap: 12 }, [h1app("Long-term", { fontSize: 32 }), row({ gap: 8, flexWrap: "wrap" }, [tag("Holdings snapshot"), synthetic()]), muted(AS_OF)]),
    div({ fontSize: 18, lineHeight: 1.45, ...NUM }, `<b>${inr(P.known)}</b> in ${P.priced} of ${P.n} holdings, plus <b>${inr(CASH)}</b> cash. <b>${inr(P.gain, { sign: true })}</b> unrealized on the ${P.withCost} with a known cost.`),
    button("Update holdings", { style: { width: "100%" } }),
    el("ul", { listStyle: "none", margin: 0, padding: 0, border: `2px solid ${T.ink}` }, sorted.map((h, i) =>
      el("li", { padding: "12px 14px", borderTop: i ? `1px solid ${T.inkMuted}` : "0", display: "flex", flexDirection: "column", gap: 6 }, [
        row({ justifyContent: "space-between", gap: 12, alignItems: "baseline" }, [link(h.name, { style: { fontWeight: 700 } }), div({ ...NUM }, h.value == null ? "—" : inr(h.value))]),
        h.weight == null ? "" : weightBar(h.weight, 25, 20),
        needOf(h) ? div({ fontSize: 16 }, needCell(h)) : "",
      ]))),
    muted("Bars run to 25%; the mark is your 20% limit."),
  ] })
}
// D3: the same ledger at 24 holdings.
const EXTRA = [
  ["Ashwood Paints", 140, 2310.5, 1980, "Materials"], ["Bluegate Telecom", 1200, 88.4, 92.1, "Communication"], ["Cinder Steel", 800, 151.2, 120.0, "Materials"],
  ["Dunmore Tyres", 60, 3120.0, 2650, "Consumer disc."], ["Elmstead Retail", 350, 512.75, 498, "Consumer disc."], ["Fernhill Hotels", 1000, 74.3, 61.5, "Consumer disc."],
  ["Granite Home Finance", 220, 688.0, 702, "Financials"], ["Hollowpine Paper", 1500, 41.85, 38.0, "Materials"], ["Juniper Agro", 400, 229.4, null, "Consumer staples"],
  ["Kilnworth Ceramics", 90, 1544.0, 1310, "Industrials"], ["Marlow Engineering", 75, 2870.0, 2440, "Industrials"], ["Orchard Dairy", 500, 196.6, 181, "Consumer staples"],
  ["Pebblestone Insurance", 260, 610.2, 575, "Financials"], ["Rookwood Media", 900, 58.9, 72.4, "Communication"], ["Sablegate Ports", 300, 402.0, 355, "Industrials"],
].map(([name, q, p, c, s]) => ({ name, qty: q, price: p, cost: c, sector: s }))
const P24 = portfolio([...BASE, ...EXTRA])

// ---------- frames + canvas ----------
const DESK = 1440, PHONE = 390
const FRAMES = [
  { id: "Main.dc.html", title: "Today · /terminal after sign-in (placeholder, no overview yet)", w: DESK, h: 900, render: today, row: 0, col: 0, fixed: true },
  { id: "A1.dc.html", title: "A1 · The snapshot, as specified — desktop", w: DESK, render: A_desk, row: 1, col: 0 },
  { id: "A2.dc.html", title: "A2 · The snapshot — phone 390", w: PHONE, render: A_phone, row: 1, col: 1 },
  { id: "A3.dc.html", title: "A3 · The snapshot — empty portfolio", w: DESK, h: 900, render: A_empty, row: 1, col: 2, fixed: true },
  { id: "B1.dc.html", title: "B1 · The weekly letter — desktop", w: DESK, render: B_desk, row: 2, col: 0 },
  { id: "B2.dc.html", title: "B2 · The weekly letter — phone 390", w: PHONE, render: B_phone, row: 2, col: 1 },
  { id: "B3.dc.html", title: "B3 · The weekly letter — a quiet week (Tamarind priced, Harbour reviewed, 25% limit)", w: DESK, render: (h) => B_desk(h, { quiet: true }), row: 2, col: 2 },
  { id: "C1.dc.html", title: "C1 · Due this week — desktop", w: DESK, render: C_desk, row: 3, col: 0 },
  { id: "C2.dc.html", title: "C2 · Due this week — phone 390", w: PHONE, render: C_phone, row: 3, col: 1 },
  { id: "C3.dc.html", title: "C3 · Due this week — nothing due (Tamarind priced, Harbour reviewed, 25% limit)", w: DESK, render: (h) => C_desk(h, { quiet: true }), row: 3, col: 2 },
  { id: "D1.dc.html", title: "D1 · One ledger — desktop", w: DESK, render: D_desk, row: 4, col: 0 },
  { id: "D2.dc.html", title: "D2 · One ledger — phone 390", w: PHONE, render: D_phone, row: 4, col: 1 },
  { id: "D3.dc.html", title: "D3 · One ledger — 24 holdings", w: DESK, render: (h) => D_desk(h, { port: P24, title: "Long-term" }), row: 4, col: 2 },
]
for (const f of FRAMES) if (!f.fixed) f.h = heights[f.id] ? Math.ceil(heights[f.id].root) : f.w === PHONE ? 844 : 900

fs.mkdirSync(path.join(OUT, "project"), { recursive: true })
fs.mkdirSync(path.join(OUT, "twins"), { recursive: true })
for (const f of FRAMES) {
  const body = f.render(MEASURE && !f.fixed ? null : f.h)
  fs.writeFileSync(path.join(OUT, "project", f.id), dcHtml({ title: f.title, w: f.w, h: f.h, body }))
  fs.writeFileSync(path.join(OUT, "twins", f.id.replace(".dc.html", ".html")), twinHtml({ title: f.title, body }))
}
const sheetHtml = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#c9c9c4;font-family:system-ui}h2{font:600 14px system-ui;margin:24px 24px 8px}iframe{border:0;margin:0 24px;display:block;background:#fff}</style></head><body>${FRAMES.map((f) => `<h2>${esc(f.title)} (${f.w}×${f.h})</h2><iframe src="${f.id.replace(".dc.html", ".html")}" width="${f.w}" height="${f.h}"></iframe>`).join("")}</body></html>`
fs.writeFileSync(path.join(OUT, "twins", "sheet.html"), sheetHtml)
fs.writeFileSync(path.join(OUT, "twins", "measure.html"), `<!doctype html><html><body><script>
const F=${JSON.stringify(FRAMES.map((f) => [f.id, f.w]))};
async function measureAll(){const out={};for(const [id,w] of F){const fr=document.createElement('iframe');fr.style.cssText='width:'+w+'px;height:400px;border:0';fr.src=id.replace('.dc.html','.html');document.body.appendChild(fr);await new Promise(r=>fr.onload=r);await fr.contentDocument.fonts.ready;const root=fr.contentDocument.body.firstElementChild;root.style.height='auto';root.style.minHeight='0';out[id]={root:root.scrollHeight};fr.remove()}return out}
</script></body></html>`)

// canvas.json — one row per direction, title above, sticky to the left.
const NOTES = JSON.parse(fs.readFileSync(path.join(HERE, "notes.json"), "utf8"))
const X0 = 720
const rowsN = Math.max(...FRAMES.map((f) => f.row)) + 1
const rowH = Array.from({ length: rowsN }, (_, r) => Math.max(...FRAMES.filter((f) => f.row === r).map((f) => f.h)))
const ROW_Y = []
let y = 0
for (let r = 0; r < rowsN; r++) { ROW_Y.push(y); y += rowH[r] + 120 + 300 }
const boards = {}
for (const f of FRAMES) {
  const prevW = FRAMES.filter((g) => g.row === f.row && g.col < f.col).reduce((a, g) => a + g.w + 80, 0)
  boards[f.id] = { x: X0 + prevW, y: ROW_Y[f.row], w: f.w, h: f.h, title: f.title }
}
const notes = {}
NOTES.rows.forEach((n, i) => {
  const rowW = FRAMES.filter((f) => f.row === i).reduce((a, f) => a + f.w + 80, 0) + X0
  notes["title" + i] = { kind: "title1", text: n.title, x: 0, y: ROW_Y[i] - 260, maxW: rowW }
  notes["note" + i] = { text: n.note, x: 0, y: ROW_Y[i], w: 600, maxH: Math.min(1100, rowH[i]), size: "l", color: i === 0 ? "red" : "orange" }
})
const afterToday = X0 + DESK + 80
notes.shared = { text: NOTES.shared, x: afterToday, y: 0, w: 640, maxH: 900, size: "l", color: "green" }
notes.questions = { text: NOTES.questions, x: afterToday + 720, y: 0, w: 600, maxH: 900, size: "l", color: "blue" }
const canvas = {
  v: 3,
  createdOnFiles: { v: 1, at: "2026-10-02T10:30:00Z" },
  title: "Maester Terminal Overview",
  launch: { view: "canvas" },
  pages: [],
  boards,
  order: FRAMES.map((f) => f.id),
  notes,
  designSystems: [],
}
fs.writeFileSync(path.join(OUT, "project", "canvas.json"), JSON.stringify(canvas, null, 2))
console.log("built", FRAMES.length, "frames", MEASURE ? "(measure pass)" : "", "known", inr(P.known), "gain", inr(P.gain, { sign: true }), P.gainPct.toFixed(1) + "%", "P24", inr(P24.known))
console.log(P.hs.map((h) => `${h.name} ${h.weight?.toFixed(1)}`).join(" | "))
console.log(P.sectors.map((s) => `${s.label} ${s.v.toFixed(1)}`).join(" | "))
