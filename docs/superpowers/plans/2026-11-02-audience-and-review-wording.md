# Audience and review wording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every public surface and the demo describe the same product, a personal research workspace that runs today, and nothing Maester says advises a trade.

**Architecture:** This is a copy change, with one new guard test. The layouts do not change. A vitest file pins the ADR's wording rule over the public index copy, its meta description and the demo's due item, so a later edit cannot bring "trim" back.

**Tech Stack:** Markdown docs; SvelteKit copy modules (`apps/web/src/lib/content/index.ts`, `lib/terminal/fixture.ts`); vitest.

**Spec:** [ADR 0010](../../decisions/0010-personal-first-audience-and-review-wording.md)

## Global Constraints

- Nothing Maester says advises buying, selling, trimming, adding or holding a security. A list of options such as "Hold, trim or revise" counts too. (ADR 0010 rule 4)
- Silence is "Nothing to review", never "Stay put" or "No move needed".
- Planned features are marked planned and never written in the present tense. Say what runs today before what is planned. (DESIGN §7)
- Every mock figure keeps its "Synthetic example" tag. (DESIGN §7)
- Public pages name no models, frameworks, commands or file paths. Sentence case. No "verified", no percentage accuracy. (DESIGN §7)
- The investor's own decision is theirs. "You decide" stays.

## Review Focus

1. **Words the guard must not catch.** "A post claims a promoter is selling" (problem noise) and "why you bought" (thesis) are about the investor or the news, not advice. The guard pins this with word boundaries: `selling` and `bought` do not match `\b(sell|buy)\b`.
2. **Present-tense claims left on the index page.** The `features.intro`, `how.intro`, `how.rows[2].second` and `status` copy must be future tense or name today's work.
3. **The synthetic tag.** The suggestion block's tag must still contain "Synthetic example".
4. **The hero at 360px.** The new hero title is at display size. Check that it wraps without horizontal scroll at 360px in the browser.
5. **README anchors.** The README's top nav links to `#the-opportunity`, `#what-maester-does-for-you`, `#how-maester-is-different`, `#roadmap`, `#join-the-build` and `#talk-to-me`, and the badges link to `#where-we-are-today`. Keep those headings, or update the links with them.

---

### Task 1: Wording guard and web copy

**Files:**
- Create: `apps/web/src/lib/content/wording.test.ts`
- Modify: `apps/web/src/lib/content/index.ts:101-298, 312-314`
- Modify: `apps/web/src/routes/+page.svelte:18-21`
- Modify: `apps/web/src/lib/terminal/fixture.ts:156`

**Interfaces:**
- Consumes: `content` from `$lib/content/index`, `dueDetail` from `$lib/terminal/fixture`.

- [ ] **Step 1: Write the failing test** `wording.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { content } from './index';
import { dueDetail } from '$lib/terminal/fixture';

// ADR 0010: Maester prompts a review; it never advises a trade.
const ADVICE = /\b(trim|trims|sell|sells|buy|buys)\b|stay put|no move needed/i;

describe('ADR 0010 wording', () => {
	it('public index copy advises no trade', () => {
		expect(JSON.stringify(content)).not.toMatch(ADVICE);
	});
	it('index meta description advises no trade', () => {
		expect(readFileSync('src/routes/+page.svelte', 'utf8')).not.toMatch(ADVICE);
	});
	it('demo due item advises no trade', () => {
		expect(JSON.stringify(dueDetail)).not.toMatch(ADVICE);
	});
	it('suggestion example keeps its synthetic tag', () => {
		expect(content.suggestion.tag).toMatch(/Synthetic example/);
	});
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm --filter @maester/web exec vitest run src/lib/content/wording.test.ts` (use the package's real name from `apps/web/package.json`)
Expected: the three "advises no trade" tests FAIL on "trim", "Stay put" and "No move needed".

- [ ] **Step 3: Rewrite the copy**

Exact copy fixed here:
- `hero.title`: "Every figure, with the page it came from."
- `hero.lede`: "Maester reads the filings of the companies you own, shows the page behind every number and keeps your holdings beside them. Next, it will watch them for you and tell you when your thesis needs a look. You decide."
- `hero.secondary.label`: "See what it will watch"
- `suggestion.heading`: "What a review prompt will look like"
- `suggestion.tag`: "Planned. Synthetic example. Not a real company."
- `suggestion.rows[2].detail` and `dueDetail.call`: "Keep the thesis, revise it or look again later. Maester records what you decide and why. It never trades."
- `trust.heading`: "Why you can check it"
- Meta description: "Maester reads the filings of the companies you own and shows the page behind every number, with your holdings beside them. It is being built to tell you when your thesis needs a look."
- `login.lede` in `index.ts` and the same lede in `lib/content/auth.ts:9` (add `auth.ts` to this task's files): "The terminal is where your filings, your holdings and the evidence behind every figure live."

Rewritten under the Global Constraints, wording left to the implementer:
- `features`: heading "What Maester will watch". The intro says this is planned and that today you add filings yourself. The "Policy" row's `second` becomes '"Nothing to review" as often as "look at this", with the exposure that conclusion was based on.' The note talks about review prompts, not suggestions.
- `how`: the intro says the steps after the first two are planned. Row 4 becomes "You get a review prompt, with the evidence", which names the trigger, the figure and the page. Row 5's `first` becomes "Review it, revise your thesis or set it aside. Maester records the outcome and why. It never places an order."
- `week.intro`: add that "With Maester" is the planned loop. The "rate decision" row's `after` says "Nothing to review" when nothing changes.
- `trust`:
  - "suggests, explains and records" becomes "shows, explains and records".
  - The "It does not push you to act" body ends '"Nothing to review" is a valid answer.'
  - `measured` says the measurement is planned and will be published under the evaluation reports, not that it happens before each release.
- `status.paragraphs[0]` names what works today: filings read with the page behind each figure, research tables, Zerodha holdings and market mood. It says the tool runs on your own machine and that the watching loop comes next.

- [ ] **Step 4: Run the test and see it pass**

Run: the same command as in Step 2. Expected: 4 passed.

- [ ] **Step 5: Commit**

`git commit -m "web: align public copy and demo with ADR 0010"`

### Task 2: README and CONTRIBUTING

**Files:**
- Modify: `README.md` (tagline line 10, lede line 12, "The opportunity" and "The wedge" sections, "Autonomous mode (planned)", the comparison table, the footer at lines 172-176)
- Modify: `CONTRIBUTING.md:3`

- [ ] **Step 1: Rewrite the README**
  - Tagline: "The open-source research workspace that shows where every figure came from, keeps your holdings beside it, and is being built to tell you when your thesis needs a look." The lede says it runs on your own machine with your own keys.
  - Add "### Who it is for today" under "The opportunity": personal and self-hosted, for technical investors who run their own copy. A hosted product waits on the entry criteria in ADR 0010 (link to it).
  - In "The opportunity", "The wedge" and "Autonomous mode", "suggestion" becomes "review prompt".
  - The example "Trim this position or confirm you accept the concentration" becomes "Review this position. It has grown from 12% to 31% of the portfolio, past the 20% limit you set." "No movement needed" becomes "Nothing to review".
  - Add to "What Maester will never do on its own": "Tell you to buy, sell or trim."
  - Comparison table: "tells you which decision is due" becomes "tells you which review is due"; "Suggests, explains, and records" becomes "Shows, explains and records".
  - Footer: "Every figure backed by its page. Every decision still yours."
  - Keep every heading listed in Review Focus 5.
- [ ] **Step 2: Rewrite CONTRIBUTING line 3:** "…helping build an open-source research workspace that shows the source of every figure and is being built to tell investors when their thesis needs a review."
- [ ] **Step 3: Check that the README's advice words are gone**

Run: `grep -n -i -E "\btrim|stay put|no movement needed|what to do next" README.md CONTRIBUTING.md`
Expected: matches only in "never … trim".

- [ ] **Step 4: Commit:** `git commit -m "docs: README and CONTRIBUTING lead with the research workspace (ADR 0010)"`

### Task 3: PRD, DESIGN and business analysis

**Files:**
- Modify: `docs/PRD.md` (after §1's third paragraph; §9's first paragraph)
- Modify: `docs/DESIGN.md` §7, after its first paragraph
- Modify: `docs/research/2026-11-01-business-analysis.md` (the status line; §9's D1, D2 and D5 rows)

- [ ] **Step 1: PRD.** Add "**Audience and stage.**" to §1: Maester is personal and self-hosted first; a hosted product is gated (a link to [ADR 0010](../../decisions/0010-personal-first-audience-and-review-wording.md)); Maester prompts a review and never advises a trade. In §9, add: "These targets bind once Maester is hosted. Until then the [business analysis](../../research/2026-11-01-business-analysis.md) (linked) §6.2 lists the ones that bind."
- [ ] **Step 2: DESIGN §7.** Add the sentence: "Maester never tells the investor to buy, sell, trim or add: what it raises on its own says what changed, the evidence and which review is due, and silence is "Nothing to review" (a link to [ADR 0010](../../decisions/0010-personal-first-audience-and-review-wording.md))."
- [ ] **Step 3: Business analysis.** The status line notes that D1, D2 and D5 were decided by ADR 0010. In those three rows of the §9 table, the "Options" cell keeps its text and adds "Decided 1 Nov 2026: …" with the choice taken.
- [ ] **Step 4: Commit:** `git commit -m "docs: PRD, DESIGN and analysis point to ADR 0010"`

### Task 4: Verify and open the PR

- [ ] **Step 1:** Run `pnpm verify` in `apps/web`. Expected: check, lint, test and build all pass.
- [ ] **Step 2:** Start the web preview, open `/`, and read the page text. Then check the hero at 360px (`resize_window` 360×800) for horizontal scroll, using `document.documentElement.scrollWidth <= innerWidth`. Take a screenshot.
- [ ] **Step 3:** Push with `gh-git push -u origin HEAD`. Open the PR against `docs/business-analysis`, which stacks on #41. Its title: "docs: personal first, review prompts not trades (ADR 0010)".
