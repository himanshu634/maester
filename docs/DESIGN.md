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
| `--illus-blue` | `#2F5FD0` | illustration colour plate |

Google's four mark colours exist for the Google sign-in mark only, because Google's branding rules forbid a monochrome G:

| Token | Value | Use |
| --- | --- | --- |
| `--brand-google-blue` | `#4285F4` | Google mark only |
| `--brand-google-red` | `#EA4335` | Google mark only |
| `--brand-google-yellow` | `#FBBC05` | Google mark only |
| `--brand-google-green` | `#34A853` | Google mark only |

The guard fails any file but `GoogleButton.svelte` that names them.

Numerical direction is shown with a sign or a word, never a colour, which also satisfies the product rule that colour must not read as investment advice.

Rules the guard enforces: no hex, `rgb()`, `hsl()`, `oklch()`, `color-mix()` or named colour anywhere except `tokens.css`; components use `var(--…)`, `currentColor`, `transparent` or `inherit`.

## 3. Typography

One family: Archivo, variable, self-hosted from `@fontsource-variable/archivo` (width and weight axes). Fallback stack `"Helvetica Neue", Arial, sans-serif`. No second family, no monospace: numbers and commands use Archivo with `font-variant-numeric: tabular-nums slashed-zero`.

The single exception is `--font-hand` (Caveat, variable, self-hosted from `@fontsource-variable/caveat`), used only for lettering drawn inside a sketched illustration, such as the thought cloud on the sign-in page or what the magnifying glass finds on the not-found page. It never sets interface text.

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
- **Disabled button** (`.button:disabled`): a write action that cannot run here. `--ink-muted` text and a 2px `--ink-muted` border on paper, `--paper-muted` on inverted panels; no fill, no hover inversion, `cursor: not-allowed`. It is a real `<button disabled>`, and it always points at a visible note that says why, through `aria-describedby`.
- **Link**: always underlined, offset 3px, 1.5px thick. Hover inverts to an ink block. Never remove the underline to make a link look like a button; use `.button`.
- **Focus**: 3px solid ink outline, 2px offset, on every interactive element. Paper outline on inverted panels.
- **Ledger** (`EvidenceTrace`, `WorkflowLedger`): a 2px box; header row separated by a 2px rule; body rows by 1px hairlines; figures right-aligned and tabular.
- **Spec list** (`AccuracySpec`): a definition list with a 2px top rule, 1px rules between entries and a 2px closing rule.
- **Tag**: 1.5px border, 4px by 8px padding, 14px text. Used only for the synthetic-data label and status words.
- **Form field**: visible label above the input, 44px input with a 2px border, paper background, error text below the field, status announced through `aria-live="polite"`.
- **Google button** (`GoogleButton`): 48px, full panel width, a 2px border, square, Archivo 700, "Continue with Google" or "Sign up with Google". Google's G at 18px on a 28px paper chip, the only place `--brand-google-*` is used. Filled ink when it is the screen's primary action (on `/login` and `/signup`), outline otherwise. Hover inverts the button; the chip keeps the mark on paper. While it redirects it is disabled and points at the status line.
- **Notice** (`Notice`): a form-level message. A 2px box, a bold first line saying what happened, then what to do; an action (a button or link) may follow. A message that appears in answer to something the person did is announced to screen readers (`role="alert"`, the default); standing text that is there when the page loads, such as "Didn’t get it?" on `/verify-email`, is `role="note"` and is not announced. State is the words, never colour.
- **Or rule** (`OrRule`): between two ways of doing one thing; 1px `--ink-muted` rules either side of a 14px muted label.
- **Password field** (`PasswordField`): a form field with an attached 44px "Show password" button that reveals the text. Its label never changes; `aria-pressed` carries the state, and while pressed the button is an ink block, as the current page is in the terminal rail. An error is a 3px border plus bold text under the field saying the fix.
- **Auth layout** (`AuthLayout`): the sign-in pages' frame — masthead, a 480px panel with a 2px rule, and on `/login` the illustration.
- **Illustration** (`LoginIllustration`): an inline SVG drawn as two plates, a colour plate slightly out of register under a hand-drawn ink plate. It uses `--ink`, `--paper` and the three `--illus-*` tokens and nothing else. Its frame is a 3px rule with a 30px radius on the `figure` that holds it, the one reviewed radius exception (marked `design-guard: allow`); the radius belongs to the drawing, not to the layout, and must not spread to any other element. From 1024px the frame sits to the right of the sign-in panel and fills the screen from the masthead to the bottom edge; below that it stacks under the panel at a square aspect.
- **Due panel** (`DuePanel`): an inverted panel with a 2px paper rule under its header and 1px paper rules between rows. The first item opens with a Trigger, Evidence and Your call spec list; the rest are one-line rows. When nothing is due it lists what was checked.
- **Figure strip** (`FigureStrip`): four headline figures, each with a note saying what it covers. A spec list on a phone, two by two from 768px, one row from 1024px, with 1px `--ink-muted` rules between cells, inside 2px top and bottom rules. An unknown figure is "—" with the reason read out.
- **Holdings table** (`HoldingsTable`): a ledger with all five columns at every width, figures right-aligned and tabular, closed by a 2px totals row. Below the width it needs, it scrolls inside its labelled `.scroll-x` region, which takes focus. An unknown figure is "—" with the reason read out.
- **Sector bars** (`SectorBars`): label, bar and percentage per row, largest first. The bar is drawing only; the label and percentage carry the figure. The unknown bucket is a dashed outline, last, and never a zero.
- **Error sketches** (`LedgerSketch`, `ComputerSketch`, `PlugSketch`): inline SVGs drawn like the sign-in illustration, two plates in `--ink`, `--paper` and the `--illus-*` tokens, each with a text alternative. They are unframed: the sign-in frame's radius does not come with them. `LedgerSketch` (not found) is a ledger with every line empty and a magnifying glass that follows the pointer; under the glass, in `--font-hand`, it finds nothing. `PlugSketch` (offline) is a cable you drag into a socket, which runs the same connection check as the page's "Check again" button and drops back out if the device is still offline. `ComputerSketch` (a page that failed to load) is small and never moves. None of them is a control: each page's way out is a real link or button, first in the tab order.
- **Error page** (`src/routes/+error.svelte`): one page for every error, chosen by `errorView` (`lib/errors/errors.ts`) from the status, the address and the connection: not found, not found inside the terminal, a page that failed to load, offline, signed out (401) and no access (403). Nothing on the static site returns 401 or 403 yet; those two show once the API does. Once a page has shown the offline view it keeps it, and when the connection returns it checks and reloads rather than blaming the server. Public errors use the masthead and the register's rail, with the sentence as the `h1` and the code only as a muted label in the rail. Errors under `/terminal/demo` stay in the terminal shell with section 10's heading sizes; the error page does not read the session, so errors elsewhere in the terminal use the public layout rather than showing a signed-in shell without its account. The play scales down with the stakes: only the public not-found page has a sketch that follows the pointer; inside the shell the failed-page computer is small and still, and the only sketch that moves is the offline plug, on a page with no figures beside it. The build writes the page as `404.html`, which nginx serves for any missing address.
- **Site-down page** (`static/50x.html`): plain HTML that nginx serves when it answers with a 5xx itself. When the container is down, the host's own page shows instead. No script, no motion and no font download; its colours copy `tokens.css` by hand because it cannot load it.
- **Offline banner** (`OfflineBanner`): an inverted line under the terminal's context header while the device is offline, saying when the page last loaded. It is the one other dark block a terminal page may show, and only while offline. It appears and disappears with the connection, with no animation.
- **Section issue** (`SectionIssue`): a section of a terminal page that didn't load. A 2px box with a bold first line saying what failed, a line saying what is still current, and an outline "Try again". The rest of the page keeps working, and figures that need the missing data show "—". Documents uses it when the page does not load, and on the slip when a step stopped ("Maester couldn’t read the statements.", with "Try again").
- **Loader** (`Loader`, `Ruler`): a wait with nothing to draw yet. A sentence saying what is being waited for, and the ruler: a 2px rule with an ink block, an eighth of its length and 6px tall, that steps along it, one step every 120ms, eight steps a pass. Nothing shows for the first 300ms, so a quick load never flashes. After 10s it adds "Still working. This is taking longer than usual." and, where the work can be started again, an outline "Try again". The status region is always in the page and the sentence is announced once; the ruler is hidden from screen readers. On an ink panel the ruler draws in paper. It never shows a percentage it cannot keep.
- **Hatch** (`Hatch`): the skeleton piece, a drafting-paper box where a value will be: a 1px outline filled with 45 degree lines in the colour of the text around it. It means "not read yet"; unknown stays "—" or a dashed outline. It is sized to the value it stands in for, so the page keeps its loaded height and nothing moves on arrival, and a box is replaced by its content at once. The lines are an inline SVG pattern, never a CSS gradient. Boxes are hidden from screen readers; the region is `aria-busy` and one status line says what is loading. Documents is the first page to use it, while the slip and the Earlier list first load; the Overview follows once holdings are read from the API.
- **Coming soon** (`ComingSoon`): a signed-in terminal page planned for the first release that does not work yet. The page name as the overview's `h1` (section 10) with a "Coming soon" tag, one sentence on what the page will do for the investor and one on what it needs first. No primary action and no button that points at a page that does not work. The page's sketch sits beside the text from 1024px and below it on smaller screens; the text and any link come first in the tab order. Its copy lives in `lib/content/terminal.ts`.
- **Coming-soon sketches** (`RollerSketch`, `CraneSketch`, `CabinetSketch`, `BinocularsSketch`, `LampSketch`, `LogbookSketch`, `SpannerSketch`, in `components/terminal/sketches/`): one per coming-soon page, drawn like the error sketches, two plates in `--ink`, `--paper` and the `--illus-*` tokens, unframed, with hand lettering in `--font-hand` that changes as you play. Overview: a paint roller that runs dry halfway across a wall. Holdings: a crane whose load will not land on an unfinished wall. Research: a filing-cabinet drawer holding one note, "being sorted". Watchlist: binoculars swept along an empty horizon. Analyst: a desk lamp whose cord switches on a light over an empty chair. Activity: a pencil that writes "first entry soon" in an empty logbook. Settings: a spanner turned on the one bolt fitted to a bracket. Each moves only under the pointer, never on its own. On a phone a vertical swipe over a drawing still scrolls the page (`touch-action: pan-y`); only the part you drag up, down or round (the crane's load, the lamp's cord, the spanner) holds the touch (`touch-action: none` on that part). Each snaps with no animation. None is a control or carries information: the lettering sits inside the `role="img"` drawing, whose title is its text alternative, so keyboard and screen-reader users lose nothing. Documents works, so it has no coming-soon page and no sketch.
- **Drop strip** (`DropStrip`, in `components/documents/`): where a file comes in. A 2px dashed `--ink` box (the dashed outline that already means "not there yet" on the sector bars) with "Drop a PDF here", "or", an outline "Choose a file" button that opens the system file picker (a real `<input type="file" accept="application/pdf">` behind it), and the limit, "PDF, up to 50 MB.", stated before a file is chosen. Dragging is never the only way. A file held over the box inverts it hard, as hover does. A file that is not a PDF or is over the limit is refused in the browser with a Notice saying what it is and the way out ("Choose another file"); the API's `UPLOAD_TOO_LARGE` says the same. While a file is sent the box holds the Loader ("Uploading ar.pdf…"), and closing or reloading the tab during those seconds asks first, because that is the one thing that would stop it; moving to another terminal page does not. One file at a time.
- **Stage ladder** (`StageLadder`): an ordered list, so it is numbered: Uploaded, Worked out what it is, Reading the statements, Ready. Each step says its state in a word, Done, Now, Next, Needs you, Stopped or Not read (a kept document), never a colour; the step Maester is on is an ink block, and "Needs you" and "Stopped" are bold. Four across inside 2px top and bottom rules with 1px `--ink-muted` rules between steps when its container is 32rem or wider, one step per row below that. It never shows a percentage.
- **Slip** (`Slip`): one document. A 2px box: the filename as an `h2` and "added 14:02", then the stage ladder, then whatever needs the investor, then "Read as", a spec list of What it is, Company, Period and Statements. Every answer shows where it came from under it: "Page 3: “quote”" (pages counted from 1) for an answer read from the filing, "You said so" for the investor's own, never a confidence. Unknown is "—". What it is and Company carry a "Change" action that opens its form in place; a change posts with the answers it was based on, and if they moved on meanwhile it says "These answers changed since you opened them. Here is the latest." and shows them. A new company holds the document under a Notice, "Is this Synthetic Cements Limited?", with the identifiers printed on the filing and their pages; adding the company as printed is the screen's one primary action, and picking one already added is the other way. When Maester could not tell what a file is, a Notice asks "What is it?" (annual report, financial results with the period, or another company document with its kind). Kept documents, files added before, and steps that stopped say so in words with the action that applies ("Read it again", "Try again"). While Maester is working, the slip asks the API every 2 seconds, says each change once through a polite status region, and stops when the work stops, while the tab is hidden and when the page is left.
- **Earlier list** (`EarlierList`): the workspace's other documents, newest first, under an `h2`. Each row is the name (an underlined button that opens its slip and moves focus to it), what it is and where it stands, in words, with 1px `--ink-muted` rules between rows and a 2px closing rule. Three columns when its container is 36rem or wider, stacked below that. Empty, it says "Nothing added yet.

## 6. Motion

One non-user-triggered moment per page at most. On the index page the evidence trace resolves its status lines in sequence at 120ms steps, opacity only. Direct manipulation is not an animation: the not-found page's magnifying glass follows the pointer, the offline page's plug moves under it, and so do the parts of the terminal's coming-soon sketches, with no duration and nothing that moves on its own, so there is nothing for reduced motion to switch off. While a page loads, the loader's ruler or the hatch is its one non-user-triggered motion: the ruler steps along its rule, and every hatch box drifts one pixel along its lines each 120ms, all together, so it reads as one current. A page that shows hatch boxes does not also draw the ruler. Both are driven by one clock that sets the step, because the guard caps CSS animation at 300ms and a pass is longer; the clock stops under reduced motion (the block and the hatch hold still) and while the tab is hidden. Everything else snaps: hover, focus and state changes have no transition. Durations never exceed 300ms, `transition: all` is forbidden, and a global `prefers-reduced-motion` rule in `app.css` disables all motion. The guard checks all three.

## 7. Copy

Market the product, not the technology. Public pages describe what Maester does for an investor and the time it gives back; they never mention model names, frameworks, commands, file paths or internal feature IDs. Technical detail belongs in the documentation, not on the page.

Sentence case, plain verbs, written from the investor's point of view. A button says what happens: "See how it works", "Enter the terminal", "Sign in". Maester is a working name. Every mock financial figure carries the label "Synthetic example" or equivalent. Never write "high confidence", a percentage accuracy, or a verified badge that no verification record backs. Say what runs today before what is planned. Unknown is shown as unknown, never as zero. Do not show a link or menu item whose destination does not exist. The one exception: a terminal page planned for the first release may appear in the rail, marked "Soon", and open a coming-soon page that says what it will do (`ComingSoon`).

## 8. Accessibility floor

WCAG 2.2 AA. Semantic landmarks (`header`, `nav`, `main`, `section` with `aria-labelledby`, `footer`), one `h1` per page and sequential headings, a skip link, keyboard-reachable everything with visible focus, 44px targets, text alternatives, status regions rather than colour alone. Tested at 360, 768, 1280 and 1440px and at 200% zoom. `svelte-check --fail-on-warnings` turns the compiler's accessibility warnings into build failures.

## 9. Adding to the system

1. Need a new value? Add a token to `tokens.css` with a comment saying where it is used, and add a row here. Do not add a colour; if a colour seems necessary, the design has gone wrong upstream.
2. Need a new component? Build it from the rules above and add it to section 5.
3. Need an exception? Put `/* design-guard: allow */` on the offending line and justify it in the pull request. Expect the reviewer to say no.
4. Run `pnpm verify` in `apps/web` before opening a pull request. The guard, the type checker and the linter must all pass.

## 10. The terminal

The terminal is the signed-in app. It follows [UI specification](UI_SPECIFICATION.md) sections 2, 12, 13 and 14 and uses the colour, rule and component rules above without change. Four things differ from the public pages: it has an app shell, its gutters are 24px at every width (section 4's 48px from 1024px does not apply), there is no register grid, and its headings are smaller than section 3's, because a working screen leads with data, not a sentence:

| Role | Width | Weight | Size | Line height | Tracking |
| --- | --- | --- | --- | --- | --- |
| Overview `h1` (portfolio name) | 125% | 800 | 32px, 40px from 768px | 1.1 | −0.02em |
| Section heading (`h2`: holdings, allocation, research) | 110% | 700 | 22px | 1.1 | −0.02em |
| Due panel heading (`h2`) | 110% | 700 | 24px, 28px from 768px | 1.1 | −0.02em |
| Due item title (`h3`) | 110% | 700 | 22px, 26px from 768px | 1.2 | 0 |

Body, table, note and label sizes follow section 3, and nothing is below 14px. The overview routes (`/terminal/demo` and `/terminal/demo/quiet`) and every signed-in page use the shell. Signed in, `/terminal/documents` works (see Documents below); `/terminal` (the overview, where sign-in lands), `/terminal/holdings`, `/terminal/research`, `/terminal/watchlist`, `/terminal/analyst`, `/terminal/activity` and `/terminal/settings` are coming-soon pages (`ComingSoon`) until each works. Each checks the session itself through `SignedInPage`, not a layout over `/terminal`, because the demo lives under it with no session; signed out, it goes to `/login?next=` that page. The implementation is in [`apps/web/src/lib/components/terminal/`](../apps/web/src/lib/components/terminal/) and, for Documents, [`apps/web/src/lib/components/documents/`](../apps/web/src/lib/components/documents/).

**Shell** (`TerminalShell`). From 1024px a 224px rail on the left holds the wordmark, the workspace and the page list, divided from the content by a 2px rule. A 56px context header runs across the content and shows the portfolio as text, and in the demo a "Leave the demo" link to `/`. Below 1024px the rail becomes a 56px top bar, and a Menu button opens the same list, workspace included, as a drawer; Escape closes it and returns focus to the button. The demo's rail lists its one page. Signed in, the rail lists the first release's pages from `lib/terminal/pages.ts` in groups, with a 1px `--ink-muted` rule between them: Overview and Holdings; Research, Watchlist, Documents and Analyst; and Activity and Settings at the foot, above the account block. A page that does not work yet (every page but Documents, for now) says "Soon" after its label, in 14px `--ink-muted` (`--paper-muted` on the ink block): a word, never a colour. The underline sits on the label alone. The phone drawer lists the same. The current page is an ink block with `aria-current="page"`. Under a real session the foot of the rail (and of the phone drawer) carries an account block: "Signed in as", the email, and an outline Sign out button that returns to `/`. The demo has no session and no account block. The context header shows the portfolio when there is one, otherwise the workspace name. Search, the portfolio picker and pages beyond the first release are omitted until they exist.

**Overview.** One `h1`, the portfolio name, with two tags, "Holdings snapshot" and "Synthetic example", the as-of date and the read-only note beneath it. The one page-level action, "Update holdings", sits beside the title from 768px and closes the page on a phone. Below it, in order:

1. The due panel.
2. The figure strip.
3. Holdings beside allocation from 1024px, stacked below that.
4. Research updates.

**Due panel.** Inverted, so it is the one dark block on the page; on a phone it runs edge to edge. Decisions come before data fixes: review due, then position limit breached, then missing price, and within each kind the larger portfolio weight first. The subtitle states the count, and the order ("Decisions first, then data to fix.") only when decisions and data fixes are both due. A review stays due once its date has passed, until it is reviewed. The first item expands, when it has a full trigger and evidence detail, into Trigger, Evidence and Your call, and carries "Start the review" (the screen's one primary action) and "Move to next week". The rest are compact rows with a bold title and a muted detail. When nothing is due the panel says so and lists what was checked, because an empty panel with no evidence would read as a missing feature.

**Figures.** In the holdings table, the figure strip, the due rows and the position-limit check, a figure whose input is missing is "—" with the reason available to screen readers, never zero. With no priced holding, known value and the sector bars are unknown, not zero; with no holding that has both a price and a cost, unrealized gain is unknown. Each headline figure carries a note naming what it covers, such as how many holdings are priced. Direction is shown with a sign, never a colour.

**Documents.** `/terminal/documents` is the first page on the real API, under a real session only; it has no demo and shows no synthetic figures. One `h1`, "Documents", and one sentence: "Add a filing and Maester works out what it is, then reads it. Wrong guess? Change it and it’s read again." Below it, in order: the drop strip; then the slip beside the Earlier list from 1024px (the slip about 1.6 times as wide), stacked below that with the slip first; then the note "Leaving this page doesn’t stop anything. The slip is here when you come back." under the slip. The slip opens the newest document that is not read or kept, or the one opened from Earlier, and stays on it while its work finishes; with nothing unsettled it opens the newest. Maester carries on without waiting: it works out what a file is and reads annual reports and financial results straight away; a company it has not seen holds the document until the investor confirms it, and anything else is kept with its company, not read. While the page first loads, hatch boxes the size of the slip and the list stand in, with one status line, "Loading your documents."; if it fails, a section issue says so with "Try again". The copy lives in `lib/content/documents.ts` and the logic, kept free of Svelte and tested, in `lib/documents/`.

**Demo.** `/terminal/demo` shows the overview with items due and `/terminal/demo/quiet` shows it with nothing due. Both are prerendered, marked `noindex`, built from a synthetic portfolio and tagged "Synthetic example". Write actions cannot work in a read-only demo, so "Start the review", "Move to next week" and "Update holdings" are disabled buttons that point at the visible note "Read-only demo. Decisions and updates arrive with your account." The demo is linked from one place, the index page's "Where we are" section; no terminal page links to it, and nothing under a real session shows synthetic numbers.
