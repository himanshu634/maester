# @maester/financial-engine (TypeScript)

Named, versioned calculations over facts, in `decimal.js`. Each has a fixture whose expected value was worked out by hand, with the working in the test's comments. `apps/web` formats the results and never computes a figure.

Document extraction stays in Python (`packages/financial-engine`, served by `apps/extractor`; [ADR 0004](../../docs/decisions/0004-python-extraction-sidecar.md)).

| Calculation | Version | What it is |
| --- | --- | --- |
| `holding_quantity` | 1 | Settled plus T+1 quantity, summed over the accounts holding an ISIN |
| `holding_cost` | 1 | Each account's quantity × its average price, summed; unknown when a broker reports an average of zero |
| `holding_value` | 1 | Quantity × the NSE close; unknown without a close |
| `holdings_totals` | 1 | Known value over priced rows, cost over costed rows, unrealized gain over rows with both, with counts |
| `holding_weight` | 1 | A row's value ÷ the known value, a per cent to one decimal place, half up |
