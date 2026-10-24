# XBRL element maps

One reviewed map per mapped format. A map is a mapping rule (`CLAUDE.md`, "Financial figures"): a change to a
file here, to the parser or to the sums bumps `XBRL_MAP_VERSION` and ships with a `maester-eval xbrl-map` report
under `docs/eval/`.

| File | Format id | Entry points checked | Lines | Ignored |
| --- | --- | --- | --- | --- |
| `in-capmkt.ind_as.json` | `in-capmkt/ind_as` | `in-capmkt-ent-2025-01-31.xsd`, `in-capmkt-ent-2026-01-31.xsd` | 192 | 25 |
| `in-bse-fin.ind_as.json` | `in-bse-fin/ind_as` | `Ind-AS_entry_point_2020-03-31.xsd` | 188 | 17 |
| `in-capmkt.banking.json` | `in-capmkt/banking` | `in-capmkt-ent-2025-01-31.xsd`, `in-capmkt-ent-2026-01-31.xsd` | 114 | 24 |
| `in-bse-fin.banking.json` | `in-bse-fin/banking` | `banking_entry_point_2019-09-30.xsd` | 113 | 22 |

NBFC and "other than Ind AS" have no map: they are read, write no facts and carry `XBRL_FORMAT_UNMAPPED`.

## File schema

- `format`, `map_version` (`"2"`, the same in every map), `entry_points` (the `schemaRef` file names the map was checked on) and
  `entry_point_differences` (`element`, `only_in`, `note`).
- `elements`: `element`, `statement` (`income_statement`, `balance_sheet` or `cash_flow`), `section`, `order`
  (unique in its statement), `label`, `concept` (an id of `packages/contracts/concepts.json`, or null for an
  "Others" or next-best-fit line). `CashAndCashEquivalentsCashFlowStatement` has a `cash_balance` block: its
  own `order` is unused, and its `opening_order` and `closing_order` place the opening line before the
  cash-flow lines and the closing line after them.
- `sums`: `id` (snake_case), `total` and `parts` (`element`, `sign` 1 or -1). A total has one sum.
- `identities`: two totals that must be equal (`balance`: `Assets` = `EquityAndLiabilities`, or
  `Assets` = `CapitalAndLiabilities` in the banking maps).
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

## The banking maps

Version 2 of the maps (24 October 2026) adds the two banking maps. The Ind AS maps are unchanged but for their
`map_version`. The evaluation is [`docs/eval/2026-10-24-xbrl-map-v2.md`](../../../../../../docs/eval/2026-10-24-xbrl-map-v2.md).

The survey of 24 October 2026 (the same command, the same 807 files) found 65 banking files from four banks: 49
`in-capmkt/banking` (`IFBanking`) and 16 `in-bse-fin/banking` (`Banking`). The two hold the same numeric
elements, but for three that only `in-capmkt` has: `ReserveExcludingRevaluationReserves` (a line) and
`AmountOfRelatedPartyTransaction…` and `NumberOfStatementsOfDeviation…` (ignored).

1. Every numeric element of the two banking CSVs is a line or ignored; the test over the real instances keeps it so.
2. Lines follow the banking results format: the statement of profit and loss (interest earned and its four parts,
   other income, total income, interest expended, operating expenses, provisions and contingencies, exceptional
   items, tax, extraordinary items, net profit, then the associates' share and minority interest of a consolidated
   result), the balance sheet in the order of the Third Schedule (capital and liabilities first, then assets), and
   the cash flow, which is the AS 3 one: each activity has a total before extraordinary items and a total after.
3. An element the Ind AS maps also have keeps their label and concept, so one element reads the same in every map.
4. Taxonomy version 2 adds the bank lines it lacked (`interest_earned`, `interest_expended`, `operating_expenses`,
   `total_expenditure_excluding_provisions`, `operating_profit_before_provisions`, `provisions_and_contingencies`,
   `reserves_and_surplus`, `deposits`, `borrowings`, `cash_and_balances_with_rbi`,
   `balances_with_banks_and_money_at_call`, `investments`, `advances`, `fixed_assets`). An existing concept is used
   only where the meaning and the sign are the same. So `InterestExpended` is not `finance_costs`, and
   `ReservesAndSurplus` is not `other_equity`. `ProfitLossForThePeriod` has no concept: a bank's net profit is
   printed before the associates' share, which an Ind AS profit for the period includes. The line after the
   associates and minority interest is `profit_attributable_to_owners`. Earnings per share after extraordinary
   items is `eps_basic` and `eps_diluted`; the pair before them has no concept.
5. Ignored: the analytical ratios (CET1, additional tier 1, return on assets, the NPA percentages, the government's
   shareholding), the gross and net NPA amounts, the face value and the segment elements.

### Sources of the banking sums

Interest earned = its four parts; total income = interest earned + other income; operating expenses = employees
cost + other operating expenses; total expenditure = interest expended + operating expenses; operating profit =
total income − total expenditure; profit before tax = operating profit − provisions + exceptional items; after
tax = before tax − tax; net profit = after tax + extraordinary items; the owners' profit = net profit + the
associates' share − minority interest. The balance sheet's two totals add their lines, and `Assets` =
`CapitalAndLiabilities`. In the cash flow, the adjustments to profit and the working-capital changes add to the
adjustments to reconcile profit, which with profit before extraordinary items and tax gives the cash from
operations; each activity's total is its total before extraordinary items + proceeds − payments of extraordinary
items; the investing and financing lines are the Ind AS ones with the AS 3 elements (`…TangibleAssets…`,
`ProceedsFromIssuingShares`).

Exceptional items are added with the sign the filer gives them, as in the Ind AS maps: the files show both
directions, a charge filed negative (HDFC Bank, 8 facts) and a gain filed positive (State Bank of India, 8
facts), and the sum passes on each. Extraordinary items are added the same way; no file on hand has a non-zero
one, so that sign is not yet confirmed by a figure. The drafts were checked on the HDFC Bank and ICICI Bank files
(the manifest's dev set) and then once on State Bank of India and Federal Bank (held out): every sum and the
balance identity pass in every period of the 65 files.

## Signs

An XBRL fact keeps the sign the filer gave it; the read never changes a value or its sign. Cash-flow outflow
elements are positive for an outflow: `IncomeTaxesPaid…`, `InterestPaid…`, `DividendsPaid…`,
`PurchaseOfPropertyPlantAndEquipment…` and the other `Purchase…`, `Payments…` and `Repayments…` lines. So the sums
take them off with sign −1, and a reader that shows these lines as a PDF prints them (in brackets, as a negative)
has to say so itself (Tasks 14 and 20).

`OtherComprehensiveIncome` (in-capmkt) is ignored because it equals `OtherComprehensiveIncomeNetOfTaxes` in all
922 real contexts that hold both: it is the same figure printed twice, and the net-of-tax line is the one mapped.

## Known filer inconsistencies

A filer's sum that does not hold in the instance itself is listed here, with the PDF page that shows the filer got
it wrong, not hidden by a looser tolerance. A row is added only with that page: a sum that fails because the map is
wrong (a missing line, a wrong sign) is fixed in the map instead, with a version bump. The read's test over the
named real instances fails on a failed sum that has no row here.

| File | Sum id | Period | PDF page |
| --- | --- | --- | --- |
| `2025-06-12_MC2024-2025_standalone_Integrated_Finance_Ind_As_533273_1262025142556.xml` | `adjustments_to_reconcile_profit` | Year ended 31 Mar 2025 | Page 19 of the results PDF announced on 28 Apr 2025: the associates line is printed with the opposite sign to the one filed, and the sum passes with the filed sign turned round |

### Failing, not yet confirmed against the PDF

Task 5's read over the 724 Ind AS instances on hand (21 October 2026): 20,257 subtotal checks and 369 balance
identities pass, 16 subtotals are not checked (every part absent), and 5 subtotals fail, all
`adjustments_to_reconcile_profit`, none in a named instance. Task 20's report ([`docs/eval/2026-10-21-xbrl-map-v1.md`](../../../../../../docs/eval/2026-10-21-xbrl-map-v1.md))
confirms the first against its PDF (it moved to the table above). The other four stay here:

| File | Period |
| --- | --- |
| `2024-11-12_SQ2024-2025_consolidated_Main_Ind_As_543358_12112024122644.xml` | Half year ended 30 Sep 2024 |
| `2025-06-12_MH2024-2025_consolidated_Integrated_Finance_Ind_As_543358_1262025203126.xml` | Year ended 31 Mar 2025 |
| `2025-06-24_MC2024-2025_consolidated_Integrated_Finance_Ind_As_543358_2462025185912.xml` | Year ended 31 Mar 2025 |
| `2025-06-24_MC2024-2025_consolidated_Integrated_Finance_Ind_As_543358_246202519124.xml` | Year ended 31 Mar 2025 |

Each passes with the sign of `AdjustmentsForUndistributedProfitsOfAssociates` turned round. That is not a map
error a sign fixes: of the 9 contexts where the element is not zero, 4 pass with it as filed (2 positive, 2
negative) and 5 fail (1 positive, 4 negative), so filers sign it both ways. Each moves to the table above once its
PDF page shows the printed sign; Task 20's report counts them.
