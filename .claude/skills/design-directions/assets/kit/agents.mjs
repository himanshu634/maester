// node agents.mjs [--measure | agents-heights.json] → ../canvas/project/*.dc.html, canvas.json, ../canvas/twins/*
// Round 1 of the Maester Agents canvas (2026-10-15): the screen that explains and shows how the
// agents will work (docs/superpowers/specs/2026-10-15-agents-design.md). Today + A/B/C/D.
// Every figure is synthetic and consistent with financials.mjs (Synthetic Cements Limited).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { T, FONT, NUM, esc, el, div, row, col, muted, spacer, h2, button, link, tag, spec } from "./lib.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, "..", "canvas")
const HEIGHTS = process.argv[2] && fs.existsSync(process.argv[2]) ? JSON.parse(fs.readFileSync(process.argv[2], "utf8")) : {}
const FONTS = "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&amp;family=Caveat:wght@400..700&amp;display=swap"
const HAND = "'Caveat', 'Bradley Hand', cursive"

// ---------- type ----------
const appH1 = (t, size = 40, style = {}) =>
  el("h1", { margin: 0, fontStretch: "125%", fontWeight: 800, fontSize: size, lineHeight: 1.1, letterSpacing: "-0.02em", ...style }, esc(t))
const body = (t, style = {}) => el("p", { margin: 0, fontSize: 17, lineHeight: 1.5, maxWidth: 640, ...style }, esc(t))
const note = (t, style = {}) => el("p", { margin: 0, fontSize: 14, lineHeight: 1.45, color: T.inkMuted, ...style }, esc(t))
const strong = (t, style = {}) => el("p", { margin: 0, fontSize: 17, lineHeight: 1.5, fontWeight: 700, ...style }, esc(t))
const aLink = (t, style = {}) => link(t, { style: { fontSize: 17, ...style } })
const synth = () => tag("Synthetic example", { style: { color: T.ink } })
const h3 = (t, style = {}) => el("h3", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: 22, lineHeight: 1.2, ...style }, esc(t))

// ---------- terminal shell (TerminalShell.svelte + lib/terminal/pages.ts, 13 Oct 2026) ----------
const ACCOUNT = "asha@example.com"
const GROUPS = [
  ["Overview", "Holdings", "Market mood"],
  ["Research", "Watchlist", "Documents", "Analyst"],
]
const FOOT = ["Activity", "Settings"]
const LIVE = new Set(["Market mood", "Research", "Documents", "Settings"])

function navItem(label, { current, soon }) {
  const base = { display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 44, padding: "0 12px", margin: "0 -12px", fontSize: 17, textDecoration: "none", gap: 8 }
  const style = current ? { ...base, fontWeight: 700, color: T.paper, background: T.ink } : { ...base, color: T.ink }
  const lab = el("span", current ? {} : { textDecoration: "underline", textUnderlineOffset: "3px", textDecorationThickness: "1.5px" }, esc(label))
  const kids = [lab]
  if (soon) kids.push(el("span", { fontSize: 14, color: current ? T.paperMuted : T.inkMuted }, "Soon"))
  return el("a", style, kids, { href: "#", ...(current ? { "aria-current": "page" } : {}) })
}
function railNav({ active, research = false }) {
  const live = (l) => LIVE.has(l) || (research && l === "Research")
  const items = (labels) => labels.map((l) => navItem(l, { current: l === active, soon: !live(l) }))
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
const context = () =>
  row({ minHeight: 56, padding: "8px 24px", gap: 16, borderBottom: `2px solid ${T.ink}`, flexShrink: 0, boxSizing: "border-box", justifyContent: "space-between" }, [div({ fontWeight: 700, fontSize: 16 }, "Personal"), synth()])

function appPage({ w = 1440, h = 900, active, research = false, content, mainStyle = {} }) {
  return div({ display: "flex", flexDirection: "row", alignItems: "stretch", width: w, height: h ?? "auto", minHeight: 900, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper, boxSizing: "border-box" }, [
    railNav({ active, research }),
    col({ flex: 1, minWidth: 0 }, [
      context(),
      el("main", { display: "flex", flexDirection: "column", padding: "32px 24px 48px", gap: 28, minWidth: 0, ...mainStyle }, content),
    ]),
  ])
}
function appPhone({ w = 390, h = 844, content }) {
  return div({ display: "flex", flexDirection: "column", width: w, height: h ?? "auto", minHeight: 844, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper, boxSizing: "border-box" }, [
    row({ height: 56, padding: "0 16px 0 24px", borderBottom: `2px solid ${T.ink}`, flexShrink: 0, justifyContent: "space-between", boxSizing: "border-box" }, [
      el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink }, "Maester", { href: "#" }),
      button("Menu", { variant: "outline", style: { padding: "0 16px", fontSize: 16 } }),
    ]),
    context(),
    el("main", { display: "flex", flexDirection: "column", padding: "24px 24px 40px", gap: 24, minWidth: 0 }, content),
  ])
}

// ---------- the synthetic company: Synthetic Cements Limited, ₹ crore ----------
// Consolidated profit and loss, oldest year first. Each year comes whole from the newest filing
// that prints it: 2025–26 and 2024–25 from AR 2025–26 (page 213), 2023–24 from AR 2024–25
// (page 198), 2022–23 from AR 2023–24 (page 187). AR 2024–25 had printed 2,389.10 for freight
const BASE_CSS = `body{margin:0;background:${T.paper};font-family:${FONT}}button{font-family:inherit;margin:0}a{color:inherit}h1,h2,h3,p,dl,dd,figure,ol{margin:0}a:hover{background:#000000;color:#EDEDE8;text-decoration:none}button:focus-visible,a:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:3px solid #000000;outline-offset:2px}`
function dcHtml({ title, w, h, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="${FONTS}">
<style>
${BASE_CSS}
</style>
</helmet>
${body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'>
class Component extends DCLogic {
renderVals() {
return {};
}
}
</script>
</body>
</html>
`
}
const twinHtml = ({ title, body }) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="${FONTS}"><style>${BASE_CSS}</style></head><body>${body}</body></html>`

// ---------- frames ----------

// ---------- shared content ----------
const CO = "Synthetic Cements Limited"
const RUN = "Weekly review · Monday 12 October"
const CUTOFF = "Evidence up to the close on Friday 9 October"
const cite = (t, style = {}) => el("p", { margin: 0, fontSize: 14, lineHeight: 1.45, color: T.inkMuted, ...NUM, ...style }, esc(t))
const kicker = (t, style = {}) => div({ fontSize: 14, lineHeight: 1.45, color: T.inkMuted, ...style }, esc(t))
// A claim: the sentence, then where every number in it came from.
const claim = (t, src) => col({ gap: 2, padding: "12px 0", borderTop: `1px solid ${T.inkMuted}` }, [el("p", { margin: 0, fontSize: 16, lineHeight: 1.45, ...NUM }, esc(t)), cite(src)])

const ANALYST = [
  ["Revenue grew 7.7% to ₹12,105.40 crore in 2025–26.", "Revenue growth, from AR 2025–26 page 213"],
  ["Profit grew 27.5% to ₹1,459.00 crore, so the net margin rose to 12.1% from 10.2%.", "Profit growth and net margin, from page 213"],
  ["Trade receivables grew 24.1% to ₹1,862.40 crore, three times as fast as revenue.", "Change in trade receivables, from page 211"],
  ["Cash from operations was 0.86 of profit, down from 1.12.", "Cash conversion, from pages 213 and 217"],
  ["Borrowings are 0.42 of equity.", "Debt to equity, from page 211"],
]
const PRICE = [
  ["Closed at ₹1,284.50, 18.4% above a year earlier, near the top of the year’s range (₹1,012.30 to ₹1,318.00).", "Dhan, NSE close, Friday 9 October"],
  ["Price to earnings 21.0, against a two-year median of 17.4.", "Price to earnings: the close ÷ basic EPS ₹61.20, page 213"],
]
const BULL = [
  ["Profit grew three times as fast as revenue, and the margin gain came from the lines, not from other income.", "Net margin 12.1% from 10.2%, page 213"],
  ["Borrowings are low enough that a bad year is survivable.", "Debt to equity 0.42, page 211"],
]
const BEAR = [
  ["Customers are paying later. Receivables grew 24.1% against revenue’s 7.7%.", "Pages 211 and 213"],
  ["Less of the profit arrived as cash: 0.86 of profit, down from 1.12.", "Cash conversion, pages 213 and 217"],
  ["The share already prices this in: 21.0 times earnings against its usual 17.4.", "Price to earnings, page 213 and Dhan"],
]
const CHECKS = [
  ["Weight in your portfolio", "9.4%", "Your limit 10%", "Within"],
  ["Cement, as a sector", "18.2%", "Your limit 25%", "Within"],
  ["Days of trading to sell it all", "0.3", "Your limit 5", "Within"],
  ["Results due", "Wed 21 Oct", "Within 10 days", "Flag"],
  ["Your exit level", "₹1,050.00", "Close ₹1,284.50", "Within"],
]

// The six steps of a review, in order. "who" says model or code in investor words.
const STEPS = [
  { n: 1, name: "Read the filings", who: "Filings analyst", how: "Writes", reads: "Your filings’ figures and Maester’s calculations", writes: "What changed in the business, and what looks wrong", never: "Works out a figure itself or estimates a fair value" },
  { n: 2, name: "Read the price", who: "Price analyst", how: "Writes", reads: "Your Dhan closes", writes: "Where the share stands against its own last two years", never: "Predicts a price" },
  { n: 3, name: "Argue both sides", who: "Bull and bear", how: "Write", reads: "Only what steps 1 and 2 cited", writes: "The strongest case for, and the strongest case against", never: "Brings in a figure nobody cited" },
  { n: 4, name: "Weigh them", who: "Reviewer", how: "Writes", reads: "Both cases, your thesis and the market mood", writes: "Which case is stronger, and what would change that", never: "Tells you to buy or sell" },
  { n: 5, name: "Check your limits", who: "Limits", how: "Rules you set", reads: "Your holdings and your limits", writes: "Within or over, for each limit", never: "Adds risk. It can only make a review stricter." },
  { n: 6, name: "Your call", who: "You", how: "", reads: "All of the above", writes: "What you decided, and why", never: "Maester never places an order" },
]

// ---------- the lamp (LampSketch, simplified: ink only) ----------
function lampSketch({ w = 380 } = {}) {
  const h = Math.round(w * 0.8)
  return el("figure", { margin: 0, width: w, flexShrink: 0 }, `<svg width="${w}" height="${h}" viewBox="0 0 380 304" role="img" aria-label="A desk lamp beside an empty chair"><g fill="none" stroke="${T.ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<path d="M40 280 H340"/><path d="M70 280 L110 280 L96 268 L84 268 Z"/><path d="M90 268 L130 150 L190 100"/><path d="M175 85 L230 120 L205 140 Z"/><path d="M222 126 L222 190"/><circle cx="222" cy="196" r="5"/>
<path d="M250 280 V190 H310 V280"/><path d="M250 230 H310"/><path d="M310 190 V130"/></g>
<text x="232" y="56" font-family="${HAND}" font-size="28" fill="${T.ink}">pull the cord</text></svg>`)
}

// ---------- Today ----------
function T1() {
  return appPage({ active: "Analyst", content: [
    row({ gap: 48, alignItems: "flex-start" }, [
      col({ gap: 16, maxWidth: 560, paddingTop: 8 }, [
        row({ gap: 16, alignItems: "center" }, [appH1("Analyst"), tag("Coming soon")]),
        body("Ask about a company you own and get an answer that shows its working and the page behind every figure."),
        body("It answers from your filings, so it starts once they are read.", { color: T.inkMuted }),
      ]),
      lampSketch(),
    ]),
  ] })
}

// ---------- A · The desk, drawn ----------
function stepRows({ phone = false, status = true } = {}) {
  return el("ol", { listStyle: "none", margin: 0, padding: 0, borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, STEPS.map((s, i) => {
    const you = s.n === 6
    const head = col({ gap: 4 }, [
      row({ gap: 12, alignItems: "baseline" }, [div({ fontSize: 16, color: you ? T.paperMuted : T.inkMuted, ...NUM, width: 20, flexShrink: 0 }, String(s.n)), h3(s.name)]),
      div({ fontSize: 16, paddingLeft: 32, color: you ? T.paperMuted : T.inkMuted }, esc(s.who + (s.how ? " · " + s.how.toLowerCase() : ""))),
    ])
    const facts = spec([["Reads", esc(s.reads)], ["Writes", esc(s.writes)], ["Never", esc(s.never)]], { termW: phone ? 64 : 80, inverted: you })
    const st = status ? div({ fontSize: 14, color: you ? T.paperMuted : T.inkMuted, paddingLeft: phone ? 32 : 0 }, s.n === 5 ? "Needs Holdings" : you ? "Today: you" : "Not built yet") : ""
    const cell = phone
      ? col({ gap: 12, padding: "16px 0" }, [head, div({ paddingLeft: 32 }, facts), st])
      : div({ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr) 140px", gap: 24, padding: "20px 0", alignItems: "start" }, [head, facts, st])
    return el("li", { borderTop: i ? `1px solid ${T.inkMuted}` : 0, ...(you ? { background: T.ink, color: T.paper, padding: "0 16px", margin: "0 -16px" } : {}) }, cell)
  }))
}
const A_INTRO = "Each week, and whenever a filing is read, a small desk reviews each company you own. Five of them write; the limits are rules you set. You make the call."
function A1() {
  return appPage({ active: "Analyst", content: [
    col({ gap: 12 }, [row({ gap: 16 }, [appH1("Analyst"), tag("Coming soon")]), body(A_INTRO)]),
    col({ gap: 12, border: `2px solid ${T.ink}`, padding: 20, maxWidth: 880 }, [
      strong("What runs today"),
      body("Your filings are read and every sum is checked. Each figure Maester shows comes from the page or from a named calculation, never from a guess. The desk will read only those figures."),
    ]),
    col({ gap: 16 }, [h2("How a review will run", 22), stepRows()]),
    col({ gap: 8, maxWidth: 760 }, [h2("Every number has a source", 22), body("A writer may only repeat a figure Maester read or calculated, with its page. A sentence with any other number is refused before you see it.")]),
  ] })
}
function A2() {
  return appPhone({ content: [
    col({ gap: 12 }, [appH1("Analyst", 32), tag("Coming soon", { style: { alignSelf: "flex-start" } }), body(A_INTRO)]),
    col({ gap: 8, border: `2px solid ${T.ink}`, padding: 16 }, [strong("What runs today"), body("Your filings are read and every sum is checked. The desk will read only those figures.", { fontSize: 16 })]),
    col({ gap: 12 }, [h2("How a review will run", 22), stepRows({ phone: true })]),
  ] })
}

// ---------- B · One review, traced ----------
function ladder(states, { phone = false } = {}) {
  const names = ["Read", "Argue", "Weigh", "Limits", "Your call"]
  return el("ol", { listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: phone ? "1fr" : "repeat(5, minmax(0, 1fr))", borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, names.map((n, i) => {
    const now = states[i] === "Now" || states[i] === "Needs you"
    return el("li", { display: "flex", flexDirection: phone ? "row" : "column", gap: phone ? 12 : 2, padding: phone ? "8px 12px" : "10px 12px", ...(phone ? { borderTop: i ? `1px solid ${T.inkMuted}` : 0, alignItems: "baseline" } : { borderLeft: i ? `1px solid ${T.inkMuted}` : 0 }), ...(now ? { background: T.ink, color: T.paper } : {}) }, [
      div({ fontSize: 14, ...NUM, color: now ? T.paperMuted : T.inkMuted }, String(i + 1)),
      div({ fontSize: 16, fontWeight: 700, flex: phone ? 1 : "none" }, esc(n)),
      div({ fontSize: 14, color: now ? T.paperMuted : T.inkMuted, fontWeight: states[i] === "Stopped" ? 700 : 400 }, esc(states[i])),
    ])
  }))
}
const verdict = ({ phone = false, stance = "Look closer", why, cond }) =>
  col({ gap: 12, background: T.ink, color: T.paper, padding: phone ? 20 : 28, ...(phone ? { margin: "0 -24px" } : {}) }, [
    div({ fontSize: 14, color: T.paperMuted }, "The reviewer"),
    el("p", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: phone ? 28 : 36, lineHeight: 1.1, letterSpacing: "-0.02em" }, esc(stance)),
    el("p", { margin: 0, fontSize: 17, lineHeight: 1.5, maxWidth: 720 }, esc(why)),
    div({ borderTop: `1px solid ${T.paper}`, paddingTop: 12 }, [div({ fontSize: 14, color: T.paperMuted }, "What would change this"), el("p", { margin: 0, fontSize: 17, lineHeight: 1.5, maxWidth: 720, ...NUM }, esc(cond))]),
  ])
const WHY = "The bear case is stronger. The profit is on the page, but less of it arrived as cash, and customers are paying later. The price already assumes it will."
const COND = "If cash from operations is below 0.8 of profit again in the 2026–27 results, the bear case holds. If receivables grow no faster than revenue, the bull case does."
const caseCol = (title, items, sub) => col({ gap: 0, flex: 1, minWidth: 0 }, [col({ gap: 2, paddingBottom: 12 }, [h3(title), kicker(sub)]), ...items.map(([t, s]) => claim(t, s))])
function checksLedger({ phone = false, rows = CHECKS } = {}) {
  if (phone) return el("dl", { margin: 0, borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, rows.map(([n, v, lim, st], i) =>
    div({ padding: "10px 0", borderTop: i ? `1px solid ${T.inkMuted}` : 0 }, [row({ justifyContent: "space-between", gap: 12, alignItems: "baseline" }, [el("dt", { fontSize: 16, fontWeight: 700 }, esc(n)), el("dd", { margin: 0, fontSize: 16, fontWeight: st === "Within" ? 400 : 700 }, esc(st))]), el("dd", { margin: 0, fontSize: 14, color: T.inkMuted, ...NUM }, esc(`${v} · ${lim}`))])))
  return ledger({ label: "Your limits", cols: [{ label: "Limit", w: "minmax(0, 1.6fr)" }, { label: "Now", w: "120px", align: "right" }, { label: "Against", w: "minmax(0, 1fr)" }, { label: "", w: "90px" }], rows: rows.map(([n, v, lim, st]) => [esc(n), esc(v), esc(lim), st === "Within" ? esc(st) : `<b>${esc(st)}</b>`]) })
}
function ledger({ cols, rows, label }) {
  const tracks = cols.map((c) => c.w).join(" ")
  const cell = (h, c) => div({ textAlign: c.align || "left", minWidth: 0, ...(c.align === "right" ? NUM : {}) }, h)
  return div({ border: `2px solid ${T.ink}` }, [
    div({ display: "grid", gridTemplateColumns: tracks, gap: 16, padding: "10px 16px", borderBottom: `2px solid ${T.ink}`, fontSize: 14, color: T.inkMuted }, cols.map((c) => cell(esc(c.label), c))),
    ...rows.map((r, i) => div({ display: "grid", gridTemplateColumns: tracks, gap: 16, padding: "12px 16px", fontSize: 16, lineHeight: 1.45, borderTop: i ? `1px solid ${T.inkMuted}` : 0 }, r.map((h, j) => cell(h, cols[j])))),
  ], { role: "table", "aria-label": label })
}
const yourCall = ({ phone = false } = {}) => col({ gap: 12, borderTop: `2px solid ${T.ink}`, paddingTop: 20 }, [
  h2("Your call", 22),
  body("Maester doesn’t decide and never places an order. Write down what you’ll do and why; the next review starts from it."),
  row({ gap: 12, flexWrap: "wrap" }, [button("Note your call", phone ? { style: { width: "100%" } } : {}), ...(phone ? [] : [button("Run it again", { variant: "outline" })])]),
])
const runHead = ({ phone = false } = {}) => col({ gap: 8 }, [
  phone ? col({ gap: 8, alignItems: "flex-start" }, [appH1(CO, 28), synth()]) : row({ gap: 16 }, [appH1(CO), synth()]),
  body(`${RUN}. ${CUTOFF}.`, { color: T.inkMuted, fontSize: 16 }),
])
function B1() {
  return appPage({ active: "Analyst", content: [
    runHead(),
    ladder(["Done", "Done", "Done", "Done", "Needs you"]),
    verdict({ why: WHY, cond: COND }),
    col({ gap: 16 }, [h2("The two cases", 22), row({ gap: 40, alignItems: "flex-start" }, [caseCol("For", BULL, "The bull, from the analysts’ notes"), div({ width: 2, alignSelf: "stretch", background: T.ink }), caseCol("Against", BEAR, "The bear, from the same notes")])]),
    col({ gap: 16 }, [h2("Your limits", 22), checksLedger(), note("Results are due within 10 days, so the review says so. A limit can make a review stricter, never looser.")]),
    col({ gap: 16 }, [h2("What the analysts read", 22), row({ gap: 40, alignItems: "flex-start" }, [caseCol("The filings", ANALYST, "Filings analyst · 5 claims, 5 sources"), caseCol("The price", PRICE, "Price analyst · 2 claims, 2 sources")])]),
    yourCall(),
  ] })
}
function B2() {
  return appPhone({ content: [
    runHead({ phone: true }),
    ladder(["Done", "Done", "Done", "Done", "Needs you"], { phone: true }),
    verdict({ phone: true, why: WHY, cond: COND }),
    col({ gap: 12 }, [h2("Against", 22), kicker("The bear, from the analysts’ notes"), ...BEAR.map(([t, s]) => claim(t, s))]),
    col({ gap: 12 }, [h2("For", 22), kicker("The bull, from the same notes"), ...BULL.map(([t, s]) => claim(t, s))]),
    col({ gap: 12 }, [h2("Your limits", 22), checksLedger({ phone: true })]),
    link("What the analysts read (7 claims)", { style: { fontSize: 17 } }),
    yourCall({ phone: true }),
  ] })
}
function B3() {
  const over = [["Weight in your portfolio", "11.2%", "Your limit 10%", "Over"], ...CHECKS.slice(1, 3)]
  return appPage({ active: "Analyst", content: [
    runHead(),
    ladder(["Done", "Done", "Done", "Done", "Needs you"]),
    col({ gap: 12, background: T.ink, color: T.paper, padding: 28 }, [
      div({ fontSize: 14, color: T.paperMuted }, "The reviewer said “No change”. Your limits changed it to"),
      el("p", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: 36, lineHeight: 1.1, letterSpacing: "-0.02em" }, "Review your position"),
      el("p", { margin: 0, fontSize: 17, lineHeight: 1.5, maxWidth: 720, ...NUM }, "Synthetic Cements is 11.2% of your portfolio, over your 10% limit. The reviewer found the two cases even; a limit you set outranks that."),
      row({ gap: 12, borderTop: `1px solid ${T.paper}`, paddingTop: 16 }, [button("Note your call", { inverted: true }), button("Change your limit", { variant: "outline", inverted: true })]),
    ]),
    col({ gap: 16 }, [h2("Your limits", 22), checksLedger({ rows: over })]),
    col({ gap: 16, border: `2px solid ${T.ink}`, padding: 20, maxWidth: 880 }, [
      strong("Last week’s review stopped at Argue."),
      body("The bear case gave a figure no analyst had cited (“margins of 14%”). Maester refused it, tried once more, and stopped rather than show you a case it couldn’t source."),
      button("Try again", { variant: "outline", style: { alignSelf: "flex-start" } }),
    ]),
    note("A review that stops says where. It never shows half a review as a whole one."),
  ] })
}

// ---------- C · The rulebook ----------
const ROSTER = [
  ["Filings analyst", "Writes", "Your filings’ figures, Maester’s calculations", "Works out a figure itself", "With the first filings"],
  ["Price analyst", "Writes", "Your Dhan closes", "Predicts a price", "Later"],
  ["Bull, bear", "Write", "Only what the analysts cited", "Brings in a new figure", "Second"],
  ["Reviewer", "Writes", "Both cases, your thesis, the mood", "Says buy or sell", "Second"],
  ["Limits", "Rules you set", "Your holdings and limits", "Makes a review looser", "With Holdings"],
]
const NEVER = [
  ["Place an order", "No writer and no rule can trade. Maester has no way to reach your broker."],
  ["Make up a number", "Every figure is read from a filing or worked out by a named calculation. A sentence with any other number is refused."],
  ["Say how sure it is", "No confidence scores and no percentages of certainty. You get the sources instead."],
  ["See the future", "Each review fixes the moment it reads up to. Nothing filed or priced later can reach it."],
  ["Overrule you", "Your limits can make a review stricter. Only you can loosen one, and Maester records why."],
]
function annotatedClaim({ phone = false } = {}) {
  return col({ gap: 0, border: `2px solid ${T.ink}` }, [
    div({ padding: "12px 16px", borderBottom: `2px solid ${T.ink}`, fontSize: 14, color: T.inkMuted }, "One sentence from a bear case, and what stands behind it"),
    el("p", { margin: 0, padding: "16px", fontSize: phone ? 18 : 22, lineHeight: 1.4, fontWeight: 700, ...NUM }, "Customers are paying later. Receivables grew <span style=\"text-decoration: underline; text-underline-offset: 4px; text-decoration-thickness: 2px\">24.1%</span> against revenue’s <span style=\"text-decoration: underline; text-underline-offset: 4px; text-decoration-thickness: 2px\">7.7%</span>."),
    div({ padding: "0 16px 16px" }, spec([
      ["24.1%", "Change in trade receivables, ₹1,500.70 crore to ₹1,862.40 crore. AR 2025–26, page 211. Read twice, both readings agree."],
      ["7.7%", "Revenue growth, ₹11,240.75 crore to ₹12,105.40 crore. AR 2025–26, page 213."],
      ["Checked", "Both numbers match their sources as shown. Done by Maester before the bear case reached you."],
    ], { termW: phone ? 72 : 96 })),
  ])
}
function C1() {
  return appPage({ active: "Analyst", content: [
    col({ gap: 12 }, [row({ gap: 16 }, [appH1("Analyst"), tag("Coming soon")]), body("A small desk will review each company you own: two analysts read, a bull and a bear argue, a reviewer weighs them, and your limits have the last word before you do.")]),
    col({ gap: 16 }, [h2("What it will never do", 22), spec(NEVER.map(([a, b]) => [a, esc(b)]), { termW: 220 })]),
    col({ gap: 16 }, [h2("Who is on the desk", 22), ledger({ label: "The desk", cols: [{ label: "Role", w: "180px" }, { label: "Does", w: "140px" }, { label: "Reads", w: "minmax(0, 1.3fr)" }, { label: "Never", w: "minmax(0, 1fr)" }, { label: "Arrives", w: "160px" }], rows: ROSTER.map((r) => r.map((c, i) => i === 0 ? `<b>${esc(c)}</b>` : esc(c))) })]),
    col({ gap: 16, maxWidth: 880 }, [h2("How you can check it", 22), annotatedClaim()]),
  ] })
}
function C2() {
  return appPhone({ content: [
    col({ gap: 12 }, [appH1("Analyst", 32), tag("Coming soon", { style: { alignSelf: "flex-start" } }), body("A small desk will review each company you own. Your limits have the last word before you do.")]),
    col({ gap: 12 }, [h2("What it will never do", 22), spec(NEVER.map(([a, b]) => [a, esc(b)]), { termW: 96 })]),
    col({ gap: 12 }, [h2("How you can check it", 22), annotatedClaim({ phone: true })]),
  ] })
}

// ---------- D · Where it lands ----------
function duePanel() {
  const r = (t, d) => col({ gap: 2, padding: "12px 0", borderTop: `1px solid ${T.paper}` }, [div({ fontSize: 17, fontWeight: 700 }, esc(t)), div({ fontSize: 14, color: T.paperMuted, ...NUM }, esc(d))])
  return col({ background: T.ink, color: T.paper, padding: 28, gap: 16 }, [
    col({ gap: 4, borderBottom: `2px solid ${T.paper}`, paddingBottom: 16 }, [el("h2", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: 28, lineHeight: 1.1 }, "Due this week"), div({ fontSize: 16, color: T.paperMuted }, "3 items. Decisions first, then data to fix.")]),
    col({ gap: 12 }, [
      el("h3", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: 26, lineHeight: 1.2 }, "Synthetic Cements: the desk says look closer"),
      spec([
        ["Trigger", "The weekly review, with results due Wed 21 Oct"],
        ["Evidence", "Receivables grew 24.1% against revenue’s 7.7% (pages 211, 213). Cash from operations was 0.86 of profit, down from 1.12 (pages 213, 217)."],
        ["Your call", "The bear case is stronger. Read both cases, then note what you’ll do."],
      ].map(([a, b]) => [a, esc(b)]), { termW: 120, inverted: true }),
      row({ gap: 12 }, [button("Read both cases", { inverted: true }), button("Move to next week", { variant: "outline", inverted: true })]),
    ]),
    r("Kestrel Paints: review due", "You set a review for 15 Oct · 6.1% of your portfolio"),
    r("Harbour Logistics: no price", "Not a Nifty 500 share · 3.0% of your portfolio"),
  ])
}
function D1() {
  return appPage({ active: "Overview", content: [
    col({ gap: 8 }, [row({ gap: 16 }, [appH1("Long-term"), tag("Holdings snapshot"), synth()]), note("As of Friday 9 October. Read-only: Maester never trades.")]),
    duePanel(),
    note("The desk reviews each holding weekly and when a filing is read. A review appears here only when it says more than “no change”; the rest are in Analyst."),
  ] })
}
function D2() {
  return appPage({ active: "Analyst", content: [
    link("← Back to Overview", { style: { fontSize: 16, alignSelf: "flex-start" } }),
    runHead(),
    row({ gap: 40, alignItems: "flex-start" }, [
      col({ gap: 20, flex: 1.6, minWidth: 0 }, [
        verdict({ why: WHY, cond: COND }),
        col({ gap: 16 }, [h2("The two cases", 22), row({ gap: 32, alignItems: "flex-start" }, [caseCol("For", BULL, "The bull"), caseCol("Against", BEAR, "The bear")])]),
      ]),
      col({ gap: 16, flex: 1, minWidth: 0 }, [h2("Earlier reviews", 22), div({ borderBottom: `2px solid ${T.ink}` }, [
        ["Mon 12 Oct", "Look closer", "This one"],
        ["Mon 5 Oct", "No change", ""],
        ["Mon 28 Sep", "No change", ""],
        ["Thu 24 Sep", "Look closer", "Annual report read"],
      ].map(([d, s, w], i) => div({ display: "grid", gridTemplateColumns: "110px minmax(0, 1fr)", gap: 12, padding: "12px 0", borderTop: `1px solid ${T.inkMuted}`, fontSize: 16 }, [div({ ...NUM }, esc(d)), col({}, [i ? link(s) : el("b", {}, esc(s)), w ? div({ fontSize: 14, color: T.inkMuted }, esc(w)) : ""])])))]),
    ]),
  ] })
}

// ---------- frames ----------
const D = 1440, P = 390
const FRAMES = [
  { id: "Main.dc.html", title: "Today · Analyst is a coming-soon page with a lamp", w: D, h: 900, render: T1, row: 0 },
  { id: "A1.dc.html", title: "A1 · The desk, drawn — the six steps, what runs today first", w: D, h: 900, render: A1, row: 1 },
  { id: "A2.dc.html", title: "A2 · The desk, drawn — phone 390", w: P, h: 844, render: A2, row: 1, phone: true },
  { id: "B1.dc.html", title: "B1 · One review, traced — a whole review, verdict first", w: D, h: 900, render: B1, row: 2 },
  { id: "B2.dc.html", title: "B2 · One review, traced — phone 390, the case against first", w: P, h: 844, render: B2, row: 2, phone: true },
  { id: "B3.dc.html", title: "B3 · One review, traced — a limit overrules the reviewer; a case refused", w: D, h: 900, render: B3, row: 2 },
  { id: "C1.dc.html", title: "C1 · The rulebook — what it never does, who is on the desk, one claim opened", w: D, h: 900, render: C1, row: 3 },
  { id: "C2.dc.html", title: "C2 · The rulebook — phone 390", w: P, h: 844, render: C2, row: 3, phone: true },
  { id: "D1.dc.html", title: "D1 · Where it lands — a review arrives in Overview’s due panel", w: D, h: 900, render: D1, row: 4 },
  { id: "D2.dc.html", title: "D2 · Where it lands — Read both cases opens the review, with earlier ones", w: D, h: 900, render: D2, row: 4 },
]
for (const f of FRAMES) {
  const m = HEIGHTS[f.id]
  if (m) f.h = Math.max(f.phone ? 844 : 900, m.content)
}
fs.mkdirSync(path.join(OUT, "project"), { recursive: true })
fs.mkdirSync(path.join(OUT, "twins"), { recursive: true })
for (const p of fs.readdirSync(path.join(OUT, "project"))) fs.rmSync(path.join(OUT, "project", p))
for (const p of fs.readdirSync(path.join(OUT, "twins"))) fs.rmSync(path.join(OUT, "twins", p))
const measuring = process.argv.includes("--measure")
for (const f of FRAMES) {
  const b = f.render()
  const sized = b.replace(/height: (auto|900px|844px)/, `height: ${f.h}px`)
  const twin = measuring ? b.replace(/height: (900px|844px)/, "height: auto") : sized
  fs.writeFileSync(path.join(OUT, "project", f.id), dcHtml({ title: f.title, w: f.w, h: f.h, body: sized }))
  fs.writeFileSync(path.join(OUT, "twins", f.id.replace(".dc.html", ".html")), twinHtml({ title: f.title, body: twin }))
}
fs.writeFileSync(path.join(OUT, "twins", "sheet.html"), `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#c9c9c4;font-family:system-ui}h2{font:600 14px system-ui;margin:24px 24px 8px}iframe{border:0;margin:0 24px;display:block;background:#fff}</style></head><body>${FRAMES.map((f) => `<h2>${esc(f.title)} (${f.w}×${f.h})</h2><iframe src="${f.id.replace(".dc.html", ".html")}" width="${f.w}" height="${f.h}"></iframe>`).join("")}</body></html>`)
fs.writeFileSync(path.join(OUT, "twins", "measure.html"), `<!doctype html><html><body><script>
const F=${JSON.stringify(FRAMES.map((f) => [f.id, f.w]))};
async function measureAll(){const out={};for(const [id,w] of F){const fr=document.createElement('iframe');fr.style.cssText='width:'+w+'px;height:400px;border:0';fr.src=id.replace('.dc.html','.html');document.body.appendChild(fr);await new Promise(r=>fr.onload=r);await fr.contentDocument.fonts.ready;await new Promise(r=>setTimeout(r,150));const root=fr.contentDocument.body.firstElementChild;const kids=[...root.querySelectorAll('*')];const bottom=Math.max(...kids.map(k=>k.getBoundingClientRect().bottom));out[id]={frame:root.offsetHeight,content:Math.ceil(bottom)};fr.remove()}return out}
</script></body></html>`)

// ---------- canvas.json ----------
const NOTES = JSON.parse(fs.readFileSync(path.join(HERE, "agents-notes.json"), "utf8"))
const X0 = 720
const boards = {}
const notes = {}
const rows = [...new Set(FRAMES.map((f) => f.row))].sort((a, b) => a - b)
const rowH = Object.fromEntries(rows.map((r) => [r, Math.max(...FRAMES.filter((f) => f.row === r).map((f) => f.h))]))
const rowY = {}
let y = 0
for (const r of rows) { rowY[r] = y; y += rowH[r] + 420 }
const colX = {}
for (const f of FRAMES) {
  const x = colX[f.row] ?? X0
  boards[f.id] = { x, y: rowY[f.row], w: f.w, h: f.h, title: f.title, page: "round1" }
  colX[f.row] = x + f.w + 80
}
NOTES.rows.forEach((n, i) => {
  const r = rows[i]
  notes[`r1Title${i}`] = { kind: "title1", text: n.title, x: 0, y: rowY[r] - 260, maxW: colX[r], page: "round1" }
  notes[`r1Note${i}`] = { text: n.note, x: 0, y: rowY[r], w: 600, maxH: Math.min(1600, rowH[r]), size: "l", color: i === 0 ? "red" : "orange", page: "round1" }
})
const right = Math.max(...Object.values(colX))
notes.r1Questions = { text: NOTES.questions, x: right + 80, y: 0, w: 700, maxH: 900, size: "l", color: "blue", page: "round1" }
notes.r1Shared = { text: NOTES.shared, x: right + 80, y: rowY[1], w: 700, maxH: 1400, size: "m", color: "green", page: "round1" }
const canvas = {
  v: 3,
  createdOnFiles: { v: 1, at: "2026-10-15T10:00:00Z" },
  title: "Maester Agents",
  launch: { view: "canvas", page: "round1" },
  pages: [{ id: "round1", name: "Round 1" }],
  boards,
  order: FRAMES.map((f) => f.id),
  notes,
  designSystems: [],
}
fs.writeFileSync(path.join(OUT, "project", "canvas.json"), JSON.stringify(canvas, null, 2))
console.log("built", FRAMES.length, "frames", FRAMES.map((f) => f.id + ":" + f.h).join(" "))
