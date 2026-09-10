# Maester design specification

Status: accepted 10 September 2026 (see [ADR 0002](decisions/0002-web-sveltekit-brutalist-design-system.md)). This document is the visual contract for every page of the Maester web application. It supersedes the proposed colour and typography tokens in [UI specification](UI_SPECIFICATION.md) section 3; that document's layout dimensions, semantic-state rules and accessibility requirements still apply.

The implementation lives in [`apps/web/src/lib/styles/tokens.css`](../apps/web/src/lib/styles/tokens.css) and [`apps/web/src/app.css`](../apps/web/src/app.css). A test, [`design-guard.test.ts`](../apps/web/src/lib/styles/design-guard.test.ts), fails the build when code drifts from the rules below.

## 1. Direction

Refined brutalism, black and off-white. The web is shown for what it is: text, rules, boxes and buttons. Nothing is decorated. Structure is information: a rule marks a real boundary, a number marks a real sequence, a box marks a real record. Type carries the personality; the hero is a sentence, not a statistic. The page demonstrates the product's own rule by showing, for every figure, where it came from, what check ran and whether a person reviewed it.

Reference points, for tone only, never to copy: Bloomberg's sparse text-first homepage, Are.na, terminal interfaces. We take the discipline, not the chaos. Usability research on brutalist sites is clear that chaotic anti-design fails on information-heavy pages, so conventional signposting stays: one primary action per screen, visible navigation, underlined links, real buttons.

## 2. Colour

Exactly three values, defined once in `tokens.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#EDEDE8` | page ground; text on inverted panels |
| `--ink` | `#000000` | text, rules, buttons, inverted panels |
| `--ink-muted` | `#5F5F5B` | secondary text and hairlines on paper only (7.0:1 against paper) |

`--paper-muted` is paper at 72% opacity and is the only secondary text colour allowed on inverted panels. No accent colour, no semantic green or red, no gradients, no tints of black.

Three further values exist for sketched illustrations only, never for text, rules, buttons or state:

| Token | Value | Use |
| --- | --- | --- |
| `--illus-yellow` | `#F2C53D` | illustration colour plate |
| `--illus-red` | `#E0483A` | illustration colour plate |
| `--illus-blue` | `#2F5FD0` | illustration colour plate | Numerical direction is shown with a sign or a word, never a colour, which also satisfies the product rule that colour must not read as investment advice.

Rules the guard enforces: no hex, `rgb()`, `hsl()`, `oklch()`, `color-mix()` or named colour anywhere except `tokens.css`; components use `var(--…)`, `currentColor`, `transparent` or `inherit`.

## 3. Typography

One family: Archivo, variable, self-hosted from `@fontsource-variable/archivo` (width and weight axes). Fallback stack `"Helvetica Neue", Arial, sans-serif`. No second family, no monospace: numbers and commands use Archivo with `font-variant-numeric: tabular-nums slashed-zero`.

The single exception is `--font-hand` (Caveat, variable, self-hosted from `@fontsource-variable/caveat`), used only for lettering drawn inside a sketched illustration, such as the thought cloud on the sign-in page. It never sets interface text.

| Role | Width | Weight | Size | Line height | Tracking |
| --- | --- | --- | --- | --- | --- |
| Display (page `h1`) | 125% | 800 | `clamp(2.75rem, 7.5vw, 6.5rem)` | 0.95 | −0.03em |
| Section heading (`h2`) | 110% | 700 | 28px mobile, 40px from 768px | 1.1 | −0.02em |
| Sub-heading, table title | 100% | 700 | 20–22px | 1.2 | 0 |
| Body | 100% | 400 | 17px | 1.5 | 0 |
| Table cell, note, label | 100% | 400 | 14–16px | 1.45 | 0 |

Sentence case everywhere. No all-caps labels, no letter-spaced eyebrows, no accent word in a headline. Body measure is at most 68 characters. Nothing below 14px.

## 4. Structure and layout

- Rules: 2px `--ink` between sections and around ledgers; 1px `--ink-muted` between rows; 1px `--paper` inside inverted panels. Rules are the only separators. No cards, no shadows, no radius (`--radius: 0`, `--shadow: none`, enforced).
- The register: from 1024px every section is a two-column grid, a 224px rail on the left (the same width the future app shell reserves for its navigation rail) carrying the section label or index, content on the right. Below 1024px the rail folds above the content.
- Width: content is capped at 1440px; gutters are 24px below 1024px and 48px above. Everything is left-aligned. Nothing is centred.
- Breakpoints: 768px and 1024px only. Meaningful content at 360px.
- Wide tables scroll inside a labelled `overflow-x: auto` region. The page never scrolls sideways.
- Numbered markers appear only where the content is an ordered sequence.

## 5. Components

- **Button** (`.button`): 2px border, 44px minimum height, 24px horizontal padding, weight 700. Filled ink on paper for the screen's one primary action; `.outline` for secondary actions. Hover and focus invert hard, with no transition. On inverted panels the border becomes paper.
- **Link**: always underlined, offset 3px, 1.5px thick. Hover inverts to an ink block. Never remove the underline to make a link look like a button; use `.button`.
- **Focus**: 3px solid ink outline, 2px offset, on every interactive element. Paper outline on inverted panels.
- **Ledger** (`EvidenceTrace`, `WorkflowLedger`): a 2px box; header row separated by a 2px rule; body rows by 1px hairlines; figures right-aligned and tabular.
- **Spec list** (`AccuracySpec`): a definition list with a 2px top rule, 1px rules between entries and a 2px closing rule.
- **Tag**: 1.5px border, 4px by 8px padding, 14px text. Used only for the synthetic-data label and status words.
- **Form field**: visible label above the input, 44px input with a 2px border, paper background, error text below the field, status announced through `aria-live="polite"`.
- **Illustration** (`LoginIllustration`): an inline SVG drawn as two plates, a colour plate slightly out of register under a hand-drawn ink plate. It uses `--ink`, `--paper` and the three `--illus-*` tokens and nothing else. Its frame is a 3px rule with a 30px radius on the `figure` that holds it, the one reviewed radius exception (marked `design-guard: allow`); the radius belongs to the drawing, not to the layout, and must not spread to any other element. From 1024px the frame sits to the right of the sign-in panel and fills the screen from the masthead to the bottom edge; below that it stacks under the panel at a square aspect.

## 6. Motion

One non-user-triggered moment per page at most. On the index page the evidence trace resolves its status lines in sequence at 120ms steps, opacity only. Everything else snaps: hover, focus and state changes have no transition. Durations never exceed 300ms, `transition: all` is forbidden, and a global `prefers-reduced-motion` rule in `app.css` disables all motion. The guard checks all three.

## 7. Copy

Market the product, not the technology. Public pages describe what Maester does for an investor and the time it gives back; they never mention model names, frameworks, commands, file paths or internal feature IDs. Technical detail belongs in the documentation, not on the page.

Sentence case, plain verbs, written from the investor's point of view. A button says what happens: "See how it works", "Enter the terminal", "Sign in". Maester is a working name. Every mock financial figure carries the label "Synthetic example" or equivalent. Never write "high confidence", a percentage accuracy, or a verified badge that no verification record backs. Say what runs today before what is planned. Unknown is shown as unknown, never as zero. Do not show a link or menu item whose destination does not exist.

## 8. Accessibility floor

WCAG 2.2 AA. Semantic landmarks (`header`, `nav`, `main`, `section` with `aria-labelledby`, `footer`), one `h1` per page and sequential headings, a skip link, keyboard-reachable everything with visible focus, 44px targets, text alternatives, status regions rather than colour alone. Tested at 360, 768, 1280 and 1440px and at 200% zoom. `svelte-check --fail-on-warnings` turns the compiler's accessibility warnings into build failures.

## 9. Adding to the system

1. Need a new value? Add a token to `tokens.css` with a comment saying where it is used, and add a row here. Do not add a colour; if a colour seems necessary, the design has gone wrong upstream.
2. Need a new component? Build it from the rules above and add it to section 5.
3. Need an exception? Put `/* design-guard: allow */` on the offending line and justify it in the pull request. Expect the reviewer to say no.
4. Run `pnpm verify` in `apps/web` before opening a pull request. The guard, the type checker and the linter must all pass.
