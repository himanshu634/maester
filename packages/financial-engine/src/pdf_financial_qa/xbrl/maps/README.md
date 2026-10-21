# XBRL element maps

One reviewed map per mapped format. A map is a mapping rule (`CLAUDE.md`, "Financial figures"): a change to a
file here, to the parser or to the sums bumps `XBRL_MAP_VERSION` and ships with a `maester-eval xbrl-map` report
under `docs/eval/`.

| File | Format id | Entry points checked | Lines | Ignored |
| --- | --- | --- | --- | --- |
| `in-capmkt.ind_as.json` | `in-capmkt/ind_as` | `in-capmkt-ent-2025-01-31.xsd`, `in-capmkt-ent-2026-01-31.xsd` | 192 | 25 |
| `in-bse-fin.ind_as.json` | `in-bse-fin/ind_as` | `Ind-AS_entry_point_2020-03-31.xsd` | 188 | 17 |

Banking, NBFC and "other than Ind AS" have no map: they are read, write no facts and carry `XBRL_FORMAT_UNMAPPED`.

## File schema

- `format`, `map_version` (`"1"`), `entry_points` (the `schemaRef` file names the map was checked on) and
  `entry_point_differences` (`element`, `only_in`, `note`).
- `elements`: `element`, `statement` (`income_statement`, `balance_sheet` or `cash_flow`), `section`, `order`
  (unique in its statement), `label`, `concept` (an id of `packages/contracts/concepts.json`, or null for an
  "Others" or next-best-fit line). `CashAndCashEquivalentsCashFlowStatement` has a `cash_balance` block: its
  own `order` is unused, and its `opening_order` and `closing_order` place the opening line before the
  cash-flow lines and the closing line after them.
- `sums`: `id` (snake_case), `total` and `parts` (`element`, `sign` 1 or -1). A total has one sum.
- `identities`: two totals that must be equal (`balance`: `Assets` = `EquityAndLiabilities`).
- `ignored`: numeric elements the results print that are not statement lines (ratios, face value, debt and
  segment disclosures). They raise no `XBRL_ELEMENT_UNMAPPED`.

## How each map was drafted

Survey of 21 October 2026, `maester-eval xbrl-elements --instances ~/Personal/maester-filings/xbrl --out
data/eval/xbrl/`, over the 807 files on hand. It read all of them (none unreadable) and found 550 files of
`in-capmkt/ind_as` and 174 of `in-bse-fin/ind_as` (724 Ind AS files), plus banking (49 and 16), NBFC (12 and 4)
and "other than Ind AS" (2). The command writes element names and counts only (`element, files, contexts,
statement_guess`), never a value, and `data/eval/xbrl/` is not under version control.

1. Every numeric element of the two Ind AS CSVs (217 in-capmkt, 205 in-bse-fin) is either a line or ignored.
   A test over the real instances keeps it so.
2. Lines were put in the order and under the section headings of the SEBI results format that the PDFs print
   (statement of profit and loss, assets, equity and liabilities, cash flow). Labels are the PDFs' own words in
   sentence case. The earnings-per-share labels contain "earnings per share", so stitch's per-share rule finds
   them.
3. Concepts were taken from the taxonomy for a line that the taxonomy has. A line it has not, an "Others" line
   and a next-best-fit line have `concept: null`: no guess is stored.
4. The two maps hold the same lines except what each format holds alone. in-bse-fin spells two elements
   `IncomeTaxRelatingToItmes…` (sic) and has `PaymentsOfFinanceLeaseLiabilitiesClassifiedAsFinancingActivities`.
   in-capmkt alone has `ReserveExcludingRevaluationReserves` and the four `TotalOutstandingDues…` lines of the
   trade payables ageing, so only its map has the `trade_payables_current` and `trade_payables_non_current` sums.
   A sum in the second map leaves out the lines its format does not have.
5. Entry points: element sets of the non-dimensional facts are the same in the 2025 and the 2026 in-capmkt entry
   points. The difference is in facts with a member, which the read does not use: the eight `Other…` balance sheet
   lines are also written with a description member in the 2026 entry point (72 to 95 files each), and `Assets` and `Liabilities` are written with a member in 2 files of the 2025
   entry point (the impact of an audit qualification). Each is in `entry_point_differences`.

### Sources of the sums

A sum is the arithmetic the results format prints, not a guess from the data: `Income` = revenue from operations +
other income; `Expenses` = its seven expense lines; profit before exceptional items and tax = income − expenses;
`Assets` = non-current + current assets (+ held for sale and regulatory deferral debit balances, which the survey
shows outside both); `EquityAndLiabilities` = equity + liabilities; the cash-flow totals add the lines the
statement prints, with paid amounts (interest, tax) taken off; the net change before exchange-rate effects =
operating + investing + financing. A quick check on the 724 files (each sum over the lines present in a context,
with a tolerance of n × ½ × 10^−finest decimals, n being the total and the parts present) passes for every sum in
nearly every context; the exceptions are in the table below for Task 5's check to confirm.

## Known filer inconsistencies

Task 5 fills this table from its run on the instances on hand: a filer's sum that does not hold in the
instance itself is listed here, not hidden by a looser tolerance.

| File | Sum id | Period |
| --- | --- | --- |
| (to be filled by the sums check) | | |
