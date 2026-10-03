// node errors.mjs → ../canvas/project/*.dc.html, canvas.json, ../canvas/twins/*
// Round 1 of the Maester Error Screens canvas (2026-10-03): Today + A/B/C/D + shared states.
// Interactive boards carry a DCLogic class; their twins render the default state.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { T, ILLUS, FONT, NUM, esc, el, div, row, col, txt, muted, spacer, h2, h3, button, link, tag, synthetic, spec, inverted } from "./lib.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, "..", "canvas")
const FONTS = "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&amp;family=Caveat:wght@400..700&amp;display=swap"
const HAND = "'Caveat', 'Bradley Hand', cursive"

// ---------- type ----------
const displayH1 = (t, size, style = {}) =>
  el("h1", { margin: 0, fontStretch: "125%", fontWeight: 800, fontSize: size, lineHeight: 0.95, letterSpacing: "-0.03em", ...style }, esc(t))
const appH1 = (t, size = 40, style = {}) =>
  el("h1", { margin: 0, fontStretch: "125%", fontWeight: 800, fontSize: size, lineHeight: 1.1, letterSpacing: "-0.02em", ...style }, esc(t))
const body = (t, style = {}) => el("p", { margin: 0, fontSize: 17, lineHeight: 1.5, maxWidth: 620, ...style }, esc(t))
const note = (t, style = {}) => el("p", { margin: 0, fontSize: 14, lineHeight: 1.45, color: T.inkMuted, ...style }, esc(t))
const aLink = (t, href = "#", style = {}) => link(t, { href, style: { fontSize: 17, ...style } })
const linkBtn = (label, { variant = "fill", style = {}, href = "#" } = {}) => {
  const v = variant === "fill" ? { background: T.ink, color: T.paper } : { background: T.paper, color: T.ink }
  return el("a", { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 44, padding: "0 24px", border: `2px solid ${T.ink}`, fontSize: 17, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0, boxSizing: "border-box", ...v, ...style }, esc(label), { href })
}

// ---------- public shell: masthead + register ----------
const NAVL = ["What it watches", "How it works", "Why trust it", "Where we are"]
function masthead(phone) {
  if (phone)
    return col({ padding: "16px 24px", gap: 12, borderBottom: `2px solid ${T.ink}`, flexShrink: 0 }, [
      row({ justifyContent: "space-between", gap: 12 }, [
        el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink }, "Maester", { href: "#" }),
        linkBtn("Enter the terminal", { style: { padding: "0 16px", fontSize: 16 } }),
      ]),
      el("nav", { display: "flex", flexWrap: "wrap", gap: "8px 24px" }, NAVL.map((l) => aLink(l)), { "aria-label": "Primary" }),
    ])
  return row({ padding: "16px 48px", gap: 24, borderBottom: `2px solid ${T.ink}`, flexShrink: 0 }, [
    el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink, marginRight: "auto" }, "Maester", { href: "#" }),
    el("nav", { display: "flex", gap: 24, marginRight: 16 }, NAVL.map((l) => aLink(l)), { "aria-label": "Primary" }),
    linkBtn("Enter the terminal"),
  ])
}
// The register: a 224px rail label beside the content from 1024px, folded above it on a phone.
function register(label, content, { phone = false, sub, style = {} } = {}) {
  const lab = col({ gap: 4, flexShrink: 0, width: phone ? "auto" : 224, paddingRight: phone ? 0 : 24, boxSizing: "border-box" }, [
    div({ fontSize: 16, fontWeight: 700, lineHeight: 1.45 }, esc(label)),
    sub ? div({ fontSize: 14, color: T.inkMuted, lineHeight: 1.45, ...NUM }, esc(sub)) : "",
  ])
  return el("section", { display: "flex", flexDirection: phone ? "column" : "row", gap: phone ? 12 : 0, padding: phone ? "24px 24px 32px" : "48px 48px 56px", minWidth: 0, ...style }, [
    lab,
    col({ flex: 1, minWidth: 0, gap: 24 }, content),
  ])
}
function pubPage({ w, h, phone = false, sections, footer = true }) {
  return div({ display: "flex", flexDirection: "column", width: w, height: h, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper, boxSizing: "border-box" }, [
    masthead(phone),
    el("main", { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }, sections),
    footer ? row({ padding: phone ? "16px 24px" : "16px 48px", borderTop: `2px solid ${T.ink}`, gap: 24, fontSize: 14, color: T.inkMuted, flexShrink: 0 }, [div({}, "Maester is a working name."), spacer(), div({ fontStretch: "125%", fontWeight: 800, fontSize: 18, color: T.ink }, "Maester")]) : "",
  ])
}

// ---------- terminal shell (as built: TerminalShell.svelte) ----------
function railNav() {
  return col({ width: 224, flexShrink: 0, borderRight: `2px solid ${T.ink}`, boxSizing: "border-box", alignSelf: "stretch" }, [
    row({ height: 56, padding: "0 24px", borderBottom: `2px solid ${T.ink}`, flexShrink: 0 }, [
      el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink }, "Maester", { href: "#" }),
    ]),
    col({ padding: "16px 24px", gap: 4, borderBottom: `1px solid ${T.inkMuted}` }, [muted("Workspace"), div({ fontWeight: 700, fontSize: 16 }, "Personal")]),
    el("nav", { display: "flex", flexDirection: "column", padding: "20px 24px" }, [
      el("a", { display: "flex", alignItems: "center", minHeight: 44, padding: "0 12px", margin: "0 -12px", fontWeight: 700, color: T.paper, background: T.ink, textDecoration: "none", fontSize: 17 }, "Overview", { href: "#" }),
    ], { "aria-label": "Terminal" }),
  ])
}
function context({ portfolio = "Portfolio: Long-term", right = "" } = {}) {
  return row({ minHeight: 56, padding: "8px 24px", gap: 16, borderBottom: `2px solid ${T.ink}`, flexShrink: 0, boxSizing: "border-box", justifyContent: "space-between" }, [
    div({ fontWeight: 700, fontSize: 16 }, esc(portfolio)),
    right,
  ])
}
function appPage({ w = 1440, h = 900, content, ctx = {}, mainStyle = {} }) {
  return div({ display: "flex", flexDirection: "row", alignItems: "stretch", width: w, height: h, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper, boxSizing: "border-box" }, [
    railNav(),
    col({ flex: 1, minWidth: 0 }, [
      context(ctx),
      el("main", { display: "flex", flexDirection: "column", padding: "32px 24px 48px", gap: 28, minWidth: 0, ...mainStyle }, content),
    ]),
  ])
}
function appPhone({ w = 390, h = 844, content, ctx = {} }) {
  return div({ display: "flex", flexDirection: "column", width: w, height: h, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper, boxSizing: "border-box" }, [
    row({ height: 56, padding: "0 16px 0 24px", borderBottom: `2px solid ${T.ink}`, flexShrink: 0, justifyContent: "space-between" }, [
      el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink }, "Maester", { href: "#" }),
      button("Menu", { variant: "outline", style: { padding: "0 16px", fontSize: 16 } }),
    ]),
    context(ctx),
    el("main", { display: "flex", flexDirection: "column", padding: "24px 24px 40px", gap: 24, minWidth: 0 }, content),
  ])
}

// ---------- shared copy ----------
const NF = {
  h1: "Nothing at this address.",
  body: "The link may be out of date, or the address may have a typo.",
  asked: "/termnal",
}
const PAGES = [
  ["The index page", "/", "What Maester does for an investor"],
  ["Sign in", "/login", "Get into your terminal"],
  ["The terminal", "/terminal", "Your holdings, thesis and suggestions"],
  ["The demo terminal", "/terminal/demo", "A synthetic portfolio to look around"],
]
const BROKE = {
  h1: "The overview didn’t load.",
  body: "Something went wrong on our side. Nothing you saved has changed.",
}
// The address you typed, with the missing letter shown as an inked gap.
const typo = (size = 17) =>
  el("span", { ...NUM, fontSize: size }, `/term<span style="${"display: inline-block; background: #000000; color: #EDEDE8; padding: 0 3px"}">i</span>nal`)

// ---------- A · The check that ran ----------
const A_LOGIC = `
class Component extends DCLogic {
renderVals() {
const q = (this.state && this.state.q) || '';
const ql = q.trim().toLowerCase();
const pages = ${JSON.stringify(PAGES.map((p) => p.join(" ").toLowerCase()))};
const show = pages.map((p) => !ql || p.includes(ql));
const n = show.filter(Boolean).length;
return {
q,
type: (e) => this.setState({ q: e.target.value }),
show0: show[0], show1: show[1], show2: show[2], show3: show[3],
none: n === 0,
count: !ql ? 'Four pages on this site.' : n === 0 ? 'No page matches \\u201c' + q + '\\u201d.' : n + ' of 4 pages match.',
};
}
}`
const A_VALS = { q: "", show0: true, show1: true, show2: true, show3: true, none: false, count: "Four pages on this site." }
function pagesFinder({ phone = false } = {}) {
  const cols = phone ? "minmax(0, 1fr)" : "220px 180px minmax(0, 1fr)"
  const r = (p, i) =>
    el("sc-if", {}, div({ display: "grid", gridTemplateColumns: cols, gap: phone ? 2 : 16, padding: "12px 16px", borderTop: `1px solid ${T.inkMuted}`, alignItems: "baseline" }, [
      aLink(p[0], "#", { fontWeight: 700 }),
      div({ fontSize: phone ? 14 : 16, ...NUM, color: phone ? T.inkMuted : T.ink }, esc(p[1])),
      phone ? "" : div({ fontSize: 16, color: T.inkMuted }, esc(p[2])),
    ]), { value: `{{show${i}}}`, "hint-placeholder-val": "{{true}}" })
  return col({ gap: 12, maxWidth: 880 }, [
    el("label", { fontSize: 16, fontWeight: 700 }, "Look for a page", { for: "find" }),
    el("input", { height: 44, border: `2px solid ${T.ink}`, background: T.paper, padding: "0 12px", fontFamily: "inherit", fontSize: 17, borderRadius: 0, boxSizing: "border-box", width: phone ? "100%" : 420, color: T.ink }, "", { id: "find", type: "search", value: "{{q}}", onChange: "{{type}}", placeholder: "Try “demo” or “sign”", autocomplete: "off" }),
    div({ border: `2px solid ${T.ink}` }, [
      div({ padding: "10px 16px", fontSize: 14, color: T.inkMuted, ...NUM }, "{{count}}", { "aria-live": "polite" }),
      ...PAGES.map(r),
      el("sc-if", {}, div({ padding: "12px 16px", borderTop: `1px solid ${T.inkMuted}`, fontSize: 16 }, "Try a shorter word, or go to the index page."), { value: "{{none}}", "hint-placeholder-val": "{{false}}" }),
    ]),
  ])
}
function A_trace(phone) {
  return spec([
    ["You asked for", `<span style="font-variant-numeric: tabular-nums slashed-zero">${esc(NF.asked)}</span>`],
    ["Closest page", `${typo()} <span style="color: #5F5F5B">· one letter missing</span>`],
    ["Pages checked", "All four pages on this site. None is at this address."],
  ], { termW: phone ? 120 : 180 })
}
function A1() {
  return pubPage({ w: 1440, h: 900, sections: [
    register("Not found", [
      displayH1(NF.h1, 104),
      body(NF.body),
      A_trace(false),
      row({ gap: 24, flexWrap: "wrap" }, [linkBtn("Go to the terminal"), aLink("Go to the index page")]),
    ], { sub: "Error 404" }),
    register("Every page", [pagesFinder()], { style: { borderTop: `2px solid ${T.ink}`, paddingTop: 32 } }),
  ] })
}
function A3() {
  return pubPage({ w: 390, h: 1180, phone: true, footer: false, sections: [
    register("Not found", [
      displayH1(NF.h1, 44),
      body(NF.body),
      A_trace(true),
      col({ gap: 16, alignItems: "flex-start" }, [linkBtn("Go to the terminal", { style: { width: "100%" } }), aLink("Go to the index page")]),
    ], { phone: true, sub: "Error 404" }),
    register("Every page", [pagesFinder({ phone: true })], { phone: true, style: { borderTop: `2px solid ${T.ink}` } }),
  ] })
}
const A2_LOGIC = `
class Component extends DCLogic {
renderVals() {
const n = (this.state && this.state.n) || 0;
return {
tried: n > 0,
status: n === 0 ? '' : 'Tried again at 14:0' + Math.min(9, 2 + n) + '. Still not loading. Wait a few minutes, then try again.',
retry: () => this.setState({ n: n + 1 }),
};
}
}`
function brokeSpec() {
  return spec([
    ["Page", "Overview"],
    ["When", `<span style="font-variant-numeric: tabular-nums slashed-zero">3 Oct 2026, 14:02</span>`],
    ["Still works", "Everything else in the terminal. Your holdings and notes are saved."],
    ["What to do", "Try again. If it keeps failing, wait a few minutes; it’s ours to fix."],
  ], { termW: 160 })
}
function A2() {
  return appPage({ content: [
    col({ gap: 12, maxWidth: 880 }, [
      row({ gap: 12 }, [tag("Didn’t load")]),
      appH1(BROKE.h1),
      body(BROKE.body),
    ]),
    div({ maxWidth: 880 }, brokeSpec()),
    row({ gap: 24 }, [button("Try again", { style: {} }), aLink("Go to the index page")]),
    el("p", { margin: 0, fontSize: 16, fontWeight: 700 }, "{{status}}", { role: "status", "aria-live": "polite" }),
  ] })
}

// ---------- B · Squash and stretch ----------
const B_LOGIC = `
class Component extends DCLogic {
renderVals() {
const s = this.state || {};
const w = s.w == null ? 100 : s.w;
const set = (v) => this.setState({ w: Math.max(62, Math.min(125, Math.round(v))) });
const at = (e) => { const r = e.currentTarget.getBoundingClientRect(); return 62 + 63 * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
return {
w, wv: w + '%', mark: ((w - 62) / 63 * 100).toFixed(1) + '%',
down: (e) => { this.setState({ drag: true }); try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {} set(at(e)); },
move: (e) => { if (this.state && this.state.drag) set(at(e)); },
up: () => this.setState({ drag: false }),
key: (e) => {
if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); set(w - 7); }
else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); set(w + 7); }
else if (e.key === 'Home') { e.preventDefault(); set(62); }
else if (e.key === 'End') { e.preventDefault(); set(125); }
},
caption: w <= 68 ? 'Squeezed flat. Still nothing here.' : w >= 119 ? 'Stretched all the way. Still nothing here.' : 'Drag the number sideways, or focus it and use the arrow keys.',
};
}
}`
const B_VALS = { w: 100, wv: "100%", mark: "60.3%", caption: "Drag the number sideways, or focus it and use the arrow keys." }
function stretchNumber(digits, { size, phone = false } = {}) {
  return col({ gap: 12, minWidth: 0 }, [
    div({ fontStretch: "{{wv}}", fontWeight: 800, fontSize: size, lineHeight: 0.8, letterSpacing: "-0.04em", ...NUM, cursor: "ew-resize", touchAction: "none", userSelect: "none", padding: "12px 0 8px", whiteSpace: "nowrap", overflow: "hidden" }, esc(digits), {
      role: "slider", tabindex: "0", "aria-label": `Width of the number ${digits}, for fun`, "aria-valuemin": "62", "aria-valuemax": "125", "aria-valuenow": "{{w}}", "aria-valuetext": "{{w}} percent wide",
      onPointerDown: "{{down}}", onPointerMove: "{{move}}", onPointerUp: "{{up}}", onKeyDown: "{{key}}",
    }),
    // the ruler: the real range of the width axis, with a mark where the number sits
    div({ position: "relative", height: 28, borderTop: `2px solid ${T.ink}` }, [
      div({ position: "absolute", left: "{{mark}}", top: -10, width: 2, height: 18, background: T.ink }),
      div({ position: "absolute", left: 0, top: 8, fontSize: 14, color: T.inkMuted, ...NUM }, "62%"),
      div({ position: "absolute", left: "60.3%", top: 8, fontSize: 14, color: T.inkMuted, ...NUM, transform: "translateX(-50%)" }, "100%"),
      div({ position: "absolute", right: 0, top: 8, fontSize: 14, color: T.inkMuted, ...NUM }, "125%"),
    ]),
    el("p", { margin: 0, fontSize: phone ? 16 : 17, fontWeight: 700 }, "{{caption}}", { "aria-live": "polite" }),
  ])
}
function B1() {
  return pubPage({ w: 1440, h: 900, sections: [
    register("Not found", [
      displayH1(NF.h1, 104),
      body(NF.body),
      row({ gap: 24 }, [linkBtn("Go to the index page"), aLink("Enter the terminal")]),
      stretchNumber("404", { size: 300 }),
    ], { sub: "Error 404" }),
  ] })
}
function B3() {
  return pubPage({ w: 390, h: 844, phone: true, footer: false, sections: [
    register("Not found", [
      displayH1(NF.h1, 44),
      body(NF.body),
      col({ gap: 16, alignItems: "flex-start" }, [linkBtn("Go to the index page", { style: { width: "100%" } }), aLink("Enter the terminal")]),
      stretchNumber("404", { size: 150, phone: true }),
    ], { phone: true, sub: "Error 404" }),
  ] })
}
function B2() {
  return appPage({ content: [
    row({ gap: 32, alignItems: "flex-end", maxWidth: 1100 }, [
      div({ fontStretch: "62%", fontWeight: 800, fontSize: 168, lineHeight: 0.8, letterSpacing: "-0.04em", ...NUM, flexShrink: 0 }, "500", { "aria-hidden": "true" }),
      col({ gap: 12, paddingBottom: 4 }, [appH1(BROKE.h1), body(BROKE.body)]),
    ]),
    div({ maxWidth: 880 }, brokeSpec()),
    row({ gap: 24 }, [button("Try again"), aLink("Go to the index page")]),
    note("Inside the terminal the number stays put: squeezed to 62%, never draggable."),
  ] })
}

// ---------- C · The sketchbook ----------
const roughDefs = `<defs>
<filter id="r1" x="-3%" y="-3%" width="106%" height="106%"><feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="7" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap></filter>
<filter id="r2" x="-3%" y="-3%" width="106%" height="106%"><feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="19" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap></filter>
<pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><line x1="0" y1="0" x2="0" y2="7" stroke="#000000" stroke-width="1.6"></line></pattern>
</defs>`
// Two-plate drawing helper: colour plate (offset) under an ink plate drawn twice.
const plates = (colour, ink) => `
<g transform="translate(7 6)">${colour}</g>
<g fill="none" stroke="#000000" stroke-linecap="round" stroke-linejoin="round" stroke-width="3.2" filter="url(#r1)">${ink}</g>
<g fill="none" stroke="#000000" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4" opacity="0.55" filter="url(#r2)" transform="translate(1.5 -1)">${ink}</g>`

// C1: an open ledger on a desk. A magnifying glass follows the pointer and finds nothing.
const ledgerInk = `
<path d="M70 150 L 300 130 L 300 520 L 70 540 Z"></path>
<path d="M300 130 L 530 150 L 530 540 L 300 520"></path>
${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<path d="M95 ${200 + i * 36} L 280 ${186 + i * 36}"></path><path d="M320 ${186 + i * 36} L 505 ${200 + i * 36}"></path>`).join("")}
<path d="M200 160 L 200 520"></path><path d="M420 150 L 420 525"></path>
<path d="M60 560 Q 300 585 560 560"></path>
<path d="M545 170 L 590 470"></path><path d="M538 168 l 6 -14 l 8 12"></path>`
const ledgerColour = `
<path d="M70 150 L 300 130 L 300 520 L 70 540 Z" fill="${ILLUS.yellow}"></path>
<path d="M300 130 L 530 150 L 530 540 L 300 520 Z" fill="${ILLUS.yellow}"></path>
<path d="M286 128 L 312 128 L 312 600 L 299 586 L 286 600 Z" fill="${ILLUS.red}"></path>
<path d="M545 170 L 590 470 L 600 468 L 555 168 Z" fill="${ILLUS.blue}"></path>`
const C_LOGIC = `
class Component extends DCLogic {
renderVals() {
const s = this.state || {};
const lx = s.lx == null ? 360 : s.lx, ly = s.ly == null ? 300 : s.ly;
return {
lx, ly, hx1: lx + 58, hy1: ly + 58, hx2: lx + 150, hy2: ly + 150,
found: !!s.seen,
hint: s.seen ? 'Nothing filed here. Not even a footnote.' : 'Move the glass over the ledger.',
look: (e) => {
const r = e.currentTarget.getBoundingClientRect();
const x = Math.round(((e.clientX - r.left) / r.width) * 600), y = Math.round(((e.clientY - r.top) / r.height) * 640);
this.setState({ lx: x, ly: y, seen: true });
},
};
}
}`
const C_VALS = { lx: 360, ly: 300, hx1: 418, hy1: 358, hx2: 510, hy2: 450, found: false, hint: "Move the glass over the ledger." }
function ledgerSketch({ w = 560 } = {}) {
  const h = Math.round((w * 640) / 600)
  return `<svg viewBox="0 0 600 640" width="${w}" height="${h}" role="img" aria-labelledby="c1t" onPointerMove="{{look}}" style="display: block; touch-action: none; cursor: none; flex-shrink: 0">
<title id="c1t">A sketch of an open ledger with every line empty, and a magnifying glass you can move over it.</title>
${roughDefs}
<clipPath id="lens"><circle cx="{{lx}}" cy="{{ly}}" r="74"></circle></clipPath>
${plates(ledgerColour, ledgerInk)}
<g clip-path="url(#lens)">
<rect x="0" y="0" width="600" height="640" fill="#EDEDE8"></rect>
<rect x="0" y="0" width="600" height="640" fill="url(#hatch)" opacity="0.18"></rect>
<text x="{{lx}}" y="{{ly}}" text-anchor="middle" font-family="${HAND}" font-size="34" font-weight="700" fill="#000000"><tspan x="{{lx}}" dy="-6">nothing</tspan><tspan x="{{lx}}" dy="32">filed here</tspan></text>
</g>
<g fill="none" stroke="#000000" stroke-linecap="round" filter="url(#r1)">
<circle cx="{{lx}}" cy="{{ly}}" r="78" stroke-width="5"></circle>
<line x1="{{hx1}}" y1="{{hy1}}" x2="{{hx2}}" y2="{{hy2}}" stroke-width="16"></line>
</g>
<line x1="{{hx1}}" y1="{{hy1}}" x2="{{hx2}}" y2="{{hy2}}" stroke="${ILLUS.red}" stroke-width="9" stroke-linecap="round" transform="translate(3 2)"></line>
</svg>`
}
function C1() {
  return pubPage({ w: 1440, h: 900, sections: [
    el("section", { display: "flex", flexDirection: "row", padding: "48px 48px 0", gap: 48, flex: 1, minHeight: 0 }, [
      col({ width: 224 - 48 + 0, flexShrink: 0, gap: 4 }, [div({ fontSize: 16, fontWeight: 700 }, "Not found"), div({ fontSize: 14, color: T.inkMuted, ...NUM }, "Error 404")]),
      col({ width: 520, flexShrink: 0, gap: 24 }, [
        displayH1(NF.h1, 88),
        body(NF.body),
        row({ gap: 24 }, [linkBtn("Go to the index page"), aLink("Enter the terminal")]),
        el("p", { margin: 0, fontSize: 17, fontWeight: 700 }, "{{hint}}", { "aria-live": "polite" }),
      ]),
      el("figure", { margin: 0, flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "flex-end", minWidth: 0 }, ledgerSketch({ w: 560 })),
    ]),
  ] })
}
// C2: a small spot drawing in the shell, still.
const pcInk = `<path d="M30 20 L 170 16 L 172 112 L 28 116 Z"></path><path d="M46 34 L 154 32 L 155 98 L 45 100 Z"></path><path d="M84 116 L 80 136 L 124 136 L 118 114"></path><path d="M40 146 L 162 142"></path><path d="M78 52 Q 100 40 116 56 Q 124 70 100 76 L 100 84"></path><circle cx="100" cy="92" r="1.5"></circle>`
const pcColour = `<path d="M46 34 L 154 32 L 155 98 L 45 100 Z" fill="${ILLUS.blue}"></path><path d="M30 20 L 170 16 L 172 112 L 28 116 Z" fill="${ILLUS.yellow}" opacity="0.0"></path>`
function C2() {
  return appPage({ content: [
    row({ gap: 40, alignItems: "flex-end", maxWidth: 1100 }, [
      `<svg viewBox="0 0 200 160" width="200" height="160" aria-hidden="true" style="flex-shrink: 0">${roughDefs}${plates(pcColour, pcInk)}</svg>`,
      col({ gap: 12, paddingBottom: 8 }, [appH1(BROKE.h1), body(BROKE.body)]),
    ]),
    div({ maxWidth: 880 }, brokeSpec()),
    row({ gap: 24 }, [button("Try again"), aLink("Go to the index page")]),
    note("Inside the terminal the drawing is small and still. It never moves next to your figures."),
  ] })
}
// C3: offline on a phone. Drag the plug into the socket: it runs the same check as the button.
const C3_LOGIC = `
class Component extends DCLogic {
renderVals() {
const s = this.state || {};
const px = s.px == null ? 90 : s.px;
const plugged = px >= 214;
const at = (e) => { const r = e.currentTarget.getBoundingClientRect(); return Math.max(40, Math.min(224, Math.round(((e.clientX - r.left) / r.width) * 342) - 25)); };
return {
pxt: 'translate(' + (plugged ? 224 : px) + ' 0)',
cable: 'M-10 150 C 40 150, ' + ((plugged ? 224 : px) - 40) + ' 112, ' + (plugged ? 224 : px) + ' 112',
status: s.checks ? 'Checked just now. This device is still offline. Check your Wi-Fi or mobile data.' : (plugged ? 'Plugged in. Checking the connection…' : 'Drag the plug into the socket to check again.'),
down: (e) => { this.setState({ drag: true }); try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {} },
move: (e) => { if (this.state && this.state.drag) this.setState({ px: at(e) }); },
up: () => { const p = (this.state && this.state.px) || 90; this.setState({ drag: false, px: p >= 214 ? 224 : 90, checks: p >= 214 ? ((this.state.checks || 0) + 1) : (this.state && this.state.checks) }); },
check: () => this.setState({ checks: (s.checks || 0) + 1 }),
};
}
}`
const C3_VALS = { pxt: "translate(90 0)", cable: "M-10 150 C 40 150, 50 112, 90 112", status: "Drag the plug into the socket to check again." }
function plugSketch() {
  const socketInk = `<path d="M276 64 L 330 62 L 332 164 L 278 166 Z"></path><path d="M292 98 L 292 112"></path><path d="M312 98 L 312 112"></path><path d="M270 196 L 340 194"></path>`
  const socketColour = `<path d="M276 64 L 330 62 L 332 164 L 278 166 Z" fill="${ILLUS.yellow}"></path>`
  const plugInk = `<path d="M0 92 L 44 90 L 46 134 L 2 136 Z"></path><path d="M46 104 L 60 104"></path><path d="M46 120 L 60 120"></path>`
  const plugColour = `<path d="M0 92 L 44 90 L 46 134 L 2 136 Z" fill="${ILLUS.red}"></path>`
  return `<svg viewBox="0 0 342 220" width="342" height="220" role="img" aria-labelledby="c3t" onPointerDown="{{down}}" onPointerMove="{{move}}" onPointerUp="{{up}}" style="display: block; touch-action: none; cursor: grab">
<title id="c3t">A sketch of an unplugged cable and a wall socket. Dragging the plug into the socket checks the connection again.</title>
${roughDefs}
${plates(socketColour, socketInk)}
<path d="{{cable}}" fill="none" stroke="#000000" stroke-width="4" stroke-linecap="round" filter="url(#r1)"></path>
<g transform="{{pxt}}">${plates(plugColour, plugInk)}</g>
</svg>`
}
function C3() {
  return appPhone({ h: 844, content: [
    col({ gap: 12 }, [tag("Offline"), appH1("You’re offline.", 32), body("Maester can’t reach the internet from this device. What was on screen is still here; nothing new can load or save.")]),
    el("figure", { margin: 0 }, plugSketch()),
    el("p", { margin: 0, fontSize: 16, fontWeight: 700 }, "{{status}}", { role: "status", "aria-live": "polite" }),
    el("button", { minHeight: 44, padding: "0 24px", border: `2px solid ${T.ink}`, background: T.ink, color: T.paper, fontFamily: "inherit", fontSize: 17, fontWeight: 700, borderRadius: 0, cursor: "pointer", width: "100%" }, "Check again", { type: "button", onClick: "{{check}}" }),
    note("Last loaded 14:02. Figures are as of 30 Sep 2026."),
  ] })
}

// ---------- D · Reconcile while you wait ----------
const ROWS = [
  ["Meridian Bank", 400, 1612.4],
  ["Harbour Cements", 120, 4280.0],
  ["Quill Software", 300, 1455.25],
  ["Saffron Foods", 900, 268.35],
  ["Kestrel Power", 1500, 142.1],
]
function inr(n) {
  const s = Math.round(n).toString()
  const last3 = s.slice(-3)
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")
  return "₹" + (rest ? rest + "," : "") + last3
}
const price = (p) => "₹" + p.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const TRUE_VALUES = ROWS.map(([, q, p]) => q * p)
const TOTAL = TRUE_VALUES.reduce((a, b) => a + b, 0)
// Each round one value has two digits swapped. The total is right; one row is not.
const ROUNDS = [
  { i: 2, shown: 435675 }, // 4,36,575 → 4,35,675
  { i: 3, shown: 214515 }, // 2,41,515 → 2,14,515
  { i: 1, shown: 531600 }, // 5,13,600 → 5,31,600
]
const D_LOGIC = `
class Component extends DCLogic {
renderVals() {
const s = this.state || {};
const round = s.round || 0, picked = s.picked == null ? null : s.picked;
const rows = ${JSON.stringify(ROWS.map(([n, q, p], i) => ({ n, q: q.toLocaleString("en-IN"), p: price(p), v: inr(TRUE_VALUES[i]) })))};
const rounds = ${JSON.stringify(ROUNDS.map((r) => ({ i: r.i, shown: inr(r.shown) })))};
const R = rounds[round % rounds.length];
const found = picked === R.i;
const out = {};
rows.forEach((r, i) => {
const wrong = i === R.i;
out['v' + i] = wrong && !found ? R.shown : r.v;
out['bg' + i] = found && wrong ? '#000000' : 'transparent';
out['fg' + i] = found && wrong ? '#EDEDE8' : '#000000';
out['pick' + i] = () => this.setState({ picked: i });
});
const P = picked == null ? null : rows[picked];
out.found = found;
out.message = picked == null ? 'One value in the last column doesn\\u2019t match its shares times price. Pick it.'
: found ? 'Found it. ' + P.q + ' \\u00d7 ' + P.p + ' is ' + P.v + ', not ' + R.shown + '. Checking that figures add up is part of what Maester does with your filings.'
: 'That one adds up: ' + P.q + ' \\u00d7 ' + P.p + ' = ' + P.v + '. Try another.';
out.again = () => this.setState({ round: round + 1, picked: null });
return out;
}
}`
const D_VALS = Object.fromEntries([
  ...ROWS.flatMap((_, i) => [["v" + i, i === ROUNDS[0].i ? inr(ROUNDS[0].shown) : inr(TRUE_VALUES[i])], ["bg" + i, "transparent"], ["fg" + i, "#000000"]]),
  ["found", false],
  ["message", "One value in the last column doesn’t match its shares times price. Pick it."],
])
function puzzle({ phone = false } = {}) {
  const tracks = phone ? "minmax(0, 1fr) 132px" : "minmax(0, 1fr) 90px 120px 150px"
  const head = div({ display: "grid", gridTemplateColumns: tracks, gap: "0 16px", padding: "10px 16px", borderBottom: `2px solid ${T.ink}`, fontSize: 14, color: T.inkMuted }, phone
    ? [div({}, "Company"), div({ textAlign: "right" }, "Value")]
    : [div({}, "Company"), div({ textAlign: "right" }, "Shares"), div({ textAlign: "right" }, "Price"), div({ textAlign: "right" }, "Value")])
  const rws = ROWS.map(([n, q, p], i) =>
    div({ display: "grid", gridTemplateColumns: tracks, gap: "0 16px", padding: "4px 16px", alignItems: "center", borderTop: i ? `1px solid ${T.inkMuted}` : "0", minHeight: 52 }, [
      phone ? col({ gap: 0 }, [div({ fontSize: 16, fontWeight: 700 }, esc(n)), div({ fontSize: 14, color: T.inkMuted, ...NUM }, esc(`${q.toLocaleString("en-IN")} × ${price(p)}`))]) : div({ fontSize: 16 }, esc(n)),
      phone ? "" : div({ textAlign: "right", fontSize: 16, ...NUM }, esc(q.toLocaleString("en-IN"))),
      phone ? "" : div({ textAlign: "right", fontSize: 16, ...NUM }, esc(price(p))),
      el("button", { justifySelf: "end", minHeight: 44, minWidth: 120, padding: "0 10px", border: `1.5px solid ${T.ink}`, background: `{{bg${i}}}`, color: `{{fg${i}}}`, fontFamily: "inherit", fontSize: 16, ...NUM, textAlign: "right", borderRadius: 0, cursor: "pointer" }, `{{v${i}}}`, { type: "button", onClick: `{{pick${i}}}`, "aria-label": `${n}: value {{v${i}}}` }),
    ]))
  const total = div({ display: "grid", gridTemplateColumns: tracks, gap: "0 16px", padding: "12px 16px", borderTop: `2px solid ${T.ink}`, fontWeight: 700, fontSize: 16 }, phone
    ? [div({}, "Total"), div({ textAlign: "right", paddingRight: 12, ...NUM }, inr(TOTAL))]
    : [div({}, "Total"), div({}), div({}), div({ textAlign: "right", paddingRight: 12, ...NUM }, inr(TOTAL))])
  return col({ gap: 16, minWidth: 0 }, [
    row({ gap: 12, flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline" }, [h3("While you’re here: one figure doesn’t add up."), tag("Synthetic example. Not your portfolio.")]),
    div({ border: `2px solid ${T.ink}` }, [head, ...rws, total]),
    el("p", { margin: 0, fontSize: 16, fontWeight: 700, minHeight: 46 }, "{{message}}", { "aria-live": "polite" }),
    el("sc-if", {}, el("button", { alignSelf: "flex-start", minHeight: 44, padding: "0 24px", border: `2px solid ${T.ink}`, background: T.paper, color: T.ink, fontFamily: "inherit", fontSize: 17, fontWeight: 700, borderRadius: 0, cursor: "pointer" }, "Another one", { type: "button", onClick: "{{again}}" }), { value: "{{found}}", "hint-placeholder-val": "{{false}}" }),
  ])
}
function D1() {
  return pubPage({ w: 1440, h: 900, sections: [
    el("section", { display: "flex", flexDirection: "row", padding: "48px 48px 0", gap: 0 }, [
      col({ width: 224, flexShrink: 0, gap: 4, paddingRight: 24, boxSizing: "border-box" }, [div({ fontSize: 16, fontWeight: 700 }, "Not found"), div({ fontSize: 14, color: T.inkMuted, ...NUM }, "Error 404")]),
      row({ flex: 1, minWidth: 0, gap: 56, alignItems: "flex-start" }, [
        col({ width: 470, flexShrink: 0, gap: 24 }, [displayH1(NF.h1, 80), body(NF.body), row({ gap: 24 }, [linkBtn("Go to the index page"), aLink("Enter the terminal")])]),
        div({ flex: 1, minWidth: 0, paddingTop: 8 }, puzzle()),
      ]),
    ]),
  ] })
}
function D2() {
  return pubPage({ w: 390, h: 1240, phone: true, footer: false, sections: [
    register("Not found", [
      displayH1(NF.h1, 44),
      body(NF.body),
      col({ gap: 16, alignItems: "flex-start" }, [linkBtn("Go to the index page", { style: { width: "100%" } }), aLink("Enter the terminal")]),
    ], { phone: true, sub: "Error 404" }),
    div({ padding: "24px", borderTop: `2px solid ${T.ink}` }, puzzle({ phone: true })),
  ] })
}

// ---------- shared states (every direction; no play) ----------
function S1() {
  return appPage({ content: [
    col({ gap: 12, maxWidth: 880 }, [tag("Not found"), appH1("There’s no page here in the terminal."), body("The terminal has one page so far: the overview.")]),
    div({ maxWidth: 880 }, spec([["You asked for", `<span style="font-variant-numeric: tabular-nums slashed-zero">/terminal/holdings</span>`], ["Pages in the terminal", "Overview"]], { termW: 200 })),
    row({ gap: 24 }, [linkBtn("Go to the overview")]),
  ] })
}
function S2() {
  return pubPage({ w: 1440, h: 900, sections: [
    register("Signed out", [
      displayH1("You’ve been signed out.", 104),
      body("Your session ended, so the terminal closed and cleared what was on screen. Everything you saved is kept. Sign in again to go back to the page you were on."),
      row({ gap: 24 }, [linkBtn("Sign in again"), aLink("Go to the index page")]),
      note("After you sign in, you go back to the overview."),
    ]),
  ] })
}
function S3() {
  return appPage({ ctx: { portfolio: "Portfolio: not available" }, content: [
    col({ gap: 12, maxWidth: 880 }, [tag("No access"), appH1("You don’t have access to this portfolio."), body("It belongs to another workspace, or your access was removed. Its details aren’t shown and nothing from it is kept on this device.")]),
    row({ gap: 24 }, [linkBtn("Go to your overview")]),
  ] })
}
function S4() {
  const issue = (title, detail, action) =>
    div({ border: `2px solid ${T.ink}`, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 8, maxWidth: 880 }, [
      div({ fontWeight: 700, fontSize: 17 }, esc(title)), div({ fontSize: 16, lineHeight: 1.45 }, esc(detail)), action ? div({ marginTop: 4 }, action) : "",
    ])
  return appPage({ h: 900, content: [
    div({ background: T.ink, color: T.paper, padding: "12px 20px", fontSize: 16, display: "flex", gap: 16, alignItems: "center", margin: "-32px -24px 0" }, [
      el("span", { fontWeight: 700 }, "You’re offline."), el("span", {}, "Showing what loaded at 14:02. Nothing new can load or save until you’re back."),
    ], { role: "status" }),
    col({ gap: 8 }, [row({ gap: 12 }, [appH1("Long-term"), tag("Holdings snapshot"), tag("Synthetic example")]), note("Holdings as of 30 Sep 2026 · prices you entered on 1 Oct · Indian rupees")]),
    div({ borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}`, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))" },
      [["Known value", "—", "Needs holdings"], ["Unrealized gain", "—", "Needs holdings"], ["Cash", "₹1,12,400", "As you entered it"], ["Largest holding", "—", "Needs holdings"]].map(([l, v, n], i) =>
        col({ padding: "16px 20px", gap: 4, borderLeft: i ? `1px solid ${T.inkMuted}` : "0" }, [muted(l), div({ fontStretch: "110%", fontWeight: 700, fontSize: 32, ...NUM }, esc(v)), muted(n)]))),
    issue("Holdings didn’t load.", "Cash is current to 14:02. The figures that need holdings show “—” until they load; they are unknown, not zero.", button("Try again", { variant: "outline" })),
    col({ gap: 8 }, [h2("Research updates", 22), issue("Research updates can’t load while you’re offline.", "They come back when the connection does. Nothing is lost.", "")]),
  ] })
}
function S5() {
  // The static fallback nginx serves when the site itself fails: no script, no motion, system fonts allowed to fall back.
  return pubPage({ w: 1440, h: 900, sections: [
    register("Unavailable", [
      displayH1("Maester isn’t responding.", 104),
      body("Something on our side is down. We’re on it. Try again in a few minutes; nothing you saved is affected."),
      row({ gap: 24 }, [linkBtn("Try again")]),
      note("This page has no script and no motion. It still has to work when nothing else does."),
    ], { sub: "Error 503" }),
  ] })
}

// ---------- Today: what nginx serves ----------
function today() {
  return div({ width: 1440, height: 900, background: "#FFFFFF", fontFamily: "Times, 'Times New Roman', serif", color: "#000000", boxSizing: "border-box", padding: "8px" }, [
    el("h1", { textAlign: "center", fontSize: 32, fontWeight: 700, margin: "21px 0" }, "404 Not Found"),
    el("hr", { border: 0, borderTop: "1px solid #999999", margin: "8px 0" }, ""),
    div({ textAlign: "center", fontSize: 16 }, "nginx/1.27.5"),
  ])
}

// ---------- writers ----------
const BASE_CSS = `body{margin:0;background:${T.paper};font-family:${FONT}}button{font-family:inherit;margin:0}a{color:inherit}h1,h2,h3,p,dl,dd{margin:0}a:hover{background:#000000;color:#EDEDE8;text-decoration:none}button:focus-visible,a:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:3px solid #000000;outline-offset:2px}`
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
// Twin: resolve sc-if and holes against the default values, drop handlers.
function twinize(html, vals = {}) {
  let out = html
  let prev
  do {
    prev = out
    out = out.replace(/<sc-if[^>]*value="\{\{(\w+)\}\}"[^>]*>((?:(?!<sc-if)[\s\S])*?)<\/sc-if>/, (_, k, inner) => (vals[k] ? inner : ""))
  } while (out !== prev)
  out = out.replace(/\s(on[A-Z]\w*)="\{\{[^}]+\}\}"/g, "")
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => (k in vals ? esc(vals[k]) : ""))
  return out
}
function twinHtml({ title, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="${FONTS}"><style>${BASE_CSS}</style></head><body>${body}</body></html>`
}

// ---------- frames ----------
const D = 1440, P = 390
const FRAMES = [
  { id: "Main.dc.html", title: "Today · any missing address, as the shipped site serves it", w: D, h: 900, render: today, row: 0 },
  { id: "A1.dc.html", title: "A1 · The check that ran — not found, desktop (try the search)", w: D, h: 1140, render: A1, row: 1, logic: A_LOGIC, vals: A_VALS },
  { id: "A2.dc.html", title: "A2 · The check that ran — the overview didn’t load, in the terminal", w: D, h: 900, render: A2, row: 1, logic: A2_LOGIC, vals: { status: "", tried: false } },
  { id: "A3.dc.html", title: "A3 · The check that ran — not found, phone 390", w: P, h: 1180, render: A3, row: 1, logic: A_LOGIC, vals: A_VALS },
  { id: "B1.dc.html", title: "B1 · Squash and stretch — not found, desktop (drag the 404)", w: D, h: 900, render: B1, row: 2, logic: B_LOGIC, vals: B_VALS },
  { id: "B2.dc.html", title: "B2 · Squash and stretch — the overview didn’t load, in the terminal", w: D, h: 900, render: B2, row: 2 },
  { id: "B3.dc.html", title: "B3 · Squash and stretch — not found, phone 390 (drag the 404)", w: P, h: 844, render: B3, row: 2, logic: B_LOGIC, vals: B_VALS },
  { id: "C1.dc.html", title: "C1 · The sketchbook — not found, desktop (move the glass)", w: D, h: 900, render: C1, row: 3, logic: C_LOGIC, vals: C_VALS },
  { id: "C2.dc.html", title: "C2 · The sketchbook — the overview didn’t load, in the terminal", w: D, h: 900, render: C2, row: 3 },
  { id: "C3.dc.html", title: "C3 · The sketchbook — offline, phone 390 (drag the plug)", w: P, h: 844, render: C3, row: 3, logic: C3_LOGIC, vals: C3_VALS },
  { id: "D1.dc.html", title: "D1 · Reconcile while you wait — not found, desktop (find the figure)", w: D, h: 900, render: D1, row: 4, logic: D_LOGIC, vals: D_VALS },
  { id: "D2.dc.html", title: "D2 · Reconcile while you wait — not found, phone 390", w: P, h: 1100, render: D2, row: 4, logic: D_LOGIC, vals: D_VALS },
  { id: "S1.dc.html", title: "Shared · not found inside the terminal", w: D, h: 900, render: S1, row: 5 },
  { id: "S2.dc.html", title: "Shared · signed out (session ended)", w: D, h: 900, render: S2, row: 5 },
  { id: "S3.dc.html", title: "Shared · no access to a portfolio", w: D, h: 900, render: S3, row: 5 },
  { id: "S4.dc.html", title: "Shared · offline, and one section that didn’t load", w: D, h: 900, render: S4, row: 5 },
  { id: "S5.dc.html", title: "Shared · the site itself is down (static page, no script)", w: D, h: 900, render: S5, row: 5 },
]
fs.mkdirSync(path.join(OUT, "project"), { recursive: true })
fs.mkdirSync(path.join(OUT, "twins"), { recursive: true })
for (const f of FRAMES) {
  const b = f.render()
  fs.writeFileSync(path.join(OUT, "project", f.id), dcHtml({ title: f.title, w: f.w, h: f.h, body: b, logic: f.logic }))
  fs.writeFileSync(path.join(OUT, "twins", f.id.replace(".dc.html", ".html")), twinHtml({ title: f.title, body: twinize(b, f.vals) }))
}
fs.writeFileSync(path.join(OUT, "twins", "sheet.html"), `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#c9c9c4;font-family:system-ui}h2{font:600 14px system-ui;margin:24px 24px 8px}iframe{border:0;margin:0 24px;display:block;background:#fff}</style></head><body>${FRAMES.map((f) => `<h2>${esc(f.title)} (${f.w}×${f.h})</h2><iframe src="${f.id.replace(".dc.html", ".html")}" width="${f.w}" height="${f.h}"></iframe>`).join("")}</body></html>`)
fs.writeFileSync(path.join(OUT, "twins", "measure.html"), `<!doctype html><html><body><script>
const F=${JSON.stringify(FRAMES.map((f) => [f.id, f.w]))};
async function measureAll(){const out={};for(const [id,w] of F){const fr=document.createElement('iframe');fr.style.cssText='width:'+w+'px;height:400px;border:0';fr.src=id.replace('.dc.html','.html');document.body.appendChild(fr);await new Promise(r=>fr.onload=r);await fr.contentDocument.fonts.ready;const root=fr.contentDocument.body.firstElementChild;const kids=[...root.querySelectorAll('*')];const bottom=Math.max(...kids.map(k=>k.getBoundingClientRect().bottom));out[id]={frame:root.offsetHeight,content:Math.ceil(bottom)};fr.remove()}return out}
</script></body></html>`)

// ---------- canvas.json ----------
const NOTES = JSON.parse(fs.readFileSync(path.join(HERE, "errors-notes.json"), "utf8"))
const X0 = 720
const rowsN = 6
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
  notes["note" + i] = { text: n.note, x: 0, y: ROW_Y[i], w: 600, maxH: Math.min(1100, rowH[i]), size: "l", color: i === 0 ? "red" : i === 5 ? "green" : "orange" }
})
notes.shared = { text: NOTES.shared, x: X0 + D + 80, y: 0, w: 700, maxH: 900, size: "m", color: "green" }
notes.questions = { text: NOTES.questions, x: X0 + D + 80 + 780, y: 0, w: 600, maxH: 900, size: "l", color: "blue" }
const canvas = {
  v: 3,
  createdOnFiles: { v: 1, at: "2026-10-03T10:00:00Z" },
  title: "Maester Error Screens",
  launch: { view: "canvas" },
  pages: [],
  boards,
  order: FRAMES.map((f) => f.id),
  notes,
  designSystems: [],
}
fs.writeFileSync(path.join(OUT, "project", "canvas.json"), JSON.stringify(canvas, null, 2))
console.log("built", FRAMES.length, "frames; total", inr(TOTAL), TRUE_VALUES.map(inr).join(" "))
