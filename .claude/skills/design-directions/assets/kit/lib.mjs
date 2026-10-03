// Frame kit for Maester design canvases.
// Tokens copied from apps/web/src/lib/styles/tokens.css, 2026-10-02.
// Anatomy copied from the running index page (Masthead, Register, Ledger,
// AccuracySpec, the suggestion block) and UI_SPECIFICATION §2 (app shell).
// Machinery (css/el/esc, writers, two-pass build) adapted from the bull-crm kit.
// Plain Node ESM, no dependencies.

export const T = {
  paper: "#EDEDE8",
  ink: "#000000",
  inkMuted: "#5F5F5B", // secondary text and hairlines on paper only
  paperMuted: "rgba(237, 237, 232, 0.72)", // secondary text on ink panels only
}
// Illustration-only inks live apart so nothing but an illustration reaches them.
export const ILLUS = { yellow: "#F2C53D", red: "#E0483A", blue: "#2F5FD0" }

export const FONT = "'Archivo', 'Helvetica Neue', Arial, sans-serif"
export const FONTS_LINK = "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&amp;display=swap"
export const NUM = { fontVariantNumeric: "tabular-nums slashed-zero" }

const UNITLESS = new Set(["flex", "flexGrow", "flexShrink", "fontWeight", "opacity", "zIndex", "lineHeight"])
export function css(o) {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => {
      const key = k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())
      const val = typeof v === "number" && !UNITLESS.has(k) ? v + "px" : v
      return `${key}: ${val}`
    })
    .join("; ")
}
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// el(tag, style, children, attrs) — children: string | array (strings are raw HTML).
export function el(tag, style = {}, children = "", attrs = {}) {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${String(v).replace(/"/g, "&quot;")}"`))
    .join("")
  const s = css(style)
  const kids = Array.isArray(children) ? children.flat(Infinity).filter(Boolean).join("") : children
  if (["input", "img", "br"].includes(tag)) return `<${tag}${s ? ` style="${s}"` : ""}${a}>`
  return `<${tag}${s ? ` style="${s}"` : ""}${a}>${kids}</${tag}>`
}
export const div = (style, children, attrs) => el("div", style, children, attrs)
export const row = (style, children, attrs) => div({ display: "flex", flexDirection: "row", alignItems: "center", ...style }, children, attrs)
export const col = (style, children, attrs) => div({ display: "flex", flexDirection: "column", ...style }, children, attrs)
export const txt = (t, style = {}) => div({ fontSize: 17, lineHeight: 1.5, ...style }, esc(t))
export const muted = (t, style = {}) => txt(t, { color: T.inkMuted, fontSize: 14, lineHeight: 1.45, ...style })
export const spacer = () => div({ flex: 1 })

// ---------- type roles (DESIGN.md §3) ----------
export const display = (t, size = 64, style = {}) =>
  el("h1", { margin: 0, fontStretch: "125%", fontWeight: 800, fontSize: size, lineHeight: 0.95, letterSpacing: "-0.03em", ...style }, esc(t))
export const h1app = (t, style = {}) =>
  el("h1", { margin: 0, fontStretch: "125%", fontWeight: 800, fontSize: 40, lineHeight: 1.1, letterSpacing: "-0.02em", ...style }, esc(t))
export const h2 = (t, size = 28, style = {}) =>
  el("h2", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: size, lineHeight: 1.1, letterSpacing: "-0.02em", ...style }, esc(t))
export const h3 = (t, style = {}) => el("h3", { margin: 0, fontWeight: 700, fontSize: 20, lineHeight: 1.2, ...style }, esc(t))
export const figure = (t, size = 40, style = {}) =>
  div({ fontStretch: "110%", fontWeight: 700, fontSize: size, lineHeight: 1.05, letterSpacing: "-0.02em", ...NUM, ...style }, esc(t))

// ---------- pieces (DESIGN.md §5) ----------
export function button(label, { variant = "fill", inverted = false, style = {} } = {}) {
  const fg = inverted ? T.ink : T.paper
  const bg = inverted ? T.paper : T.ink
  const v = variant === "fill"
    ? { background: bg, color: fg, border: `2px solid ${bg}` }
    : { background: "transparent", color: inverted ? T.paper : T.ink, border: `2px solid ${inverted ? T.paper : T.ink}` }
  return el("button", { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 44, padding: "0 24px", fontFamily: "inherit", fontSize: 17, fontWeight: 700, borderRadius: 0, whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer", ...v, ...style }, esc(label), { type: "button" })
}
export const link = (t, { href = "#", style = {} } = {}) =>
  el("a", { color: "inherit", textDecoration: "underline", textUnderlineOffset: "3px", textDecorationThickness: "1.5px", ...style }, esc(t), { href })
export const tag = (t, { inverted = false, style = {} } = {}) =>
  el("span", { display: "inline-block", border: `1.5px solid ${inverted ? T.paper : T.ink}`, padding: "4px 8px", fontSize: 14, lineHeight: 1.2, whiteSpace: "nowrap", ...style }, esc(t))
export const synthetic = (style) => tag("Synthetic example", { style })

// A ledger: 2px box, 2px header rule, 1px muted hairlines, right-aligned tabular figures.
// cols: [{ label, w (css grid track), align }], rows: arrays of cell html (already escaped).
export function ledger({ cols, rows, total, label, rowPad = "12px 16px", fontSize = 16, inverted = false }) {
  const tracks = cols.map((c) => c.w || "minmax(0, 1fr)").join(" ")
  const line = inverted ? T.paper : T.ink
  const hair = inverted ? T.paper : T.inkMuted
  const cell = (html, c, extra = {}) => div({ textAlign: c.align || "left", minWidth: 0, ...(c.align === "right" ? NUM : {}), ...extra }, html)
  const head = div({ display: "grid", gridTemplateColumns: tracks, gap: "0 16px", padding: rowPad, borderBottom: `2px solid ${line}`, fontSize: 14, color: inverted ? T.paperMuted : T.inkMuted }, cols.map((c) => cell(esc(c.label), c)))
  const body = rows.map((r, i) =>
    div({ display: "grid", gridTemplateColumns: tracks, gap: "0 16px", alignItems: "baseline", padding: rowPad, fontSize, lineHeight: 1.45, borderBottom: i === rows.length - 1 && !total ? "0" : `1px solid ${hair}` }, r.map((h, j) => cell(h, cols[j]))),
  )
  const tot = total
    ? div({ display: "grid", gridTemplateColumns: tracks, gap: "0 16px", alignItems: "baseline", padding: rowPad, fontSize, fontWeight: 700, borderTop: `2px solid ${line}` }, total.map((h, j) => cell(h, cols[j])))
    : ""
  return div({ border: `2px solid ${line}`, flexShrink: 0 }, [head, ...body, tot], label ? { role: "table", "aria-label": label } : {})
}

// Spec list (AccuracySpec): 2px top rule, 1px between entries, 2px closing rule.
export function spec(entries, { termW = 160, inverted = false } = {}) {
  const line = inverted ? T.paper : T.ink
  const hair = inverted ? T.paper : T.inkMuted
  return el("dl", { margin: 0, borderTop: `2px solid ${line}`, borderBottom: `2px solid ${line}` },
    entries.map(([term, detail], i) =>
      div({ display: "grid", gridTemplateColumns: `${termW}px minmax(0, 1fr)`, gap: 16, padding: "12px 0", borderTop: i ? `1px solid ${hair}` : "0" }, [
        el("dt", { fontWeight: 700, fontSize: 16, lineHeight: 1.45 }, esc(term)),
        el("dd", { margin: 0, fontSize: 16, lineHeight: 1.45 }, detail),
      ]),
    ),
  )
}

// Ranked ink bars: label, bar, value. Direction or identity never by colour.
export function bars(items, { max, labelW = 150, valueW = 56, barH = 12 } = {}) {
  const m = max || Math.max(...items.map((i) => i.v))
  return col({ gap: 0 }, items.map((it, i) =>
    div({ display: "grid", gridTemplateColumns: `${labelW}px minmax(0, 1fr) ${valueW}px`, gap: 12, alignItems: "center", padding: "10px 0", borderTop: i ? `1px solid ${T.inkMuted}` : "0", fontSize: 16 }, [
      div({ minWidth: 0, color: it.muted ? T.inkMuted : T.ink }, esc(it.label)),
      div({ height: barH, position: "relative" }, div({ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(it.v / m) * 100}%`, background: it.muted ? "transparent" : T.ink, border: it.muted ? `1.5px dashed ${T.ink}` : "0", boxSizing: "border-box" })),
      div({ textAlign: "right", ...NUM }, esc(it.label2 ?? it.v.toFixed(1) + "%")),
    ]),
  ))
}
// Inline weight bar for a ledger cell.
export const weightBar = (pct, max = 25, limit) =>
  row({ gap: 10, justifyContent: "flex-end" }, [
    div({ width: 96, height: 10, position: "relative", flexShrink: 0 }, [
      div({ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(pct / max, 1) * 100}%`, background: T.ink }),
      limit ? div({ position: "absolute", left: `${(limit / max) * 100}%`, top: -4, bottom: -4, width: 2, background: T.ink }) : "",
    ]),
    el("span", { minWidth: 48, textAlign: "right", ...NUM }, esc(pct.toFixed(1) + "%")),
  ])

// ---------- shells ----------
export const NAV = [
  { group: "Portfolio", items: ["Overview", "Holdings"] },
  { group: "Research", items: ["Research", "Watchlist", "Documents", "Analyst"] },
]
export const NAV_BOTTOM = ["Activity", "Settings"]

function navItem(label, active) {
  return el("a", { display: "flex", alignItems: "center", minHeight: 44, padding: "0 12px", margin: "0 -12px", fontSize: 17, fontWeight: active ? 700 : 400, color: active ? T.paper : T.ink, background: active ? T.ink : "transparent", textDecoration: active ? "none" : "underline", textUnderlineOffset: "3px", textDecorationThickness: "1.5px" }, esc(label), { href: "#", "aria-current": active ? "page" : undefined })
}
function rail(active) {
  return col({ width: 224, flexShrink: 0, borderRight: `2px solid ${T.ink}`, boxSizing: "border-box", alignSelf: "stretch" }, [
    row({ height: 56, padding: "0 24px", borderBottom: `2px solid ${T.ink}`, flexShrink: 0 }, [
      el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink }, "Maester", { href: "#" }),
    ]),
    col({ padding: "16px 24px", gap: 4, borderBottom: `1px solid ${T.inkMuted}` }, [
      muted("Workspace"),
      el("button", { display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 44, padding: "0 12px", border: `2px solid ${T.ink}`, background: "transparent", fontFamily: "inherit", fontSize: 16, fontWeight: 700, color: T.ink, borderRadius: 0 }, `Personal<span aria-hidden="true">▾</span>`, { type: "button" }),
    ]),
    el("nav", { display: "flex", flexDirection: "column", padding: "8px 24px", gap: 0, flex: 1 }, [
      ...NAV.map((g) => col({ padding: "12px 0", gap: 0 }, [muted(g.group, { marginBottom: 4 }), ...g.items.map((i) => navItem(i, i === active))])),
    ], { "aria-label": "Terminal" }),
    col({ padding: "12px 24px 20px", borderTop: `1px solid ${T.inkMuted}` }, NAV_BOTTOM.map((i) => navItem(i, i === active))),
  ])
}
function contextHeader({ portfolio = "Long-term", search = true } = {}) {
  return row({ height: 56, padding: "0 24px", gap: 16, borderBottom: `2px solid ${T.ink}`, flexShrink: 0, boxSizing: "border-box" }, [
    portfolio
      ? el("button", { display: "inline-flex", alignItems: "center", gap: 10, minHeight: 40, padding: "0 12px", border: `2px solid ${T.ink}`, background: "transparent", fontFamily: "inherit", fontSize: 16, fontWeight: 700, color: T.ink, borderRadius: 0 }, `Portfolio: ${esc(portfolio)} <span aria-hidden="true">▾</span>`, { type: "button" })
      : "",
    search
      ? el("label", { display: "flex", alignItems: "center", flex: 1, maxWidth: 520, minHeight: 40, border: `2px solid ${T.ink}`, padding: "0 12px", fontSize: 16, color: T.inkMuted, boxSizing: "border-box" }, "Search companies, documents and notes")
      : spacer(),
    spacer(),
    link("Activity"),
    link("Account"),
  ])
}
// Desktop terminal frame. h = null renders height:auto (measure pass).
export function appShell({ active = "Overview", w = 1440, h = 900, content, header = {}, mainStyle = {} }) {
  return div({ display: "flex", flexDirection: "row", alignItems: "stretch", width: w, height: h === null ? "auto" : h, minHeight: h === null ? 900 : undefined, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper, boxSizing: "border-box", flexShrink: 0 }, [
    rail(active),
    col({ flex: 1, minWidth: 0 }, [
      contextHeader(header),
      el("main", { display: "flex", flexDirection: "column", padding: "32px 24px 56px", gap: 32, minWidth: 0, maxWidth: 1440, boxSizing: "border-box", ...mainStyle }, content, { "data-measure": "content" }),
    ]),
  ])
}
// Phone terminal frame: rail folds into a top bar with a menu drawer, 24px gutters.
export function phoneShell({ w = 390, h = 844, content, portfolio = "Long-term", mainStyle = {} }) {
  return div({ display: "flex", flexDirection: "column", width: w, height: h === null ? "auto" : h, minHeight: h === null ? 844 : undefined, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper, boxSizing: "border-box", flexShrink: 0 }, [
    row({ height: 56, padding: "0 16px 0 24px", borderBottom: `2px solid ${T.ink}`, flexShrink: 0, justifyContent: "space-between" }, [
      el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink }, "Maester", { href: "#" }),
      button("Menu", { variant: "outline", style: { padding: "0 16px", fontSize: 16 } }),
    ]),
    portfolio
      ? row({ minHeight: 56, padding: "6px 24px", borderBottom: `2px solid ${T.ink}`, flexShrink: 0, gap: 12 }, [
          el("button", { display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 12px", border: `2px solid ${T.ink}`, background: "transparent", fontFamily: "inherit", fontSize: 16, fontWeight: 700, color: T.ink, borderRadius: 0 }, `Portfolio: ${esc(portfolio)} <span aria-hidden="true">▾</span>`, { type: "button" }),
          spacer(),
          link("Search"),
        ])
      : "",
    el("main", { display: "flex", flexDirection: "column", padding: "24px 24px 48px", gap: 28, minWidth: 0, ...mainStyle }, content, { "data-measure": "content" }),
  ])
}
// The public masthead (for Today frames of terminal pages).
export function publicShell({ w = 1440, h = 900, content }) {
  return div({ display: "flex", flexDirection: "column", width: w, height: h, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper, boxSizing: "border-box" }, [
    row({ padding: "16px 48px", gap: 24, borderBottom: `2px solid ${T.ink}` }, [
      el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink, marginRight: "auto" }, "Maester", { href: "#" }),
      row({ gap: 24, marginRight: 16 }, ["What it watches", "How it works", "Why trust it", "Where we are"].map((l) => link(l, { style: { fontSize: 17 } }))),
      button("Enter the terminal"),
    ]),
    el("main", { padding: "48px 48px 56px", display: "flex", flexDirection: "column", gap: 20 }, content),
  ])
}

// An inverted panel (ink ground, paper text).
export const inverted = (children, style = {}) => div({ background: T.ink, color: T.paper, flexShrink: 0, ...style }, children)

// Section with a label above (app pages fold the register into the main column).
export function section(title, children, { aside, gap = 16, style = {} } = {}) {
  return el("section", { display: "flex", flexDirection: "column", gap, minWidth: 0, ...style }, [
    row({ justifyContent: "space-between", gap: 16, alignItems: "baseline" }, [h2(title, 22), aside || ""]),
    children,
  ])
}

// ---------- writers ----------
const BASE_CSS = `body{margin:0;background:${T.paper};font-family:${FONT}}button{font-family:inherit;margin:0}a{color:inherit}h1,h2,h3,p,dl,dd{margin:0}`
export function dcHtml({ title, w, h, body }) {
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
<link rel="stylesheet" href="${FONTS_LINK}">
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
export function twinHtml({ title, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="${FONTS_LINK}"><style>${BASE_CSS}</style></head><body>${body}</body></html>`
}
