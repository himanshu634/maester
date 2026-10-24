// node accounts.mjs [accounts-heights.json] [--measure] → ../canvas/project/*.dc.html, canvas.json, ../canvas/twins/*
// Round 2 of the broker canvas (2026-10-24): several accounts across the top five brokers, two
// people in one household, shown on Holdings. Today is A as built on feat/holdings-dhan (9d1994e).
// Directions continue round 1's letters: D · Household, by person; E · The morning round;
// F · Accounts as columns; plus the shared "what each broker needs" flow.
// Broker facts live only in accounts-brokers.mjs; the household only in accounts-base.mjs.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { T, NUM, esc, el, div, row, col, muted, spacer, button, link, tag, spec, ledger } from "./lib.mjs"
import {
  FONTS, appH1, h2, h3, body, note, strong, synth, appPage, appPhone, notice, field, steps,
  ACCOUNTS, CLOSES, combine, total, inr, inr0, qty, pct1,
} from "./holdings-base.mjs"
import { PEOPLE, ACCTS, byKey, accName, needsYou, combineAccts, keysOf, sum, acctValue } from "./accounts-base.mjs"
import { NEED, TOP5 } from "./accounts-brokers.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, "..", "canvas")
const HEIGHTS = process.argv[2] && fs.existsSync(process.argv[2]) ? JSON.parse(fs.readFileSync(process.argv[2], "utf8")) : {}

// ---------- small pieces ----------
const R = { align: "right" }
const num = (t, s = {}) => div({ ...NUM, ...s }, esc(t))
const bold = (t, s = {}) => div({ fontWeight: 700, ...s }, esc(t))
const mutedCell = (t, s = {}) => div({ color: T.inkMuted, fontSize: 14, lineHeight: 1.45, ...s }, esc(t))
const sm = { fontSize: 16 }
const out = (s) => button(s, { variant: "outline", style: sm })
const fill = (s) => button(s, { style: sm })
const STATE = {
  in: (a) => ["Signed in", NEED[a.bk].until],
  out: (a) => [a.bk === "angel" ? "Signed out at midnight" : "Signed out at 06:00", a.bk === "angel" ? "Needs the MPIN and a code" : "Sign in on Zerodha’s page"],
  approve: () => ["Not approved today", "Approve the key on Groww Cloud"],
}
const actionFor = (a) => (a.state === "out" ? `Sign in to ${NEED[a.bk].short}` : a.state === "approve" ? "Open Groww to approve" : "Read again")
const ALL = ACCTS.map((a) => a.key)
const ROWS = combineAccts(ALL)
const VALUE = sum(ROWS)
const COST = sum(ROWS, "cost")
const signed = (p) => (p >= 0 ? "+" : "−") + inr0(Math.abs(p))
const STALE_KEYS = ACCTS.filter(needsYou).map((a) => a.key)
const staleNote = "* Read on Friday, before that account signed Maester out. Quantities change only when you trade; sign in to check."

function toggles(labels, pressed) {
  return row({ gap: 0, flexWrap: "wrap" }, labels.map((l, i) =>
    el("button", { minHeight: 44, padding: "0 20px", fontFamily: "inherit", fontSize: 16, fontWeight: 700, border: `2px solid ${T.ink}`, marginLeft: i ? -2 : 0, background: l === pressed ? T.ink : "transparent", color: l === pressed ? T.paper : T.ink, borderRadius: 0 }, esc(l), { type: "button", "aria-pressed": l === pressed ? "true" : "false" })))
}
function pageHead({ phone = false, asOf, action, extra }) {
  return col({ gap: 12 }, [
    row({ gap: 16, alignItems: phone ? "flex-start" : "center", justifyContent: "space-between", flexWrap: "wrap" }, [
      col({ gap: 10 }, [appH1("Holdings", phone ? 32 : 40), row({ gap: 8, flexWrap: "wrap" }, [tag("Holdings snapshot"), synth()])]),
      action && !phone ? action : "",
    ]),
    asOf ? body(asOf, { maxWidth: 760 }) : "",
    extra || "",
  ])
}
function strip(cells, { phone = false } = {}) {
  const cell = ([label, value, n], i) =>
    col({ gap: 6, padding: phone ? "14px 0" : "16px 20px", borderLeft: !phone && i ? `1px solid ${T.inkMuted}` : "0", borderTop: phone && i ? `1px solid ${T.inkMuted}` : "0", minWidth: 0 }, [
      muted(label, { fontSize: 14 }),
      div({ fontStretch: "110%", fontWeight: 700, fontSize: phone ? 28 : 32, lineHeight: 1.05, letterSpacing: "-0.02em", ...NUM }, esc(value)),
      note(n),
    ])
  return div({ display: "grid", gridTemplateColumns: phone ? "1fr" : `repeat(${cells.length}, minmax(0, 1fr))`, borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, cells.map(cell))
}
const heldText = (r, { by = "account" } = {}) => {
  if (by === "person") {
    const per = {}
    for (const [k, q] of r.at) per[byKey[k].person] = (per[byKey[k].person] || 0) + q
    return Object.entries(per).map(([p, q]) => `${PEOPLE[p]} ${qty(q)}${r.at.some(([k]) => byKey[k].person === p && STALE_KEYS.includes(k)) ? "*" : ""}`).join(" · ")
  }
  return r.at.map(([k, q]) => `${NEED[byKey[k].bk].short} ${byKey[k].label} ${qty(q)}${STALE_KEYS.includes(k) ? "*" : ""}`).join(" · ")
}
function holdingsTable(rows, { by = "account", phone = false, heldLabel = "Held at" } = {}) {
  const v = sum(rows)
  if (phone) {
    return ledger({
      label: "Holdings",
      cols: [{ label: "Company", w: "minmax(0, 1fr)" }, { label: "Value", w: "auto", ...R }],
      rows: rows.map((r) => [col({ gap: 2 }, [bold(r.name), mutedCell(`${qty(r.q)} shares · ${heldText(r, { by })}`)]), col({ gap: 2, alignItems: "flex-end" }, [num(inr0(r.value)), mutedCell(pct1(r.value, v))])]),
      total: [bold("Total"), num(inr0(v))],
      rowPad: "12px 14px",
    })
  }
  return ledger({
    label: "Holdings",
    cols: [{ label: "Company", w: "minmax(0, 1.2fr)" }, { label: heldLabel, w: "minmax(0, 2fr)" }, { label: "Quantity", w: "96px", ...R }, { label: "Close", w: "116px", ...R }, { label: "Value", w: "132px", ...R }, { label: "Weight", w: "72px", ...R }],
    rows: rows.map((r) => [bold(r.name), div({ fontSize: 16 }, esc(heldText(r, { by }))), num(qty(r.q)), num(inr(CLOSES[r.name])), num(inr0(r.value)), num(pct1(r.value, v))]),
    total: [bold("Total"), "", "", "", num(inr0(v)), num("100%")],
  })
}

// ---------- Today: A as built on feat/holdings-dhan ----------
function T1() {
  const rows = combine(["kite", "dhan"])
  const v = total(rows)
  const c = total(rows, "cost")
  return appPage({
    content: [
      pageHead({ asOf: "Quantities from your brokers, valued at the NSE close of Friday 23 Oct." }),
      col({ gap: 12 }, [
        row({ justifyContent: "space-between", alignItems: "center" }, [h2("Your accounts"), div({ fontSize: 14, color: T.inkMuted }, "No “Add a broker”: both built brokers are connected")]),
        ledger({
          label: "Your accounts",
          cols: [{ label: "Account", w: "minmax(0, 1.2fr)" }, { label: "Where it stands", w: "minmax(0, 1.8fr)" }, { label: "Holdings read", w: "170px" }, { label: "", w: "330px", ...R }],
          rows: [
            [col({ gap: 2 }, [bold("Zerodha"), mutedCell("AB1234")]), col({ gap: 2 }, [bold("Signed out at 06:00"), mutedCell("Zerodha signs Maester out every morning at 6:00.")]), num("Fri 23 Oct, 16:10"), row({ gap: 8, justifyContent: "flex-end" }, [fill("Sign in to Zerodha"), out("Disconnect")])],
            [col({ gap: 2 }, [bold("Dhan"), mutedCell("1100482211")]), col({ gap: 2 }, [div({}, "Signed in"), mutedCell("Uses your Dhan connection from Settings")]), num("Today, 09:14"), row({ gap: 8, justifyContent: "flex-end" }, [out("Read again"), out("Disconnect")])],
          ],
        }),
      ]),
      strip([
        ["Known value", inr0(v), "5 of 5 holdings priced, at Maester’s NSE close."],
        ["Cost", inr0(c), "What your brokers report you paid, for 5 of 5 holdings."],
        ["Unrealized gain", signed(v - c), "Value less cost, for the 5 holdings with both."],
        ["Accounts", "1 of 2", "1 of 2 signed in now."],
      ]),
      col({ gap: 12 }, [
        h2("Holdings"),
        ledger({
          label: "Holdings",
          cols: [{ label: "Company", w: "minmax(0, 1.3fr)" }, { label: "Held at", w: "minmax(0, 1.6fr)" }, { label: "Quantity", w: "100px", ...R }, { label: "Close", w: "120px", ...R }, { label: "Value", w: "140px", ...R }, { label: "Weight", w: "80px", ...R }],
          rows: rows.map((r) => [bold(r.name), div({ fontSize: 16 }, esc(r.at.map(([k, q]) => `${k === "kite" ? "Zerodha" : "Dhan"} ${qty(q)}${k === "kite" ? "*" : ""}`).join(" · "))), num(qty(r.q)), num(inr(CLOSES[r.name])), num(inr0(r.value)), num(pct1(r.value, v))]),
          total: [bold("Total"), "", "", "", num(inr0(v)), ""],
        }),
        note("* Read Fri 23 Oct, 16:10, before Zerodha signed Maester out. Quantities change only when you trade; sign in to check."),
      ]),
    ],
  })
}

// ---------- D · Household, by person ----------
function personBlock(p, { firstFill }) {
  const accts = ACCTS.filter((a) => a.person === p)
  const v = sum(combineAccts(keysOf(p)))
  return col({ gap: 8 }, [
    row({ justifyContent: "space-between", alignItems: "baseline", gap: 12 }, [h3(`${PEOPLE[p]} · ${accts.length} accounts`), num(inr0(v), { fontWeight: 700, fontSize: 17 })]),
    ledger({
      label: `${PEOPLE[p]}’s accounts`,
      cols: [{ label: "Account", w: "minmax(0, 1.1fr)" }, { label: "Where it stands", w: "minmax(0, 1.5fr)" }, { label: "Holdings read", w: "150px" }, { label: "Value", w: "130px", ...R }, { label: "", w: "220px", ...R }],
      rows: accts.map((a) => {
        const [s, d] = STATE[a.state](a)
        const act = actionFor(a)
        return [col({ gap: 2 }, [bold(NEED[a.bk].name), mutedCell(a.id)]), col({ gap: 2 }, [div({ fontWeight: needsYou(a) ? 700 : 400 }, esc(s)), mutedCell(d)]), num(a.read), num(inr0(acctValue(a.key)) + (needsYou(a) ? "*" : "")), a.key === firstFill ? fill(act) : out(act)]
      }),
    }),
  ])
}
function D1() {
  return appPage({
    content: [
      pageHead({
        asOf: "Six accounts for two people, valued at the NSE close of Friday 23 Oct. Three need a sign-in today.",
        action: out("Add an account"),
        extra: row({ gap: 16, alignItems: "center", marginTop: 4 }, [div({ fontWeight: 700, fontSize: 16 }, "Whose holdings"), toggles(["Everyone", "Asha", "Ravi"], "Everyone")]),
      }),
      strip([
        ["Everyone", inr0(VALUE), "6 accounts, 7 companies, at Friday’s NSE close."],
        ["Asha", inr0(sum(combineAccts(keysOf("asha")))), "Zerodha, Groww, Upstox. Groww’s from Friday."],
        ["Ravi", inr0(sum(combineAccts(keysOf("ravi")))), "Zerodha, Angel One, ICICI Direct. Two from Friday."],
        ["Accounts read today", "3 of 6", "The rest are Friday’s quantities, starred."],
      ]),
      el("section", { display: "flex", flexDirection: "column", gap: 20 }, [h2("Accounts"), personBlock("asha", { firstFill: "g1" }), personBlock("ravi", { firstFill: null })]),
      col({ gap: 12 }, [h2("Holdings"), holdingsTable(ROWS, { by: "person", heldLabel: "Held by" }), note(staleNote)]),
    ],
  })
}
function D2() {
  const rows = combineAccts(keysOf("ravi"))
  const v = sum(rows), c = sum(rows, "cost")
  return appPage({
    content: [
      pageHead({
        asOf: "Ravi’s three accounts, valued at the NSE close of Friday 23 Oct. Weights are of Ravi’s holdings only.",
        action: out("Add an account"),
        extra: row({ gap: 16, alignItems: "center", marginTop: 4 }, [div({ fontWeight: 700, fontSize: 16 }, "Whose holdings"), toggles(["Everyone", "Asha", "Ravi"], "Ravi")]),
      }),
      strip([
        ["Ravi’s value", inr0(v), "3 accounts, 5 companies, at Friday’s NSE close."],
        ["Cost", inr0(c), "What Ravi’s brokers report was paid."],
        ["Unrealized gain", signed(v - c), "Value less cost, for the 5 holdings with both."],
        ["Read today", "1 of 3", "Zerodha and Angel One are Friday’s, starred."],
      ]),
      el("section", { display: "flex", flexDirection: "column", gap: 20 }, [h2("Accounts"), personBlock("ravi", { firstFill: "z2" })]),
      col({ gap: 12 }, [h2("Ravi’s holdings"), holdingsTable(rows, { by: "account" }), note(staleNote)]),
    ],
  })
}
function D3() {
  const acct = (a, first) => {
    const [s] = STATE[a.state](a)
    return col({ gap: 6, padding: "12px 0", borderTop: first ? "0" : `1px solid ${T.inkMuted}` }, [
      row({ justifyContent: "space-between", gap: 12 }, [bold(NEED[a.bk].name), div({ fontSize: 16, fontWeight: needsYou(a) ? 700 : 400 }, esc(s))]),
      mutedCell(`${a.id} · read ${a.readShort} · ${inr0(acctValue(a.key))}`),
      needsYou(a) ? (a.key === "g1" ? button(actionFor(a), { style: { alignSelf: "stretch", fontSize: 16 } }) : button(actionFor(a), { variant: "outline", style: { alignSelf: "stretch", fontSize: 16 } })) : "",
    ])
  }
  const person = (p) => col({ gap: 4 }, [row({ justifyContent: "space-between" }, [h3(PEOPLE[p], { fontSize: 20 }), num(inr0(sum(combineAccts(keysOf(p)))), { fontWeight: 700 })]), col({ borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, ACCTS.filter((a) => a.person === p).map((a, i) => acct(a, i === 0)))])
  return appPhone({
    content: [
      pageHead({ phone: true, asOf: "Six accounts, two people. Three need a sign-in today.", extra: toggles(["Everyone", "Asha", "Ravi"], "Everyone") }),
      strip([["Everyone", inr0(VALUE), "At Friday’s NSE close. 3 of 6 accounts read today."]], { phone: true }),
      h2("Accounts"), person("asha"), person("ravi"),
      out("Add an account"),
      col({ gap: 12 }, [h2("Holdings"), holdingsTable(ROWS, { by: "person", phone: true }), note(staleNote)]),
    ],
  })
}

// ---------- E · The morning round ----------
const ROUND = ["z2", "a1", "g1"]
const roundWhat = { z2: "Sign in on Zerodha’s page", a1: "Type the MPIN and the authenticator code", g1: "Approve the key on Groww Cloud" }
function roundPanel({ step = 0, phone = false } = {}) {
  const items = ROUND.map((k, i) => {
    const a = byKey[k]
    const done = i < step, now = i === step && step > 0
    return el("li", { display: "grid", gridTemplateColumns: phone ? "28px minmax(0, 1fr)" : "32px minmax(0, 1.2fr) minmax(0, 1.6fr) 150px", gap: phone ? 8 : 16, padding: "12px 0", borderTop: `1px solid ${T.paper}`, alignItems: "baseline", fontSize: 16 }, [
      div({ fontWeight: 700, ...NUM }, String(i + 1)),
      phone ? col({ gap: 2 }, [div({ fontWeight: 700 }, esc(accName(a))), div({ color: T.paperMuted, fontSize: 14 }, esc(done ? "Signed in · read 09:21" : roundWhat[k]))]) : div({ fontWeight: 700 }, esc(accName(a))),
      phone ? "" : div({ color: done ? T.paperMuted : T.paper }, esc(roundWhat[k])),
      phone ? "" : div({ textAlign: "right", fontWeight: now ? 700 : 400, color: done || now ? T.paper : T.paperMuted }, esc(done ? "Done · 2 read" : now ? "Now" : "Next")),
    ])
  })
  const head = row({ justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap", paddingBottom: 12, borderBottom: `2px solid ${T.paper}` }, [
    el("h2", { margin: 0, fontStretch: "110%", fontWeight: 700, fontSize: phone ? 24 : 28, lineHeight: 1.1, letterSpacing: "-0.02em" }, esc(step ? `Morning round · ${step + 1} of 3` : "3 accounts need you this morning")),
    phone ? "" : div({ color: T.paperMuted, fontSize: 16 }, "About a minute each. Each broker sends you back here."),
  ])
  const list = el("ol", { margin: 0, padding: 0, listStyle: "none" }, items)
  const start = step === 0
    ? row({ gap: 16, marginTop: 16, flexWrap: "wrap", alignItems: "center" }, [button("Start with Zerodha · Ravi", { inverted: true, style: phone ? { alignSelf: "stretch", width: "100%" } : {} }), phone ? "" : div({ color: T.paperMuted, fontSize: 16 }, "You can stop after any one; what’s read stays read.")])
    : ""
  return el("section", { background: T.ink, color: T.paper, padding: phone ? "20px 24px" : "24px 28px", margin: phone ? "0 -24px" : 0, display: "flex", flexDirection: "column", gap: 0 }, [head, list, start, step ? angelInline({ phone }) : ""])
}
function angelInline({ phone }) {
  const f = (label, value, pw) => col({ gap: 6, flex: 1, minWidth: phone ? 0 : 200 }, [
    div({ fontWeight: 700, fontSize: 16 }, esc(label)),
    row({ alignItems: "stretch" }, [div({ flex: 1, minHeight: 44, border: `2px solid ${T.paper}`, padding: "0 12px", display: "flex", alignItems: "center", fontSize: 16, boxSizing: "border-box", ...NUM }, esc(value)), pw ? button("Show", { variant: "outline", inverted: true, style: { borderLeft: 0, padding: "0 14px", fontSize: 16 } }) : ""]),
  ])
  return col({ gap: 14, marginTop: 16, paddingTop: 16, borderTop: `2px solid ${T.paper}` }, [
    div({ fontWeight: 700, fontSize: 20 }, "Angel One · Ravi · client code R123456"),
    div({ fontSize: 16, color: T.paperMuted, maxWidth: 720 }, "Angel One signs in only with the account’s MPIN and the 6-digit code from its authenticator. Maester uses both once, for this sign-in, and keeps neither."),
    phone ? col({ gap: 12 }, [f("MPIN", "••••", true), f("Code from the authenticator", "418 902")]) : row({ gap: 16, alignItems: "flex-end" }, [f("MPIN", "••••", true), f("Code from the authenticator", "418 902")]),
    row({ gap: 16, flexWrap: "wrap" }, [button("Sign in and read", { inverted: true }), button("Skip this one", { variant: "outline", inverted: true })]),
  ])
}
function compactAccounts() {
  return ledger({
    label: "Accounts",
    cols: [{ label: "Account", w: "minmax(0, 1.3fr)" }, { label: "Where it stands", w: "minmax(0, 1.2fr)" }, { label: "Holdings read", w: "160px" }, { label: "Value", w: "140px", ...R }],
    rows: ACCTS.map((a) => [col({ gap: 2 }, [bold(accName(a)), mutedCell(a.id)]), div({ fontWeight: needsYou(a) ? 700 : 400 }, esc(STATE[a.state](a)[0])), num(a.read), num(inr0(acctValue(a.key)) + (needsYou(a) ? "*" : ""))]),
    total: [bold("All accounts"), "", "", num(inr0(VALUE))],
  })
}
function E1() {
  return appPage({
    content: [
      pageHead({ asOf: "Six accounts, valued at the NSE close of Friday 23 Oct." }),
      roundPanel(),
      strip([
        ["Known value", inr0(VALUE), "7 of 7 holdings priced, at Friday’s NSE close."],
        ["Cost", inr0(COST), "What your brokers report you paid, per account."],
        ["Unrealized gain", signed(VALUE - COST), "Value less cost, for the 7 holdings with both."],
        ["Accounts read today", "3 of 6", "Finish the round to read the other 3."],
      ]),
      col({ gap: 12 }, [row({ justifyContent: "space-between", alignItems: "center" }, [h2("Accounts"), row({ gap: 12 }, [out("Add an account"), out("Manage accounts")])]), compactAccounts()]),
      col({ gap: 12 }, [h2("Holdings"), holdingsTable(ROWS), note(staleNote)]),
    ],
  })
}
function E2() {
  return appPage({
    content: [
      pageHead({ asOf: "Six accounts, valued at the NSE close of Friday 23 Oct." }),
      el("p", { margin: 0, fontWeight: 700, fontSize: 17 }, "Zerodha · Ravi signed in. 2 holdings read."),
      roundPanel({ step: 1 }),
      col({ gap: 12 }, [h2("Holdings"), note("The table below updates as each account is read; it never reorders while you type.")]),
    ],
  })
}
function E3() {
  return appPhone({
    content: [
      pageHead({ phone: true, asOf: "Six accounts, valued at Friday’s NSE close." }),
      roundPanel({ phone: true }),
      strip([["Known value", inr0(VALUE), "7 of 7 priced. 3 of 6 accounts read today; the rest are Friday’s."]], { phone: true }),
      col({ gap: 12 }, [h2("Holdings"), holdingsTable(ROWS, { phone: true }), note(staleNote)]),
      row({ gap: 12, flexWrap: "wrap" }, [out("Add an account"), out("Manage accounts")]),
    ],
  })
}

// ---------- F · Accounts as columns ----------
function matrix({ selected } = {}) {
  const tracks = `minmax(0, 1fr) repeat(${ACCTS.length}, 86px) 72px 120px 64px`
  const g = { display: "grid", gridTemplateColumns: tracks, gap: "0 10px", padding: "10px 14px", alignItems: "baseline" }
  const sel = (k) => (k === selected ? { background: T.ink, color: T.paper, margin: "-10px -5px", padding: "10px 5px" } : {})
  const head = div({ ...g, alignItems: "end", borderBottom: `2px solid ${T.ink}`, fontSize: 14, color: T.inkMuted }, [
    div({}, "Company"),
    ...ACCTS.map((a) => el("button", { textAlign: "right", fontFamily: "inherit", fontSize: 14, lineHeight: 1.3, border: 0, background: "transparent", padding: 0, color: T.ink, cursor: "pointer", ...sel(a.key) }, `<span style="font-weight:700;display:block">${esc(NEED[a.bk].short)}</span><span style="display:block">${esc(a.label)}</span><span style="display:block;${a.key === selected ? "" : `color:${T.inkMuted}`};${needsYou(a) ? "font-weight:700" : ""}">${esc(needsYou(a) ? "Fri*" : a.readShort.replace("today ", ""))}</span>`, { type: "button", "aria-pressed": a.key === selected ? "true" : "false" })),
    div({ textAlign: "right" }, "Total"), div({ textAlign: "right" }, "Value"), div({ textAlign: "right" }, "Weight"),
  ])
  const body = ROWS.map((r) => div({ ...g, borderBottom: `1px solid ${T.inkMuted}`, fontSize: 16 }, [
    bold(r.name),
    ...ACCTS.map((a) => { const q = r.at.find(([k]) => k === a.key); return div({ textAlign: "right", ...NUM, color: q ? T.ink : T.inkMuted, ...(a.key === selected ? { fontWeight: 700 } : {}) }, q ? qty(q[1]) : "·") }),
    num(qty(r.q), { textAlign: "right", fontWeight: 700 }), num(inr0(r.value), { textAlign: "right" }), num(pct1(r.value, VALUE), { textAlign: "right" }),
  ]))
  const foot = div({ ...g, borderTop: `2px solid ${T.ink}`, fontWeight: 700, fontSize: 16 }, [
    div({}, "Value"),
    ...ACCTS.map((a) => num(inr0(acctValue(a.key)), { textAlign: "right", fontSize: 14 })),
    div({}), num(inr0(VALUE), { textAlign: "right" }), num("100%", { textAlign: "right" }),
  ])
  return div({ border: `2px solid ${T.ink}`, flexShrink: 0 }, [head, ...body, foot], { role: "table", "aria-label": "Holdings by account" })
}
function F1() {
  return appPage({
    content: [
      pageHead({ asOf: "Each column is one account. Starred columns are Friday’s quantities: those accounts signed Maester out.", action: out("Add an account") }),
      strip([
        ["Known value", inr0(VALUE), "7 of 7 holdings priced, at Friday’s NSE close."],
        ["Cost", inr0(COST), "What your brokers report you paid, per account."],
        ["Unrealized gain", signed(VALUE - COST), "Value less cost, for the 7 holdings with both."],
        ["Accounts read today", "3 of 6", "Choose a starred column to sign it in."],
      ]),
      col({ gap: 12 }, [h2("Holdings by account"), matrix({}), note("· means the account holds none. The last row is each account’s value at Friday’s close."), note(staleNote)]),
    ],
  })
}
function F2() {
  const a = byKey.z2
  const rows = combineAccts(["z2"])
  const cell = (t, d, b = false) => col({ gap: 4, padding: "0 20px", borderLeft: `1px solid ${T.inkMuted}`, minWidth: 0 }, [muted(t), div({ fontSize: 16, fontWeight: b ? 700 : 400 }, esc(d))])
  return appPage({
    content: [
      pageHead({ asOf: "Each column is one account. Starred columns are Friday’s quantities.", action: out("Add an account") }),
      el("section", { display: "flex", flexDirection: "column", gap: 16, border: `2px solid ${T.ink}`, padding: "18px 20px" }, [
        row({ justifyContent: "space-between", gap: 16, flexWrap: "wrap" }, [h3("Zerodha · Ravi"), row({ gap: 12 }, [button("Sign in to Zerodha", { style: sm }), out("Rename"), out("Disconnect"), out("Close")])]),
        div({ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", margin: "0 -20px" }, [
          cell("Client ID", a.id), cell("Where it stands", "Signed out at 06:00", true), cell("Read", a.read), cell("Holds", `${rows.length} companies · ${inr0(sum(rows))}`), cell("Key", "Ending 7c2d. Saved 20 Oct."),
        ].map((h, i) => (i === 0 ? h.replace("border-left: 1px solid #5F5F5B", "border-left: 0") : h))),
      ]),
      col({ gap: 12 }, [h2("Holdings by account"), matrix({ selected: "z2" }), note(staleNote)]),
    ],
  })
}
function F3() {
  const card = (r, i) => col({ gap: 6, padding: "12px 0", borderTop: i ? `1px solid ${T.inkMuted}` : "0" }, [
    row({ justifyContent: "space-between", gap: 12 }, [bold(r.name), num(inr0(r.value), { fontWeight: 700 })]),
    ...r.at.map(([k, q]) => row({ justifyContent: "space-between", fontSize: 16 }, [div({}, esc(accName(byKey[k]) + (STALE_KEYS.includes(k) ? "*" : ""))), num(qty(q))])),
  ])
  return appPhone({
    content: [
      pageHead({ phone: true, asOf: "By company, then by account. Starred accounts are Friday’s." }),
      strip([["Known value", inr0(VALUE), "3 of 6 accounts read today."]], { phone: true }),
      row({ gap: 0, overflow: "hidden" }, [toggles(["By company", "By account"], "By company")]),
      col({ borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, ROWS.map(card)),
      note(staleNote), out("Add an account"),
    ],
  })
}

// ---------- Shared · what each broker needs ----------
function needSheet() {
  return ledger({
    label: "What each broker needs",
    rowPad: "12px 14px",
    fontSize: 15,
    cols: [{ label: "Broker", w: "120px" }, { label: "Once, per account", w: "minmax(0, 1.4fr)" }, { label: "Each day", w: "minmax(0, 1.2fr)" }, { label: "A sign-in lasts", w: "150px" }, { label: "Cost", w: "130px" }, { label: "Several accounts", w: "minmax(0, 1.3fr)" }],
    rows: TOP5.map((k) => { const b = NEED[k]; return [bold(b.name), div({}, esc(b.once)), div({}, esc(b.daily)), div({}, esc(b.lasts)), div({}, esc(b.cost)), div({}, esc(b.perAccount))] }),
  })
}
function whose(selected = "Ravi") {
  return col({ gap: 8 }, [div({ fontWeight: 700, fontSize: 16 }, "Whose account is it?"), note("Shown beside each holding, so two accounts at one broker never look alike."), toggles(["Asha", "Ravi", "Someone else"], selected)])
}
function S1() {
  return appPage({
    content: [
      pageHead({ asOf: "Add an account: say whose it is, then pick the broker. Each broker asks for different things." }),
      el("section", { display: "flex", flexDirection: "column", gap: 20, borderTop: `2px solid ${T.ink}`, paddingTop: 20 }, [
        h2("Add an account"),
        whose("Ravi"),
        col({ gap: 8 }, [div({ fontWeight: 700, fontSize: 16 }, "Which broker?"), toggles(["Groww", "Zerodha", "Angel One", "ICICI Direct", "Upstox", "Dhan"], "Zerodha")]),
        col({ gap: 8 }, [h3("What each broker needs"), note("For each account. Every broker signs Maester out daily: SEBI’s 2025 rules allow no lasting read access. Mutual funds come by API from Zerodha and Upstox only."), needSheet()]),
      ]),
    ],
  })
}
function brokerForm(k, { person = "Ravi", extra = [], lede, action, phoneNote } = {}) {
  const b = NEED[k]
  const redirect = ["kite", "upstox", "icici"].includes(k)
  return col({ gap: 18, flex: 1, minWidth: 0 }, [
    col({ gap: 8 }, [h3(`Connect ${b.name} · ${person}`), body(lede)]),
    steps(b.steps.map(esc)),
    redirect ? field("Redirect URL", { value: `https://maester.example/api/v1/brokers/${k}/return`, copy: true, hint: "Paste this into the app’s redirect URL." }) : "",
    ...b.fields.map(([l, v, pw]) => field(l, { value: v, password: !!pw })),
    ...extra,
    spec([["A sign-in lasts", esc(b.lasts)], ["What it costs", esc(b.cost)], ["Each day", esc(b.daily)]], { termW: 140 }),
    row({ gap: 16, flexWrap: "wrap" }, [button(action), out("Cancel")]),
    phoneNote ? note(phoneNote) : "",
  ])
}
function S2() {
  return appPage({
    content: [
      pageHead({}),
      row({ gap: 48, alignItems: "flex-start", borderTop: `2px solid ${T.ink}`, paddingTop: 20 }, [
        col({ gap: 16, width: 360, flexShrink: 0 }, [h2("Add an account"), whose("Ravi"), notice({ title: "Asha’s Zerodha is already here.", lines: ["Ravi’s needs a free Personal app with that client ID. Asha’s developer login can make it. Ravi still signs in on Zerodha each day, with their own login and code."] })]),
        brokerForm("kite", { lede: "Zerodha lets an app read one account’s holdings once that account holder makes a free Personal app and signs in to it each day.", action: "Save and sign in with Zerodha", phoneNote: "Maester asks Zerodha only for holdings. It never places an order." }),
      ]),
    ],
  })
}
function S3() {
  return appPage({
    content: [
      pageHead({}),
      row({ gap: 48, alignItems: "flex-start", borderTop: `2px solid ${T.ink}`, paddingTop: 20 }, [
        col({ gap: 16, width: 360, flexShrink: 0 }, [h2("Add an account"), whose("Ravi"), notice({ title: "Open question: is Angel One in?", lines: ["Angel One signs in only with the MPIN and a code from the authenticator. This form takes both each morning and keeps neither. Keeping them so Maester signs in alone is not drawn."] })]),
        brokerForm("angel", { lede: "Angel One’s SmartAPI reads one account’s holdings once you sign in with its MPIN and the authenticator’s code. That sign-in lasts until midnight.", action: "Save Angel One", phoneNote: "Saved: the API key and client code. Never saved: the PIN and the code." }),
      ]),
    ],
  })
}
function S4() {
  return appPage({
    content: [
      pageHead({}),
      row({ gap: 48, alignItems: "flex-start", borderTop: `2px solid ${T.ink}`, paddingTop: 20 }, [
        col({ gap: 16, width: 360, flexShrink: 0 }, [h2("Add an account"), whose("Asha"), notice({ title: "Groww charges ₹499 a month to read holdings.", lines: ["Per account, and it is an early-bird price: Groww lists ₹2,000. Groww’s API has no mutual funds."] })]),
        brokerForm("groww", { person: "Asha", lede: "Groww reads holdings through its Trade API, a paid subscription. You approve Maester’s key on Groww Cloud once a day.", action: "Save and read Groww" }),
      ]),
    ],
  })
}
function S5() {
  return appPage({
    content: [
      pageHead({}),
      row({ gap: 40, alignItems: "flex-start", borderTop: `2px solid ${T.ink}`, paddingTop: 20 }, [
        brokerForm("upstox", { person: "Asha", lede: "Upstox allows one API app per account. If Asha already uses another tool through an Upstox app, this replaces it.", action: "Save and sign in with Upstox" }),
        brokerForm("icici", { lede: "ICICI Direct reads holdings through Breeze, free. Its app form asks for a static IP, though the rule is for orders. Each sign-in lasts until midnight.", action: "Save and sign in with ICICI Direct" }),
      ]),
    ],
  })
}

// ---------- the document ----------
const BASE_CSS = `body{margin:0;background:${T.paper};font-family:'Archivo', 'Helvetica Neue', Arial, sans-serif}button{font-family:inherit;margin:0}a{color:inherit}h1,h2,h3,p,dl,dd,figure,ol{margin:0}a:hover{background:#000000;color:#EDEDE8;text-decoration:none}button:focus-visible,a:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:3px solid #000000;outline-offset:2px}`
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

const W = 1440, P = 390
const FRAMES = [
  { id: "Main.dc.html", title: "Today · A as built: one account per broker, Zerodha and Dhan", w: W, h: 900, render: T1, row: 0 },
  { id: "D1.dc.html", title: "D1 · Household, by person — everyone, three accounts need you", w: W, h: 900, render: D1, row: 1 },
  { id: "D2.dc.html", title: "D2 · Household, by person — Ravi only", w: W, h: 900, render: D2, row: 1 },
  { id: "D3.dc.html", title: "D3 · Household, by person — phone 390", w: P, h: 844, render: D3, row: 1, phone: true },
  { id: "E1.dc.html", title: "E1 · The morning round — three accounts need you", w: W, h: 900, render: E1, row: 2 },
  { id: "E2.dc.html", title: "E2 · The morning round — 2 of 3, Angel One’s PIN and code", w: W, h: 900, render: E2, row: 2 },
  { id: "E3.dc.html", title: "E3 · The morning round — phone 390", w: P, h: 844, render: E3, row: 2, phone: true },
  { id: "F1.dc.html", title: "F1 · Accounts as columns — six accounts, one table", w: W, h: 900, render: F1, row: 3 },
  { id: "F2.dc.html", title: "F2 · Accounts as columns — a column chosen: Zerodha · Ravi", w: W, h: 900, render: F2, row: 3 },
  { id: "F3.dc.html", title: "F3 · Accounts as columns — phone 390, by company", w: P, h: 844, render: F3, row: 3, phone: true },
  { id: "S1.dc.html", title: "Shared 1 · Add an account: whose, which broker, what each needs", w: W, h: 900, render: S1, row: 4 },
  { id: "S2.dc.html", title: "Shared 2 · A second Zerodha account (Ravi’s)", w: W, h: 900, render: S2, row: 4 },
  { id: "S3.dc.html", title: "Shared 3 · Angel One: PIN and code each day, kept never", w: W, h: 900, render: S3, row: 5 },
  { id: "S4.dc.html", title: "Shared 4 · Groww: paid, approved daily", w: W, h: 900, render: S4, row: 5 },
  { id: "S5.dc.html", title: "Shared 5 · Upstox and ICICI Direct, side by side to compare (the page shows one)", w: W, h: 900, render: S5, row: 5 },
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
fs.writeFileSync(path.join(OUT, "twins", "sheet.html"), `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#c9c9c4;font-family:system-ui}h2{font:600 14px system-ui;margin:24px 24px 8px}iframe{border:0;margin:0 24px;display:block;background:#fff}</style></head><body>${FRAMES.map((f) => `<h2 id="${f.id}">${esc(f.title)} (${f.w}×${f.h})</h2><iframe src="${f.id.replace(".dc.html", ".html")}" width="${f.w}" height="${f.h}"></iframe>`).join("")}</body></html>`)
fs.writeFileSync(path.join(OUT, "twins", "measure.html"), `<!doctype html><html><body><script>
const F=${JSON.stringify(FRAMES.map((f) => [f.id, f.w]))};
async function measureAll(){const out={};for(const [id,w] of F){const fr=document.createElement('iframe');fr.style.cssText='width:'+w+'px;height:400px;border:0';fr.src=id.replace('.dc.html','.html');document.body.appendChild(fr);await new Promise(r=>fr.onload=r);await fr.contentDocument.fonts.ready;await new Promise(r=>setTimeout(r,150));const root=fr.contentDocument.body.firstElementChild;const kids=[...root.querySelectorAll('*')];const bottom=Math.max(...kids.map(k=>k.getBoundingClientRect().bottom));const wide=Math.max(...kids.map(k=>k.getBoundingClientRect().right));out[id]={frame:root.offsetHeight,content:Math.ceil(bottom),right:Math.ceil(wide)};fr.remove()}return out}
</script></body></html>`)

// ---------- canvas.json ----------
const NOTES = JSON.parse(fs.readFileSync(path.join(HERE, "accounts-notes.json"), "utf8"))
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
  boards[f.id] = { x, y: rowY[f.row], w: f.w, h: f.h, title: f.title, page: "round2" }
  colX[f.row] = x + f.w + 80
}
NOTES.rows.forEach((n, i) => {
  const r = rows[i]
  notes[`r2Title${i}`] = { kind: "title1", text: n.title, x: 0, y: rowY[r] - 260, maxW: colX[r], page: "round2" }
  notes[`r2Note${i}`] = { text: n.note, x: 0, y: rowY[r], w: 600, maxH: Math.min(1800, rowH[r]), size: "l", color: n.color || (i === 0 ? "red" : "orange"), page: "round2" }
})
const right = Math.max(...Object.values(colX))
notes.r2Constraint = { text: NOTES.constraint, x: right + 80, y: 0, w: 700, maxH: 500, size: "l", color: "red", page: "round2" }
notes.r2Questions = { text: NOTES.questions, x: right + 80, y: 560, w: 700, maxH: 1000, size: "l", color: "blue", page: "round2" }
notes.r2Shared = { text: NOTES.shared, x: right + 80, y: rowY[1], w: 700, maxH: 1600, size: "m", color: "green", page: "round2" }
const canvas = {
  v: 3,
  createdOnFiles: { v: 1, at: "2026-10-24T10:00:00Z" },
  title: "Maester Broker Accounts",
  launch: { view: "canvas", page: "round2" },
  pages: [{ id: "round2", name: "Round 2 · Several accounts" }],
  boards,
  order: FRAMES.map((f) => f.id),
  notes,
  designSystems: [],
}
fs.writeFileSync(path.join(OUT, "project", "canvas.json"), JSON.stringify(canvas, null, 2))
console.log("built", FRAMES.length, "frames", FRAMES.map((f) => f.id + ":" + f.h).join(" "))
