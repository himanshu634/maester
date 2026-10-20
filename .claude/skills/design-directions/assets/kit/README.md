# Maester frame kit

The design-directions kit for Maester, built for the Terminal Overview canvas
(2026-10-02). See `references/canvas.md` §3 for what a kit is and how rounds reuse it.

- `lib.mjs`: tokens copied from `apps/web/src/lib/styles/tokens.css` (ink, paper,
  muted ink; illustration inks kept apart), the type roles from `docs/DESIGN.md` §3,
  the terminal shell from `docs/UI_SPECIFICATION.md` §2 (224px rail, 56px context
  header) at 1440 and 390, the public masthead, and the pieces: button, link, tag,
  ledger, spec list, ink bars, weight bar, inverted panel.
- `build.mjs` and `notes.json` are this round's frames (Today plus A–D), examples of
  the pattern rather than a fixed catalogue. A later round replaces them.
- `heights.json`: measured frame heights fed back into `build.mjs`.
- `errors.mjs` and `errors-notes.json`: the Error Screens canvas (2026-10-03, Today plus
  A–D plus shared states; C · The sketchbook was built). It adds interactive boards (a
  DCLogic class per board with event holes, and twins that render the default state via
  `twinize`), the public masthead with the register rail, the terminal shell as built
  (`TerminalShell.svelte`) and the two-plate sketches. Run `node errors.mjs`.

Run `node build.mjs --measure`, open `../canvas/twins/measure.html` over a local
server, run `await measureAll()`, save the result as `heights.json`, then
`node build.mjs heights.json`. Output lands in `../canvas/project/` (artboards and
`canvas.json`) and `../canvas/twins/` (contact sheet and measure page).
`../canvas/` is generated output: `assets/.gitignore` ignores it, so it is never
committed. Publish the canvas from it; commit only the kit.

## Sign-in round (2026-10-02)

`signin.mjs`, `signin-notes.json` and `signin-heights.json` built round 2 of the
"Maester Sign-in" canvas (https://claude.ai/artifact/VZmn6QA8rBpLuMJ4bWXY1r):
Today, A · Google first (picked), B · Two doors, C · Email first, and the shared
states and pages. They add the Google button, the password field with Show, the
or rule and the notice. The sign-in illustration SVG and the round-1 boards are
read from `../prev/Main.dc.html` and `../prev/Mobile.dc.html`: save them there
from the published canvas first (`project/Main.dc.html`, `project/Mobile.dc.html`).
Run `node signin.mjs signin-heights.json`.

## Terminal pages round (2026-10-05)

`documents.mjs`, `documents-notes.json` and `documents-heights.json` built round 1 of the
"Maester Terminal Pages" canvas (https://claude.ai/artifact/DZZwTXu6q7c68hfL8MSaJC):
Today, A · Every page has a door, B · The intake desk (picked), C · Blueprints, and the
shared upload states. They add the full signed-in rail with "Soon", coming-soon pages
with the crate, crane (interactive) and blueprint sketches, the drop zone, the stage
ladder, the intake slip and the cover-page evidence view.
Run `node documents.mjs --measure`, measure, then `node documents.mjs documents-heights.json`.

## Market mood round (2026-10-06)

The "Maester Market Mood" canvas (https://claude.ai/artifact/Sa34MqzWhGqUZbPxTKNhZ5) holds
round 1 (A · One number, opened up, B · Readings, no verdict, C · Before the open, D · Where it
meets your portfolio), the picked "A+B · final" frames F1–F4, and the Settings rounds: G · One
form (picked), H · Connections ledger, J · Fix it where it breaks, and "Settings · G final"
frames K1–K3. Its generator (`mood.mjs`, `mood-notes.json`, `mood-heights.json`) lived only in
that session's scratchpad and was lost when the scratchpad was cleared, so it is not here. The
published canvas is the durable copy: read a frame's source with the Artifact tool
(`project/F1.dc.html` and so on) and build the next round from it. The built pages are
`apps/web/src/lib/components/market-mood/` and `components/settings/`.

## Financial tables round (2026-10-13)

`financials.mjs`, `financials-notes.json` and `financials-heights.json` built round 1 of the
"Maester Financial Tables" canvas (https://claude.ai/artifact/YHy12h78LC5WUBwNynizXQ): Today,
A · The filing, opened, B · The company's years, C · The page beside the figures, D · Sums you
can open. They add the signed-in rail with Market mood and Settings live, a synthetic company
whose statements add up (Synthetic Cements Limited, three annual reports, one restatement, one
misread total), the statement ledger with a selected figure, the figure panel, the three status
axes, the toggles, a rendered PDF page and the openable sums.
Run `node financials.mjs --measure`, measure, then `node financials.mjs financials-heights.json`.

## Ingestion screens round (2026-10-19)

`ingestion.mjs`, `ingestion-notes.json` and `ingestion-heights.json` built round 1 of the
"Maester Ingestion Screens" canvas (https://claude.ai/artifact/AhK6e5k9RMQvTBogXeibng): the
Documents screen and the figure panel under the ingestion pipeline (spec
`docs/superpowers/specs/2026-10-19-ingestion-pipeline-design.md` §6, §11, §12). Today, a shared
words board, A · Two tracks on the slip, B · The work list, C · Filings, not files
(recommended), D · Two lines of work. They add the multi-file drop strip with its sending and
sent states, the batch refusal summary, two-track ladders, company-once confirmation and the
XBRL figure panel variants. Output goes to `../canvas/ingestion/` (ignored). Run
`node ingestion.mjs --measure`, measure, then `node ingestion.mjs ingestion-heights.json`.
