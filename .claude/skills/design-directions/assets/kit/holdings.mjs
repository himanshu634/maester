// node holdings.mjs [holdings-heights.json] → ../canvas/project/*.dc.html, canvas.json, ../canvas/twins/*
// Round 1 of the Maester Broker Connections canvas (2026-10-19): connecting several brokers'
// read-only APIs to bring holdings into Maester, on the Holdings page (the user: "I think that
// will fall under the holding page."). Today + A/B/C + shared connect states.
// Broker facts (how each one signs in, what it costs, how long a sign-in lasts) come from
// docs/research/2026-10-19-broker-apis.md and live in BROKERS below, nowhere else.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { T, ILLUS, NUM, esc, el, div, row, col, muted, spacer, button, link, tag, spec, ledger } from "./lib.mjs"
import {
  FONTS, HAND, appH1, h2, h3, body, note, strong, synth, appPage, appPhone, aLink, notice, field, steps, itemRow,
  ACCOUNTS, CLOSES, combine, total, inr, inr0, qty, pct1, shortName,
} from "./holdings-base.mjs"
import { BROKERS, GROUPS_BY_SIGN_IN } from "./holdings-brokers.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, "..", "canvas")
const HEIGHTS = process.argv[2] && fs.existsSync(process.argv[2]) ? JSON.parse(fs.readFileSync(process.argv[2], "utf8")) : {}

// ---------- sketch plates (the error sketches' recipe) ----------
const roughDefs = (k) => `<defs>
<filter id="r1${k}" x="-3%" y="-3%" width="106%" height="106%"><feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="7" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap></filter>
<filter id="r2${k}" x="-3%" y="-3%" width="106%" height="106%"><feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="19" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap></filter>
</defs>`
const plates = (k, colour, ink) => `
<g transform="translate(7 6)">${colour}</g>
<g fill="none" stroke="#000000" stroke-linecap="round" stroke-linejoin="round" stroke-width="3.2" filter="url(#r1${k})">${ink}</g>
<g fill="none" stroke="#000000" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4" opacity="0.55" filter="url(#r2${k})" transform="translate(1.5 -1)">${ink}</g>`
const hand = (x, y, t, { size = 30, rot = 0, anchor = "start", weight = 700 } = {}) =>
  `<text x="${x}" y="${y}" font-family="${HAND}" font-size="${size}" font-weight="${weight}" fill="#000000" text-anchor="${anchor}"${rot ? ` transform="rotate(${rot} ${x} ${y})"` : ""}>${esc(t)}</text>`

// The crane as built on /terminal/holdings (CraneSketch), drawn still.
function craneSketch({ w = 460 } = {}) {
  const ink = `
<path d="M20 444 L 510 444"></path>
<path d="M112 444 L 112 64"></path><path d="M142 444 L 142 64"></path>
<path d="M112 404 L 142 364 L 112 324 L 142 284 L 112 244 L 142 204 L 112 164 L 142 124 L 112 84"></path>
<path d="M60 64 L 470 64"></path><path d="M126 20 L 60 64"></path><path d="M126 20 L 470 64"></path><path d="M126 20 L 126 64"></path>
<path d="M58 64 L 98 64 L 98 98 L 58 98 Z"></path>
<path d="M376 64 L 392 64 L 392 74 L 376 74 Z"></path><path d="M384 70 L 384 120"></path>
<path d="M286 444 L 286 392 L 474 392 L 474 444"></path><path d="M286 418 L 474 418"></path>
<path d="M330 392 L 330 418"></path><path d="M390 392 L 390 418"></path><path d="M440 392 L 440 418"></path><path d="M310 418 L 310 444"></path><path d="M360 418 L 360 444"></path><path d="M420 418 L 420 444"></path>
<path d="M384 120 L 384 132"></path><path d="M376 132 Q 384 144 392 132"></path><path d="M384 140 L 314 158"></path><path d="M384 140 L 454 158"></path><path d="M306 158 L 462 156 L 464 222 L 308 224 Z"></path>`
  const colour = `
<path d="M112 444 L 112 64 L 142 64 L 142 444 Z" fill="${ILLUS.red}"></path>
<path d="M60 58 L 470 58 L 470 70 L 60 70 Z" fill="${ILLUS.yellow}"></path>
<path d="M286 444 L 286 392 L 474 392 L 474 444 Z" fill="${ILLUS.yellow}"></path>
<path d="M306 158 L 462 156 L 464 222 L 308 224 Z" fill="${ILLUS.blue}"></path>`
  return `<svg viewBox="0 0 520 480" width="${w}" height="${Math.round((w * 480) / 520)}" role="img" aria-labelledby="crn" style="display: block; flex-shrink: 0">
<title id="crn">A sketch of a crane holding a block labelled Holdings over a half-built wall.</title>
${roughDefs("t")}${plates("t", colour, ink)}<rect x="318" y="168" width="134" height="44" fill="#EDEDE8"></rect>${hand(385, 200, "Holdings", { size: 32, anchor: "middle" })}
${hand(290, 470, "drag the load down", { size: 24, weight: 600 })}
</svg>`
}

// ---------- shared pieces ----------
const R = { align: "right" }
const num = (t) => div({ ...NUM }, esc(t))
const bold = (t) => div({ fontWeight: 700 }, esc(t))
const mutedCell = (t) => div({ color: T.inkMuted, fontSize: 14, lineHeight: 1.45 }, esc(t))
const both = (a, b) => col({ gap: 2 }, [div({}, esc(a)), mutedCell(b)])
const ALL = ["kite", "dhan", "groww"]
const ROWS = combine(ALL)
const VALUE = total(ROWS)

function pageHead({ phone = false, asOf, action }) {
  return col({ gap: 12 }, [
    row({ gap: 16, alignItems: phone ? "flex-start" : "center", justifyContent: "space-between", flexWrap: "wrap" }, [
      col({ gap: 10 }, [appH1("Holdings", phone ? 32 : 40), row({ gap: 8, flexWrap: "wrap" }, [tag("Holdings snapshot"), synth()])]),
      action && !phone ? action : "",
    ]),
    asOf ? body(asOf, { maxWidth: 760 }) : "",
  ])
}

// A figure strip: four cells, each with a note saying what it covers.
function strip(cells, { phone = false } = {}) {
  const cell = ([label, value, n], i) =>
    col({ gap: 6, padding: phone ? "14px 0" : "16px 20px", borderLeft: !phone && i ? `1px solid ${T.inkMuted}` : "0", borderTop: phone && i ? `1px solid ${T.inkMuted}` : "0", minWidth: 0 }, [
      muted(label, { fontSize: 14 }),
      div({ fontStretch: "110%", fontWeight: 700, fontSize: phone ? 28 : 32, lineHeight: 1.05, letterSpacing: "-0.02em", ...NUM }, esc(value)),
      note(n),
    ])
  return div({ display: "grid", gridTemplateColumns: phone ? "1fr" : "repeat(4, minmax(0, 1fr))", borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, cells.map(cell))
}
const COST = total(ROWS, "cost")
const stripCells = (staleNote) => [
  ["Known value", inr0(VALUE), "6 of 6 holdings priced, at Friday’s NSE close."],
  ["Cost", inr0(COST), "What the three brokers report you paid, averaged per account."],
  ["Unrealized gain", (VALUE - COST >= 0 ? "+" : "−") + inr0(Math.abs(VALUE - COST)), "Value less cost, for the 6 holdings with both."],
  ["Accounts read", "2 of 3 today", staleNote],
]

// The combined table: one row per company, with where it is held.
function combinedTable({ phone = false, heldAt = true, staleKey = null } = {}) {
  const at = (r) => r.at.map(([k, q]) => `${shortName[k]} ${qty(q)}${k === staleKey ? "*" : ""}`).join(" · ")
  if (phone) {
    return ledger({
      label: "Holdings",
      cols: [{ label: "Company", w: "minmax(0, 1fr)" }, { label: "Value", w: "auto", ...R }],
      rows: ROWS.map((r) => [col({ gap: 2 }, [bold(r.name), mutedCell(`${qty(r.q)} shares · ${at(r)}`)]), col({ gap: 2, alignItems: "flex-end" }, [num(inr0(r.value)), mutedCell(pct1(r.value, VALUE))])]),
      total: [bold("Total"), num(inr0(VALUE))],
      rowPad: "12px 14px",
    })
  }
  const cols = [
    { label: "Company", w: "minmax(0, 1.3fr)" },
    ...(heldAt ? [{ label: "Held at", w: "minmax(0, 1.6fr)" }] : []),
    { label: "Quantity", w: "100px", ...R },
    { label: "Close", w: "120px", ...R },
    { label: "Value", w: "140px", ...R },
    { label: "Weight", w: "80px", ...R },
  ]
  return ledger({
    label: "Holdings",
    cols,
    rows: ROWS.map((r) => [bold(r.name), ...(heldAt ? [div({ fontSize: 16 }, esc(at(r)))] : []), num(qty(r.q)), num(inr(CLOSES[r.name])), num(inr0(r.value)), num(pct1(r.value, VALUE))]),
    total: [bold("Total"), ...(heldAt ? [""] : []), "", "", num(inr0(VALUE)), num("100%")],
  })
}

// ---------- Today ----------
function T1() {
  return appPage({
    holdingsLive: false,
    synthetic: false,
    content: [
      row({ gap: 48, alignItems: "flex-start" }, [
        col({ gap: 16, flex: 1, maxWidth: 640, paddingTop: 8 }, [
          row({ gap: 12, alignItems: "center" }, [appH1("Holdings"), tag("Coming soon")]),
          body("Every position you own, with its weight, cost and the date of its price. We’re still building it."),
          body("It opens once you can add your holdings."),
        ]),
        craneSketch({ w: 460 }),
      ]),
    ],
  })
}
function T2() {
  return appPage({
    active: "Settings",
    holdingsLive: false,
    synthetic: false,
    content: [
      col({ gap: 12 }, [appH1("Settings"), body("Your account and the connections Maester reads the market through. More settings arrive here as the terminal grows.")]),
      col({ gap: 0 }, [
        h2("Connections", { marginBottom: 8 }),
        note("Where Maester reads market data from. Each uses your own account; what it reads is for you only.", { marginBottom: 16 }),
        itemRow({ title: "Dhan", summary: "Nifty 50, India VIX, MCX gold, Nifty 500 closes, the option chain", state: "Connected" }),
        itemRow({ title: "FRED", summary: "US VIX and the rupee per dollar", state: "Connected" }),
        div({ borderTop: `2px solid ${T.ink}` }),
      ]),
      notice({
        title: "What Dhan is used for today",
        lines: ["Closes for the market mood and the Research summary. The same token can read your Dhan holdings, but nothing asks it to, and no other broker can be connected."],
        style: { maxWidth: 760 },
      }),
    ],
  })
}

// ---------- A · Accounts, then one table ----------
const STALE = "Zerodha read Sunday 18 Oct, 15:42."
function accountsLedger({ phone = false, adding = false } = {}) {
  const k = BROKERS.kite, d = BROKERS.dhan, g = BROKERS.groww
  const rowsDesk = [
    [col({ gap: 2 }, [bold("Zerodha"), mutedCell("AB1234 · Kite Connect")]), col({ gap: 2 }, [bold("Signed out at 06:00"), mutedCell(k.expiryWords)]), num("Sun 18 Oct, 15:42"), button("Sign in to Zerodha", { style: { fontSize: 16 } })],
    [col({ gap: 2 }, [bold("Dhan"), mutedCell("1100482211 · from Settings")]), col({ gap: 2 }, [div({}, "Connected"), mutedCell(d.expiryWords)]), num("Today, 09:14"), button("Read again", { variant: "outline", style: { fontSize: 16 } })],
    [col({ gap: 2 }, [bold("Groww"), mutedCell("6F2K9Q · Groww Trade API")]), col({ gap: 2 }, [div({}, "Connected"), mutedCell(g.expiryWords)]), num("Today, 09:14"), button("Read again", { variant: "outline", style: { fontSize: 16 } })],
  ]
  if (phone) {
    const item = ([name, id, st, read, act]) =>
      col({ gap: 8, padding: "14px 0", borderTop: `1px solid ${T.inkMuted}` }, [
        row({ justifyContent: "space-between", gap: 12 }, [bold(name), div({ fontSize: 16, fontWeight: st.startsWith("Signed") ? 700 : 400 }, esc(st))]),
        mutedCell(`${id} · read ${read}`),
        act,
      ])
    return col({ borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, [
      item(["Zerodha", "AB1234", "Signed out at 06:00", "Sun 15:42", button("Sign in to Zerodha", { style: { alignSelf: "stretch", fontSize: 16 } })]),
      item(["Dhan", "1100482211", "Connected", "today 09:14", ""]),
      item(["Groww", "6F2K9Q", "Connected", "today 09:14", ""]),
    ].map((h, i) => (i === 0 ? h.replace("border-top: 1px solid #5F5F5B", "border-top: 0") : h)))
  }
  return ledger({
    label: "Your accounts",
    cols: [{ label: "Account", w: "minmax(0, 1.2fr)" }, { label: "Where it stands", w: "minmax(0, 1.8fr)" }, { label: "Holdings read", w: "170px" }, { label: "", w: "220px", ...R }],
    rows: rowsDesk,
  })
}
function A1() {
  return appPage({
    content: [
      pageHead({ asOf: "Quantities from your brokers, valued at Friday’s NSE close (16 Oct). Zerodha’s are from Sunday: sign in to read today’s." }),
      col({ gap: 12 }, [
        row({ justifyContent: "space-between", alignItems: "center" }, [h2("Your accounts"), button("Add a broker", { variant: "outline", style: { fontSize: 16 } })]),
        accountsLedger(),
      ]),
      strip(stripCells(STALE)),
      col({ gap: 12 }, [h2("Holdings"), combinedTable({ staleKey: "kite" }), note("* Read Sunday 18 Oct, 15:42, before Zerodha signed Maester out. Quantities change only when you trade; sign in to check.")]),
    ],
  })
}
function brokerPicker({ selected = "kite" } = {}) {
  const group = ([heading, why, keys]) =>
    col({ gap: 0 }, [
      div({ fontWeight: 700, fontSize: 16, padding: "12px 0 4px" }, esc(heading)),
      note(why, { paddingBottom: 8 }),
      ...keys.map((k) => {
        const b = BROKERS[k]
        const on = k === selected
        const off = b.offered === false
        return row({ minHeight: 48, gap: 12, padding: "8px 12px", margin: "0 -12px", borderTop: `1px solid ${T.inkMuted}`, background: on ? T.ink : "transparent", color: on ? T.paper : off ? T.inkMuted : T.ink }, [
          div({ fontWeight: 700, fontSize: 17, width: 140, flexShrink: 0 }, esc(b.name)),
          div({ flex: 1, fontSize: 15, lineHeight: 1.4 }, esc(b.pickerLine)),
          off ? "" : div({ fontSize: 15, textAlign: "right", flexShrink: 0, ...NUM }, esc(b.costShort)),
        ])
      }),
    ])
  return col({ gap: 4, width: 520, flexShrink: 0 }, [h3("Which broker?"), ...GROUPS_BY_SIGN_IN.map(group)])
}
function kiteForm({ phone = false } = {}) {
  const k = BROKERS.kite
  return col({ gap: 20, flex: 1, minWidth: 0 }, [
    col({ gap: 8 }, [h3("Connect Zerodha"), body(k.formLede)]),
    steps(k.steps.map(esc)),
    field("Redirect URL", { value: "https://maester.example/api/v1/brokers/kite/return", copy: true, hint: "Paste this into your Kite Connect app." }),
    field("API key", { value: "", hint: "From your app’s page on Kite Connect." }),
    field("API secret", { value: "••••••••••••••••", password: true }),
    row({ gap: 16, flexWrap: "wrap" }, [button("Save and sign in with Zerodha"), button("Cancel", { variant: "outline" })]),
    note(k.saveNote),
  ])
}
function A2() {
  return appPage({
    content: [
      pageHead({ asOf: "Quantities from your brokers, valued at Friday’s NSE close (16 Oct)." }),
      col({ gap: 16 }, [
        h2("Add a broker"),
        row({ gap: 48, alignItems: "flex-start", borderTop: `2px solid ${T.ink}`, paddingTop: 20 }, [brokerPicker(), kiteForm()]),
      ]),
    ],
  })
}
function A3() {
  return appPhone({
    content: [
      pageHead({ phone: true, asOf: "Valued at Friday’s NSE close. Zerodha’s quantities are from Sunday." }),
      col({ gap: 12 }, [h2("Your accounts"), accountsLedger({ phone: true }), button("Add a broker", { variant: "outline", style: { alignSelf: "flex-start", fontSize: 16 } })]),
      strip(stripCells(STALE), { phone: true }),
      col({ gap: 12 }, [h2("Holdings"), combinedTable({ phone: true, staleKey: "kite" }), note("* Read Sunday 15:42, before Zerodha signed Maester out.")]),
    ],
  })
}

// ---------- B · Each account, its own ledger ----------
function accountBlock(key, { phone = false, state, stateLine, action, readAt }) {
  const acc = ACCOUNTS[key]
  const rows = combine([key])
  const sub = total(rows)
  const head = col({ gap: 6, paddingBottom: 12 }, [
    row({ justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }, [
      h3(`${acc.broker} · ${acc.id}`),
      div({ fontSize: 16, fontWeight: state === "out" ? 700 : 400 }, esc(stateLine)),
    ]),
    note(readAt),
  ])
  const table = phone
    ? ledger({
        label: `${acc.broker} holdings`,
        cols: [{ label: "Company", w: "minmax(0, 1fr)" }, { label: "Value", w: "auto", ...R }],
        rows: rows.map((r) => [col({ gap: 2 }, [bold(r.name), mutedCell(`${qty(r.q)} shares`)]), num(inr0(r.value))]),
        total: [bold(`${acc.broker} total`), num(inr0(sub))],
        rowPad: "12px 14px",
      })
    : ledger({
        label: `${acc.broker} holdings`,
        cols: [{ label: "Company", w: "minmax(0, 1.5fr)" }, { label: "Quantity", w: "100px", ...R }, { label: "Average cost", w: "140px", ...R }, { label: "Close", w: "120px", ...R }, { label: "Value", w: "140px", ...R }],
        rows: rows.map((r) => [bold(r.name), num(qty(r.q)), num(inr(Math.round(r.cost / r.q))), num(inr(CLOSES[r.name])), num(inr0(r.value))]),
        total: [bold(`${acc.broker} total`), "", "", "", num(inr0(sub))],
      })
  return el("section", { display: "flex", flexDirection: "column", gap: 12, borderTop: `2px solid ${T.ink}`, paddingTop: 16 }, [
    head,
    state === "out"
      ? notice({ title: "Zerodha signs Maester out every morning at 6:00.", lines: ["These are the quantities read on Sunday at 15:42. Sign in on Zerodha’s page to read today’s, and you come back here."], actions: [action] })
      : "",
    table,
  ])
}
function B1() {
  return appPage({
    content: [
      pageHead({ asOf: "Three accounts, valued at Friday’s NSE close (16 Oct).", action: button("Add a broker", { variant: "outline" }) }),
      strip([
        ["All accounts", inr0(VALUE), "Zerodha, Dhan and Groww together. Zerodha’s quantities are from Sunday."],
        ["Zerodha", inr0(total(combine(["kite"]))), "4 holdings · read Sun 15:42"],
        ["Dhan", inr0(total(combine(["dhan"]))), "3 holdings · read today 09:14"],
        ["Groww", inr0(total(combine(["groww"]))), "2 holdings · read today 09:14"],
      ]),
      accountBlock("kite", { state: "out", stateLine: "Signed out at 06:00", action: button("Sign in to Zerodha"), readAt: "Kite Connect · read Sunday 18 Oct, 15:42" }),
      accountBlock("dhan", { stateLine: "Connected", readAt: `DhanHQ · read today, 09:14 · ${BROKERS.dhan.expiryWords}` }),
      accountBlock("groww", { stateLine: "Connected", readAt: `Groww Trade API · read today, 09:14 · ${BROKERS.groww.expiryWords}` }),
      el("section", { display: "flex", flexDirection: "column", gap: 12, borderTop: `2px solid ${T.ink}`, paddingTop: 16 }, [
        h3("Infosys and HDFC Bank are held in two accounts"),
        body("All accounts together: HDFC Bank 150 shares (Zerodha 120, Dhan 30); Infosys 100 shares (Zerodha 80, Dhan 20)."),
      ]),
    ],
  })
}
function brokerSheet({ phone = false } = {}) {
  const keys = ["kite", "dhan", "groww", "upstox", "fyers", "fivepaisa", "icici", "angel", "kotak"]
  if (phone) {
    return col({ borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, keys.slice(0, 6).map((k, i) => {
      const b = BROKERS[k]
      return col({ gap: 4, padding: "12px 0", borderTop: i ? `1px solid ${T.inkMuted}` : "0" }, [
        row({ justifyContent: "space-between" }, [bold(b.name), div({ fontSize: 15, ...NUM }, esc(b.costShort))]),
        mutedCell(b.pickerLine),
      ])
    }))
  }
  return ledger({
    label: "Brokers Maester can read",
    cols: [{ label: "Broker", w: "150px" }, { label: "How you connect", w: "minmax(0, 1.6fr)" }, { label: "A sign-in lasts", w: "minmax(0, 1fr)" }, { label: "What it costs", w: "minmax(0, 1fr)" }, { label: "", w: "130px", ...R }],
    rows: keys.map((k) => {
      const b = BROKERS[k]
      const off = b.offered === false
      return [
        bold(b.name),
        div({ fontSize: 16, color: off ? T.inkMuted : T.ink }, esc(b.pickerLine)),
        div({ fontSize: 16, color: off ? T.inkMuted : T.ink }, esc(b.lasts)),
        div({ fontSize: 16, color: off ? T.inkMuted : T.ink }, esc(b.costLong)),
        off ? mutedCell("Not offered") : button("Connect", { variant: "outline", style: { fontSize: 16 } }),
      ]
    }),
  })
}
function B2() {
  return appPage({
    content: [
      col({ gap: 12 }, [appH1("Holdings"), body("Connect a broker and Maester reads what you hold there. It only reads: it can’t place an order or move money.")]),
      col({ gap: 12 }, [h2("Pick your first broker"), brokerSheet()]),
      note("Brokers marked not offered sign in only with your password and an authenticator code. Maester doesn’t keep either."),
    ],
  })
}
function B3() {
  return appPhone({
    content: [
      pageHead({ phone: true, asOf: "Three accounts, at Friday’s NSE close." }),
      strip([
        ["All accounts", inr0(VALUE), "Zerodha’s quantities are from Sunday."],
        ["Zerodha", inr0(total(combine(["kite"]))), "read Sun 15:42"],
      ], { phone: true }),
      accountBlock("kite", { phone: true, state: "out", stateLine: "Signed out at 06:00", action: button("Sign in to Zerodha", { style: { fontSize: 16 } }), readAt: "Read Sunday 18 Oct, 15:42" }),
    ],
  })
}

// ---------- C · The depository's statement first ----------
// The CAS for 30 Sep 2026: every demat, every broker. Since then: Dhan bought 10 HDFC Bank on 7 Oct.
const CAS = { "HDFC Bank": 140, Infosys: 100, ITC: 550, "Larsen & Toubro": 25, "Asian Paints": 40, Titan: 15 }
function casTable({ phone = false } = {}) {
  const rows = ROWS.map((r) => {
    const cas = CAS[r.name]
    const viaApi = r.at.filter(([k]) => k !== "groww")
    const apiQ = viaApi.reduce((s, [, q]) => s + q, 0)
    const groww = r.at.find(([k]) => k === "groww")
    let today
    let words
    if (!viaApi.length) { today = "—"; words = "Groww isn’t connected; the statement is the latest" }
    else if (groww) { today = qty(apiQ); words = `Zerodha’s ${qty(apiQ)}, and Groww’s ${qty(groww[1])} from the statement` }
    else { today = qty(apiQ); words = apiQ === cas ? "Same" : `${qty(apiQ - cas)} more since the statement` }
    return { r, cas, today, words, differs: words.includes("more") }
  })
  if (phone) {
    return ledger({
      label: "Holdings",
      cols: [{ label: "Company", w: "minmax(0, 1fr)" }, { label: "Shares", w: "auto", ...R }],
      rows: rows.map(({ r, cas, words, differs }) => [col({ gap: 2 }, [bold(r.name), div({ fontSize: 14, lineHeight: 1.45, color: differs ? T.ink : T.inkMuted, fontWeight: differs ? 700 : 400 }, esc(words))]), num(qty(r.q))]),
      rowPad: "12px 14px",
    })
  }
  return ledger({
    label: "Holdings",
    cols: [{ label: "Company", w: "minmax(0, 1.2fr)" }, { label: "Statement, 30 Sep", w: "150px", ...R }, { label: "Brokers, today", w: "150px", ...R }, { label: "What changed", w: "minmax(0, 1.6fr)" }, { label: "Value", w: "130px", ...R }],
    rows: rows.map(({ r, cas, today, words, differs }) => [bold(r.name), num(qty(cas)), num(today), div({ fontSize: 16, fontWeight: differs ? 700 : 400 }, esc(words)), num(inr0(r.value))]),
    total: [bold("Total"), "", "", "", num(inr0(VALUE))],
  })
}
function sources({ phone = false } = {}) {
  const items = [
    ["CDSL statement", "Every demat account, as of 30 Sep. Arrives by email in a month you trade; add it in Documents.", "Read 12 Oct"],
    ["Zerodha", "Today’s quantities, between statements.", "Signed out at 06:00"],
    ["Dhan", "Today’s quantities, between statements.", "Read today, 09:14"],
    ["Groww", "Not connected. Its holdings come from the statement.", "—"],
  ]
  return el("dl", { margin: 0, borderTop: `2px solid ${T.ink}`, borderBottom: `2px solid ${T.ink}` }, items.map(([t, d, s], i) =>
    div({ display: "grid", gridTemplateColumns: phone ? "1fr" : "200px minmax(0, 1fr) 200px", gap: phone ? 4 : 16, padding: "12px 0", borderTop: i ? `1px solid ${T.inkMuted}` : "0", alignItems: "baseline" }, [
      el("dt", { fontWeight: 700, fontSize: 16 }, esc(t)),
      el("dd", { margin: 0, fontSize: 16, lineHeight: 1.45 }, esc(d)),
      el("dd", { margin: 0, fontSize: 16, textAlign: phone ? "left" : "right", fontWeight: s.startsWith("Signed") ? 700 : 400 }, esc(s)),
    ])))
}
function C1() {
  return appPage({
    content: [
      pageHead({ asOf: "Every demat account, from your CDSL statement for September, with today’s quantities from the brokers you’ve connected. Valued at Friday’s NSE close.", action: button("Add September’s statement", { variant: "outline" }) }),
      col({ gap: 12 }, [h2("Where the quantities come from"), sources()]),
      col({ gap: 12 }, [
        h2("Holdings"),
        casTable(),
        note("Zerodha’s quantities are from Sunday, 15:42. Where a broker and the statement differ, the broker’s is newer and is the one counted; the difference is said in words, never hidden."),
      ]),
    ],
  })
}
function C2() {
  return appPage({
    content: [
      col({ gap: 12 }, [appH1("Holdings"), body("Two ways in. Start with the statement: it lists every share in every demat account you have, from the depository itself.")]),
      el("section", { display: "flex", flexDirection: "column", gap: 16, borderTop: `2px solid ${T.ink}`, paddingTop: 16 }, [
        row({ gap: 12, alignItems: "baseline" }, [div({ fontWeight: 700, fontSize: 22, ...NUM }, "1"), h3("Add your monthly statement")]),
        body("CDSL or NSDL emails a consolidated account statement each month. It’s a PDF locked with your PAN."),
        div({ border: `2px dashed ${T.ink}`, padding: "28px 24px", display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }, [
          strong("Drop the statement here"), muted("or", { fontSize: 16 }), button("Choose a file", { variant: "outline" }), note("PDF, up to 50 MB. Maester asks for the PAN once to open it, and doesn’t keep it."),
        ]),
      ]),
      el("section", { display: "flex", flexDirection: "column", gap: 16, borderTop: `2px solid ${T.ink}`, paddingTop: 16 }, [
        row({ gap: 12, alignItems: "baseline" }, [div({ fontWeight: 700, fontSize: 22, ...NUM }, "2"), h3("Connect a broker for today’s quantities")]),
        body("Optional. Between statements, a connected broker says what changed since."),
        row({ gap: 12, flexWrap: "wrap" }, ["Zerodha", "Dhan", "Groww", "Upstox", "Fyers", "More brokers"].map((n) => button(n, { variant: "outline", style: { fontSize: 16 } }))),
      ]),
    ],
  })
}
function C3() {
  return appPhone({
    content: [
      pageHead({ phone: true, asOf: "From your CDSL statement for September, with today’s quantities from Zerodha and Dhan." }),
      col({ gap: 12 }, [h2("Where they come from"), sources({ phone: true })]),
      col({ gap: 12 }, [h2("Holdings"), casTable({ phone: true })]),
    ],
  })
}

// ---------- Shared: the connect round trip, in every direction ----------
function stateCard(caption, children) {
  return col({ gap: 12, flex: 1, minWidth: 0 }, [muted(caption, { fontSize: 14 }), col({ gap: 12, border: `2px solid ${T.ink}`, padding: 20, minHeight: 260 }, children)])
}
function rulerDraw() {
  return div({ position: "relative", height: 8, borderTop: `2px solid ${T.ink}`, marginTop: 8 }, div({ position: "absolute", left: "37.5%", top: -4, width: "12.5%", height: 6, background: T.ink }))
}
function S1() {
  return appPage({
    content: [
      col({ gap: 8 }, [h2("Connecting a broker: the states every direction owes"), note("Drawn for Zerodha; the others differ only in what they ask for (see the broker sheet).")]),
      row({ gap: 20, alignItems: "stretch" }, [
        stateCard("1 · Back from Zerodha, reading", [strong("Signed in to Zerodha."), body("Reading your holdings…"), rulerDraw(), note("Nothing to do here; this takes a few seconds.")]),
        stateCard("2 · Done", [strong("Zerodha connected. 4 holdings read."), body("Zerodha signs Maester out each morning at 6:00. Holdings stay as they were last read until you sign in again."), aLink("See your holdings")]),
        stateCard("3 · Zerodha refused", [strong("Zerodha didn’t accept the API key."), body("Check that the key and the secret are from the same Kite Connect app, and that its redirect URL is the one Maester gave you."), button("Try again", { variant: "outline", style: { alignSelf: "flex-start" } })]),
        stateCard("4 · Disconnect asks first", [strong("Disconnect Zerodha?"), body("Maester forgets the key and the secret. The holdings it read stay, marked as read on Sunday 18 Oct."), row({ gap: 12, flexWrap: "wrap" }, [button("Disconnect"), button("Keep it", { variant: "outline" })])]),
      ]),
      col({ gap: 12 }, [h2("Kept once connected"), spec([
        ["API key", esc("Ending 7q2x. Saved 19 Oct.")],
        ["Signed in", esc("Today, 09:12. Zerodha signs Maester out at 6:00 tomorrow.")],
        ["Last read", esc("Today, 09:12 · 4 holdings")],
        ["Can it trade?", esc("No. Maester asks Zerodha only for holdings and positions.")],
      ], { termW: 180 })]),
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

const D = 1440, P = 390
const FRAMES = [
  { id: "Main.dc.html", title: "Today 1 · Holdings is a coming-soon page", w: D, h: 900, render: T1, row: 0 },
  { id: "T2.dc.html", title: "Today 2 · Settings connects Dhan for closes only", w: D, h: 900, render: T2, row: 0 },
  { id: "A1.dc.html", title: "A1 · Accounts, then one table — Zerodha signed out this morning", w: D, h: 900, render: A1, row: 1 },
  { id: "A2.dc.html", title: "A2 · Accounts, then one table — Add a broker: pick, then Zerodha’s form", w: D, h: 900, render: A2, row: 1 },
  { id: "A3.dc.html", title: "A3 · Accounts, then one table — phone 390", w: P, h: 844, render: A3, row: 1, phone: true },
  { id: "B1.dc.html", title: "B1 · Each account, its own ledger — three brokers, one signed out", w: D, h: 900, render: B1, row: 2 },
  { id: "B2.dc.html", title: "B2 · Each account, its own ledger — empty: the broker sheet", w: D, h: 900, render: B2, row: 2 },
  { id: "B3.dc.html", title: "B3 · Each account, its own ledger — phone 390", w: P, h: 844, render: B3, row: 2, phone: true },
  { id: "C1.dc.html", title: "C1 · The statement first — September’s CAS, brokers for since", w: D, h: 900, render: C1, row: 3 },
  { id: "C2.dc.html", title: "C2 · The statement first — empty: two ways in", w: D, h: 900, render: C2, row: 3 },
  { id: "C3.dc.html", title: "C3 · The statement first — phone 390", w: P, h: 844, render: C3, row: 3, phone: true },
  { id: "S1.dc.html", title: "Shared · Connecting a broker: reading, done, refused, disconnect", w: D, h: 900, render: S1, row: 4 },
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
const NOTES = JSON.parse(fs.readFileSync(path.join(HERE, "holdings-notes.json"), "utf8"))
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
  boards[f.id] = { x, y: rowY[f.row], w: f.w, h: f.h, title: f.title, page: "round1" }
  colX[f.row] = x + f.w + 80
}
NOTES.rows.forEach((n, i) => {
  const r = rows[i]
  notes[`r1Title${i}`] = { kind: "title1", text: n.title, x: 0, y: rowY[r] - 260, maxW: colX[r], page: "round1" }
  notes[`r1Note${i}`] = { text: n.note, x: 0, y: rowY[r], w: 600, maxH: Math.min(1600, rowH[r]), size: "l", color: n.color || (i === 0 ? "red" : "orange"), page: "round1" }
})
const right = Math.max(...Object.values(colX))
notes.r1Constraint = { text: NOTES.constraint, x: right + 80, y: 0, w: 700, maxH: 400, size: "l", color: "red", page: "round1" }
notes.r1Questions = { text: NOTES.questions, x: right + 80, y: 460, w: 700, maxH: 900, size: "l", color: "blue", page: "round1" }
notes.r1Shared = { text: NOTES.shared, x: right + 80, y: rowY[1], w: 700, maxH: 1400, size: "m", color: "green", page: "round1" }
notes.r1Sheet = { text: NOTES.sheet, x: right + 80, y: rowY[2], w: 700, maxH: 1600, size: "m", color: "yellow", page: "round1" }
const canvas = {
  v: 3,
  createdOnFiles: { v: 1, at: "2026-10-19T10:00:00Z" },
  title: "Maester Broker Connections",
  launch: { view: "canvas", page: "round1" },
  pages: [{ id: "round1", name: "Round 1" }],
  boards,
  order: FRAMES.map((f) => f.id),
  notes,
  designSystems: [],
}
fs.writeFileSync(path.join(OUT, "project", "canvas.json"), JSON.stringify(canvas, null, 2))
console.log("built", FRAMES.length, "frames", FRAMES.map((f) => f.id + ":" + f.h).join(" "))
