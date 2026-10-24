# Company financials: design

Status: approved for planning, 13 October 2026. Built on staging, 14 October 2026: the Research page and the company page ([DESIGN.md](../../DESIGN.md) section 10).

Design canvas: "Maester Financial Tables", https://claude.ai/artifact/YHy12h78LC5WUBwNynizXQ, page "B · final" (frames F1–F3). Round 1 (Today, A–D) is on the page "Round 1". The user picked "B, with A's figure panel", then asked for "a summary on top about the stock" and a one-year price chart, and declined market value.

## Goal

Research becomes a working page. It answers two questions for a company the investor has added:

- How has this business done, year by year, according to its own filings?
- Where does each figure come from?

`/terminal/research` lists the investor's companies. A company's page shows:

1. A summary of the stock and the business: one sentence, four headline figures and the last year's closing prices.
2. The company's statements: profit and loss, balance sheet and cash flow, consolidated or standalone. The table has one column per financial year, taken from every annual report that has been read.
3. A figure panel for the selected figure. It shows the filing and page the figure came from, whether that page's text contains it, whether its sum adds up, and whether the investor has reviewed it. It has a link that opens the PDF at that page.

This closes Slice A of the [delivery plan](../../DELIVERY_PLAN.md) ("render the company financial table and open the exact source page from a cell") and covers F07 and the read-only part of F06.

## Scope and data

Everything comes from data Maester already has, except earnings per share (below).

- **Statements.** These are the facts of each read annual report's current extraction revision (`getCurrentRevision`). Facts are stored per document revision in `financial_fact`, with `source_reference` and `extraction_check`. A filing counts toward a company only when all three of these hold:
  - its document's `company_id` is that company (the document's, which intake's `decideIntake` keeps equal to the current classification's company; not the fact's, which is a copy taken when it was read);
  - its `intake_state` is `read`;
  - its current classification's kind is `annual_report`.

  Documents uploaded before intake have no classification, so they are not counted.
- **Earnings per share.** The extract prompt doesn't ask for earnings-per-share lines today, so whether one is read depends on the model. This build adds one sentence to the prompt asking for them, under a new prompt version. The extractor also stores a per-share line at scale 1, so its `normalized_value` is rupees a share. A filing read before that gets them only when it is read again ("Read it again" on the slip).
- **Prices.** These are the NSE closes that the market refresher already stores for every Nifty 500 share, as the series `eq:<NSE symbol>` in `market_point`. They come from the investor's own Dhan data. Maester is for personal use only (see [Market mood](2026-10-06-market-mood-design.md)), so prices appear only behind a signed-in session.
- **Quarterly and half-year results** are listed among the company's filings but are not in the table. The table shows financial years only.

## The table: how a company's years are put together

This is a pure module in the API, `apps/api/src/financials/stitch.ts`, with its own tests.

- **Columns.** A column is one period end. Its date is `period_end`, or `as_of_date` for balance sheet facts. Columns are kept separately for each statement and each basis. Facts that have neither date are left out and counted (`unplaced`). The page says how many were left out. A statement and basis whose facts all lack a date still get a table, with no columns and no rows, so the page can say how many were left out instead of "not read yet".
- **Which filing a column comes from.** Each column comes whole from the newest filing that prints that period, so a column never mixes filings. "Newest" means the latest classification `period_end`; when two filings tie, the later revision wins. The column header names that filing ("AR 2025–26").
- **Restated.** An older filing may also print a period that a newer filing now supplies. When the older filing printed a different value for the same line, the cell carries `restated`. That record holds the older filing, its page and the value it printed. The table shows the newer filing's figure. Before comparing, both values are brought to the coarser of their two printed precisions, measured in the table's unit (a value's printed decimals, less the places its decimal point moved into the table's unit; per-share values never move), and the finer one is rounded half away from zero, exactly. So "12,10,543.21" lakh and "12,105.43" crore are the same figure, and a switch between lakh and crore alone is not a restatement. A different status (a dash against a figure) is always a restatement.
- **Rows.** A row is a line, matched across filings by its printed name. The key is the statement, the basis, the normalised section, the normalised label, and the occurrence: the nth time that section and label appear in one column, by `line_order`. Normalising does four things, in this order:
  1. lower-cases the text;
  2. writes "&" as "and";
  3. drops punctuation;
  4. collapses whitespace.

  Row order follows the newest filing. A row that only an older filing prints goes in after the row that comes before it in that filing. A renamed line becomes two rows; each row shows "—" for the years that don't print it.
- **Units.** Each statement and basis has one table unit: the unit of the newest filing's facts, meaning its `scale_factor`, unit label and currency. A cell's value is `normalized_value` divided by the table's scale. If a filing's currency differs from the table's currency, its columns are left out and the response says why. Mixed currencies are never stitched.
- **Per-share lines.** The extractor applies one unit to a whole statement, so an earnings-per-share line in a "₹ in crore" profit and loss gets a scaled `normalized_value`, which is wrong. A row is per-share when its label or section matches "earning(s) per (equity) share" (singular or plural) or the word "EPS", case ignored: `earnings? per (equity )?share|\beps\b`, the same in the API and the extractor. Its cells use the printed `reported_value` as rupees a share, and the row says "₹ a share".
- **Cells.** Each cell has:
  - the value in the table unit, or null;
  - the status, one of:
    - `value`;
    - `dash`: the page printed a dash;
    - `unparsed`: Maester couldn't read what was printed;
    - `missing`: this column's filing has no such line;
  - the text as printed;
  - the source: document, page index, page count, `text_layer_match`;
  - the check (below);
  - the restated record, or null;
  - the fact and revision ids.
- **Checks.** A subtotal's check is the `extraction_check` that has the same statement, basis and period label, and the same normalised subject label. When a subtotal has two (total assets has its section's subtotal and the section-less balance identity), the worst status wins, and the cell carries that check's type (`subtotal` or `balance_identity`). A line that a subtotal lists in `component_labels` gets only that subtotal's own `subtotal` check, never the balance identity, and the cell records its part as `component` with the subtotal's label. A line that no sum covers has no check (`none`, type null). The figure panel words a failed identity on its own: "No. Total assets doesn’t equal equity and liabilities: the page prints {expected}; equity and liabilities come to {actual}, {difference} more|less."

## The stock summary

This is a pure module in the web app, `lib/research/summary.ts`, with tests. It is built from the financials and the stock responses.

- **The sentence.** It is filled in by fixed rules, never by a model. It has two parts.
  - The price part: "{Name} closed at ₹{close} on {Friday 10 October}, {18.4}% {higher|lower} than a year earlier." When there is no close from a year before, it is shorter: "{Name} closed at ₹{close} on {Friday 10 October}." With no company name (the statements did not load) there is no price part.
  - The business part: "In {2025–26} its revenue {grew|fell} {7.7}% to ₹{12,105} crore and its profit {grew|fell} {27.5}% to ₹{1,459} crore."

  A loss, or a year with no earlier year to compare, uses plain wording with no percentage. A loss that opens the business part names the company when no price part comes before it ("In 2025–26 Synthetic Cements made a loss of…"), never a bare "it". A year that does not end in March reads "the year to 31 Dec 2025" inside a sentence. {Name} is the company's display name without a trailing "Limited" or "Ltd". A part whose figures are unknown is left out.
- **The four figures.**
  - **Last close**, with the change on the day as a sign and a percentage.
  - **52-week range**, the low and high of the last 365 days with their dates, and a rule with the close marked on it.
  - **Price to earnings**: the last close divided by the basic earnings per share for the latest year, consolidated if it has years and standalone otherwise; when no basic line is printed for the latest year, the first per-share line that is. The note says "the basic earnings per share" only for a basic line, otherwise "the earnings per share". It shows "—" with the reason in four cases: there is no price, the filing reports in another currency, the earnings per share wasn't read, or the company made a loss.
  - **Which lines.** A line's name is matched without a leading list marker ("I.", "(a)", "1.") or trailing references ("(XI + XIV)", "(Note 25)", "(PAT)"); profit names include "Profit (loss) for the period", "Profit after tax" and "Net profit after tax". The first matching line that the latest year prints is taken, so a line only an older filing prints never hides it.
  - **Profit for the latest year**, with its change on the year before, and revenue in the note.

  An unknown figure is "—" with its reason, never 0. "No annual report read yet." is said only when no filing is counted; when one is but its profit and loss has no dated figure, the reason is "The profit and loss has no figures Maester could place by year."; when the statements did not load, "The statements didn’t load."
- **The price chart.** It shows the last 365 days of closes, drawn as Market mood's chart draws a reading: an ink line, the price's own domain in whole steps, month labels, the year's low and high marked, the last point labelled, and "Show as a table". There is no chart when there is no price.
- **No price.** The figures say why:
  - the company has no NSE symbol;
  - Dhan isn't connected ("Connect Dhan in Settings to see prices.");
  - Maester has no closes for the share ("Maester has no closes for this share yet. It keeps prices for Nifty 500 shares, from your Dhan data."). `not_tracked` also covers Dhan connected with no fetch yet, an expired token and a symbol in another form, so the copy claims only what is known.
- **Never advice.** The summary never uses the words buy, sell, cheap, expensive, undervalued, overvalued, target or opportunity. A change is shown with a sign or a word, never a colour. Market value is not shown, because Maester doesn't read the number of shares.

## System

- **API.**
  - `GET /v1/workspaces/:ws/research/companies`: the workspace's companies, each with:
    - the number of annual reports read;
    - the latest year read;
    - the number of filings being read;
    - the number of filings that didn't read.
  - `GET /v1/workspaces/:ws/companies/:id/financials`: the company, its filings (every document of the company with its kind, period and state), and the stitched tables for each statement and basis that has facts.
  - `GET /v1/workspaces/:ws/companies/:id/stock`: the state (`ok`, `no_symbol`, `not_connected`, `not_tracked`) and, when the state is `ok`:
    - the last close and the close before it;
    - the close a year earlier;
    - the 365-day low and high, with their days;
    - the 365-day series.
  - `GET /v1/workspaces/:ws/documents/:id/file`: a 302 redirect to a short-lived signed download URL, with `Cache-Control: no-store`. The browser keeps the `#page=N` fragment across the redirect, so a plain link opens the PDF at the page.
- **Contracts.** `packages/contracts/src/research.ts`. The web app mirrors it by hand in `apps/web/src/lib/research/types.ts`, as it does for documents and market mood.
- **Web.**
  - `/terminal/research` is the company list.
  - `/terminal/research/company?id=<uuid>` is the company page. Every route is prerendered, so the page reads the id in the browser.
  - Both pages use `SignedInPage` with the page key `research`, so Research stays the current page in the rail.
  - Research loses its "Soon" mark and its coming-soon page.
  - The Documents slip gets "See the figures" once a document is read and its company is confirmed, and an outline "Read it again" once it is read, which posts `POST /documents/:id/extract` (a filing read before the earnings-per-share prompt gets them this way). Both are secondary actions.
  - The copy goes in `lib/content/research.ts`. The logic, kept free of Svelte and tested, goes in `lib/research/`.

## States

| Where | State | What the page says or does |
| --- | --- | --- |
| Research | loading | Hatch rows and the status line "Loading your companies." |
| Research | failed | A section issue with "Try again". |
| Research | no companies | "Nothing here yet. Add a filing in Documents and its company appears here once it's read." with the link. |
| Research | a company with no annual report read | Its "where it stands" column says what is happening, in words: "Reading 1 filing", "1 filing didn't read" or "No annual report read yet". |
| Company | no or unknown id | "This company isn't in your workspace." with "Back to Research". |
| Company | loading | Hatch for the summary and the table, and one status line. |
| Company | financials failed | A section issue for the statements, with "Try again" (it asks for the statements alone). The summary keeps its prices and chart; its business figures are "—" with "The statements didn’t load.". If the prices failed too, one section issue for the page. |
| Company | stock failed | A section issue for the summary's prices only. The business figures still show. |
| Company | no annual report read | "No annual report for {Name} has been read yet." with a link to Documents. |
| Company | a statement or basis not read | "No standalone balance sheet has been read yet." in place of the table. |
| Company | a statement read, but no figure has a date | "{n} figures had no date and are left out." in place of the table, not "not read yet". |
| Company | figures left out | A note: "{n} figures had no date and are left out." or "{Filing} reports in another currency and is left out." |
| Figure panel | figure in the page's text | "Found in the page's text". |
| Figure panel | page has no text layer (scanned) | "Page 213 (scanned): not checked against its text". |
| Figure panel | figure not in the page's text | "**Not found.** The page's text doesn't contain {printed}." |
| Figure panel | sum fails | "**No.** The lines add up to {actual}; the page prints {expected}, {difference} {more or less}." |
| Figure panel | balance identity fails (total assets only) | "**No.** Total assets doesn’t equal equity and liabilities: the page prints {expected}; equity and liabilities come to {actual}, {difference} {more or less}." |
| Figure panel | dash or unparsed | "Printed as a dash. Maester doesn't read it as zero." or "Maester couldn't read what page {n} prints here." |

## Accessibility

- The table is a real `<table>` inside a labelled `.scroll-x` region that can take focus.
- The line names are `<th scope="row">` cells, sticky on the left.
- Each figure is a `<button aria-pressed>`. One roving tab stop: the arrow keys move between figures, and Home and End jump to the ends of a row.
- From 1024px the figure panel is a column beside the table. Below that it sits under the table, and selecting a figure moves focus to the panel's heading. "Back to the table" returns focus to the figure.
- Each unknown or missing cell has its reason as visually hidden text.
- The summary's figures are a figure strip. The price chart has a text alternative and a table view.

## Out of scope

- Quarterly, half-year and nine-month columns, and a control to switch between years and quarters.
- Correcting a figure, or marking it reviewed (F06 review). "Reviewed" says "Not yet".
- Market value; prices for shares outside the Nifty 500, or fetched on demand.
- The company's Overview, Documents and Notes tabs; the watchlist action; "Ask about this company".
- Drawing the PDF page inside the app (round 1's C), or boxing the figure on the page.
- Search, and a portfolio-context link (Holdings is not built).
