# Ingestion phase 6: the Documents screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Documents page shows filings, not files, as direction C ("Filings, not files") draws them:
- the drop strip takes PDFs and XBRL files;
- "Not in your workspace yet" confirms a printed company once for all its files;
- "Working on" and "Done" group filings by company, each filing with a Numbers track and a Text track;
- the opened filing gives each statement's source per basis.

Research's figure panel also gets words for an XBRL figure, which has no page.

**Architecture:** The page reads `GET /v1/workspaces/:ws/filings` (phase 4) and turns it into a view model in new Svelte-free modules under `apps/web/src/lib/documents/`:
- `tracks.ts`: the two tracks' words;
- `sources.ts`: the per-basis statement sources and which files a button acts on;
- `filings.ts`: sections, titles, the opened filing, polling and merging;
- `confirm.ts`: the companies to confirm.

Each module is tested in node Vitest. Four new components render them: `Track`, `FilingList`, `Filing` and `ConfirmCompanies`. They replace `Slip`, `StageLadder` and `EarlierList`, and `DocumentsPage` is rewritten around them. The open filing polls its own documents every 2 s, and the filings are read again when one of them changes filing. The filings read is polled every 5 s while anything is unsettled. The API gains one route, `POST …/documents/:id/index`, three fields on `FilingFile`, two statement-source reasons, two fields on `pipeline.numbers`, and a finer filing key for `other` and `not_sure` (Decision 4).

**Tech Stack:** SvelteKit 2 with Svelte 5 runes, TypeScript, Vitest 4 (node project), `svelte-check --fail-on-warnings`, ESLint and Prettier, the design guard; Hono, Zod and Drizzle for the one API task.

**Spec:** [`docs/superpowers/specs/2026-10-19-documents-filings-design.md`](../specs/2026-10-19-documents-filings-design.md), all of it (§2–§7 and §10 build the screen, §8 the panel, §12 the `DESIGN.md` text). [`docs/superpowers/specs/2026-10-19-ingestion-pipeline-design.md`](../specs/2026-10-19-ingestion-pipeline-design.md) §11 and §12. [`docs/DESIGN.md`](../../DESIGN.md) §2–§8 and §10. [`docs/UI_SPECIFICATION.md`](../../UI_SPECIFICATION.md) §2, §12, §13 and §14. The names consumed come from the [phase 4 plan](2026-10-20-ingestion-phase-4-xbrl.md) Tasks 14, 16, 17 and 19, as listed in `.superpowers/plans-1-6/phase-4-interfaces.md`. The canvas is "Maester Ingestion Screens", boards C1–C4 and S1. The kit is on `design/ingestion-screens-canvas`: `.claude/skills/design-directions/assets/kit/ingestion.mjs`. The design round is done; this plan draws nothing new.

## Decisions the spec leaves open, and why

1. **The tracks are per filing; `pipeline` is per file.** A filing row has one Numbers line and one Text line. Task 3 fixes the rule that turns a filing's files into those lines. It takes the words of spec §4's table first, then board S1, then words this plan decides. Each case has a test.
2. **"Read it again" never sends a covered PDF to Gemini.** Spec §5 says it "reads every file of the filing again". `POST …/documents/:id/extract` on a PDF creates a paid `document.extract`. A PDF's own `numbers` cannot say whether XBRL covers it now: a PDF that Gemini read before its XBRL arrived keeps `source: pdf` and state `done` after XBRL owns every one of its slots (ingestion spec §6.3.4). That is the normal path for phase 4 Task 21's folder import, which lands on PDFs already read. So the filing's `sources` decide, through `pdfNeeded` (Task 4):
   - an XBRL file is read again through `extract` (phase 4 makes that a free `document.xbrl`);
   - a PDF is read again only when some statement of `sources`, in any basis, has `source: 'pdf'` and `pdfDocumentId` equal to that PDF, or when no statement of `sources` comes from XBRL at all (then nothing can cover it), and never while an XBRL file of the filing is still `now` or `waiting`: its coverage is not known yet, and a folder import lands exactly there, beside PDFs whose Gemini read failed;
   - every other PDF is not read again, whatever its `numbers` say.

   The same test picks the PDFs that a stopped Numbers track's "Try again" sends to `extract`. It reads the numbers only. Text is indexed again only through the Text track's "Try again".
3. **The Text track's "Try again" needs a route.** `pipeline.text` carries no job id. Task 1 adds `POST …/documents/:id/index`, which queues the document's `document.index` job again.
4. **What phase 4's read lacks, and Task 1 adds.**
   - `FilingFile` has no document state. Without `state` and `rejectionCode`, the page cannot tell a refused file from one still being checked, or an abandoned upload from a live one. A finally failed `document.verify` also reads `stored: "now"` for ever. Task 1 adds both fields, maps that failure to `stored: "failed"`, and states that `listFilingRows` returns documents in every state.
   - `FilingFile` has no printed name. A held PDF that prints a name but no CIN, BSE code, ISIN or NSE symbol falls into `unsorted` (phase 4 groups by codes only), and its Notice would say Maester found no company. Task 1 adds `companyNameAsPrinted`.
   - Phase 4 keys a filing by `(company, kind, periodEnd)`. Two `other` documents of different types on one day (an investor presentation and a press release) would be one filing, and so would two `not_sure` instances that keep a period (`XBRL_MIXED_BASIS`). Spec §3 makes each its own filing. Task 1 adds `otherType` to an `other` key and keys a `not_sure` filing by its document.
   - A basis whose XBRL instance failed, or is not read yet, reads `not_in_filing` (no PDF) or `no_xbrl` (with a PDF) in phase 4's sources, so an unknown reads as absent. Task 1 adds the reasons `xbrl_read_failed` and `xbrl_not_read_yet`.
   - A partial XBRL read (rounding missing or mismatched, elements not mapped, nil lines) maps to a clean `done`, and with the PDF `not_needed` Gemini never reads the lines left out. Task 1 adds `partial` and `warnings` to `pipeline.numbers`, so the track and the ledger say it in words.
5. **Where `unsorted` files go.** These are files with no company, the ones `buildFilings` puts in `unsorted`:
   - one still `needs_company` is a Notice under "Not in your workspace yet" (spec §7). It asks "Is this {name}?" when the file prints a name, and "which company is this?" when it prints none;
   - every other one is its own filing, titled by its file name, under the group "Company not known yet". That group goes in Done when nothing more can happen to the file without the investor (`unsortedSettled`, Task 5): refused, an abandoned upload, a failed check, identification stopped, or a kept file whose text is settled. Otherwise it goes in Working on.

   An **abandoned upload** is one rule, `abandonedUpload` (Task 3), used by the Numbers track, `unsortedSettled` and `identifying`, so the three cannot drift apart: a `pending_upload` that this page is not sending.
6. **"Read as" is per file.** Each file has its own classification, and "Change" moves one document. So Read as lists each file under its own `h4` ("PDF · name"). It keeps today's terms, evidence lines and Change forms. `KindForm` is unchanged. `CompanyForm` gains one optional prop, `primary` (Task 8), so it can draw its button as outline when another action is the screen's primary one; its default is today's behaviour.
7. **A held identity that matches a company already added** opens with "Which of your companies is this?" and the picker, matches first and chosen. "Use this company" is that row's action, and "Add …" is outline. This holds for one file or many. Every row confirms through `POST …/companies/confirm`, never through the classification POST.
8. **The opened filing shows both tracks.** Spec §5 lists the per-basis ledgers and the Text entry, and says the working track is an ink block. So the opened filing has a Numbers entry above the ledgers and a Text entry below them. Each is a `Track`, ink while `now`, with "Try again" when it stopped. The Numbers entry uses the list's words (spec §4). The Text entry, once done, uses spec §5's own words ("18 pages of the PDF, 2 by OCR, 52 passages; 12 notes from the XBRL"), through `textTrack`'s `opened` variant (Task 3); while it works it uses §4's words, as §5 says.
9. **"1 not found: see the figure" has no destination yet.** Phase 4 keeps results XBRL out of Research tables (its Departure 6), so a results figure has no cell to link to, and `DESIGN.md` §7 forbids a link to nowhere. The ledger says "Found: 51 of 52" (bold), then "1 not found.", then a link "Open the results PDF at page 4", where the statement pages start. The Research link waits for the open question in spec §11.
10. **Announcements.** These are said:
    - a batch: once at the start, and once at the end;
    - a new question: once;
    - the result of the investor's own action: once.

    Track changes are never said. New questions are held back during a batch, and while any file is still being checked or identified (`identifying(read, ctx)`). An abandoned upload is not "being checked": phase 4 gives every `pending_upload` `stored: now`, so without that rule one abandoned upload would hold every question back for ever. A folder of 806 files keeps being identified for minutes after it is sent, and each 5 s read would otherwise say a new count. So the end of a batch says "806 files sent." alone. Once identification settles, one line says the questions that arrived: "31 companies need you." When one arrives on its own, it is said by name. This splits spec §6's single line "806 files sent. 31 companies need you." in two, because the count is not known when sending ends.
11. **"Send the rest"** (spec §10) sends again the files the batch never tried, plus those that failed offline. The page keeps them as `Picked[]` while it is open. A file that had in fact arrived comes back as a duplicate (hash), which the spec allows. A file that failed offline after its document record was made stays as an abandoned upload, in Done under "Company not known yet", because no document can be removed yet. The Notice says so in one muted line.
12. **Polling.** The two polls are these:
    - The open filing reads its own documents (`GET …/documents/:id`, at most 3) every 2 s while any track is live.
    - The filings read is repeated every 5 s while any other filing in Working on is live. It is read once more when the open filing's work stops.
    - The filings are also read once whenever the 2 s poll sees a file's `state`, `intakeState` or `pipeline.identified` change (`shapeChanged`, Task 5). A file changes filing (identified into a company filing, held for its company, marked a duplicate, kept) long before its work stops: its Text track can stay `now` or `next` for the 30–80 minutes a 300-page report takes to index (ingestion spec §8.4). `applyDocument` patches fields in place and never regroups, so without this read a lone upload would keep its file-name heading and no sources, and a held one would show "Needs you · Confirm the company." with no confirm row. This read also keeps the opened filing's sources and Read as current while it polls (spec §5).

    Neither poll runs while the tab is hidden or the investor is signed out. The page never polls one request per file of the list. A duplicate is settled and not live: it gets no `document.index` job, so its Text track would otherwise read "In line" for ever (Task 3 gives it its own rows).
13. **The XBRL figure panel cannot be reached with real data in this phase**, again because phase 4 keeps results XBRL out of Research. Task 11 builds its words from spec §8 against the `CellSource` `xbrl` variant and tests them with hand-built cells. The browser check (Task 13) cannot reach that branch, and says so. Notes on the data:
    - "Rounded to the lakh" comes from the cell's own `decimals`, because `CellSource` does not carry the coarsest `decimals`. The clause is given only where it agrees with the two places `figure()` shows (Task 11).
    - `CellSource` does not carry the unit the XBRL declares, and stitch converts every filing into the table's unit. So "as the filing declares" is said only when the cell carries a declared unit, which it does not in this phase. Until phase 4 or the data layer adds one (After this plan), the Unit entry names the table's unit and the precision, and leaves the declaration out. This departs from spec §8's words.
    - A restated figure is worded by which source owns the cell, never by "newer": an XBRL filing owns its slot over a newer PDF.
    - A column counts as an XBRL column when its cells' sources are `xbrl`. If phase 4 adds `FinancialColumn.source`, use it instead.
14. **Words the spec does not give** are decided here. They cover the not-checked reasons `no_value` and `not_yet`, a partial text index, a partial XBRL read, a failed or unread XBRL basis, a duplicate, and the waiting, stopped and kept tracks. Each is in the task that owns it, in `lib/content/`.
15. **A file opens as a link.** Spec §5 calls it "an underlined button that opens the stored file". Opening a URL in a new tab is a link's job, so it is an `<a>` to `…/documents/:id/file`, underlined as every link is. Only a file whose `state` is `stored` is a link: that route answers 409 for any other document, and `DESIGN.md` §7 forbids a link to nowhere. A refused, abandoned or still-checked file's name is plain text.
16. **The standing note** "Leaving this page doesn’t stop anything…" goes. Spec §2's order has no place for it. The sending note ("Files are still being sent…") stays under the drop strip while a batch sends.
17. **The opened filing follows its document.** Task 5 holds the whole rule (`pickFiling`, `pin`, `follow`, `waitingAbove`, `shapeChanged`, `answersWanted`). In short:
    - a file that is identified, confirmed or made a duplicate takes the open filing with it, found by the filing that lists it in `files` or in a file's `duplicates`;
    - after the investor's own Change, the open filing follows that file to its new filing (`follow`);
    - a file that becomes held or unnamed while open leaves every filing. The open filing does not fall through to an unrelated one. The filing column says where the file went ("{name} waits for you above.") with "Go to it", and focus moves to its confirm row or Notice when focus was in the filing. One question in one place: the opened filing does not ask the company again, because a confirm there would release one file and leave the rest of that identity held;
    - `Filing` is keyed by `openCount`, which counts the investor's opens, a lone upload's open and a Change that moves its file to another filing. A re-pin by a read never remounts it, so focus stays where it was.
18. **In a track, only "Needs you" and "Stopped" are bold.** Spec §4 and §12 say each track has "a bold first line". Twenty filings in progress would then be a list of bold words, and the two states that want the investor would not stand out. So the first line is weight 400 and bold only for those two, in the list and the opened filing alike.
19. **The waiting Text line names no page count.** Spec §4's example "PDF: 18 pages · XBRL: its notes" cannot show: `text.pages` comes from the index revision, and a PDF waiting for its first index has none. No page count is stored at verify, and adding one is a migration for one line of words. So a waiting PDF reads "PDF", as Task 3's test pins.
20. **Done names a stopped filing it hides.** Phase 4 counts a failed track as settled, so a stopped filing goes to Done, and Done shows each company's newest three. An older stopped filing would sit behind "Show all" and, since track changes are never said, nothing would tell the investor. The default here keeps the spec's newest three and names the count in the button: "Show all 9 filings of Synthetic Cements · 1 stopped". Whether a stopped filing should always show is open question 6.

## Not in this phase

- Where XBRL figures appear in Research (spec §11, the investor's call). Until then the panel's XBRL branch is built and unit-tested only.
- Collapsing Working on. Only Done collapses, as the spec says. During a long text backfill, Working on can hold hundreds of filings (open question 3).
- The quarter view of the data layer's phase 4.
- Any change to a prompt, a mapping rule, the taxonomy, a reader, a check or a metric. So this phase ships without an evaluation run.

## Global Constraints

- **Branch** from `staging` after phase 4 is merged. This plan needs phase 4's Tasks 14, 16, 17 and 19 on `staging`. Base and PR target: `staging`.
- **Real API only.** No demo route, no synthetic adapter, no fixture data in a shipped module. Unit tests build their inputs by hand in `src/lib/documents/testing.ts`, which only test files import.
- **Financial figures** (the `financial-figures` skill):
  - `apps/web` formats and never computes a figure. Counts of files, filings, pages, passages and figures found are counts, not figures (spec §9), so summing them in the web is allowed.
  - No `Number()` on a decimal string in new code. The panel formats with the existing `figure()`.
  - Unknown is "—" with its reason. A nil XBRL value is "—", never zero.
  - The panel never shows a context id (`OneD`, `FourD`) or a confidence.
  - Basis, unit and period stay visible on every figure.
- **Words.** Spec §4–§8 are the words, verbatim, except the departures stated in Decisions 13 (the Unit entry), 18 (bold) and 19 (the waiting Text line). Board S1 fills states the spec does not word; where S1 and the spec differ, the spec wins. Sentence case, curly apostrophes (’). All copy lives in `apps/web/src/lib/content/documents.ts` and `research.ts`.
- **Look.** These rules hold:
  - Nothing in the filing list is an ink block. "Needs you" and "Stopped" are bold there, and nothing else in a track is (Decision 18).
  - In the opened filing, the working track is an ink block, and a check miss is bold.
  - A count is never a percentage or a time left.
  - One primary action per screen, chosen in this order:
    1. the first confirm row's "Add …" or "Use this company";
    2. with no rows, the first unnamed file's "Say which company";
    3. with neither, the opened filing's own question.
- **Design guard.** No colour literal, radius, shadow or transition, and no new token. Breakpoints are 768px and 1024px, plus container queries as the page uses today.
- **Svelte 5 runes.** `$state.raw` for API reads, `$derived` over `$effect`, keyed `{#each}`, `{@attach}` for listeners, no stores. Run the `svelte-autofixer` (`npx @sveltejs/mcp svelte-autofixer <file>`) on every new or changed component before its commit.
- **Gates.** `cd apps/web && pnpm verify` runs `svelte-check --fail-on-warnings`, Prettier and ESLint, Vitest and the build. It passes at every commit that touches `apps/web`.
- **No paid calls.** Tests use fetch fakes. The browser step (Task 13) uploads XBRL files only, which are free. A PDF upload means a Gemini classification, so ask the investor first.
- **No `docker compose up` in a worktree.** The browser step runs from the main checkout, with the investor's go-ahead. Vite runs on its own port, 5175. Stop the pnpm wrapper and the Vite child afterwards, and confirm with `ps`.
- `docs/systems/*.md` are ASD-STE100 Simplified Technical English (the `writing-ste` skill).

## Review Focus

1. **"Read it again" on a filing whose PDF the XBRL covers**, including a PDF Gemini read before its XBRL arrived, which still says `source: pdf`, `done`. No `extract` call goes to that PDF; only the XBRL files are read again (a paid Gemini call avoided). The filing's `sources` decide, never the PDF's own `numbers`. The same holds for "Try again" on a stopped Numbers track. Task 4.
2. **A file that changes filing while it is open.** This happens when it is identified, when its company is confirmed, when it is held for its company or made a duplicate, and when the investor changes its kind. The open filing follows the document (Decision 17), never falls through to an unrelated filing, and never remounts on a re-pin, so focus stays where it was. Tasks 5 and 10.
3. **A refused file, an upload that never finished, or a file whose identification stopped, after a reload.** None sits in Working on for ever. Each sits in Done, under "Company not known yet", with "Stopped" and why. Tasks 1 and 5.
4. **The connection drops 214 files into an 806-file batch.** "Send the rest" sends exactly the untried files and those that failed offline, in the order chosen, and none that went. Task 7.
5. **A filings read that lands after the open filing's own poll.** It never puts a file back to an older state. Task 5.

---

### Task 1: What the screen needs from the API beyond phase 4

**Files:**
- Modify: `packages/contracts/src/filings.ts` (`FilingFile`, `StatementSourceReason`), `packages/contracts/src/pipeline.ts` (`DocumentPipeline.numbers`), `packages/contracts/src/document.ts` (`IndexResponse`), `packages/contracts/src/index.ts`
- Modify: `packages/db/src/queries/filings.ts` (`listFilingRows`), `packages/db/src/queries/pipeline.ts` (`loadPipelineInputs`: the current revision's `state`), `apps/api/src/documents/filings.ts` (`buildFilings`), `apps/api/src/documents/held.ts` (`groupHeld`'s filing count), `apps/api/src/documents/pipeline.ts` (`computePipeline`), `apps/api/src/routes/documents.ts`
- Modify: `docs/systems/api.md` (STE)
- Test: `apps/api/test/filings-build.test.ts`, `apps/api/test/held.test.ts`, `apps/api/test/pipeline.test.ts`, `apps/api/test/filings.test.ts` (phase 4's route test); Create: `apps/api/test/documents-index.test.ts`

**Interfaces:**
- Consumes these:
  - phase 4's `FilingFile`, `StatementSource`, `DocumentPipeline`, `buildFilings(input: FilingsInput)`, `computePipeline(input: PipelineInput, plan)`, `loadPipelineInputs` and `listFilingRows`;
  - `createJob` and `retryJob(db, dispatcher, workspaceId, jobId)` from `apps/api/src/jobs/create.ts`. `retryJob` re-queues only a `failed` or a stuck `queued` job, and answers `INVALID_STATE` for any other;
  - `indexPipelineVersion(model)` from `@maester/document-index` (`"1:<model>"`);
  - `JobTypes.DOCUMENT_INDEX` and `DOCUMENT_INDEX_SUBJECT` from `@maester/contracts`;
  - the API env's `EMBEDDING_MODEL`.
- Produces (Decision 4):
  - **`FilingFile`** gains `state: DocumentState`, `rejectionCode: RejectionCode.nullable()` and `companyNameAsPrinted: z.string().nullable()` (the current classification's, null without one). `buildFilings` copies them.
  - **`listFilingRows`** returns every document of the workspace in every `state`: `pending_upload`, `uploaded`, `verifying`, `stored` and `rejected`. Duplicates come back too, and `buildFilings` lists them under their original's `duplicates`, as phase 4 does. There is no `state = 'stored'` filter: without the other states, a refused or abandoned file would vanish after a reload (Review Focus 3).
  - **The filing key.** An `other` filing is keyed `${companyId}:other:${otherType}:${periodEnd}` (`…:${documentId}` with no period). A `not_sure` filing is always keyed `${companyId}:not_sure:${documentId}`. Every other kind keeps phase 4's key. `groupHeld` counts a held identity's `filings` by the same rule (its rows gain `otherType`), so "9 filings · 26 files" does not change when the company is confirmed.
  - **`StatementSourceReason`** gains `xbrl_read_failed` and `xbrl_not_read_yet`. Where phase 4 gives `no_xbrl` (source `pdf`) or `not_in_filing` (source null), and the filing holds an XBRL instance of that basis, the reason is `xbrl_read_failed` when that instance's numbers are `failed`, and `xbrl_not_read_yet` when they are `now` or `waiting`. Every other reason is unchanged.
  - **`pipeline.numbers`** gains `partial: z.boolean()` and `warnings: z.array(z.enum(["XBRL_ELEMENT_UNMAPPED", "XBRL_ROUNDING_MISSING", "XBRL_ROUNDING_MISMATCH", "XBRL_NIL"]))`. For an XBRL document whose numbers are `done`, `partial` is true when its current revision's state is `partial`, and `warnings` lists the revision's warning codes among those four, in the order `XBRL_ROUNDING_MISSING`, `XBRL_ROUNDING_MISMATCH`, `XBRL_ELEMENT_UNMAPPED`, `XBRL_NIL` (the most serious first, so the track can say the first). Otherwise `partial` is false and `warnings` is `[]`, PDFs included. `loadPipelineInputs` already loads the current revisions with their warnings; it adds their `state`.
  - **`computePipeline`** gives `stored: "failed"` when the document is `uploaded` or `verifying` and its latest job of subject type `document` is `document.verify` in state `failed`. Every other branch is unchanged.
  - **`IndexResponse`** `= z.object({ job: Job })`.
  - **`POST /v1/workspaces/:ws/documents/:id/index`** (session and membership as the other document routes) answers 202 `IndexResponse`. It works as follows:
    - A document that is not `stored`, or is a duplicate, gives 409 `INVALID_STATE` and creates no job.
    - Otherwise it calls `createJob` (type `document.index`, subject type `document_index`, pipeline version `indexPipelineVersion(env.EMBEDDING_MODEL)`), which returns the existing job for that key.
    - A `failed` job goes through `retryJob`.
    - A `succeeded` job gives 409 `INVALID_STATE` ("the index is built").
    - A `cancelled` job gives 409 `INVALID_STATE` ("the index job was cancelled"). Nothing cancels an index job today, and `retryJob` refuses one; `retryJob` is not widened.
    - A `queued` or `running` job is answered as it is.

- [ ] **Step 1: Write the failing tests.** The pure tests build their input with the builders phase 4's `filings-build.test.ts` and `pipeline.test.ts` already have; each comment names what the input holds. The route tests use `createTestContext()`, `ctx.signUp`, `ctx.createCompany` and a `seedDocument` like `extraction.test.ts`'s. This project's Vitest config does not require assertions, so every test below carries its own.

```ts
// filings-build.test.ts
it("an unsorted file carries its document state, rejection code and printed name", () => {
  // input: document "r1", state rejected, rejection_code UNSUPPORTED_TYPE, no classification
  expect(buildFilings(input).unsorted[0]).toMatchObject({ documentId: "r1", state: "rejected", rejectionCode: "UNSUPPORTED_TYPE", companyNameAsPrinted: null });
});
it("two other documents of one company and day, of different types, are two filings", () => {
  // input: company co-1; "p1" other/investor_presentation and "p2" other/announcement, both period end 2026-08-14
  expect(buildFilings(input).companies[0]!.filings.map((f) => f.key).sort()).toEqual(["co-1:other:announcement:2026-08-14", "co-1:other:investor_presentation:2026-08-14"]);
});
// held.test.ts
it("held files count their filings by the same key rule", () => {
  // rows: "p1" other/investor_presentation and "p2" other/announcement, both 2026-08-14, both bse 532999
  expect(groupHeld(rows, [])[0]).toMatchObject({ files: 2, filings: 2 });
});
// filings-build.test.ts
it("two not_sure instances with one period end are two filings, keyed by document", () => {
  // input: company co-1; "x1" and "x2" not_sure (XBRL_MIXED_BASIS), both period end 2026-09-30
  expect(buildFilings(input).companies[0]!.filings.map((f) => f.key).sort()).toEqual(["co-1:not_sure:x1", "co-1:not_sure:x2"]);
});
const standaloneOf = (built: WorkspaceFilings) => built.companies[0]!.filings[0]!.sources.find((b) => b.basis === "standalone")!;
it("a basis whose XBRL failed reads xbrl_read_failed, never not_in_filing", () => {
  // input: company co-1, Q2 results; "xc" consolidated instance read (P&L and balance sheet facts); "xs" standalone instance read_failed; no PDF
  expect([...new Set(standaloneOf(buildFilings(input)).statements.map((s) => `${s.source}:${s.reason}`))]).toEqual(["null:xbrl_read_failed"]);
});
it("with a PDF that prints the standalone statements, the failed basis is read from the PDF and still names the failed XBRL", () => {
  // the same input, plus "p" read by Gemini, statementsFound standalone income_statement on pages 4 and 5
  const income = standaloneOf(buildFilings(input)).statements.find((s) => s.statement === "income_statement")!;
  expect(income).toMatchObject({ source: "pdf", pdfDocumentId: "p", pdfPages: [4, 5], reason: "xbrl_read_failed" });
});
it("a basis whose XBRL is still being read reads xbrl_not_read_yet", () => {
  // input: "xc" read; "xs" standalone, intake reading; no PDF
  expect([...new Set(standaloneOf(buildFilings(input)).statements.map((s) => s.reason))]).toEqual(["xbrl_not_read_yet"]);
});
// pipeline.test.ts
it("a document whose verify job failed for good is stored failed, not now", () => {
  // input: document state verifying; latest job of subject type document is document.verify, state failed
  expect(computePipeline(input, null).stored).toBe("failed");
});
it("a partial XBRL read says so, with its warnings in order", () => {
  // input: an xbrl document, intake read; current revision source xbrl, state partial, warnings XBRL_ROUNDING_MISSING and XBRL_ELEMENT_UNMAPPED
  expect(computePipeline(input, null).numbers).toMatchObject({ source: "xbrl", state: "done", partial: true, warnings: ["XBRL_ROUNDING_MISSING", "XBRL_ELEMENT_UNMAPPED"] });
});
it("a PDF never carries XBRL warnings", () => {
  // input: a pdf document, intake read, a complete Gemini revision
  expect(computePipeline(input, { action: "read", coveredBy: [], uncovered: [] }).numbers).toMatchObject({ partial: false, warnings: [] });
});
// filings.test.ts (route)
it("a refused document and an abandoned upload both come back in unsorted", async () => {
  // seed: "r" rejected UNSUPPORTED_TYPE and "u" pending_upload, neither classified
  const body = WorkspaceFilings.parse(await (await ctx.app.request(`/v1/workspaces/${a.workspaceId}/filings`, { headers: { cookie: a.cookie } })).json());
  expect(body.unsorted.map((f) => [f.documentId, f.state, f.rejectionCode]).sort()).toEqual([[r, "rejected", "UNSUPPORTED_TYPE"], [u, "pending_upload", null]].sort());
});
// documents-index.test.ts (database; fake dispatcher)
const post = (ws: string, id: string, cookie?: string) =>
  ctx.app.request(`/v1/workspaces/${ws}/documents/${id}/index`, { method: "POST", headers: cookie ? { cookie } : {} });
const indexJobs = (id: string) => ctx.db.select().from(schema.job).where(and(eq(schema.job.type, "document.index"), eq(schema.job.subjectId, id)));
it("a failed index job is queued again with its attempts given back", async () => {
  // seed: a stored document with a document.index job, state failed, attempt 5
  const res = await post(a.workspaceId, docId, a.cookie);
  expect(res.status).toBe(202);
  expect(IndexResponse.parse(await res.json()).job).toMatchObject({ id: failedJobId, state: "queued" });
  const [row] = await indexJobs(docId);
  expect(row!.maxAttempts).toBe(row!.attempt + 5);
});
it("with no index job, one is created under 1:<EMBEDDING_MODEL>", async () => {
  const res = await post(a.workspaceId, docId, a.cookie);
  expect(res.status).toBe(202);
  const rows = await indexJobs(docId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ subjectType: "document_index", idempotencyKey: `document.index:${docId}:1:Snowflake/snowflake-arctic-embed-l-v2.0`, state: "queued" });
});
it("a running index job is answered as it is, and no second job exists", async () => {
  // seed: a stored document with a document.index job, state running
  const res = await post(a.workspaceId, docId, a.cookie);
  expect(res.status).toBe(202);
  expect(IndexResponse.parse(await res.json()).job).toMatchObject({ id: runningJobId, state: "running" });
  expect(await indexJobs(docId)).toHaveLength(1);
});
it("a succeeded index job gives 409 INVALID_STATE and is left as it is", async () => {
  const res = await post(a.workspaceId, docId, a.cookie);
  expect(res.status).toBe(409);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_STATE");
  expect((await indexJobs(docId)).map((j) => j.state)).toEqual(["succeeded"]);
});
it("a cancelled index job gives 409 INVALID_STATE and stays cancelled", async () => {
  const res = await post(a.workspaceId, docId, a.cookie);
  expect(res.status).toBe(409);
  expect((await indexJobs(docId)).map((j) => j.state)).toEqual(["cancelled"]);
});
it("a duplicate, or a document not stored, gives 409 INVALID_STATE and no job", async () => {
  // seed: "dup" stored with intake_state duplicate; "up" pending_upload
  for (const id of [dup, up]) {
    const res = await post(a.workspaceId, id, a.cookie);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_STATE");
    expect(await indexJobs(id)).toHaveLength(0);
  }
});
it("another workspace's document is 404; signed out is 401", async () => {
  expect((await post(b.workspaceId, docId, b.cookie)).status).toBe(404);
  expect((await post(a.workspaceId, docId)).status).toBe(401);
});
```

- [ ] **Step 2: Run to see them fail.** `pnpm --filter @maester/api exec vitest run test/filings-build.test.ts test/held.test.ts test/pipeline.test.ts test/filings.test.ts test/documents-index.test.ts`. Expected: FAIL (no `state` on `FilingFile`, phase 4's keys and reasons, no `partial`, `stored` is `now`, 404 on the route).
- [ ] **Step 3: Implement.** Update any phase 4 test that pins an `other` or `not_sure` filing key, or a held filing count, to the new rule. Then add the route, the three fields, the keys, the two reasons and `partial`/`warnings` to `docs/systems/api.md`, in STE.
- [ ] **Step 4: Run the API, db and contracts suites.** `pnpm --filter @maester/api exec vitest run && pnpm --filter @maester/db exec vitest run && pnpm --filter @maester/contracts exec vitest run`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/contracts packages/db apps/api docs/systems/api.md
git commit -m "feat(api): FilingFile carries its document state and printed name; finer keys for other and not_sure; a failed or unread XBRL basis says so; partial XBRL reads; POST …/documents/:id/index queues the text index again"
```

---

### Task 2: The web's mirror types and client

**Files:**
- Modify: `apps/web/src/lib/documents/types.ts`, `apps/web/src/lib/documents/client.ts`, `apps/web/src/lib/documents/intake.ts` (`identifiers`)
- Create: `apps/web/src/lib/documents/testing.ts` (builders for tests)
- Test: `apps/web/src/lib/documents/client.test.ts`, `apps/web/src/lib/documents/intake.test.ts`, `apps/web/src/lib/research/summary.test.ts`. These build `DocumentRecord`, `Company` and `Classification` objects, which gain the new required fields.

**Interfaces:**
- Consumes: the phase 4 and Task 1 contracts.
- Produces (`types.ts`, mirrors of `@maester/contracts`; copy only the fields used):
  - `DocumentFormat = 'pdf' | 'xbrl'`; `FactSpan = 'quarter' | 'half_year' | 'nine_months' | 'year' | 'other'`; `XbrlFormatKind = 'ind_as' | 'banking' | 'nbfc' | 'other_than_ind_as' | 'unknown'`; `XbrlPdfNotChecked = 'no_pdf' | 'scanned' | 'no_statement_pages' | 'disabled' | 'no_value' | 'not_yet'`.
  - `DocumentPipeline`: phase 4's shape (`stored`, `identified`, `numbers { source, state, coveredByXbrl, waitingOn, reason, format }`, `text { state, pages, pagesRead, pagesOcr, chunks, xbrlBlocks, ahead }`), with Task 1's `numbers.partial: boolean` and `numbers.warnings: XbrlReadWarning[]`, where `XbrlReadWarning = 'XBRL_ELEMENT_UNMAPPED' | 'XBRL_ROUNDING_MISSING' | 'XBRL_ROUNDING_MISMATCH' | 'XBRL_NIL'`.
  - `StatementSourceReason` (phase 4's six, plus Task 1's `xbrl_read_failed` and `xbrl_not_read_yet`), `InPdfCount`, `StatementSource`, `BasisSources`.
  - `FilingFile`, with Task 1's `state`, `rejectionCode` and `companyNameAsPrinted`.
  - `WorkspaceFiling`, `HeldIdentity`, `WorkspaceFilings`, `ConfirmCompanyRequest`, `ConfirmCompanyResponse`.
  - `DocumentRecord` gains `format: DocumentFormat` and `pipeline: DocumentPipeline`; `Company` and `Classification` gain `isin: string | null`.
- Produces (`client.ts`, inside `documentsApi`):
  - `listFilings(): Promise<WorkspaceFilings>` (`GET …/filings`);
  - `confirmCompany(request: ConfirmCompanyRequest): Promise<ConfirmCompanyResponse>` (`POST …/companies/confirm`);
  - `index(id: string): Promise<{ job: Job }>` (`POST …/documents/:id/index`);
  - `fileHref(id: string): string`, which returns `…/documents/<id>/file` for a plain link to the stored file.

  `listDocuments` and `DOCUMENT_PAGE` stay until Task 10 removes their last caller.
- Produces (`intake.ts`): `PrintedIdentifier.label` gains `'ISIN'`, and `identifiers()` lists the ISIN after NSE.
- Produces (`testing.ts`). Every later task's tests use these builders with these signatures, and no other shapes:
  - `export type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;` (arrays are given whole). No such type exists in `apps/web` today.
  - `pipe(over?: DeepPartial<DocumentPipeline>): DocumentPipeline`.
  - `fileOf(over?: Omit<Partial<FilingFile>, 'pipeline'> & { pipeline?: DeepPartial<DocumentPipeline> }): FilingFile`. The `Omit` matters: with a plain intersection, `pipeline` would still need every field, and `svelte-check` checks `src/**/*.test.ts`.
  - `filingOf(over?: Partial<WorkspaceFiling>): WorkspaceFiling`, `companyOf(over?: Partial<Company>): Company`, `heldOf(over?: Partial<HeldIdentity>): HeldIdentity`, `docOf(over?: Partial<DocumentRecord>): DocumentRecord`, `readWith(over?: Partial<WorkspaceFilings>): WorkspaceFilings` (empty lists by default).
  - `stmt(over?: Partial<StatementSource>): StatementSource` (default: `income_statement`, `source 'xbrl'`, `xbrlDocumentId 'doc-1'`, `xbrlSpans ['quarter']`, `pdfDocumentId null`, `pdfPages []`, `reason null`, `inPdf null`) and `basisOf(basis: ReportingBasis, statements: StatementSource[]): BasisSources`.
  - Named files, each a `fileOf` with the given id: `xbrlDone(id: string, basis?: ReportingBasis)` (format `xbrl`, numbers `xbrl` `done`); `xbrlFailed(id: string, basis?: ReportingBasis)` (numbers `xbrl` `failed`); `pdfDone(id: string)` (numbers `pdf` `done`); `pdfNotNeeded(id: string, coveredBy: string[])` (numbers `xbrl` `not_needed`); `rejected(id: string, code: RejectionCode | null)` (state `rejected`, stored `failed`, identified `waiting`); `abandoned(id: string)` (state `pending_upload`, stored `now`, identified `waiting`, text `waiting` with `ahead` null).
  - The defaults are a stored PDF, everything `done`, `partial false`, `warnings []`, `format 'pdf'`, `basis 'consolidated'`, `createdAt '2026-10-19T08:32:00Z'`, `companyNameAsPrinted null`, ids `doc-1`, `doc-2` and so on in order when none is given, and `originalName` `<documentId>.pdf` (`<documentId>.xml` for `format 'xbrl'`) when none is given.
  - Only `*.test.ts` files import this module.

- [ ] **Step 1: Write the failing tests**

```ts
// client.test.ts, with its existing scripted(), json(), WS and DOC
it('listFilings reads the workspace’s filings', async () => {
  const { fetcher, calls } = scripted(json(200, { companies: [], held: [], unsorted: [] }));
  await documentsApi(fetcher, WS).listFilings();
  expect(calls[0].url).toBe(`/v1/workspaces/${WS}/filings`);
});
it('confirmCompany posts the identity and the company', async () => {
  const { fetcher, calls } = scripted(json(200, { companyId: 'co-1', confirmed: 3 }));
  await documentsApi(fetcher, WS).confirmCompany({ identity: { bseCode: '532999' }, company: { id: 'co-1' } });
  expect(calls[0].url).toBe(`/v1/workspaces/${WS}/companies/confirm`);
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({ identity: { bseCode: '532999' }, company: { id: 'co-1' } });
});
it('index posts to the document’s index route', async () => {
  const { fetcher, calls } = scripted(json(202, { job: { id: 'j', type: 'document.index', state: 'queued', lastErrorCode: null } }));
  await documentsApi(fetcher, WS).index(DOC);
  expect([calls[0].url, calls[0].init?.method]).toEqual([`/v1/workspaces/${WS}/documents/${DOC}/index`, 'POST']);
});
it('fileHref links the stored file', () => { expect(documentsApi(vi.fn() as unknown as Fetcher, WS).fileHref('d/1')).toBe(`/v1/workspaces/${WS}/documents/d%2F1/file`); });
// intake.test.ts
it('identifiers lists the ISIN after NSE', () => {
  expect(identifiers({ cin: null, bseCode: '500999', nseSymbol: 'SYNCEM', isin: 'INE999Z01011' }, []).map((i) => i.label)).toEqual(['BSE', 'NSE', 'ISIN']);
});
```

- [ ] **Step 2: Run to see them fail.** `cd apps/web && pnpm vitest run src/lib/documents/client.test.ts src/lib/documents/intake.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In the existing test builders, add the new required fields: `format: 'pdf'` and a `pipeline` (from `pipe()`) on each `DocumentRecord`, and `isin: null` on each `Company` and `Classification`. Find them with `grep -n "bseCode\|latestJob" apps/web/src/lib/documents/*.test.ts apps/web/src/lib/research/*.test.ts`.
- [ ] **Step 4: Run** `cd apps/web && pnpm vitest run src/lib && pnpm check`. Expected: PASS, and `svelte-check found 0 errors and 0 warnings` (today's components do not read the new fields yet).
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/documents apps/web/src/lib/research/summary.test.ts
git commit -m "feat(web): mirror the filings read, the pipeline object and confirm; client calls for filings, confirm, index and the file link"
```

---

### Task 3: The two tracks' words

**Files:**
- Create: `apps/web/src/lib/documents/tracks.ts`
- Modify: `apps/web/src/lib/content/documents.ts` (group `tracks`)
- Test: Create `apps/web/src/lib/documents/tracks.test.ts`

**Interfaces:**
- Consumes: `FilingFile`, `BasisSources`, `StatementSource`, `XbrlReadWarning` and the builders of `testing.ts` (Task 2).
- Produces:
  - `TrackState = 'now' | 'next' | 'done' | 'needs-you' | 'stopped' | 'not-read'`.
  - `TrackWords = { state: TrackState; first: string; second: string | null }`. The first line is bold only when `needs-you` or `stopped` (Decision 18); ink (opened filing only) when `now`.
  - `TrackContext = { uploading: (documentId: string) => boolean; nameOf: (documentId: string) => string | null }`.
  - `abandonedUpload(file: FilingFile, ctx: TrackContext): boolean`: `file.state === 'pending_upload'` and `!ctx.uploading(file.documentId)`. Numbers row 2, `unsortedSettled` and `identifying` (Task 5) all use it (Decision 5).
  - `pdfNeeded(file: FilingFile, files: FilingFile[], sources: BasisSources[]): boolean`: false while any XBRL file of `files` has numbers `now` or `waiting`; otherwise true when some statement of `sources`, in any basis, has `source === 'pdf'` and `pdfDocumentId === file.documentId`, or when no statement of `sources` has `source === 'xbrl'`. Decision 2's test; Task 4's `readAgainIds` and `retryIds` use it too, with the filing's own files.
  - `numbersTrack(files: FilingFile[], sources: BasisSources[], ctx: TrackContext): TrackWords`;
  - `textTrack(files: FilingFile[], ctx: TrackContext, variant: 'list' | 'opened' = 'list'): TrackWords`;
  - `formatWords(kind: XbrlFormatKind): string`: `banking` gives "the banking format", `nbfc` "the NBFC format", `other_than_ind_as` "the “other than Ind AS” format", `ind_as` "the Ind AS format" and `unknown` "a format Maester doesn’t know yet". Task 4 imports it from here.
  - `warningWords(warning: XbrlReadWarning): string`: `XBRL_ROUNDING_MISSING` "The XBRL file doesn’t declare its rounding, so its unit isn’t known."; `XBRL_ROUNDING_MISMATCH` "Its rounding doesn’t match the rounding it declares."; `XBRL_ELEMENT_UNMAPPED` "Some of its lines aren’t mapped yet, so they aren’t read."; `XBRL_NIL` "Some lines are filed with no value." A `partial` read with no warning reads "Part of the XBRL file wasn’t read." Task 4 uses it for the ledger's note.

In the tables, "—" in the second column means `null`. In the fallback rows the first line is the string "—", and `filingLive` (Task 5) does not count that fallback as live.

**The Numbers rule.** Let X be the filing's XBRL files and P its PDFs (duplicates are never in a filing's `files`, but a lone upload can turn into one before the next filings read). The first row that matches wins:

| # | When | state | first | second |
| --- | --- | --- | --- | --- |
| 1 | a file `pending_upload` that this page is sending | now | Sending | — |
| 2 | a file for which `abandonedUpload` is true | stopped | Stopped | The upload didn’t finish. Add it again. |
| 3 | `stored` `failed` | stopped | Stopped | `state` `rejected`, by `rejectionCode`: `UNSUPPORTED_TYPE` "Not a PDF or an XBRL file.", `TOO_LARGE` "Larger than 50 MB.", `OBJECT_MISSING` or null "The upload didn’t arrive."; otherwise (a failed verify, Task 1) "Maester couldn’t check this file." |
| 4 | `stored` `now` | now | Checking the file | — |
| 5 | every file `intakeState` `duplicate` | not-read | Not read | You added this file before. |
| 6 | `identified` `failed` | stopped | Stopped | Maester couldn’t work out what this is. |
| 7 | `identified` `now` | now | Working out what it is | — |
| 8 | `identified` `needs_you` | needs-you | Needs you | `needs_kind`: "Say what it is."; otherwise "Confirm the company." |
| 9 | a P with numbers `failed` for which `pdfNeeded` is true | stopped | Stopped | Maester couldn’t read the numbers. |
| 10 | an X `now` | now | From XBRL · reading now | a P `waiting` `waiting_for_xbrl`: "The PDF waits for it, so Gemini reads only what XBRL doesn’t cover."; else — |
| 11 | a P `waiting` `waiting_for_xbrl` with `waitingOn` not empty | next | Waiting for XBRL | one id: "{name} is being read. Gemini reads only what it doesn’t cover." (name from `ctx.nameOf`, else "An XBRL file"); n ids: "{n} XBRL files are being read. Gemini reads only what they don’t cover." |
| 12 | a P `now` | now | Read from the PDF · now | `pdfReason` |
| 13 | an X `waiting` | next | From XBRL · next | — |
| 14 | a P `waiting` | next | Read from the PDF · next | `pdfReason` |
| 15 | an X `failed` | stopped | Stopped | X holds one file: "Maester couldn’t read the XBRL file."; one of several failed: "{originalName} couldn’t be read."; n failed: "{n} XBRL files couldn’t be read." Then, when a P is `done` and `pdfNeeded`: " Gemini read the PDF." |
| 16 | an X `done`, and a P `done` for which `pdfNeeded` is true | done | From XBRL and the PDF · done | `splitWords`, then `caveat` |
| 17 | an X `done` | done | From XBRL · done | `checkLine`, then `caveat` |
| 18 | a P `done` | done | Read from the PDF · done | `pdfReason` |
| 19 | X not empty, every X `not_read` `format_unmapped`, P empty | not-read | Not read from XBRL | The XBRL is in {formatWords}, not mapped yet. |
| 20 | every file `not_read` `not_a_read_kind` | not-read | Not read | Maester reads annual reports and financial results for now. |
| 21 | otherwise | next | — | — |

Row 15 sits after the working rows (10–14), so a PDF Gemini is reading while an XBRL file failed still says "Read from the PDF · now"; once nothing works, a failed instance stops the track, so "Try again" can reach it (spec §10). It never reads as done while an instance of the filing failed. Rows 9 and 16 ask `pdfNeeded`, so a PDF that XBRL now covers whole neither stops the track nor reads as a source.

The helpers:
- `pdfReason`:
  - X is empty: "No XBRL for this filing.";
  - an X is `not_read` `format_unmapped`: "The XBRL is in {formatWords(format)}, not mapped yet.";
  - an X `failed`: "The XBRL file couldn’t be read.";
  - an X `done`: `splitWords`.
- `splitWords` keeps the bases apart (spec §3). Statements are listed in the order profit and loss, balance sheet, cash flow, lower case after the first word. Bases are in the order consolidated, standalone, not stated.
  - Every basis has the same split: "XBRL: profit and loss, balance sheet. PDF: cash flow."
  - Every basis has one source: "Consolidated from XBRL; standalone from the PDF."
  - Otherwise, one part per basis joined by "; ": "Consolidated: XBRL for profit and loss, balance sheet, the PDF for cash flow; standalone from the PDF."
- `checkLine` counts each basis apart, over the `inPdf` of its `xbrl` statements. The **XBRL bases** are the bases with at least one `xbrl` statement; the rule is keyed on how many there are, never on how many were checked, so an unchecked basis never reads as passed (spec §3). A basis is checked when any of its `xbrl` statements has `checked` > 0.
  - **One XBRL basis.** Checked, nothing missed: "{found} of {checked} figures found in the PDF." Checked, n missed: "{n} figure(s) not found in the PDF." Not checked, by its first `notChecked`: `no_pdf` "No PDF of these results in your documents.", `scanned` "The PDF’s statement pages are scanned, so the check didn’t run.", `no_statement_pages` "Maester didn’t find the statement pages in the PDF.", `disabled` "The check against the PDF is turned off.", `not_yet` "Checking against the PDF.", `no_value` "The XBRL file gives no value to look for in the PDF.", null "Not checked against the PDF."
  - **Two or more XBRL bases.** Always name each, in basis order: "In the PDF: " + the parts joined by ", " + ".". A checked basis reads "consolidated 107 of 107 found". An unchecked one reads "standalone not checked yet" (`not_yet`), or "standalone not checked: {why}", where why is `no_pdf` "no PDF of these results", `scanned` "its statement pages are scanned", `no_statement_pages` "no statement pages found", `disabled` "the check is turned off", `no_value` "no value to look for"; null reads "standalone not checked". The basis names are "consolidated", "standalone" and "basis not stated".
- `caveat`: when an X `done` has `partial` true or `warnings` not empty, a space and `warningWords` of its first warning (the order is Task 1's: rounding missing, rounding mismatch, elements unmapped, nil), else nothing. A partial read is never a clean "done" in words (the financial-figures rule that a caveat is said).

**The Text rule.** It looks at files that are `stored` and not `duplicate`:

| # | When | state | first | second |
| --- | --- | --- | --- | --- |
| 1 | a PDF `now` | now | Page {pagesRead} of {pages} (pages 0: "Reading the pages") | "{ocr} pages by OCR · {chunks} passages so far" (OCR part left out at 0; singular "1 page", "1 passage") |
| 2 | an XBRL `now` | now | Reading the XBRL notes | — |
| 3 | any `waiting` | next | the smallest `ahead`: null "In line", 0 "Next in line", n "In line, {n} ahead" | waiting files joined by " · ": PDF "PDF: {pages} pages" (pages 0: "PDF", which is every PDF before its first index: Decision 19), XBRL "XBRL: its notes" |
| 4 | any `failed` | stopped | Stopped | The text wasn’t indexed. Your numbers aren’t affected. |
| 5 | every file `done` or `partial` | done | "Done", or "Done, some pages without text" when any is `partial` | `list`: "{pages} pages, {ocr} by OCR · {chunks} passages · {blocks} XBRL notes". `opened` (spec §5): "{pages} pages of the PDF, {ocr} by OCR, {chunks} passages; {blocks} notes from the XBRL". Pages, OCR and passages are summed over PDFs; notes over XBRL `xbrlBlocks`; each part is left out at 0, with "1 page", "1 passage", "1 note" |
| 6 | no stored file | next | — | — |

- [ ] **Step 1: Write the failing tests.** One per row that a person can meet; the web's Vitest config sets `requireAssertions: true`, so every test carries its assertions.

```ts
import { abandoned, basisOf, fileOf, pdfDone, pdfNotNeeded, rejected, stmt, xbrlDone, xbrlFailed } from './testing';
const ctx: TrackContext = { uploading: (id) => id === 'up-1', nameOf: (id) => (id === 'x-q2' ? '500999_Q2_FY27_Consolidated.xml' : null) };
const one = (statements: StatementSource[]) => [basisOf('consolidated', statements)];
const found = (f: number, n: number, notFound: string[] = []) => ({ found: f, checked: n, notFound, notChecked: null });
const pdfNow = () => fileOf({ pipeline: { numbers: { source: 'pdf', state: 'now' } } });

it('XBRL reading and the PDF waiting for it (spec §4 row 1)', () => {
  const x = fileOf({ documentId: 'x-q2', format: 'xbrl', pipeline: { numbers: { source: 'xbrl', state: 'now' } } });
  const p = fileOf({ pipeline: { numbers: { source: null, state: 'waiting', reason: 'waiting_for_xbrl', waitingOn: ['x-q2'] } } });
  expect(numbersTrack([x, p], [], ctx)).toEqual({ state: 'now', first: 'From XBRL · reading now', second: 'The PDF waits for it, so Gemini reads only what XBRL doesn’t cover.' });
});
it('a PDF alone, read now (row 2)', () => {
  expect(numbersTrack([pdfNow()], [], ctx)).toEqual({ state: 'now', first: 'Read from the PDF · now', second: 'No XBRL for this filing.' });
});
it('an unmapped banking XBRL and the PDF next (row 3)', () => {
  const x = fileOf({ format: 'xbrl', pipeline: { numbers: { source: 'xbrl', state: 'not_read', reason: 'format_unmapped', format: 'banking' } } });
  const p = fileOf({ pipeline: { numbers: { source: null, state: 'waiting', reason: null } } });
  expect(numbersTrack([x, p], [], ctx)).toEqual({ state: 'next', first: 'Read from the PDF · next', second: 'The XBRL is in the banking format, not mapped yet.' });
});
it('XBRL done, the PDF not needed, 214 of 214 found in its one basis (row 4)', () => {
  expect(numbersTrack([xbrlDone('x1'), pdfNotNeeded('p1', ['x1'])], one([stmt({ xbrlDocumentId: 'x1', inPdf: found(214, 214) })]), ctx)).toEqual({ state: 'done', first: 'From XBRL · done', second: '214 of 214 figures found in the PDF.' });
});
it('one figure missed', () => {
  expect(numbersTrack([xbrlDone('x1'), pdfNotNeeded('p1', ['x1'])], one([stmt({ inPdf: found(213, 214, ['f9']) })]), ctx).second).toBe('1 figure not found in the PDF.');
});
it('a partial XBRL read is said after the check, never a clean done', () => {
  const x = fileOf({ documentId: 'x1', format: 'xbrl', pipeline: { numbers: { source: 'xbrl', state: 'done', warnings: ['XBRL_ELEMENT_UNMAPPED'] } } });
  expect(numbersTrack([x, pdfNotNeeded('p1', ['x1'])], one([stmt({ inPdf: found(214, 214) })]), ctx).second).toBe('214 of 214 figures found in the PDF. Some of its lines aren’t mapped yet, so they aren’t read.');
});
it('XBRL and the PDF split the statements, the same in both bases', () => {
  const split = (basis: ReportingBasis) => basisOf(basis, [stmt({ statement: 'income_statement' }), stmt({ statement: 'balance_sheet' }), stmt({ statement: 'cash_flow', source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'p1', pdfPages: [6, 7], reason: 'xbrl_lacks_statement' })]);
  expect(numbersTrack([xbrlDone('x1'), pdfDone('p1')], [split('consolidated'), split('standalone')], ctx)).toEqual({ state: 'done', first: 'From XBRL and the PDF · done', second: 'XBRL: profit and loss, balance sheet. PDF: cash flow.' });
});
it('consolidated XBRL only: the split follows the bases', () => {
  const sources = [basisOf('consolidated', [stmt()]), basisOf('standalone', [stmt({ source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'p1', reason: 'no_xbrl' })])];
  expect(numbersTrack([xbrlDone('x1'), pdfDone('p1')], sources, ctx).second).toBe('Consolidated from XBRL; standalone from the PDF.');
});
it('a PDF Gemini read before its XBRL, now covered whole, is not a source (Review Focus 1)', () => {
  expect(numbersTrack([xbrlDone('x1'), pdfDone('p1')], one([stmt({ inPdf: found(38, 38) })]), ctx)).toEqual({ state: 'done', first: 'From XBRL · done', second: '38 of 38 figures found in the PDF.' });
});
it('two bases checked: counted apart, never summed', () => {
  const sources = [basisOf('consolidated', [stmt({ inPdf: found(107, 107) })]), basisOf('standalone', [stmt({ xbrlDocumentId: 'xs', inPdf: found(106, 107, ['f1']) })])];
  expect(numbersTrack([xbrlDone('xc'), xbrlDone('xs', 'standalone'), pdfNotNeeded('p1', ['xc', 'xs'])], sources, ctx).second).toBe('In the PDF: consolidated 107 of 107 found, standalone 106 of 107 found.');
});
it('two XBRL bases, one not checked yet: both named, with the reason', () => {
  const sources = [basisOf('consolidated', [stmt({ inPdf: found(107, 107) })]), basisOf('standalone', [stmt({ xbrlDocumentId: 'xs', inPdf: { found: 0, checked: 0, notFound: [], notChecked: 'not_yet' } })])];
  expect(numbersTrack([xbrlDone('xc'), xbrlDone('xs', 'standalone'), pdfNotNeeded('p1', ['xc', 'xs'])], sources, ctx).second).toBe('In the PDF: consolidated 107 of 107 found, standalone not checked yet.');
});
it('one basis with nothing to look for says so, never "—"', () => {
  expect(numbersTrack([xbrlDone('x1')], one([stmt({ inPdf: { found: 0, checked: 0, notFound: [], notChecked: 'no_value' } })]), ctx).second).toBe('The XBRL file gives no value to look for in the PDF.');
});
it('waiting on an XBRL file elsewhere, named', () => {
  const p = fileOf({ pipeline: { numbers: { source: null, state: 'waiting', reason: 'waiting_for_xbrl', waitingOn: ['x-q2'] } } });
  expect(numbersTrack([p], [], ctx)).toEqual({ state: 'next', first: 'Waiting for XBRL', second: '500999_Q2_FY27_Consolidated.xml is being read. Gemini reads only what it doesn’t cover.' });
});
it('the XBRL failed and Gemini reads the PDF', () => {
  expect(numbersTrack([xbrlFailed('x1'), pdfNow()], [], ctx)).toEqual({ state: 'now', first: 'Read from the PDF · now', second: 'The XBRL file couldn’t be read.' });
});
it('one instance failed and the other read: Stopped, never done (row 15)', () => {
  expect(numbersTrack([xbrlDone('xc'), xbrlFailed('xs', 'standalone')], [], ctx)).toEqual({ state: 'stopped', first: 'Stopped', second: 'xs.xml couldn’t be read.' });
  const sources = [basisOf('consolidated', [stmt({ xbrlDocumentId: 'xc' })]), basisOf('standalone', [stmt({ source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'p1', reason: 'xbrl_read_failed' })])];
  expect(numbersTrack([xbrlDone('xc'), xbrlFailed('xs', 'standalone'), pdfDone('p1')], sources, ctx)).toEqual({ state: 'stopped', first: 'Stopped', second: 'xs.xml couldn’t be read. Gemini read the PDF.' });
  expect(numbersTrack([xbrlFailed('x1')], [], ctx).second).toBe('Maester couldn’t read the XBRL file.');
});
it('a PDF whose read failed stops the track only while it is still needed', () => {
  const p = fileOf({ documentId: 'p1', pipeline: { numbers: { source: 'pdf', state: 'failed' } } });
  expect(numbersTrack([xbrlDone('x1'), p], one([stmt({ inPdf: found(38, 38) })]), ctx).state).toBe('done');
  expect(numbersTrack([p], one([stmt({ source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'p1', reason: 'read_failed' })]), ctx)).toEqual({ state: 'stopped', first: 'Stopped', second: 'Maester couldn’t read the numbers.' });
});
it('an abandoned upload is stopped; one being sent is "Sending"', () => {
  expect(numbersTrack([abandoned('u1')], [], ctx)).toEqual({ state: 'stopped', first: 'Stopped', second: 'The upload didn’t finish. Add it again.' });
  expect(numbersTrack([abandoned('up-1')], [], ctx)).toEqual({ state: 'now', first: 'Sending', second: null });
});
it('a refused file says why', () => {
  expect(numbersTrack([rejected('r1', 'UNSUPPORTED_TYPE')], [], ctx)).toEqual({ state: 'stopped', first: 'Stopped', second: 'Not a PDF or an XBRL file.' });
  expect(numbersTrack([rejected('r2', null)], [], ctx).second).toBe('The upload didn’t arrive.');
});
it('a duplicate is settled, and its text never reads "In line"', () => {
  const d = fileOf({ intakeState: 'duplicate', pipeline: { numbers: { source: null, state: 'not_read', reason: 'duplicate' }, text: { state: 'waiting', ahead: null } } });
  expect(numbersTrack([d], [], ctx)).toEqual({ state: 'not-read', first: 'Not read', second: 'You added this file before.' });
  expect(textTrack([d], ctx)).toEqual({ state: 'next', first: '—', second: null });
});
it('a kept document is not read', () => {
  const k = fileOf({ intakeState: 'kept', pipeline: { numbers: { source: null, state: 'not_read', reason: 'not_a_read_kind' } } });
  expect(numbersTrack([k], [], ctx)).toEqual({ state: 'not-read', first: 'Not read', second: 'Maester reads annual reports and financial results for now.' });
});
it('needs you: what is it?', () => {
  expect(numbersTrack([fileOf({ intakeState: 'needs_kind', pipeline: { identified: 'needs_you' } })], [], ctx)).toEqual({ state: 'needs-you', first: 'Needs you', second: 'Say what it is.' });
});
it('pdfNeeded follows the sources, never the PDF’s own numbers', () => {
  const p = pdfDone('p1');
  expect(pdfNeeded(p, [xbrlDone('x1'), p], one([stmt()]))).toBe(false);
  expect(pdfNeeded(p, [xbrlDone('x1'), p], one([stmt(), stmt({ statement: 'cash_flow', source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'p1' })]))).toBe(true);
  expect(pdfNeeded(p, [p], [])).toBe(true);
});
it('a failed PDF waits while its XBRL is read: From XBRL, never Stopped (no Try again, no Gemini call)', () => {
  const x = fileOf({ documentId: 'x1', format: 'xbrl', pipeline: { numbers: { source: 'xbrl', state: 'now' } } });
  const p = fileOf({ documentId: 'p1', pipeline: { numbers: { source: 'pdf', state: 'failed' } } });
  const sources = one([stmt({ source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'p1', reason: 'xbrl_not_read_yet' })]);
  expect(pdfNeeded(p, [x, p], sources)).toBe(false);
  expect(numbersTrack([x, p], sources, ctx)).toMatchObject({ state: 'now', first: 'From XBRL · reading now' });
});
it('text: page 140 of 286 (spec §4)', () => {
  expect(textTrack([fileOf({ pipeline: { text: { state: 'now', pages: 286, pagesRead: 140, pagesOcr: 38, chunks: 412 } } })], ctx)).toEqual({ state: 'now', first: 'Page 140 of 286', second: '38 pages by OCR · 412 passages so far' });
});
it('text: in line, 2 ahead; a waiting PDF names no page count (Decision 19)', () => {
  const p = fileOf({ pipeline: { text: { state: 'waiting', ahead: 2, pages: 0 } } });
  const x = fileOf({ format: 'xbrl', pipeline: { text: { state: 'waiting', ahead: 5 } } });
  expect(textTrack([p, x], ctx)).toEqual({ state: 'next', first: 'In line, 2 ahead', second: 'PDF · XBRL: its notes' });
});
it('text: done, the XBRL counted as notes', () => {
  const files = [fileOf({ pipeline: { text: { state: 'done', pages: 22, pagesOcr: 4, chunks: 61 } } }), fileOf({ format: 'xbrl', pipeline: { text: { state: 'done', chunks: 30, xbrlBlocks: 12 } } })];
  expect(textTrack(files, ctx).second).toBe('22 pages, 4 by OCR · 61 passages · 12 XBRL notes');
  expect(textTrack(files, ctx, 'opened')).toEqual({ state: 'done', first: 'Done', second: '22 pages of the PDF, 4 by OCR, 61 passages; 12 notes from the XBRL' });
});
it('text: partial and failed', () => {
  expect(textTrack([fileOf({ pipeline: { text: { state: 'partial', pages: 10, pagesOcr: 0, chunks: 20 } } })], ctx)).toEqual({ state: 'done', first: 'Done, some pages without text', second: '10 pages · 20 passages' });
  expect(textTrack([fileOf({ pipeline: { text: { state: 'failed' } } })], ctx)).toEqual({ state: 'stopped', first: 'Stopped', second: 'The text wasn’t indexed. Your numbers aren’t affected.' });
});
```

- [ ] **Step 2: Run to see them fail.** `cd apps/web && pnpm vitest run src/lib/documents/tracks.test.ts`. Expected: FAIL ("Cannot find module './tracks'").
- [ ] **Step 3: Implement** `tracks.ts`, and the copy under `documentsContent.tracks`, as functions where a count goes in.
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/documents/tracks.ts apps/web/src/lib/documents/tracks.test.ts apps/web/src/lib/content/documents.ts
git commit -m "feat(web): a filing's Numbers and Text tracks in words, from its files' pipelines and sources"
```

---

### Task 4: Statement sources, and which files a button acts on

**Files:**
- Create: `apps/web/src/lib/documents/sources.ts`
- Modify: `apps/web/src/lib/content/documents.ts` (group `sources`)
- Test: Create `apps/web/src/lib/documents/sources.test.ts`

**Interfaces:**
- Consumes: `BasisSources`, `StatementSource`, `InPdfCount`, `FilingFile`, `WorkspaceFiling`, `StatementFound` and the builders of `testing.ts` (Task 2); `formatWords`, `pdfNeeded` and `warningWords` (Task 3, `tracks.ts`).
- Produces:
  - `SourceRow = { statement: StatementKind; label: string; from: { text: string; note: string | null }; inPdf: { text: string; strong: boolean; missed: string | null; open: { documentId: string; pageIndex: number; label: string } | null } }`.
  - `sourceRows(basis: BasisSources, filing: WorkspaceFiling, pdfStatements: StatementFound[] | null): SourceRow[]`. Rows come in the order profit and loss, balance sheet, cash flow. `pdfStatements` is the filing's PDF classification's `statementsFound`, once loaded.
  - `basisTitle(basis: ReportingBasis): string`: "Consolidated", "Standalone", "Basis not stated".
  - `readAgainIds(files: FilingFile[], sources: BasisSources[]): string[]`: XBRL files whose numbers are `done` or `failed`, and PDFs whose numbers are `done` or `failed` and for which `pdfNeeded(file, files, sources)` is true, in file order (Decision 2). Never a PDF that is `not_needed` or `not_read`, and never one that XBRL now covers whole, whatever its `numbers.source` says. An unsorted file passes `sources` `[]`.
  - `retryIds(files: FilingFile[], sources: BasisSources[], track: 'identify' | 'numbers' | 'text'): string[]`: `identify` gives the files with `identified` `failed` (to `classify`); `numbers` the XBRL files with numbers `failed`, and the PDFs with numbers `failed` for which `pdfNeeded(file, files, sources)` is true (to `extract`); `text` the files with text `failed` (to `index`).
  - `notCheckedWords(reason: XbrlPdfNotChecked): string`, used here and by the panel (Task 11):
    - `no_pdf`: "Not checked: no PDF of these results is in your documents.";
    - `scanned`: "Not checked: the PDF’s statement pages are scanned, so their text can’t be searched.";
    - `no_statement_pages`: "Not checked: Maester didn’t find the statement pages in the PDF.";
    - `disabled`: "Not checked: the check is turned off.";
    - `no_value`: "Not checked: the XBRL file gives no value to look for.";
    - `not_yet`: "Not checked yet."
  - `pagesWords(pages: number[]): string` (0-based in, 1-based out): "page 7", "pages 7–8" (a run), "pages 4, 6 and 9".

  The words of **Numbers from** follow spec §5:

  | Source | Text | Note |
  | --- | --- | --- |
  | `xbrl` with spans | "XBRL · " + the spans in the order quarter, half year, nine months, year, other periods, joined "a and b" or "a, b and c" ("XBRL · quarter and half year") | — |
  | `xbrl` with no spans (an instant) | "XBRL · at 30 Sep 2026" (the filing's `periodEnd`; "XBRL" when null) | — |
  | `pdf` with `xbrl_lacks_statement` | "PDF, read by Gemini · pages 7–8" (no pages: "PDF, read by Gemini") | "The quarter’s XBRL has no cash flow". The span is the filing's shortest: "quarter’s", "half year’s", "nine months’", "year’s"; with no span, "The XBRL has no cash flow" |
  | `pdf` with `xbrl_format_unmapped` | as above | "The XBRL is in {formatWords}, not mapped yet." (the format of the filing's XBRL file) |
  | `pdf` with `no_xbrl` | as above | "No XBRL for this filing." |
  | `pdf` with `xbrl_read_failed` (Task 1) | as above | "The XBRL file couldn’t be read." |
  | `pdf` with `xbrl_not_read_yet` (Task 1) | as above | "The XBRL file isn’t read yet." |
  | `not_read_yet` | — | "Not read yet." |
  | `read_failed` | — | "The read stopped." |
  | null with `xbrl_read_failed` (Task 1) | — | "The XBRL file couldn’t be read." |
  | null with `xbrl_not_read_yet` (Task 1) | — | "Not read yet." |
  | null with `not_in_filing` | Not in this filing | — |

  An `xbrl` statement whose `xbrlDocumentId` is a file of the filing with `numbers.partial` true or `warnings` not empty takes `warningWords` of its first warning as its note, so a caveat on its figures is said in words. "Not in this filing" is said only with `not_in_filing`: a basis whose XBRL failed or is not read yet never reads as absent.

  The words of **In the PDF**:
  - `inPdf` null: "—".
  - `checked` > 0: "Found: {found} of {checked}". `strong` is true when `notFound` is not empty. Then `missed` is "{n} not found." and `open` is "Open the results PDF at page {first}". `{first}` is the first page of `pdfStatements` for that statement and basis, and `open` is null without it.
  - None checked: `notCheckedWords(notChecked)`, or "—" when null.

- [ ] **Step 1: Write the failing tests**

```ts
import { basisOf, filingOf, fileOf, pdfDone, pdfNotNeeded, stmt, xbrlDone, xbrlFailed } from './testing';
const one = (statements: StatementSource[]) => [basisOf('consolidated', statements)];
const q2Filing = filingOf({ kind: 'financial_results', periodEnd: '2026-09-30', spans: ['quarter', 'half_year'], files: [xbrlDone('x-q2c'), fileOf({ documentId: 'pdf-q2', originalName: 'q2.pdf' })] });
const q2Consolidated = basisOf('consolidated', [
  stmt({ statement: 'income_statement', xbrlDocumentId: 'x-q2c', xbrlSpans: ['quarter', 'half_year'], inPdf: { found: 38, checked: 38, notFound: [], notChecked: null } }),
  stmt({ statement: 'balance_sheet', xbrlDocumentId: 'x-q2c', xbrlSpans: [], inPdf: { found: 51, checked: 52, notFound: ['f-1'], notChecked: null } }),
  stmt({ statement: 'cash_flow', source: 'pdf', xbrlDocumentId: null, xbrlSpans: [], pdfDocumentId: 'pdf-q2', pdfPages: [6, 7], reason: 'xbrl_lacks_statement' }),
]);
it('the C2 ledger, consolidated', () => {
  const rows = sourceRows(q2Consolidated, q2Filing, [{ statement: 'balance_sheet', basis: 'consolidated', pages: [3, 4, 5] }]);
  expect(rows.map((r) => [r.label, r.from.text, r.from.note, r.inPdf.text])).toEqual([
    ['Profit and loss', 'XBRL · quarter and half year', null, 'Found: 38 of 38'],
    ['Balance sheet', 'XBRL · at 30 Sep 2026', null, 'Found: 51 of 52'],
    ['Cash flow', 'PDF, read by Gemini · pages 7–8', 'The quarter’s XBRL has no cash flow', '—'],
  ]);
  expect(rows[1].inPdf).toMatchObject({ strong: true, missed: '1 not found.', open: { documentId: 'pdf-q2', pageIndex: 3, label: 'Open the results PDF at page 4' } });
});
it('unmapped, no XBRL, not in the filing, not read yet, read failed', () => {
  const unmapped = filingOf({ kind: 'financial_results', periodEnd: '2026-09-30', spans: ['quarter'], files: [fileOf({ format: 'xbrl', pipeline: { numbers: { source: 'xbrl', state: 'not_read', reason: 'format_unmapped', format: 'banking' } } }), fileOf({ documentId: 'pdf-q2' })] });
  const rows = sourceRows(basisOf('consolidated', [
    stmt({ statement: 'income_statement', source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'pdf-q2', pdfPages: [3], reason: 'xbrl_format_unmapped' }),
    stmt({ statement: 'balance_sheet', source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'pdf-q2', pdfPages: [], reason: 'no_xbrl' }),
    stmt({ statement: 'cash_flow', source: null, xbrlDocumentId: null, reason: 'not_in_filing' }),
  ]), unmapped, null);
  expect(rows.map((r) => [r.from.text, r.from.note])).toEqual([
    ['PDF, read by Gemini · page 4', 'The XBRL is in the banking format, not mapped yet.'],
    ['PDF, read by Gemini', 'No XBRL for this filing.'],
    ['Not in this filing', null],
  ]);
  const later = sourceRows(basisOf('standalone', [
    stmt({ statement: 'income_statement', source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'pdf-q2', reason: 'not_read_yet' }),
    stmt({ statement: 'balance_sheet', source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'pdf-q2', reason: 'read_failed' }),
  ]), unmapped, null);
  expect(later.map((r) => [r.from.text, r.from.note])).toEqual([['—', 'Not read yet.'], ['—', 'The read stopped.']]);
});
it('a basis whose XBRL failed or is not read yet never reads "Not in this filing"', () => {
  const rows = sourceRows(basisOf('standalone', [
    stmt({ statement: 'income_statement', source: null, xbrlDocumentId: null, reason: 'xbrl_read_failed' }),
    stmt({ statement: 'balance_sheet', source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'pdf-q2', pdfPages: [4, 5], reason: 'xbrl_read_failed' }),
    stmt({ statement: 'cash_flow', source: null, xbrlDocumentId: null, reason: 'xbrl_not_read_yet' }),
  ]), q2Filing, null);
  expect(rows.map((r) => [r.from.text, r.from.note])).toEqual([
    ['—', 'The XBRL file couldn’t be read.'],
    ['PDF, read by Gemini · pages 5–6', 'The XBRL file couldn’t be read.'],
    ['—', 'Not read yet.'],
  ]);
});
it('statements from a partial XBRL read carry its caveat', () => {
  const x = fileOf({ documentId: 'x-w', format: 'xbrl', pipeline: { numbers: { source: 'xbrl', state: 'done', partial: true, warnings: ['XBRL_ROUNDING_MISSING'] } } });
  const rows = sourceRows(basisOf('consolidated', [stmt({ xbrlDocumentId: 'x-w', xbrlSpans: ['quarter'] })]), filingOf({ files: [x] }), null);
  expect(rows[0].from).toEqual({ text: 'XBRL · quarter', note: 'The XBRL file doesn’t declare its rounding, so its unit isn’t known.' });
});
it('a not-checked statement says why', () => {
  const rows = sourceRows(one([stmt({ inPdf: { found: 0, checked: 0, notFound: [], notChecked: 'scanned' } })])[0], q2Filing, null);
  expect(rows[0].inPdf.text).toBe('Not checked: the PDF’s statement pages are scanned, so their text can’t be searched.');
});
it('read it again: the XBRL only when it covers the PDF, even a PDF Gemini read first (no Gemini call)', () => {
  const covered = one([stmt({ xbrlDocumentId: 'x1' })]);
  expect(readAgainIds([xbrlDone('x1'), pdfNotNeeded('p1', ['x1'])], covered)).toEqual(['x1']);
  // numbers { state: 'done', source: 'pdf' }, read before its XBRL arrived; every statement of `sources` is xbrl (Review Focus 1)
  expect(readAgainIds([xbrlDone('x1'), pdfDone('p1')], covered)).toEqual(['x1']);
});
it('read it again: a PDF read by Gemini, and both when they split', () => {
  expect(readAgainIds([pdfDone('p1')], [])).toEqual(['p1']);
  const split = one([stmt({ xbrlDocumentId: 'x1' }), stmt({ statement: 'cash_flow', source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'p1' })]);
  expect(readAgainIds([xbrlDone('x1'), pdfDone('p1')], split)).toEqual(['x1', 'p1']);
  const kept = fileOf({ documentId: 'k1', intakeState: 'kept', pipeline: { numbers: { source: null, state: 'not_read', reason: 'not_a_read_kind' } } });
  expect(readAgainIds([kept], [])).toEqual([]);
});
it('try again goes to the files whose track stopped, never to a covered PDF', () => {
  const failedPdf = fileOf({ documentId: 'p1', pipeline: { numbers: { source: 'pdf', state: 'failed' } } });
  expect(retryIds([fileOf({ documentId: 'p2', pipeline: { text: { state: 'failed' } } }), xbrlDone('x1')], [], 'text')).toEqual(['p2']);
  expect(retryIds([xbrlFailed('x2'), failedPdf], one([stmt({ xbrlDocumentId: 'x1' })]), 'numbers')).toEqual(['x2']);
  expect(retryIds([failedPdf], one([stmt({ source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'p1', reason: 'read_failed' })]), 'numbers')).toEqual(['p1']);
  expect(retryIds([fileOf({ documentId: 'i1', pipeline: { identified: 'failed' } })], [], 'identify')).toEqual(['i1']);
});
it('while an XBRL file of the filing is read, a failed PDF is neither retried nor read again', () => {
  const x = fileOf({ documentId: 'x1', format: 'xbrl', pipeline: { numbers: { source: 'xbrl', state: 'now' } } });
  const p = fileOf({ documentId: 'p1', pipeline: { numbers: { source: 'pdf', state: 'failed' } } });
  const sources = one([stmt({ source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'p1', reason: 'xbrl_not_read_yet' })]);
  expect(retryIds([x, p], sources, 'numbers')).toEqual([]);
  expect(readAgainIds([x, p], sources)).toEqual([]);
});
it('pagesWords', () => { expect([pagesWords([6]), pagesWords([6, 7]), pagesWords([3, 5, 8])]).toEqual(['page 7', 'pages 7–8', 'pages 4, 6 and 9']); });
```

- [ ] **Step 2: Run to see them fail.** `cd apps/web && pnpm vitest run src/lib/documents/sources.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/documents/sources.ts apps/web/src/lib/documents/sources.test.ts apps/web/src/lib/content/documents.ts
git commit -m "feat(web): a filing's statement sources per basis in words; read it again and try again never send a covered PDF to Gemini"
```

---

### Task 5: The page's view model

**Files:**
- Create: `apps/web/src/lib/documents/filings.ts`
- Modify: `apps/web/src/lib/content/documents.ts`. It adds four groups:
  - `sections` (`{ working: 'Working on', done: 'Done', confirm: 'Not in your workspace yet', unknownCompany: 'Company not known yet' }`);
  - `titles` (the title, heading, meta, file-line, count and "Show all" words below);
  - `questions`;
  - `waiting` (the "waits for you above" words below).
- Test: Create `apps/web/src/lib/documents/filings.test.ts`

**Interfaces:**
- Consumes: `numbersTrack`, `textTrack`, `abandonedUpload`, `TrackWords`, `TrackContext` (Task 3); `addedAt`, `whatItIs` and `normalizeCompanyName` (`intake.ts`); `fyLabel` (`$lib/research/view`); `shortName` (`$lib/research/summary`, which already strips a trailing "Limited" or "Ltd"; do not write a second one); the builders of `testing.ts` (Task 2).
- Produces:
  - `FilingView = { key: string; companyId: string | null; title: string; files: FilingFile[]; numbers: TrackWords; text: TrackWords; settled: boolean; addedAt: string; filing: WorkspaceFiling | null }`. An unsorted file is a `FilingView` with key `file:<documentId>`, `filing: null` and title its file name.
  - `CompanyGroup = { companyId: string | null; name: string; codes: string; filings: FilingView[] }`. The codes are "BSE 500999 · NSE SYNCEM", plus " · ISIN …" when set. The group with no company is named "Company not known yet", has no codes and comes last.
  - `PageView = { unnamed: FilingFile[]; held: HeldIdentity[]; working: CompanyGroup[]; done: CompanyGroup[]; workingCount: string; doneCount: string; empty: boolean }`. `held` is the read's, unchanged. The counts read "4 filings · 7 files" and "12 filings" (singulars "1 filing", "1 file").
  - `buildView(read: WorkspaceFilings, ctx: TrackContext): PageView`. Company filings go by the server's `settled`. Unsorted files go by `unsortedSettled`. An unsorted `needs_company` file goes to `unnamed`. Groups keep the server's order, and unsorted files go newest first.
  - `unsortedSettled(file: FilingFile, ctx: TrackContext): boolean`. Phase 4's `settled` needs `identified` `done`, so it would leave a file whose identification stopped in Working on for ever; the unsorted rule is written out here instead. The first that applies wins:
    1. true when `state` is `rejected`, `abandonedUpload(file, ctx)` is true, or `stored` is `failed`;
    2. false while this page sends it, or while `stored` or `identified` is `now`;
    3. false while text is not `done`, `partial` or `failed` (a kept file still indexing stays in Working on, where it is watched);
    4. true when `identified` is `failed`, or when `identified` is `done` and numbers are `done`, `not_needed`, `not_read` or `failed`;
    5. false otherwise (`needs_kind` waits in Working on).
  - `filingTitle(f: WorkspaceFiling, files: FilingFile[]): string`:
    - `financial_results`: "Results, {shortest span} to {d Mon yyyy}". The spans order is quarter, half year, nine months, full year. "Results to 30 Sep 2026" with no span; "Results, period not stated" with no period.
    - `annual_report`: "Annual report 2025–26" for a year to 31 March (`fyLabel`), else "Annual report, year to 31 Dec 2025".
    - `other`: "{other type}, {d Mon yyyy}" from `periodEnd`, else from `addedAt` ("Investor presentation, 14 Aug 2026"). Task 1 keys `other` by its type, so one filing has one type.
    - `not_sure`: the first file's name. Task 1 keys `not_sure` by its document, so one filing has one file.
  - `filingHeading(name: string | null, title: string, kind: ClassificationKind | null): string`: "Synthetic Cements · results, quarter to 30 Sep 2026". The title's first letter is lower-cased, except for a file name. With no company, the title alone.
  - `filingMeta(view: FilingView, now?: Date, timeZone?: string): string`: "Consolidated and standalone · 3 files · added 14:02". The bases come from the files' `basis`; "added" uses `addedAt()`.
  - `fileLine(file: FilingFile): string`: "XBRL · 500999_Q2_FY27_Consolidated.xml" or "PDF · ar.pdf". It adds " · Added twice" for one duplicate and " · Added {n+1} times" for more.
  - `DONE_SHOWN = 3`; `shownFilings(group: CompanyGroup, expanded: boolean): { shown: FilingView[]; hidden: number; hiddenStopped: number }`; `showAllLabel(group: CompanyGroup, expanded: boolean): string`. The button reads "Show all {n} filings of {name}", with " · {k} stopped" when `hiddenStopped` is k > 0 (Decision 20), or "Show the newest 3" while expanded. A filing is stopped when either track's state is `stopped`.
  - **The opened filing** (Decision 17). `Opened = { key: string; documentId: string; name: string }`; `name` is that document's file name, kept so the page can still name it once it leaves every filing.
    - `pickFiling(view: PageView, opened: Opened | null): FilingView | null`. The order of choice is:
      1. the filing with `opened.key`;
      2. the filing that now holds `opened.documentId`: in its `files`, or in one of its files' `duplicates` (a duplicate shows on the first copy's filing, spec §3);
      3. null, when `waitingAbove(view, opened)` is not null: the document is held or unnamed, so nothing else opens in its place;
      4. the Working on filing with the newest `addedAt`;
      5. the Done filing with the newest `addedAt`;
      6. null.
    - `pin(view: PageView, opened: Opened | null): Opened | null`. With `waitingAbove` not null, it returns `opened` unchanged. Otherwise it pins whatever `pickFiling` finds: `{ key: found.key, documentId, name }`, where `documentId` and `name` are `opened`'s when `found` still holds that document (in `files` or `duplicates`), else `found.files[0]`'s. The page sets `opened = pin(view, opened)` after every read. So a filing that opened by itself stays open while newer filings arrive or its own work finishes, as today's slip stays pinned.
    - `follow(view: PageView, documentId: string): Opened | null`: the filing that holds `documentId` (step 2 alone), as `{ key, documentId, name }`. The page calls it after the investor's own Change, so the open filing follows that file to its new filing; with null, `opened` stays as it is.
    - `waitingAbove(view: PageView, opened: Opened | null): { kind: 'held'; key: string; name: string } | { kind: 'unnamed'; documentId: string; name: string } | null`: `held` when some `view.held[i].documentIds` holds `opened.documentId` (its `key`), `unnamed` when `view.unnamed` holds it, else null. Words (`waiting`): title "{name} waits for you above."; detail `held` "Confirm its company under “Not in your workspace yet”. It carries on from there.", `unnamed` "Say which company it is under “Not in your workspace yet”."; action "Go to it".
    - `shapeChanged(before: FilingFile, after: Pick<DocumentRecord, 'state' | 'intakeState' | 'pipeline'>): boolean`: true when `state`, `intakeState` or `pipeline.identified` differ. It covers being identified, held, made a duplicate, kept and read. The page reads the filings once when it is true for any polled file (Decision 12).
    - `answersWanted(filing: FilingView | null, answers: Readonly<Record<string, unknown>>, changed: ReadonlySet<string>): string[]`: the ids of `filing.files` whose `state` is `stored` and that have no key in `answers` or are in `changed`, in file order.
  - `identifying(read: WorkspaceFilings, ctx: TrackContext): boolean`: any file still being checked or identified (`stored` or `identified` `now`), anywhere in the read, leaving out a file for which `abandonedUpload` is true (Decision 10).
  - `filingLive(view: FilingView, ctx: TrackContext): boolean`: true when a track is `now`, or `next` and not the "—" fallback, or the filing holds a file this page is sending.
  - `listWatched(view: PageView, openedKey: string | null, ctx: TrackContext): boolean`: any live Working on filing other than the opened one.
  - `applyDocument(read: WorkspaceFilings, doc: DocumentRecord): WorkspaceFilings`. It replaces the matching `FilingFile`'s `pipeline`, `intakeState`, `state`, `rejectionCode` and `companyNameAsPrinted` (from `doc.classification`), wherever the file sits. It never moves a file between filings; `shapeChanged` asks for the read that does. It returns `read` itself (the same object) when no file matches.
  - `withUpload(read, doc: DocumentRecord): WorkspaceFilings`: the document as a `FilingFile` in `unsorted`, added or replaced.
  - `keepFresher(current: WorkspaceFilings, next: WorkspaceFilings, ids: readonly string[]): WorkspaceFilings`: `next`, with the `FilingFile` copies from `current` for `ids`.
  - `questionKeys(read): Map<string, Question>`, where `Question = { kind: 'company' | 'file'; aloud: string }`. The entries are:
    - each held identity, keyed `held:<key>`: "{shortName(nameAsPrinted)} needs you: confirm the company.", or the codes when no name is printed;
    - each unnamed file, keyed `doc:<id>`: "{file name} needs you: is this {companyNameAsPrinted}?" when it prints a name, else "{file name} needs you: which company is this?";
    - each `needs_kind` file, keyed `doc:<id>`: "{file name} needs you: what is it?".
  - `newQuestions(seen: ReadonlySet<string>, read): { aloud: string | null; seen: Set<string> }`. No new key gives null. One new key gives its sentence. Several give "{a} companies and {b} files need you.", with each part left out at 0 and singular at 1.

- [ ] **Step 1: Write the failing tests**

```ts
import { abandoned, companyOf, docOf, fileOf, filingOf, heldOf, pipe, readWith, rejected } from './testing';
const ctx: TrackContext = { uploading: (id) => id === 'up-1', nameOf: () => null };
const co = companyOf({ id: 'co-1', displayName: 'Synthetic Cements', bseCode: '500999', nseSymbol: 'SYNCEM' });
const words = (state: TrackState, first = 'x'): TrackWords => ({ state, first, second: null });
/** A FilingView by hand, for the rules that take one. */
const fv = (over: Partial<FilingView> = {}): FilingView => ({ key: 'k', companyId: 'co-1', title: 't', files: [], numbers: words('done'), text: words('done'), settled: true, addedAt: '2026-10-19T08:32:00Z', filing: null, ...over });

it('titles', () => {
  expect(filingTitle(filingOf({ kind: 'financial_results', spans: ['half_year', 'quarter'], periodEnd: '2026-09-30' }), [])).toBe('Results, quarter to 30 Sep 2026');
  expect(filingTitle(filingOf({ kind: 'annual_report', periodEnd: '2026-03-31' }), [])).toBe('Annual report 2025–26');
  expect(filingTitle(filingOf({ kind: 'annual_report', periodEnd: '2025-12-31' }), [])).toBe('Annual report, year to 31 Dec 2025');
  expect(filingTitle(filingOf({ kind: 'other', otherType: 'investor_presentation', periodEnd: '2026-08-14' }), [])).toBe('Investor presentation, 14 Aug 2026');
  expect(filingTitle(filingOf({ kind: 'not_sure', periodEnd: null }), [fileOf({ originalName: 'scan-0042.pdf' })])).toBe('scan-0042.pdf');
});
it('heading and meta', () => {
  const q2 = filingOf({ key: 'co-1:financial_results:2026-09-30', kind: 'financial_results', periodEnd: '2026-09-30', spans: ['quarter', 'half_year'], settled: true, addedAt: '2026-10-19T08:32:00Z', files: [fileOf({ basis: 'consolidated' }), fileOf({ format: 'xbrl', basis: 'consolidated' }), fileOf({ format: 'xbrl', basis: 'standalone' })] });
  const q2View = buildView(readWith({ companies: [{ company: co, filings: [q2] }] }), ctx).done[0].filings[0];
  expect(filingHeading('Synthetic Cements', 'Results, quarter to 30 Sep 2026', 'financial_results')).toBe('Synthetic Cements · results, quarter to 30 Sep 2026');
  expect(filingMeta(q2View, new Date('2026-10-19T12:00:00Z'), 'Asia/Kolkata')).toBe('Consolidated and standalone · 3 files · added 14:02');
});
it('a duplicate is "Added twice" on the first copy', () => { expect(fileLine(fileOf({ originalName: 'ar.pdf', duplicates: ['d9'] }))).toBe('PDF · ar.pdf · Added twice'); });
it('sections: settled to Done, unsettled to Working on, needs_company with no code to the Notices', () => {
  const view = buildView(readWith({
    companies: [{ company: co, filings: [filingOf({ key: 'a', settled: true, files: [fileOf()] }), filingOf({ key: 'b', settled: false, files: [fileOf(), fileOf(), fileOf()] })] }],
    unsorted: [fileOf({ documentId: 'm1', originalName: 'meridian-q2.pdf', intakeState: 'needs_company', pipeline: { identified: 'needs_you' } })],
  }), ctx);
  expect(view.done.map((g) => [g.name, g.codes, g.filings.map((f) => f.key)])).toEqual([['Synthetic Cements', 'BSE 500999 · NSE SYNCEM', ['a']]]);
  expect(view.working.map((g) => g.filings.map((f) => f.key))).toEqual([['b']]);
  expect(view.unnamed.map((f) => f.documentId)).toEqual(['m1']);
  expect(view).toMatchObject({ workingCount: '1 filing · 3 files', doneCount: '1 filing', empty: false });
  expect(buildView(readWith(), ctx).empty).toBe(true);
});
it('a refused file and an abandoned upload go to Done, not Working on, after a reload', () => {
  const view = buildView(readWith({ unsorted: [rejected('r1', 'UNSUPPORTED_TYPE'), abandoned('u1')] }), ctx);
  expect(view.working).toEqual([]);
  expect(view.done[0]).toMatchObject({ companyId: null, name: 'Company not known yet' });
  expect(view.done[0].filings.map((f) => f.key).sort()).toEqual(['file:r1', 'file:u1']);
});
it('identification stopped goes to Done; a kept file still indexing stays in Working on', () => {
  const kept = { source: null, state: 'not_read', reason: 'not_a_read_kind' } as const;
  const stopped = fileOf({ documentId: 'b1', originalName: 'broken.xml', format: 'xbrl', intakeState: 'identify_failed', pipeline: { identified: 'failed', numbers: { source: 'xbrl', state: 'waiting', reason: 'not_identified' } } });
  const indexing = fileOf({ documentId: 'k1', intakeState: 'kept', pipeline: { numbers: kept, text: { state: 'now', pages: 286, pagesRead: 140 } } });
  const indexed = fileOf({ documentId: 'k2', intakeState: 'kept', pipeline: { numbers: kept } });
  const view = buildView(readWith({ unsorted: [stopped, indexing, indexed] }), ctx);
  expect(view.done[0].filings.map((f) => f.key).sort()).toEqual(['file:b1', 'file:k2']);
  expect(view.working[0].filings.map((f) => f.key)).toEqual(['file:k1']);
});
it('a file this page is sending stays in Working on', () => {
  const view = buildView(readWith({ unsorted: [abandoned('up-1')] }), ctx);
  expect(view.done).toEqual([]);
  expect(view.working[0]).toMatchObject({ companyId: null, name: 'Company not known yet' });
});
it('Done shows the newest 3 of 9, and names a stopped one it hides', () => {
  const nine: CompanyGroup = { companyId: 'co-1', name: 'Synthetic Cements', codes: '', filings: Array.from({ length: 9 }, (_, i) => fv({ key: `f${i}`, numbers: words(i === 7 ? 'stopped' : 'done') })) };
  expect(shownFilings(nine, false)).toMatchObject({ hidden: 6, hiddenStopped: 1 });
  expect(shownFilings(nine, false).shown.map((f) => f.key)).toEqual(['f0', 'f1', 'f2']);
  expect(showAllLabel(nine, false)).toBe('Show all 9 filings of Synthetic Cements · 1 stopped');
  expect(showAllLabel(nine, true)).toBe('Show the newest 3');
});
it('the open filing follows its document when the filing key changes', () => {
  const read = readWith({ companies: [{ company: co, filings: [filingOf({ key: 'co-1:financial_results:2026-09-30', settled: false, files: [fileOf({ documentId: 'd1' })] })] }] });
  expect(pickFiling(buildView(read, ctx), { key: 'file:d1', documentId: 'd1', name: 'd1.pdf' })?.key).toBe('co-1:financial_results:2026-09-30');
});
it('a document made a duplicate opens its first copy’s filing', () => {
  const read = readWith({ companies: [{ company: co, filings: [filingOf({ key: 'co-1:annual_report:2026-03-31', files: [fileOf({ documentId: 'orig', duplicates: ['d1'] })] })] }] });
  expect(pin(buildView(read, ctx), { key: 'file:d1', documentId: 'd1', name: 'ar.pdf' })).toEqual({ key: 'co-1:annual_report:2026-03-31', documentId: 'd1', name: 'ar.pdf' });
});
it('a document that becomes held or unnamed keeps the open filing on it, never an unrelated one', () => {
  const unrelated = { company: companyOf({ id: 'co-2' }), filings: [filingOf({ key: 'co-2:annual_report:2026-03-31', settled: false, files: [fileOf({ documentId: 'z1' })] })] };
  const opened = { key: 'file:d1', documentId: 'd1', name: 'coast-q2.xml' };
  const held = buildView(readWith({ companies: [unrelated], held: [heldOf({ key: 'bse:532999', documentIds: ['d1'] })] }), ctx);
  expect(pickFiling(held, opened)).toBeNull();
  expect(pin(held, opened)).toEqual(opened);
  expect(waitingAbove(held, opened)).toEqual({ kind: 'held', key: 'bse:532999', name: 'coast-q2.xml' });
  const unnamed = buildView(readWith({ companies: [unrelated], unsorted: [fileOf({ documentId: 'd1', intakeState: 'needs_company', pipeline: { identified: 'needs_you' } })] }), ctx);
  expect(pin(unnamed, opened)).toEqual(opened);
  expect(waitingAbove(unnamed, opened)).toEqual({ kind: 'unnamed', documentId: 'd1', name: 'coast-q2.xml' });
});
it('one file of a filing moves: the filing stays open; after the investor’s own Change it follows', () => {
  const view = buildView(readWith({ companies: [{ company: co, filings: [
    filingOf({ key: 'K', settled: false, files: [fileOf({ documentId: 'd1' }), fileOf({ documentId: 'd3' })] }),
    filingOf({ key: 'K2', settled: false, files: [fileOf({ documentId: 'd2' })] }),
  ] }] }), ctx);
  expect(pin(view, { key: 'K', documentId: 'd2', name: 'd2.pdf' })).toEqual({ key: 'K', documentId: 'd1', name: 'd1.pdf' });
  expect(follow(view, 'd2')).toEqual({ key: 'K2', documentId: 'd2', name: 'd2.pdf' });
  expect(follow(view, 'nowhere')).toBeNull();
});
it('with nothing opened, the newest unsettled filing opens', () => {
  const read = readWith({ companies: [{ company: co, filings: [
    filingOf({ key: 'old', settled: false, addedAt: '2026-10-18T08:00:00Z', files: [fileOf({ documentId: 'o1' })] }),
    filingOf({ key: 'new', settled: false, addedAt: '2026-10-19T08:00:00Z', files: [fileOf({ documentId: 'n1' })] }),
    filingOf({ key: 'done', settled: true, addedAt: '2026-10-20T08:00:00Z', files: [fileOf({ documentId: 'x1' })] }),
  ] }] });
  expect(pin(buildView(read, ctx), null)).toEqual({ key: 'new', documentId: 'n1', name: 'n1.pdf' });
});
it('once pinned, a newer unsettled filing does not take over, nor does its own work finishing', () => {
  const older = filingOf({ key: 'older', settled: false, addedAt: '2026-10-18T08:00:00Z', files: [fileOf({ documentId: 'o1' })] });
  const newer = filingOf({ key: 'newer', settled: false, addedAt: '2026-10-19T08:00:00Z', files: [fileOf({ documentId: 'n1' })] });
  const opened = pin(buildView(readWith({ companies: [{ company: co, filings: [older] }] }), ctx), null);
  expect(pin(buildView(readWith({ companies: [{ company: co, filings: [older, newer] }] }), ctx), opened)?.key).toBe('older');
  expect(pin(buildView(readWith({ companies: [{ company: co, filings: [{ ...older, settled: true }, newer] }] }), ctx), opened)?.key).toBe('older');
});
it('a polled document that changes filing asks for the filings again', () => {
  const before = fileOf({ documentId: 'd1', intakeState: 'identifying', pipeline: { identified: 'now' } });
  expect(shapeChanged(before, docOf({ id: 'd1', intakeState: 'needs_company', pipeline: pipe({ identified: 'needs_you' }) }))).toBe(true);
  expect(shapeChanged(before, docOf({ id: 'd1', intakeState: 'duplicate', pipeline: pipe({ identified: 'now' }) }))).toBe(true);
  expect(shapeChanged(before, docOf({ id: 'd1', intakeState: 'identifying', pipeline: pipe({ identified: 'now', text: { state: 'now', pagesRead: 12 } }) }))).toBe(false);
});
it('answers load for the opened filing’s stored files that have none, and again for a file that moved', () => {
  const view = fv({ files: [fileOf({ documentId: 'a' }), fileOf({ documentId: 'b' }), abandoned('c')] });
  expect(answersWanted(view, { a: null }, new Set())).toEqual(['b']);
  expect(answersWanted(view, { a: null, b: null }, new Set(['a']))).toEqual(['a']);
  expect(answersWanted(null, {}, new Set())).toEqual([]);
});
it('identifying is true while any file is checked or identified, never for an abandoned upload', () => {
  expect(identifying(readWith({ unsorted: [fileOf({ pipeline: { identified: 'now' } })] }), ctx)).toBe(true);
  expect(identifying(readWith({ unsorted: [abandoned('up-1')] }), ctx)).toBe(true); // this page is sending it
  expect(identifying(readWith({ unsorted: [abandoned('u1')] }), ctx)).toBe(false);
  expect(identifying(readWith({ unsorted: [] }), ctx)).toBe(false);
});
it('an abandoned upload never holds back a new question', () => {
  const read = readWith({ unsorted: [abandoned('u1')], held: [heldOf({ key: 'bse:532999', nameAsPrinted: 'Coastline Bank Limited' })] });
  expect(identifying(read, ctx)).toBe(false);
  expect(newQuestions(new Set(), read).aloud).toBe('Coastline Bank needs you: confirm the company.');
});
it('a fallback track is not live; In line is', () => {
  expect(filingLive(fv({ numbers: words('next', '—'), text: words('next', '—') }), ctx)).toBe(false);
  expect(filingLive(fv({ text: words('next', 'In line') }), ctx)).toBe(true);
  expect(filingLive(fv({ files: [abandoned('up-1')] }), ctx)).toBe(true);
});
it('a filings read never rolls back a file its own poll wrote', () => {
  const polled = readWith({ unsorted: [fileOf({ documentId: 'd1', pipeline: { numbers: { source: 'pdf', state: 'now' } } })] });
  const stale = readWith({ unsorted: [fileOf({ documentId: 'd1', pipeline: { numbers: { source: null, state: 'waiting', reason: 'not_identified' } } })] });
  expect(keepFresher(polled, stale, ['d1']).unsorted[0].pipeline.numbers.state).toBe('now');
  expect(keepFresher(polled, stale, []).unsorted[0].pipeline.numbers.state).toBe('waiting');
});
it('applyDocument returns the same read when no file matches', () => {
  const read = readWith({ unsorted: [fileOf({ documentId: 'd1' })] });
  expect(applyDocument(read, docOf({ id: 'nope' }))).toBe(read);
});
it('one new question is said by name', () => {
  expect(newQuestions(new Set(), readWith({ held: [heldOf({ key: 'bse:532999', nameAsPrinted: 'Coastline Bank Limited' })] })).aloud).toBe('Coastline Bank needs you: confirm the company.');
  const printed = fileOf({ documentId: 'm1', originalName: 'meridian-q2.pdf', companyNameAsPrinted: 'Meridian Foods Limited', intakeState: 'needs_company', pipeline: { identified: 'needs_you' } });
  expect(newQuestions(new Set(), readWith({ unsorted: [printed] })).aloud).toBe('meridian-q2.pdf needs you: is this Meridian Foods Limited?');
});
it('many new questions are said as one count', () => {
  const read = readWith({
    held: Array.from({ length: 31 }, (_, i) => heldOf({ key: `bse:5${String(i).padStart(5, '0')}` })),
    unsorted: [
      fileOf({ documentId: 'm1', intakeState: 'needs_company', pipeline: { identified: 'needs_you' } }),
      fileOf({ documentId: 'm2', intakeState: 'needs_kind', pipeline: { identified: 'needs_you' } }),
    ],
  });
  expect(newQuestions(new Set(), read).aloud).toBe('31 companies and 2 files need you.');
  expect(newQuestions(newQuestions(new Set(), read).seen, read).aloud).toBeNull();
});
```

- [ ] **Step 2: Run to see them fail.** `cd apps/web && pnpm vitest run src/lib/documents/filings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `buildView` takes a 400-filing read without sorting it again: the server's order stands.
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/documents/filings.ts apps/web/src/lib/documents/filings.test.ts apps/web/src/lib/content/documents.ts
git commit -m "feat(web): the Documents view model: filings by company in Working on and Done, titles, the open filing and where it goes, merges and questions"
```

---

### Task 6: Companies to confirm

**Files:**
- Create: `apps/web/src/lib/documents/confirm.ts`
- Modify: `apps/web/src/lib/documents/intake.ts` (export `CIN`, `BSE` and `NSE`, module-private today, and add `ISIN` beside them), `apps/web/src/lib/content/documents.ts` (group `confirm`)
- Test: Create `apps/web/src/lib/documents/confirm.test.ts`

**Interfaces:**
- Consumes: `HeldIdentity`, `Company`, `ConfirmCompanyRequest`, `ConfirmCompanyResponse`, `FilingFile`, `ApiError` and the builders of `testing.ts` (Task 2); `shortName` (`$lib/research/summary`). It reuses the regexes of `intake.ts`: this task exports `CIN`, `BSE` and `NSE` from there (they are module-private today) and adds `export const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/` beside them.
- Produces:
  - `CONFIRM_SHOWN = 4`.
  - `ConfirmRow = { identity: HeldIdentity; title: string; codes: string; counts: string; addLabel: string; mode: 'add' | 'pick'; primary: boolean; matches: Company[] }`. The fields are these:
    - `title` is the printed name, or the codes when there is none;
    - `codes` is "BSE 532999 · NSE COASTBANK · ISIN INE999Z01011 · CIN …", each part only when set;
    - `counts` is "9 filings · 26 files";
    - `addLabel` is "Add " + `shortName(nameAsPrinted)` ("Add Coastline Bank"), or "Add this company" with no name;
    - `mode` is `pick` when `matches` is not empty;
    - `primary` is true on the first row only.
  - `confirmRows(held: HeldIdentity[], companies: Company[], expanded: boolean): { rows: ConfirmRow[]; more: number }`. The more line reads "27 more companies", with "Show all".
  - `sectionLede(held: HeldIdentity[]): string`: "31 companies. Their 214 files wait until you confirm each company, once."
  - `confirmRequest(identity: HeldIdentity, choice: { id: string } | { name: string }): ConfirmCompanyRequest`. It carries only the identifiers that pass the API's checks. A new company is `{ new: { displayName: name.trim(), country: 'IN', …identifiers } }`.
  - `confirmedAloud(name: string, isNew: boolean, response: ConfirmCompanyResponse): string`:
    - a new company: "Coastline Bank added. Its 26 files carry on." ("Its file carries on." for 1);
    - an existing company: "26 files confirmed as Coastline Bank.";
    - `confirmed` 0: "Nothing was waiting for this company any more."
  - `confirmFailure(error: unknown): Failure` (the `Failure` of `intake.ts`):
    - `CONFLICT`: the existing `changeFailed.companyClash`, `reload: true` (read the companies again and open the picker);
    - `UNAUTHENTICATED`: `signedOut`;
    - `NETWORK`: `offline`;
    - `VALIDATION_FAILED`: `invalid`;
    - else `other`.
  - `unnamedNotice(file: FilingFile): { title: string; detail: string }`, with the action "Say which company" for both:
    - no `companyNameAsPrinted`: title "meridian-q2.pdf: which company is this?", detail "Maester couldn’t find the company on the first pages. Say which it is and it carries on.";
    - a printed name but no code (phase 4 groups held files by codes only, so this file is unsorted): title "meridian-q2.pdf: is this Meridian Foods Limited?" (today's `company.question`, after the file name), detail "No company code is printed beside the name, so Maester can’t match it. Add it, or say which of your companies it is."

- [ ] **Step 1: Write the failing tests**

```ts
import { companyOf, fileOf, heldOf } from './testing';
const thirtyOne = [
  heldOf({ key: 'bse:532999|isin:INE999Z01011|nse:COASTBANK', nameAsPrinted: 'Coastline Bank Limited', cin: null, bseCode: '532999', isin: 'INE999Z01011', nseSymbol: 'COASTBANK', filings: 9, files: 26 }),
  heldOf({ key: 'bse:600000', files: 14 }),
  ...Array.from({ length: 29 }, (_, i) => heldOf({ key: `bse:6${String(i + 1).padStart(5, '0')}`, files: 6 })),
];
it('rows: four shown, the rest counted, the first Add primary', () => {
  expect(sectionLede(thirtyOne)).toBe('31 companies. Their 214 files wait until you confirm each company, once.');
  const { rows, more } = confirmRows(thirtyOne, [], false);
  expect(rows).toHaveLength(4); expect(more).toBe(27);
  expect(rows[0]).toMatchObject({ title: 'Coastline Bank Limited', codes: 'BSE 532999 · NSE COASTBANK · ISIN INE999Z01011', counts: '9 filings · 26 files', addLabel: 'Add Coastline Bank', mode: 'add', primary: true });
  expect(rows[1].primary).toBe(false);
});
it('a row that matches a company already added asks which', () => { expect(confirmRows([heldOf({ matches: ['co-1'] })], [companyOf({ id: 'co-1' })], false).rows[0]).toMatchObject({ mode: 'pick', matches: [{ id: 'co-1' }] }); });
it('the request carries only well-formed identifiers', () => {
  expect(confirmRequest(heldOf({ cin: 'not-a-cin', bseCode: '532999', isin: 'INE999Z01011', nseSymbol: 'COASTBANK', nameAsPrinted: 'Coastline Bank Limited' }), { name: 'Coastline Bank Limited' })).toEqual({
    identity: { bseCode: '532999', isin: 'INE999Z01011', nseSymbol: 'COASTBANK' },
    company: { new: { displayName: 'Coastline Bank Limited', country: 'IN', bseCode: '532999', isin: 'INE999Z01011', nseSymbol: 'COASTBANK' } },
  });
});
it('said once confirmed', () => { expect(confirmedAloud('Coastline Bank', true, { companyId: 'c', confirmed: 26 })).toBe('Coastline Bank added. Its 26 files carry on.'); });
it('a name clash reloads the companies and opens the picker', () => { expect(confirmFailure(new ApiError(409, 'CONFLICT', 'x'))).toEqual({ message: copy.changeFailed.companyClash, reload: true }); });
it('an unsorted file that prints a name but no code is asked by its name', () => {
  expect(unnamedNotice(fileOf({ originalName: 'meridian-q2.pdf', companyNameAsPrinted: null }))).toEqual({ title: 'meridian-q2.pdf: which company is this?', detail: 'Maester couldn’t find the company on the first pages. Say which it is and it carries on.' });
  expect(unnamedNotice(fileOf({ originalName: 'meridian-q2.pdf', companyNameAsPrinted: 'Meridian Foods Limited' }))).toEqual({ title: 'meridian-q2.pdf: is this Meridian Foods Limited?', detail: 'No company code is printed beside the name, so Maester can’t match it. Add it, or say which of your companies it is.' });
});
```

- [ ] **Step 2: Run to see them fail.** `cd apps/web && pnpm vitest run src/lib/documents/confirm.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/documents/confirm.ts apps/web/src/lib/documents/confirm.test.ts apps/web/src/lib/documents/intake.ts apps/web/src/lib/content/documents.ts
git commit -m "feat(web): companies to confirm, one row per printed identity, and the confirm request"
```

---

### Task 7: A batch that stops offline, and "Send the rest"

**Files:**
- Modify: `apps/web/src/lib/documents/batch.ts`, `apps/web/src/lib/content/documents.ts` (`drop`)
- Modify: `apps/web/src/lib/components/documents/DropStrip.svelte` (the Notice's offline action), `apps/web/src/lib/components/documents/DocumentsPage.svelte` (today's page: the `result` type and `onresend`)
- Test: `apps/web/src/lib/documents/batch.test.ts`

**Interfaces:**
- Consumes: `sendAll`, `Outcome`, `Picked`, `sendFailure` (as built, after phase 4 Task 19); today's `DocumentsPage` `addFiles(picked: Picked[])`.
- Produces:
  - `Outcome` gains `rest: Picked[]`: the files refused with stop `offline`, then the files never tried, in the order chosen. A file the API refused for itself (`UPLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`) and a file the browser refused are never in it. `sendAll` returns `Pick<Outcome, 'sent' | 'refused' | 'unsent' | 'stopped' | 'rest'>`. `rest` is empty unless `stopped` is `offline`.
  - `unfinishedTitle(outcome: Outcome): string`: "The upload didn’t finish. 214 of 806 files were sent." The 806 is `outcome.total`, so it counts files the browser refused too.
  - `refusedTitle` is unchanged, except that a batch stopped `offline` takes `unfinishedTitle` as the Notice's first line. The offline sentence `drop.stopped.offline` goes, and `drop.restNote` comes: "A file that had started sending may also show under “Company not known yet” as unfinished. Documents can’t be removed yet." (Decision 11).
  - `DropStrip` gains an optional prop, `onresend?: (rest: Picked[]) => void`. For a batch stopped `offline` with `rest` not empty and `onresend` set, the Notice's action is an outline "Send the rest" calling `onresend(outcome.rest)`, with `drop.restNote` muted under it, where today's is "Choose files to add". Without `onresend` it keeps today's action. The line `copy.drop.stopped[refused.stopped](refused.unsent)` runs only when `refused.stopped` is `'signed-out'`, since the offline sentence is gone.
  - Today's `DocumentsPage` declares `let result: Pick<Outcome, 'sent' | 'refused' | 'unsent' | 'stopped'>` and builds `ended: Outcome` from it. Its `Pick` gains `'rest'`, its default gains `rest: []`, and it passes `onresend={addFiles}` to `DropStrip`. Task 10 keeps that wiring when it rewrites the page.

- [ ] **Step 1: Write the failing tests**

```ts
// inside describe('sendAll'), with its many() and pick(); the file's outcome() builder gains rest: []
it('offline at the third file: the rest is the offline failures and the untried, in order', async () => {
  const result = await sendAll(many(10), null, async (item) => {
    if (item.path >= 'f2.pdf') throw new ApiError(0, 'NETWORK', 'offline');
  });
  expect(result.stopped).toBe('offline');
  expect(result.sent).toBe(2);
  expect(result.rest.map((p) => p.path)).toEqual(['f2.pdf', 'f3.pdf', 'f4.pdf', 'f5.pdf', 'f6.pdf', 'f7.pdf', 'f8.pdf', 'f9.pdf']);
  // f0 and f1 go; f2–f5 fail offline (the f0 and f1 lanes start f4 and f5 before the f2 and f3 lanes catch); f6–f9 are never tried
});
it('the files that went are never in the rest', async () => {
  const went: string[] = [];
  const result = await sendAll(many(10), null, async (item) => {
    if (item.path >= 'f2.pdf') throw new ApiError(0, 'NETWORK', 'offline');
    went.push(item.path);
  });
  expect(went).toEqual(['f0.pdf', 'f1.pdf']);
  expect(result.rest.filter((p) => went.includes(p.path))).toEqual([]);
});
it('a file the API refused for itself is not in the rest', async () => {
  const result = await sendAll(many(6), null, async (item) => {
    if (item.path === 'f0.pdf') throw new ApiError(413, 'UPLOAD_TOO_LARGE', 'big');
    if (item.path >= 'f3.pdf') throw new ApiError(0, 'NETWORK', 'offline');
  });
  expect(result.rest.map((p) => p.path)).toEqual(['f3.pdf', 'f4.pdf', 'f5.pdf']);
});
it('signed out has no rest', async () => {
  const result = await sendAll(many(6), null, async () => {
    throw new ApiError(401, 'UNAUTHENTICATED', 'signed out');
  });
  expect(result.stopped).toBe('signed-out');
  expect(result.rest).toEqual([]);
});
it('the unfinished title', () => {
  expect(unfinishedTitle(outcome({ total: 806, sent: 214, stopped: 'offline' }))).toBe('The upload didn’t finish. 214 of 806 files were sent.');
});
```

- [ ] **Step 2: Run to see them fail.** `cd apps/web && pnpm vitest run src/lib/documents/batch.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `rest: []` to the `outcome()` builder and to the existing `sendAll` cases that compare the whole result with `toEqual`. Change `DropStrip.svelte` and today's `DocumentsPage.svelte` as above, then run `npx @sveltejs/mcp svelte-autofixer` on both (expected: no issues).
- [ ] **Step 4: Run** `cd apps/web && pnpm vitest run src/lib/documents && pnpm check`. Expected: PASS; `svelte-check found 0 errors and 0 warnings`.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/documents/batch.ts apps/web/src/lib/documents/batch.test.ts apps/web/src/lib/components/documents/DropStrip.svelte apps/web/src/lib/components/documents/DocumentsPage.svelte apps/web/src/lib/content/documents.ts
git commit -m "feat(web): a batch that stops offline says how many went and offers Send the rest"
```

---

### Task 8: `Track`, `FilingList` and `ConfirmCompanies`

**Files:**
- Create: `apps/web/src/lib/components/documents/{Track.svelte,FilingList.svelte,ConfirmCompanies.svelte}`
- Modify: `apps/web/src/lib/components/documents/CompanyForm.svelte` (one optional prop, `primary`)

**Interfaces:**
- Consumes: Tasks 3, 5 and 6; `Notice`, `TextField`, `CompanyForm`.
- Produces (`CompanyForm`): an optional prop `primary?: boolean`, default `true`, so every caller today keeps its look. In `ask` mode the form's main button ("Use this company" with candidates, else "Add … as a company" or "Add this company") is filled only when `primary`, outline otherwise; the rest of the form is unchanged, and `change` mode ignores the prop. `ask` mode draws a filled button today with no way to turn it off, so without this prop an unnamed file's form would put a second filled button on the screen.
- Produces (props):
  - `Track`: `{ label: string; words: TrackWords; ink?: boolean; children?: Snippet }`. Its layout:
    - a 76px label column ("Numbers", "Text"; 14px, 700) and a body;
    - the first line at 16px, weight 700 when `needs-you` or `stopped`, else 400 (Decision 18);
    - the second line at 14px, `--ink-muted`;
    - with `ink` and `now`, an ink block: paper text, `--paper-muted` second line. `children` renders under the words (the opened filing's "Try again").
  - `FilingList`: `{ heading: string; count: string; groups: CompanyGroup[]; collapse: boolean; openedKey: string | null; onopen: (view: FilingView) => void; idPrefix: string }`. Its structure:
    - A `section` labelled by its `h2`, with the count in muted text beside it.
    - Each group is an `h3` with id `${idPrefix}-co-${companyId ?? 'none'}` and `tabindex="-1"`, with its codes muted.
    - Rows are a `ul` with 1px `--ink-muted` rules between them, and a 2px rule closes the list.
    - In each row, the left side is the title, an underlined button (as `EarlierList`'s name today) carrying `aria-current="true"` when opened, then `fileLine`s at 14px muted. The right side is a 1px `--ink-muted` box with Numbers over Text, never `ink`.
    - The opened row carries a 2px `--ink` left rule.
    - Two columns (1.1fr / 1.6fr) from a 36rem container, stacked below that (board C3).
    - With `collapse`, each group shows `shownFilings`, then a text button reading `showAllLabel` with `aria-expanded` and `aria-controls` the group's list.
  - `ConfirmCompanies`: `{ rows; more; expanded; lede; unnamed: FilingFile[]; companies: Company[]; onexpand: () => void; onconfirm: (request: ConfirmCompanyRequest, name: string, isNew: boolean) => Promise<boolean>; classificationOf: (documentId: string) => Promise<DocumentClassification | null>; onanswer: (documentId: string, basedOn: string, company: CompanyAnswer) => Promise<boolean> }`. Its structure:
    - A `section` with `h2` "Not in your workspace yet" and the lede.
    - One row per `ConfirmRow`:
      - the name as an `h3` (bold; `id="confirm-<key>"`, `tabindex="-1"`, the target of the open filing's "Go to it"), the counts right-aligned and tabular, the codes muted;
      - mode `add`: "Add …" (filled when `primary`, else outline) and an outline "It’s one of mine", which shows the picker (`aria-expanded`);
      - mode `pick`: the question "Which of your companies is this?", the picker shown, matches first and chosen, "Use this company" (filled when `primary`) and an outline "Add …";
      - a row with no printed name shows a `TextField` "Company name" before Add, with today's empty-name error.
    - The picker is a labelled `select`, "Your companies", with matches first.
    - "Show all" when `more > 0`.
    - Then each unnamed file as a `Notice role="note"` with `unnamedNotice`'s title and detail and "Say which company", inside a wrapper with `id="unnamed-<documentId>"` and `tabindex="-1"` (the other target of "Go to it"). "Say which company" is a toggle with `aria-expanded`. It loads the file's classification and shows `CompanyForm mode="ask"` inline, with `primary={unnamedPrimary && index === 0}`, where `unnamedPrimary` is true when there are no rows. The first opener is filled only while there are no rows and its form is closed; every other opener, and the first while its form is open, is outline. So one button on the screen is filled at a time, however many forms are open.
    - A busy action disables its own buttons and points at a visible "Saving…" line. A failure shows a `Notice` under its row.

- [ ] **Step 1: Write the components.** Start from `EarlierList.svelte` (row button and hairlines) and `Slip.svelte` (the text-button and Notice patterns). Scoped styles only, tokens only.
- [ ] **Step 2: Check them.** Run `npx @sveltejs/mcp svelte-autofixer ./apps/web/src/lib/components/documents/Track.svelte`, then the same for `FilingList.svelte`, `ConfirmCompanies.svelte` and `CompanyForm.svelte`. Expected: no issues. Then `cd apps/web && pnpm check && pnpm lint && pnpm vitest run src/lib/styles`. Expected: `svelte-check found 0 errors and 0 warnings`, lint clean, design guard PASS.
- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/components/documents/Track.svelte apps/web/src/lib/components/documents/FilingList.svelte apps/web/src/lib/components/documents/ConfirmCompanies.svelte apps/web/src/lib/components/documents/CompanyForm.svelte
git commit -m "feat(web): Track, FilingList and ConfirmCompanies for the Documents page; CompanyForm can draw its ask as outline"
```

---

### Task 9: `Filing`, the filing opened

**Files:**
- Create: `apps/web/src/lib/components/documents/Filing.svelte`
- Modify: `apps/web/src/lib/content/documents.ts` (group `filing`)

**Interfaces:**
- Consumes: Tasks 3–5; `KindForm`, `CompanyForm`, `Notice`, `SectionIssue`; `sourceOf`, `whatItIs`, `periodWords`, `statementsWords`, `identifiers`, `kindSaveLabel`, `companyCandidates` (`intake.ts`); `companyHref` (`$lib/research/links`); `apps/web/src/lib/components/Comparison.svelte` as the pattern for a ledger built from `div`s with roles.
- Produces (copy): `documentsContent.filing`, holding the keys of today's `slip` that the filing reads (`added`, `readAs`, `terms`, `youSaidSo`, `scannedPage`, `notConfirmed`, `noSource`, `change`, `changeLabel`, `cancel`, `notYet`, `seeFigures`, `readAgain`), copied, plus `opensInNewTab: 'Files open in a new tab.'`. `slip` stays until Task 10 moves its last readers and deletes it, so every commit passes `svelte-check`.
- Produces (props): `{ view: FilingView; company: Company | null; companies: Company[]; answers: Record<string, DocumentClassification | null>; answersFailed: readonly string[]; ctx: TrackContext; primaryAvailable: boolean; message: string | null; fileHref: (id: string) => string; onchange: (documentId: string, change: Change) => Promise<boolean>; onretry: (track: 'identify' | 'numbers' | 'text') => Promise<void>; onreadagain: () => Promise<void>; onreload: () => Promise<boolean>; heading?: HTMLHeadingElement /* bindable */ }`. `Change` moves from `Slip.svelte`'s module script to this one, unchanged. Below, `files` is `view.files` and `sources` is `view.filing?.sources ?? []`.
- The filing is a 2px `article` labelled by its `h2` (`tabindex="-1"`), in this order:
  1. **Heading.** `filingHeading`, then `filingMeta` muted.
  2. **Numbers.** A spec entry holding `Track label="Numbers" ink`. When it is `stopped`, it shows an outline "Try again": it calls `onretry('identify')` when `retryIds(files, sources, 'identify')` is not empty, else `onretry('numbers')` when `retryIds(files, sources, 'numbers')` is not empty, and is not shown when both are empty. While that runs, the button is disabled and points at "Asking Maester to try again…".
  3. **Sources.** For each `BasisSources`, an `h3` (`basisTitle`) and a ledger with the column headers Statement, Numbers from and In the PDF. The ledger is built as `Comparison.svelte` builds its table: `div`s with `role="table"` (labelled by the `h3`), `role="row"`, `role="columnheader"` and `role="cell"`. A real `<table>` with those roles would fail `svelte-check --fail-on-warnings`: in Svelte 5.57 `role="table"` on a `table` and `role="row"` on a `tr` are redundant roles and each warns. The rows are `sourceRows(basis, filing, pdfStatements)`, where `pdfStatements` is the PDF file's loaded `statementsFound`:
     - "Numbers from" has the note muted under its text;
     - "In the PDF" is bold when `strong`, then `missed` and the `open` link (`${fileHref(id)}#page=${pageIndex + 1}`, new tab, `rel="noopener"`), preceded by FigurePanel's comment `<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an API route that redirects to the stored PDF -->`, which `pnpm lint` needs on every such link;
     - below a 36rem container, rows stack. The header row is then `visually-hidden` (the class in `app.css`), never `display: none`, so the cells keep their headers for a screen reader. Each cell holds its column's name as a span with `aria-hidden="true"`, shown only when stacked.
     - With no sources (an unsorted file, a kept document), the section is left out.
  4. **Text.** A spec entry holding `Track label="Text" ink` with `textTrack(files, ctx, 'opened')` (Decision 8), with "Try again" calling `onretry('text')` when `stopped` and `retryIds(files, sources, 'text')` is not empty.
  5. **Files.** A spec entry listing each file as "XBRL · name" or "PDF · name", then "added …" muted. A file whose `state` is `stored` is a link (`fileHref`, new tab, `rel="noopener"`, with the same lint comment); any other file's name is plain text, because `…/documents/:id/file` answers 409 for it (Decision 15). One muted line under the list says `filing.opensInNewTab`. Duplicates are named under their file ("Added twice").
  6. **Questions.** A file in `needs_kind` shows today's `Notice` "Maester couldn’t tell what this is." and `KindForm`, with `primary` only when `primaryAvailable` (the page passes `filingPrimary`). After a save, focus goes to the heading. A held or unnamed file is never asked here: it has left every filing, and the page shows where it went (Decision 17).
  7. **Read as.** An `h3` "Read as", then one `h4` per file ("PDF · name"), each with today's spec list (What it is, Company, Period, Statements), its evidence lines and "Change" for What it is and Company, as the slip has them. XBRL evidence reads "ScripCode 500999" through `sourceOf`. When a file's answers did not load, a `SectionIssue role="note"` shows "What Maester worked out didn’t load." with "Try again" (`onreload`).
  8. **Actions.**
     - "See the figures" is a link (`companyHref`), shown when the company is confirmed and the Numbers track is `done`.
     - "Read it again" is an outline button, shown when `readAgainIds(files, sources)` is not empty and no track is `now`. It is disabled with its busy line while it runs.
     - Both are secondary actions.
- **Focus.** The page keys `Filing` by `openCount` (Task 10), so a re-pin by a read changes `view` under the same instance and never moves focus. An `h2` the page opened takes focus. After a Change saves and the file stays in this filing, focus returns to the Change that opened the form. When the file left this filing, the page follows it (`follow`, Task 5) and focuses the heading of the filing it opened.

- [ ] **Step 1: Write the component.** Move `Slip.svelte`'s Read-as markup, its `changeButton` and `sourceLine` snippets and its styles in, adapted per file, reading `copy.filing`. Do not change `KindForm` or `CompanyForm` here.
- [ ] **Step 2: Check it.** `npx @sveltejs/mcp svelte-autofixer ./apps/web/src/lib/components/documents/Filing.svelte`, then `cd apps/web && pnpm check && pnpm lint && pnpm vitest run src/lib/styles`. Expected: no issues; `svelte-check found 0 errors and 0 warnings`; lint clean; PASS.
- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/components/documents/Filing.svelte apps/web/src/lib/content/documents.ts
git commit -m "feat(web): the filing opened: both tracks, statement sources per basis, files, Read as per file, read it again"
```

---

### Task 10: `DocumentsPage` on filings; the slip, the ladder and Earlier go

**Files:**
- Modify: `apps/web/src/lib/components/documents/DocumentsPage.svelte` (rewritten), `apps/web/src/lib/documents/intake.ts`, `apps/web/src/lib/documents/client.ts` (drop `listDocuments`, `DOCUMENT_PAGE`), `apps/web/src/lib/content/documents.ts`
- Modify: `apps/web/src/lib/components/documents/KindForm.svelte` and `CompanyForm.svelte`, one line each: `copy.slip.cancel` becomes `copy.filing.cancel` (both read it today: `KindForm.svelte:115`, `CompanyForm.svelte:170`)
- Delete: `apps/web/src/lib/components/documents/{Slip.svelte,StageLadder.svelte,EarlierList.svelte}`
- Test: `apps/web/src/lib/documents/intake.test.ts`, `client.test.ts`

**Interfaces:**
- Consumes: everything above; `SignedInPage` (unchanged route `apps/web/src/routes/terminal/documents/+page.svelte`); `Hatch`, `SectionIssue`, `Notice`; `signInAgainHref`.
- `intake.ts` loses these: `StepStatus`, `Step`, `ViewOptions`, `ladder`, `stateLabel`, `isLive`, `anyLive`, `mergeList`, `pickSlip` and their helpers, with their tests. It keeps these: `MAX_UPLOAD_BYTES`, `POLL_MS` (2000), `LIST_POLL_MS` (5000), `whatItIs`, `sourceOf`, `statementsWords`, `periodWords`, `identifiers`, `companyAnswer`, `normalizeCompanyName`, `companyCandidates`, `kindSaveLabel`, `addedAt`, `changeFailure`, `Failure`, and the regexes. `sourceOf` reads `copy.filing.youSaidSo` and `copy.filing.scannedPage` in place of `copy.slip.*`.
- Copy changes (`documentsContent`):
  - `lede` becomes "Your filings, by company. A filing’s PDF and XBRL sit together: numbers come from XBRL when there is one, and every page’s text is indexed."
  - `slip` goes, with `steps`, `stepsLabel` and `step`; its last readers (`sourceOf`, `KindForm`, `CompanyForm`) now read `filing` (Task 9).
  - `states`, `earlier`, `announce` and `leaving` go.
  - `empty` is "Nothing added yet. Drop a filing above, or a whole folder of XBRL files."
  - `signedOut` reads `{ title: 'You’re signed out.', detail: 'Sign in to see where your filings stand. Nothing you added is lost.', action: 'Sign in' }`.
- The page's state: `load` (`'loading' | 'failed' | 'no-workspace' | 'signed-out' | 'ready'`), `read` (`$state.raw<WorkspaceFilings>`), `companies`, `opened: Opened | null`, `openCount: number`, `answers` (`$state.raw<Record<string, DocumentClassification | null>>`) and `answersFailed`, `uploadingIds`, `busy`, `sending`, `outcome`, `message`, `announcement`, `hidden`, `seenQuestions`, and `writes: Record<string, number>`.
- Derived values:
  - `ctx` and `view = buildView(read, ctx)`;
  - `openFiling = opened ? pickFiling(view, opened) : null`;
  - `waiting = openFiling ? null : waitingAbove(view, opened)`;
  - `confirm = confirmRows(read.held, companies, confirmExpanded)`;
  - `unnamedPrimary`: no confirm rows;
  - `filingPrimary`: no confirm rows and no unnamed files.
- **The opened filing** follows Decision 17 and Task 5's rules:
  - **Pinning.** After every read (first load, polls, changes, uploads, confirms), `opened = pin(view, opened)`.
  - **Keying.** `Filing` renders while `openFiling` is set, inside `{#key openCount}`. `openCount` goes up only when the investor opens a filing (`onopen`), when a lone upload opens one, and when `onchange`'s `follow` moves to another key. A re-pin by a read never changes it, so it never remounts `Filing` and focus stays where it was (WCAG 2.4.3). Each time it goes up, the page focuses the new heading after `tick()`.
  - **Waiting above.** While `waiting` is set, the filing column shows a `Notice role="note"` with Task 5's `waiting` words and an outline "Go to it", which focuses `#confirm-<key>` or `#unnamed-<documentId>`. Before it applies a read, the page notes whether focus is inside the filing's `article`; when that read leaves `waiting` set and focus was there, it moves focus to the same target after `tick()`. The question itself is said once through `newQuestions` (Decision 10), so nothing more is said. Once the file is confirmed it is in a filing again, and `pin` step 2 opens it there.
  - **Answers.** Each file's answers load once (`getClassification`, at once for several) for `answersWanted(openFiling, answers, changed)`, where `changed` holds the ids for which `shapeChanged` was true in the last poll or read, the files of the open filing after `onconfirm`, and the ids `onreadagain` sent. This runs on first load, whenever `opened.key` changes, and after every poll and read. `onchange` stores the answers its POST returns, as today. `pdfStatements` for the ledger come from the open filing's PDF answers loaded this way.
- **First load.** `readMe`, then `listFilings` and `listCompanies` at once. `seenQuestions` is seeded from `questionKeys(read)`, `opened` is pinned (and `openCount` set to 1), and the open filing's answers load.
  - While it loads, the drop strip shows, disabled and pointing at the status line. Hatch boxes stand in with the loaded desk's own grid, as today's `skeleton-slip` and `skeleton-earlier` do, so nothing moves when the data arrives: in the desk's first column a box the size of a filing (a 1.5rem heading box, two 4rem track entries, then four 2.75rem ledger rows), and in the second the boxes of two company groups (each a 1.5rem `h3` box, then two 4.5rem rows). One `role="status"` line, "Loading your documents.", and `aria-busy` on the region.
  - A failure shows `SectionIssue` "Your documents didn’t load." with "Try again".
  - No workspace, or 403 or 404 on the filings read, shows today's no-workspace issue.
- **Order on the page.** The `h1` and the lede, the drop strip (with the sending note under it while `sending`), `ConfirmCompanies` (only with rows or unnamed files), then the desk, then Done. The desk is `Filing` (or the waiting Notice) beside `FilingList` Working on: the filing first in the DOM, 1.3fr and 1fr from 1024px, stacked below that with the filing first. Done (`FilingList`, `collapse`) comes after, full width. With `view.empty`, the empty sentence replaces the desk and Done.
- **Polls.** They follow Decision 12, with today's back-off (base × min(1 + failures, 5)) and today's `visibilitychange`.
  - The open filing: every `POLL_MS` while `filingLive(openFiling, ctx)` and no file of it is being sent, `getDocument` for each file, then `applyDocument`, counting `writes`. When `shapeChanged(before, doc)` is true for any of them, the filings are read once, at once. When it stops being live, the filings are read once.
  - The list: every `LIST_POLL_MS` while `listWatched(view, openFiling?.key ?? null, ctx)`. The read uses `keepFresher` with the ids written since it began.
  - After each list read, when no batch is sending and `identifying(read, ctx)` is false, `newQuestions` says any new question. Otherwise `seenQuestions` is left as it is, so the held-back questions are said together once identification settles.
- **Signed out.** Any `UNAUTHENTICATED` from a read or an action sets `load = 'signed-out'`. Polls stop, and a `Notice role="alert"` shows `signedOut` with a link to `signInAgainHref('/terminal/documents')`. The read already on the page stays visible under it.
- **Adding files.** This is today's `addFiles`, with four changes:
  - `onCreated` calls `withUpload`;
  - a lone file opens `{ key: 'file:<id>', documentId: <id>, name: <file name> }`, raises `openCount` and focuses the filing heading;
  - a batch pins the open filing to its first file without moving focus;
  - at the end, the page reads the filings once and says `endAloud(outcome)`. When `identifying(read, ctx)` is already false, the `newQuestions(...).aloud` line is added to it; otherwise the questions follow later, as one line (Decision 10). `onresend={addFiles}` stays as Task 7 wired it.
- **Actions.**
  - `onopen(view)` sets `opened` to `{ key: view.key, documentId: view.files[0].documentId, name: view.files[0].originalName }`, raises `openCount` and focuses the heading.
  - `onchange` posts the classification, applies the returned document, stores its answers and reads the filings again. Then `opened = follow(view, documentId) ?? opened`: the open filing follows the file the investor changed (Review Focus 2). When that moved it to another key, `openCount` goes up and the new heading takes focus; otherwise focus returns to the Change that opened the form. Failures go through `changeFailure`, as today.
  - `onretry(track)` calls `classify`, `extract` or `index` for each `retryIds(files, sources, track)` id, then refreshes.
  - `onreadagain` calls `extract` for each `readAgainIds(files, sources)` id, never for any other id, then refreshes.
  - `onconfirm` calls `confirmCompany`. It reads the filings and the companies again, says `confirmedAloud` and focuses the company's Working on `h3` (or the Working on `h2`). Failures go through `confirmFailure`.
  - `onanswer` posts the unnamed file's company, as the slip does today.
- **Leaving.** `beforeunload` asks first while `sending`, as today.

- [ ] **Step 1: Delete the old tests and adjust the rest.** Remove `intake.test.ts`'s `ladder`, `stateLabel`, `isLive`, `pickSlip`, `anyLive` and `mergeList` blocks. In `client.test.ts`, rewrite the two tests that call `listDocuments` rather than deleting them; the second is the only test of `send`/`toError`'s error mapping:
  - "lists documents and companies under the workspace" becomes "reads the filings and the companies under the workspace": `scripted(json(200, { companies: [], held: [], unsorted: [] }), json(200, { items: [], nextCursor: null }))`, then `listFilings()` and `listCompanies()`; `expect(calls.map((c) => c.url)).toEqual([`/v1/workspaces/${WS}/filings`, `/v1/workspaces/${WS}/companies?limit=100`])`.
  - "names a failure with no envelope by its status, and a dropped connection as offline" calls `listFilings()` twice: `rejects.toMatchObject({ status: 502, code: 'INTERNAL' })`, then `rejects.toMatchObject({ status: 0, code: 'NETWORK' })`.

  Run `cd apps/web && pnpm vitest run src/lib/documents`. Expected: PASS.
- [ ] **Step 2: Rewrite `DocumentsPage.svelte`**, delete the three components and the dead code and copy, and change the one line in `KindForm.svelte` and `CompanyForm.svelte`.
- [ ] **Step 3: Check.** Run `npx @sveltejs/mcp svelte-autofixer` on `DocumentsPage.svelte`, `KindForm.svelte` and `CompanyForm.svelte` (expected: no issues). Then `cd apps/web && pnpm verify`. Expected: `svelte-check found 0 errors and 0 warnings`, Prettier and ESLint clean, all tests PASS, build OK. Also, from the repository root, `grep -rn "Slip\|StageLadder\|EarlierList\|pickSlip\|stateLabel\|copy\.slip" apps/web/src`. Expected: no output.
- [ ] **Step 4: Commit**

```bash
git add -A apps/web/src/lib/components/documents apps/web/src/lib/documents apps/web/src/lib/content/documents.ts
git commit -m "feat(web): the Documents page by filing: companies to confirm, Working on beside the open filing, Done; slip, ladder and Earlier removed"
```

---

### Task 11: The figure panel for an XBRL figure

**Files:**
- Modify: `apps/web/src/lib/research/types.ts`, `apps/web/src/lib/research/view.ts`, `apps/web/src/lib/research/summary.ts` (the P/E note's page), `apps/web/src/lib/research/client.ts` (`fileHref`), `apps/web/src/lib/content/research.ts`
- Modify: `apps/web/src/lib/components/research/{FigurePanel.svelte,StatementTable.svelte,CompanyPage.svelte}`
- Test: `apps/web/src/lib/research/view.test.ts`, `apps/web/src/lib/research/summary.test.ts`, `apps/web/src/lib/research/client.test.ts`

**Interfaces:**
- Consumes: phase 4 Task 14's `CellSource`, `XbrlInPdf` and `Restated` unions; `notCheckedWords` and `pagesWords` (Task 4); the existing `figure()`, `unitWords()`, `filingLong()` and `fyLabel()` of `view.ts`, and `view.test.ts`'s `cell()` and `NO_CHECK`.
- Produces (`types.ts`): `PageSource = { kind: 'page'; documentId; pageIndex; pageCount; textLayerMatch }`; `XbrlSource = { kind: 'xbrl'; documentId; originalName; element; contextId; decimals: string | null; nil: boolean; periodStart: string | null; span: FactSpan | null; inPdf: XbrlInPdf }`; `CellSource = PageSource | XbrlSource` (the page variant's `kind` is now required); `XbrlInPdf`; `Restated` as phase 4's two variants.
- Produces (`client.ts`): `researchApi` gains `fileHref(documentId: string): string`, built beside `pageHref` from the same `base` (`${base}/documents/${encodeURIComponent(documentId)}/file`); `pageHref` becomes `fileHref(documentId) + '#page=' + (pageIndex + 1)`. Research does not import `documentsApi` for this.
- Produces (`view.ts`, pure):
  - `sourcePage(cell: FinancialCell): number | null`: the 1-based page of a page source, else null. `cellReason`, `pageWords`, `onPage` and the P/E note use it; none of them reads `source.pageIndex` of an XBRL source (it has none, and today's `cellReason` would read `NaN`).
  - `cellReason` for an XBRL cell never falls through to the page words:
    - `missing` is unchanged;
    - `nil` gives "The XBRL file gives no value for this line.";
    - `unparsed`, not nil, gives "Maester couldn’t read the value the XBRL file gives for this line.";
    - any other XBRL cell with no value (the instance declares no rounding, so no `reported_value` is written: `XBRL_ROUNDING_MISSING`) gives "The XBRL file doesn’t declare its rounding, so the unit isn’t known."
  - `xbrlFrom(source: XbrlSource, periodEnd: string): { text: string; note: string }`. The text is "Results for the {span} to {d Mon yyyy}: the XBRL filed with the PDF". The span is quarter, half year, nine months or year; an instant reads "Results at 31 Mar 2026". It ends "…: the XBRL file" when `inPdf.pdfDocumentId` is null. The note is "{originalName} · tagged {element}". `contextId` never appears.
  - `xbrlUnit(input: { shown: TableUnit; perShare: boolean; decimals: string | null; declared: TableUnit | null }): string` (Decision 13):
    - the unit is `unitWords(shown)`, or "{currency} a share" ("₹ a share") for a per-share row;
    - `declared` null (always, in this phase: `CellSource` carries no declared unit) adds nothing; a declared unit with the shown scale and currency adds ", as the filing declares"; any other adds ", converted from {unitWords(declared)} as the filing declares";
    - the precision clause "; rounded to the {word}" is added only when it agrees with the two places `figure()` shows: the currency is the rupee and the shown scale's exponent (0 for a per-share row) plus `decimals` is 2. The exponent is read from the scale string's digits as text (`'10000000'` is a 1 and 7 zeros, so 7), never through `Number()`, and `decimals` is the integer attribute XBRL gives (`"-5"`), not a figure. The word comes from `decimals`: −7 crore, −5 lakh, −4 ten thousand, −3 thousand, −1 ten, 2 the paisa. Otherwise (`INF`, null, another currency, or a precision finer or coarser than the two places shown) the clause is left out, never stated against the figure beside it.
  - `restatedWords(cell: FinancialCell, unit: TableUnit, perShare: boolean): string | null`, worded by which source owns the cell, never by "newer" (an XBRL filing owns its slot over a newer PDF):
    - a page variant: "{filingLong(filingPeriodEnd)} printed {printed} for this year, on page {page}." then " The newer filing’s figure is shown." when the cell's own source is a page, or " The XBRL filing’s figure is shown." when it is XBRL;
    - an XBRL variant: "{filingLong(filingPeriodEnd)} filed {figure(value)} {unit} for this year in its XBRL file." then " The newer XBRL filing’s figure is shown." when the cell's own source is XBRL, else " This filing’s figure is shown." The value goes through `figure()` with the table's unit words ("₹ a share" on a per-share row), never the raw `printed`, which for an XBRL fact is the instance's text in whole rupees;
    - `Restated` carries no filing kind, so the other filing is named by `filingLong` ("Annual report …"), which is true while only annual reports reach the table (Departure 6). Naming a results filing waits for the kind (After this plan).
  - `addsUp` for an XBRL cell says what the XBRL file gives, never a page: `words.failedXbrl.text(lines, total, difference, more)` "The lines add up to {lines}; the XBRL file gives {total}, {difference} more|less." and `words.identityFailedXbrl.text(subject, total, sides, difference, more)` "{Subject} doesn’t equal equity and liabilities: the XBRL file gives {total}; equity and liabilities come to {sides}, {difference} more|less." Passed, part of, no sum and not checked are as today.
  - `inPdfWords(inPdf: XbrlInPdf): Words`:
    - passed, with a page: "Found on page 5 of the results PDF.";
    - passed, with no page: "Found on the results PDF’s statement pages (4–6).";
    - failed: strong "Not found on the PDF’s statement pages (4–6)." and text " The figure stays as filed in XBRL. Check the PDF yourself.";
    - not checked: `notCheckedWords(reason)`.
  - `xbrlOpen(source: XbrlSource): { documentId: string; pageIndex: number | null; label: string; note: string } | null`:
    - no PDF: null;
    - passed with a page: "Open the results PDF at page 5", with "The page where the check found this figure. The XBRL file itself has no pages.";
    - otherwise with statement pages: the first of them, "Open the results PDF at page 4", with "Where the statement pages start. The XBRL file has no pages.";
    - otherwise: "Open the results PDF", with "The XBRL file has no pages."
  - `columnFrom(table: StatementTable, c: number): 'xbrl' | 'page' | null`: the source kind of the column's cells.
  - `yearSources(tables: StatementTable[], basis: ReportingBasis): { year: string; words: string }[]`. It returns one entry per year whose statements come from different sources, for example `{ year: '2025–26', words: 'Profit and loss and balance sheet from the XBRL; cash flow from the annual report, read by Gemini.' }`. When nothing mixes, it returns [].
- Copy changes (`researchContent`):
  - `statements.newestWins` becomes "Each year comes whole from one filing: an XBRL filing first, otherwise the newest filing that prints it, so a column never mixes filings or sources." (always);
  - `panel.terms` gains `unit: 'Unit'` and `inPdf: 'In the PDF'`;
  - the column sub-label for an XBRL column is "Results, XBRL";
  - `panel.restated` and the new `panel.restatedXbrl` carry the words of `restatedWords`; `words.failedXbrl` and `words.identityFailedXbrl` as above; `words.xbrlNil`, `words.xbrlUnparsed` and `words.xbrlNoRounding` for `cellReason`.
- `FigurePanel` gains a `fileHref: (documentId: string) => string` prop (`CompanyPage` passes `api.fileHref`, as it passes `api.pageHref`). For an XBRL source it shows these entries:
  - From (`xbrlFrom`, the note muted);
  - Unit (`xbrlUnit`, with `declared` null);
  - In the PDF (`inPdfWords`, in place of "On the page");
  - Adds up (`addsUp`), Restated (`restatedWords`), Used in and Reviewed;
  - the `xbrlOpen` link and its note, built with `pageHref` (with a page) or `fileHref` (without), with FigurePanel's `eslint-disable-next-line svelte/no-navigation-without-resolve` comment, or no link.

  A page source is unchanged, except that its Restated line uses `restatedWords` too. `StatementTable` uses `columnFrom` for the sub-label. `CompanyPage` lists `yearSources` as a muted spec list under the table's note.

- [ ] **Step 1: Write the failing tests** with hand-built cells, which are test inputs, not data the page shows:

```ts
// view.test.ts, with its cell() and NO_CHECK
const x: XbrlSource = { kind: 'xbrl', documentId: 'x4', originalName: '500999_Q4_FY26_Consolidated.xml', element: 'RevenueFromOperations', contextId: 'FourD', decimals: '-5', nil: false, periodStart: '2025-04-01', span: 'year', inPdf: { status: 'passed', pdfDocumentId: 'p4', pageIndex: 4, statementPages: [3, 4, 5], reason: null } };
const xbrlCell = (over: Partial<FinancialCell> = {}) => cell({ source: x, ...over });
const crore: TableUnit = { label: 'crores', scale: '10000000', currency: 'INR' };
const lakh: TableUnit = { label: 'lakhs', scale: '100000', currency: 'INR' };
it('From names the filing and the file, never the context', () => {
  expect(xbrlFrom(x, '2026-03-31')).toEqual({ text: 'Results for the year to 31 Mar 2026: the XBRL filed with the PDF', note: '500999_Q4_FY26_Consolidated.xml · tagged RevenueFromOperations' });
  expect(JSON.stringify(xbrlFrom(x, '2026-03-31'))).not.toContain('FourD');
});
it('From with no PDF stored', () => { expect(xbrlFrom({ ...x, inPdf: { ...x.inPdf, status: 'not_checked', pdfDocumentId: null, reason: 'no_pdf' } }, '2026-03-31').text).toBe('Results for the year to 31 Mar 2026: the XBRL file'); });
it('Unit: the declaration only when the cell carries one; the precision only where the two places shown agree', () => {
  expect(xbrlUnit({ shown: crore, perShare: false, decimals: '-5', declared: null })).toBe('₹ crore; rounded to the lakh');
  expect(xbrlUnit({ shown: crore, perShare: false, decimals: '-5', declared: crore })).toBe('₹ crore, as the filing declares; rounded to the lakh');
  expect(xbrlUnit({ shown: crore, perShare: false, decimals: '-5', declared: lakh })).toBe('₹ crore, converted from ₹ lakh as the filing declares; rounded to the lakh');
  expect(xbrlUnit({ shown: crore, perShare: false, decimals: '-7', declared: null })).toBe('₹ crore');
  expect(xbrlUnit({ shown: crore, perShare: true, decimals: '2', declared: null })).toBe('₹ a share; rounded to the paisa');
  expect(xbrlUnit({ shown: crore, perShare: true, decimals: 'INF', declared: null })).toBe('₹ a share');
  expect(xbrlUnit({ shown: { label: 'millions', scale: '1000000', currency: 'USD' }, perShare: false, decimals: '-4', declared: null })).toBe('USD million');
});
it('In the PDF, each outcome (S1)', () => {
  expect(inPdfWords(x.inPdf)).toEqual({ text: 'Found on page 5 of the results PDF.' });
  expect(inPdfWords({ ...x.inPdf, status: 'failed', pageIndex: null })).toEqual({ strong: 'Not found on the PDF’s statement pages (4–6).', text: ' The figure stays as filed in XBRL. Check the PDF yourself.' });
  expect(inPdfWords({ ...x.inPdf, status: 'not_checked', reason: 'disabled' }).text).toBe('Not checked: the check is turned off.');
});
it('the button: the match page, else where the statement pages start, else none', () => {
  expect(xbrlOpen(x)).toMatchObject({ pageIndex: 4, label: 'Open the results PDF at page 5', note: 'The page where the check found this figure. The XBRL file itself has no pages.' });
  expect(xbrlOpen({ ...x, inPdf: { ...x.inPdf, status: 'failed', pageIndex: null } })).toMatchObject({ pageIndex: 3, label: 'Open the results PDF at page 4' });
  expect(xbrlOpen({ ...x, inPdf: { ...x.inPdf, pdfDocumentId: null } })).toBeNull();
});
it('an XBRL cell with no figure has a reason of its own, never a page sentence', () => {
  const nil = xbrlCell({ status: 'unparsed', value: null, source: { ...x, nil: true } });
  expect(cellText(nil)).toBe('—');
  expect(cellReason(nil, 'Results, XBRL')).toBe('The XBRL file gives no value for this line.');
  expect(cellReason(xbrlCell({ status: 'unparsed', value: null }), 'Results, XBRL')).toBe('Maester couldn’t read the value the XBRL file gives for this line.');
  expect(cellReason(xbrlCell({ status: 'value', value: null }), 'Results, XBRL')).toBe('The XBRL file doesn’t declare its rounding, so the unit isn’t known.');
  expect(sourcePage(xbrlCell())).toBeNull();
});
it('restated: worded by the source that owns the cell, the XBRL value in the table’s unit', () => {
  const fromPage = { kind: 'page', documentId: 'ar', filingPeriodEnd: '2026-03-31', pageIndex: 212, value: '12100.00', printed: '12,100.00' } as const;
  expect(restatedWords(xbrlCell({ restated: fromPage }), crore, false)).toBe('Annual report 2025–26 printed 12,100.00 for this year, on page 213. The XBRL filing’s figure is shown.');
  expect(restatedWords(cell({ restated: fromPage }), crore, false)).toBe('Annual report 2025–26 printed 12,100.00 for this year, on page 213. The newer filing’s figure is shown.');
  const fromXbrl = { kind: 'xbrl', documentId: 'x3', filingPeriodEnd: '2026-03-31', element: 'RevenueFromOperations', value: '12100.5', printed: '121005000000' } as const;
  expect(restatedWords(xbrlCell({ restated: fromXbrl }), crore, false)).toBe('Annual report 2025–26 filed 12,100.50 ₹ crore for this year in its XBRL file. The newer XBRL filing’s figure is shown.');
  expect(restatedWords(cell(), crore, false)).toBeNull();
});
it('a sum that fails on an XBRL total says what the XBRL file gives, never a page', () => {
  const failed: CellCheck = { ...NO_CHECK, role: 'subject', status: 'failed', checkType: 'subtotal', subjectLabel: 'Total income', expected: '100.00', actual: '99.00' };
  expect(addsUp(xbrlCell({ check: failed }))).toEqual({ strong: 'No.', text: 'The lines add up to 99.00; the XBRL file gives 100.00, 1.00 more.' });
  const identity: CellCheck = { ...failed, checkType: 'balance_identity', subjectLabel: 'Total assets', actual: '98.00' };
  expect(addsUp(xbrlCell({ check: identity }))).toEqual({ strong: 'No.', text: 'Total assets doesn’t equal equity and liabilities: the XBRL file gives 100.00; equity and liabilities come to 98.00, 2.00 more.' });
});
it('a year from two sources is named; one source names nothing', () => {
  const page: PageSource = { kind: 'page', documentId: 'ar', pageIndex: 212, pageCount: 286, textLayerMatch: true };
  const tableOf = (statement: StatementKind, source: CellSource): StatementTable => ({
    statement, basis: 'consolidated', unit: crore, unplaced: 0, leftOut: [],
    columns: [{ periodEnd: '2026-03-31', periodLabel: '2025–26', documentId: source.documentId, filingPeriodEnd: '2026-03-31' }],
    rows: [{ key: 'r', section: '', label: 'Line', isSubtotal: false, perShare: false, cells: [cell({ source })] }],
  });
  expect(yearSources([tableOf('income_statement', x), tableOf('balance_sheet', x), tableOf('cash_flow', page)], 'consolidated')).toEqual([{ year: '2025–26', words: 'Profit and loss and balance sheet from the XBRL; cash flow from the annual report, read by Gemini.' }]);
  expect(yearSources([tableOf('income_statement', x), tableOf('cash_flow', x)], 'consolidated')).toEqual([]);
  expect(columnFrom(tableOf('cash_flow', page), 0)).toBe('page');
});
// summary.test.ts: no new test. Its P/E cases ("1,284.50 ÷ 61.98, the basic earnings per share for 2025–26 (annual report, page 213).")
// pass unchanged once their fixtures' source carries kind: 'page' and summary.ts reads the page through sourcePage().
// client.test.ts (research)
it('fileHref links the stored file; pageHref adds its page', () => {
  const api = researchApi(vi.fn() as unknown as Fetcher, 'w');
  expect(api.fileHref('d/1')).toBe('/v1/workspaces/w/documents/d%2F1/file');
  expect(api.pageHref('d/1', 212)).toBe('/v1/workspaces/w/documents/d%2F1/file#page=213');
});
```

- [ ] **Step 2: Run to see them fail.** `cd apps/web && pnpm vitest run src/lib/research`. Expected: FAIL.
- [ ] **Step 3: Implement**, including the page variant's `kind: 'page'` in the existing `view.test.ts` and `summary.test.ts` fixtures (the `cell()` builder's default source among them). Run `npx @sveltejs/mcp svelte-autofixer` on the three components.
- [ ] **Step 4: Run** `cd apps/web && pnpm verify`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/research apps/web/src/lib/components/research apps/web/src/lib/content/research.ts
git commit -m "feat(web): the figure panel for an XBRL figure: the filing and file, the unit and its rounding, the PDF check in words, the page it was found on"
```

---

### Task 12: `DESIGN.md` §5 and §10, and the system descriptions

**Files:**
- Modify: `docs/DESIGN.md`, `docs/systems/web.md` (STE), `docs/systems/maester.md` (STE)

**Interfaces:**
- Consumes: the built components, and spec §12's draft text.
- `DESIGN.md` §5 changes as follows:
  - **Drop strip:** replace it with spec §12's entry, keeping today's working sentences. Those are the folder walk and the left-out system files, four at a time, one batch at a time, the sending line not being live, the start and end said once, the Notice longer than eight scrolling, the signed-out stop, and the browser checks by name and first bytes. Add: "Stopped offline, the Notice says “The upload didn’t finish. 214 of 806 files were sent.” and offers “Send the rest”, which sends the files not tried and those that failed offline; a file that had arrived is marked a duplicate." Remove phase 4 Task 19's sentence about the `.xml` check and keep its meaning in the type check.
  - **Stage ladder, Slip, Earlier list:** remove them. Phase 4 Task 19's sentences under Stage ladder and Slip go with them.
  - **Filing list, Filing, Track, Companies to confirm:** add spec §12's four entries, extended with these decisions:
    - **Filing list:**
      - "The opened filing’s row carries `aria-current` and a 2px ink rule on its left.";
      - "Files with no company are filings of their own, titled by the file name, under “Company not known yet”, last.";
      - Done's "Show all {n} filings of {company}", which adds " · {k} stopped" when a stopped filing is among the hidden (Decision 20).
    - **Filing:**
      - the Numbers entry above the ledgers, and the Text entry, in spec §5's words once done;
      - the ledgers built from `div`s with table roles, as the Comparison ledger is, whose rows stack below a 36rem container with the header row visually hidden;
      - Read as per file, under an `h4` for each;
      - "Read it again reads the XBRL files again, and a PDF only when the filing’s sources still name it; never a PDF that XBRL covers, even one Gemini read before its XBRL came.";
      - "A miss is bold, with “Open the results PDF at page n” where the statement pages start.";
      - "Only a stored file is a link, and it opens in a new tab; a refused or unfinished file is named in plain text.";
      - the open filing asks for its files every 2 seconds while a track is working, the filings are read once when one of its files changes filing, and every 5 seconds while another filing in Working on is working;
      - the focus and announcement rules that the Slip entry carried, which go with it: opening a filing moves focus to its `h2`; a lone upload's filing takes focus, and a batch holds the open filing on its first file without moving focus; a re-pin by a read never moves focus; after a Change saves, focus returns to that Change, or, when the file moved, to the heading of the filing it moved to; a file that becomes held or unnamed leaves the note "{name} waits for you above." with "Go to it" in its place; a batch is said once at its start and once at its end, a new question once, and the result of the investor's own action once, and a track change is never said (Decision 10).
    - **Track:** the Numbers and Text words table of Task 3, by reference to `lib/documents/tracks.ts`; "The first line is bold only for Needs you and Stopped; the second line is muted." (Decision 18, in place of spec §12's "a bold first line"); "In the list a track is words only; in the opened filing the working track is an ink block."; it shows counts, never a percentage or a time left.
    - **Companies to confirm:**
      - the `pick` mode ("Which of your companies is this?", matches first and chosen, "Use this company");
      - "Past four rows, “27 more companies” and “Show all”.";
      - the unnamed Notice, which asks "Is this {name}?" when the file prints a name but no code;
      - one filled button at a time: the first row's action, else the first unnamed file's, however many forms are open;
      - the confirmed line said once.
  - **Figure panel:** add spec §12's sentence, plus these: the Unit entry, which names the unit and the rounding only where the rounding agrees with the two places shown, and says "as the filing declares" only when the figure carries the declared unit; "In the PDF" in place of "On the page" for an XBRL figure; a restatement worded by the source that owns the figure, never by "newer"; and an XBRL total's failed sum said as what "the XBRL file gives", never a page.
  - **Statement table:** the new note, the "Results, XBRL" sub-label and the per-year sources list.
  - **Section issue:** "on the slip when a step stopped" becomes "when an opened filing’s answers do not load".
  - **Hatch:** "while the slip and the Earlier list first load" becomes "while the filings first load: a filing in the desk's first column and two company groups beside it, in the loaded desk's grid".
- `DESIGN.md` §10 **Documents** is rewritten to spec §2's order and §10's states:
  - the lede;
  - drop strip, Not in your workspace yet (only when some), Working on beside the opened filing from 1024px (the filing about 1.3 times as wide, first), Done below;
  - stacked below 1024px, with the opened filing first;
  - which filing opens, by `pickFiling`'s order;
  - loading (the hatch of a filing and two company groups), failed, empty, stopped, offline and signed out;
  - "Copy lives in `lib/content/documents.ts`; the logic, free of Svelte and tested, in `lib/documents/`."
- `DESIGN.md` §10 **Research**: "Each year comes whole from the newest filing that prints it, so a column never mixes filings" becomes Task 11's rule, "Each year comes whole from one filing: an XBRL filing first, otherwise the newest filing that prints it, so a column never mixes filings or sources".
- `docs/systems/web.md` changes, in STE:
  - **Terms:** replace "slip", "Earlier list" and "live document" with "filing", "filing list", "track", "held company" and "live filing".
  - **Documents components:** the components table row lists `FilingList`, `Filing`, `Track`, `ConfirmCompanies` and `DropStrip`.
  - **Documents logic:** add the logic modules `tracks.ts`, `sources.ts`, `filings.ts` and `confirm.ts`.
  - **Documents sections:** rewrite "first load", "upload", "polls" and "answers", and add "confirm a company". The stale "one file at a time" goes.
  - **The intake logic row** (today's line 70, "file checks, slip choice, ladder steps, error messages") names what `intake.ts` keeps: file checks, answers in words, identifiers, error messages.
  - **The error table** (today's lines 342–346): "The slip shows the latest answers and a message" becomes "The opened filing shows …"; `identify_failed`, `read_failed` read "The track shows “Stopped”. The opened filing shows “Try again”."; `needs_company`, `needs_kind`, `duplicate` read "The track shows “Needs you”; a held company shows under “Not in your workspace yet”; a duplicate shows as “Added twice” on its first copy."; "Answers do not load" reads "The opened filing shows a `SectionIssue` with “Try again”."
  - **Known limits** (today's lines 507 and 509): "The Earlier list reads only the first 25 documents" becomes "The filings read has no page limit. The company form offers only the first 100 companies."; "the page does not ask the person to sign in" becomes what Task 10 does: the polls stop and a notice asks the person to sign in.
  - **Source links** (today's line 546): `Slip.svelte` is replaced by `Filing.svelte`, `FilingList.svelte`, `Track.svelte` and `ConfirmCompanies.svelte`, and the logic modules `tracks.ts`, `sources.ts`, `filings.ts` and `confirm.ts` are added.
  - **Research:** "Open the PDF at page N" adds the XBRL button.
- `docs/systems/maester.md`, in STE: the `slip` term (today's line 29) and the three steps that name the slip (today's lines 106, 112 and 115) read "the opened filing", with the poll split of Decision 12.

- [ ] **Step 1: Edit the three files.** Check every component name, route and copy string against the code built in Tasks 1–11.
- [ ] **Step 2: Check.** `grep -n -i "slip\|Earlier list\|Stage ladder\|StageLadder\|EarlierList" docs/DESIGN.md docs/systems/web.md docs/systems/maester.md`. Expected: no output. `grep -n "comes whole from the newest filing" docs/DESIGN.md`. Expected: no output (§5 Statement table and §10 Research both carry the new rule). Then `cd apps/web && pnpm vitest run src/lib/styles`. Expected: PASS. Then the workspace and local-docs check that CI runs: `uv run --locked python scripts/check_workspace.py`. Expected: `Workspace OK`.
- [ ] **Step 3: Commit**

```bash
git add docs/DESIGN.md docs/systems/web.md docs/systems/maester.md
git commit -m "docs(design): Documents by filing: drop strip for PDF and XBRL, filing list, filing, track, companies to confirm; the XBRL figure panel; slip, ladder and Earlier removed"
```

---

### Task 13: Checks: accessibility, sizes, states, and the browser on the investor's stack

This task runs from the main checkout `/Users/himanshu/Personal/maester-chatbot`, with the PR branch checked out, only once the investor says go. It never runs `docker compose up` from a worktree. Uploading XBRL files is free. **Uploading a PDF means one Gemini classification (paid): ask first, or upload none.** Confirming a company writes a real company to the investor's workspace, so ask which one.

**Files:** none changed, unless a check fails. A fix goes back to the task that owns it, with its own test.

**Interfaces:**
- Consumes these:
  - the investor's stack (API on 8787, Postgres on 5433), rebuilt for Task 1: `docker compose build api worker && docker compose up -d api worker`, from the main checkout, with the go-ahead;
  - phase 4 Task 21's imported folder, so the held companies and the XBRL filings exist;
  - Vite from the main checkout on its own port: `API_PROXY_TARGET=http://localhost:8787 pnpm --dir apps/web dev --port 5175 --strictPort`. The session cookie for `localhost` works across ports: sign in on 5175 if asked.

- [ ] **Step 1: Gates.** `cd apps/web && pnpm verify` and `pnpm --filter @maester/api exec vitest run`. Expected: PASS for both.
- [ ] **Step 2: Populated, at four widths and at 200% zoom.** Open `http://localhost:5175/terminal/documents` and check it at 360, 768, 1280 and 1440px (`resize_window`), and at 1280px with 200% zoom. At each, `document.documentElement.scrollWidth <= window.innerWidth` is true. Then check these:
  - **One `h1`, and headings in order:** `h2` Not in your workspace yet, the filing, Working on, Done; `h3` per company and per basis; `h4` per file in Read as.
  - **The filing list:** no ink block, "Needs you" and "Stopped" bold. At 360px a row stacks title, files, then tracks (C3).
  - **The opened filing:** first below 1024px, left of Working on from 1024px. Its working track is an ink block. Its ledgers stack below a 36rem container and remain a table to the accessibility tree (`read_page` shows `table`, `row`, `columnheader`, `cell`).
  - **One filled button on the screen:** the first Add; with no rows, the first "Say which company"; with neither, the open filing's own question. Open two "Say which company" forms (or "It’s one of mine" on a row): still one filled button.
  - **File links:** in the opened filing, a stored file is a link that opens in a new tab; a refused file's name (the `broken.xml` of Step 4, if verify refused it) is plain text.
  - **Targets:** every target is at least 44px tall.
- [ ] **Step 3: Keyboard and screen reader.** Tab from the skip link through the page:
  - the drop strip's two buttons, the confirm rows, the opened filing's controls, then the filing titles, in DOM order;
  - opening a filing moves focus to its `h2`;
  - with focus on a control inside the opened filing, wait through a poll and a filings read (a filing indexing): focus stays on that control (a re-pin never remounts the filing);
  - "Show all" toggles `aria-expanded`;
  - a Change that saves returns focus to its Change;
  - confirming one company (the investor's pick) moves focus to its Working on `h3`. The polite status line says "{name} added. Its {n} files carry on." once, and its files leave "Not in your workspace yet".
  - The status region says nothing while tracks move (watch it for a minute with a filing indexing).
  - Ask first, because the document stays in the workspace. Upload one XBRL instance (free) of a company not in the workspace and not among phase 4 Task 21's imported files, which would make it a duplicate rather than held. Send it alone, and keep focus on its filing. Once it is identified and held, the filing column says "{name} waits for you above." with "Go to it", focus moves to its row under "Not in your workspace yet", and no unrelated filing opens in its place.
- [ ] **Step 4: The states (UI specification §14).** Check each:
  - **Loading:** throttle to Slow 3G and reload. The hatch boxes of a filing and two company groups and "Loading your documents." appear, the drop strip is disabled, and nothing moves on arrival: at 1280px the desk keeps its two columns from the hatch to the data.
  - **Failed:** block `*/filings` in the network panel and reload. The section issue "Your documents didn’t load." shows; unblock it, and "Try again" recovers.
  - **Empty:** no live workspace is empty. `buildView`'s `empty` test covers it; say so in the PR.
  - **Stopped:** ask first, because no document can be deleted and the file stays in the workspace. Upload `broken.xml`: the first 2,000 bytes of a real instance from the folder, so the root is there and the rest is cut off (free). The browser takes it. One of two things then happens; record which:
    - Verify passes it and `document.classify` fails `XBRL_UNREADABLE` without a retry. Once its text settles, it shows in Done, under "Company not known yet", with "Stopped" in bold and "Maester couldn’t work out what this is." (Review Focus 3). Opened, it shows "Try again" on that track only, and the other filings carry on.
    - Verify refuses it (`UNSUPPORTED_TYPE`). It shows in Done with "Stopped" and "Not a PDF or an XBRL file."
  - **Offline:** ask first, because the copies stay as duplicate records. Take 20 XBRL instances from the import folder (they arrive as duplicates, which is free) and go offline in DevTools after the first few send. "The upload didn’t finish. N of 20 files were sent." and "Send the rest" appear. Online again, "Send the rest" sends only the rest. The offline banner shows under the context header.
  - **Signed out:** sign out in a second tab. The next poll shows "You’re signed out." with "Sign in", and the polls stop (network panel quiet).
  - **Saved and unsaved:** open a Change form. The open filing moves on under it (another tab changes the same file), the form closes, and "These answers changed since you opened them. Here is the latest." shows. Closing the tab while "Send the rest" runs asks first. Moving to Research and back while it runs does not stop it: the files keep arriving.
  - **Partial:** a filing with an unmapped banking instance shows "Read from the PDF …" or "Not read from XBRL", with the format sentence.
  - **The XBRL figure panel cannot be reached here** (Decision 13). Say so in the PR, with Task 11's tests as its check.
- [ ] **Step 5: Load.** With the imported folder in the workspace, record the `/filings` response size and time in the network panel (expected: under 2 MB and under 1 s on this machine). Confirm only one `/filings` request every 5 s while Working on is live, and at most three `GET …/documents/:id` every 2 s. Record the numbers in the PR.
- [ ] **Step 6: Reduced motion.** Turn on `prefers-reduced-motion`. The ruler and the hatch hold still.
- [ ] **Step 7: Stop the dev server.** Stop the pnpm wrapper and its Vite child, then `ps -axo pid,command | grep -i "vite\|5175" | grep -v grep`. Expected: no output.
- [ ] **Step 8: Record** the widths, states and numbers in the PR description. Commit nothing unless a fix was needed.

---

## Task order

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13, one at a time.

- Task 1 (API) needs phase 4 on `staging`.
- Task 2 needs Task 1's contract.
- Task 3 needs Task 2.
- Task 4 needs Task 3 (`formatWords`, `pdfNeeded`, `warningWords`).
- Task 5 needs Task 3 (`abandonedUpload`, the tracks).
- Tasks 3, 4, 5, 6 and 7 all edit `apps/web/src/lib/content/documents.ts`, so they run in sequence, never in parallel, even where their code does not depend on each other (6 and 7 need only Task 2).
- Task 8 needs Tasks 3, 5 and 6.
- Task 9 needs Tasks 3, 4 and 5.
- Task 10 needs Tasks 7, 8 and 9.
- Task 11 needs Tasks 2 and 4 (`notCheckedWords`, `pagesWords`). It shares no file with Tasks 5–10, so it may run any time after Task 4.
- Task 12 needs everything it describes.
- Task 13 comes last.

## Open questions for the investor

1. **Q4 results XBRL for the annual columns** (spec §11; yours). This plan does not decide it. Until it is decided, no results XBRL figure reaches a Research table, so the XBRL figure panel is built but cannot be seen on real data.
2. **"1 not found: see the figure."** With nowhere in Research to land, the opened filing says "1 not found." and opens the results PDF where the statement pages start. Once results figures reach Research (question 1, or the data layer's quarter view), the link and a `fact` selection on the company page can follow.
3. **Working on during a long text backfill.** Text indexes one file at a time, so hundreds of filings can sit in Working on for days. The spec collapses only Done. Keep it, or collapse Working on per company too?
4. **Names printed in capitals.** XBRL prints "SYNTHETIC CEMENTS LIMITED". "Add …" adds the name as printed, never re-cased.
5. **"Read it again"** reads the numbers only (Decision 2). Should it also index the text again?
6. **A stopped filing in Done** (Decision 20). Phase 4 counts a failed track as settled, so a stopped filing goes to Done, where each company shows its newest three. This plan keeps the spec's three and names the count in the button ("Show all 9 filings of Synthetic Cements · 1 stopped"). Should a stopped filing always show in Done, beside the newest three, so "Try again" is in sight?

## After this plan

- The data layer's phase 4 (the quarter view), or a yes to question 1, puts XBRL cells into Research. The browser check of the XBRL figure panel and the "see the figure" link then follow. They need Task 11's `xbrlFrom`, `xbrlUnit`, `inPdfWords`, `xbrlOpen` and `restatedWords`, and a `fact` query on the company page.
- **Contract gaps for that work** (phase 4's `CellSource` and `Restated`, not investor questions):
  - the XBRL `CellSource` needs the unit the instance declares (`declaredUnit: TableUnit`, from the fact's own `unitLabel`, `scaleFactor` and `currency`, which stitch's `cellOf` already holds), so `xbrlUnit` can say "as the filing declares" or "converted from ₹ lakh" (Decision 13);
  - `Restated` needs the other filing's kind, so `restatedWords` can name a results filing rather than "Annual report …".
- Phase 5 (measure the numbers) needs nothing from this plan.
- Every later Documents change starts from `lib/documents/{tracks,sources,filings,confirm}.ts` and `DESIGN.md` §5's Filing list, Filing, Track and Companies to confirm entries.
