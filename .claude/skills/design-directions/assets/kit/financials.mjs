// node financials.mjs [financials-heights.json] → ../canvas/project/*.dc.html, canvas.json, ../canvas/twins/*
// Round 1 of the Maester Financial Tables canvas (2026-10-13): a company's statements from
// extracted facts, and the way from a figure to the PDF page it came from (F06/F07).
// Today + A/B/C/D. Every figure is synthetic and internally consistent: columns add up.
// The evidence each frame shows is only what the API holds per fact (packages/contracts
// extraction.ts): label and value as printed, unit, period, basis, pageIndex, textLayerMatch,
// and the subtotal/balance checks. No quote and no position on the page.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { T, ILLUS, FONT, NUM, esc, el, div, row, col, muted, spacer, h2, button, link, tag, spec } from "./lib.mjs"

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
const LIVE = new Set(["Market mood", "Documents", "Settings"])

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
// and 1,360.95 for other expenses in 2024–25; AR 2025–26 moved 12.50 between them (restated).
const YEARS = ["2022–23", "2023–24", "2024–25", "2025–26"]
const YEAR_TO = ["31 Mar 2023", "31 Mar 2024", "31 Mar 2025", "31 Mar 2026"]
const FROM = ["AR 2023–24", "AR 2024–25", "AR 2025–26", "AR 2025–26"]
const PL = [
  { kind: "section", label: "Income" },
  { label: "Revenue from operations", v: [9605.25, 10312.8, 11240.75, 12105.4] },
  { label: "Other income", v: [244.75, 287.2, 312.25, 374.6] },
  { label: "Total income", sub: true, v: [9850, 10600, 11553, 12480] },
  { kind: "section", label: "Expenses" },
  { label: "Cost of materials consumed", v: [1702.45, 1815.6, 1902.1, 2018.3] },
  { label: "Power and fuel", v: [2795.8, 2912.3, 2688.4, 2710.55] },
  { label: "Freight and forwarding", v: [null, 2180.45, 2401.6, 2602.15], restated: 2 },
  { label: "Freight and forwarding expenses", v: [2040.1, null, null, null], only: true },
  { label: "Employee benefits expense", v: [560.85, 601.2, 655.3, 712.4] },
  { label: "Finance costs", v: [322.4, 305.1, 281.35, 248.9] },
  { label: "Depreciation and amortisation expense", v: [668.9, 701.35, 742.8, 806.25] },
  { label: "Other expenses", v: [1159.5, 1284, 1348.45, 1431.45], restated: 2 },
  { label: "Total expenses", sub: true, v: [9250, 9800, 10020, 10530] },
  { label: "Profit before tax", sub: true, v: [600, 800, 1533, 1950] },
  { kind: "section", label: "Tax expense" },
  { label: "Current tax", v: [141.2, 182.4, 361.8, 452.3] },
  { label: "Deferred tax", v: [9.8, 19.6, 27.2, 38.7] },
  { label: "Total tax expense", sub: true, v: [151, 202, 389, 491] },
  { label: "Profit for the year", sub: true, v: [449, 598, 1144, 1459] },
]
// The same statement as AR 2025–26 prints it: two columns, current year first.
const AR26 = PL.filter((r) => !r.only).map((r) => (r.kind ? r : { ...r, v: [r.v[3], r.v[2]], restated: undefined }))
// Standalone, AR 2025–26 page 149. Maester read total expenses for 2025–26 as 10,012.30; the
// lines above it add up to 10,021.30, so that sum and profit before tax both fail their checks.
const AR26_STANDALONE = [
  { kind: "section", label: "Income" },
  { label: "Revenue from operations", v: [11482.2, 10690.45] },
  { label: "Other income", v: [401.1, 336.55] },
  { label: "Total income", sub: true, v: [11883.3, 11027] },
  { kind: "section", label: "Expenses" },
  { label: "Cost of materials consumed", v: [1905.7, 1812.35] },
  { label: "Power and fuel", v: [2602.4, 2571.2] },
  { label: "Freight and forwarding", v: [2488.9, 2295.05] },
  { label: "Employee benefits expense", v: [668.15, 615.4] },
  { label: "Finance costs", v: [231.6, 262.75] },
  { label: "Depreciation and amortisation expense", v: [772.3, 711.25] },
  { label: "Other expenses", v: [1352.25, 1282] },
  { label: "Total expenses", sub: true, v: [10012.3, 9550], fails: [0] },
  { label: "Exceptional items", v: ["dash", "dash"] },
  { label: "Profit before tax", sub: true, v: [1862, 1477], fails: [0] },
  { kind: "section", label: "Tax expense" },
  { label: "Current tax", v: [431.2, 352.1] },
  { label: "Deferred tax", v: [37.8, 24.9] },
  { label: "Total tax expense", sub: true, v: [469, 377] },
  { label: "Profit for the year", sub: true, v: [1393, 1100] },
  { label: "Other comprehensive income", v: ["unread", -12.4] },
]

const fmt = (n) => {
  if (n === null || n === undefined) return "—"
  if (n === "dash") return "–"
  if (n === "unread") return "—"
  const neg = n < 0
  const s = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return neg ? `(${s})` : s
}

// ---------- pieces ----------
// A row of toggle buttons (aria-pressed); the pressed one is an ink block, as the rail's current page.
function toggles(labels, on, { size = 16, full = false, label } = {}) {
  return row({ gap: 0, flexWrap: "wrap", ...(full ? { width: "100%" } : {}) }, labels.map((l, i) =>
    el("button", { minHeight: 44, padding: full ? "4px 6px" : "0 16px", lineHeight: 1.2, fontFamily: "inherit", fontSize: size, fontWeight: 700, border: `2px solid ${T.ink}`, marginLeft: i ? -2 : 0, background: l === on ? T.ink : "transparent", color: l === on ? T.paper : T.ink, borderRadius: 0, cursor: "pointer", ...(full ? { flex: 1 } : {}) }, esc(l), { type: "button", "aria-pressed": l === on ? "true" : "false" }),
  ), label ? { role: "group", "aria-label": label } : {})
}
// The three status axes of UI spec §9, kept apart: read (coverage), sums (arithmetic), reviewed.
function axes(cells, { phone = false } = {}) {
  return div({ display: "grid", gridTemplateColumns: phone ? "minmax(0, 1fr)" : `repeat(${cells.length}, minmax(0, 1fr))`, borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, cells.map(([k, v, n], i) =>
    col({ gap: 2, padding: phone ? "12px 0" : "12px 16px", paddingLeft: phone || i === 0 ? 0 : 16, borderLeft: !phone && i ? `1px solid ${T.inkMuted}` : 0, borderTop: phone && i ? `1px solid ${T.inkMuted}` : 0 }, [
      muted(k),
      div({ fontSize: 17, fontWeight: 700, lineHeight: 1.4 }, esc(v)),
      n ? note(n) : "",
    ]),
  ))
}
// A statement as a ledger. cols: [{ head, sub }]; rows from the data above.
// sel: { r, c } marks the selected figure (an ink block with the focus ring).
function stmt({ cols, rows, sel, labelW = "minmax(0, 1fr)", colW = 128, fontSize = 16, pad = "10px 16px", caption, region, restatedYear }) {
  const tracks = [labelW, ...cols.map(() => `${colW}px`)].join(" ")
  const grid = (cells, extra = {}) => div({ display: "grid", gridTemplateColumns: tracks, gap: "0 12px", alignItems: "baseline", padding: pad, ...extra }, cells)
  const head = grid([
    div({ fontSize: 14, color: T.inkMuted }, "Line, as printed"),
    ...cols.map((c) => col({ alignItems: "flex-end", gap: 0, textAlign: "right" }, [div({ fontSize: 16, fontWeight: 700, ...NUM }, esc(c.head)), c.sub ? div({ fontSize: 14, color: T.inkMuted, lineHeight: 1.3, whiteSpace: "nowrap" }, esc(c.sub)) : ""])),
  ], { borderBottom: `2px solid ${T.ink}`, alignItems: "end" })
  const body = rows.map((r, ri) => {
    const last = ri === rows.length - 1
    if (r.kind === "section")
      return grid([div({ fontSize: 14, fontWeight: 700, color: T.inkMuted, paddingTop: 6 }, esc(r.label)), ...cols.map(() => "")], { borderBottom: `1px solid ${T.inkMuted}` })
    const labelKids = [div({ fontWeight: r.sub ? 700 : 400 }, esc(r.label))]
    if (r.restated !== undefined && restatedYear) labelKids.push(div({ fontSize: 14, color: T.inkMuted, lineHeight: 1.35 }, `${restatedYear} restated`))
    if (r.only) labelKids.push(div({ fontSize: 14, color: T.inkMuted, lineHeight: 1.35 }, "Printed under this name in 2022–23 only"))
    if (r.fails) labelKids.push(div({ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }, "Doesn’t add up in 2025–26"))
    const cells = r.v.map((v, ci) => {
      const on = sel && sel.r === ri && sel.c === ci
      const unknown = v === null || v === "unread"
      const s = { textAlign: "right", ...NUM, fontWeight: r.sub ? 700 : 400, ...(unknown ? { color: T.inkMuted } : {}) }
      if (on) return div({ ...s, justifySelf: "end", background: T.ink, color: T.paper, padding: "2px 8px", margin: "-2px -8px", outline: `3px solid ${T.ink}`, outlineOffset: 2 }, esc(fmt(v)))
      return div(s, esc(fmt(v)))
    })
    return grid([col({ gap: 0, minWidth: 0 }, labelKids), ...cells], { fontSize, lineHeight: 1.45, borderBottom: last ? 0 : `1px solid ${T.inkMuted}` })
  })
  const table = div({ border: `2px solid ${T.ink}`, flexShrink: 0, background: T.paper }, [head, ...body], { role: "table", "aria-label": caption || "Statement" })
  return region ? div({ overflowX: "auto" }, table, { role: "region", "aria-label": region, tabindex: "0" }) : table
}
// The figure's evidence, as a spec list. Only what the API holds.
function inspector({ title, context: ctx, value, unit = "₹ crore", entries, actions = [], w = 400, phone = false }) {
  return el("aside", { display: "flex", flexDirection: "column", gap: 16, width: phone ? "auto" : w, flexShrink: 0, paddingLeft: phone ? 0 : 24, borderLeft: phone ? 0 : `2px solid ${T.ink}`, boxSizing: "border-box" }, [
    col({ gap: 4 }, [note("Selected figure"), h3(title), note(ctx)]),
    row({ gap: 10, alignItems: "baseline" }, [div({ fontStretch: "110%", fontWeight: 700, fontSize: 40, lineHeight: 1.05, letterSpacing: "-0.02em", ...NUM }, esc(value)), note(unit)]),
    spec(entries, { termW: phone ? 104 : 120 }),
    ...actions,
  ], { "aria-label": "Selected figure" })
}
const pageLine = (t) => div({ fontSize: 16, lineHeight: 1.45 }, t)
const openPdf = (page, { full = false } = {}) => button(`Open the PDF at page ${page}`, { variant: "outline", style: { alignSelf: full ? "stretch" : "flex-start", fontSize: 16, ...(full ? { width: "100%" } : {}) } })
const backTo = (t) => link(`← ${t}`, { style: { fontSize: 16, alignSelf: "flex-start" } })

function docHeader({ phone = false } = {}) {
  return col({ gap: 8 }, [
    backTo("Documents"),
    appH1("Annual report 2025–26", phone ? 30 : 40),
    div({ fontSize: phone ? 16 : 17, lineHeight: 1.45 }, `Synthetic Cements Limited · ${phone ? "" : "ar-2025-26.pdf, "}286 pages · added 14:02`),
  ])
}
const statementSwitch = (on = "Profit and loss", opts) => toggles(["Profit and loss", "Balance sheet", "Cash flow"], on, { label: "Statement", ...opts })
const basisSwitch = (on = "Consolidated", opts) => toggles(["Consolidated", "Standalone"], on, { label: "Basis", ...opts })

// ---------- sketch plates (as the coming-soon sketches) ----------
const roughDefs = (k) => `<defs>
<filter id="r1${k}" x="-3%" y="-3%" width="106%" height="106%"><feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="7" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap></filter>
<filter id="r2${k}" x="-3%" y="-3%" width="106%" height="106%"><feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="19" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap></filter>
</defs>`
const plates = (k, colour, ink) => `
<g transform="translate(7 6)">${colour}</g>
<g fill="none" stroke="#000000" stroke-linecap="round" stroke-linejoin="round" stroke-width="3.2" filter="url(#r1${k})">${ink}</g>
<g fill="none" stroke="#000000" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4" opacity="0.55" filter="url(#r2${k})" transform="translate(1.5 -1)">${ink}</g>`
const hand = (x, y, t, { size = 30, rot = 0, anchor = "start" } = {}) =>
  `<text x="${x}" y="${y}" font-family="${HAND}" font-size="${size}" font-weight="700" fill="#000000" text-anchor="${anchor}"${rot ? ` transform="rotate(${rot} ${x} ${y})"` : ""}>${esc(t)}</text>`
function cabinetSketch({ w = 440 } = {}) {
  const ink = `
<path d="M140 80 L 360 76 L 364 440 L 144 444 Z"></path>
<path d="M146 196 L 362 192"></path><path d="M146 316 L 362 312"></path>
<path d="M120 196 L 140 80"></path>
<path d="M150 92 L 92 120 L 96 222 L 150 204"></path>
<path d="M92 120 L 300 104 L 352 92"></path>
<path d="M226 150 L 278 148"></path><path d="M226 262 L 278 260"></path><path d="M226 382 L 278 380"></path>
<path d="M170 98 L 176 64 L 236 70 L 230 106"></path>
<path d="M60 452 Q 250 470 440 450"></path>`
  const colour = `
<path d="M140 80 L 360 76 L 364 440 L 144 444 Z" fill="${ILLUS.yellow}"></path>
<path d="M170 98 L 176 64 L 236 70 L 230 106 Z" fill="${ILLUS.blue}"></path>`
  return `<svg viewBox="0 0 480 490" width="${w}" height="${Math.round((w * 490) / 480)}" role="img" aria-labelledby="cab" style="display: block; flex-shrink: 0">
<title id="cab">A sketch of a filing cabinet. Its top drawer is open and holds a single note that says being sorted.</title>
${roughDefs("c")}${plates("c", colour, ink)}
${hand(204, 88, "being", { size: 20, rot: 4, anchor: "middle" })}${hand(206, 106, "sorted", { size: 20, rot: 4, anchor: "middle" })}
${hand(400, 230, "just one note so far", { size: 26, rot: -6, anchor: "middle" })}
</svg>`
}

// The rendered PDF page (C): a picture of the printed statement, drawn small as a page is.
// The box marks where 12,105.40 appears in the page's text layer.
function pdfPage({ w = 560, phone = false } = {}) {
  const s = w / 560
  const fs = (n) => Math.max(phone ? 6 : 9, Math.round(n * s * 10) / 10)
  const line = (label, a, b, { bold = false, hl = false, noteNo = "" } = {}) =>
    div({ display: "grid", gridTemplateColumns: `minmax(0, 1fr) ${36 * s}px ${84 * s}px ${84 * s}px`, gap: `0 ${8 * s}px`, fontSize: fs(11), lineHeight: 1.6, fontWeight: bold ? 700 : 400, ...NUM }, [
      div({}, esc(label)), div({ textAlign: "center" }, esc(noteNo)),
      div({ textAlign: "right" }, hl ? el("span", { outline: `2px solid ${T.ink}`, outlineOffset: 2, padding: "0 2px" }, esc(a)) : esc(a)),
      div({ textAlign: "right" }, esc(b)),
    ])
  const rows = [
    ["Income", "", "", { bold: true }],
    ["Revenue from operations", "12,105.40", "11,240.75", { hl: true, noteNo: "28" }],
    ["Other income", "374.60", "312.25", { noteNo: "29" }],
    ["Total income", "12,480.00", "11,553.00", { bold: true }],
    ["Expenses", "", "", { bold: true }],
    ["Cost of materials consumed", "2,018.30", "1,902.10", { noteNo: "30" }],
    ["Power and fuel", "2,710.55", "2,688.40"],
    ["Freight and forwarding", "2,602.15", "2,401.60"],
    ["Employee benefits expense", "712.40", "655.30", { noteNo: "31" }],
    ["Finance costs", "248.90", "281.35", { noteNo: "32" }],
    ["Depreciation and amortisation expense", "806.25", "742.80", { noteNo: "4" }],
    ["Other expenses", "1,431.45", "1,348.45", { noteNo: "33" }],
    ["Total expenses", "10,530.00", "10,020.00", { bold: true }],
    ["Profit before tax", "1,950.00", "1,533.00", { bold: true }],
    ["Tax expense", "", "", { bold: true }],
    ["Current tax", "452.30", "361.80"],
    ["Deferred tax", "38.70", "27.20"],
    ["Total tax expense", "491.00", "389.00", { bold: true }],
    ["Profit for the year", "1,459.00", "1,144.00", { bold: true }],
  ]
  return div({ width: w, height: Math.round(w * 1.414), boxSizing: "border-box", border: `1px solid ${T.ink}`, background: T.paper, padding: `${40 * s}px ${44 * s}px`, display: "flex", flexDirection: "column", gap: 6 * s, flexShrink: 0, overflow: "hidden" }, [
    div({ fontSize: fs(13), fontWeight: 700, textAlign: "center" }, "SYNTHETIC CEMENTS LIMITED"),
    div({ fontSize: fs(11), textAlign: "center", lineHeight: 1.4 }, "Consolidated Statement of Profit and Loss for the year ended 31 March 2026"),
    div({ fontSize: fs(10), textAlign: "right", marginTop: 6 * s }, "(₹ in crore)"),
    div({ display: "grid", gridTemplateColumns: `minmax(0, 1fr) ${36 * s}px ${84 * s}px ${84 * s}px`, gap: `0 ${8 * s}px`, fontSize: fs(10), fontWeight: 700, borderBottom: `1px solid ${T.ink}`, paddingBottom: 4 * s }, [div({}, "Particulars"), div({ textAlign: "center" }, "Note"), div({ textAlign: "right", lineHeight: 1.3 }, "Year ended 31.03.2026"), div({ textAlign: "right", lineHeight: 1.3 }, "Year ended 31.03.2025")]),
    ...rows.map(([l, a, b, o]) => line(l, a, b, o)),
    spacer(),
    div({ fontSize: fs(9), lineHeight: 1.5 }, "The accompanying notes form an integral part of the consolidated financial statements."),
    div({ fontSize: fs(10), textAlign: "center" }, "213"),
  ], { role: "img", "aria-label": "Page 213 of the annual report: the consolidated statement of profit and loss. A box marks 12,105.40 where it appears in the page’s text." })
}

// ---------- Today ----------
function T1() {
  const ladder = div({ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, ["Uploaded", "Worked out what it is", "Reading the statements", "Ready"].map((s, i) =>
    col({ gap: 2, padding: "10px 12px", borderLeft: i ? `1px solid ${T.inkMuted}` : 0, ...(i === 3 ? { background: T.ink, color: T.paper } : {}) }, [div({ fontSize: 14, ...NUM }, `${i + 1}`), div({ fontSize: 16, fontWeight: 700 }, esc(s)), div({ fontSize: 14, color: i === 3 ? T.paperMuted : T.inkMuted }, "Done")])))
  const slip = col({ border: `2px solid ${T.ink}`, padding: 24, gap: 20, flex: 1.6, minWidth: 0 }, [
    col({ gap: 4 }, [h2("ar-2025-26.pdf", 22), note("added 14:02")]),
    ladder,
    col({ gap: 8 }, [el("h3", { margin: 0, fontSize: 20, fontWeight: 700 }, "Read as"), spec([
      ["What it is", `Annual report<br>${noteSpan("Page 1: “Annual Report 2025–26”")}`],
      ["Company", `Synthetic Cements Limited<br>${noteSpan("Page 1: “Synthetic Cements Limited”")}`],
      ["Period", `Year to 31 March 2026<br>${noteSpan("Page 1: “for the year ended 31 March 2026”")}`],
      ["Statements", "Profit and loss, balance sheet and cash flow, consolidated and standalone"],
    ], { termW: 120 })]),
  ])
  const earlier = col({ gap: 12, flex: 1, minWidth: 0 }, [h2("Earlier", 22), div({ borderBottom: `2px solid ${T.ink}` }, [
    ["ar-2024-25.pdf", "Annual report", "Ready"],
    ["ar-2023-24.pdf", "Annual report", "Ready"],
    ["harbour-ar-2026.pdf", "Annual report", "Ready"],
    ["kestrel-q1.pdf", "Financial results", "Ready"],
  ].map(([n, k, s], i) => div({ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) 72px", gap: 12, padding: "12px 0", borderTop: `1px solid ${T.inkMuted}`, fontSize: 16 }, [link(n), div({}, k), div({}, s)])))])
  return appPage({ active: "Documents", content: [
    col({ gap: 12 }, [appH1("Documents"), body("Add a filing and Maester works out what it is, then reads it. Wrong guess? Change it and it’s read again.")]),
    row({ border: `2px dashed ${T.ink}`, padding: "16px 20px", gap: 16 }, [strong("Drop a PDF here"), note("or"), button("Choose a file", { variant: "outline" }), spacer(), note("PDF, up to 50 MB.")]),
    row({ gap: 32, alignItems: "flex-start" }, [slip, earlier]),
    note("Leaving this page doesn’t stop anything. The slip is here when you come back."),
  ] })
}
const noteSpan = (t) => `<span style="color: ${T.inkMuted}; font-size: 14px">${esc(t)}</span>`
function T2() {
  return appPage({ active: "Research", content: [
    row({ gap: 48, alignItems: "flex-start" }, [
      col({ gap: 16, maxWidth: 560, paddingTop: 8 }, [
        row({ gap: 16, alignItems: "center" }, [appH1("Research"), tag("Coming soon")]),
        body("Each company you own or follow, with the figures from its filings and the page each figure came from."),
        body("It fills in as the filings for your companies are read.", { color: T.inkMuted }),
      ]),
      cabinetSketch({ w: 420 }),
    ]),
  ] })
}

// ---------- A · The filing, opened ----------
const AR26_COLS = [{ head: "2025–26", sub: "to 31 Mar 2026" }, { head: "2024–25", sub: "to 31 Mar 2025" }]
function A1() {
  const insp = inspector({
    title: "Revenue from operations",
    context: "Profit and loss · consolidated · year to 31 March 2026",
    value: "12,105.40",
    entries: [
      ["Where", `Page 213 of 286`],
      ["On the page", "Found in the page’s text"],
      ["Adds up", "Part of total income: 12,105.40 + 374.60 = 12,480.00"],
      ["Reviewed", "Not yet"],
    ],
    actions: [openPdf(213), note("Opens the filing in a new tab. If it opens at the start, go to page 213.")],
  })
  return appPage({ active: "Documents", content: [
    docHeader(),
    axes([
      ["Read", "All 6 statements", "Profit and loss, balance sheet and cash flow, consolidated and standalone"],
      ["Sums", "60 of 60 add up", "Each subtotal against its lines, and assets against equity and liabilities"],
      ["Reviewed by you", "None yet", "Nobody has checked a figure against its page"],
    ]),
    row({ gap: 16, flexWrap: "wrap", justifyContent: "space-between" }, [statementSwitch(), basisSwitch()]),
    row({ gap: 24, alignItems: "flex-start" }, [
      col({ gap: 8, flex: 1, minWidth: 0 }, [
        row({ justifyContent: "space-between", alignItems: "baseline" }, [pageLine("Consolidated profit and loss, page 213 of 286."), note("Figures in ₹ crore, as printed.")]),
        stmt({ cols: AR26_COLS, rows: AR26, sel: { r: 1, c: 0 }, caption: "Consolidated profit and loss", region: "Consolidated profit and loss, scrolls sideways" }),
      ]),
      insp,
    ]),
  ] })
}
function A2() {
  const rows = AR26.slice(0, 8)
  const sel = { r: 1, c: 0 }
  const tracks = "minmax(0, 1fr) 92px 92px"
  const head = div({ display: "grid", gridTemplateColumns: tracks, gap: "0 8px", padding: "8px 12px", borderBottom: `2px solid ${T.ink}`, fontSize: 14, color: T.inkMuted, alignItems: "end" }, [div({}, "Line, as printed"), div({ textAlign: "right", fontWeight: 700, color: T.ink, fontSize: 15 }, "2025–26"), div({ textAlign: "right", fontWeight: 700, color: T.ink, fontSize: 15 }, "2024–25")])
  const line = (r, i) => {
    if (r.kind) return div({ padding: "8px 12px 4px", fontSize: 14, fontWeight: 700, color: T.inkMuted, borderBottom: `1px solid ${T.inkMuted}` }, esc(r.label))
    const on = i === sel.r
    const g = div({ display: "grid", gridTemplateColumns: tracks, gap: "0 8px", padding: "10px 12px", fontSize: 15, lineHeight: 1.4, alignItems: "baseline", borderBottom: `1px solid ${T.inkMuted}` }, [
      div({ fontWeight: r.sub ? 700 : 400 }, esc(r.label)),
      on ? div({ textAlign: "right", ...NUM, background: T.ink, color: T.paper, padding: "2px 6px", margin: "-2px -6px", outline: `3px solid ${T.ink}`, outlineOffset: 2 }, esc(fmt(r.v[0]))) : div({ textAlign: "right", ...NUM, fontWeight: r.sub ? 700 : 400 }, esc(fmt(r.v[0]))),
      div({ textAlign: "right", ...NUM, fontWeight: r.sub ? 700 : 400 }, esc(fmt(r.v[1]))),
    ])
    if (!on) return g
    return [g, col({ padding: "16px 12px 20px", gap: 12, borderBottom: `2px solid ${T.ink}`, background: T.paper }, [
      note("Revenue from operations · consolidated · year to 31 March 2026"),
      spec([["Where", "Page 213 of 286"], ["On the page", "Found in the page’s text"], ["Adds up", "Part of total income, which adds up"], ["Reviewed", "Not yet"]], { termW: 104 }),
      openPdf(213, { full: true }),
      note("If the PDF opens at the start, go to page 213."),
    ])]
  }
  return appPhone({ content: [
    docHeader({ phone: true }),
    axes([["Read", "All 6 statements"], ["Sums", "60 of 60 add up"], ["Reviewed by you", "None yet"]], { phone: true }),
    toggles(["Profit and loss", "Balance sheet", "Cash flow"], "Profit and loss", { size: 15, full: true, label: "Statement" }),
    basisSwitch("Consolidated", { full: true }),
    col({ gap: 8 }, [note("Page 213 · ₹ crore, as printed. Tap a figure to see where it came from."), div({ border: `2px solid ${T.ink}` }, [head, ...rows.map(line)])]),
  ] })
}
function A3() {
  const insp = inspector({
    title: "Total expenses",
    context: "Profit and loss · standalone · year to 31 March 2026",
    value: "10,012.30",
    entries: [
      ["Where", "Page 149 of 286"],
      ["On the page", "<strong>Not found.</strong> The page’s text doesn’t contain 10,012.30."],
      ["Adds up", "<strong>No.</strong> The 7 lines above add up to 10,021.30, which is 9.00 more. Profit before tax doesn’t add up either, because it uses this figure."],
      ["Reviewed", "Not yet"],
    ],
    actions: [openPdf(149), note("Check the figure on the page. Maester may have misread it.")],
  })
  return appPage({ active: "Documents", content: [
    docHeader(),
    axes([
      ["Read", "5 of 6 statements", "The standalone cash flow didn’t read"],
      ["Sums", "2 of 56 don’t add up", "Standalone profit and loss, 2025–26"],
      ["Reviewed by you", "None yet", "Nobody has checked a figure against its page"],
    ]),
    col({ border: `2px solid ${T.ink}`, padding: "16px 20px", gap: 8 }, [
      strong("Maester couldn’t read the standalone cash flow."),
      body("Pages 151 and 152 had no table it could follow. Everything else from this filing is current."),
      button("Try again", { variant: "outline", style: { alignSelf: "flex-start", marginTop: 4 } }),
    ], { role: "note" }),
    row({ gap: 16, flexWrap: "wrap", justifyContent: "space-between" }, [statementSwitch(), basisSwitch("Standalone")]),
    row({ gap: 24, alignItems: "flex-start" }, [
      col({ gap: 8, flex: 1, minWidth: 0 }, [
        row({ justifyContent: "space-between", alignItems: "baseline" }, [pageLine("Standalone profit and loss, page 149 of 286."), note("Figures in ₹ crore, as printed.")]),
        stmt({ cols: AR26_COLS, rows: AR26_STANDALONE, sel: { r: 12, c: 0 }, caption: "Standalone profit and loss", region: "Standalone profit and loss, scrolls sideways" }),
        note("– is a dash printed on the page, not a zero. — is a figure Maester couldn’t read: select it to see why."),
      ]),
      insp,
    ]),
  ] })
}

// ---------- B · The company's years ----------
function B1() {
  const cols = "minmax(0, 1.5fr) minmax(0, 1.3fr) 140px minmax(0, 1.2fr)"
  const line = (cells, extra = {}) => div({ display: "grid", gridTemplateColumns: cols, gap: "0 16px", padding: "14px 16px", fontSize: 16, lineHeight: 1.45, alignItems: "baseline", ...extra }, cells)
  const rows = [
    [link("Synthetic Cements Limited"), "3 annual reports", "2025–26", "Read"],
    [link("Harbour Cements Limited"), "1 annual report", "2025–26", "Read"],
    [link("Kestrel Power Limited"), "Results for the quarter to 30 June 2026", "Q1 2026–27", "Read"],
    [div({ fontWeight: 400 }, "Meridian Bank Limited"), "1 annual report, not read yet", "—", `<strong>Needs you:</strong> ${link("confirm the company in Documents").replace("<a", "<a")}`],
  ]
  return appPage({ active: "Research", research: true, content: [
    col({ gap: 12 }, [appH1("Research"), body("Each company you’ve added, with the figures from its filings and the page each one came from.")]),
    col({ gap: 8 }, [note("4 companies. A company’s figures appear once one of its filings is read."),
      div({ border: `2px solid ${T.ink}` }, [
        line(["Company", "Read from", "Latest year", "Where it stands"].map((t) => div({}, esc(t))), { borderBottom: `2px solid ${T.ink}`, fontSize: 14, color: T.inkMuted }),
        ...rows.map((r, i) => line(r.map((c) => div({ minWidth: 0 }, c.startsWith("<") ? c : esc(c))), { borderBottom: i === rows.length - 1 ? 0 : `1px solid ${T.inkMuted}` })),
      ])]),
    row({ gap: 12, alignItems: "baseline" }, [note("Missing a company?"), link("Add a filing in Documents", { style: { fontSize: 16 } })]),
  ] })
}
const YEAR_COLS = YEARS.map((y, i) => ({ head: y, sub: FROM[i] }))
function companyHeader({ phone = false } = {}) {
  return col({ gap: 8 }, [
    backTo("Research"),
    appH1("Synthetic Cements Limited", phone ? 30 : 40),
    div({ fontSize: phone ? 16 : 17, lineHeight: 1.45 }, phone ? "NSE SYNCEM · BSE 500991" : "NSE SYNCEM · BSE 500991 · CIN L26942MH1984PLC012345"),
    row({ gap: 8, flexWrap: "wrap", alignItems: "baseline", fontSize: 16 }, [note("Read from 3 annual reports:", { fontSize: 16 }), link("2025–26"), link("2024–25"), link("2023–24")]),
  ])
}
function B2() {
  const insp = inspector({
    w: 360,
    title: "Freight and forwarding",
    context: "Profit and loss · consolidated · year to 31 March 2025",
    value: "2,401.60",
    entries: [
      ["From", "Annual report 2025–26, page 213 of 286"],
      ["Restated", "Annual report 2024–25 printed 2,389.10 for this year, on page 198. The newer filing’s figure is shown."],
      ["On the page", "Found in the page’s text"],
      ["Adds up", "Part of total expenses for 2024–25, which adds up"],
      ["Reviewed", "Not yet"],
    ],
    actions: [openPdf(213), link("Open the 2024–25 report at page 198", { style: { fontSize: 16 } })],
  })
  return appPage({ active: "Research", research: true, content: [
    companyHeader(),
    row({ gap: 16, flexWrap: "wrap", justifyContent: "space-between" }, [statementSwitch(), basisSwitch()]),
    row({ gap: 24, alignItems: "flex-start" }, [
      col({ gap: 8, flex: 1, minWidth: 0 }, [
        row({ justifyContent: "space-between", alignItems: "baseline" }, [pageLine("Consolidated profit and loss, years to 31 March."), note("₹ crore.")]),
        stmt({ cols: YEAR_COLS, rows: PL, sel: { r: 7, c: 2 }, colW: 104, fontSize: 15, pad: "9px 12px", restatedYear: "2024–25", caption: "Consolidated profit and loss by year", region: "Profit and loss by year, scrolls sideways" }),
        note("Each year comes whole from the newest filing that prints it, so every column adds up."),
      ]),
      insp,
    ]),
  ] })
}
function B3() {
  // Phone: the label column stays put; the years scroll, opened at the newest.
  const rows = PL.slice(0, 9)
  const yrs = [2, 3]
  const labelW = 136
  const cell = (t, s = {}) => div({ textAlign: "right", ...NUM, fontSize: 15, ...s }, esc(t))
  const lines = rows.map((r, i) => {
    const last = i === rows.length - 1
    const b = { borderBottom: last ? 0 : `1px solid ${T.inkMuted}` }
    if (r.kind) return div({ display: "grid", gridTemplateColumns: `${labelW}px 1fr`, ...b }, [div({ padding: "8px 12px 4px", fontSize: 14, fontWeight: 700, color: T.inkMuted, borderRight: `2px solid ${T.ink}` }, esc(r.label)), div({})])
    return div({ display: "grid", gridTemplateColumns: `${labelW}px 1fr`, ...b }, [
      col({ padding: "9px 12px", fontSize: 15, lineHeight: 1.35, borderRight: `2px solid ${T.ink}`, gap: 0 }, [div({ fontWeight: r.sub ? 700 : 400 }, esc(r.label)), r.restated !== undefined ? div({ fontSize: 14, color: T.inkMuted }, "2024–25 restated") : "", r.only ? div({ fontSize: 14, color: T.inkMuted }, "2022–23 only") : ""]),
      div({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px", padding: "9px 12px", alignItems: "baseline", fontWeight: r.sub ? 700 : 400 }, yrs.map((y) => cell(fmt(r.v[y]), r.v[y] === null ? { color: T.inkMuted } : {}))),
    ])
  })
  const head = div({ display: "grid", gridTemplateColumns: `${labelW}px 1fr`, borderBottom: `2px solid ${T.ink}` }, [
    div({ padding: "8px 12px", fontSize: 14, color: T.inkMuted, borderRight: `2px solid ${T.ink}` }, "Line"),
    div({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px", padding: "8px 12px" }, yrs.map((y) => col({ alignItems: "flex-end" }, [div({ fontWeight: 700, fontSize: 15 }, YEARS[y]), div({ fontSize: 14, color: T.inkMuted, whiteSpace: "nowrap" }, FROM[y])]))),
  ])
  return appPhone({ content: [
    companyHeader({ phone: true }),
    toggles(["Profit and loss", "Balance sheet", "Cash flow"], "Profit and loss", { size: 15, full: true, label: "Statement" }),
    basisSwitch("Consolidated", { full: true }),
    col({ gap: 8 }, [
      row({ justifyContent: "space-between", alignItems: "baseline" }, [note("₹ crore. Newest years shown."), note("← 2 earlier years")]),
      div({ border: `2px solid ${T.ink}` }, [head, ...lines], { role: "region", "aria-label": "Profit and loss by year, scrolls sideways", tabindex: "0" }),
      note("Swipe the figures sideways for 2022–23 and 2023–24. The line names stay put."),
    ]),
  ] })
}

// ---------- C · The page beside the figures ----------
function C1() {
  const pageTools = row({ gap: 8, flexWrap: "wrap", alignItems: "center" }, [
    strong("Page 213 of 286", { fontSize: 16 }), spacer(),
    button("Previous page", { variant: "outline", style: { fontSize: 16, padding: "0 14px" } }),
    button("Next page", { variant: "outline", style: { fontSize: 16, padding: "0 14px" } }),
    link("Open the PDF", { style: { fontSize: 16, marginLeft: 8 } }),
  ])
  return appPage({ active: "Documents", content: [
    docHeader(),
    row({ gap: 16, flexWrap: "wrap", justifyContent: "space-between" }, [statementSwitch(), basisSwitch()]),
    row({ gap: 24, alignItems: "flex-start" }, [
      col({ gap: 12, flex: 1, minWidth: 0 }, [
        row({ justifyContent: "space-between", alignItems: "baseline" }, [pageLine("Consolidated profit and loss."), note("₹ crore, as printed.")]),
        stmt({ cols: AR26_COLS, rows: AR26, sel: { r: 1, c: 0 }, colW: 112, fontSize: 15, pad: "9px 12px", caption: "Consolidated profit and loss", region: "Consolidated profit and loss" }),
        spec([["On the page", "Found in the page’s text, boxed"], ["Adds up", "Part of total income, which adds up"], ["Reviewed", "Not yet"]], { termW: 120 }),
        note("Arrow keys move between figures; the page follows."),
      ]),
      col({ gap: 12, width: 584, flexShrink: 0, borderLeft: `2px solid ${T.ink}`, paddingLeft: 24, boxSizing: "border-box" }, [
        pageTools,
        pdfPage({ w: 558 }),
        note("The box marks every place 12,105.40 appears in the page’s text. A scanned page has no text, so nothing is boxed."),
      ], { "aria-label": "Source page" }),
    ]),
  ] })
}
function C2() {
  return appPhone({ content: [
    docHeader({ phone: true }),
    toggles(["Figures", "Page 213"], "Page 213", { full: true, label: "View" }),
    col({ gap: 4, borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}`, padding: "10px 0" }, [
      note("Selected figure"),
      row({ justifyContent: "space-between", alignItems: "baseline", gap: 8 }, [div({ fontWeight: 700, fontSize: 16 }, "Revenue from operations, 2025–26"), div({ fontWeight: 700, fontSize: 17, ...NUM }, "12,105.40")]),
      note("Found in the page’s text · adds up · not reviewed yet"),
    ]),
    row({ gap: 8 }, [button("Previous page", { variant: "outline", style: { fontSize: 15, padding: "0 12px", flex: 1 } }), button("Next page", { variant: "outline", style: { fontSize: 15, padding: "0 12px", flex: 1 } })]),
    pdfPage({ w: 342, phone: true }),
    note("Page 213 of 286. Pinch to zoom. The box marks 12,105.40 where the page’s text has it."),
  ] })
}

// ---------- D · Sums you can open ----------
function sumBlock({ label, a, b, check, parts, page, open, phone = false, failed }) {
  const fig = (v, s = {}) => div({ textAlign: "right", ...NUM, minWidth: phone ? 84 : 120, ...s }, esc(fmt(v)))
  const labelEl = parts
    ? el("button", { display: "flex", alignItems: "center", gap: 10, minHeight: 44, flex: 1, minWidth: 0, width: phone ? "100%" : "auto", padding: 0, border: 0, background: "transparent", fontFamily: "inherit", fontSize: phone ? 17 : 20, fontWeight: 700, color: T.ink, textAlign: "left", cursor: "pointer" }, [el("span", { fontStretch: "110%" }, esc(label)), el("span", { fontSize: 14, fontWeight: 400, color: T.inkMuted }, `${parts.length} lines`), el("span", { marginLeft: "auto", fontSize: 22, fontWeight: 400 }, open ? "−" : "+", { "aria-hidden": "true" })], { type: "button", "aria-expanded": open ? "true" : "false" })
    : div({ display: "flex", alignItems: "center", minHeight: 44, flex: 1, minWidth: 0, fontStretch: "110%", fontSize: phone ? 17 : 20, fontWeight: 700 }, esc(label))
  const phoneHead = col({ padding: "8px 0 12px", gap: 0 }, [labelEl, row({ gap: 8, alignItems: "baseline" }, [div({ flex: 1, minWidth: 0, fontSize: 15, fontWeight: failed ? 700 : 400, lineHeight: 1.35 }, esc(check)), fig(a, { fontSize: 17, fontWeight: 700 }), fig(b, { fontSize: 17, fontWeight: 700 })])])
  const headRow = phone ? phoneHead : row({ gap: 16, alignItems: "baseline", padding: "12px 0" }, [
    parts
      ? el("button", { display: "flex", alignItems: "center", gap: 10, minHeight: 44, flex: 1, minWidth: phone ? "100%" : 0, padding: 0, border: 0, background: "transparent", fontFamily: "inherit", fontSize: phone ? 17 : 20, fontWeight: 700, color: T.ink, textAlign: "left", cursor: "pointer" }, [el("span", { fontStretch: "110%" }, esc(label)), el("span", { fontSize: 14, fontWeight: 400, color: T.inkMuted }, `${parts.length} lines`), el("span", { marginLeft: "auto", fontSize: 22, fontWeight: 400 }, open ? "−" : "+", { "aria-hidden": "true" })], { type: "button", "aria-expanded": open ? "true" : "false" })
      : div({ display: "flex", alignItems: "center", minHeight: 44, flex: 1, minWidth: phone ? "100%" : 0, fontStretch: "110%", fontSize: phone ? 17 : 20, fontWeight: 700 }, esc(label)),
    fig(a, { fontSize: phone ? 17 : 20, fontWeight: 700, ...(phone ? { flex: 1 } : {}) }),
    fig(b, { fontSize: phone ? 17 : 20, fontWeight: 700, ...(phone ? { flex: 1 } : {}) }),
    div({ minWidth: phone ? 0 : 150, fontSize: 16, fontWeight: failed ? 700 : 400, textAlign: phone ? "left" : "right", ...(phone ? { width: "100%" } : {}) }, esc(check)),
  ])
  const body = open && parts
    ? col({ gap: 0, padding: phone ? "0 0 16px" : "0 0 16px 24px" }, [
        ...parts.map(([l, x, y]) => row({ gap: phone ? 8 : 16, alignItems: "baseline", padding: "8px 0", borderTop: `1px solid ${T.inkMuted}`, fontSize: 16 }, [div({ flex: 1, minWidth: 0 }, esc(l)), fig(x), fig(y), phone ? "" : div({ minWidth: 150 }, "")])),
        div({ padding: "10px 0 0", borderTop: `1px solid ${T.inkMuted}`, fontSize: 16, lineHeight: 1.45 }, failed ? failed : esc(`${parts.map((p) => fmt(p[1])).join(" + ")} = ${fmt(a)}. Page ${page}.`)),
      ])
    : ""
  return col({ borderTop: `2px solid ${T.ink}`, gap: 0 }, [headRow, body])
}
function D1() {
  const expenses = AR26.filter((r) => !r.kind).slice(3, 10).map((r) => [r.label, r.v[0], r.v[1]])
  return appPage({ active: "Documents", content: [
    docHeader(),
    axes([
      ["Read", "All 6 statements", "Profit and loss, balance sheet and cash flow, consolidated and standalone"],
      ["Sums", "60 of 60 add up", "Each subtotal against its lines, and assets against equity and liabilities"],
      ["Reviewed by you", "None yet", "Nobody has checked a figure against its page"],
    ]),
    row({ gap: 16, flexWrap: "wrap", justifyContent: "space-between" }, [statementSwitch(), basisSwitch()]),
    col({ gap: 0, maxWidth: 1000 }, [
      row({ gap: 16, alignItems: "baseline", padding: "0 0 8px" }, [div({ flex: 1, fontSize: 14, color: T.inkMuted }, "Consolidated profit and loss, page 213 · ₹ crore, as printed. Open a sum to see its lines."), div({ minWidth: 120, textAlign: "right", fontWeight: 700 }, "2025–26"), div({ minWidth: 120, textAlign: "right", fontWeight: 700 }, "2024–25"), div({ minWidth: 150, textAlign: "right", fontSize: 14, color: T.inkMuted }, "Check")]),
      sumBlock({ label: "Total income", a: 12480, b: 11553, check: "Adds up", page: 213, open: true, parts: [["Revenue from operations", 12105.4, 11240.75], ["Other income", 374.6, 312.25]] }),
      sumBlock({ label: "Total expenses", a: 10530, b: 10020, check: "Adds up", page: 213, parts: expenses }),
      sumBlock({ label: "Profit before tax", a: 1950, b: 1533, check: "Income less expenses", page: 213 }),
      sumBlock({ label: "Total tax expense", a: 491, b: 389, check: "Adds up", page: 213, parts: [["Current tax", 452.3, 361.8], ["Deferred tax", 38.7, 27.2]] }),
      div({ borderBottom: `2px solid ${T.ink}` }, sumBlock({ label: "Profit for the year", a: 1459, b: 1144, check: "Before tax less tax", page: 213 })),
    ]),
    col({ gap: 6 }, [note("Each line opens to its own page and checks, as in A’s figure panel."), link("Open the PDF at page 213", { style: { fontSize: 16 } })]),
  ] })
}
function D2() {
  const expenses = AR26_STANDALONE.filter((r) => !r.kind).slice(3, 10).map((r) => [r.label, r.v[0], r.v[1]])
  return appPhone({ content: [
    docHeader({ phone: true }),
    axes([["Read", "5 of 6 statements", "The standalone cash flow didn’t read"], ["Sums", "2 of 56 don’t add up"], ["Reviewed by you", "None yet"]], { phone: true }),
    toggles(["Profit and loss", "Balance sheet", "Cash flow"], "Profit and loss", { size: 15, full: true, label: "Statement" }),
    basisSwitch("Standalone", { full: true }),
    col({ gap: 0 }, [
      row({ gap: 8, padding: "0 0 8px", fontSize: 14 }, [div({ flex: 1, color: T.inkMuted }, "Page 149 · ₹ crore"), div({ minWidth: 84, textAlign: "right", fontWeight: 700 }, "2025–26"), div({ minWidth: 84, textAlign: "right", fontWeight: 700 }, "2024–25")]),
      sumBlock({ phone: true, label: "Total income", a: 11883.3, b: 11027, check: "Adds up", page: 149, parts: [["Revenue from operations", 11482.2, 10690.45], ["Other income", 401.1, 336.55]] }),
      sumBlock({ phone: true, label: "Total expenses", a: 10012.3, b: 9550, check: "Doesn’t add up in 2025–26", page: 149, open: true, parts: expenses,
        failed: `<strong>The 7 lines add up to 10,021.30.</strong> Maester read 10,012.30 from page 149, and the page’s text doesn’t contain it. Check it on the page.` }),
      div({ borderBottom: `2px solid ${T.ink}` }, sumBlock({ phone: true, label: "Profit before tax", a: 1862, b: 1477, check: "Doesn’t add up in 2025–26", page: 149, failed: true })),
    ]),
    openPdf(149, { full: true }),
  ] })
}

// ---------- B · final: the company's years with a stock summary on top ----------
// Picked 13 Oct 2026: "go with B, with A's figure panel", then "add some summary on top about
// the stock". The price figures come from the closes the market refresher already keeps for
// every Nifty 500 share (market_point, series eq:SYMBOL, NSE close, from the user's Dhan data).
// Price to earnings divides that close by the basic earnings per share the annual report prints.
// The sentence is filled from these figures by rule, never written by a model.
const PL_EPS = [
  ...PL,
  { kind: "section", label: "Earnings per equity share (₹)" },
  { label: "Basic", v: [19.07, 25.4, 48.6, 61.98], rupees: true },
  { label: "Diluted", v: [19.03, 25.35, 48.5, 61.85], rupees: true },
]
// A 2px rule from the year's low to its high with a block at the close (RankRuler's drawing).
function rangeRuler({ lowPct, w = "100%", inverted = false }) {
  const ink = inverted ? T.paper : T.ink
  return div({ position: "relative", width: w, height: 22, flexShrink: 0 }, [
    div({ position: "absolute", left: 0, right: 0, top: 10, height: 2, background: ink }),
    div({ position: "absolute", left: 0, top: 4, width: 2, height: 14, background: ink }),
    div({ position: "absolute", right: 0, top: 4, width: 2, height: 14, background: ink }),
    div({ position: "absolute", left: `calc(${lowPct}% - 3px)`, top: 2, width: 6, height: 18, background: ink }),
  ], { "aria-hidden": "true" })
}
// FigureStrip: four headline figures, each with a note on what it covers. A spec list on a phone.
function figureStrip(cells, { phone = false } = {}) {
  return div({ display: "grid", gridTemplateColumns: phone ? "minmax(0, 1fr)" : "repeat(4, minmax(0, 1fr))", borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, cells.map((c, i) =>
    col({ gap: 6, padding: phone ? "14px 0" : "16px 20px", paddingLeft: phone || i === 0 ? 0 : 20, borderLeft: !phone && i ? `1px solid ${T.inkMuted}` : 0, borderTop: phone && i ? `1px solid ${T.inkMuted}` : 0, minWidth: 0 }, [
      muted(c.label, { fontSize: 14 }),
      div({ fontStretch: "110%", fontWeight: 700, fontSize: phone ? 28 : c.size || 32, lineHeight: 1.05, whiteSpace: phone ? "normal" : "nowrap", letterSpacing: "-0.02em", ...NUM, ...(c.unknown ? { color: T.inkMuted } : {}) }, esc(c.value)),
      c.change ? div({ fontSize: 16, fontWeight: 700, ...NUM }, esc(c.change)) : "",
      c.ruler || "",
      note(c.note),
      c.link || "",
    ]),
  ), { role: "group", "aria-label": "Summary" })
}
const STOCK_SENTENCE = "Synthetic Cements closed at ₹1,284.50 on Friday 9 October, 18.4% higher than a year earlier. In 2025–26 its revenue grew 7.7% to ₹12,105 crore and its profit grew 27.5% to ₹1,459 crore."
const stockCells = () => [
  { label: "Last close", value: "₹1,284.50", change: "+12.30 (+0.97%) on the day", note: "NSE close, Friday 9 Oct. From your Dhan data." },
  { label: "52-week range", value: "₹1,021.15 – 1,342.80", size: 24, ruler: rangeRuler({ lowPct: 82 }), note: "Low on 12 Jan, high on 24 Sep. The block is today’s close." },
  { label: "Price to earnings", value: "20.7", note: "1,284.50 ÷ 61.98, the basic earnings per share for 2025–26 (annual report, page 213)." },
  { label: "Profit for 2025–26", value: "₹1,459 cr", change: "+27.5% on 2024–25", note: "Consolidated. Revenue ₹12,105 cr, +7.7%." },
]
// A year of NSE closes, 13 Oct 2025 to 10 Oct 2026: from 1,085.00 down to the low of 1,021.15
// on 12 Jan, up to the high of 1,342.80 on 24 Sep, then 1,284.50 on Friday 9 Oct.
function priceSeries() {
  const anchors = [[0, 1085], [24, 1112], [62, 1021.15], [110, 1148], [150, 1196], [190, 1238], [237, 1342.8], [249, 1284.5]]
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5)
  const out = []
  for (let i = 0; i < 250; i++) {
    const k = anchors.findIndex(([d]) => d >= i)
    const [d1, v1] = anchors[Math.max(0, k - 1)], [d2, v2] = anchors[k]
    const base = d2 === d1 ? v2 : v1 + ((v2 - v1) * (i - d1)) / (d2 - d1)
    const fixed = anchors.some(([d]) => d === i)
    out.push(fixed ? base : Math.min(1340, Math.max(1024, base + rnd() * 28)))
  }
  return out
}
// MoodChart's drawing for a reading: ink line, its own domain in whole steps, month labels,
// the year's low and high marked, the last point labelled on a paper halo.
function priceChart({ w = 1168, h = 260, phone = false } = {}) {
  const s = priceSeries()
  const left = phone ? 44 : 56, right = phone ? 12 : 120, top = 16, bottom = 32
  const lo = 900, hi = 1400
  const X = (i) => left + (i / (s.length - 1)) * (w - left - right)
  const Y = (v) => top + ((hi - v) / (hi - lo)) * (h - top - bottom)
  const grid = [900, 1000, 1100, 1200, 1300, 1400].filter((v, i) => !phone || i % 2 === 1).map((v) =>
    `<line x1="${left}" x2="${w - right}" y1="${Y(v)}" y2="${Y(v)}" stroke="${T.inkMuted}" stroke-width="1"></line><text x="${left - 8}" y="${Y(v) + 5}" text-anchor="end" font-size="14" fill="${T.inkMuted}">${v.toLocaleString("en-IN")}</text>`).join("")
  const months = phone ? [["Oct", 0], ["Jan 2026", 62], ["Apr", 120], ["Jul", 183], ["Oct", 249]] : [["Oct", 0], ["Nov", 14], ["Dec", 36], ["Jan 2026", 57], ["Feb", 78], ["Mar", 98], ["Apr", 118], ["May", 139], ["Jun", 161], ["Jul", 182], ["Aug", 205], ["Sep", 226], ["Oct", 249]]
  const monthText = months.map(([m, i], k) => `<text x="${X(i)}" y="${h - 8}" text-anchor="${k === months.length - 1 ? "end" : k === 0 ? "start" : "middle"}" font-size="14" fill="${T.ink}">${m}</text>`).join("")
  const path = s.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ")
  const mark = (i, v, label, anchor, dy) =>
    `<line x1="${X(i)}" x2="${X(i)}" y1="${Y(v) - 6}" y2="${Y(v) + 6}" stroke="${T.ink}" stroke-width="2"></line><text x="${X(i)}" y="${Y(v) + dy}" text-anchor="${anchor}" font-size="14" fill="${T.ink}" stroke="${T.paper}" stroke-width="4" paint-order="stroke">${esc(label)}</text>`
  const last = s.length - 1
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="NSE closes for the last year: low 1,021.15 on 12 January, high 1,342.80 on 24 September, 1,284.50 on Friday 9 October." style="display: block; font-family: ${FONT.replace(/'/g, "&#39;")}; flex-shrink: 0">
${grid}${monthText}
<path d="${path}" fill="none" stroke="${T.ink}" stroke-width="2" stroke-linejoin="round"></path>
${mark(62, 1021.15, phone ? "Low" : "Low 1,021.15, 12 Jan", "middle", 24)}
${mark(237, 1342.8, phone ? "High" : "High 1,342.80, 24 Sep", "end", -12)}
<circle cx="${X(last)}" cy="${Y(s[last])}" r="4" fill="${T.ink}"></circle>
<text x="${X(last) + 10}" y="${Y(s[last]) + 5}" font-size="14" font-weight="700" fill="${T.ink}" stroke="${T.paper}" stroke-width="4" paint-order="stroke">${phone ? "" : "1,284.50 Fri"}</text>
</svg>`
}
function priceBlock({ phone = false } = {}) {
  return col({ gap: 8 }, [
    row({ justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }, [
      el("h3", { margin: 0, fontWeight: 700, fontSize: 17 }, "The last year’s closes"),
      note("NSE, ₹ a share. From your Dhan data."),
    ]),
    priceChart({ w: phone ? 342 : 1168, h: phone ? 200 : 260, phone }),
    button("Show as a table", { variant: "outline", style: { alignSelf: "flex-start", fontSize: 16 } }),
  ])
}
function summaryBlock({ phone = false, cells = stockCells(), sentence = STOCK_SENTENCE, chart = true } = {}) {
  return el("section", { display: "flex", flexDirection: "column", gap: 16 }, [
    el("h2", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: 22, lineHeight: 1.1, letterSpacing: "-0.02em" }, "The stock and the business", { id: "summary" }),
    body(sentence, { fontSize: phone ? 17 : 19, maxWidth: 760 }),
    figureStrip(cells, { phone }),
    chart ? priceBlock({ phone }) : "",
  ], { "aria-labelledby": "summary" })
}
function F1() {
  const insp = inspector({
    w: 360,
    title: "Earnings per share, basic",
    context: "Profit and loss · consolidated · year to 31 March 2026",
    value: "61.98",
    unit: "₹ a share",
    entries: [
      ["From", "Annual report 2025–26, page 213 of 286"],
      ["On the page", "Found in the page’s text"],
      ["Adds up", "No sum covers this line"],
      ["Used in", "Price to earnings, in the summary above"],
      ["Reviewed", "Not yet"],
    ],
    actions: [openPdf(213)],
  })
  return appPage({ active: "Research", research: true, content: [
    companyHeader(),
    summaryBlock(),
    col({ gap: 16 }, [
      el("h2", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: 22, lineHeight: 1.1, letterSpacing: "-0.02em" }, "Statements"),
      row({ gap: 16, flexWrap: "wrap", justifyContent: "space-between" }, [statementSwitch(), basisSwitch()]),
    ]),
    row({ gap: 24, alignItems: "flex-start" }, [
      col({ gap: 8, flex: 1, minWidth: 0 }, [
        row({ justifyContent: "space-between", alignItems: "baseline" }, [pageLine("Consolidated profit and loss, years to 31 March."), note("₹ crore; earnings per share in ₹.")]),
        stmt({ cols: YEAR_COLS, rows: PL_EPS, sel: { r: PL_EPS.length - 2, c: 3 }, colW: 104, fontSize: 15, pad: "9px 12px", restatedYear: "2024–25", caption: "Consolidated profit and loss by year", region: "Profit and loss by year, scrolls sideways" }),
        note("Each year comes whole from the newest filing that prints it, so every column adds up."),
      ]),
      insp,
    ]),
  ] })
}
function F2() {
  const rows = PL.slice(0, 4)
  const yrs = [2, 3]
  const labelW = 136
  const cell = (t) => div({ textAlign: "right", ...NUM, fontSize: 15 }, esc(t))
  const lines = rows.map((r, i) => {
    const b = { borderBottom: i === rows.length - 1 ? 0 : `1px solid ${T.inkMuted}` }
    if (r.kind) return div({ display: "grid", gridTemplateColumns: `${labelW}px 1fr`, ...b }, [div({ padding: "8px 12px 4px", fontSize: 14, fontWeight: 700, color: T.inkMuted, borderRight: `2px solid ${T.ink}` }, esc(r.label)), div({})])
    return div({ display: "grid", gridTemplateColumns: `${labelW}px 1fr`, ...b }, [
      div({ padding: "9px 12px", fontSize: 15, lineHeight: 1.35, borderRight: `2px solid ${T.ink}`, fontWeight: r.sub ? 700 : 400 }, esc(r.label)),
      div({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px", padding: "9px 12px", alignItems: "baseline", fontWeight: r.sub ? 700 : 400 }, yrs.map((y) => cell(fmt(r.v[y])))),
    ])
  })
  const head = div({ display: "grid", gridTemplateColumns: `${labelW}px 1fr`, borderBottom: `2px solid ${T.ink}` }, [
    div({ padding: "8px 12px", fontSize: 14, color: T.inkMuted, borderRight: `2px solid ${T.ink}` }, "Line"),
    div({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px", padding: "8px 12px" }, yrs.map((y) => col({ alignItems: "flex-end" }, [div({ fontWeight: 700, fontSize: 15 }, YEARS[y]), div({ fontSize: 14, color: T.inkMuted, whiteSpace: "nowrap" }, FROM[y])]))),
  ])
  return appPhone({ content: [
    companyHeader({ phone: true }),
    summaryBlock({ phone: true }),
    el("h2", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: 22, lineHeight: 1.1, letterSpacing: "-0.02em" }, "Statements"),
    toggles(["Profit and loss", "Balance sheet", "Cash flow"], "Profit and loss", { size: 15, full: true, label: "Statement" }),
    basisSwitch("Consolidated", { full: true }),
    col({ gap: 8 }, [note("₹ crore. Newest years shown; swipe for earlier ones."), div({ border: `2px solid ${T.ink}` }, [head, ...lines], { role: "region", "aria-label": "Profit and loss by year, scrolls sideways", tabindex: "0" })]),
  ] })
}
// No price: Harbour Cements is not a Nifty 500 share, so the refresher keeps no closes for it.
function F3() {
  const cells = [
    { label: "Last close", value: "—", unknown: true, note: "Maester keeps prices for Nifty 500 shares only, and this isn’t one." },
    { label: "52-week range", value: "—", unknown: true, note: "Needs the year’s closes." },
    { label: "Price to earnings", value: "—", unknown: true, note: "Needs a price. Basic earnings per share for 2025–26 is ₹18.20 (page 164)." },
    { label: "Profit for 2025–26", value: "₹412 cr", change: "−6.1% on 2024–25", note: "Consolidated. Revenue ₹3,882 cr, +3.4%." },
  ]
  const header = col({ gap: 8 }, [
    backTo("Research"),
    appH1("Harbour Cements Limited"),
    div({ fontSize: 17, lineHeight: 1.45 }, "BSE 532118 · CIN L26941GJ1991PLC015733"),
    row({ gap: 8, flexWrap: "wrap", alignItems: "baseline", fontSize: 16 }, [note("Read from 1 annual report:", { fontSize: 16 }), link("2025–26")]),
  ])
  return appPage({ active: "Research", research: true, content: [
    header,
    summaryBlock({ cells, sentence: "In 2025–26 Harbour Cements’ revenue grew 3.4% to ₹3,882 crore and its profit fell 6.1% to ₹412 crore. Maester has no price for it: it keeps closes for Nifty 500 shares only.", chart: false }),
  ] })
}

// ---------- writers ----------
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
const D = 1440, P = 390
const FRAMES = [
  { id: "Main.dc.html", title: "Today 1 · Documents: the slip says Ready, and that’s where it ends", w: D, h: 900, render: T1, row: 0 },
  { id: "T2.dc.html", title: "Today 2 · Research is a coming-soon page", w: D, h: 900, render: T2, row: 0 },
  { id: "A1.dc.html", title: "A1 · The filing, opened — a figure selected, its page beside it in words", w: D, h: 900, render: A1, row: 1 },
  { id: "A2.dc.html", title: "A2 · The filing, opened — phone 390, the figure opens under its row", w: P, h: 844, render: A2, row: 1, phone: true },
  { id: "A3.dc.html", title: "A3 · The filing, opened — a sum that doesn’t add up, a statement that didn’t read", w: D, h: 900, render: A3, row: 1 },
  { id: "B1.dc.html", title: "B1 · The company’s years — Research lists your companies", w: D, h: 900, render: B1, row: 2 },
  { id: "B2.dc.html", title: "B2 · The company’s years — four years from three filings, a restated figure", w: D, h: 900, render: B2, row: 2 },
  { id: "B3.dc.html", title: "B3 · The company’s years — phone 390, line names stay put, years swipe", w: P, h: 844, render: B3, row: 2, phone: true },
  { id: "C1.dc.html", title: "C1 · The page beside the figures — the printed page, the figure boxed", w: D, h: 900, render: C1, row: 3 },
  { id: "C2.dc.html", title: "C2 · The page beside the figures — phone 390, Figures and Page", w: P, h: 844, render: C2, row: 3, phone: true },
  { id: "D1.dc.html", title: "D1 · Sums you can open — the statement as its sums", w: D, h: 900, render: D1, row: 4 },
  { id: "D2.dc.html", title: "D2 · Sums you can open — phone 390, a sum that doesn’t add up", w: P, h: 844, render: D2, row: 4, phone: true },
  { id: "F1.dc.html", title: "F1 · B final — the stock and the business on top, then the years", w: D, h: 900, render: F1, row: 0, page: "final" },
  { id: "F2.dc.html", title: "F2 · B final — phone 390, the summary as a list", w: P, h: 844, render: F2, row: 0, page: "final", phone: true },
  { id: "F3.dc.html", title: "F3 · B final — no price: not a Nifty 500 share", w: D, h: 900, render: F3, row: 0, page: "final" },
]
for (const f of FRAMES) {
  const m = HEIGHTS[f.id]
  if (m) f.h = Math.max(f.phone ? 844 : 900, m.content)
}
fs.mkdirSync(path.join(OUT, "project"), { recursive: true })
fs.mkdirSync(path.join(OUT, "twins"), { recursive: true })
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
// Two pages: the picked final opens first; round 1 stays behind it as the user saw it.
const NOTES = JSON.parse(fs.readFileSync(path.join(HERE, "financials-notes.json"), "utf8"))
const X0 = 720
const boards = {}
const notes = {}
function layout(page, frames, rowNotes, pageId) {
  const rows = [...new Set(frames.map((f) => f.row))].sort((a, b) => a - b)
  const rowH = Object.fromEntries(rows.map((r) => [r, Math.max(...frames.filter((f) => f.row === r).map((f) => f.h))]))
  const rowY = {}
  let y = 0
  for (const r of rows) { rowY[r] = y; y += rowH[r] + 120 + 300 }
  const colX = {}
  for (const f of frames) {
    const x = colX[f.row] ?? X0
    boards[f.id] = { x, y: rowY[f.row], w: f.w, h: f.h, title: f.title, page: pageId }
    colX[f.row] = x + f.w + 80
  }
  rowNotes.forEach((n, i) => {
    const r = rows[i]
    notes[`${page}Title${i}`] = { kind: "title1", text: n.title, x: 0, y: rowY[r] - 260, maxW: colX[r], page: pageId }
    notes[`${page}Note${i}`] = { text: n.note, x: 0, y: rowY[r], w: 600, maxH: Math.min(1600, rowH[r]), size: "l", color: n.color || (i === 0 && page === "r1" ? "red" : "orange"), page: pageId }
  })
  return { rowY, right: Math.max(...Object.values(colX)) }
}
const finalFrames = FRAMES.filter((f) => f.page === "final")
const r1Frames = FRAMES.filter((f) => !f.page)
const fin = layout("fin", finalFrames, NOTES.final.rows, "final")
notes.finQuestions = { text: NOTES.final.questions, x: fin.right + 80, y: 0, w: 640, maxH: 700, size: "l", color: "blue", page: "final" }
const r1 = layout("r1", r1Frames, NOTES.rows, "round1")
notes.r1Shared = { text: NOTES.shared, x: r1.right + 80, y: r1.rowY[1], w: 700, maxH: 1200, size: "m", color: "green", page: "round1" }
notes.r1Questions = { text: NOTES.questions, x: r1.right + 80, y: 0, w: 700, maxH: 700, size: "l", color: "blue", page: "round1" }
const canvas = {
  v: 3,
  createdOnFiles: { v: 1, at: "2026-10-13T10:00:00Z" },
  title: "Maester Financial Tables",
  launch: { view: "canvas", page: "final" },
  pages: [{ id: "final", name: "B · final" }, { id: "round1", name: "Round 1" }],
  boards,
  order: [...r1Frames, ...finalFrames].map((f) => f.id),
  notes,
  designSystems: [],
}
fs.writeFileSync(path.join(OUT, "project", "canvas.json"), JSON.stringify(canvas, null, 2))
console.log("built", FRAMES.length, "frames", FRAMES.map((f) => f.id + ":" + f.h).join(" "))
