# ADR 0010: Personal first, and Maester prompts a review, never a trade

Status: accepted 1 Nov 2026. It takes decisions D1 (audience), D2 (public positioning) and D5 (suggestion wording) from the [business analysis](../research/2026-11-01-business-analysis.md) §9, on its recommendation in §3.2. The [PRD](../PRD.md) stays the source of requirements.

## Context

By 1 November 2026 the project described itself in three ways:

- **An autonomous adviser.** The [README](../../README.md) opens with "tracks your portfolio autonomously and tells you what to do next", and its examples include "Trim this position or confirm you accept the concentration". The public index page (`apps/web/src/lib/content/index.ts`) and [CONTRIBUTING](../../CONTRIBUTING.md) say the same, in the present tense: "Maester runs the loop every day".
- **A research workspace.** The [PRD](../PRD.md) §1 says Maester "helps investors connect what they own, what a company reports, and why they made an investment decision", and puts automation after the evidence workflow has earned repeat use.
- **A personal tool.** The specs built since October say "Maester is a personal, non-commercial project for one user" ([market mood design](../superpowers/specs/2026-10-06-market-mood-design.md)). The broker accounts plan records the user's words: "only one account, one person". The macOS app is "personal use only".

The third description is the one the code depends on:

- Market data comes from the investor's own Dhan and FRED keys, under personal-use terms.
- The Nifty 500 list comes from niftyindices.com, whose terms allow personal use.
- Holdings come from the investor's own Kite Connect app.
- Model calls use the investor's own Anthropic key.

None of these lets Maester show data to other people.

The first description is also a regulatory question. Personalised buy, sell or trim suggestions are close to what SEBI regulates as investment advice or research. Whether a given wording needs registration is for a written legal opinion to decide, not this record (business analysis §3.1, §7).

The analysis found that this choice of audience changes the requirements more than any single feature does.

## Decision

1. **Maester is a personal, self-hosted tool.**
   - It is built for its author first.
   - Other technical investors can run their own copy, with their own keys for prices, holdings and models.
   - Bring-your-own-keys is a feature, not a workaround. It is the one data model that is clean today, and it keeps an investor's data on their own machine.

2. **A hosted product is an option, not a plan.**
   - The hosted path starts only when all five entry criteria in the business analysis §3.3 are met:
     - the PDF accuracy baseline meets the quality gate;
     - interviews and moderated sessions show a recurring job;
     - a written legal opinion on suggestion wording exists;
     - a data licence that permits display to users is priced, and a holdings route for many users is chosen;
     - cost per filing and per user is measured.
   - Until then, nobody builds hosted-only work: billing, multi-tenant operations or availability targets.
   - The boundaries a hosted product would need stay in the code, because they are already there and cost little: workspace ownership, decimal money, provenance, no model arithmetic.

3. **Positioning leads with what runs.**
   - Every public surface (the README, CONTRIBUTING and the public index page) leads with the evidence-backed research workspace: every figure with the filing it came from (the page for a PDF, the tag for an XBRL file), and holdings beside the research.
   - Autonomous monitoring stays the stated direction. It is marked planned wherever it appears and is never described in the present tense.

4. **Maester prompts a review; it never tells the investor to trade.**
   - What Maester raises on its own says three things:
     - what changed;
     - the evidence (the filing, the page and the figure);
     - which review is due.
     For example: "Review your thesis on Harbour Cements. Operating cash flow fell 18% year on year; cash flow statement, page 96."
   - No product text, document or site copy has Maester advise buying, selling, trimming, adding or holding a security until the legal opinion says which wording is allowed. This includes a list of options such as "Hold, trim or revise".
   - The rule governs what Maester says. What the investor writes in a thesis or records as a decision is theirs and is not limited.
   - Silence is phrased as "Nothing to review", never as "Stay put" or "No move needed".
   - Market mood stays context, never advice, as its design already says.

## Consequences

- **Aligned in the pull request that adds this record:**
  - the README;
  - CONTRIBUTING;
  - the public index page's copy (`content/index.ts`), including its trust section, and its meta description (`routes/+page.svelte`);
  - the login lede (`lib/content/auth.ts`);
  - the README's comparison table;
  - the synthetic overview's due item (`lib/terminal/fixture.ts`, whose "Your call" says "Hold, trim or revise the thesis");
  - a short "Audience and stage" note in the PRD;
  - DESIGN.md §7, so the wording rule reaches every session.
  The page layouts do not change.
- **The PRD stays the source of requirements.** Its §9 targets (tenant isolation, availability, recovery and latency) bind once the product is hosted. Until then, the business analysis §6.2 lists the non-functional requirements that bind.
- **Decisions D1, D2 and D5 in the business analysis are closed.** D6 (adopt roadmap entries F53–F57 and re-rank the roadmap to close the evidence loop) follows from this record but is a separate change. D3 and D4 stay open.
- **Monitoring copy waits on the legal opinion.** When C7 and C8 (change detection, the review queue and the digest) are built, their copy follows rule 4. Any wording beyond rule 4 needs the opinion first, and this record is then amended.
- **Choosing the hosted path is a new decision** that supersedes this one. It must show that each entry criterion is met.
- **Market data and holdings specs keep their personal-use limits**: data only behind a signed-in session, no public route, and no use of one investor's keys for another.
