# Claude evaluation run, 24 October 2026

The evaluation run that [PR #24](https://github.com/himanshu634/maester/pull/24) owes: the first live read of the dev set with Claude (`claude-opus-5-5`, effort `high`), inside a $200 credit that is good for the night of 24 October only. The investor agreed this plan on 23 October: one filing first to measure real tokens, then a dev subset that fits $200 on `claude-opus-5-5`.

## Before the credit opens

- `ANTHROPIC_API_KEY` in the root `.env`. It is not there on 23 October.
- The branch `feat/anthropic-extraction` checked out, and `uv sync --locked` run.
- No `EXTRACTOR_MODEL` or `EXTRACTOR_EFFORT` in `.env`, so the run uses the defaults the extractor ships with.

## Prices

`claude-opus-5-5`, per million tokens: input $4, cache write $5 (1.25 × input), cache read $0.20, output $20. Thinking is billed as output. Confirm the prices in the Console before the run; the cost formula below uses them.

```
cost = (input × 4 + cache_write × 5 + cache_read × 0.20 + output × 20) / 1,000,000
```

`maester-eval live` prints one line per filing: `tokens in …, cache write …, cache read …, out …`.

## Step 1: one filing

```bash
uv run --locked maester-eval live --only voltas/results-2025-12 --label claude-smoke
```

`voltas/results-2025-12` is the median dev results filing: 17 pages, stratum mid. It shows:

1. That the API takes the schemas. A `MODEL_REQUEST_REJECTED` here means the schema or the request is wrong: stop and fix it before anything else is spent.
2. The tokens of `locate` per page (the whole PDF goes to `locate`) and of each `extract` and `correct`.

Work out from the line: the filing's cost, the input tokens per page, and the cost per statement read (extract and correct, without `locate`).

### Result (run `20261023T170035Z-claude-smoke`)

Complete in 126.9 s. Six calls: 1 locate, 2 extracts (the two income statements, one page each), 3 corrections. Tokens: in 60,954, cache write 4,191, cache read 8,382, out 22,038. That is **about $0.71**, of which output (thinking included) is $0.44. Pages run at about 2,100 input tokens each, so `locate` costs about $0.0084 a page, and a statement read with its corrections about $0.27.

Estimates from these numbers: tier A about $23 (30 filings, 658 pages, mostly June quarters with the income statement only), tier B about $26 (1,407 pages, up to 6 statements each), tier C about $64 (30 filings, 1,013 pages, mostly March year-ends with all three statements). **A + B + C ≈ $113**, under the $170 line, so the run reads all three tiers.

## Step 2: the subset

Fixed before the smoke numbers are known, so the choice of filings cannot follow the results. Add tiers in this order while the estimate stays under **$170** (keep $30 for retries and the estimate's error):

| Tier | Filings | Pages | Why |
| --- | --- | --- | --- |
| A | The newest dev results filing of each of the 30 companies | 658 | Every company once; results filings are cheap |
| B | The median-length dev annual report of each stratum: `ultratech-cement/ar-2025-26` (large, 327), `indian-hotels/ar-2025-26` (mid, 350), `gujarat-state-petronet/ar-2024-25` (small, 215), `bajaj-finance/ar-2025-26` (financials, 515) | 1,407 | One annual report per stratum |
| C | The next-newest results filing of each company | about 650 | A second period per company |

Estimate each filing as: pages × the input tokens per page from step 1 at the input price (for `locate`), plus the statement reads it will need (results: about 4, annual reports: about 6) at the cost per statement from step 1. An annual report's `locate` dominates: at 2,000 tokens a page, 327 pages is about $2.60 of input before any statement is read.

If tier A alone does not fit, read tier A by stratum in the order large, mid, small, financials, and stop at the budget.

Run the subset as one run, with one `--only` per filing:

```bash
uv run --locked maester-eval live --only <id> --only <id> … --label claude-dev-subset
```

Watch the per-filing token lines against the estimate. Stop the run (Ctrl-C keeps every artefact already written) if the running total passes $185.

## What the run can and cannot score yet

On 23 October `data/eval/gold/` is empty and no dev filing is paired with XBRL (no `xbrl-manifest.csv` has been run through `xbrl-pair`). So the run yields artefacts and counts (states, checks passed, model calls, tokens), not accuracy. Accuracy needs one of:

- labelling sheets from the run (`maester-eval export`), checked by the investor and frozen into gold (`freeze`), then `report`; or
- the BSE XBRL instances paired (`xbrl-pair`), read (`xbrl-read`) and compared (`compare`). Neither calls a model, so both can wait until after the credit.

## After the run

1. `maester-eval report --run <run>` and commit the report under `docs/eval/` (`--to docs/eval/2026-10-24-claude-dev-subset.md`), with the subset rule above and the dollars spent.
2. Add the report to PR #24 and say in it what is still owed: accuracy against gold or XBRL, and the held-out run.
