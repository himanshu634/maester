// node signin.mjs [heights.json] [--measure] → ../canvas/project/signin/*.dc.html, canvas.json, ../canvas/twins/*
// Round 2 of the Maester sign-in canvas (2026-10-02): the sign-in flow. Today + A/B/C + shared pages.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { T, ILLUS, esc, el, div, row, col, txt, muted, spacer, button, link, tag } from "./lib.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, "..", "canvas")
const PREV = path.join(HERE, "..", "prev")
const HFILE = process.argv.slice(2).find((a) => !a.startsWith("--"))
const heights = HFILE ? JSON.parse(fs.readFileSync(HFILE, "utf8")) : {}
const MEASURE = process.argv.includes("--measure")

const FONT = "'Archivo', 'Helvetica Neue', Arial, sans-serif"
const FONTS_LINK = "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&amp;family=Caveat:wght@400..700&amp;display=swap"
// Google's mark keeps its own four colours: the one guarded exception this round asks for.
const GOOGLE = { blue: "#4285F4", red: "#EA4335", yellow: "#FBBC05", green: "#34A853" }
const EMAIL = "meera.iyer@example.com"

// The illustration, verbatim from the approved round-1 board.
const prevMain = fs.readFileSync(path.join(PREV, "Main.dc.html"), "utf8")
const SVG = prevMain.slice(prevMain.indexOf("<svg"), prevMain.indexOf("</svg>") + 6)

// ---------- pieces ----------
const B = (w = 2, c = T.ink) => `${w}px solid ${c}`
function googleMark(size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true" style="display:block;flex-shrink:0"><path fill="${GOOGLE.red}" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="${GOOGLE.blue}" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="${GOOGLE.yellow}" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="${GOOGLE.green}" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`
}
// Ink fill (primary) or outline; on an ink panel `onInk` turns the fill to paper. The mark always sits on a paper chip.
function googleButton({ fill = false, onInk = false, label = "Continue with Google", disabled = false, full = true } = {}) {
  const bg = disabled ? "transparent" : fill ? (onInk ? T.paper : T.ink) : "transparent"
  const fg = disabled ? T.inkMuted : fill ? (onInk ? T.ink : T.paper) : onInk ? T.paper : T.ink
  const bd = disabled ? T.inkMuted : onInk ? T.paper : T.ink
  const chip = div({ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: T.paper, flexShrink: 0, opacity: disabled ? 0.6 : 1 }, googleMark(18))
  return el("button", { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 12, minHeight: 48, width: full ? "100%" : undefined, padding: "0 20px 0 10px", border: B(2, bd), background: bg, color: fg, fontFamily: "inherit", fontSize: 17, fontWeight: 700, borderRadius: 0, cursor: disabled ? "not-allowed" : "pointer" }, [chip, `<span style="flex:1;text-align:left">${esc(label)}</span>`], { type: "button", disabled })
}
function btn(label, { fill = true, full = false, onInk = false, disabled = false } = {}) {
  if (disabled) return el("button", { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 44, padding: "0 24px", border: B(2, T.inkMuted), background: "transparent", color: T.inkMuted, fontFamily: "inherit", fontSize: 17, fontWeight: 700, width: full ? "100%" : undefined, cursor: "not-allowed" }, esc(label), { type: "button", disabled: true })
  return button(label, { variant: fill ? "fill" : "outline", inverted: onInk, style: full ? { width: "100%" } : {} })
}
function field({ label, type = "text", value = "", hint, error, toggle = false, id }) {
  const input = el("input", { flex: 1, minWidth: 0, width: "100%", minHeight: 44, padding: "0 12px", border: B(error ? 3 : 2), background: T.paper, color: T.ink, fontFamily: "inherit", fontSize: 16, borderRadius: 0, boxSizing: "border-box" }, "", { type, value: value || undefined, id, "aria-invalid": error ? "true" : undefined })
  const show = el("button", { minHeight: 44, padding: "0 16px", border: B(2), borderLeft: "0", background: "transparent", fontFamily: "inherit", fontSize: 16, fontWeight: 700, color: T.ink, flexShrink: 0, cursor: "pointer" }, "Show", { type: "button", "aria-label": `Show ${label.toLowerCase()}` })
  return col({ gap: 4, width: "100%" }, [
    el("label", { fontWeight: 700, fontSize: 14 }, esc(label), { for: id }),
    hint ? muted(hint, { marginTop: -2 }) : "",
    toggle ? row({ alignItems: "stretch" }, [input, show]) : input,
    error ? div({ fontSize: 14, lineHeight: 1.45, fontWeight: 700 }, esc(error)) : "",
  ])
}
const orRule = (t, { onInk = false } = {}) =>
  row({ gap: 12, width: "100%" }, [div({ flex: 1, height: 1, background: onInk ? T.paper : T.inkMuted }), div({ fontSize: 14, color: onInk ? T.paperMuted : T.inkMuted, whiteSpace: "nowrap" }, esc(t)), div({ flex: 1, height: 1, background: onInk ? T.paper : T.inkMuted })])
// A form-level message: a 2px box, bold first line. Status words, not colour.
const notice = (title, body, actions = "") =>
  col({ gap: 6, border: B(2), padding: "14px 16px" }, [div({ fontWeight: 700, fontSize: 16, lineHeight: 1.4 }, esc(title)), body ? div({ fontSize: 16, lineHeight: 1.45 }, body) : "", actions ? div({ marginTop: 6 }, actions) : ""])
const h1 = (t, size) => el("h1", { margin: 0, fontStretch: "125%", fontWeight: 800, fontSize: size, lineHeight: 1.1, letterSpacing: "-0.02em" }, esc(t))
const lede = (t) => el("p", { margin: 0, fontSize: 17, lineHeight: 1.5, maxWidth: "68ch" }, t)
const small = (html, style = {}) => div({ fontSize: 14, lineHeight: 1.45, ...style }, html)
const back = () => small(link("Back to the index page"), { color: T.inkMuted })

function panel(children, { phone = false, style = {} } = {}) {
  return col({ border: B(2), padding: phone ? 24 : 32, gap: 20, width: "100%", boxSizing: "border-box", background: T.paper, ...style }, children)
}

// ---------- shells (copied from Masthead.svelte and /login's styles) ----------
function masthead(phone) {
  const nav = ["What it watches", "How it works", "Why trust it", "Where we are"]
  return el("header", { borderBottom: B(2), flexShrink: 0 }, row({ flexWrap: "wrap", gap: "16px 24px", maxWidth: 1440, margin: "0 auto", padding: phone ? "16px 24px" : "16px 48px" }, [
    el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink, marginRight: "auto" }, "Maester", { href: "#" }),
    el("nav", { display: "flex", flexWrap: "wrap", gap: "12px 24px", order: phone ? 3 : 0, width: phone ? "100%" : "auto", marginRight: phone ? 0 : 16, fontSize: 17 }, nav.map((n) => link(n)), { "aria-label": "Primary" }),
    el("a", { display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 24px", border: B(2), background: T.ink, color: T.paper, fontWeight: 700, textDecoration: "none", fontSize: 17 }, "Enter the terminal", { href: "#" }),
  ]))
}
const scene = (phone) =>
  el("figure", { position: "relative", margin: 0, width: "100%", height: phone ? "auto" : "100%", aspectRatio: phone ? "1" : undefined, minHeight: 0, border: B(3), borderRadius: 30, background: T.paper, overflow: "hidden" }, SVG)

// A public auth page. Desktop: 1440×900, panel column (480 by default) + illustration filling to the bottom.
// Phone: panel, then the illustration square (as /login stacks it today).
function authPage({ phone = false, h, panelW = 480, content, illus = true, mainExtra = {} }) {
  const root = { display: "flex", flexDirection: "column", width: phone ? 390 : 1440, height: h === null ? "auto" : h, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper, boxSizing: "border-box" }
  if (phone)
    return div(root, [masthead(true), el("main", { display: "flex", flexDirection: "column", gap: 40, padding: "48px 24px 56px", ...mainExtra }, [content, illus ? scene(true) : ""], { "data-measure": "content" })])
  return div(root, [
    masthead(false),
    el("main", { flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: illus ? `minmax(0, ${panelW}px) minmax(0, 1fr)` : `minmax(0, ${panelW}px)`, gridTemplateRows: "minmax(0, 1fr)", gap: 48, padding: 48, boxSizing: "border-box", ...mainExtra }, [div({ alignSelf: "start", minWidth: 0 }, content), illus ? scene(false) : ""]),
  ])
}

// ---------- Today ----------
function todayPanel(phone) {
  return panel([
    h1("Sign in to the terminal", phone ? 28 : 40),
    lede("The terminal is where your holdings, your thesis and your suggestions live."),
    col({ gap: 16, alignItems: "flex-start" }, [field({ label: "Email", type: "email", id: "t-e" }), field({ label: "Password", type: "password", id: "t-p" }), btn("Sign in")]),
    small("&nbsp;", { minHeight: "1.5em" }),
    small(`Sending you to <strong>/terminal</strong> after sign-in. ${link("Back to the index page")}.`, { color: T.inkMuted }),
  ], { phone })
}
const today = (h) => authPage({ h, content: todayPanel(false) })
const todayPhone = (h) => authPage({ phone: true, h, content: todayPanel(true) })

// ---------- A · Google first, one panel ----------
function A_login(phone) {
  return panel([
    h1("Sign in to the terminal", phone ? 28 : 40),
    lede("The terminal is where your holdings, your thesis and your suggestions live."),
    googleButton({ fill: true }),
    orRule("or use your email"),
    col({ gap: 16, alignItems: "flex-start" }, [
      field({ label: "Email", type: "email", id: "a-e" }),
      field({ label: "Password", type: "password", id: "a-p", toggle: true }),
      row({ gap: 16, flexWrap: "wrap", width: "100%" }, [btn("Sign in", { fill: false }), small(link("Forgot your password?"), { fontSize: 16 })]),
    ]),
    div({ borderTop: B(1, T.inkMuted), paddingTop: 16, fontSize: 16 }, `New to Maester? ${link("Create an account")}`),
    back(),
  ], { phone })
}
const A1 = (h) => authPage({ h, content: A_login(false) })
const A2 = (h) => authPage({ phone: true, h, content: A_login(true) })
function A3(h) {
  return authPage({ h, illus: false, panelW: 560, content: panel([
    h1("Create your account", 40),
    lede("Maester is open to invited investors for now. Use the email your invitation went to."),
    googleButton({ fill: true, label: "Sign up with Google" }),
    orRule("or use your email"),
    col({ gap: 16, alignItems: "flex-start" }, [
      field({ label: "Name", id: "a3-n", value: "Meera Iyer" }),
      field({ label: "Email", type: "email", id: "a3-e", value: "meera.iyer@example", error: "Enter a full email address, like name@example.com." }),
      field({ label: "Password", type: "password", id: "a3-p", toggle: true, value: "••••••", hint: "At least 8 characters.", error: "Use at least 8 characters. This one has 6." }),
      btn("Create account", { fill: false }),
    ]),
    div({ borderTop: B(1, T.inkMuted), paddingTop: 16, fontSize: 16 }, `Already have an account? ${link("Sign in")}`),
  ]) })
}
function A4(h) {
  return authPage({ h, content: panel([
    h1("You’re on the list", 40),
    lede(`Maester is open to invited investors for now. We’ve added <strong>${EMAIL}</strong> to the list.`),
    lede("Nothing else to do. Your Google account was not connected and no workspace was created."),
    div({ borderTop: B(1, T.inkMuted), paddingTop: 16, fontSize: 16 }, `Signed in with the wrong Google account? ${link("Use another account")}`),
    back(),
  ]) })
}

// ---------- B · Two doors ----------
function doors({ phone = false, signup = false } = {}) {
  const google = col({ background: T.ink, color: T.paper, padding: phone ? 24 : 32, gap: 16, minWidth: 0 }, [
    el("h2", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: 22, lineHeight: 1.1, letterSpacing: "-0.02em", color: T.paper }, "With Google"),
    div({ fontSize: 16, lineHeight: 1.45, color: T.paperMuted }, "One step. Maester gets your name and email address from Google, and nothing else."),
    googleButton({ fill: true, onInk: true, label: signup ? "Sign up with Google" : "Continue with Google" }),
  ])
  const email = col({ padding: phone ? 24 : 32, gap: 16, minWidth: 0 }, [
    el("h2", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: 22, lineHeight: 1.1, letterSpacing: "-0.02em" }, "With your email"),
    signup ? field({ label: "Name", id: "b-n" }) : "",
    field({ label: "Email", type: "email", id: "b-e" }),
    field({ label: "Password", type: "password", id: "b-p", toggle: true, hint: signup ? "At least 8 characters." : undefined }),
    row({ gap: 16, flexWrap: "wrap" }, [btn(signup ? "Create account" : "Sign in", { fill: false }), signup ? "" : small(link("Forgot your password?"), { fontSize: 16 })]),
  ])
  return div({ display: "grid", gridTemplateColumns: phone ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)", border: B(2) }, [google, div({ borderLeft: phone ? 0 : B(2), borderTop: phone ? B(2) : 0 }, email)])
}
function B_page(phone, h) {
  const content = col({ gap: 24 }, [
    h1("Sign in to the terminal", phone ? 28 : 40),
    lede("The terminal is where your holdings, your thesis and your suggestions live. Two ways in; pick either."),
    doors({ phone }),
    div({ fontSize: 16 }, `New to Maester? ${link("Create an account")}`),
    back(),
  ])
  return authPage({ phone, h, panelW: 800, content })
}
const B1 = (h) => B_page(false, h)
const B2 = (h) => B_page(true, h)
function B3(h) {
  return authPage({ h, panelW: 800, content: col({ gap: 24 }, [
    h1("Sign in to the terminal", 40),
    col({ background: T.ink, color: T.paper, padding: 32, gap: 16, border: B(2) }, [
      el("h2", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: 28, lineHeight: 1.1, letterSpacing: "-0.02em", color: T.paper }, "You’re on the list"),
      div({ fontSize: 17, lineHeight: 1.5, maxWidth: "60ch" }, `Maester is open to invited investors for now. We’ve added <strong>${EMAIL}</strong> to the list.`),
      div({ fontSize: 16, lineHeight: 1.45, color: T.paperMuted }, "Nothing else to do. Your Google account was not connected and no workspace was created."),
      div({ fontSize: 16 }, el("a", { color: T.paper, textDecoration: "underline", textUnderlineOffset: "3px", textDecorationThickness: "1.5px" }, "Use another Google account", { href: "#" })),
    ]),
    back(),
  ]) })
}

// ---------- C · Email first ----------
function C_step1(phone) {
  return panel([
    h1("Sign in or create an account", phone ? 28 : 40),
    lede("Start with your email. Maester tells you the next step: your password, a new account, or a place on the list."),
    col({ gap: 16, alignItems: "flex-start" }, [field({ label: "Email", type: "email", id: "c-e" }), btn("Continue", { full: phone })]),
    orRule("or"),
    googleButton({ fill: false }),
    back(),
  ], { phone })
}
const emailLine = () => row({ gap: 12, flexWrap: "wrap", border: B(1, T.inkMuted), padding: "10px 12px", fontSize: 16 }, [div({ fontWeight: 700, minWidth: 0, overflowWrap: "anywhere" }, EMAIL), spacer(), link("Change")])
const C1 = (h) => authPage({ h, content: C_step1(false) })
function C2(h) {
  return authPage({ phone: true, h, content: panel([
    h1("Welcome back", 28),
    emailLine(),
    col({ gap: 16, alignItems: "flex-start" }, [field({ label: "Password", type: "password", id: "c2-p", toggle: true }), btn("Sign in", { full: true }), small(link("Forgot your password?"), { fontSize: 16 })]),
    back(),
  ], { phone: true }) })
}
function C3(h) {
  return authPage({ h, content: panel([
    h1("You’re on the list", 40),
    emailLine(),
    lede("Maester is open to invited investors for now. We’ve added this email to the list, so there is no password to make yet."),
    back(),
  ]) })
}
function C4(h) {
  return authPage({ phone: true, h, content: panel([
    h1("Create your account", 28),
    emailLine(),
    lede("This email is on the invitation list. Two more things and you are in."),
    col({ gap: 16, alignItems: "flex-start" }, [field({ label: "Name", id: "c4-n" }), field({ label: "Password", type: "password", id: "c4-p", toggle: true, hint: "At least 8 characters." }), btn("Create account", { full: true })]),
    small(`Rather use Google? ${link("Continue with Google")}`, { fontSize: 16 }),
  ], { phone: true }) })
}

// ---------- Shared pages and states (drawn in A's anatomy) ----------
function stateCard(caption, children) {
  return col({ gap: 8, minWidth: 0 }, [muted(caption), panel(children, { style: { padding: 24, gap: 16 } })])
}
function S1(h) {
  const loginTop = [h1("Sign in to the terminal", 28)]
  const emailForm = (opts = {}) => col({ gap: 16, alignItems: "flex-start" }, [field({ label: "Email", type: "email", id: "s-e" + (opts.k || ""), value: EMAIL }), field({ label: "Password", type: "password", id: "s-p" + (opts.k || ""), toggle: true, value: opts.pw ? "••••••••••" : "" }), btn("Sign in", { fill: false, disabled: opts.disabled })])
  const cards = [
    stateCard("Google opening · the button waits, the status says why", [...loginTop, googleButton({ disabled: true, label: "Opening Google…" }), small("Taking you to Google to sign in.", { fontSize: 16 })]),
    stateCard("Google cancelled · back from Google with ?error=access_denied", [...loginTop, notice("Google sign-in was cancelled", "Nothing was shared. Try again, or use your email."), googleButton({ fill: true })]),
    stateCard("Wrong email or password", [...loginTop, notice("That email and password don’t match", `Try again, or ${link("reset your password")}.`), emailForm({ k: 3, pw: true })]),
    stateCard("Email not confirmed yet · sign-in refused until it is", [...loginTop, notice("Confirm your email first", `We sent a link to <strong>${EMAIL}</strong> when you created your account.`, btn("Send the link again", { fill: false }))]),
    stateCard("Too many attempts · rate limit", [...loginTop, notice("Too many attempts", "Wait a minute, then try again. Your account is not locked."), emailForm({ k: 5, pw: true, disabled: true })]),
    stateCard("Already signed in · /login skips straight to where you were going", [...loginTop, small("You are already signed in. Taking you to the terminal.", { fontSize: 16 }), small(link("Go now"), { fontSize: 16 })]),
  ]
  return div({ width: 1440, height: h === null ? "auto" : h, padding: 48, boxSizing: "border-box", fontFamily: FONT, color: T.ink, background: T.paper, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "40px 40px", alignItems: "start" }, cards, { "data-measure": "content" })
}
const S2 = (h) => authPage({ h, illus: false, panelW: 560, content: panel([
  h1("Check your email", 40),
  lede(`We sent a link to <strong>${EMAIL}</strong>. Open it on this device to finish creating your account. It works for one hour.`),
  notice("Didn’t get it?", "Check spam, or send it again. Links can take a minute to arrive.", btn("Send it again", { fill: false })),
  div({ fontSize: 16 }, `Wrong address? ${link("Use a different email")}`),
  back(),
]) })
const S3 = (h) => authPage({ phone: true, illus: false, h, content: panel([
  h1("That link has expired", 28),
  lede("Confirmation links work once, for one hour. Send a new one to your email."),
  col({ gap: 16, alignItems: "flex-start" }, [field({ label: "Email", type: "email", id: "s3-e" }), btn("Send a new link", { full: true })]),
  back(),
], { phone: true }) })
const S4 = (h) => authPage({ phone: true, illus: false, h, content: panel([
  h1("Reset your password", 28),
  lede("Enter the email you sign in with. We’ll send a link to set a new password."),
  col({ gap: 16, alignItems: "flex-start" }, [field({ label: "Email", type: "email", id: "s4-e", value: EMAIL }), btn("Send reset link", { full: true, disabled: true })]),
  notice("Check your email", `If <strong>${EMAIL}</strong> has a Maester account, a reset link is on its way. It works for one hour.`),
  small(link("Back to sign in"), { fontSize: 16 }),
], { phone: true }) })
const S5 = (h) => authPage({ phone: true, illus: false, h, content: panel([
  h1("Set a new password", 28),
  lede(`For <strong>${EMAIL}</strong>.`),
  col({ gap: 16, alignItems: "flex-start" }, [field({ label: "New password", type: "password", id: "s5-p", toggle: true, value: "••••••", hint: "At least 8 characters.", error: "Use at least 8 characters. This one has 6." }), btn("Set new password", { full: true })]),
  small(`Link expired? ${link("Request a new one")}`, { fontSize: 16 }),
], { phone: true }) })

// Terminal shell with the account block and Sign out (DESIGN §10: the rail lists only what exists).
function account({ phone = false } = {}) {
  return col({ gap: 8, padding: phone ? "20px 24px 24px" : "16px 24px 24px", borderTop: B(2) }, [
    muted("Signed in as"),
    div({ fontSize: 16, fontWeight: 700, overflowWrap: "anywhere", lineHeight: 1.35 }, EMAIL),
    btn("Sign out", { fill: false, full: true }),
  ])
}
function railTop() {
  return [
    row({ height: 56, padding: "0 24px", borderBottom: B(2), flexShrink: 0 }, el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink }, "Maester", { href: "#" })),
    col({ padding: "16px 24px", gap: 2, borderBottom: B(1, T.inkMuted) }, [muted("Workspace"), div({ fontWeight: 700, fontSize: 16 }, "Personal")]),
    el("nav", { display: "flex", flexDirection: "column", padding: "16px 24px" }, el("a", { display: "flex", alignItems: "center", minHeight: 44, padding: "0 12px", margin: "0 -12px", background: T.ink, color: T.paper, fontWeight: 700, textDecoration: "none", fontSize: 17 }, "Overview", { href: "#", "aria-current": "page" }), { "aria-label": "Terminal" }),
  ]
}
function S6(h) {
  return div({ display: "flex", width: 1440, height: h, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper }, [
    col({ width: 224, flexShrink: 0, borderRight: B(2) }, [...railTop(), spacer(), account()]),
    col({ flex: 1, minWidth: 0 }, [
      row({ height: 56, padding: "0 24px", borderBottom: B(2), flexShrink: 0, fontSize: 16, color: T.inkMuted }, "Personal workspace"),
      el("main", { display: "flex", flexDirection: "column", gap: 20, padding: "32px 24px" }, [h1("The terminal", 40), lede("You are in. Your holdings and the filings behind them arrive with the first release."), div({ fontSize: 17 }, link("Explore the synthetic demo"))]),
    ]),
  ])
}
function S7(h) {
  return div({ display: "flex", flexDirection: "column", width: 390, height: h, overflow: "hidden", fontFamily: FONT, color: T.ink, background: T.paper }, [
    row({ height: 56, padding: "0 16px 0 24px", borderBottom: B(2), justifyContent: "space-between", flexShrink: 0 }, [
      el("a", { fontStretch: "125%", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1, textDecoration: "none", color: T.ink }, "Maester", { href: "#" }),
      btn("Close", { fill: false }),
    ]),
    col({ flex: 1, borderBottom: B(2) }, [
      col({ padding: "16px 24px", gap: 2, borderBottom: B(1, T.inkMuted) }, [muted("Workspace"), div({ fontWeight: 700, fontSize: 16 }, "Personal")]),
      el("nav", { display: "flex", flexDirection: "column", padding: "16px 24px" }, el("a", { display: "flex", alignItems: "center", minHeight: 44, padding: "0 12px", margin: "0 -12px", background: T.ink, color: T.paper, fontWeight: 700, textDecoration: "none", fontSize: 17 }, "Overview", { href: "#", "aria-current": "page" })),
      spacer(),
      account({ phone: true }),
    ]),
  ])
}

// ---------- frames ----------
const D = 1440, P = 390
const FRAMES = [
  { id: "signin/Today.dc.html", title: "Today · /login, desktop: one form that sends nothing", w: D, h: 900, render: today, row: 0, col: 0, fixed: true },
  { id: "signin/TodayPhone.dc.html", title: "Today · /login, phone 390", w: P, render: todayPhone, row: 0, col: 1 },
  { id: "signin/A1.dc.html", title: "A1 · Google first — sign in, desktop", w: D, h: 900, render: A1, row: 1, col: 0, fixed: true },
  { id: "signin/A2.dc.html", title: "A2 · Google first — sign in, phone 390", w: P, render: A2, row: 1, col: 1 },
  { id: "signin/A3.dc.html", title: "A3 · Google first — create account, field errors (/signup)", w: D, h: 900, render: A3, row: 1, col: 2, fixed: true },
  { id: "signin/A4.dc.html", title: "A4 · Google first — waitlisted, back from Google", w: D, h: 900, render: A4, row: 1, col: 3, fixed: true },
  { id: "signin/B1.dc.html", title: "B1 · Two doors — sign in, desktop", w: D, h: 900, render: B1, row: 2, col: 0, fixed: true },
  { id: "signin/B2.dc.html", title: "B2 · Two doors — sign in, phone 390", w: P, render: B2, row: 2, col: 1 },
  { id: "signin/B3.dc.html", title: "B3 · Two doors — waitlisted, the doors become one ink panel", w: D, h: 900, render: B3, row: 2, col: 2, fixed: true },
  { id: "signin/C1.dc.html", title: "C1 · Email first — step 1, desktop", w: D, h: 900, render: C1, row: 3, col: 0, fixed: true },
  { id: "signin/C2.dc.html", title: "C2 · Email first — known email: password, phone 390", w: P, render: C2, row: 3, col: 1 },
  { id: "signin/C3.dc.html", title: "C3 · Email first — not invited: on the list before any password", w: D, h: 900, render: C3, row: 3, col: 2, fixed: true },
  { id: "signin/C4.dc.html", title: "C4 · Email first — invited, new: create the account, phone 390", w: P, render: C4, row: 3, col: 3 },
  { id: "signin/S1.dc.html", title: "Every direction · sign-in states", w: D, render: S1, row: 4, col: 0 },
  { id: "signin/S2.dc.html", title: "Every direction · /verify-email, link sent", w: D, h: 900, render: S2, row: 4, col: 1, fixed: true },
  { id: "signin/S3.dc.html", title: "Every direction · /verify-email, link expired, phone", w: P, render: S3, row: 4, col: 2 },
  { id: "signin/S4.dc.html", title: "Every direction · /forgot-password, sent, phone", w: P, render: S4, row: 4, col: 3 },
  { id: "signin/S5.dc.html", title: "Every direction · /reset-password, field error, phone", w: P, render: S5, row: 4, col: 4 },
  { id: "signin/S6.dc.html", title: "Every direction · terminal rail: who is signed in, Sign out", w: D, h: 900, render: S6, row: 5, col: 0, fixed: true },
  { id: "signin/S7.dc.html", title: "Every direction · terminal menu drawer, phone", w: P, h: 844, render: S7, row: 5, col: 1, fixed: true },
]
for (const f of FRAMES) if (!f.fixed) f.h = heights[f.id] ? Math.ceil(heights[f.id].root) : f.w === P ? 844 : 900

const ROOT_VARS = `:root{--paper:${T.paper};--ink:${T.ink};--ink-muted:${T.inkMuted};--illus-yellow:${ILLUS.yellow};--illus-red:${ILLUS.red};--illus-blue:${ILLUS.blue}}`
const BASE_CSS = `${ROOT_VARS}*{box-sizing:border-box}body{margin:0;background:${T.paper};font-family:${FONT};-webkit-font-smoothing:antialiased}button,input{font-family:inherit;margin:0}a{color:inherit;text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1.5px}a:hover{background:${T.ink};color:${T.paper};text-decoration:none}h1,h2,h3,p,dl,dd{margin:0}`
const dc = ({ title, w, h, body }) => `<!doctype html>
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
const twin = ({ title, body }) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="${FONTS_LINK}"><style>${BASE_CSS}</style></head><body>${body}</body></html>`

fs.mkdirSync(path.join(OUT, "project", "signin"), { recursive: true })
fs.mkdirSync(path.join(OUT, "twins"), { recursive: true })
const tw = (id) => id.replace("signin/", "").replace(".dc.html", ".html")
for (const f of FRAMES) {
  const body = f.render(MEASURE && !f.fixed ? null : f.h)
  fs.writeFileSync(path.join(OUT, "project", f.id), dc({ title: f.title, w: f.w, h: f.h, body }))
  fs.writeFileSync(path.join(OUT, "twins", tw(f.id)), twin({ title: f.title, body }))
}
// Round 1 boards, kept as they were on their own page (gain the script block the type requires).
const R1 = [
  { id: "Main.dc.html", w: 1440, h: 900, title: "Round 1 · sign-in, desktop 1440 (10 Sep, built)" },
  { id: "Mobile.dc.html", w: 390, h: 1300, title: "Round 1 · sign-in, phone 390 (10 Sep, built)" },
]
for (const r of R1) {
  let s = fs.readFileSync(path.join(PREV, r.id), "utf8")
  if (!s.includes("data-dc-script"))
    s = s.replace("</body>", `<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${r.w},"height":${r.h}}}'>\nclass Component extends DCLogic {\nrenderVals() {\nreturn {};\n}\n}\n</script>\n</body>`)
  fs.writeFileSync(path.join(OUT, "project", r.id), s)
}

const sheet = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#c9c9c4;font-family:system-ui}h2{font:600 14px system-ui;margin:24px 24px 8px}iframe{border:0;margin:0 24px;display:block;background:#fff}</style></head><body>${FRAMES.map((f) => `<h2>${esc(f.title)} (${f.w}×${f.h})</h2><iframe src="${tw(f.id)}" width="${f.w}" height="${f.h}"></iframe>`).join("")}</body></html>`
fs.writeFileSync(path.join(OUT, "twins", "sheet.html"), sheet)
fs.writeFileSync(path.join(OUT, "twins", "measure.html"), `<!doctype html><html><body><script>
const F=${JSON.stringify(FRAMES.filter((f) => !f.fixed).map((f) => [f.id, tw(f.id), f.w]))};
async function measureAll(){const out={};for(const [id,file,w] of F){const fr=document.createElement('iframe');fr.style.cssText='width:'+w+'px;height:400px;border:0';fr.src=file;document.body.appendChild(fr);await new Promise(r=>fr.onload=r);await fr.contentDocument.fonts.ready;const root=fr.contentDocument.body.firstElementChild;root.style.height='auto';root.style.minHeight='0';out[id]={root:root.scrollHeight};fr.remove()}return out}
</script></body></html>`)

// ---------- canvas.json ----------
const NOTES = JSON.parse(fs.readFileSync(path.join(HERE, "signin-notes.json"), "utf8"))
const X0 = 720
const rowsN = Math.max(...FRAMES.map((f) => f.row)) + 1
const rowH = Array.from({ length: rowsN }, (_, r) => Math.max(...FRAMES.filter((f) => f.row === r).map((f) => f.h)))
const ROW_Y = []
let y = 0
for (let r = 0; r < rowsN; r++) { ROW_Y.push(y); y += rowH[r] + 120 + 300 }
const boards = {}
for (const f of FRAMES) {
  const prevW = FRAMES.filter((g) => g.row === f.row && g.col < f.col).reduce((a, g) => a + g.w + 80, 0)
  boards[f.id] = { x: X0 + prevW, y: ROW_Y[f.row], w: f.w, h: f.h, title: f.title, page: "round2" }
}
boards["Main.dc.html"] = { x: 0, y: 0, w: 1440, h: 900, title: R1[0].title, page: "round1" }
boards["Mobile.dc.html"] = { x: 1540, y: 0, w: 390, h: 1300, title: R1[1].title, page: "round1" }
const notes = {}
NOTES.rows.forEach((n, i) => {
  const rowW = FRAMES.filter((f) => f.row === i).reduce((a, f) => a + f.w + 80, 0) + X0
  notes["r2title" + i] = { kind: "title1", text: n.title, x: 0, y: ROW_Y[i] - 260, maxW: rowW, page: "round2" }
  notes["r2note" + i] = { text: n.note, x: 0, y: ROW_Y[i], w: 600, maxH: Math.min(1100, Math.max(700, rowH[i])), size: "l", color: i === 0 ? "red" : i >= 4 ? "green" : "orange", page: "round2" }
})
const rightOfToday = X0 + D + 80 + P + 80
notes.r2shared = { text: NOTES.shared, x: rightOfToday, y: 0, w: 640, maxH: 900, size: "l", color: "green", page: "round2" }
notes.r2questions = { text: NOTES.questions, x: rightOfToday + 720, y: 0, w: 600, maxH: 900, size: "l", color: "blue", page: "round2" }
notes.r1note = { text: "Round 1, 10 Sep 2026: the sign-in page with its sketched two-plate illustration, as built. The drawing fills the screen from the masthead to the bottom edge on desktop and stacks under the form on a phone. Three illustration inks plus paper and ink; the thought cloud is lettered in Caveat, the one face besides Archivo, used only inside drawings.", x: 0, y: -330, w: 900, maxH: 260, size: "l", color: "gray", page: "round1" }
const order = ["Main.dc.html", "Mobile.dc.html", ...FRAMES.map((f) => f.id)]
const canvas = {
  v: 3,
  createdOnFiles: { v: 1, at: new Date().toISOString().replace(/\.\d+Z$/, "Z") },
  title: "Maester Sign-in",
  launch: { view: "canvas", page: "round2" },
  pages: [{ id: "round2", name: "Round 2 · Sign-in flow" }, { id: "round1", name: "Round 1 · Illustration (built)" }],
  boards,
  order,
  notes,
  designSystems: [],
}
fs.writeFileSync(path.join(OUT, "project", "canvas.json"), JSON.stringify(canvas, null, 2))
console.log("built", FRAMES.length, "frames", MEASURE ? "(measure pass)" : "")
