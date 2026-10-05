// node documents.mjs [heights.json] → ../canvas/project/*.dc.html, canvas.json, ../canvas/twins/*
// Round 1 of the Maester Terminal Pages canvas (2026-10-05): the signed-in terminal's
// coming-soon pages and the document upload that works out what a PDF is.
// Today + A/B/C + shared upload states. B1 is interactive (drag the crane's load).
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
const h2t = (t, size = 22, style = {}) => h2(t, size, style)
const body = (t, style = {}) => el("p", { margin: 0, fontSize: 17, lineHeight: 1.5, maxWidth: 620, ...style }, esc(t))
const note = (t, style = {}) => el("p", { margin: 0, fontSize: 14, lineHeight: 1.45, color: T.inkMuted, ...style }, esc(t))
const strong = (t, style = {}) => el("p", { margin: 0, fontSize: 17, lineHeight: 1.5, fontWeight: 700, ...style }, esc(t))
const aLink = (t, style = {}) => link(t, { style: { fontSize: 17, ...style } })
const ref = (t) => `<span style="color: ${T.inkMuted}; font-size: 14px">${esc(t)}</span>`
const synth = () => tag("Synthetic example", { style: { color: T.ink } })

// ---------- terminal shell (TerminalShell.svelte, extended with the R1 page list) ----------
const ACCOUNT = "asha@example.com"
const GROUPS = [
  ["Overview", "Holdings"],
  ["Research", "Watchlist", "Documents", "Analyst"],
]
const BOTTOM = ["Activity", "Settings"]
const LIVE = new Set(["Documents"])

function navItem(label, { current, soon }) {
  const base = { display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 44, padding: "0 12px", margin: "0 -12px", fontSize: 17, textDecoration: "none", gap: 8 }
  const style = current ? { ...base, fontWeight: 700, color: T.paper, background: T.ink } : { ...base, color: T.ink, textDecoration: "underline", textUnderlineOffset: "3px", textDecorationThickness: "1.5px" }
  const kids = [esc(label)]
  if (soon) kids.push(el("span", { fontSize: 14, color: current ? T.paperMuted : T.inkMuted, textDecoration: "none" }, "Soon"))
  return el("a", style, kids, { href: "#", ...(current ? { "aria-current": "page" } : {}) })
}
function railNav({ active = "Overview", full = true, soonWord = true } = {}) {
  const items = (labels) => labels.map((l) => navItem(l, { current: l === active, soon: full && soonWord && !LIVE.has(l) }))
  const nav = full
    ? [col({ gap: 0 }, items(GROUPS[0])), div({ height: 1, background: T.inkMuted, margin: "12px 0" }), col({ gap: 0 }, items(GROUPS[1]))]
    : [navItem("Overview", { current: true })]
  return col({ width: 224, flexShrink: 0, borderRight: `2px solid ${T.ink}`, boxSizing: "border-box", alignSelf: "stretch" }, [
    row({ height: 56, padding: "0 24px", borderBottom: `2px solid ${T.ink}`, flexShrink: 0, boxSizing: "border-box" }, [
      el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink }, "Maester", { href: "#" }),
    ]),
    col({ padding: "16px 24px", gap: 4, borderBottom: `1px solid ${T.inkMuted}` }, [muted("Workspace"), div({ fontWeight: 700, fontSize: 16 }, "Personal")]),
    el("nav", { display: "flex", flexDirection: "column", padding: "20px 24px" }, nav, { "aria-label": "Terminal" }),
    spacer(),
    full ? el("nav", { display: "flex", flexDirection: "column", padding: "0 24px 12px" }, items(BOTTOM), { "aria-label": "Account pages" }) : "",
    col({ padding: "16px 24px 24px", gap: 8, borderTop: `1px solid ${T.inkMuted}` }, [
      muted("Signed in as"),
      div({ fontSize: 16, fontWeight: 700, overflowWrap: "anywhere" }, ACCOUNT),
      button("Sign out", { variant: "outline", style: { alignSelf: "flex-start", fontSize: 16 } }),
    ]),
  ])
}
function context(right = "") {
  return row({ minHeight: 56, padding: "8px 24px", gap: 16, borderBottom: `2px solid ${T.ink}`, flexShrink: 0, boxSizing: "border-box", justifyContent: "space-between" }, [
    div({ fontWeight: 700, fontSize: 16 }, "Personal"),
    right,
  ])
}
function appPage({ w = 1440, h = 900, active, full = true, content, ctxRight = synth(), mainStyle = {} }) {
  return div({ display: "flex", flexDirection: "row", alignItems: "stretch", width: w, height: h ?? "auto", minHeight: h ? undefined : 900, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper, boxSizing: "border-box" }, [
    railNav({ active, full }),
    col({ flex: 1, minWidth: 0 }, [
      context(ctxRight),
      el("main", { display: "flex", flexDirection: "column", padding: "32px 24px 48px", gap: 28, minWidth: 0, ...mainStyle }, content),
    ]),
  ])
}
function appPhone({ w = 390, h = 844, content }) {
  return div({ display: "flex", flexDirection: "column", width: w, height: h ?? "auto", overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper, boxSizing: "border-box" }, [
    row({ height: 56, padding: "0 16px 0 24px", borderBottom: `2px solid ${T.ink}`, flexShrink: 0, justifyContent: "space-between", boxSizing: "border-box" }, [
      el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink }, "Maester", { href: "#" }),
      button("Menu", { variant: "outline", style: { padding: "0 16px", fontSize: 16 } }),
    ]),
    context(synth()),
    el("main", { display: "flex", flexDirection: "column", padding: "24px 24px 40px", gap: 24, minWidth: 0 }, content),
  ])
}

// ---------- sketch plates (same recipe as the error sketches) ----------
const roughDefs = (k) => `<defs>
<filter id="r1${k}" x="-3%" y="-3%" width="106%" height="106%"><feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="7" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap></filter>
<filter id="r2${k}" x="-3%" y="-3%" width="106%" height="106%"><feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="19" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap></filter>
<pattern id="hatch${k}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><line x1="0" y1="0" x2="0" y2="9" stroke="#000000" stroke-width="3"></line></pattern>
</defs>`
const plates = (k, colour, ink) => `
<g transform="translate(7 6)">${colour}</g>
<g fill="none" stroke="#000000" stroke-linecap="round" stroke-linejoin="round" stroke-width="3.2" filter="url(#r1${k})">${ink}</g>
<g fill="none" stroke="#000000" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4" opacity="0.55" filter="url(#r2${k})" transform="translate(1.5 -1)">${ink}</g>`
const hand = (x, y, t, { size = 30, rot = 0, anchor = "start", weight = 700 } = {}) =>
  `<text x="${x}" y="${y}" font-family="${HAND}" font-size="${size}" font-weight="${weight}" fill="#000000" text-anchor="${anchor}"${rot ? ` transform="rotate(${rot} ${x} ${y})"` : ""}>${esc(t)}</text>`

// A · a crate of share certificates with a luggage tag. Still.
function crateSketch({ w = 520 } = {}) {
  const ink = `
<path d="M90 222 L 380 212 L 384 410 L 94 420 Z"></path>
<path d="M90 222 L 160 172 L 450 164 L 380 212"></path><path d="M450 164 L 452 362 L 384 410"></path>
<path d="M92 286 L 382 278"></path><path d="M93 350 L 383 342"></path><path d="M384 278 L 451 232"></path><path d="M384 342 L 452 296"></path>
<path d="M150 204 L 178 82 L 288 94 L 262 207"></path>
<path d="M190 112 L 272 121"></path><path d="M186 134 L 266 142"></path><path d="M182 156 L 238 162"></path>
<circle cx="250" cy="178" r="13"></circle>
<path d="M248 198 L 304 72 L 404 104 L 360 196"></path>
<path d="M310 98 L 384 121"></path><path d="M300 120 L 372 143"></path>
<path d="M384 236 Q 432 250 444 292"></path>
<path d="M430 292 L 502 282 L 510 346 L 438 356 Z"></path><circle cx="446" cy="300" r="4"></circle>
<path d="M60 434 Q 280 452 500 432"></path>`
  const colour = `
<path d="M90 222 L 380 212 L 384 410 L 94 420 Z" fill="${ILLUS.yellow}"></path>
<path d="M380 212 L 450 164 L 452 362 L 384 410 Z" fill="${ILLUS.yellow}"></path>
<path d="M248 198 L 304 72 L 404 104 L 360 196 Z" fill="${ILLUS.blue}"></path>
<circle cx="250" cy="178" r="13" fill="${ILLUS.red}"></circle>
<path d="M430 292 L 502 282 L 510 346 L 438 356 Z" fill="${ILLUS.red}"></path>`
  return `<svg viewBox="0 0 540 470" width="${w}" height="${Math.round((w * 470) / 540)}" role="img" aria-labelledby="crt" style="display: block; flex-shrink: 0">
<title id="crt">A sketch of a wooden crate of share certificates, still being packed, with a luggage tag that says arriving soon.</title>
${roughDefs("a")}${plates("a", colour, ink)}
${hand(472, 318, "arriving", { size: 22, rot: -8, anchor: "middle" })}${hand(474, 342, "soon", { size: 24, rot: -8, anchor: "middle" })}
</svg>`
}

// B · a crane holding the page's name over a half-built wall. Drag the load down.
const B_LOGIC = `
class Component extends DCLogic {
renderVals() {
const s = this.state || {};
const y = s.y == null ? 120 : s.y;
const at = (e) => { const r = e.currentTarget.getBoundingClientRect(); return Math.max(110, Math.min(282, Math.round(((e.clientY - r.top) / r.height) * 480) - 40)); };
const landed = y >= 276;
return {
cable: 'M384 70 L 384 ' + y,
load: 'translate(0 ' + (y - 120) + ')',
said: landed ? 'not yet! the walls are still going up' : (s.moved ? 'a little lower…' : 'drag the load down'),
down: (e) => { this.setState({ drag: true }); try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {} },
move: (e) => { if (this.state && this.state.drag) this.setState({ y: at(e), moved: true }); },
up: () => this.setState({ drag: false }),
};
}
}`
const B_VALS = { cable: "M384 70 L 384 120", load: "translate(0 0)", said: "drag the load down" }
function craneSketch({ w = 520, label = "Holdings" } = {}) {
  const ink = `
<path d="M20 444 L 510 444"></path>
<path d="M112 444 L 112 64"></path><path d="M142 444 L 142 64"></path>
<path d="M112 404 L 142 364 L 112 324 L 142 284 L 112 244 L 142 204 L 112 164 L 142 124 L 112 84"></path>
<path d="M60 64 L 470 64"></path><path d="M126 20 L 60 64"></path><path d="M126 20 L 470 64"></path><path d="M126 20 L 126 64"></path>
<path d="M58 64 L 98 64 L 98 98 L 58 98 Z"></path>
<path d="M376 64 L 392 64 L 392 74 L 376 74 Z"></path>
<path d="M286 444 L 286 392 L 474 392 L 474 444"></path><path d="M286 418 L 474 418"></path>
<path d="M330 392 L 330 418"></path><path d="M390 392 L 390 418"></path><path d="M440 392 L 440 418"></path><path d="M310 418 L 310 444"></path><path d="M360 418 L 360 444"></path><path d="M420 418 L 420 444"></path>`
  const colour = `
<path d="M112 444 L 112 64 L 142 64 L 142 444 Z" fill="${ILLUS.red}"></path>
<path d="M60 58 L 470 58 L 470 70 L 60 70 Z" fill="${ILLUS.yellow}"></path>
<path d="M286 444 L 286 392 L 474 392 L 474 444 Z" fill="${ILLUS.yellow}"></path>`
  const loadInk = `<path d="M384 120 L 384 132"></path><path d="M376 132 Q 384 144 392 132"></path><path d="M384 140 L 314 158"></path><path d="M384 140 L 454 158"></path><path d="M306 158 L 462 156 L 464 222 L 308 224 Z"></path>`
  const loadColour = `<path d="M306 158 L 462 156 L 464 222 L 308 224 Z" fill="${ILLUS.blue}"></path>`
  return `<svg viewBox="0 0 520 480" width="${w}" height="${Math.round((w * 480) / 520)}" role="img" aria-labelledby="crn" onPointerDown="{{down}}" onPointerMove="{{move}}" onPointerUp="{{up}}" style="display: block; flex-shrink: 0; touch-action: none; cursor: grab">
<title id="crn">A sketch of a crane holding a block labelled ${esc(label)} over a half-built wall. Dragging the block down lowers it, but the wall is not finished.</title>
${roughDefs("b")}${plates("b", colour, ink)}
<path d="{{cable}}" fill="none" stroke="#000000" stroke-width="3" stroke-linecap="round" filter="url(#r1b)"></path>
<g transform="{{load}}">${plates("b", loadColour, loadInk)}<rect x="318" y="168" width="134" height="44" fill="#EDEDE8"></rect>${hand(385, 200, label, { size: 32, anchor: "middle" })}</g>
${hand(290, 470, "{{said}}", { size: 24, anchor: "start", weight: 600 }).replace("&#123;", "{")}
</svg>`
}

// C · the page as a pencil blueprint, with construction tape.
function blueprintSketch({ w = 900 } = {}) {
  const rows = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const y = 176 + i * 36
    const nameW = [130, 96, 150, 110, 124, 88, 140, 100][i]
    const valW = [70, 64, 58, 52, 48, 40, 34, 0][i]
    return `<path d="M64 ${y + 18} L 562 ${y + 17}" stroke-width="1.6"></path><path d="M80 ${y + 2} L ${80 + nameW} ${y + 1}"></path>${valW ? `<path d="M${520 - valW} ${y + 2} L 520 ${y + 1}"></path>` : `<path d="M506 ${y + 2} L 520 ${y + 1}"></path>`}`
  }).join("")
  const barsInk = [150, 118, 92, 70, 44].map((l, i) => `<path d="M616 ${168 + i * 30} L ${616 + l} ${167 + i * 30}" stroke-width="9"></path>`).join("")
  const ink = `
<path d="M24 22 L 878 26 L 876 540 L 26 536 Z"></path>
<path d="M60 70 L 292 66" stroke-width="10"></path><path d="M60 100 L 210 98"></path>
<path d="M60 128 L 564 124 L 566 478 L 62 482 Z"></path><path d="M62 156 L 565 152" stroke-width="3.4"></path>
${rows}
<path d="M62 450 L 566 446" stroke-width="3.4"></path><path d="M80 466 L 160 465"></path><path d="M450 466 L 520 465"></path>
<path d="M600 128 L 846 126 L 848 330 L 602 332 Z"></path>
${barsInk}
<path d="M616 318 L 690 317" stroke-dasharray="7 7"></path>`
  const colour = `
<path d="M600 128 L 846 126 L 848 330 L 602 332 Z" fill="${ILLUS.blue}" opacity="0"></path>
${[150, 118, 92, 70, 44].map((l, i) => `<path d="M612 ${160 + i * 30} L ${612 + l} ${159 + i * 30} L ${612 + l} ${172 + i * 30} L 612 ${173 + i * 30} Z" fill="${ILLUS.blue}"></path>`).join("")}
<path d="M404 200 L 528 196 L 530 214 L 404 218 Z" fill="${ILLUS.yellow}"></path>
<ellipse cx="512" cy="436" rx="26" ry="18" fill="${ILLUS.red}" opacity="0"></ellipse>`
  const notes = `
<g fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" filter="url(#r1c)">
<path d="M610 428 Q 560 400 540 320"></path><path d="M533 332 l 6 -14 l 8 12"></path>
<path d="M300 520 Q 420 520 498 476"></path><path d="M488 470 l 12 4 l -6 12"></path>
<path d="M318 60 Q 306 64 300 66"></path>
<path d="M790 346 Q 798 340 800 334"></path>
<ellipse cx="512" cy="466" rx="30" ry="16" stroke="${ILLUS.red}" stroke-width="3"></ellipse>
</g>
${hand(326, 66, "your portfolio's name", { size: 24 })}
${hand(600, 446, "price — with the date", { size: 24 })}${hand(600, 470, "you entered it", { size: 24 })}
${hand(96, 526, "no price yet? it says —, never 0", { size: 24 })}
${hand(760, 364, "by sector,", { size: 24 })}${hand(760, 388, "unknown last", { size: 24 })}
${hand(330, 116, "every holding, largest first", { size: 24 })}`
  const tape = `
<g transform="rotate(-14 760 70)">
<rect x="600" y="44" width="330" height="52" fill="${ILLUS.yellow}"></rect>
<rect x="600" y="44" width="330" height="52" fill="url(#hatchc)" opacity="0.18"></rect>
<rect x="600" y="44" width="330" height="52" fill="none" stroke="#000000" stroke-width="3" filter="url(#r1c)"></rect>
${hand(765, 80, "under construction", { size: 32, anchor: "middle" })}
</g>`
  return `<svg viewBox="0 0 900 560" width="${w}" height="${Math.round((w * 560) / 900)}" role="img" aria-labelledby="bpt" style="display: block; flex-shrink: 0">
<title id="bpt">A pencil sketch of the holdings page to come: a ledger of holdings, largest first, and sector bars with the unknown share last, with handwritten notes and construction tape.</title>
${roughDefs("c")}${plates("c", colour, ink)}${notes}${tape}
</svg>`
}

// ---------- upload pieces ----------
function dropZone({ compact = false, phone = false } = {}) {
  if (compact)
    return row({ border: `2px dashed ${T.ink}`, padding: "16px 20px", gap: 16, flexWrap: "wrap", flexShrink: 0 }, [
      strong("Drop a PDF here"), note("or", { color: T.ink, fontSize: 17 }), button("Choose a file", { variant: "outline" }), spacer(),
      note("Annual reports, quarterly results or any other company document. PDF, up to 50 MB."),
    ])
  return col({ border: `2px dashed ${T.ink}`, padding: phone ? "24px 20px" : "32px 32px", gap: 12, alignItems: "flex-start", flexShrink: 0 }, [
    strong(phone ? "Add a company document" : "Drop a PDF here, or choose one", { fontSize: phone ? 20 : 22, fontStretch: "110%" }),
    body("Maester works out what it is first: an annual report, quarterly results or another company document. Then it reads the statements.", { fontSize: 16 }),
    row({ gap: 16, flexWrap: "wrap" }, [button("Choose a file", { variant: "outline" }), note("PDF, up to 50 MB.")]),
  ])
}
// A stage ladder: an ordered sequence, so it is numbered. State is a word, never a colour.
function stages(list, { inverted = false } = {}) {
  return el("ol", { listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))`, borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` },
    list.map(([name, state], i) =>
      el("li", { padding: "12px 12px 12px 0", borderLeft: i ? `1px solid ${T.inkMuted}` : "0", paddingLeft: i ? 12 : 0, display: "flex", flexDirection: "column", gap: 4, background: state === "Now" ? T.ink : "transparent", color: state === "Now" ? T.paper : T.ink, ...(state === "Now" ? { paddingLeft: 12 } : {}) }, [
        div({ fontSize: 14, ...NUM, color: state === "Now" ? T.paperMuted : T.inkMuted }, String(i + 1)),
        div({ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }, esc(name)),
        div({ fontSize: 14, color: state === "Now" ? T.paper : state === "Done" ? T.ink : T.inkMuted }, esc(state)),
      ]),
    ),
  )
}

// ---------- Today ----------
function today() {
  return appPage({ full: false, ctxRight: "", content: [
    col({ gap: 20 }, [
      appH1("The terminal"),
      body("You are in. Your holdings and the filings behind them arrive with the first release."),
      aLink("Explore the synthetic demo"),
    ]),
  ] })
}

// ---------- A · Every page has a door ----------
function comingSoonText({ page, what, needs, demo = true, phone = false }) {
  return col({ gap: 20, maxWidth: 560, flexShrink: 0 }, [
    row({ gap: 16, alignItems: "center", flexWrap: "wrap" }, [appH1(page, phone ? 32 : 40), tag("Coming soon")]),
    body(what),
    spec(needs, { termW: phone ? 120 : 160 }),
    row({ gap: 24, flexWrap: "wrap" }, [button("Upload a filing"), demo ? aLink(`See ${page.toLowerCase()} in the demo`) : ""]),
  ])
}
const HOLD = {
  page: "Holdings",
  what: "Every position you own, with its weight, cost and the date of its price, largest first. It arrives once you can add your holdings.",
  needs: [
    ["What it shows", "Quantity, price, cost, value and weight for each holding"],
    ["Where prices come from", "Prices you enter, each with its date"],
    ["Arrives", "After document upload, with portfolio setup"],
  ],
}
function A1() {
  return appPage({ active: "Holdings", content: [
    row({ gap: 56, alignItems: "flex-start" }, [comingSoonText(HOLD), el("figure", { margin: "8px 0 0", flexShrink: 0 }, crateSketch({ w: 500 }))]),
  ] })
}
function docRow({ name, company, kind, period, state, bold = false }) {
  return [
    div({ fontWeight: 700, overflowWrap: "anywhere" }, esc(name)),
    esc(company),
    esc(kind),
    `<span style="font-variant-numeric: tabular-nums slashed-zero">${esc(period)}</span>`,
    bold ? `<strong>${esc(state)}</strong>` : esc(state),
  ]
}
const DOCS = [
  { name: "harbour-cements-ar-2025-26.pdf", company: "Harbour Cements", kind: "Annual report", period: "Year to 31 Mar 2026", state: "Needs your check", bold: true },
  { name: "meridian-q1-results.pdf", company: "Meridian Bank", kind: "Quarterly results", period: "Quarter to 30 Jun 2026", state: "Reading the statements" },
  { name: "tamarind-investor-deck.pdf", company: "Tamarind Textiles", kind: "Other company document", period: "—", state: "Kept. Figures not read" },
  { name: "scan_0042.pdf", company: "—", kind: "Not sure", period: "—", state: "Needs your check", bold: true },
  { name: "quill-annual-report-2024-25.pdf", company: "Quill Software", kind: "Annual report", period: "Year to 31 Mar 2025", state: "Ready · 2 figures to review" },
]
const DOC_COLS = [
  { label: "Document", w: "minmax(0, 1.5fr)" },
  { label: "Company", w: "minmax(0, 1fr)" },
  { label: "What it is", w: "minmax(0, 1fr)" },
  { label: "Period", w: "minmax(0, 1fr)" },
  { label: "State", w: "minmax(0, 1.1fr)" },
]
function A2() {
  const tracks = DOC_COLS.map((c) => c.w).join(" ")
  const line = (cells, extra = {}) => div({ display: "grid", gridTemplateColumns: tracks, gap: "0 16px", padding: "12px 16px", fontSize: 16, lineHeight: 1.45, alignItems: "baseline", ...extra }, cells.map((c) => div({ minWidth: 0 }, c)))
  const expanded = col({ padding: "4px 16px 20px", gap: 16, borderBottom: `1px solid ${T.inkMuted}` }, [
    strong("Is this right? Maester read it as:", { fontSize: 16 }),
    div({ maxWidth: 820 }, spec([
      ["What it is", `Annual report ${ref("· cover, page 1: “Annual Report 2025–26”")}`],
      ["Company", `Harbour Cements Ltd ${ref("· cover, page 1 · already in your workspace")}`],
      ["Period", `Year to 31 March 2026 ${ref("· page 118: “Balance sheet as at 31 March 2026”")}`],
      ["Statements", `Standalone and consolidated ${ref("· pages 118–131")}`],
    ], { termW: 140 })),
    row({ gap: 16 }, [button("Yes, read the statements"), button("Change something", { variant: "outline" })]),
    note("Nothing is read until you say yes. Reading 214 pages takes a few minutes and carries on if you leave."),
  ])
  const rows = DOCS.map((d, i) => {
    const r = line(docRow(d), { borderBottom: i === DOCS.length - 1 || i === 0 ? "0" : `1px solid ${T.inkMuted}`, ...(i === 0 ? { background: T.ink, color: T.paper } : {}) })
    return i === 0 ? r + expanded : r
  })
  return appPage({ active: "Documents", content: [
    col({ gap: 12 }, [appH1("Documents"), body("Filings you’ve added, what Maester read them as, and where each one stands.")]),
    dropZone({ compact: true }),
    div({ border: `2px solid ${T.ink}`, flexShrink: 0 }, [line(DOC_COLS.map((c) => esc(c.label)), { borderBottom: `2px solid ${T.ink}`, fontSize: 14, color: T.inkMuted }), ...rows]),
  ] })
}
function A3() {
  const choice = (label, sub, on) => el("label", { display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 0", borderTop: `1px solid ${T.inkMuted}`, cursor: "pointer" }, [
    el("span", { width: 22, height: 22, border: `2px solid ${T.ink}`, flexShrink: 0, marginTop: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }, on ? div({ width: 10, height: 10, background: T.ink }) : ""),
    col({ gap: 2 }, [div({ fontWeight: 700, fontSize: 16 }, esc(label)), note(sub)]),
  ])
  return appPhone({ h: null, content: [
    col({ gap: 8 }, [note("Documents"), appH1("scan_0042.pdf", 28, { overflowWrap: "anywhere" })]),
    div({ border: `2px solid ${T.ink}`, padding: 16, display: "flex", flexDirection: "column", gap: 6 }, [strong("Maester couldn’t tell what this is."), body("The first pages have no title it could read. Say what it is and it carries on.", { fontSize: 16 })]),
    el("fieldset", { border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column" }, [
      el("legend", { fontWeight: 700, fontSize: 17, marginBottom: 8, padding: 0 }, "What is it?"),
      choice("Annual report", "A full year’s statements", false),
      choice("Quarterly results", "Three months’ statements", true),
      choice("Other company document", "Kept with the company. Figures aren’t read from it yet.", false),
      div({ borderTop: `1px solid ${T.inkMuted}` }),
    ]),
    col({ gap: 8 }, [
      el("label", { fontWeight: 700, fontSize: 17 }, "Company"),
      row({ height: 44, border: `2px solid ${T.ink}`, padding: "0 12px", justifyContent: "space-between", fontSize: 17 }, ["Kestrel Power", div({ fontSize: 14 }, "▾")]),
      note("Pick one in your workspace, or type a new name to add it."),
    ]),
    button("Save and read it", { style: { width: "100%" } }),
  ] })
}

// ---------- B · The intake desk ----------
function B1() {
  return appPage({ active: "Holdings", content: [
    row({ gap: 48, alignItems: "flex-start" }, [
      col({ gap: 20, maxWidth: 520, flexShrink: 0, paddingTop: 8 }, [
        row({ gap: 16 }, [appH1("Holdings"), tag("Coming soon")]),
        body("Every position you own, with its weight, cost and the date of its price. We’re still building it."),
        body("Until then, add the filings for the companies you own. They’ll be read and waiting when this page opens.", { fontSize: 16 }),
        row({ gap: 24 }, [button("Upload a filing"), aLink("See holdings in the demo")]),
      ]),
      el("figure", { margin: 0, flexShrink: 0 }, craneSketch({ w: 520 })),
    ]),
  ] })
}
function slip({ phone = false } = {}) {
  const fld = (term, value, src) => [term, `${esc(value)}<br>${ref(src)} ${phone ? "" : "&nbsp;"}${link("Change", { style: { fontSize: 14, marginLeft: phone ? 0 : 8 } })}`]
  return col({ border: `2px solid ${T.ink}`, flexShrink: 0 }, [
    row({ padding: "14px 20px", gap: 16, borderBottom: `2px solid ${T.ink}`, flexWrap: "wrap" }, [
      div({ fontWeight: 700, fontSize: 17, overflowWrap: "anywhere" }, "harbour-cements-ar-2025-26.pdf"),
      spacer(), note("214 pages · added 14:02", NUM),
    ]),
    div({ padding: "16px 20px 0" }, stages([["Uploaded", "Done"], ["Worked out what it is", "Done"], ["Reading the statements", "Now"], ["Checking the sums", "Next"], ["Ready", "Next"]])),
    div({ padding: "16px 20px 0" }, strong("Read as", { fontSize: 16 })),
    div({ padding: "8px 20px 20px" }, spec([
      fld("What it is", "Annual report", "Cover, page 1: “Annual Report 2025–26”"),
      fld("Company", "Harbour Cements Ltd", "Cover, page 1 · in your workspace"),
      fld("Period", "Year to 31 March 2026", "Page 118: “Balance sheet as at 31 March 2026”"),
      fld("Statements", "Standalone and consolidated", "Pages 118–131"),
    ], { termW: 140 })),
  ])
}
function B2() {
  const earlier = (n, k, s) => row({ padding: "12px 0", gap: 16, borderTop: `1px solid ${T.inkMuted}`, fontSize: 16 }, [div({ fontWeight: 700, flex: 1.4, minWidth: 0 }, esc(n)), div({ flex: 1, minWidth: 0 }, esc(k)), div({ flex: 1, minWidth: 0 }, esc(s))])
  return appPage({ active: "Documents", content: [
    col({ gap: 12 }, [appH1("Documents"), body("Add a filing and Maester works out what it is, then reads it. Wrong guess? Change it and it’s read again.")]),
    dropZone({ compact: true }),
    row({ gap: 32, alignItems: "flex-start" }, [
      div({ flex: 1.6, minWidth: 0 }, slip()),
      col({ flex: 1, minWidth: 0, gap: 0 }, [
        h2t("Earlier", 22, { marginBottom: 8 }),
        earlier("meridian-q1-results.pdf", "Quarterly results", "Ready"),
        earlier("tamarind-investor-deck.pdf", "Other document", "Kept, not read"),
        earlier("quill-annual-report-2024-25.pdf", "Annual report", "2 figures to review"),
        div({ borderTop: `2px solid ${T.ink}` }),
      ]),
    ]),
    note("Leaving this page doesn’t stop anything. The slip is here when you come back."),
  ] })
}
function B3() {
  return appPhone({ h: null, content: [
    col({ gap: 8 }, [note("Documents"), appH1("tamarind-investor-deck.pdf", 26, { overflowWrap: "anywhere" })]),
    col({ border: `2px solid ${T.ink}` }, [
      div({ padding: "14px 16px", borderBottom: `2px solid ${T.ink}` }, strong("Kept with Tamarind Textiles")),
      div({ padding: "12px 16px 16px" }, spec([
        ["What it is", `Investor presentation<br>${ref("Cover: “Investor Presentation, Q1 FY27”")}`],
        ["Company", `Tamarind Textiles<br>${ref("Cover, page 1")}`],
        ["Figures", "Not read. Maester reads annual reports and quarterly results for now."],
      ], { termW: 96 })),
    ]),
    row({ gap: 24, flexWrap: "wrap" }, [button("Add another file"), aLink("It’s not a presentation")]),
    note("You can still open it from the company once research pages arrive."),
  ] })
}

// ---------- C · Blueprints ----------
function C1() {
  return appPage({ active: "Holdings", content: [
    row({ gap: 24, alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap" }, [
      col({ gap: 12, maxWidth: 640 }, [
        row({ gap: 16 }, [appH1("Holdings"), tag("Coming soon")]),
        body("This is the page we’re drawing. Every holding, largest first, with the date of each price. It opens once you can add your holdings."),
      ]),
      row({ gap: 24 }, [aLink("See it working in the demo"), button("Upload a filing")]),
    ]),
    el("figure", { margin: 0, borderTop: `2px solid ${T.ink}`, paddingTop: 24 }, blueprintSketch({ w: 1000 })),
  ] })
}
function coverPage({ w = 400, phone = false, title = "Annual Report 2025–26", co = "Harbour Cements Limited", line2 = "Building the coast, one tonne at a time" } = {}) {
  const h = Math.round(w * 1.33)
  return div({ width: w, height: h, border: `2px solid ${T.ink}`, background: T.paper, boxSizing: "border-box", padding: phone ? 20 : 32, display: "flex", flexDirection: "column", gap: 14, position: "relative", flexShrink: 0 }, [
    div({ fontSize: phone ? 14 : 15, fontWeight: 700, letterSpacing: "0.02em" }, esc(co)),
    div({ height: 2, background: T.ink, width: "40%" }),
    spacer(),
    div({ position: "relative", padding: "10px 12px", outline: `3px solid ${T.ink}`, outlineOffset: 4 }, [
      div({ fontStretch: "110%", fontWeight: 700, fontSize: phone ? 26 : 36, lineHeight: 1.05 }, esc(title)),
      div({ position: "absolute", right: -18, top: -18, width: 28, height: 28, background: T.ink, color: T.paper, fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", ...NUM }, "1"),
    ]),
    div({ fontSize: phone ? 14 : 15, color: T.inkMuted }, esc(line2)),
    div({ height: phone ? 20 : 60 }),
  ])
}
function thumb(label, n, marked) {
  return col({ gap: 6, alignItems: "flex-start" }, [
    div({ width: 72, height: 96, border: `2px solid ${T.ink}`, boxSizing: "border-box", padding: 8, display: "flex", flexDirection: "column", gap: 5, position: "relative" }, [
      ...[60, 44, 52, 30, 48, 40].map((w) => div({ height: 2, width: `${w}%`, background: T.inkMuted })),
      marked ? div({ position: "absolute", right: -10, top: -10, width: 22, height: 22, background: T.ink, color: T.paper, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }, marked) : "",
    ]),
    note(label, { color: T.ink, ...NUM }),
  ])
}
function C2() {
  return appPage({ active: "Documents", content: [
    note("Documents · harbour-cements-ar-2025-26.pdf · 214 pages"),
    row({ gap: 48, alignItems: "flex-start" }, [
      col({ gap: 20, flexShrink: 0 }, [
        coverPage({ w: 400 }),
        row({ gap: 16 }, [thumb("Page 1", 1, "1"), thumb("Page 118", 118, "2"), thumb("Page 131", 131)]),
      ]),
      col({ gap: 24, flex: 1, minWidth: 0, maxWidth: 680 }, [
        appH1("Is this Harbour Cements’ annual report for 2025–26?", 36),
        body("Here is what Maester found and where it found it. Nothing is read until you say yes."),
        spec([
          ["What it is", `Annual report ${ref("· the title on the cover (1)")}`],
          ["Company", `Harbour Cements Ltd ${ref("· the cover (1) · already in your workspace")}`],
          ["Period", `Year to 31 March 2026 ${ref("· balance sheet heading, page 118 (2)")}`],
          ["Statements", `Standalone and consolidated ${ref("· pages 118–131")}`],
        ], { termW: 140 }),
        row({ gap: 16 }, [button("Yes, read the statements"), button("Something’s wrong", { variant: "outline" })]),
        note("Reading takes a few minutes and carries on if you leave. You’ll find it under Documents."),
      ]),
    ]),
  ] })
}
function C3() {
  return appPhone({ h: null, content: [
    note("Documents · kestrel-q1-fy27.pdf · 9 pages"),
    appH1("Are these Kestrel Power’s results for the quarter to 30 June 2026?", 26),
    div({ height: 230, overflow: "hidden", borderBottom: `2px solid ${T.ink}`, paddingTop: 8 }, div({ marginTop: -232 }, coverPage({ w: 342, phone: true, title: "Unaudited financial results for the quarter ended 30 June 2026", co: "Kestrel Power Limited", line2: "Regulation 33 filing" }))),
    spec([
      ["What it is", `Quarterly results<br>${ref("The title on page 1 (1)")}`],
      ["Company", `Kestrel Power Ltd<br>${ref("Page 1 · not in your workspace yet")}`],
      ["Period", `Quarter to 30 June 2026<br>${ref("Page 1 (1)")}`],
    ], { termW: 96 }),
    div({ border: `2px solid ${T.ink}`, padding: 16 }, body("Kestrel Power isn’t in your workspace yet. Saying yes adds it.", { fontSize: 16 })),
    button("Yes, add it and read", { style: { width: "100%" } }),
    button("Something’s wrong", { variant: "outline", style: { width: "100%" } }),
  ] })
}

// ---------- Shared: what every upload owes ----------
function S1() {
  const cols = [{ label: "When", w: "220px" }, { label: "What the page says", w: "minmax(0, 1.6fr)" }, { label: "What you can do", w: "minmax(0, 1fr)" }]
  const rows = [
    ["Too large", "This file is 62 MB. Maester takes PDFs up to 50 MB.", "Choose a smaller file"],
    ["Not a PDF", "This is a Word document. Save it as a PDF and add it again.", "Choose another file"],
    ["Added before", "You added this file on 2 October. It’s already been read.", "Open it · Read it again"],
    ["Pictures, not text", "The pages are scanned images. Maester can’t read scanned filings yet.", "Keep it anyway · Remove it"],
    ["Reading stopped", "Reading stopped on page 40. The file is safe.", "Try again"],
    ["You left the page", "Nothing stops. It’s here when you come back.", "—"],
    ["Signed out mid-upload", "The upload didn’t finish. Sign in and add it again.", "Sign in"],
  ].map((r) => r.map((c, i) => (i === 0 ? `<strong>${esc(c)}</strong>` : esc(c))))
  const tracks = cols.map((c) => c.w).join(" ")
  const line = (cells, extra = {}) => div({ display: "grid", gridTemplateColumns: tracks, gap: "0 16px", padding: "12px 16px", fontSize: 16, lineHeight: 1.45, ...extra }, cells.map((c) => div({ minWidth: 0 }, c)))
  return appPage({ active: "Documents", content: [
    col({ gap: 12 }, [appH1("What every upload owes", 36), body("The same states in every direction. Each says what happened and what to do; none is shown by colour.")]),
    div({ border: `2px solid ${T.ink}`, maxWidth: 1080 }, [line(cols.map((c) => esc(c.label)), { borderBottom: `2px solid ${T.ink}`, fontSize: 14, color: T.inkMuted }), ...rows.map((r, i) => line(r, { borderBottom: i === rows.length - 1 ? 0 : `1px solid ${T.inkMuted}` }))]),
  ] })
}

// ---------- writers ----------
const BASE_CSS = `body{margin:0;background:${T.paper};font-family:${FONT}}button{font-family:inherit;margin:0}a{color:inherit}h1,h2,h3,p,dl,dd,figure,ol{margin:0}a:hover{background:#000000;color:#EDEDE8;text-decoration:none}button:focus-visible,a:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:3px solid #000000;outline-offset:2px}`
function dcHtml({ title, w, h, body, logic }) {
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
${(logic || "class Component extends DCLogic {\nrenderVals() {\nreturn {};\n}\n}").trim()}
</script>
</body>
</html>
`
}
function twinize(html, vals = {}) {
  let out = html.replace(/\s(on[A-Z]\w*)="\{\{[^}]+\}\}"/g, "")
  return out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => (k in vals ? esc(vals[k]) : ""))
}
function twinHtml({ title, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="${FONTS}"><style>${BASE_CSS}</style></head><body>${body}</body></html>`
}

// ---------- frames ----------
const D = 1440, P = 390
const FRAMES = [
  { id: "Main.dc.html", title: "Today · /terminal signed in: one placeholder page", w: D, h: 900, render: today, row: 0 },
  { id: "A1.dc.html", title: "A1 · Every page has a door — Holdings, coming soon", w: D, h: 900, render: A1, row: 1 },
  { id: "A2.dc.html", title: "A2 · Every page has a door — Documents, one upload waiting for your check", w: D, h: 900, render: A2, row: 1 },
  { id: "A3.dc.html", title: "A3 · Every page has a door — Maester couldn’t tell, phone 390", w: P, h: 844, render: A3, row: 1, phone: true },
  { id: "B1.dc.html", title: "B1 · The intake desk — Holdings, coming soon (drag the load)", w: D, h: 900, render: B1, row: 2, logic: B_LOGIC, vals: B_VALS },
  { id: "B2.dc.html", title: "B2 · The intake desk — the slip, read as an annual report, carrying on", w: D, h: 900, render: B2, row: 2 },
  { id: "B3.dc.html", title: "B3 · The intake desk — another company document, kept, phone 390", w: P, h: 844, render: B3, row: 2, phone: true },
  { id: "C1.dc.html", title: "C1 · Blueprints — Holdings, coming soon: the page we’re drawing", w: D, h: 900, render: C1, row: 3 },
  { id: "C2.dc.html", title: "C2 · Blueprints — is this the annual report? Evidence on the page", w: D, h: 900, render: C2, row: 3 },
  { id: "C3.dc.html", title: "C3 · Blueprints — quarterly results, a company not yet added, phone 390", w: P, h: 844, render: C3, row: 3, phone: true },
  { id: "S1.dc.html", title: "Shared · the states every upload owes", w: D, h: 900, render: S1, row: 4 },
]
for (const f of FRAMES) {
  const m = HEIGHTS[f.id]
  if (m) f.h = Math.max(f.phone ? 844 : 900, m.content + (f.phone ? 0 : 0))
}
fs.mkdirSync(path.join(OUT, "project"), { recursive: true })
fs.mkdirSync(path.join(OUT, "twins"), { recursive: true })
const measuring = process.argv.includes("--measure")
for (const f of FRAMES) {
  const b = f.render()
  // Fix the root to the board size; null-height phone frames get their measured height.
  const sized = b.replace(/height: (auto|900px|844px)/, `height: ${f.h}px`)
  fs.writeFileSync(path.join(OUT, "project", f.id), dcHtml({ title: f.title, w: f.w, h: f.h, body: sized, logic: f.logic }))
  fs.writeFileSync(path.join(OUT, "twins", f.id.replace(".dc.html", ".html")), twinHtml({ title: f.title, body: twinize(measuring ? b : sized, f.vals) }))
}
fs.writeFileSync(path.join(OUT, "twins", "sheet.html"), `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#c9c9c4;font-family:system-ui}h2{font:600 14px system-ui;margin:24px 24px 8px}iframe{border:0;margin:0 24px;display:block;background:#fff}</style></head><body>${FRAMES.map((f) => `<h2>${esc(f.title)} (${f.w}×${f.h})</h2><iframe src="${f.id.replace(".dc.html", ".html")}" width="${f.w}" height="${f.h}"></iframe>`).join("")}</body></html>`)
fs.writeFileSync(path.join(OUT, "twins", "measure.html"), `<!doctype html><html><body><script>
const F=${JSON.stringify(FRAMES.map((f) => [f.id, f.w]))};
async function measureAll(){const out={};for(const [id,w] of F){const fr=document.createElement('iframe');fr.style.cssText='width:'+w+'px;height:400px;border:0';fr.src=id.replace('.dc.html','.html');document.body.appendChild(fr);await new Promise(r=>fr.onload=r);await fr.contentDocument.fonts.ready;const root=fr.contentDocument.body.firstElementChild;const kids=[...root.querySelectorAll('*')];const bottom=Math.max(...kids.map(k=>k.getBoundingClientRect().bottom));out[id]={frame:root.offsetHeight,content:Math.ceil(bottom)};fr.remove()}return out}
</script></body></html>`)

// ---------- canvas.json ----------
const NOTES = JSON.parse(fs.readFileSync(path.join(HERE, "documents-notes.json"), "utf8"))
const X0 = 720
const rowsN = 5
const rowH = Array.from({ length: rowsN }, (_, r) => Math.max(...FRAMES.filter((f) => f.row === r).map((f) => f.h)))
const ROW_Y = []
let y = 0
for (let r = 0; r < rowsN; r++) { ROW_Y.push(y); y += rowH[r] + 120 + 300 }
const boards = {}
const colX = {}
for (const f of FRAMES) {
  const x = colX[f.row] ?? X0
  boards[f.id] = { x, y: ROW_Y[f.row], w: f.w, h: f.h, title: f.title, ...(f.logic ? { is_interactive: true } : {}) }
  colX[f.row] = x + f.w + 80
}
const notes = {}
NOTES.rows.forEach((n, i) => {
  notes["title" + i] = { kind: "title1", text: n.title, x: 0, y: ROW_Y[i] - 260, maxW: colX[i] }
  notes["note" + i] = { text: n.note, x: 0, y: ROW_Y[i], w: 600, maxH: Math.min(1100, rowH[i]), size: "l", color: i === 0 ? "red" : i === 4 ? "green" : "orange" }
})
notes.shared = { text: NOTES.shared, x: X0 + D + 80, y: 0, w: 700, maxH: 900, size: "m", color: "green" }
notes.questions = { text: NOTES.questions, x: X0 + D + 80 + 780, y: 0, w: 600, maxH: 900, size: "l", color: "blue" }
const canvas = {
  v: 3,
  createdOnFiles: { v: 1, at: "2026-10-05T10:00:00Z" },
  title: "Maester Terminal Pages",
  launch: { view: "canvas" },
  pages: [],
  boards,
  order: FRAMES.map((f) => f.id),
  notes,
  designSystems: [],
}
fs.writeFileSync(path.join(OUT, "project", "canvas.json"), JSON.stringify(canvas, null, 2))
console.log("built", FRAMES.length, "frames", FRAMES.map((f) => f.id + ":" + f.h).join(" "))
