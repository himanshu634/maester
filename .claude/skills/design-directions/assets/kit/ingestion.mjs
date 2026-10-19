// node ingestion.mjs [--measure] [ingestion-heights.json] → ../canvas/ingestion/project/*.dc.html, canvas.json, ../canvas/ingestion/twins/*
// Round 1 of the Maester Ingestion Screens canvas (2026-10-19): the Documents screen and the
// Research figure panel under the ingestion pipeline (spec docs/superpowers/specs/
// 2026-10-19-ingestion-pipeline-design.md §6, §11, §12, on docs/document-index-design).
// Today + A/B/C/D + one shared words board. Every state drawn is a value of the `pipeline`
// object in spec §11, or is named as a backend ask in the notes. Figures are synthetic and add up.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { T, FONT, NUM, esc, el, div, row, col, muted, spacer, h2, button, link, tag, spec, ledger } from "./lib.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, "..", "canvas", "ingestion")
const HARG = process.argv.slice(2).find((a) => a.endsWith(".json"))
const HEIGHTS = HARG && fs.existsSync(path.join(HERE, HARG)) ? JSON.parse(fs.readFileSync(path.join(HERE, HARG), "utf8")) : {}
const FONTS = "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&amp;display=swap"

// ---------- type ----------
const appH1 = (t, size = 40, style = {}) =>
  el("h1", { margin: 0, fontStretch: "125%", fontWeight: 800, fontSize: size, lineHeight: 1.1, letterSpacing: "-0.02em", ...style }, esc(t))
const body = (t, style = {}) => el("p", { margin: 0, fontSize: 17, lineHeight: 1.5, maxWidth: 680, ...style }, esc(t))
const note = (t, style = {}) => el("p", { margin: 0, fontSize: 14, lineHeight: 1.45, color: T.inkMuted, ...style }, esc(t))
const strong = (t, style = {}) => el("p", { margin: 0, fontSize: 17, lineHeight: 1.5, fontWeight: 700, ...style }, esc(t))
const h3 = (t, style = {}) => el("h3", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: 22, lineHeight: 1.2, ...style }, esc(t))
const h4 = (t, style = {}) => el("h4", { margin: 0, fontWeight: 700, fontSize: 17, lineHeight: 1.3, ...style }, esc(t))
const sm = (t, style = {}) => div({ fontSize: 14, lineHeight: 1.45, color: T.inkMuted, ...style }, esc(t))
const synth = () => tag("Synthetic example", { style: { color: T.ink } })
const nameBtn = (t, style = {}) =>
  el("button", { padding: 0, border: 0, background: "transparent", fontFamily: "inherit", fontSize: 16, fontWeight: 400, color: T.ink, textAlign: "left", textDecoration: "underline", textUnderlineOffset: "3px", textDecorationThickness: "1.5px", cursor: "pointer", overflowWrap: "anywhere", ...style }, esc(t), { type: "button" })
const outline = (t, style = {}) => button(t, { variant: "outline", style: { fontSize: 16, ...style } })
const primary = (t, style = {}) => button(t, { style: { fontSize: 16, ...style } })
const B = (t) => `<strong>${esc(t)}</strong>`
const M = (t) => `<span style="color: ${T.inkMuted}">${esc(t)}</span>`

// ---------- terminal shell (TerminalShell.svelte + lib/terminal/pages.ts, 19 Oct 2026) ----------
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
function railNav(active) {
  const items = (labels) => labels.map((l) => navItem(l, { current: l === active, soon: !LIVE.has(l) }))
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
function appPage({ active = "Documents", content }) {
  return div({ display: "flex", flexDirection: "row", alignItems: "stretch", width: 1440, height: 900, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper, boxSizing: "border-box" }, [
    railNav(active),
    col({ flex: 1, minWidth: 0 }, [
      context(),
      el("main", { display: "flex", flexDirection: "column", padding: "32px 24px 48px", gap: 28, minWidth: 0 }, content),
    ]),
  ])
}
function appPhone({ content }) {
  return div({ display: "flex", flexDirection: "column", width: 390, height: 844, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper, boxSizing: "border-box" }, [
    row({ height: 56, padding: "0 16px 0 24px", borderBottom: `2px solid ${T.ink}`, flexShrink: 0, justifyContent: "space-between", boxSizing: "border-box" }, [
      el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink }, "Maester", { href: "#" }),
      button("Menu", { variant: "outline", style: { padding: "0 16px", fontSize: 16 } }),
    ]),
    context(),
    el("main", { display: "flex", flexDirection: "column", padding: "24px 24px 40px", gap: 24, minWidth: 0 }, content),
  ])
}

// ---------- shared pieces ----------
// The loader's ruler: a 2px rule, an ink block an eighth of its length, 6px tall. Drawn mid-step.
const ruler = ({ at = 0.375, w = "100%" } = {}) =>
  div({ position: "relative", width: w, height: 6, flexShrink: 0 }, [
    div({ position: "absolute", left: 0, right: 0, top: 2, height: 2, background: T.ink }),
    div({ position: "absolute", left: `${at * 100}%`, width: "12.5%", top: 0, height: 6, background: T.ink }),
  ], { "aria-hidden": "true" })
function notice({ title, detail, actions = [], role = "alert", style = {} }) {
  return div({ border: `2px solid ${T.ink}`, padding: 16, display: "flex", flexDirection: "column", gap: 8, ...style }, [
    strong(title),
    ...(Array.isArray(detail) ? detail : [detail]).filter(Boolean).map((d) => (d.startsWith("<") ? d : body(d, { fontSize: 16 }))),
    actions.length ? row({ gap: 12, flexWrap: "wrap", marginTop: 4 }, actions) : "",
  ], { role })
}
// The drop strip: a 2px dashed box. Several files and folders; the limit is said before anything is chosen.
function dropStrip({ mode = "idle", phone = false, sent, total, folder, title = "Drop PDFs or XBRL files here", limit = "PDF or XBRL (.xml), up to 50 MB a file. A whole folder works too." } = {}) {
  const box = { border: `2px dashed ${T.ink}`, padding: phone ? 16 : "20px 24px", boxSizing: "border-box" }
  if (mode === "sent")
    return div({ ...box, display: "flex", flexDirection: phone ? "column" : "row", alignItems: phone ? "stretch" : "center", gap: phone ? 12 : 24, flexWrap: "wrap" }, [
      col({ gap: 2, flex: 1, minWidth: 0 }, [strong(`${total} files sent from ${folder}.`), note("Drop more, or choose files or a folder. PDF or XBRL (.xml), up to 50 MB a file.")]),
      row({ gap: 12, flexWrap: "wrap" }, [outline("Choose files"), outline("Choose a folder")]),
    ])
  if (mode === "sending")
    return div({ ...box, display: "flex", flexDirection: "column", gap: 12 }, [
      row({ gap: 16, flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline" }, [
        strong(`Sending ${sent} of ${total} files from ${folder}…`),
        note("Files already sent are being worked on."),
      ]),
      ruler(),
      note("Closing or reloading this tab stops the rest. Moving to another page doesn’t."),
      el("p", { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }, esc(`Sending ${total} files.`), { role: "status" }),
    ])
  return div({ ...box, display: "flex", flexDirection: phone ? "column" : "row", alignItems: phone ? "stretch" : "center", gap: phone ? 12 : 24, flexWrap: "wrap" }, [
    col({ gap: 2, flex: 1, minWidth: 0 }, [strong(title), note(limit)]),
    row({ gap: 12, flexWrap: "wrap" }, [outline("Choose files"), outline("Choose a folder")]),
  ])
}
// A summary of what a batch refused: said once, never a notice per file.
const refusedLine = () =>
  notice({
    title: "3 of the 806 files weren’t added.",
    detail: [
      el("ul", { margin: 0, paddingLeft: 20, fontSize: 16, lineHeight: 1.5 }, [
        el("li", {}, `${B("readme.txt")}: not a PDF or an XBRL file.`),
        el("li", {}, `${B("532770_Q4_FY25.xml")}: XML, but not an XBRL instance.`),
        el("li", {}, `${B("Annual-Report-2015.pdf")}: 61 MB. Maester takes files up to 50 MB.`),
      ]),
    ],
    actions: [outline("Choose files to add")],
  })

// ---------- the synthetic workspace, Monday 19 Oct 2026 ----------
// Files dropped at 14:02. Index jobs run one at a time (spec §9), up to an hour each.
const DOCS = {
  scPdf: { name: "synthetic-cements-q2-2026-27.pdf", co: "Synthetic Cements", what: "Results, quarter to 30 Sep 2026", fmt: "PDF" },
  scXml: { name: "500999_Q2_FY27_Consolidated.xml", co: "Synthetic Cements", what: "Results, quarter to 30 Sep 2026", fmt: "XBRL" },
  hcAr: { name: "harbour-cements-ar-2025-26.pdf", co: "Harbour Cements", what: "Annual report 2025–26", fmt: "PDF" },
  cbXml: { name: "532999_Q2_FY27_Standalone.xml", co: "Coastline Bank", what: "Results, quarter to 30 Sep 2026", fmt: "XBRL" },
  cbPdf: { name: "coastline-bank-q2-2026-27.pdf", co: "Coastline Bank", what: "Results, quarter to 30 Sep 2026", fmt: "PDF" },
  mtPdf: { name: "meridian-q2.pdf", co: "—", what: "Results, quarter to 30 Sep 2026", fmt: "PDF" },
  npXml: { name: "524999_Q1_FY27_Consolidated.xml", co: "Northfield Pharma", what: "Results, quarter to 30 Jun 2026", fmt: "XBRL" },
  npPdf: { name: "northfield-pharma-q1-2026-27.pdf", co: "Northfield Pharma", what: "Results, quarter to 30 Jun 2026", fmt: "PDF" },
}
// Words for the two tracks (shared by every direction; the board S1 lists them all).
const W = {
  numXbrlNow: ["From XBRL", "Reading now"],
  numWaiting: ["Waiting for XBRL", "500999_Q2_FY27_Consolidated.xml is being read. Gemini reads only what it doesn’t cover."],
  numNotNeeded: ["Not needed", "The XBRL file covers all three statements."],
  numPdfNow: ["Read from the PDF", "Now"],
  numUnmapped: ["Not read from XBRL", "Banking format, not mapped yet. The PDF’s numbers are read instead."],
  textNow: ["Page 140 of 286", "38 pages by OCR · 412 passages so far"],
  textInLine: ["In line", "One file is indexed at a time."],
  textXbrlDone: ["12 notes indexed", "Text from the XBRL file. It has no pages."],
  textDone: ["22 pages indexed", "4 by OCR · 61 passages"],
}

// ---------- the synthetic figures: Synthetic Cements, profit and loss, consolidated, ₹ crore ----------
// 2025–26 from the Q4 results XBRL (assumes yes to the open Q4 question); earlier years from annual reports.
// Each column adds up: total income = revenue + other income; profit before tax = total income − expenses; profit = PBT − tax.
const PL = [
  { label: "Revenue from operations", v: ["10,240", "11,240", "12,105.31"] },
  { label: "Other income", v: ["182", "201", "214.06"] },
  { label: "Total income", v: ["10,422", "11,441", "12,319.37"], sub: true },
  { label: "Total expenses", v: ["9,010", "9,795", "10,401.52"], sub: true },
  { label: "Profit before tax", v: ["1,412", "1,646", "1,917.85"], sub: true },
  { label: "Tax expense", v: ["368", "502", "458.85"] },
  { label: "Profit for the year", v: ["1,044", "1,144", "1,459.00"], sub: true },
]
const YEAR_COLS = [
  { head: "2023–24", sub: "AR 2023–24" },
  { head: "2024–25", sub: "AR 2024–25" },
  { head: "2025–26", sub: "Q4 results, XBRL" },
]
function stmt({ cols = YEAR_COLS, rows = PL, sel = { r: 0, c: 2 }, colW = 132, fontSize = 16 }) {
  const tracks = ["minmax(0, 1fr)", ...cols.map(() => `${colW}px`)].join(" ")
  const grid = (cells, extra = {}) => div({ display: "grid", gridTemplateColumns: tracks, gap: "0 12px", alignItems: "baseline", padding: "10px 16px", ...extra }, cells)
  const head = grid([
    div({ fontSize: 14, color: T.inkMuted }, "Line, as filed"),
    ...cols.map((c) => col({ alignItems: "flex-end", gap: 0, textAlign: "right" }, [div({ fontSize: 16, fontWeight: 700, ...NUM }, esc(c.head)), div({ fontSize: 14, color: T.inkMuted, lineHeight: 1.3, whiteSpace: "nowrap" }, esc(c.sub))])),
  ], { borderBottom: `2px solid ${T.ink}`, alignItems: "end" })
  const bodyRows = rows.map((r, ri) =>
    grid([
      div({ fontWeight: r.sub ? 700 : 400 }, esc(r.label)),
      ...r.v.map((v, ci) => {
        const s = { textAlign: "right", ...NUM, fontWeight: r.sub ? 700 : 400 }
        if (sel && sel.r === ri && sel.c === ci) return div({ ...s, justifySelf: "end", background: T.ink, color: T.paper, padding: "2px 8px", margin: "-2px -8px", outline: `3px solid ${T.ink}`, outlineOffset: 2 }, esc(v))
        return div(s, esc(v))
      }),
    ], { fontSize, lineHeight: 1.45, borderBottom: ri === rows.length - 1 ? 0 : `1px solid ${T.inkMuted}` }),
  )
  return div({ border: `2px solid ${T.ink}`, flexShrink: 0 }, [head, ...bodyRows], { role: "table", "aria-label": "Profit and loss, consolidated, ₹ crore" })
}
function toggles(labels, on, label) {
  return row({ gap: 0, flexWrap: "wrap" }, labels.map((l, i) =>
    el("button", { minHeight: 44, padding: "0 16px", fontFamily: "inherit", fontSize: 16, fontWeight: 700, border: `2px solid ${T.ink}`, marginLeft: i ? -2 : 0, background: l === on ? T.ink : "transparent", color: l === on ? T.paper : T.ink, borderRadius: 0, cursor: "pointer" }, esc(l), { type: "button", "aria-pressed": l === on ? "true" : "false" }),
  ), { role: "group", "aria-label": label })
}
const companyHead = (q4 = "XBRL and PDF") =>
  col({ gap: 8 }, [
    appH1("Synthetic Cements Limited"),
    note("NSE SYNCEM · BSE 500999 · CIN L26942MH1994PLC000001"),
    body(`Read from: annual reports 2023–24 and 2024–25; Q4 results 2025–26 (${q4}).`, { fontSize: 16 }),
  ])
const NEW_TABLE_NOTE = "Each year comes whole from one filing: an XBRL filing first, otherwise the newest filing that prints it, so a column never mixes filings or sources."
// The selected figure's evidence, as a spec list.
function inspector({ entries, actions = [], lead, w = 420, phone = false, eyebrow = "Selected figure" }) {
  return el("aside", { display: "flex", flexDirection: "column", gap: 16, width: phone ? "auto" : w, flexShrink: 0, paddingLeft: phone ? 0 : 24, borderLeft: phone ? 0 : `2px solid ${T.ink}`, boxSizing: "border-box" }, [
    col({ gap: 4 }, [note(eyebrow), h3("Revenue from operations"), note("Profit and loss · consolidated · year to 31 Mar 2026")]),
    row({ gap: 10, alignItems: "baseline" }, [div({ fontStretch: "110%", fontWeight: 700, fontSize: 40, lineHeight: 1.05, letterSpacing: "-0.02em", ...NUM }, "12,105.31"), note("₹ crore")]),
    lead || "",
    spec(entries, { termW: phone ? 104 : 120 }),
    ...actions,
  ], { "aria-label": "Selected figure" })
}
const researchFrame = (panel, { extra = "", q4 } = {}) =>
  appPage({
    active: "Research",
    content: [
      link("← Research", { style: { fontSize: 16, alignSelf: "flex-start" } }),
      companyHead(q4),
      col({ gap: 12 }, [h2("Statements", 22), row({ gap: 16, flexWrap: "wrap" }, [toggles(["Profit and loss", "Balance sheet", "Cash flow"], "Profit and loss", "Statement"), toggles(["Consolidated", "Standalone"], "Consolidated", "Basis")])]),
      row({ gap: 0, alignItems: "flex-start" }, [
        col({ flex: 1, minWidth: 0, gap: 12, paddingRight: 24 }, [stmt({}), note(NEW_TABLE_NOTE), extra]),
        panel,
      ]),
    ],
  })

// ---------- Today ----------
// T1: the Documents page as built (DESIGN.md §5 Drop strip, Stage ladder, Slip, Earlier list).
function ladder4(words, states) {
  const names = ["Uploaded", "Worked out what it is", "Reading the statements", "Ready"]
  return el("ol", { listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, names.map((n, i) => {
    const on = states[i] === "now" || states[i] === "needs"
    return el("li", { display: "flex", flexDirection: "column", gap: 4, padding: "12px", borderLeft: i ? `1px solid ${T.inkMuted}` : 0, background: on ? T.ink : "transparent", color: on ? T.paper : T.ink }, [
      div({ fontSize: 14, color: on ? T.paperMuted : T.inkMuted }, String(i + 1)),
      div({ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }, esc(n)),
      div({ fontSize: 14, fontWeight: on || states[i] === "stopped" ? 700 : 400, color: on ? T.paper : states[i] === "done" ? T.ink : T.inkMuted }, esc(words[i])),
    ])
  }), { "aria-label": "Where this file stands" })
}
function T1() {
  const slip = div({ border: `2px solid ${T.ink}`, padding: 24, display: "flex", flexDirection: "column", gap: 20, flex: 1.6, minWidth: 0 }, [
    col({ gap: 2 }, [h2(DOCS.hcAr.name, 22), note("added 14:02")]),
    ladder4(["Done", "Done", "Now", "Next"], ["done", "done", "now", "next"]),
    col({ gap: 8 }, [h4("Read as"), spec([
      ["What it is", `Annual report<br>${M("Page 1: “Annual Report 2025–26”")}`],
      ["Company", `Harbour Cements Limited<br>${M("Page 3: “CIN L26943GJ2001PLC000002”")}`],
      ["Period", "Year to 31 Mar 2026"],
      ["Statements", "Profit and loss, balance sheet, cash flow · consolidated and standalone"],
    ])]),
  ])
  const earlier = col({ flex: 1, minWidth: 0, gap: 12 }, [
    h2("Earlier", 22),
    ledger({
      cols: [{ label: "Name", w: "minmax(0, 1.4fr)" }, { label: "What it is" }, { label: "Where it stands" }],
      rows: [
        [nameBtn("northfield-pharma-q1-2026-27.pdf"), "Financial results", "Ready"],
        [nameBtn("synthetic-cements-ar-2024-25.pdf"), "Annual report", "Ready"],
        [nameBtn("synthetic-cements-ar-2023-24.pdf"), "Annual report", "Ready"],
      ],
    }),
  ])
  return appPage({
    content: [
      col({ gap: 8 }, [appH1("Documents"), body("Add a filing and Maester works out what it is, then reads it. Wrong guess? Change it and it’s read again.")]),
      col({ gap: 12 }, [
        dropStrip({ title: "Drop a PDF here", limit: "Annual reports, quarterly results or any other company document. PDF, up to 50 MB." }),
        notice({ title: "This file isn’t a PDF.", detail: "Save it as a PDF and add it again.", actions: [outline("Choose another file")] }),
      ]),
      row({ gap: 32, alignItems: "flex-start" }, [slip, earlier]),
      note("Leaving this page doesn’t stop anything. The slip is here when you come back."),
    ],
  })
}
// T2: the figure panel as built, with the page it needs.
function T2() {
  const panel = inspector({
    entries: [
      ["From", "Annual report 2025–26, page 213 of 286"],
      ["On the page", "Found in the page’s text"],
      ["Adds up", "Part of total income, which adds up"],
      ["Reviewed", "Not yet"],
    ],
    actions: [outline("Open the PDF at page 213", { alignSelf: "flex-start" }), note("Opens the stored PDF in a new tab.")],
  })
  return appPage({
    active: "Research",
    content: [
      link("← Research", { style: { fontSize: 16, alignSelf: "flex-start" } }),
      companyHead(),
      col({ gap: 12 }, [h2("Statements", 22), row({ gap: 16 }, [toggles(["Profit and loss", "Balance sheet", "Cash flow"], "Profit and loss", "Statement"), toggles(["Consolidated", "Standalone"], "Consolidated", "Basis")])]),
      row({ gap: 0, alignItems: "flex-start" }, [
        col({ flex: 1, minWidth: 0, gap: 12, paddingRight: 24 }, [
          stmt({ cols: [{ head: "2023–24", sub: "AR 2023–24" }, { head: "2024–25", sub: "AR 2024–25" }, { head: "2025–26", sub: "AR 2025–26" }], rows: PL.map((r) => ({ ...r, v: [r.v[0], r.v[1], r.v[2].replace(/\.\d\d$/, "")] })) }),
          note("Each year comes whole from the newest filing that prints it, so a column never mixes filings."),
        ]),
        panel,
      ]),
    ],
  })
}

// ---------- shared words (S1) ----------
function S1() {
  const sec = (t, rows) =>
    col({ gap: 10 }, [h3(t), ledger({ cols: [{ label: "When", w: "minmax(0, 0.9fr)" }, { label: "The words", w: "minmax(0, 1.6fr)" }], rows, fontSize: 16 })])
  return div({ width: 1440, height: 900, boxSizing: "border-box", padding: 48, fontFamily: FONT, color: T.ink, background: T.paper, display: "flex", flexDirection: "column", gap: 32 }, [
    col({ gap: 8 }, [appH1("Words every direction uses"), body("Each state of the pipeline object (spec §11) and each outcome of the PDF check, said once, the same way on every screen. Bold where the investor should look.")]),
    div({ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 40 }, [
      col({ gap: 32 }, [
        sec("Numbers track", [
          ["source xbrl · now", "From XBRL · Reading now"],
          ["source xbrl · done", "From XBRL · Done. Checked against the PDF: 214 of 214 found."],
          ["source pdf · now", "Read from the PDF · Now"],
          ["not_needed", "Not needed · The XBRL file covers all three statements. (links to it)"],
          ["waiting", "Waiting for XBRL · 500999_Q2_FY27_Consolidated.xml is being read. Gemini reads only what it doesn’t cover."],
          ["failed", `${B("Stopped")} · Maester couldn’t read the numbers. Try again.`],
          ["XBRL_FORMAT_UNMAPPED (ask)", "Not read from XBRL · Banking format, not mapped yet. The PDF’s numbers are read instead."],
          ["partial cover (ask)", "From XBRL: profit and loss, balance sheet. From the PDF: cash flow."],
        ]),
        sec("Text track", [
          ["pdf · now", "Page 140 of 286 · 38 pages by OCR · 412 passages so far"],
          ["pdf · done", "286 pages indexed · 41 by OCR · 1,388 passages"],
          ["xbrl · done", "12 notes indexed · Text from the XBRL file. It has no pages."],
          ["waiting", "In line · One file is indexed at a time. (2 ahead: ask)"],
          ["partial", `${B("Indexed, 3 pages without text")} · OCR found nothing on pages 41, 42 and 97.`],
          ["failed", `${B("Stopped")} · The text wasn’t indexed. Your numbers aren’t affected. Try again.`],
        ]),
      ]),
      col({ gap: 32 }, [
        sec("The PDF check on an XBRL figure (xbrl_in_pdf)", [
          ["passed", "Found on the PDF’s statement pages (4–6)."],
          ["failed", `${B("Not found on the PDF’s statement pages (4–6).")} The figure stays as filed in XBRL. Check the PDF yourself.`],
          ["not_checked · no PDF", "Not checked: no PDF of these results is in your documents."],
          ["not_checked · scan", "Not checked: the PDF’s statement pages are scanned, so their text can’t be searched."],
          ["not_checked · no pages", "Not checked: Maester didn’t find the statement pages in the PDF."],
          ["not_checked · off", "Not checked: the check is turned off."],
        ]),
        sec("Where an XBRL figure comes from", [
          ["From", "Q4 results 2025–26, XBRL file (500999_Q4_FY26_Consolidated.xml)"],
          ["Filed as", "Revenue from operations, 1 Apr 2025 to 31 Mar 2026, rounded to the lakh. Tagged RevenueFromOperations."],
          ["Never", "A context id (OneD, FourD), a confidence, “verified”."],
        ]),
        sec("What is said aloud", [
          ["A batch", "Once at the start (“Sending 806 files.”), once at the end (“806 files sent. 31 companies need you.”)."],
          ["Needs you", "Each new question, once (“Coastline Bank needs you: confirm the company.”)."],
          ["Everything else", "Not announced. The page says it; nothing floods a screen reader."],
        ]),
      ]),
    ]),
  ])
}

// ---------- A · Two tracks on the slip ----------
// Today's page, kept. The ladder keeps four steps; step 3 holds the two tracks, one above the other.
function ladderA({ num, text, states = ["done", "done", null, "next"], phone = false }) {
  const cell = (n, name, word, st, extra = {}) => {
    const on = st === "now" || st === "needs"
    return el("li", { display: "flex", flexDirection: "column", gap: 4, padding: 12, background: on ? T.ink : "transparent", color: on ? T.paper : T.ink, ...extra }, [
      n ? div({ fontSize: 14, color: on ? T.paperMuted : T.inkMuted }, String(n)) : "",
      div({ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }, esc(name)),
      div({ fontSize: 14, lineHeight: 1.4, fontWeight: on ? 700 : 400, color: on ? T.paper : st === "done" ? T.ink : T.inkMuted }, esc(word)),
    ])
  }
  const track = (label, [w1, w2], st) => {
    const on = st === "now" || st === "needs"
    return div({ display: "grid", gridTemplateColumns: "84px minmax(0, 1fr)", gap: 8, padding: "10px 12px", background: on ? T.ink : "transparent", color: on ? T.paper : T.ink }, [
      div({ fontSize: 14, fontWeight: 700 }, esc(label)),
      col({ gap: 2, minWidth: 0 }, [div({ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }, esc(w1)), div({ fontSize: 14, lineHeight: 1.4, color: on ? T.paperMuted : T.inkMuted }, esc(w2))]),
    ])
  }
  const third = el("li", { display: "flex", flexDirection: "column", borderLeft: phone ? 0 : `1px solid ${T.inkMuted}`, borderTop: phone ? `1px solid ${T.inkMuted}` : 0 }, [
    div({ padding: "12px 12px 4px" }, [div({ fontSize: 14, color: T.inkMuted }, "3"), div({ fontSize: 16, fontWeight: 700 }, "Reading")]),
    track("Numbers", num.w, num.st),
    div({ borderTop: `1px solid ${T.inkMuted}` }),
    track("Text", text.w, text.st),
  ])
  const sep = phone ? { borderTop: `1px solid ${T.inkMuted}` } : { borderLeft: `1px solid ${T.inkMuted}` }
  return el("ol", { listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: phone ? "minmax(0, 1fr)" : "minmax(0, 0.7fr) minmax(0, 0.9fr) minmax(0, 2.2fr) minmax(0, 0.6fr)", borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, [
    cell(1, "Uploaded", "Done", states[0]),
    cell(2, "Worked out what it is", "Done", states[1], sep),
    third,
    cell(4, "Ready", "Next", states[3], sep),
  ], { "aria-label": "Where this file stands" })
}
const docsCols = [{ label: "Name", w: "minmax(0, 1.5fr)" }, { label: "Numbers", w: "minmax(0, 1fr)" }, { label: "Text", w: "minmax(0, 1fr)" }]
const trackWords = ([a, b], bold = false) => `<div style="font-weight: ${bold ? 700 : 400}">${esc(a)}</div><div style="font-size: 14px; color: ${T.inkMuted}">${esc(b)}</div>`
function A1() {
  const d = DOCS.scPdf
  const slip = div({ border: `2px solid ${T.ink}`, padding: 24, display: "flex", flexDirection: "column", gap: 20, flex: 1.25, minWidth: 0 }, [
    col({ gap: 2 }, [h2(d.name, 22), note("added 14:02 with 5 other files")]),
    ladderA({ num: { w: ["Waiting for XBRL", "Its XBRL file is being read. Gemini reads only what XBRL doesn’t cover."], st: "now" }, text: { w: ["In line", "2 ahead. One file is indexed at a time."], st: "next" } }),
    col({ gap: 8 }, [h4("Read as"), spec([
      ["What it is", `Financial results, quarter to 30 Sep 2026<br>${M("Page 1: “Unaudited financial results for the quarter ended 30 September 2026”")}`],
      ["Company", `Synthetic Cements Limited<br>${M("Page 1: “BSE 500999”")}`],
      ["Statements", "Profit and loss, balance sheet · consolidated · pages 4–6"],
    ])]),
  ])
  const list = col({ flex: 1.45, minWidth: 0, gap: 12 }, [
    row({ justifyContent: "space-between", alignItems: "baseline" }, [h2("Your documents", 22), note("7 working, 1 needs you")]),
    ledger({
      cols: docsCols,
      rowPad: "10px 12px",
      fontSize: 16,
      rows: [
        [nameBtn(DOCS.mtPdf.name) + `<div style="font-size: 14px; font-weight: 700">Needs you: confirm the company</div>`, M("—"), M("In line")],
        [nameBtn(DOCS.scXml.name), trackWords(W.numXbrlNow), trackWords(["In line", "Text from the XBRL file"])],
        [nameBtn(DOCS.scPdf.name, { fontWeight: 700 }), trackWords(["Waiting for XBRL", "the file above"]), trackWords(["In line", "2 ahead"])],
        [nameBtn(DOCS.hcAr.name), trackWords(W.numPdfNow), trackWords(W.textNow)],
        [nameBtn(DOCS.cbXml.name), trackWords(["Not read from XBRL", "Banking format, not mapped yet"]), trackWords(["In line", ""])],
        [nameBtn(DOCS.cbPdf.name), trackWords(["Read from the PDF", "Next"]), trackWords(["In line", ""])],
        [nameBtn(DOCS.npPdf.name), trackWords(W.numNotNeeded), trackWords(W.textDone)],
      ],
    }),
  ])
  return appPage({
    content: [
      col({ gap: 8 }, [appH1("Documents"), body("Add filings, PDF or XBRL, as many at once as you like. Maester works out what each one is, takes the numbers from XBRL when a filing has it, and indexes every page’s text.")]),
      dropStrip({}),
      row({ gap: 32, alignItems: "flex-start" }, [slip, list]),
      note("Leaving this page doesn’t stop anything. The slip is here when you come back."),
    ],
  })
}
function A2() {
  const d = DOCS.cbXml
  const slip = div({ border: `2px solid ${T.ink}`, padding: 24, display: "flex", flexDirection: "column", gap: 20, flex: 1.25, minWidth: 0 }, [
    col({ gap: 2 }, [h2(d.name, 22), note("added 14:10 from bse-xbrl")]),
    ladderA({ num: { w: ["Waits for the company", ""], st: "next" }, text: { w: ["Waits for the company", ""], st: "next" }, states: ["done", "needs", null, "next"] }),
    div({ border: `2px solid ${T.ink}`, padding: 16, display: "flex", flexDirection: "column", gap: 12 }, [
      strong("Is this Coastline Bank Limited?"),
      body("Maester hasn’t seen this company in your workspace. 26 of the files you just added print the same company:", { fontSize: 16 }),
      spec([
        ["BSE code", `532999 ${M("ScripCode, in all 26 files")}`],
        ["NSE symbol", `COASTBANK ${M("Symbol")}`],
        ["ISIN", `INE999Z01011 ${M("ISIN")}`],
      ], { termW: 110 }),
      row({ gap: 12, flexWrap: "wrap" }, [primary("Add Coastline Bank for all 26 files"), outline("It’s one of my companies")]),
      note("30 more companies to confirm after this one. Each is asked once, for all its files."),
    ], { role: "group", "aria-label": "Confirm the company" }),
  ])
  const list = col({ flex: 1.45, minWidth: 0, gap: 12 }, [
    row({ justifyContent: "space-between", alignItems: "baseline" }, [h2("Your documents", 22), note("Showing the 50 most recent")]),
    ledger({
      cols: docsCols,
      rowPad: "10px 12px",
      rows: [
        [nameBtn("532999_Q2_FY27_Standalone.xml", { fontWeight: 700 }) + `<div style="font-size: 14px; font-weight: 700">Needs you: confirm the company</div>`, M("—"), M("—")],
        [nameBtn("532999_Q1_FY27_Standalone.xml") + `<div style="font-size: 14px; font-weight: 700">Needs you: confirm the company</div>`, M("—"), M("—")],
        [nameBtn("500999_Q1_FY27_Consolidated.xml"), trackWords(["From XBRL", "Done"]), trackWords(["In line", "41 ahead"])],
        [nameBtn("500999_Q4_FY26_Consolidated.xml"), trackWords(["From XBRL", "Done"]), trackWords(["In line", "40 ahead"])],
        [nameBtn("524999_Q1_FY27_Consolidated.xml"), trackWords(["From XBRL", "Reading now"]), trackWords(["In line", ""])],
        [nameBtn(DOCS.hcAr.name), trackWords(W.numPdfNow), trackWords(W.textNow)],
      ],
    }),
  ])
  return appPage({
    content: [
      col({ gap: 8 }, [appH1("Documents"), body("Add filings, PDF or XBRL, as many at once as you like. Maester works out what each one is, takes the numbers from XBRL when a filing has it, and indexes every page’s text.")]),
      col({ gap: 12 }, [dropStrip({ mode: "sending", sent: 214, total: 806, folder: "bse-xbrl" }), refusedLine()]),
      row({ gap: 32, alignItems: "flex-start" }, [slip, list]),
    ],
  })
}
function A3() {
  return researchFrame(
    inspector({
      entries: [
        ["From", "Q4 results 2025–26, XBRL file"],
        ["Filed as", `Year to 31 Mar 2026, in ₹ crore as the filing declares${"<br>"}${M("Tagged RevenueFromOperations")}`],
        ["In the PDF", "Found on the results PDF’s statement pages (4–6)."],
        ["Adds up", "Part of total income, which adds up"],
        ["Reviewed", "Not yet"],
      ],
      actions: [outline("Open the results PDF at page 4", { alignSelf: "flex-start" }), note("An XBRL file has no pages. This opens the results PDF where its statements start, the pages Maester checked.")],
    }),
  )
}

// ---------- B · The work list ----------
// The batch is the unit: one ledger of every file, grouped by what it needs; the slip opens beside it.
function countStrip(cells, { phone = false } = {}) {
  return div({ display: "grid", gridTemplateColumns: phone ? "repeat(2, minmax(0, 1fr))" : `repeat(${cells.length}, minmax(0, 1fr))`, borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, cells.map(([k, v, n], i) =>
    col({ gap: 2, padding: "12px 16px", paddingLeft: i === 0 || (phone && i % 2 === 0) ? 0 : 16, borderLeft: (phone ? i % 2 : i) ? `1px solid ${T.inkMuted}` : 0, borderTop: phone && i > 1 ? `1px solid ${T.inkMuted}` : 0 }, [
      sm(k),
      div({ fontStretch: "110%", fontSize: 32, fontWeight: 700, lineHeight: 1.1, ...NUM }, esc(v)),
      n ? note(n) : "",
    ]),
  ))
}
const B_COUNTS = [
  ["Need you", "31", "companies to confirm, for 214 files"],
  ["Numbers being read", "2", "2 at a time; 3 PDFs wait for XBRL"],
  ["Text being indexed", "1", "1 at a time; 562 in line"],
  ["Ready", "9", "numbers and text both done"],
  ["Stopped", "0", ""],
]
function trackTable(rowsDef) {
  // Two tracks, one line each, with a word per step. The current step is an ink block.
  return div({ borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, rowsDef.map(([label, steps], ri) =>
    div({ display: "grid", gridTemplateColumns: `80px repeat(${steps.length}, minmax(0, 1fr))`, borderTop: ri ? `1px solid ${T.inkMuted}` : 0 }, [
      div({ fontSize: 16, fontWeight: 700, padding: "12px 0" }, esc(label)),
      ...steps.map(([name, word, st], i) => {
        const on = st === "now"
        return el("div", { padding: "12px 10px", borderLeft: `1px solid ${T.inkMuted}`, background: on ? T.ink : "transparent", color: on ? T.paper : T.ink, display: "flex", flexDirection: "column", gap: 2 }, [
          div({ fontSize: 14, color: on ? T.paperMuted : T.inkMuted }, esc(name)),
          div({ fontSize: 15, fontWeight: on || st === "done" ? 700 : 400, color: on ? T.paper : st === "done" ? T.ink : T.inkMuted, lineHeight: 1.35 }, esc(word)),
        ])
      }),
    ]),
  ), { role: "group", "aria-label": "Where this file stands, numbers and text" })
}
function B1() {
  const g = (t, n) => div({ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", padding: "14px 12px 6px", borderTop: `2px solid ${T.ink}`, fontSize: 16, fontWeight: 700 }, `${esc(t)} ${M(n)}`)
  const r = (cells, sel) =>
    div({ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 12, padding: "10px 12px", borderTop: `1px solid ${T.inkMuted}`, alignItems: "baseline", outline: sel ? `3px solid ${T.ink}` : 0, outlineOffset: -3 }, cells.map((c) => div({ minWidth: 0 }, c)))
  const list = col({ flex: 1.3, minWidth: 0, gap: 12 }, [
    toggles(["All 806", "Need you 214", "Working 3", "In line 562", "Ready 9"], "All 806", "Show"),
    div({ border: `2px solid ${T.ink}` }, [
      div({ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 12, padding: "10px 12px", fontSize: 14, color: T.inkMuted }, ["File", "Numbers", "Text"].map((t) => div({}, t))),
      g("Need you", "214 files, 31 companies"),
      r([nameBtn("532999_Q2_FY27_Standalone.xml") + sm("Coastline Bank? and 25 more files"), B("Confirm the company"), M("Waits")]),
      r([nameBtn(DOCS.mtPdf.name) + sm("Company not on the first pages"), B("Say which company"), M("Waits")]),
      g("Working", "3"),
      r([nameBtn(DOCS.scPdf.name) + sm("Synthetic Cements · Q2"), trackWords(["Waiting for XBRL", "500999_Q2_FY27…"]), trackWords(["In line", "2 ahead"])], true),
      r([nameBtn(DOCS.scXml.name) + sm("Synthetic Cements · Q2"), trackWords(W.numXbrlNow), trackWords(["In line", "1 ahead"])]),
      r([nameBtn(DOCS.hcAr.name) + sm("Harbour Cements · 2025–26"), trackWords(W.numPdfNow), trackWords(W.textNow)]),
      g("In line", "562"),
      r([nameBtn("524999_Q4_FY26_Consolidated.xml") + sm("Northfield Pharma · Q4"), trackWords(["From XBRL", "Done"]), trackWords(["In line", "3 ahead"])]),
      r([note("559 more in line. Showing the first 50 of each group.", { padding: "4px 0" }), "", ""]),
    ], { role: "table", "aria-label": "Every file you added" }),
  ])
  const d = DOCS.scPdf
  const side = el("aside", { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16, paddingLeft: 24, borderLeft: `2px solid ${T.ink}` }, [
    col({ gap: 2 }, [h2(d.name, 22), note("Synthetic Cements · results, quarter to 30 Sep 2026 · added 14:02")]),
    trackTable([
      ["Numbers", [["Source", "XBRL file found", "done"], ["XBRL", "Being read", "now"], ["The PDF", "Only what XBRL lacks", "next"]]],
      ["Text", [["Pages", "18", "next"], ["By OCR", "—", "next"], ["Indexed", "In line, 2 ahead", "next"]]],
    ]),
    body("This PDF waits while 500999_Q2_FY27_Consolidated.xml is read, so Gemini reads only the statements XBRL doesn’t cover.", { fontSize: 16 }),
    spec([
      ["What it is", `Financial results, quarter to 30 Sep 2026<br>${M("Page 1: “Unaudited financial results…”")}`],
      ["Company", `Synthetic Cements Limited<br>${M("Page 1: “BSE 500999”")}`],
    ], { termW: 110 }),
  ])
  return appPage({
    content: [
      col({ gap: 8 }, [appH1("Documents"), body("Everything you’ve added and where it stands. Numbers and text are read separately: numbers in minutes, text one file at a time.")]),
      dropStrip({}),
      countStrip(B_COUNTS),
      row({ gap: 24, alignItems: "flex-start" }, [list, side]),
    ],
  })
}
function B2() {
  const coRow = (name, codes, files, first) =>
    div({ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1.2fr) 90px auto", gap: 16, alignItems: "center", padding: "12px 16px", borderTop: `1px solid ${T.inkMuted}` }, [
      col({ gap: 2 }, [div({ fontWeight: 700 }, esc(name)), sm("Printed in the files")]),
      div({ fontSize: 15, lineHeight: 1.4 }, esc(codes)),
      div({ textAlign: "right", ...NUM }, esc(files)),
      row({ gap: 8, justifyContent: "flex-end" }, [first ? primary(`Add ${name.replace(" Limited", "")}`) : outline(`Add ${name.replace(" Limited", "")}`), outline("It’s one of mine")]),
    ])
  return appPage({
    content: [
      col({ gap: 8 }, [appH1("Documents"), body("Everything you’ve added and where it stands. Numbers and text are read separately: numbers in minutes, text one file at a time.")]),
      col({ gap: 12 }, [dropStrip({ mode: "sent", total: 806, folder: "bse-xbrl" }), refusedLine()]),
      countStrip(B_COUNTS),
      toggles(["All 806", "Need you 214", "Working 3", "In line 562", "Ready 9"], "Need you 214", "Show"),
      col({ gap: 8 }, [
        h3("31 companies aren’t in your workspace yet"),
        body("Their files are held until you say who they are. Confirming a company releases all of its files at once.", { fontSize: 16 }),
      ]),
      div({ border: `2px solid ${T.ink}` }, [
        div({ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1.2fr) 90px auto", gap: 16, padding: "10px 16px", fontSize: 14, color: T.inkMuted, borderBottom: `1px solid ${T.ink}` }, [div({}, "Company, as printed"), div({}, "Codes"), div({ textAlign: "right" }, "Files"), div({}, "")]),
        coRow("Coastline Bank Limited", "BSE 532999 · COASTBANK · INE999Z01011", "26", true),
        coRow("Meridian Textiles Limited", "BSE 521999 · MERIDTEX · INE998Y01012", "18"),
        coRow("Eastgate Motors Limited", "BSE 520999 · EGMOTORS · INE997X01013", "16"),
        coRow("Lakeside Power Limited", "BSE 533999 · LKPOWER · INE996W01014", "14"),
        div({ padding: "12px 16px", borderTop: `1px solid ${T.inkMuted}` }, note("27 more companies, 140 files. Showing the 4 with the most files.")),
      ], { role: "table", "aria-label": "Companies to confirm" }),
      notice({ title: "meridian-q2.pdf: Maester couldn’t find the company on the first pages.", detail: "Say which company it is and it carries on.", actions: [outline("Say which company")], role: "note" }),
    ],
  })
}
function B3() {
  const disclosure = col({ gap: 8 }, [
    el("button", { display: "inline-flex", alignItems: "center", gap: 10, minHeight: 44, padding: "0 16px", fontFamily: "inherit", fontSize: 16, fontWeight: 700, border: `2px solid ${T.ink}`, background: "transparent", color: T.ink, alignSelf: "flex-start" }, `How it was filed <span aria-hidden="true">−</span>`, { type: "button", "aria-expanded": "true" }),
    spec([
      ["Element", "RevenueFromOperations"],
      ["Period", "1 Apr 2025 to 31 Mar 2026 (12 months)"],
      ["Unit", "₹, rounded to the lakh; the filing declares crore"],
      ["File", "500999_Q4_FY26_Consolidated.xml, added 2 Oct"],
    ], { termW: 104 }),
  ])
  return researchFrame(
    inspector({
      lead: div({ border: `2px solid ${T.ink}`, padding: 16, display: "flex", flexDirection: "column", gap: 6 }, [
        strong("Filed as XBRL data, not read off a page."),
        body("The company filed this figure with BSE as data. Maester takes it as filed.", { fontSize: 16 }),
      ]),
      entries: [
        ["In the PDF", `${B("Not found on the PDF’s statement pages (4–6).")} The figure stays as filed. Check the PDF yourself.`],
        ["Adds up", "Part of total income, which adds up"],
        ["Reviewed", "Not yet"],
      ],
      actions: [disclosure, outline("Open the results PDF at page 4", { alignSelf: "flex-start" }), note("Where the statement pages start. The XBRL file has no pages.")],
    }),
  )
}

// ---------- C · Filings, not files ----------
// The unit is the filing: one company, one period. Its PDF and its XBRL sit together, and each
// statement says where its numbers come from. The company is asked once for all its filings.
function trackLine(label, [a, b], { bold = false, now = false } = {}) {
  return div({ display: "grid", gridTemplateColumns: "76px minmax(0, 1fr)", gap: 12, padding: "8px 10px", background: now ? T.ink : "transparent", color: now ? T.paper : T.ink }, [
    div({ fontSize: 14, fontWeight: 700, paddingTop: 1 }, esc(label)),
    col({ gap: 1, minWidth: 0 }, [div({ fontSize: 16, fontWeight: bold || now ? 700 : 400, lineHeight: 1.35 }, esc(a)), b ? div({ fontSize: 14, lineHeight: 1.4, color: now ? T.paperMuted : T.inkMuted }, esc(b)) : ""]),
  ])
}
function filingRow({ title, files, num, text, sel = false, phone = false }) {
  return div({ display: "grid", gridTemplateColumns: phone ? "minmax(0, 1fr)" : "minmax(0, 1.1fr) minmax(0, 1.6fr)", gap: phone ? 8 : 20, padding: "14px 0", borderTop: `1px solid ${T.inkMuted}`, outline: sel ? `3px solid ${T.ink}` : 0, outlineOffset: 2 }, [
    col({ gap: 4, minWidth: 0 }, [nameBtn(title, { fontSize: 17, fontWeight: 700 }), ...files.map(([f, k]) => div({ fontSize: 14, lineHeight: 1.4, color: T.inkMuted, overflowWrap: "anywhere" }, `${esc(k)} · ${esc(f)}`))]),
    col({ gap: 0, minWidth: 0, border: `1px solid ${T.inkMuted}` }, [trackLine("Numbers", num.w, num), div({ borderTop: `1px solid ${T.inkMuted}` }), trackLine("Text", text.w, text)]),
  ])
}
const companyBlock = (name, codes, filings, { phone = false, extra = "" } = {}) =>
  el("section", { display: "flex", flexDirection: "column", borderTop: `2px solid ${T.ink}`, paddingTop: 12 }, [
    row({ gap: 12, alignItems: "baseline", flexWrap: "wrap", paddingBottom: 4 }, [h3(name), sm(codes)]),
    extra,
    ...filings.map((f) => filingRow({ ...f, phone })),
  ])
const C_FILINGS = {
  sc: { title: "Results, quarter to 30 Sep 2026", files: [[DOCS.scXml.name, "XBRL"], [DOCS.scPdf.name, "PDF"]], num: { w: ["From XBRL · reading now", "The PDF waits for it, so Gemini reads only what XBRL doesn’t cover."], now: true }, text: { w: ["In line, 2 ahead", "PDF: 18 pages · XBRL: its notes"] } },
  hc: { title: "Annual report 2025–26", files: [[DOCS.hcAr.name, "PDF"]], num: { w: ["Read from the PDF · now", "No XBRL for this filing."], now: true }, text: { w: ["Page 140 of 286", "38 pages by OCR · 412 passages so far"], now: true } },
  cb: { title: "Results, quarter to 30 Sep 2026", files: [[DOCS.cbXml.name, "XBRL"], [DOCS.cbPdf.name, "PDF"]], num: { w: ["Read from the PDF · next", "The XBRL is in the banking format, not mapped yet."] }, text: { w: ["In line, 3 ahead", ""] } },
  np: { title: "Results, quarter to 30 Jun 2026", files: [[DOCS.npXml.name, "XBRL"], [DOCS.npPdf.name, "PDF"]], num: { w: ["From XBRL · done", "Gemini not needed. 214 of 214 figures found in the PDF."] }, text: { w: ["Done", "22 pages, 4 by OCR · 61 passages · 12 XBRL notes"] } },
}
function C1() {
  return appPage({
    content: [
      col({ gap: 8 }, [appH1("Documents"), body("Your filings, by company. A filing’s PDF and XBRL sit together: numbers come from XBRL when there is one, and every page’s text is indexed.")]),
      dropStrip({}),
      row({ gap: 32, alignItems: "flex-start" }, [
        col({ flex: 1.7, minWidth: 0, gap: 24 }, [
          row({ justifyContent: "space-between", alignItems: "baseline" }, [h2("Working on", 22), note("4 filings · 7 files")]),
          companyBlock("Synthetic Cements", "BSE 500999 · NSE SYNCEM", [{ ...C_FILINGS.sc, sel: true }]),
          companyBlock("Harbour Cements", "BSE 503999 · NSE HARBCEM", [C_FILINGS.hc]),
          companyBlock("Coastline Bank", "BSE 532999 · NSE COASTBANK", [C_FILINGS.cb]),
          companyBlock("Not confirmed yet", "", [], {
            extra: notice({ title: "meridian-q2.pdf: which company is this?", detail: "Maester couldn’t find the company on the first pages. Say which it is and it carries on.", actions: [primary("Say which company")], role: "note", style: { marginTop: 8 } }),
          }),
        ]),
        col({ flex: 1, minWidth: 0, gap: 12 }, [
          row({ justifyContent: "space-between", alignItems: "baseline" }, [h2("Done", 22), note("by company")]),
          companyBlock("Northfield Pharma", "BSE 524999", [C_FILINGS.np]),
          companyBlock("Synthetic Cements", "BSE 500999", [
            { title: "Results, year to 31 Mar 2026", files: [["500999_Q4_FY26_Consolidated.xml", "XBRL"], ["synthetic-cements-q4-2025-26.pdf", "PDF"]], num: { w: ["From XBRL · done", "1 figure not found in the PDF"], bold: true }, text: { w: ["Done", "24 pages · 70 passages"] } },
          ]),
        ]),
      ]),
    ],
  })
}
function C2() {
  // The filing opened: each statement says its source (partial coverage), and the 806-file folder
  // arrives as companies to confirm.
  const stmtSrc = ledger({
    cols: [{ label: "Statement", w: "minmax(0, 1fr)" }, { label: "Numbers from", w: "minmax(0, 1.6fr)" }, { label: "In the PDF", w: "minmax(0, 1.2fr)" }],
    rowPad: "10px 12px",
    rows: [
      ["Profit and loss", "XBRL · quarter and half year", "Found: 38 of 38"],
      ["Balance sheet", "XBRL · at 30 Sep 2026", `${B("Found: 51 of 52")}<br>${M("1 not found: see the figure")}`],
      ["Cash flow", `PDF, read by Gemini · pages 7–8${"<br>"}${M("The quarter’s XBRL has no cash flow")}`, M("—")],
    ],
  })
  const filing = div({ border: `2px solid ${T.ink}`, padding: 24, display: "flex", flexDirection: "column", gap: 16, flex: 1.3, minWidth: 0 }, [
    col({ gap: 2 }, [h2("Synthetic Cements · results, quarter to 30 Sep 2026", 22), note("Consolidated · 2 files · added 14:02")]),
    stmtSrc,
    spec([
      ["Text", "Done: 18 pages of the PDF, 2 by OCR, 52 passages; 12 notes from the XBRL"],
      ["Files", `${nameBtn(DOCS.scXml.name)} XBRL · ${nameBtn(DOCS.scPdf.name)} PDF`],
    ], { termW: 80 }),
    row({ gap: 12, flexWrap: "wrap" }, [link("See the figures", { style: { fontSize: 17 } }), outline("Read it again")]),
  ])
  const coRow = (name, codes, files, first) =>
    div({ display: "flex", flexDirection: "column", gap: 8, padding: "12px 0", borderTop: `1px solid ${T.inkMuted}` }, [
      row({ justifyContent: "space-between", alignItems: "baseline", gap: 12 }, [div({ fontWeight: 700 }, esc(name)), div({ ...NUM, fontSize: 14, color: T.inkMuted, whiteSpace: "nowrap" }, esc(files))]),
      sm(codes),
      row({ gap: 8, flexWrap: "wrap" }, [first ? primary(`Add ${name.replace(" Limited", "")}`) : outline(`Add ${name.replace(" Limited", "")}`), outline("It’s one of mine")]),
    ])
  const confirm = col({ flex: 1, minWidth: 0, gap: 8 }, [
    h2("Not in your workspace yet", 22),
    body("31 companies from bse-xbrl. Their 214 files wait until you confirm each company, once.", { fontSize: 16 }),
    div({ borderBottom: `2px solid ${T.ink}` }, [
      coRow("Coastline Bank Limited", "BSE 532999 · COASTBANK · INE999Z01011", "9 filings · 26 files", true),
      coRow("Meridian Textiles Limited", "BSE 521999 · MERIDTEX · INE998Y01012", "9 filings · 18 files"),
      coRow("Eastgate Motors Limited", "BSE 520999 · EGMOTORS · INE997X01013", "8 filings · 16 files"),
      div({ padding: "12px 0", borderTop: `1px solid ${T.inkMuted}` }, note("28 more companies.")),
    ]),
  ])
  return appPage({
    content: [
      col({ gap: 8 }, [appH1("Documents"), body("Your filings, by company. A filing’s PDF and XBRL sit together: numbers come from XBRL when there is one, and every page’s text is indexed.")]),
      col({ gap: 12 }, [dropStrip({ mode: "sent", total: 806, folder: "bse-xbrl" }), refusedLine()]),
      row({ gap: 32, alignItems: "flex-start" }, [filing, confirm]),
    ],
  })
}
function C3() {
  return appPhone({
    content: [
      col({ gap: 8 }, [appH1("Documents", 32), body("Your filings, by company. Numbers come from XBRL when a filing has it.", { fontSize: 16 })]),
      dropStrip({ phone: true }),
      h2("Working on", 22),
      companyBlock("Synthetic Cements", "BSE 500999", [C_FILINGS.sc], { phone: true }),
      companyBlock("Harbour Cements", "BSE 503999", [C_FILINGS.hc], { phone: true }),
    ],
  })
}
function C4() {
  return researchFrame(
    inspector({
      entries: [
        ["From", `Results for the year to 31 Mar 2026: the XBRL filed with the PDF${"<br>"}${M("500999_Q4_FY26_Consolidated.xml · tagged RevenueFromOperations")}`],
        ["Unit", "₹ crore, as the filing declares; rounded to the lakh"],
        ["In the PDF", "Found on page 5 of the results PDF."],
        ["Adds up", "Part of total income, which adds up"],
        ["Reviewed", "Not yet"],
      ],
      actions: [outline("Open the results PDF at page 5", { alignSelf: "flex-start" }), note("The page where the check found this figure. The XBRL file itself has no pages.")],
    }),
    {
      extra: spec([
        ["2025–26", "Profit and loss and balance sheet from the Q4 XBRL; cash flow from the annual report, read by Gemini."],
        ["Earlier", "Annual reports, read by Gemini."],
      ], { termW: 90 }),
    },
  )
}

// ---------- D · Two lines of work ----------
// The machine's day, said plainly: numbers are quick and run two at a time; text is slow and runs
// one file at a time. The page leads with what each line is doing now and who is next.
function lane({ title, lede, now, next, more }) {
  return el("section", { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12, borderTop: `2px solid ${T.ink}`, paddingTop: 16 }, [
    col({ gap: 4 }, [h2(title, 22), note(lede)]),
    col({ gap: 0 }, now),
    col({ gap: 6 }, [h4("Next"), el("ol", { margin: 0, paddingLeft: 24, fontSize: 16, lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 4 }, next.map(([n, d]) => el("li", {}, `${nameBtn(n)} ${M(d)}`))), more ? note(more) : ""]),
  ])
}
const nowRow = (name, a, b, extra = "") =>
  div({ display: "flex", flexDirection: "column", gap: 4, padding: "12px 0", borderTop: `1px solid ${T.inkMuted}` }, [nameBtn(name, { fontWeight: 700 }), div({ fontSize: 16 }, esc(a)), b ? sm(b) : "", extra])
function D1() {
  const numbers = lane({
    title: "Numbers",
    lede: "Two files at a time. Minutes each.",
    now: [
      nowRow(DOCS.scXml.name, "Reading the XBRL", "Synthetic Cements · Q2"),
      nowRow(DOCS.hcAr.name, "Gemini is reading the statements", "Harbour Cements · annual report · no XBRL for it"),
      div({ padding: "12px 0", borderTop: `1px solid ${T.inkMuted}`, display: "flex", flexDirection: "column", gap: 4 }, [
        strong("Waiting for XBRL: 1 PDF", { fontSize: 16 }),
        div({ fontSize: 16 }, `${nameBtn(DOCS.scPdf.name)} waits for ${esc(DOCS.scXml.name)}, so Gemini reads only what XBRL doesn’t cover.`),
      ]),
    ],
    next: [[DOCS.cbPdf.name, "the XBRL is in the banking format, not mapped yet"]],
  })
  const text = lane({
    title: "Text",
    lede: "One file at a time. An annual report can take an hour.",
    now: [
      nowRow(DOCS.hcAr.name, "Page 140 of 286", "38 pages by OCR · 412 passages so far · started 13:40", ruler({ w: "100%" })),
    ],
    next: [[DOCS.scXml.name, "12 notes"], [DOCS.scPdf.name, "18 pages"], [DOCS.cbXml.name, "XBRL notes"]],
    more: "And 3 more. Files are indexed in the order they arrived.",
  })
  return appPage({
    content: [
      col({ gap: 8 }, [appH1("Documents"), body("Maester reads each filing twice: its numbers, quickly, and its text, page by page. Here is what each is doing.")]),
      dropStrip({}),
      row({ gap: 32, alignItems: "flex-start" }, [numbers, text]),
      col({ gap: 12 }, [
        row({ justifyContent: "space-between", alignItems: "baseline" }, [h2("Your documents", 22), note("Newest first")]),
        ledger({
          cols: [{ label: "Name", w: "minmax(0, 1.4fr)" }, { label: "What it is", w: "minmax(0, 1.2fr)" }, { label: "Numbers", w: "minmax(0, 1fr)" }, { label: "Text", w: "minmax(0, 1fr)" }],
          rowPad: "10px 12px",
          rows: [
            [nameBtn(DOCS.mtPdf.name), `${B("Needs you: which company?")}`, M("Waits"), M("In line")],
            [nameBtn(DOCS.scPdf.name), "Results, Q2 · Synthetic Cements", "Waiting for XBRL", "In line"],
            [nameBtn(DOCS.npPdf.name), "Results, Q1 · Northfield Pharma", "Not needed: XBRL", "Done"],
          ],
        }),
      ]),
    ],
  })
}
function miniLadder(label, steps) {
  return col({ gap: 6 }, [
    h4(label),
    el("ol", { listStyle: "none", margin: 0, padding: 0, borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, steps.map(([n, word, st], i) => {
      const on = st === "now" || st === "needs"
      return el("li", { display: "grid", gridTemplateColumns: "24px minmax(0, 1fr) auto", gap: 10, alignItems: "baseline", padding: "10px 10px", borderTop: i ? `1px solid ${T.inkMuted}` : 0, background: on ? T.ink : "transparent", color: on ? T.paper : T.ink }, [
        div({ fontSize: 14, color: on ? T.paperMuted : T.inkMuted }, String(i + 1)),
        div({ fontSize: 16, fontWeight: 700 }, esc(n)),
        div({ fontSize: 14, fontWeight: on || st === "stopped" ? 700 : 400, color: on ? T.paper : st === "done" ? T.ink : T.inkMuted, textAlign: "right" }, esc(word)),
      ])
    })),
  ])
}
function D2() {
  return appPhone({
    content: [
      link("← Documents", { style: { fontSize: 16, alignSelf: "flex-start" } }),
      col({ gap: 2 }, [h2(DOCS.hcAr.name, 22), note("Harbour Cements · annual report 2025–26 · added 13:38")]),
      miniLadder("Numbers", [["Looked for XBRL", "None", "done"], ["Read by Gemini", "Now", "now"], ["Checked", "Next", "next"]]),
      miniLadder("Text", [["Pages read", "140 of 286", "now"], ["By OCR", "38 so far", "done"], ["Passages", "412 so far", "done"], ["Indexed", "Next", "next"]]),
      note("Text is read page by page. If it stops, it carries on from the last page read."),
      notice({ title: "3 pages so far have no text.", detail: "OCR found nothing on pages 41, 42 and 97. The other pages carry on. Your numbers aren’t affected.", role: "note" }),
    ],
  })
}
function D3() {
  const readings = ledger({
    cols: [{ label: "Reading", w: "minmax(0, 1.5fr)" }, { label: "₹ crore", w: "92px", align: "right" }, { label: "Used", w: "minmax(0, 0.9fr)" }],
    rowPad: "10px 0",
    fontSize: 15,
    rows: [
      [`Q4 results, XBRL${"<br>"}${M("RevenueFromOperations")}`, "12,105.31", B("Used")],
      [`Annual report 2025–26, page 213${"<br>"}${M("read by Gemini")}`, "12,105", M("Not used: XBRL takes the year")],
    ],
  })
  return researchFrame(
    inspector({
      entries: [
        ["In the PDF", `${B("Not checked:")} the Q4 results PDF isn’t in your documents.`],
        ["Adds up", "Part of total income, which adds up"],
        ["Reviewed", "Not yet"],
      ],
      lead: col({ gap: 8 }, [h4("Every reading of this line"), readings]),
      actions: [outline("Open the annual report at page 213", { alignSelf: "flex-start" }), note("The XBRL has no page. The annual report prints the same line, rounded to the crore.")],
    }),
    { q4: "XBRL; its PDF not added" },
  )
}

// ---------- writers ----------
const BASE_CSS = `body{margin:0;background:${T.paper};font-family:${FONT}}button{font-family:inherit;margin:0}a{color:inherit}h1,h2,h3,h4,p,dl,dd,figure,ol,ul{margin:0}a:hover{background:#000000;color:#EDEDE8;text-decoration:none}button:focus-visible,a:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:3px solid #000000;outline-offset:2px}`
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
  { id: "Main.dc.html", title: "Today 1 · Documents: one PDF at a time, one track, XML refused", w: D, render: T1, row: 0 },
  { id: "T2.dc.html", title: "Today 2 · The figure panel needs a page", w: D, render: T2, row: 0 },
  { id: "S1.dc.html", title: "Shared · The words every direction uses", w: D, render: S1, row: 0 },
  { id: "A1.dc.html", title: "A1 · Two tracks on the slip — six files at once, a PDF waits for its XBRL", w: D, render: A1, row: 1 },
  { id: "A2.dc.html", title: "A2 · Two tracks on the slip — a folder of 806, a company asked once for 26 files", w: D, render: A2, row: 1 },
  { id: "A3.dc.html", title: "A3 · Two tracks on the slip — the figure panel: Filed as, and the statement pages", w: D, render: A3, row: 1 },
  { id: "B1.dc.html", title: "B1 · The work list — every file, grouped by what it needs", w: D, render: B1, row: 2 },
  { id: "B2.dc.html", title: "B2 · The work list — Need you: 31 companies, one row each", w: D, render: B2, row: 2 },
  { id: "B3.dc.html", title: "B3 · The work list — the figure panel says it was filed as data", w: D, render: B3, row: 2 },
  { id: "C1.dc.html", title: "C1 · Filings, not files — PDF and XBRL together, by company", w: D, render: C1, row: 3 },
  { id: "C2.dc.html", title: "C2 · Filings, not files — each statement’s source; the folder as companies", w: D, render: C2, row: 3 },
  { id: "C3.dc.html", title: "C3 · Filings, not files — phone 390", w: P, render: C3, row: 3, phone: true },
  { id: "C4.dc.html", title: "C4 · Filings, not files — the figure panel: the XBRL filed with the PDF, the page found", w: D, render: C4, row: 3 },
  { id: "D1.dc.html", title: "D1 · Two lines of work — numbers two at a time, text one at a time", w: D, render: D1, row: 4 },
  { id: "D2.dc.html", title: "D2 · Two lines of work — phone 390, a file’s two ladders", w: P, render: D2, row: 4, phone: true },
  { id: "D3.dc.html", title: "D3 · Two lines of work — the figure panel: every reading of the line", w: D, render: D3, row: 4 },
]
for (const f of FRAMES) {
  const m = HEIGHTS[f.id]
  f.h = Math.max(f.phone ? 844 : 900, m ? m.content + 24 : 0)
}
fs.mkdirSync(path.join(OUT, "project"), { recursive: true })
fs.mkdirSync(path.join(OUT, "twins"), { recursive: true })
const measuring = process.argv.includes("--measure")
for (const f of FRAMES) {
  const b = f.render()
  const sized = b.replace(/height: (900px|844px)/, `height: ${f.h}px`)
  const twin = measuring ? b.replace(/height: (900px|844px)/, "height: auto") : sized
  fs.writeFileSync(path.join(OUT, "project", f.id), dcHtml({ title: f.title, w: f.w, h: f.h, body: sized }))
  fs.writeFileSync(path.join(OUT, "twins", f.id.replace(".dc.html", ".html")), twinHtml({ title: f.title, body: twin }))
}
fs.writeFileSync(path.join(OUT, "twins", "sheet.html"), `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#c9c9c4;font-family:system-ui}h2{font:600 14px system-ui;margin:24px 24px 8px}iframe{border:0;margin:0 24px;display:block;background:#fff}</style></head><body>${FRAMES.map((f) => `<h2>${esc(f.title)} (${f.w}×${f.h})</h2><iframe src="${f.id.replace(".dc.html", ".html")}" width="${f.w}" height="${f.h}"></iframe>`).join("")}</body></html>`)
fs.writeFileSync(path.join(OUT, "twins", "measure.html"), `<!doctype html><html><body><script>
const F=${JSON.stringify(FRAMES.map((f) => [f.id, f.w]))};
async function measureAll(){const out={};for(const [id,w] of F){const fr=document.createElement('iframe');fr.style.cssText='width:'+w+'px;height:400px;border:0';fr.src=id.replace('.dc.html','.html');document.body.appendChild(fr);await new Promise(r=>fr.onload=r);await fr.contentDocument.fonts.ready;await new Promise(r=>setTimeout(r,150));const root=fr.contentDocument.body.firstElementChild;const kids=[...root.querySelectorAll('*')];const bottom=Math.max(...kids.map(k=>k.getBoundingClientRect().bottom));const right=Math.max(...kids.map(k=>k.getBoundingClientRect().right));out[id]={frame:root.offsetHeight,content:Math.ceil(bottom),right:Math.ceil(right)};fr.remove()}return out}
</script></body></html>`)

// ---------- canvas.json ----------
const NOTES = JSON.parse(fs.readFileSync(path.join(HERE, "ingestion-notes.json"), "utf8"))
const X0 = 720
const boards = {}
const notes = {}
const rows = [...new Set(FRAMES.map((f) => f.row))].sort((a, b) => a - b)
const rowH = Object.fromEntries(rows.map((r) => [r, Math.max(...FRAMES.filter((f) => f.row === r).map((f) => f.h))]))
const rowY = {}
let y = 0
for (const r of rows) { rowY[r] = y; y += rowH[r] + 120 + 300 }
const colX = {}
for (const f of FRAMES) {
  const x = colX[f.row] ?? X0
  boards[f.id] = { x, y: rowY[f.row], w: f.w, h: f.h, title: f.title }
  colX[f.row] = x + f.w + 80
}
const right = Math.max(...Object.values(colX))
NOTES.rows.forEach((n, i) => {
  const r = rows[i]
  notes[`title${i}`] = { kind: "title1", text: n.title, x: 0, y: rowY[r] - 260, maxW: colX[r] }
  notes[`note${i}`] = { text: n.note, x: 0, y: rowY[r], w: 600, maxH: Math.min(1600, rowH[r]), size: "l", color: i === 0 ? "red" : "orange" }
})
notes.questions = { text: NOTES.questions, x: right + 80, y: 0, w: 700, maxH: 900, size: "l", color: "blue" }
notes.shared = { text: NOTES.shared, x: right + 80, y: rowY[1], w: 700, maxH: 1400, size: "m", color: "green" }
notes.asks = { text: NOTES.asks, x: right + 80, y: rowY[3], w: 700, maxH: 1400, size: "m", color: "purple" }
const canvas = {
  v: 3,
  createdOnFiles: { v: 1, at: "2026-10-19T12:00:00Z" },
  title: "Maester Ingestion Screens",
  launch: { view: "canvas" },
  pages: [],
  boards,
  order: FRAMES.map((f) => f.id),
  notes,
  designSystems: [],
}
fs.writeFileSync(path.join(OUT, "project", "canvas.json"), JSON.stringify(canvas, null, 2))
console.log("built", FRAMES.length, "frames", FRAMES.map((f) => f.id + ":" + f.h).join(" "))
