---
name: design-directions
description: Mockups-first design workflow for Maester's web app (`apps/web`, SvelteKit) — grounds the request in the running page and `docs/DESIGN.md`, pulls in the design skills (`frontend-design`, `ui-ux-pro-max`, the `design:*` plugin skills, plus `web-design-guidelines`, `dataviz` and others as the brief needs), draws 3–4 named directions (A/B/C/D) on one design canvas for the user to review, then reads the reply — a pick gets built, feedback gets a new round. Use whenever the user asks to design, redesign, mock up, restyle or "improve the UI/UX of" a page, section, flow, component or state; says a page is cluttered, confusing, generic, ugly or "not intuitive"; sends a screenshot and asks for something better; asks for "options", "directions", "variations" or "mockups"; or replies to an earlier canvas ("go with B", "I like J but…", "redo these"). Use it even when they don't say "mockup" — in this repo a design request means mockups before code. Not for a change the user has already specified exactly (just make it), a site-wide polish pass with no choice to make (`redesign-existing-projects`), a UI code audit (`web-design-guidelines`), or clickable in-code variants (`prototype`).
---

# Design directions: mockups first, then the pick, then the build

The user decides design by looking, not by reading a plan. A design request goes well when it follows one loop: look at the real page → draw a few genuinely different answers on one canvas → the user picks, mixes or pushes back → only then code. It goes badly when a step is skipped: frames drawn from tokens instead of the running page read as "generic"; a redesign that hides information costs rounds before the real constraint surfaces. This skill is that loop. It was ported from the Koshi and bull-crm repos, where it was worked out; the lessons carry over, the app details do not.

```
brief → ground in the running page + DESIGN.md → load the design skills → 3–4 directions on a canvas
      → present + STOP → read the reply ─┬─ pick / mix      → plan → worktree → build → PR when asked
                                          └─ feedback / no   → next round on the same canvas
```

Nothing under `apps/web/` changes before a pick. The canvas is cheap to throw away; a half-built page in the wrong direction is not.

## 1. Frame the brief

Work out, in two or three lines, what you are designing: the page or flow (route and file path), **which kind of surface** it is, who uses it and what they are trying to get done there, and what is wrong today in the user's words. This say-back is not its own message — it becomes the first line of the step 5 summary. Don't stop after this step unless a question blocks the drawing.

The kind of surface decides a lot:

| Surface | Routes today | Who | Rules that bind it |
| --- | --- | --- | --- |
| Public pages | `/` (index), `/login` | an investor deciding whether Maester is worth their time | `docs/DESIGN.md` §7: market the product, not the tech — no model names, frameworks, commands, file paths or feature IDs; every mock figure labelled "Synthetic example" |
| App pages | `/terminal` today; the routes in `docs/UI_SPECIFICATION.md` §2 (Overview, Holdings, Research, Documents, Evidence review, Analyst…) as they ship | a signed-in investor doing research or portfolio work | `docs/UI_SPECIFICATION.md` (shell: 224px rail, 56px context header, per-page sections and required states) under `docs/DESIGN.md`'s visual system |

Frames: desktop **1440 × 900**, phone **390 × 844** (the existing canvases use these). Check that the idea still holds at **360** wide — DESIGN.md §8 requires meaningful content there.

Before anything else, check whether the user has already decided something about this page — an earlier decision binds round 1 exactly as a rejected round would:

- **Memory** — maester records canvases as `maester-<topic>-canvas.md` or `maester-<topic>-mockup-artifact.md` (the index page and sign-in page each have one). A record for the same area means there is already a canvas, possibly an approved one, and rejected ideas. Continue that canvas; never restart from A.
- **The repo** — `docs/DESIGN.md` (the binding visual contract), `docs/decisions/0002-web-sveltekit-brutalist-design-system.md`, `docs/UI_SPECIFICATION.md` for the page's section, `docs/PRD.md` for who it serves, and the header comments of the page and its components for choices made on purpose.
- **`gh pr list --state all --search "<keywords>"`** — another session may have built it already.

Ask only what you cannot infer and what changes the drawing. A garbled or dictated prompt that names no page is a question to confirm, not a task to guess at.

## 2. Ground it in the real page

Start the dev server first (`preview_start {name: "web-dev"}` — `references/canvas.md` §1), and read while it does: `docs/DESIGN.md` end to end, `apps/web/src/lib/styles/tokens.css` and `apps/web/src/app.css`, `apps/web/src/lib/styles/design-guard.test.ts` (what the build will refuse), the page's `+page.svelte` and the `apps/web/src/lib/components/` pieces it composes, and the content it renders from `apps/web/src/lib/content/`.

Then **look at the page running**. Frames are drawn from the page's real anatomy — the masthead, the 224px register rail, 2px rules, ledgers, spec lists, inverted panels, the footer — because that is what reads as "ours"; a frame that only gets `#EDEDE8` and `#000` right still looks like a template. If the user sent screenshots, those are the ground truth for "today".

**An app page that doesn't exist yet** has no Today to look at. Then Today is: the `/terminal` page and masthead as they run, plus the page's section of `UI_SPECIFICATION.md` (its required states and component contracts). Say so on the canvas.

Finish with a **diagnosis you can measure**, because "cleaner" and "plain" are not briefs. Pick the measures that fit the complaint:

- _Too much_ (cluttered, overloaded): how many screen-heights it scrolls (phone 844, desktop 900), how many blocks compete at one volume, how many columns a ledger shows versus how many the reader uses, what is said more than once, what overflows or wraps at 360.
- _Too little_ (plain, "they won't know what to do"): whether there is one primary action and whether it says what happens, how many clicks the main job takes, whether a figure shows where it came from and whether it was checked (the product's own rule), how many page changes a task that should be one surface needs.

The diagnosis becomes the **Today** frame on the canvas and the yardstick every direction is compared against ("3 page changes → 1", "4.2 screens → 2.1"). A direction may make something longer; say so rather than hiding it.

## 3. Load the design skills

Invoke these with the Skill tool — don't work from memory of them, they change. Use what the brief needs; the first three are the default set for any new-page or redesign request.

| Skill | What it is for here |
| --- | --- |
| `frontend-design` | The point of view: one idea per direction, one signature moment, copy as design material, the self-critique pass. The palette and type are **fixed** — three colours, Archivo only, zero radius, no shadows, hard-inversion hover — so spend the boldness on **structure, hierarchy, type scale and width axis, the key moment and density**, never on a new colour, face or decoration. |
| `ui-ux-pro-max` | Evidence for the choices: query the UX outcome you need (`--domain ux`), then `--stack svelte`. Its palette and font recommendations do not apply — `docs/DESIGN.md` wins every disagreement. Two or three queries; if it returns generic advice, say so and move on. Its docs use `${CLAUDE_PLUGIN_ROOT}`, which is empty here — run from the repo root: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain ux` (or `--stack svelte`). |
| `design:design-critique` | Load it once, apply its framework twice: on **Today** (sharpens the diagnosis) and on your own draft frames before you publish them. |
| `design:ux-copy` | Labels, empty states, errors, confirmations — in DESIGN.md §7's voice: sentence case, plain verbs, a button says what happens. |
| `design:accessibility-review` | Contrast, 44px targets, keyboard paths and focus, state that is more than colour (here colour can't carry state at all) — whenever a direction introduces a new control or an inverted panel. |
| `design:design-system` | When a direction needs a component DESIGN.md §5 doesn't have — decide whether it extends Button, Ledger, Spec list, Tag or Form field before inventing one. |
| `web-design-guidelines` | Review the Today code for guideline breaks worth fixing in every direction. |
| `dataviz` | A direction with a chart, stat, meter or performance figure. Ink and paper only; direction shown by sign or word, never colour (DESIGN.md §2). |
| `prototype` | When the choice can only be made by clicking — several variants on one route instead of a static canvas. |
| `design:user-research`, `design:research-synthesis` | When the user brings investor interviews or feedback as the reason for the redesign. |
| `product-management:product-brainstorming` | The problem itself is unclear and drawing would be premature. |

If a skill named here isn't in this session's list, carry on without it and say which one was missing — don't stall. The table is a starting set, not a fence.

## 4. Draw 3–4 directions

**Different ideas, not different paint.** Each direction answers the diagnosis with a different structural bet — what comes first, what sits in the rail, what becomes a ledger, what moves to its own page, what is inverted, what the table shows. In this system there is almost no paint to vary, which helps: if two directions differ only in rule weight or type size, they are one direction; merge them and find another idea. Three strong directions beat four where one is filler.

- **Letter + name, and they stay stable**: "A · Evidence first", "B · One ledger". The user replies with letters, memory records them, PRs cite them. A new round continues the alphabet (round 2 is E–H; skip I and O, they read as digits) — a letter is never reused for a different idea.
- **Show the states that decide it**, not one happy frame: the landing, the key interaction, and the edge that breaks weak designs — empty, loading, failure, partial, a 40-row ledger, a long company name, unknown shown as unknown (never zero), the 360 phone. `UI_SPECIFICATION.md` §14 lists the states app pages owe. Two or three frames per direction is typical.
- **Real content**: synthetic companies, filings and holdings with internally consistent numbers, every figure labelled "Synthetic example". Public-page copy sells what Maester does for the investor and the time it gives back — no technology.
- **DESIGN.md holds in a mockup too**: `--paper`, `--ink`, `--ink-muted` only (`--illus-*` only inside an illustration); Archivo only, nothing below 14px, sentence case; 2px and 1px rules as the only separators; no cards, radius or shadows; left-aligned; underlined links; one primary action per screen; at most one non-user-triggered motion per page. A direction that needs an exception (`design-guard: allow`) says so as a cost — and expect the user to say no.
- **Shared fixes go in every direction** and are listed once. That keeps the choice about the idea, not about who got the bug fix. It is fine — useful, even — for **A to be the shared fixes and nothing else**: a smallest-change baseline shows what the bets in B–D add.
- **Say what each costs**: new components, new tokens, new copy, a backend ask (`apps/api`, or `apps/extractor` / `apps/worker` for document data — a direction that needs a new endpoint or field says so), a change to a rule in DESIGN.md or the UI specification.
- **Recommend one** and say why in a sentence. The user often overrules the recommendation; that is the canvas doing its job.

Build **one design canvas** (Artifact, design type) holding Today + all directions, so the user compares them side by side on one link. Frames are generated from a small kit, not written by hand — there is no maester kit yet, so **the first round builds it** (`references/canvas.md` §3) and the build PR commits it to `.claude/skills/design-directions/assets/kit/`. Before publishing, look at your own frames on a local contact sheet: text that wraps or truncates, a primary action pushed off the frame, a ledger wider than its frame, and a frame taller than you claimed are all things the user will see first. The published canvas itself is not re-opened, so if its layout is a guess, say so.

## 5. Present, record, stop

The chat message is short, because the canvas does the talking:

```
Designing: <the say-back from step 1 — page, surface, who uses it and for what>
Canvas: <link> (private to you)
Today — <the measured diagnosis, one line>
A · <name> — <the bet, one line> (<length / cost>)
B · …
C · …
In every direction: <shared fixes>
I'd pick <letter>: <why, one sentence>.
Open questions: <at most three, each answerable in a word — best of all, a question whose answer picks the direction>
Seen on the way, not part of this: <a problem next door you noticed, one line — or drop the line>
Pick a letter, mix them ("B with A's header"), or tell me what's off.
```

Write the memory record now, not after the build: `maester-<topic>-canvas.md` in this project's memory with the canvas link, the directions by letter and name, the recommendation, the open questions and "wait for a pick" — plus its `MEMORY.md` line, linked to `[[maester-web-design-direction]]`. The next session (or the next round) starts from it.

Then stop. No plan, no worktree, no component until the user answers.

## 6. Read the reply

The reply is rarely a bare letter. Work out which of these it is — and when it could be two, ask one short question rather than building on a guess.

| Reply | What it is | Do |
| --- | --- | --- |
| "Go with B" · "build C" · "implement C" | Pick **and** go-ahead | Record PICKED, go to step 7. Open questions left unanswered take your recommended default — list each in the plan. |
| "I like J" · "J looks good" — no build verb | A pick, maybe not a go-ahead | Record PICKED. If open questions remain, ask them with "…then I'll plan the build"; if none remain, go to step 7. |
| "B, but move the figure up" · "A with C's rail" | Pick with a change, or a mix | Redraw it as **the final** on page 1 of the same canvas, share it, then plan the build on their OK. Small, unambiguous changes can be drawn and planned in one go — say so. |
| "Too busy" · "keep it one page" · "must show everything" · "none of these" | A **constraint** not stated before | New round. Write the constraint down in their exact words — on the canvas page and in memory — then draw new letters that obey it. Don't re-offer a rejected idea in new clothes. |
| "Looks generic" · "doesn't match the site" | The grounding failed, not the ideas | Back to step 2: fresh screenshots of the real pages, redraw the same ideas on the real anatomy (and fix the kit). |
| "Too technical" · "investors won't care" | The copy broke DESIGN.md §7 | Rewrite the copy in investor terms on the same letters; the structure may stand. |
| A question ("what does an empty portfolio see in B?") | They are still deciding | Answer it — add the frame if a picture answers it better. The canvas stands. |
| Three rounds, no pick | The brief is off, not the drawings | Stop drawing. Say what the rounds had in common and ask what about _that_ is wrong. |

Each new round goes on the **same canvas** as a new page that opens first, with earlier rounds kept behind it — the history of what was rejected, and why, is part of the design. Update the memory record every round.

## 7. Build the pick

Now it is an ordinary maester change, and `CONTRIBUTING.md`, `docs/DEVELOPMENT.md` and `apps/web/README.md` take over. In order:

1. **Plan first, wait for approval.** The plan names the direction by letter, links the canvas, lists files, any new token or component (with the DESIGN.md row it adds), and any backend ask.
2. **Ask the source branch** (usually `staging`); never assume. Then `EnterWorktree` with an explicit `<type>/<kebab>` name (`feat/holdings-ledger`) off `origin/<branch>`, and check `git log --oneline origin/<branch>..HEAD` is empty before the first commit.
3. **Subagent-driven by default**: dispatch the implementation (`superpowers:subagent-driven-development`), keep the main session as coordinator and reviewer.
4. **Build in Svelte 5**: load `svelte-code-writer` and `svelte-core-bestpractices` before touching a `.svelte` file. Compose the existing components; use `var(--…)` tokens only — a colour literal anywhere but `tokens.css` fails the design guard. A new component or token gets its row in `docs/DESIGN.md` §5 or §2 in the same change (§9). Content for public pages lives in `apps/web/src/lib/content/`. Tests with `tdd` (Vitest).
5. **Hold it against the picked frame.** See it running from the worktree (`references/canvas.md` §1 says how), at 1440, 768 and 360, and compare to the canvas frame by frame. Report honestly what differs and what you could not see running.
6. **Verify**: `pnpm --dir apps/web verify` (type and accessibility check, prettier, eslint, the design guard, the static build) — pnpm, never Make. `review` before the PR.
7. **PR only when the user asks** — into the branch it was cut from, never `main` by default. Commits signed off (`git commit -s`, CONTRIBUTING.md). The body names the direction by letter and links the canvas.
8. **Memory**: the canvas record becomes "X PICKED and BUILT (see `<branch>`)". If this round built the kit, commit it to `.claude/skills/design-directions/assets/kit/` in the same PR.

## What this skill is not for

- "Make that rule 2px" — the user has already designed it. Do it.
- A bug that looks like a design problem (a focus ring clipped by `overflow`, a layout that scrolls sideways at 360). Diagnose it first (`superpowers:systematic-debugging`); a redesign doesn't fix it.
- A broad "make the whole site feel premium" pass with no choice between ideas — `redesign-existing-projects`, with DESIGN.md overriding its font and colour advice.
- Logos, icons, marketing graphics and illustrations — visual assets, not pages. `frontend-design` and the canvas still help (the sign-in illustration was drawn this way); the ground-in-the-page and build steps don't apply.
