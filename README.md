<div align="center">

# Maester

**The open-source portfolio management platform that tracks your portfolio autonomously and tells you what to do next.**

Connect your holdings. Let Maester watch the filings, the prices, the dividends, the global cues and your own thesis. When something needs your attention, it hands you a suggested action with the evidence behind it. When nothing does, it tells you to stay put.

[![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange.svg)](#where-we-are-today)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--or--later-brightgreen.svg)](LICENSE)
[![Contributing guide](https://img.shields.io/badge/contributing-guide-blue.svg)](CONTRIBUTING.md)
[![X](https://img.shields.io/badge/X-@himanshu__btw-black.svg)](https://x.com/himanshu_btw)

[The opportunity](#the-opportunity) · [Autonomous mode](#autonomous-mode) · [How Maester is different](#how-maester-is-different) · [Roadmap](#roadmap) · [Join the build](#join-the-build) · [Talk to me](#talk-to-me)

</div>

---

## The opportunity

Managing a portfolio well is a full-time job that almost nobody has time for. Holdings sit across broker dashboards. Annual reports pile up unread. Dividends land unnoticed. A position quietly grows to a third of the portfolio. The thesis that justified a purchase two years ago lives in a forgotten spreadsheet, and nobody checks whether it still holds.

The tools on the market are passive. Portfolio trackers show you a number and wait. Research terminals show you a filing and wait. Robo-advisers act, but on a generic model portfolio with no idea why you own what you own. Every serious investor ends up doing the monitoring by hand, late, or not at all.

**The gap is an autonomous layer that does the watching, does the reconciling, and turns what it finds into concrete, evidence-backed suggestions.** Not a chatbot that summarizes. Not a black box that trades. A tireless analyst that knows your portfolio, reads what the companies publish, and tells you exactly which decision is now due and why.

### Why now

- **Document extraction finally works.** Multimodal models can turn an annual report into structured financial statements in one pass. Maester already does this today.
- **The raw inputs for autonomy exist.** Brokers export complete tradebooks. The SEC publishes filing and XBRL data with no key required. End-of-day prices and corporate actions are available to license. The pieces to keep a ledger current without manual entry are all there.
- **Trust is the unmet need.** Investors are drowning in AI-generated opinions with no citations. The scarce thing is a suggestion you can click through to the fact, the page and the calculation that produced it.

### The wedge

Start India-first with long-term equity investors. Import holdings once, let Maester keep them reconciled, and let it read the filings for the companies you own. The first autonomous loop is small and honest: watch, detect a meaningful change, suggest a review, show the evidence. Then widen it to performance, income, concentration and rebalancing as the accounting foundation earns trust.

> **Honest framing.** The commercial hypothesis is that investors will pay for a system that does the monitoring and reconciliation they currently skip, and that surfaces decisions early enough to matter. It is unvalidated. The [research report](docs/RESEARCH.md) lays out the evidence, the comparable products, and the interviews still needed. We would rather publish the reasoning than the hype.

## Autonomous mode

Autonomous mode is the product. You set the scope; Maester runs the loop.

```text
Watch ──► Detect ──► Verify against evidence ──► Suggest an action ──► You decide ──► Record the outcome ──► Watch
```

**What Maester watches on its own**

- Your ledger: imports, duplicates, unexplained cash differences, positions that no longer reconcile to a statement.
- The companies you own: new filings, restated numbers, changes in revenue, margins, cash flow and debt against your saved thesis.
- Your exposure: concentration by security and sector, drawdowns, drift from the allocation you set.
- Your income: declared versus received dividends, upcoming distributions, reinvestment gaps.
- Global cues: rate decisions, currency moves, commodity swings, index and sector shifts, and macro events in the markets your holdings depend on, checked against whether your portfolio actually needs to move or not.
- Your own deadlines: the review date you attached to every thesis.

**What a suggestion looks like**

Every suggestion names the action, the trigger, and the evidence. A few examples of the kind of thing Maester is built to say:

- *Review your thesis on this holding.* The latest annual report shows operating cash flow down year over year, against a thesis that depended on cash generation. Here is the page.
- *Trim this position or confirm you accept the concentration.* It has grown from 12% to 31% of the portfolio since your last review.
- *Reconcile this account.* Three trades in the imported tradebook have no matching cash movement.
- *Record this dividend.* A distribution was declared for a company you hold and no receipt appears in your ledger.
- *Re-check this number.* The extraction for this cell failed a subtotal check; the answer you saved last quarter depends on it.
- *No movement needed.* Crude is up 18% this quarter, but none of your holdings has meaningful input exposure to it. Here is the coverage that check was based on.

**What Maester will never do on its own**

- Place an order or move money. Execution stays with you and your broker.
- Change your ledger, your facts or your thesis silently. Every correction carries a reason and a revision.
- Present a guess as a fact. When the evidence is missing, the suggestion says so and asks for the input instead.
- Push you to trade more. Suggestions are ranked by relevance to your stated thesis and risk, not by activity.

Every suggestion is traceable: from the action, to the trigger, to the financial fact, to the page it came from, to the calculation, to the thesis it affects. That traceability is what makes autonomy trustworthy, and it compounds. Every verified fact, corrected extraction and recorded decision makes the next suggestion sharper.

## How Maester is different

| Most tools | Maester |
| --- | --- |
| Show a dashboard and wait | Watches continuously and tells you which decision is due |
| Generic model portfolios | Suggestions grounded in your own holdings, thesis and risk tolerance |
| AI chat that summarizes | An Analyst that can only cite stored evidence and explain deterministic calculations. It abstains when the evidence is missing |
| A number on a screen | The number, the page it came from, the unit, the period and the reporting basis |
| Treat missing data as zero | Treats unknown as unknown. Coverage shrinks; risk and value are never silently understated |
| Infer performance from today's holdings | Refuses to fabricate return history. Snapshot mode and ledger mode are separate, labelled inputs |
| One blended return figure | Time-weighted and money-weighted returns with the method, interval and cash-flow boundary disclosed |
| Black-box automation that trades | Suggests, explains, and records. Never executes |
| Lock your data in | Exports raw inputs, extracted values, notes, methods and every suggestion with full precision |
| Closed SaaS | Open source, self-hostable, built in public |

These are design principles, not marketing lines. The [product requirements](docs/PRD.md) spell out the full list.

## Where we are today

Maester is pre-alpha. A working document engine can already extract a financial-statement PDF into structured statements, run arithmetic sanity checks, and answer questions about it from the command line. A static web index page in `apps/web` explains the workflow and the accuracy approach and carries the design system every later screen follows ([DESIGN.md](docs/DESIGN.md)). The autonomous loop, the ledger, the web application's investor journeys and the hosted runtime are fully specified and not yet built.

We say this plainly because trust is the whole product. The [contributing guide](CONTRIBUTING.md) lists exactly what works, what does not, and how to run it.

## Roadmap

Priorities are ordered by investor value and dependency, not by calendar. Each release has an explicit exit gate in the [delivery plan](docs/DELIVERY_PLAN.md).

| Priority | Investor outcome | Scope |
| --- | --- | --- |
| **P0 · R1** | Know what you own and inspect the evidence behind it | Identity, holdings snapshot, durable uploads, versioned facts with page provenance, source reader, financial tables, deterministic calculations, evidence-backed Analyst, thesis notes and watchlists |
| **P1 · R2** | Know what the portfolio actually earned, kept current without manual entry | Decimal ledger, tradebook import, reconciliation, dividends and corporate actions, TWR and XIRR, benchmarks |
| **P1 · R3** | Autonomous monitoring and suggested actions | Filing and fact-change detection, thesis review triggers, alerts and digests, portfolio-scoped Analyst, income calendar, concentration and drawdown, exports |
| **P2 · R4** | Broader decision support | Rebalancing simulation, valuation scenarios, peer comparison, screener, broker connections, multi-currency, funds and ETFs, US filings, sharing, reports, paid plans |
| **P3** | Specialist operating models | Adviser workflows, tax reporting, factor attribution, backtesting, and execution only as a separately scoped initiative |

The [feature roadmap](docs/FEATURE_ROADMAP.md) lists every feature with acceptance criteria and dependencies.

## Join the build

Maester is open source because software that suggests what to do with your money should be inspectable, and because the best investors are also the best product critics. There is real, well-specified work at every level.

- **Builders** who want to ship the first loop: import holdings, read a filing, detect a change, suggest a review with the page attached.
- **Investors** who keep a spreadsheet, hold a research subscription, or use more than one broker. Your last unexplained portfolio difference is the research we need.
- **Accounting and finance minds** who enjoy tearing apart return conventions, corporate-action edge cases and what counts as a meaningful change.
- **Data partners** with permissioned sample filings and broker exports.

Everything you need to get started, from setup to engineering rules, is in the **[contributing guide](CONTRIBUTING.md)**. The [documentation index](docs/README.md) covers the product and engineering specifications.

### Talk to me

Maester is built by Himanshu Mendapara. Ideas, criticism, data partnerships and commercial licensing all reach me the same way.

[GitHub @himanshu634](https://github.com/himanshu634) · [X @himanshu_btw](https://x.com/himanshu_btw) · [himanshumendapra@gmail.com](mailto:himanshumendapra@gmail.com)

## License

Copyright © 2026 Himanshu Mendapara.

Maester is licensed under the [GNU Affero General Public License, version 3 or later](LICENSE). You are free to use, study, modify and share it. If you run a modified copy as a network service, you must offer its source to the people using it.

Contributions are accepted under the [Contributor Licence Agreement](CLA.md). If your organisation cannot use the Affero terms, a commercial licence can be arranged. Get in touch.

---

<div align="center">

**Your portfolio, watched around the clock. Every suggestion backed by evidence. Every decision still yours.**

Star the repo to follow along. Open an issue to tell us where we are wrong.

</div>
