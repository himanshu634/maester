# Agents: a plan to introduce them

Status: proposed, 15 October 2026. Not approved. It builds on the [financial data layer](2026-10-15-financial-data-layer-design.md) and [ADR 0006](../../decisions/0006-concepts-calculations-agent-access.md), and takes its starting point from external research on multi-agent investing systems that the investor shared on 15 October 2026 (TradingAgents, FinCon, FinMem, AlphaAgents, MarketSenseAI, ai-hedge-fund, StockBench, "Profit Mirage", FinanceBench). The screen that explains the agents is drawn on a design canvas first (see section 9); nothing under `apps/web` changes before a direction is picked.

## 1. What the research says, and what Maester takes from it

The research recommends about 8 agents for a first version and up to 29 roles in a full build. It arranges them in layers: data and checks, analysts, a bull and bear debate, a portfolio manager, a risk manager with a one-way veto, a human approval step, execution, and a feedback loop. Its strongest findings are about discipline, not about adding more agents:

- Published agent backtests are short, often skip costs, and pick their settings on the test window. In independent tests, most agents do not beat buy-and-hold. Their returns are mostly market and style exposure. Measured after a model's knowledge cutoff, Sharpe ratios fall by about half.
- The two failures that do the damage are wrong numbers (FinanceBench) and look-ahead leakage (a model that remembers prices from its training data).
- The design that holds up is this: models read, argue and explain; code computes, sizes and enforces limits; a person decides.

Maester already has these rules. The data-layer spec (section 10) and the project `CLAUDE.md` ("Financial figures") say that a number is a fact or a named calculation, that the model never computes, and that unknown stays unknown. Large parts of the research's "layer 0" are therefore built or already planned. What is new is a small set of model-run roles that read Maester's figures and write about them.

Maester differs from the research's setting in four ways, and these differences change the plan:

| The research assumes | Maester | So |
| --- | --- | --- |
| US stocks, SEC EDGAR, SPY, DJIA | Indian listed companies; filings the investor adds in Documents; Dhan closes for Nifty 500 shares; FRED for global series | Sources, benchmarks and the macro inputs are Indian. The baseline is the Nifty 500 equal-weight, not SPY. |
| A fund placing orders | One person's own research, read-only (`PRD.md`: the analyst "cannot execute trades") | No execution agent and no order. The output of a run is a review item for the investor. |
| Commercial data contracts | Personal use only; NSE's terms forbid scraping | Social data (X, Reddit) and exchange announcements are sources still to decide, not assumptions. |
| Agents output conviction scores and fair-value ranges | No number a model made up; no confidence scores | An agent states its view in words. Every number it cites is a fact id or a calculation result. Valuation scenarios are the investor's assumptions run through a named metric (F33), never the model's. |

## 2. What already exists for each layer

| Research role | In Maester | State |
| --- | --- | --- |
| Data ingestion | Documents: upload, classify, read (`apps/worker`, `apps/extractor`) | Built |
| Point-in-time guard | Every fact keeps its filing and revision. An evidence cutoff on every tool call (section 5.3) | Facts built; the cutoff is new and goes into the MCP tools |
| Verifier / fact-checker | Reader A and B agreement, the concept, balance and cross-statement checks (data layer, phases 1 and 3), plus the claim check in section 5.4 | Planned; the claim check is new |
| Valuation, ratios, technical indicators | Named, versioned metrics in `@maester/financial-engine` (data layer, section 7) | Planned (phase 1); the price metrics are new (section 4, A4) |
| Market regime | Market mood: 7 scored readings, deterministic | Built |
| Agent data access | `apps/mcp`, a read-only MCP server (data layer, phase 2) | Planned |
| Holdings, position limits | Holdings snapshot (F12–F14); the Overview due panel already has a position-limit check | Holdings is coming soon |
| Decision journal | Saved notes and thesis (F10); Activity | Planned |
| Execution | None | Out of scope |

## 3. The agents

Seven roles for the first version. Three of them run as code. A role marked "model" reads only through the MCP tools and writes only a structured note (section 5).

| # | Role | Runs as | Reads | Writes | May not |
| --- | --- | --- | --- | --- | --- |
| 1 | **Filings analyst** (fundamentals and valuation, merged) | Model | The series, the metrics, open issues, through MCP | A note on growth, margins, returns, leverage and cash conversion, plus red flags (receivables ahead of revenue, a rise in other income, dilution). Each claim cites fact ids or metric results. | Compute, estimate a fair value, or use an uncited figure |
| 2 | **Price analyst** | Code for the indicators, model for the words | Dhan closes; metrics for the trend, 52-week position, volatility and drawdown | A short note on where the share stands against its own history | Predict a price |
| 3 | **Bull researcher** | Model | The notes from roles 1 and 2 | The strongest case for, in two rounds at most, cited | Introduce a figure the analysts did not cite |
| 4 | **Bear researcher** | Model | Same | The strongest case against, cited | Same |
| 5 | **Reviewer** (the research's portfolio manager) | Model | Both cases, the investor's own thesis and rules (F10), market mood | What changed, the stronger case and why, and the conditions that would change the view, written against concepts ("cash conversion below 0.8 for two years"). A stance in words: no change, look closer, or review your position. | Recommend buying or selling, size a position, or override the risk checks |
| 6 | **Risk checks** | Code; model only to explain | Holdings, prices, the investor's limits | Pass or a breach for each check: single-name weight, sector weight, liquidity (days of volume to exit), results due within 10 days, a drop below the investor's own invalidation level | Add risk. It can only flag, shrink or block what the reviewer says. |
| 7 | **Run keeper** (the research's orchestrator) | Code | The run's plan | The run record: steps, cutoff, versions, model calls, time | Decide anything about a company |

Roles added later, each only when its source exists and an evaluation shows it adds something:

- **Results analyst**: quarterly results and the change from last quarter. Waits for data-layer phase 4.
- **Shareholding and governance**: promoter holding, pledges, related parties. Related parties come with phase 5. Shareholding patterns need a source.
- **Macro**: RBI, rupee, crude and US rates from FRED and market mood. Code reads the series and the model writes about them.
- **Announcements and news**: needs a source the investor is allowed to use. NSE scraping is ruled out. Open question 2.
- **Call transcripts**: earnings-call transcripts added in Documents as a new document kind.
- **Social sentiment**: deferred. If added, it is a crowding and risk flag, never a reason to buy. Open question 3.
- **Journal keeper**: dated lessons from past runs, written only from what was known on each date.
- **Attribution**: how each role's past views turned out, so a role that adds nothing is removed.

## 4. Phases

Each phase gets its own implementation plan, lands on `staging`, and ends with an evaluation report under `docs/eval/`. The gates below come from the data-layer phases and from Holdings.

| Phase | Builds | Waits for | Done when |
| --- | --- | --- | --- |
| A0 · Contracts | The note schema, the claim citation contract, the claim check (section 5.4), `evidence_cutoff` on every MCP tool, the `agent_run` tables, and the agent eval cases in `apps/eval` | Data layer phase 2 (MCP) | A model's note that holds an uncited number is refused by code, and a tool asked with a cutoff never returns a later fact |
| A1 · Filings analyst | Role 1, run on demand for one company; its note on the company's Research page and on the Analyst page | A0; data layer phase 1 (metrics) | On the development set: every claim's citation resolves, it refuses where no metric exists, and a person reads 20 notes and records which are wrong |
| A2 · The debate | Roles 3, 4 and 5 on one company: the whole review, Analyst page first | A1 | The bear case finds the planted red flags in the eval companies, and no figure appears in a case unless an analyst cited it |
| A3 · Your portfolio | Role 6, the risk checks, as code in `@maester/financial-engine`, with the investor's limits in Settings. The review becomes a due-panel item on Overview | Holdings (F12–F14) | Every check has fixtures. A breach blocks the "look closer" stance from reading as an add. |
| A4 · Prices and context | Role 2 with the price metrics (trend, 52-week position, volatility, drawdown) as named metrics; market mood as an input to the reviewer | A2; Dhan closes (built) | The price metrics' fixtures pass and the price note cites only them |
| A5 · Learning and proof | Journal keeper, attribution, and shadow tracking: every stance logged with its date, then compared after 6 and 12 months against the Nifty 500 equal-weight and against random picks of the same size | A3 | Six months of shadow results. Only roles that add something stay. |

Weekly by default, and on events: a new filing read, results due, a risk breach. This is a research system, not a trading one. The research's cost lesson (TradingAgents spends about 11 model calls per decision) is handled three ways: filing notes are kept until a new filing arrives, the debate is capped at two rounds, and the expensive roles run only when something changed.

## 5. How a run works

### 5.1 The graph

```text
trigger (weekly, new filing, results due, breach)
  → run keeper fixes the evidence cutoff and the company list
  → filings analyst ─┐
  → price analyst   ─┴→ claim check → bull ⇄ bear (≤ 2 rounds) → claim check
  → reviewer → claim check → risk checks (code) → review item → the investor
```

The order is fixed in code, never chosen by a model. A step that fails stops the run at that step and says so. It never returns a part-run as if it were whole.

### 5.2 Where it runs

The run is a worker job (`apps/worker`) that calls the same functions the MCP tools call, so the agents and the investor's own MCP client see the same answers. Which model provider is open question 4. The extractor uses Gemini on Vertex today.

### 5.3 Evidence cutoff

Every tool takes `evidence_cutoff`, a timestamp. Facts from filings added after the cutoff, and prices after it, are not returned. A run stores its cutoff. Replaying a past run with the same cutoff must return the same inputs. This is the point-in-time guard. It is also how the shadow tracking in A5 avoids look-ahead: the model's own memory of later prices is a separate risk, so stances are only counted from runs made live, never from replays.

### 5.4 The claim check

A model's note is JSON validated against a schema: claims, each with text and citations (fact ids or metric results). Code then scans the text of every claim for numbers, and each number must equal, as displayed, a cited fact or metric result. A note that fails is refused and the step is retried once. A second failure stops the run. This is the research's "verifier", built as code.

### 5.5 What is stored

`agent_run` (trigger, cutoff, company list, versions of the prompts, metrics and taxonomy, state), `agent_step` (role, input ids, output JSON, model calls, time, outcome), and `agent_claim` (text, citation ids, which side). All are immutable and workspace-scoped. The review item links to its run. A correction to a cited fact marks the review "outdated evidence" (F26).

## 6. Rules for every agent

The data-layer answer rules (section 10) apply to every role. These are added:

1. A model reads through tools with a cutoff and writes only schema-valid JSON. Its output is data: never executed, never the authority for a number.
2. No confidence, conviction or probability, in numbers or in words like "high confidence".
3. No advice words. The reviewer's stance is one of three fixed phrases. The decision words belong to the investor.
4. The risk checks can only flag, shrink or block. Only the investor overrides a check, and the override is recorded with a reason.
5. No orders. No broker write access.
6. A change to a prompt, a role, a metric used by a role, or the debate rounds ships with an eval report.

## 7. Evaluation

`apps/eval` gains an `agents` mode over the development set:

- **Citation validity**: the share of claims whose citations resolve and match. The gate is 100%.
- **Refusal**: questions with no metric get "no metric for this", never an estimate.
- **Planted flags**: eval companies with known red flags (receivables ahead of revenue, a one-off gain); the share the bear case finds.
- **Cutoff**: a run at a past cutoff never cites a later fact.
- **Stability**: three runs of the same input; the stance changes in at most one.
- **Cost**: model calls, tokens and time per company.

Forward results (A5) are reported against the Nifty 500 equal-weight and random same-size picks, and only for live runs. They are never quoted on a public page.

## 8. Out of scope

Placing orders. Sizing positions for the investor. Intraday anything. Commercial use of any data source. Any public page that shows a run's output.

## 9. The screen

A design canvas holds the directions for the screen that explains and shows how the agents work. The Analyst page is in the first release and is in the rail as "Soon", so it is the natural home. A new "Agents" rail entry would change `UI_SPECIFICATION.md` §2 and `DESIGN.md` §10. Until a phase ships, the page is the Analyst coming-soon page with the explanation. Once A1 ships, the same layout shows the investor's real runs. There is no demo route. The canvas uses synthetic figures, labelled.

## 10. Open questions

1. **The reviewer's words.** May a review say "consider trimming", or only "review your position"? This plan takes the stricter reading: no advice words.
2. **Announcements.** Which source of company announcements is allowed for personal use? BSE and NSE terms both need checking. Until then, announcements are filings the investor adds.
3. **Social data.** Leave it out, or use Reddit's non-commercial API for personal use as a crowding flag only? X's paid reads are not worth it for one person.
4. **Model provider** for the agents: the Gemini on Vertex the extractor uses, or another. The page never names it.
5. **Holdings first?** A1 and A2 work on a single company without Holdings. A3 needs Holdings. Should Holdings be built before A2?
