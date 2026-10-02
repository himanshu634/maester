# The canvas: seeing the page, drawing the frames, adding rounds

Read this when you are about to take screenshots or build/extend the canvas (steps 2, 4 and 6 of the skill). Building the canvas is where most of a round's time goes; the kit and the notes below exist to cut that.

## Contents

1. Seeing the real pages (SvelteKit dev server)
2. Starting the canvas — and where the type's rules override this skill
3. The frame kit — built in the first round
4. Measuring, so heights and length claims are true
5. Checking your frames before publishing
6. Rounds and finals on the same canvas
7. When the scratchpad is gone

## 1. Seeing the real pages

The point is the **anatomy** of the live pages — copy it, don't approximate it from DESIGN.md. If the user sent screenshots, use them; they beat anything you can render.

| Server | Port | `.claude/launch.json` entry | Use |
| --- | --- | --- | --- |
| `vite dev` | 5173 | `web-dev` | design rounds — HMR, every route |
| `vite preview` | 4173 | `web-preview` | the static build as it ships (run `pnpm --dir apps/web build` first) |

- **Commands are pnpm, never Make.** `apps/web` is a standalone pnpm project with its own lockfile; a root `pnpm install` does not install it — run `pnpm --dir apps/web install` if `node_modules` is missing.
- **Design rounds look at the current branch as it is.** Before trusting the page, check what the main checkout has checked out (`git status -sb`) — another session may have it on a feature branch — and say so if the page you saw is not `staging`.
- **From a worktree** (step 7, holding the build against the frame), `preview_start {name}` still runs the server from the **main checkout**. Start `pnpm --dir <worktree>/apps/web dev --port 5174 --strictPort` in the background instead, confirm its log names the worktree directory, and open it by URL. Check a port is free first (`lsof -iTCP:<port> -sTCP:LISTEN`); never kill a server you didn't start.
- **Signing in.** There is no session yet: `/terminal` always hands off to `/login`, and the login form is not connected until the workspace-identity feature lands (`apps/web/src/lib/session.ts`). Once it is, the user signs in themselves in the Browser pane; never type a password for them.
- **Frame size**: `resize_window {preset: "mobile"}` gives 375 wide — frames are drawn at 390, note the difference — and a custom 360 × 780 checks the floor. Desktop frames at 1440. The pane may follow the app theme; maester has one theme, so draw it as it is.
- The Browser pane may be hidden: `computer` clicks can time out there, but `javascript_tool` clicks, `read_page` refs and `screenshot` work.
- Pages worth having for almost any brief: the page being redesigned, the one before and after it in the flow (`/` → `/login` → `/terminal`), and whichever page shares its anatomy (a ledger on the index ↔ a ledger in an app page).

## 2. Starting the canvas

Use the Artifact tool — it is the first call when making a new canvas:

1. `Artifact {action: "quickstart", intent: "design"}` — returns the Design canvas type and any design systems on the account. Maester's tokens come from `apps/web/src/lib/styles/tokens.css` and `docs/DESIGN.md`, not from an account design system, unless the user says otherwise — pass `design_systems: false`.
2. Publish with that `type_url`, a `title`, no files, `auto_open: "after_first_write"`. The create result carries the type's own instructions.
3. Fill it by publishing your data files (`project/*.dc.html` + `project/canvas.json`) to the returned `url`.

Title: what it is, two to four words — "Maester Holdings Page", "Evidence Review · Directions". For a continuation, update the existing canvas by its `url` (read it first) instead of creating a second one. The index-page and sign-in canvases are listed in memory.

**The type's instructions win over this file.** They arrive as several thousand tokens at the moment you want to draw; this is how this skill's needs mapped onto them when the skill was written — re-check against the live text:

| This skill wants | The type says | So |
| --- | --- | --- |
| a caption per frame: letter, name, state | each board's name strip shows its `title` | the caption **is** `boards[file].title` — "B2 · One ledger — empty" |
| the diagnosis, shared fixes, each direction's cost, questions | notes never go inside an artboard | `canvas.json` `notes`: one sticky per row beside its frames, a `kind: "title1"` heading above the row, one sticky for questions |
| a phone frame | no fake status bars | the phone frame has none |
| you look at your frames before the user does | don't read back, render or open the published artifact | review local copies (§5); the published canvas is not re-opened |

Also from the type: the first artboard is `Main.dc.html`; a board's root element is exactly the board's `w`×`h`, which also equals `$preview`; keep the `support.js` script line verbatim; inline styles (the properties panel edits those); no `<iframe>`; network is Google Fonts `css2` only — load Archivo with its width axis (`family=Archivo:wdth,wght@62..125,100..900`), and Caveat only for a frame that draws an illustration; real `<button>`s, with an `aria-label` on icon-only ones.

## 3. The frame kit — built in the first round

Hand-written frames drift apart; generated ones stay consistent and make round 2 a ten-minute job. There is no maester kit yet. The first round builds one in the session scratchpad and the build PR commits it to `.claude/skills/design-directions/assets/kit/`. Later rounds copy it from there, check it still matches `tokens.css`, and extend it.

What to build — two files, both plain Node ESM with no dependencies:

- `lib.mjs`:
  - **Tokens** copied from `apps/web/src/lib/styles/tokens.css` with a header comment naming the file and date: `--paper`, `--ink`, `--ink-muted`, `--paper-muted`, and `--illus-*` kept in a separate object so nothing but an illustration can reach them. No other colour exists; a helper that takes an arbitrary colour is a bug.
  - **Type**: Archivo, with the role table from DESIGN.md §3 (display at 125% width / 800, section heading 110% / 700, body 17px / 1.5, table 14–16px), `font-variant-numeric: tabular-nums slashed-zero` for figures. Resolve the display `clamp()` to a fixed px per frame width.
  - **Shells**: the public page (masthead, 224px register rail from 1024px, 48px gutters, 1440 cap, footer) and the app shell from UI_SPECIFICATION §2 (224px rail, 56px context header, 24px gutters) at desktop; the folded versions at 390 (rail above content, 24px gutters). A shell takes a height, or `null` for `height: auto` when measuring (§4).
  - **Pieces** copied from `apps/web/src/lib/components/` and DESIGN.md §5 as the round needs them: button (filled / outline, 44px, 2px border), underlined link, ledger (2px box, 2px header rule, 1px row hairlines, right-aligned tabular figures), spec list, tag, form field, inverted panel, the "Synthetic example" label. Build only what this round needs; the kit grows by round.
  - **Wrappers** that write a `.dc.html` board and a local "twin" HTML file per frame.
  - `css(obj)` and `el(tag, style, children)` helpers — everything is inline styles, because the canvas's properties panel edits those.
- `build.mjs` — the frame list (id, title, board size, render function), the two-pass build (§4), `twins/measure.html` with a `measureAll()` that waits for `document.fonts.ready`, `twins/sheet.html` (the contact sheet, §5), and the `canvas.json` layout: one row per direction, a `title1` heading and a sticky beside each row.

A worked kit lives in the bull-crm repo (`~/bull/bull-crm/.claude/skills/design-directions/assets/kit/` — `lib.mjs`, `build.mjs`, `README.md`). Use it for the **machinery only**: `css`/`el`/`esc` helpers, `dcHtml`/`twinHtml` wrappers, the two-pass build, the measure page, the contact sheet and the canvas layout. Replace every token, font, shell and piece — it draws a shadcn admin console with radius, shadows and a green accent, everything maester forbids.

**Calibrate before drawing directions**: build the Today frame first and compare it with the running page (§4). If the twin is off by more than a few points, fix the kit — every length claim on the canvas depends on it.

## 4. Measuring

Two reasons to measure. A **full-length board needs its height before it can be written** (the root must equal the board's `h`), so the build is two-pass: build → measure → rebuild with `heights.json`. And claims like "2.1 screens instead of 4.2" are what let the user choose — so they have to be true.

- Serve the scratchpad folder on localhost (`python3 -m http.server <port>`), open `twins/measure.html`, run `await measureAll()` with `javascript_tool`, save the result as `heights.json`, run `node build.mjs heights.json`. One call measures every frame.
- The measuring twin renders the shell at `height: auto`. A fixed-height frame with a `flex: 1` body reports the frame, not the content.
- A box with `overflow: hidden` inside a flex column **shrinks** unless it has `flex-shrink: 0` — you get squashed ledgers and a short, wrong number.
- Wait for `document.fonts.ready` — Archivo's width axis changes every height.
- **Calibrate against Today**: measure your Today twin and the running page's `document.scrollingElement.scrollHeight`. If they agree within a few points, the other numbers on the canvas can be trusted.
- Screens = height ÷ 844 (phone) or ÷ 900 (desktop). Put the number in the row's sticky and the chat summary. For a "fits one screen" claim, check it, don't assume it.

## 5. Checking your frames before publishing

Open `twins/sheet.html` — every board at its real size — and look for what the user would see first: text wrapping or truncating, a primary action pushed off the frame, a ledger wider than its frame, two primary actions on one screen, a figure without its "Synthetic example" label, a count that contradicts the rows beside it, any colour that isn't ink, paper or muted ink, a public page that mentions technology. Apply `design:design-critique` to this sheet.

The published canvas itself is not re-opened (the type asks for that). So the canvas _layout_ — whether a long sticky fits its `maxH`, whether notes overlap boards — is computed, not seen. Keep stickies short, and tell the user the layout is unverified if you had to guess. Desktop boards are wide; lay rows out so a 1440 board and its sticky don't collide.

## 6. Rounds and finals

- A new round is a **new page that opens first**; earlier rounds move behind it, untouched. Name pages for what they are: "Round 2 · One page".
- A pick with changes becomes **the final** on page 1 (same letter, e.g. "J · final"); the explored alternatives stay on later pages. The build is held against this page.
- Build the round by loading the published canvas state and appending, not by regenerating everything — that is how earlier rounds survive exactly as the user saw them.

## 7. When the scratchpad is gone

Scratchpads are per-session and get wiped. Once a kit is committed, `assets/kit/` gets you the shells back at once; the published artifact is the durable copy of the frames themselves (`Artifact {action: "read", url}` and its files listing). Record in the memory file which canvas a round lives on and what you added to the kit — and, until the kit is committed, that it lives only in that session's scratchpad.
