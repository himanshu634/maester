# @maester/financial-engine (TypeScript)

The named, versioned rules that decide or derive what an investor sees, each a pure function in `decimal.js` with a fixture whose expected values were worked out by hand. `apps/web` formats the results and never computes a figure. Document extraction itself stays in Python (`packages/financial-engine`, served by `apps/extractor`), per [ADR 0004](../../docs/decisions/0004-python-extraction-sidecar.md).

## The source rule (`src/sources.ts`, `SOURCE_RULE_VERSION = 1`)

Which source's numbers a statement shows when a filing comes as both XBRL and PDF:

- `rankSlotCandidates` and `slotOwner`: the revision that owns a slot. XBRL before PDF, then the newer filing period (none last), then the newer revision, then the larger revision id.
- `annualSlotOf`: the annual-table slot a fact fills, or none. A results filing fills no annual column (the investor's Q4 question stays open; see the phase 4 plan). An XBRL fact fills only its year or its own period-end instant; a PDF fact fills its slot as read, comparatives included.
- `planPdfNumbers`: whether a results PDF is `read`, `skip`ped because settled XBRL covers every statement and basis it prints, or held (`wait`) for XBRL that could still turn out to be its company and period. `coveringXbrl` names the covering XBRL alone.

The fixture is `fixtures/source-rule.json`. Its Python twin, `maester_eval.source_rule` in `apps/eval`, is tested against the same file (`tests/test_eval_source_rule.py`), so a change to the rule changes both, bumps `SOURCE_RULE_VERSION` and updates the fixture by hand.

```sh
pnpm --filter @maester/financial-engine test
```

## Holdings calculations (`src/holdings.ts`)

Each fixture has the working in the test's comments.

| Calculation | Version | What it is |
| --- | --- | --- |
| `holding_quantity` | 1 | Settled plus T+1 quantity, summed over the accounts holding an ISIN |
| `holding_cost` | 1 | Each account's quantity × its average price, summed; unknown when a broker reports an average of zero |
| `holding_value` | 1 | Quantity × the NSE close; unknown without a close |
| `holdings_totals` | 1 | Known value over priced rows, cost over costed rows, unrealized gain over rows with both, with counts |
| `holding_weight` | 1 | A row's value ÷ the known value, a per cent to one decimal place, half up |
