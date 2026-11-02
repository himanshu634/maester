# Business analysis: core features and requirements

Status: analysis, 1 November 2026. Decisions D1, D2 and D5 were decided by [ADR 0010](decisions/0010-personal-first-audience-and-review-wording.md) on 1 November 2026. Recommendations only; the [PRD](../PRD.md), [feature roadmap](../FEATURE_ROADMAP.md) and [delivery plan](../DELIVERY_PLAN.md) stay the product direction until the decisions in section 9 are taken.

This is not another PRD. The PRD (9 September 2026) already sets the users, journeys, requirement families and release targets, and the roadmap lists F00–F52 with acceptance criteria. This document reconciles that plan with what was built in the eight weeks since, names the core features that carry the product, states the functional and non-functional requirements they still need, and says which decisions block the rest.

Inputs: the README, the PRD, roadmap, delivery plan, [research report](../RESEARCH.md), [quality plan](../QUALITY.md), [Building Maester](../ENGINEERING.md), the system descriptions, the specs and ADRs, and the git history from 9 September to 30 October 2026. External facts are cited at the end. Nothing here comes from an investor interview: none has been held yet, so every statement about demand is a hypothesis.

## 1. Summary

1. **The product says three different things about itself.** The README sells an autonomous adviser that "tells you what to do next" ("Trim this position"). The PRD describes a research workspace with portfolio context. The specs built since October say "Maester is for personal use only", and the data it shows depends on that. The audience decision (section 3) changes the requirements more than any feature does.
2. **The foundation is unusually strong for pre-alpha.** Sign-in and private workspaces, durable filing intake, XBRL-first numbers with page or element provenance, restatement handling, statement tables, a figure panel, broker holdings, a local text index, a read-only MCP server and an evaluation harness all work locally.
3. **The core loop is not closed.** The roadmap's P0 order was F01–F07, then calculations (F08), the Analyst (F09) and notes (F10). Instead, broker connections (F35, a P2 item), market mood and the MCP server, none of them in R1, shipped first. Figure review (F06), calculations, notes and the holding-to-company link (F14) are not built.
4. **Activation cannot happen today.** The PRD's activation event is "inspect source evidence and save a linked note within seven days". There is no note to save. The north-star metric cannot be measured until F10 ships.
5. **One shown figure breaks the house rule.** The Research summary's price to earnings and its revenue and profit changes are computed in the web app with floating-point numbers, not by a named engine function. It is small to fix and belongs in the first calculation slice (FR-2.5).
6. **Accuracy is not measured.** The PDF-read baseline is owed, and the XBRL-in-PDF check is too weak to show (46.7% of checked facts not found; see the [XBRL map report](../eval/2026-10-21-xbrl-map-v1.md)). For a product whose whole claim is trust, this is the release-blocking gap.
7. **The README's promise is regulated work in India.** Personalised "buy, trim or hold" suggestions are close to what SEBI regulates as investment advice or research. That is a legal question to settle before anyone but the author uses autonomous mode, not a wording fix.
8. **Recommendation: personal-first, product-ready.** Run Maester as a self-hosted personal tool now. Close the evidence loop (review, calculations, notes, holding-to-research link) before adding new surfaces. Measure accuracy. Keep the hosted product as a gated option with explicit entry criteria (section 3.3).

## 2. Where the product stands

### 2.1 Plan against build

| Roadmap item | Planned | Built (30 Oct 2026) | Gap |
| --- | --- | --- | --- |
| F01 Workspace identity | P0 | Google and email sign-in, waitlist, private workspace | Export and deletion of a user's data (F15) |
| F03 Company directory | P0 | Companies with NSE, BSE, CIN; confirm-once for an unseen company | Exchange-qualified security IDs for holdings that are not yet a company |
| F04 Uploads and durable jobs | P0 | Folder drop, duplicate detection, retry per track, bounded job runner | Cancel a running job |
| F05 Versioned facts with provenance | P0 | XBRL element or PDF page per fact, period, unit, basis, checks | Quarter and half-year figures are read but not shown |
| F06 Source reader and review | P0 | Figure panel with "Open the PDF at page n" | **Review and correction: not built** |
| F07 Financial tables | P0 | Three statements by year, consolidated and standalone apart | Quarterly view |
| F08 Calculations | P0 | Holdings P&L in `@maester/financial-engine`. Price to earnings, revenue and profit change and the 52-week position are worked out in `apps/web/src/lib/research/summary.ts` with JavaScript numbers | **The named, versioned metric registry: not built.** The Research summary breaks the project's own rule that the web app never computes a figure and never uses a float |
| F09 Analyst | P0 | MCP server: an outside agent reads facts and searches pages | No in-app Analyst; calculations are not exposed to agents (M2) |
| F10 Notes and thesis | P0 | — | **Not built** |
| F11 Watchlist | P0 | Coming-soon page | Not built |
| F12–F13 Portfolio and holdings snapshot | P0 | Zerodha holdings by company and broker, at Maester's NSE close | No manual or CSV snapshot; one broker only |
| F14 Overview linked to research | P0 | Synthetic demo only | **A holding does not link to its company's research** |
| F15 Activity and data controls | P0 | — | Not built |
| F16 Evaluation | P0 | Harness, gold-set tooling, XBRL map reports | **PDF accuracy baseline owed** |
| F35 Broker connections | P2 | Built early: plugin model, Zerodha live, Angel One off | No ledger behind it, as the roadmap warns |
| Not in the roadmap | — | Market mood, local search index, MCP server, XBRL reader, macOS app spec | Need roadmap IDs and acceptance criteria (section 5.3) |

### 2.2 What the order tells us

The git history shows the build following the author's own use: market mood (6–13 Oct), Research (13–14 Oct), the evaluation harness (15–16 Oct), then holdings, ingestion and XBRL (19 Oct onward). That is a reasonable way to build a personal tool, and it produced real capability. It also means the roadmap's ordering logic ("complete F01–F07 as a vertical slice, add F08–F10 to turn this into a saved research conclusion") was replaced in practice without a recorded decision. Either the roadmap should be re-ranked to match (if personal use is the goal), or the next work should return to F06, F08, F10 and F14 (if the product is the goal). Section 8 recommends the second, because those four serve both goals.

## 3. The decision that shapes everything: personal tool or product

### 3.1 The two paths

| Dimension | Personal, self-hosted tool | Hosted product for Indian investors |
| --- | --- | --- |
| User | The author, then other technical investors who run their own copy | Self-directed long-term investors who will not run Docker |
| Market data | The user's own Dhan and FRED keys; Nifty 500 list under personal-use terms. Clean today | Maester needs its own licence for NSE end-of-day data that permits display to users; the NSE data policy governs redistribution |
| Holdings | Each user's own Kite Connect app (₹500 a month per app for Connect; Personal is free and includes holdings) | One Kite app for all users, a partner agreement, or a consent route such as the Account Aggregator (section 5.2) |
| Model cost | The user's own Anthropic key | Maester pays per filing; needs metering, caps and pricing |
| Regulation | Tooling one person runs on their own data; low exposure | Suggestions to others may be investment advice or research under SEBI rules; AI-use disclosure applies to registered advisers and analysts |
| Privacy law | Out of scope for one user's own data | Maester is a data fiduciary under the DPDP Act; the substantive duties apply from May 2027 |
| NFRs that bind | Section 6.1 | Sections 6.1 and 6.2 |
| Revenue | None; AGPL and the CLA keep a commercial licence possible | Subscription hypothesis (PRD §11), unvalidated |

### 3.2 Recommendation

Choose **personal-first, product-ready**:

- Say so in the README. Today it promises an autonomous adviser to the public while the code is built, and licensed, for one person. Lead with what runs and who it is for; keep autonomous mode under "planned".
- Keep the bring-your-own-keys model as a deliberate feature, not a workaround. It is the only data model that is clean for prices, holdings and model calls today, and it is a real differentiator for privacy-minded investors.
- Keep every boundary the hosted product will need (workspace ownership, decimal money, provenance, no model arithmetic). They are already in the code, and they cost little to keep.
- Do not add hosted-only work (billing, multi-tenant operations, availability targets) until the entry criteria below are met.

### 3.3 Entry criteria for the hosted product

Start the hosted path only when all of these are true:

1. The PDF accuracy baseline exists and meets the [quality plan](../QUALITY.md)'s fact-correctness gate on the held-out set.
2. Ten investor interviews and five moderated sessions (RESEARCH §7) show a recurring job that the evidence loop solves.
3. A written legal opinion says which suggestion types need SEBI registration, and the product copy follows it.
4. An end-of-day data licence that permits display to users is priced, and the holdings route for many users is chosen.
5. Cost per filing read and per active user is measured on real use.

## 4. Users and jobs

The PRD's persona stands: the self-directed long-term investor with holdings at one or more brokers. Two refinements from the build:

- **The first real user is technical.** Maester today needs Docker, API keys and a broker developer app. The first cohort beyond the author will be investors who can run that, which is a narrower and more forgiving group. Design for them now; do not mistake their tolerance for the mainstream investor's.
- **XBRL changes the cost model.** Results filed with XBRL are read without a model call. For Indian listed companies this makes most quarterly numbers nearly free to read, which strengthens the case for automatic fetching (section 5.2).

Job coverage today:

| Investor job (PRD §2) | Served by | Coverage |
| --- | --- | --- |
| What do I own? | Holdings (Zerodha) | Partial: one broker, no mutual funds, no cash |
| Where did this number come from? | Research figure panel, PDF link | Strong |
| What changed? | Restatements in the figure panel | Weak: no change detection, no alerts, filings added by hand |
| What drove my return? | Holdings P&L on cost | Unrealized only; no ledger, no TWR or XIRR (R2) |
| Does my thesis still hold? | — | None: no thesis to hold |
| How does the market feel? (not in the PRD) | Market mood | Strong, but unplanned and not tied to the investor's holdings |

## 5. Core features

### 5.1 The core loop

Maester's differentiation is one chain, and every core feature is a link in it:

```text
Holding ─► Company ─► Filing ─► Fact ─► Calculation ─► Thesis ─► Change ─► Review
  built      built     built    built    partial        missing   missing   missing
  (Zerodha)            (manual)                                    (R3)      (R3)
```

The links that exist are the hard, technical ones. The links that are missing are the ones that turn a reader into a decision record, and they are what the activation metric and the autonomous wedge both depend on. **Core features are the ones that close this chain**; everything else is supporting.

### 5.2 Feature classification

**Core: close the loop (do next)**

| # | Feature | Roadmap | Why it is core |
| --- | --- | --- | --- |
| C1 | Figure review and correction | F06 | Trust is the product; a figure the investor cannot dispute is a figure they cannot rely on |
| C2 | Named, versioned calculations exposed in the UI and to agents | F08, MCP M2 | Growth, margin and ratios without model arithmetic; the input to every later change rule |
| C3 | Thesis and notes with evidence links and a review date | F10 | The activation event; the anchor for "does my thesis still hold?" |
| C4 | Holding links to its company's research | F14 | Joins the two halves already built; small effort, large effect |
| C5 | PDF accuracy baseline and an honest in-PDF check | F16 | A release gate, not a feature; without it no figure can be called reliable |

**Core: make the loop run on its own (after C1–C5)**

| # | Feature | Roadmap | Note |
| --- | --- | --- | --- |
| C6 | Automatic filings for held and watched companies | Not in the roadmap | The bridge from Holdings to Documents and the prerequisite for any monitoring. ADR 0007 rejected scraping; the source needs a decision (an official feed, a licensed provider or the exchange's published XBRL) |
| C7 | Filing and fact-change detection against the thesis | F25, F26 | The first honest autonomous step: "a new filing changed a figure your thesis depends on; here is the page" |
| C8 | Review queue and digest | F27, the due panel | Already designed on the synthetic overview |

**Supporting: built, keep healthy**

Sign-in and workspaces; Documents intake; Research tables and stock summary; Zerodha holdings; local search; the MCP server; market mood; the evaluation harness; the design system.

**Candidates to add, not yet in the roadmap**

| Candidate | Value | Why consider it |
| --- | --- | --- |
| Holdings from the depositories' consolidated account statement (CAS) | Every broker's equities and mutual funds in one monthly PDF, with no per-broker sign-in | Maester already reads PDFs; it removes the daily Zerodha sign-out pain for a monthly view and covers brokers with no API |
| Holdings through the Account Aggregator | Consent-based, depository-sourced holdings for many users | CDSL and NSDL are live as financial information providers; this is the scalable route for a hosted product, but it needs a licensed aggregator partner and FIU onboarding |
| Search screen | The index exists; only agents can use it | Small UI over a finished backend |
| Data export | Raw facts, notes and holdings as CSV or JSON | PRD principle and a switching-cost reducer; F29 |

**Deliberately later**

Ledger, imports, reconciliation and returns (R2: F17–F24) stay a gated accounting milestone, as planned. Valuation, screener, peers, multi-currency, US filings, sharing and paid plans (P2) wait for usage evidence. Order execution, tax and adviser workflows (P3) stay out.

### 5.3 Built features that need a roadmap entry

These work but have no ID, acceptance criteria or place in a release. Proposed IDs follow the roadmap's numbering:

| Proposed ID | Feature | Acceptance to record |
| --- | --- | --- |
| F53 | Market mood | 10 readings with sources and history; a band only from 5 or more scored readings; never phrased as a call to act; method page public to the user |
| F54 | Document text index and search | Every page indexed, OCR marked; workspace-scoped retrieval; search quality measured in `apps/eval` |
| F55 | Read-only agent access (MCP) | Every figure returned with its fact ID and source; read-only; workspace-scoped; calculations only through the registry |
| F56 | XBRL reader and element maps | Element map versioned; coverage per statement reported; a figure from XBRL never overwritten by a model read |
| F57 | Desktop app (spec only) | Hold until the personal-vs-product decision; it commits to the personal path |

## 6. Requirements

Functional requirements for the core features, in testable form. Where a roadmap ID exists, the roadmap's minimum acceptance still applies; these add what the build has shown is needed.

### 6.1 Functional requirements

**C1 · Figure review and correction (F06)**

| ID | Requirement |
| --- | --- |
| FR-1.1 | The investor can mark any figure as reviewed, disputed or corrected from the figure panel. |
| FR-1.2 | A correction records the new value, unit, period and basis, a reason, the actor and the time, and creates a new fact revision. The earlier revision stays. |
| FR-1.3 | Every view and calculation that used the fact shows that it changed, and recalculates from the active revision. |
| FR-1.4 | A figure's status says in words which of these it is: as filed in XBRL, read by a model, checked, reviewed by you, disputed. No percentage or "verified" badge without a review record. |
| FR-1.5 | Corrections are kept per workspace and are exportable. |

**C2 · Calculations (F08)**

| ID | Requirement |
| --- | --- |
| FR-2.1 | Each metric is a named, versioned function in `@maester/financial-engine` with a fixture whose expected value was worked out independently. |
| FR-2.2 | A result carries its formula, inputs (fact IDs and revisions), version, and a reason when it is undefined (zero or negative base, mixed periods, mixed bases). |
| FR-2.3 | Start with: change and percentage change, margins, growth over n years, return on equity, debt to equity, cash conversion. TTM only from four compatible consecutive quarters. |
| FR-2.4 | The Research page and the MCP server read the same registry; no model computes a figure. |
| FR-2.5 | Price to earnings, the revenue and profit changes and the 52-week position move from `apps/web/src/lib/research/summary.ts` into the engine as decimal functions with fixtures; the web app only formats them. |

**C3 · Thesis and notes (F10)**

| ID | Requirement |
| --- | --- |
| FR-3.1 | The investor can write a thesis per company: why they hold it, what would change their mind, and a next-review date. |
| FR-3.2 | A thesis can link to figures and pages; each link keeps the revision it pointed to. |
| FR-3.3 | A thesis whose linked figure was corrected or restated shows "Evidence changed" until the investor reviews it. |
| FR-3.4 | The thesis is reachable from Holdings, Research and the overview's due panel. |
| FR-3.5 | Saving fails visibly and keeps the draft. |

**C4 · Holding to research (F14)**

| ID | Requirement |
| --- | --- |
| FR-4.1 | Each holding links to its company page when the ISIN or symbol matches a company in the workspace. |
| FR-4.2 | A holding with no company says so and offers to add its latest annual report. |
| FR-4.3 | The company page shows the investor's position (quantity, value, weight) when they hold it. |

**C5 · Accuracy (F16)**

| ID | Requirement |
| --- | --- |
| FR-5.1 | A PDF-read baseline over the held-out gold set is published under `docs/eval/`, stratified by format and basis. |
| FR-5.2 | The in-PDF check is shown only once a check version passes the decoy gate in the XBRL map report. |
| FR-5.3 | Every change to a prompt, mapping rule, check or metric ships with an evaluation run and no regression on the held-out set. |

**C6–C8 · Monitoring (after C1–C5)**

| ID | Requirement |
| --- | --- |
| FR-6.1 | For each held or watched company, Maester fetches new results and annual reports from a permitted source and reads them without the investor dropping a file. |
| FR-6.2 | A change rule compares a new figure with the previous comparable period and with the thesis's linked figures, using the calculation registry. |
| FR-6.3 | A due item names the trigger, the evidence (filing, page, figure) and the investor's call, and links to the thesis. |
| FR-6.4 | Items are de-duplicated by cause, can be snoozed, and record when they were reviewed and what was decided. |
| FR-6.5 | "Nothing is due" lists what was checked. |
| FR-6.6 | No due item recommends buying or selling a security until the legal opinion in section 3.3 says which wording is allowed. |

### 6.2 Non-functional requirements that bind now (personal, self-hosted)

The PRD's NFRs (§9) assume a hosted service. These are the ones that matter for the product as it runs today, and most are not written down anywhere.

| Area | Requirement | Measure |
| --- | --- | --- |
| Correctness | Figures shown meet the fact-correctness gate on the held-out set, reported per source (XBRL, PDF) | QUALITY §3; report under `docs/eval/` |
| Traceability | Every figure on screen and from the MCP server resolves to a fact revision and its source | Automated test over the Research and MCP responses |
| Unknown is unknown | No missing input renders as zero | Existing design guard and engine tests |
| Secrets | Broker tokens and data keys encrypted at rest, never returned, never logged | Existing; add a test that scans logs for key prefixes |
| Backup and restore | One documented command backs up Postgres and stored files together, and one restores them; tried once per release | Restore drill on a fresh machine |
| Model cost | Cost per filing read is recorded, and a configurable monthly cap stops new model reads with a clear state | Cost per filing in the job record |
| Ingestion throughput | A folder of 800 XBRL filings finishes without manual help on the reference machine | Timed run, published with the eval report |
| Footprint | The stack, including OCR and the embedder, runs on a 16 GB laptop; the memory budget in the ingestion design holds | Measured peak memory |
| Resilience | A job interrupted by a restart resumes or retries without duplicating facts | Existing worker tests; keep them |
| Upgrade safety | Migrations run forward on a populated database without data loss | Migration test against a fixture database |
| Accessibility | WCAG 2.2 AA; tested at 360, 768, 1280, 1440 px and 200% zoom | Existing DESIGN §8 |
| Maintainability | One maintainer can change a feature from its system description; docs updated with the change | PR checklist |

### 6.3 Non-functional requirements that bind when hosted

Keep the PRD §9 targets (tenant isolation tests, 99.5% monthly availability, RPO 24 h and RTO 8 h, p95 under 500 ms for warm reads, auditability, cost tracking) and add:

| Area | Requirement |
| --- | --- |
| Data rights | Every price, index and holding shown has a recorded source and a licence that permits that display; no use of the investor's personal-use keys for other users |
| Privacy law | DPDP Act duties in place before the May 2027 phase: notice, consent, purpose limitation, erasure, breach notice, a grievance route |
| Regulatory | Product copy and suggestion types match the legal opinion; if Maester registers as an adviser or analyst, AI-tool use is disclosed as SEBI requires |
| Abuse and limits | Per-user upload, model and broker-call limits; rate-limited sign-in (exists) |
| Observability | Job, model and broker failures alert the operator without logging document text or balances |
| Data residency | A hosting region chosen with the privacy and broker terms in view |

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Suggestions count as unregistered investment advice | Medium if hosted | High | Legal opinion before hosted autonomous mode; personal-first; FR-6.6 |
| Market data redistributed without a licence | High if hosted as is | High | Bring-your-own keys while personal; licence before hosting |
| PDF figures wrong and trusted | Medium | High | C1 and C5 before any other user; status in words per figure |
| Scope spread by one maintainer | High (already visible) | Medium | Close the loop before new surfaces; record re-ranking in the roadmap |
| Broker dependency (daily sign-out, per-app fees, API changes) | High | Medium | Snapshot stays readable when signed out (built); add CAS import as a broker-free route |
| Model cost grows with folders of PDFs | Medium | Medium | XBRL-first (built); cost per filing and a cap |
| Free, mature competitors (Screener, Tijori) on tables and ratios | High | Medium | Compete on provenance, the investor's own thesis and monitoring, not on table breadth |
| Market mood read as a timing signal | Medium | Medium | Keep "context, never advice" copy; never tie mood to a suggestion |

## 8. Recommended next priorities

In order, each a small vertical slice:

1. **Holding links to research (C4).** Days of work over finished parts; makes the two halves one product.
2. **Thesis and notes (C3).** Unblocks the activation metric and gives every later change rule something to compare against.
3. **Figure review and correction (C1).** Closes R1 · A as the README already promises.
4. **Calculation registry v1 (C2)**, exposed on Research and through MCP M2.
5. **PDF accuracy baseline (C5)**, in parallel with 1–4, since it needs labelling time more than code.

Then decide the filing source for C6 and start monitoring. Leave a second broker, the desktop app and new market-mood readings until the loop runs.

Metrics while personal: the author's own use is the only signal, so track behaviour, not opinions. Theses written and reviewed per month; filings read per month and the share from XBRL; corrections per hundred figures; time from a filing's publication to it being read. Switch to the PRD's activation and week-four retention once anyone else uses it.

## 9. Open decisions

| Decision | Options | Needed before | Owner |
| --- | --- | --- | --- |
| D1 Audience | Personal and self-hosted; hosted product; both, gated. Decided 1 Nov 2026: personal and self-hosted first; a hosted product is gated by entry criteria (ADR 0010) | Next roadmap re-rank | Product owner |
| D2 Public positioning | Autonomous adviser (README today); evidence-backed research workspace (PRD). Decided 1 Nov 2026: lead with the research workspace; autonomous monitoring is marked planned (ADR 0010) | README update | Product owner |
| D3 Filing source for auto-fetch | Exchange announcements and XBRL; a licensed provider; manual only | C6 | Product + Data |
| D4 Holdings route | Per-broker plugins; CAS import; Account Aggregator | Second broker or hosting | Product + Data |
| D5 Suggestion wording | Information only ("evidence changed"); actions ("review", "trim"). Decided 1 Nov 2026: prompt a review and never tell the investor to trade, until a legal opinion says which wording is allowed (ADR 0010) | C7–C8 copy | Product, with legal advice |
| D6 Roadmap entries for built features | Adopt F53–F57 as proposed; amend | Next roadmap edit | Product |

## Sources

- SEBI's December 2024 amendments to the Investment Advisers and Research Analysts Regulations, including AI-tool disclosure: [Moneylife](https://www.moneylife.in/article/sebi-introduces-major-reforms-for-investment-advisers-and-research-analysts/75888.html), [AZB & Partners](https://www.azbpartners.com/bank/overhaul-of-the-regulatory-framework-for-investment-advisers-and-research-analysts/), [DT Next](https://www.dtnext.in/news/business/investment-advisers-research-analysts-should-disclose-ai-tool-usage-to-clients-sebi-799664). Secondary sources; read the SEBI notifications before relying on them.
- Depositories as financial information providers on the Account Aggregator: [CDSL FIP](https://www.cdslindia.com/Investors/FIP.html), [NSDL FIP](https://nsdl.com/financial-information-provider), [Sahamati](https://sahamati.org.in/depositories-as-fip-on-account-aggregator/).
- DPDP Rules 2025 and their phases: [Hogan Lovells](https://www.hoganlovells.com/en/publications/indias-digital-personal-data-protection-act-2023-brought-into-force-), [AMSS](https://www.amsshardul.com/insight/enforcement-of-the-dpdp-act-and-notification-of-the-dpdp-rules/), [The Week](https://www.theweek.in/wire-updates/business/2025/11/14/del148-biz-dpdp-rules-ld-govt.html).
- Kite Connect and Dhan costs: [broker API notes](2026-10-19-broker-apis.md). NSE data policy: [research report](../RESEARCH.md) §4.

Accessed 1 November 2026. Regulatory summaries are for planning only and are not legal advice.
