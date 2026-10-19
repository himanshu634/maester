# Documents by filing, and the XBRL figure panel: design

Status: picked 19 October 2026. The investor chose direction **C · Filings, not files** on the canvas "Maester Ingestion Screens" (https://claude.ai/artifact/AhK6e5k9RMQvTBogXeibng, boards C1–C4 and the shared words board S1). This document is the screen half of the [ingestion pipeline](2026-10-19-ingestion-pipeline-design.md) spec (on `docs/document-index-design`, §11 and §12). Phase 4 of that spec builds the figure panel's XBRL source from §8 here. Phase 6 builds the Documents screen from §2–§7 here. Nothing is built before the API it reads exists, because no screen runs on synthetic data.

Two things in this document correct the canvas: the bases inside a filing (§3) and where ink blocks are used (§4).

## 1. The idea

The investor thinks in filings: one company and one period. Today the screen thinks in files. Under C, the Documents page groups files by company, and then by filing. A filing's PDF and its XBRL instances sit in one row. Each filing shows its two tracks, Numbers and Text. When the filing is opened, each statement says where its numbers come from. Partial XBRL coverage (spec §6.3.2) and a PDF waiting for its XBRL (`waiting_for_xbrl`) are shown by the structure itself, not added on. A folder of 806 instances arrives as a list of companies to confirm, and each company is confirmed once.

## 2. The page

One `h1`, "Documents", then one sentence: "Your filings, by company. A filing’s PDF and XBRL sit together: numbers come from XBRL when there is one, and every page’s text is indexed." Below that, in order:

1. **The drop strip** (§6).
2. **Not in your workspace yet**: the companies to confirm (§7). It is shown only when there are some, and it comes first because it holds files back.
3. **Working on**: filings with any track not settled, grouped by company. Each company is an `h3` under the section's `h2`, with its codes in muted text. The filings come under it, newest first.
4. **Done**: settled filings, grouped the same way. It is collapsed to each company's newest three filings, with "Show all 9 filings of Synthetic Cements".

From 1024px, Working on and the opened filing sit side by side (the filing about 1.3 times as wide), and Done follows below. Below 1024px everything stacks, with the opened filing first when one is open. At 390px a filing row stacks its title, its files and then the two tracks (C3).

## 3. What a filing is

A **filing** is one company, one period end and one span (quarter, half year, nine months or full year), with the annual report as its own kind. The key is `(company_id, kind, period_end, span)`. It is not the slot of spec §6.3: a filing holds **both bases**. Consolidated and standalone XBRL are separate instances (`500999_Q2_FY27_Consolidated.xml`, `…_Standalone.xml`), and one results PDF often prints both. So:

- A filing lists all of its files: the PDF and up to one XBRL instance per basis.
- In the opened filing, the statement sources (§5) are one table **per basis**, headed "Consolidated" and "Standalone". The two never share a table, a row or a count.
- A file whose company is not confirmed belongs to no filing yet. It shows under §7.
- A file whose period Maester could not tell (`not_sure`) is its own filing, titled by its file name, until the investor says what it is.
- A duplicate (a second copy of a file) is not a separate filing. It shows as "Added twice" on the first copy's filing.
- A kept document (an "other" kind) is a filing of its kind ("Investor presentation, 14 Aug 2026") with Numbers "Not read" and a Text track. Text indexing applies to every stored document.

## 4. A filing row

A filing row has two columns. The left column holds the title, which is an underlined button that opens the filing and moves focus to it, and the files, each as "XBRL · file name" or "PDF · file name" in muted 14px text. The right column holds the two tracks in a 1px muted box: "Numbers" and "Text", each with a bold first line and a muted second line. The words are those of the shared board S1, for example:

| Track | Example first line | Example second line |
| --- | --- | --- |
| Numbers | From XBRL · reading now | The PDF waits for it, so Gemini reads only what XBRL doesn’t cover. |
| Numbers | Read from the PDF · now | No XBRL for this filing. |
| Numbers | Read from the PDF · next | The XBRL is in the banking format, not mapped yet. |
| Numbers | From XBRL · done | 214 of 214 figures found in the PDF. |
| Text | Page 140 of 286 | 38 pages by OCR · 412 passages so far |
| Text | In line, 2 ahead | PDF: 18 pages · XBRL: its notes |
| Text | Done | 22 pages, 4 by OCR · 61 passages · 12 XBRL notes |

**Ink is for the opened filing only** (a correction to C1). In the list a track says its state in words. "Needs you" and "Stopped" are bold, and nothing else is filled. Twenty filings in progress make a list of words, not a page of black bars. In the opened filing, the track that is working is an ink block, as the current step is today.

A count is a count of pages, passages or figures read, never a percentage and never a time left.

## 5. The filing, opened

The filing replaces the slip. It is a 2px box with these parts:

- **Heading.** The heading names the company and the filing, as an `h2`: "Synthetic Cements · results, quarter to 30 Sep 2026". Under it a muted line gives the bases it holds, the number of files and when they were added.
- **Numbers, per basis.** For each basis there is a ledger titled by the basis, with the columns Statement, Numbers from and In the PDF:
  - **Numbers from** says one of four things:
    - "XBRL · quarter and half year" (the spans the instance carries).
    - "PDF, read by Gemini · pages 7–8", with the reason muted underneath: "The quarter’s XBRL has no cash flow".
    - "Not in this filing".
    - "—" with its reason.
  - **In the PDF** is the `xbrl_in_pdf` count for that statement: "Found: 38 of 38". A miss is bold: "Found: 51 of 52", followed by "1 not found: see the figure", which links to that figure in Research. If the check did not run, the column shows its reason instead (§8).
- **Text.** A spec list entry: "Done: 18 pages of the PDF, 2 by OCR, 52 passages; 12 notes from the XBRL". While text is indexing, the entry is the working track's ink block, with "Page 140 of 286" and the counts.
- **Files.** Each file is an underlined button that opens the stored file, with its format and when it was added.
- **Read as.** The classification answers with their evidence, as today. For an XBRL answer, the evidence is the element ("ScripCode 500999"), not a page.
- **Actions.**
  - "See the figures" is a link to the company in Research, shown once the company is confirmed and some numbers are read.
  - "Read it again" is an outline button. It reads every file of the filing again.

While any track of the open filing is working, the filing asks the API every 2 seconds, as the slip does today, and stops under the same rules.

## 6. Adding files

The drop strip says "Drop PDFs or XBRL files here" and offers two outline buttons: "Choose files" (`<input type="file" multiple accept="application/pdf,.xml,application/xml,text/xml">`) and "Choose a folder" (`webkitdirectory`). The limit is said before anything is chosen: "PDF or XBRL (.xml), up to 50 MB a file. A whole folder works too." Dragging is never the only way in.

- **Checked in the browser, per file:** the type (by extension and the first bytes), the 50 MB limit, and a size of 0. A refused file is never sent.
- **Sending.** One line inside the box: "Sending 214 of 806 files from bse-xbrl…", with the ruler. Files go up a few at a time (four), not all at once. Files already sent are worked on at once. Closing or reloading the tab while files are still sending asks first. Moving to another terminal page does not stop sending.
- **Sent.** "806 files sent from bse-xbrl." The strip takes files again.
- **Refused.** One Notice per batch, never one per file: "3 of the 806 files weren’t added.", then a list naming each file and why, and an outline "Choose files to add". The API's `UNSUPPORTED_TYPE` and `UPLOAD_TOO_LARGE` use the same words.
- **Said aloud.** "Sending 806 files." once at the start. "806 files sent. 31 companies need you." once at the end. Each new question is announced once ("Coastline Bank needs you: confirm the company."). Track changes are not announced: the page says them.

## 7. Companies to confirm

Files whose company is not in the workspace are held, as today. Under C they are grouped by the identity they print: the CIN, then the BSE code (`ScripCode`), then the ISIN, then the NSE symbol, matched as the worker matches companies. Each group is one row:

- the name as printed;
- the codes, muted;
- "9 filings · 26 files";
- "Add Coastline Bank" and an outline "It’s one of mine", which opens the company picker with matches first.

The first row's Add is the screen's one primary action. Every other Add is outline. Rows are ordered by file count, largest first; past four rows the list shows "27 more companies" with a "Show all" button. **Confirming releases every held file of that identity at once.** Each of those files goes on as if it had been confirmed singly (`decideIntake`, then `waiting_for_xbrl` where it applies).

A file with no company printed on its first pages ("meridian-q2.pdf") is not a group. It is a Notice under the same section: "meridian-q2.pdf: which company is this?" with "Say which company". A single file whose company matches one of the investor's companies is asked as today: "Which of your companies is this?"

## 8. The figure panel for an XBRL figure

In Research, an XBRL fact is selected like any other figure. The panel keeps today's shape: the line, statement, basis and period, the figure and its unit, then a spec list. Its entries for an XBRL fact are:

| Term | Words |
| --- | --- |
| From | "Results for the year to 31 Mar 2026: the XBRL filed with the PDF", or "…: the XBRL file" when no PDF of the filing is stored. Under it, muted: "500999_Q4_FY26_Consolidated.xml · tagged RevenueFromOperations". |
| Unit | "₹ crore, as the filing declares; rounded to the lakh" (from the declared rounding and the coarsest `decimals`) |
| In the PDF | The `xbrl_in_pdf` outcome, in these words (S1): passed "Found on page 5 of the results PDF."; failed "**Not found on the PDF’s statement pages (4–6).** The figure stays as filed in XBRL. Check the PDF yourself."; not checked "Not checked: no PDF of these results is in your documents." / "…: the PDF’s statement pages are scanned, so their text can’t be searched." / "…: Maester didn’t find the statement pages in the PDF." / "…: the check is turned off." |
| Adds up | As today, from the element map's sums |
| Restated, Used in, Reviewed | As today |

The panel never shows a context id (`OneD`, `FourD`) or a confidence. The period comes from the context's dates.

**The button.**
- If the check found the value, the button is "Open the results PDF at page 5", the page the match was on (contract ask 6). Under it: "The page where the check found this figure. The XBRL file itself has no pages."
- If the check failed, or found the value without a recorded page, the button opens the PDF at the first statement page: "Open the results PDF at page 4", with "Where the statement pages start. The XBRL file has no pages."
- If there is no PDF of the filing, there is no button, and "In the PDF" says why.

**The table's note** changes to: "Each year comes whole from one filing: an XBRL filing first, otherwise the newest filing that prints it, so a column never mixes filings or sources." When a year's statements come from different sources (P&L from XBRL, cash flow from the annual report), a muted spec list under the table says so per year (C4).

Where XBRL figures appear at all is the open question in §11.

## 9. The contract C needs

The `pipeline` object of spec §11 is per document. C needs the following on top of it. Each is a change to the ingestion spec's §11 and to phase 4's plan. They are listed here so those plans pick them up.

1. **The source per statement and basis.** Today `numbers.source` is one value per document. Needed: per filing, for each `(basis, statement)`, the source (`xbrl`, `pdf`, or none), the XBRL document and the spans it carries, the PDF pages Gemini read, and the reason a statement has no XBRL ("the quarter’s XBRL has no cash flow").
2. **What a waiting PDF waits on.** `numbers.state = "waiting"` needs `waiting_on: DocumentId[]`. `covered_by_xbrl` exists only for `not_needed`.
3. **An unmapped format.** `XBRL_FORMAT_UNMAPPED` is a revision warning only. The track needs it as a state or a reason (`numbers: { state: "not_read", reason: "format_unmapped", format: "banking" }`), and the PDF's own track then shows its Gemini read.
4. **Queue position for text.** `text.state = "waiting"` needs `ahead: number`: the count of queued `document.index` jobs in front of it, oldest first, as the runner claims them.
5. **Confirm a company once.** `POST …/companies/confirm` takes a printed identity and either a new company or an existing one. It confirms every held document in the workspace that prints that identity, in one transaction, and returns the count. The held list needs grouping by identity with file and filing counts.
6. **The page of an `xbrl_in_pdf` match.** The check's result records the page index where the value was found, with the PDF document id. The not-checked reasons are separate codes (`no_pdf`, `scanned`, `no_statement_pages`, `disabled`), not one value.

**Where the grouping lives.** The filings read is a server route, `GET /v1/workspaces/:workspaceId/filings` (session required, member of the workspace). Asks 1, 2 and 5 are computed server-side anyway, and a folder of 806 files should not be grouped in the browser from 806 separate document reads. The route returns companies → filings → files, with each filing's tracks and per-basis sources. The held identities come back as their own list. Mapping the route to words lives in `apps/web/src/lib/documents/`, tested and free of Svelte, as today. The route never computes a figure. Counts of files, pages and passages are counts, not financial figures.

## 10. States the page owes

These follow UI specification §14:

- **Loading.** Hatch boxes the size of two company groups and the drop strip, with one status line: "Loading your documents."
- **Failed.** A section issue, "Your documents didn’t load.", with "Try again". Files are never lost.
- **Empty.** "Nothing added yet. Drop a filing above, or a whole folder of XBRL files."
- **One filing's read stopped.** Its track says "Stopped" in bold and the opened filing shows "Try again" for that track only. The other track and the other filings carry on.
- **Offline.** The banner as on every terminal page. A batch that is sending stops with "The upload didn’t finish. 214 of 806 files were sent." and "Send the rest". Files already sent are never sent twice: the hash check marks them as duplicates.

## 11. Open

- **Q4 XBRL for annual years** (the ingestion spec's open question; the investor's call). If yes, an XBRL Q4 instance fills the annual column, and the panel in §8 shows in Research as drawn on C4. If no, XBRL figures appear only once the data layer's phase 4 builds the quarter view, and the panel is the same there. C works either way.

**Decided with the pick**, defaults the investor did not override:
- The element name shows as a muted line under From (C4), not behind a disclosure.
- A company is confirmed once for all its files (contract ask 5).

## 12. DESIGN.md §5 and §10, as amended when the screen is built

This is draft text. It goes into `DESIGN.md` in the same pull request as the build, because `DESIGN.md` describes components that exist.

- **Drop strip** (`DropStrip`): where files come in. A 2px dashed box with "Drop PDFs or XBRL files here", an outline "Choose files" and an outline "Choose a folder", and the limit, "PDF or XBRL (.xml), up to 50 MB a file. A whole folder works too.", stated before anything is chosen. A file held over the box inverts it. Files that are not a PDF or an XBRL instance, are over the limit or are empty are refused in the browser and summarised in one Notice per batch, naming each file and why. While files are sent, the box holds "Sending 214 of 806 files from bse-xbrl…" and the ruler, and closing or reloading the tab asks first. Moving to another terminal page does not stop sending.
- **Filing list** (`FilingList`): replaces the Earlier list. Filings grouped by company (an `h3` with its codes), newest first. Each row is the filing's title (an underlined button that opens it), its files, and the Numbers and Text tracks in words. "Needs you" and "Stopped" are bold, and nothing in the list is an ink block.
- **Filing** (`Filing`): replaces the slip. The company and filing as an `h2`, the sources per basis and statement (a ledger per basis), the text track, the files, Read as, and "See the figures" and "Read it again". The working track is an ink block.
- **Track** (`Track`): one of a filing's two tracks, Numbers or Text. A bold first line and a muted second line in the words of the shared board. It shows counts, never a percentage or a time left.
- **Companies to confirm** (`ConfirmCompanies`): one row per printed identity, with its codes and file and filing counts, "Add …" and "It’s one of mine". The first Add is the primary action. Confirming releases all of that company's held files.
- **Figure panel**: an XBRL figure's From names the filing and the file, with the element as a muted line. In the PDF gives the check in words. The button opens the PDF at the page the match was found on, or else at the statement pages, or does not appear when there is no PDF.
- **§10 Documents**: rewritten to the order in §2.
- **Stage ladder**: removed. Its four steps become the two tracks.
