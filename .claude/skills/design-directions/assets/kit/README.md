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
