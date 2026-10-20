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

Each module is tested in node Vitest. Four new components render them: `Track`, `FilingList`, `Filing` and `ConfirmCompanies`. They replace `Slip`, `StageLadder` and `EarlierList`, and `DocumentsPage` is rewritten around them. The open filing polls its own documents every 2 s. The filings read is polled every 5 s while anything is unsettled. The API gains one route, `POST …/documents/:id/index`, and two fields on `FilingFile`.

**Tech Stack:** SvelteKit 2 with Svelte 5 runes, TypeScript, Vitest 4 (node project), `svelte-check --fail-on-warnings`, ESLint and Prettier, the design guard; Hono, Zod and Drizzle for the one API task.

**Spec:** [`docs/superpowers/specs/2026-10-19-documents-filings-design.md`](../specs/2026-10-19-documents-filings-design.md), all of it (§2–§7 and §10 build the screen, §8 the panel, §12 the `DESIGN.md` text). [`docs/superpowers/specs/2026-10-19-ingestion-pipeline-design.md`](../specs/2026-10-19-ingestion-pipeline-design.md) §11 and §12. [`docs/DESIGN.md`](../../DESIGN.md) §2–§8 and §10. [`docs/UI_SPECIFICATION.md`](../../UI_SPECIFICATION.md) §2, §12, §13 and §14. The names consumed come from the [phase 4 plan](2026-10-20-ingestion-phase-4-xbrl.md) Tasks 14, 16, 17 and 19, as listed in `.superpowers/plans-1-6/phase-4-interfaces.md`. The canvas is "Maester Ingestion Screens", boards C1–C4 and S1. The kit is on `design/ingestion-screens-canvas`: `.claude/skills/design-directions/assets/kit/ingestion.mjs`. The design round is done; this plan draws nothing new.

## Decisions the spec leaves open, and why

1. **The tracks are per filing; `pipeline` is per file.** A filing row has one Numbers line and one Text line. Task 3 fixes the rule that turns a filing's files into those lines. It takes the words of spec §4's table first, then board S1, then words this plan decides. Each case has a test.
2. **"Read it again" never sends a covered PDF to Gemini.** Spec §5 says it "reads every file of the filing again". `POST …/documents/:id/extract` on a PDF always creates a paid `document.extract`, even when XBRL covers that PDF (`numbers.state` `not_needed`). So:
   - an XBRL file is read again through `extract` (phase 4 makes that a free `document.xbrl`);
   - a PDF whose `numbers.source` is `pdf` is read again (one paid Gemini read, as today's slip does);
   - a `not_needed` or kept PDF is not read again.

   It reads the numbers only. Text is indexed again only through the Text track's "Try again".
3. **The Text track's "Try again" needs a route.** `pipeline.text` carries no job id. Task 1 adds `POST …/documents/:id/index`, which queues the document's `document.index` job again.
4. **`FilingFile` lacks the document state.** Without `state` and `rejectionCode`, the page cannot tell a refused file from one still being checked. It also cannot tell an abandoned upload from a live one. A finally failed `document.verify` also reads `stored: "now"` for ever. Task 1 adds both fields and maps that failure to `stored: "failed"`.
5. **Where `unsorted` files go.** These are files with no company, the ones `buildFilings` puts in `unsorted`:
   - one still `needs_company` (no identity printed) is a Notice under "Not in your workspace yet" (spec §7);
   - every other one is its own filing, titled by its file name, under the group "Company not known yet". That group goes in Working on, or in Done when nothing more can happen to the file: rejected, an upload this page is not sending that never finished, or kept.
6. **"Read as" is per file.** Each file has its own classification, and "Change" moves one document. So Read as lists each file under its own `h4` ("PDF · name"). It keeps today's terms, evidence lines and Change forms (`KindForm`, `CompanyForm`, unchanged).
7. **A held identity that matches a company already added** opens with "Which of your companies is this?" and the picker, matches first and chosen. "Use this company" is that row's action, and "Add …" is outline. This holds for one file or many. Every row confirms through `POST …/companies/confirm`, never through the classification POST.
8. **The opened filing shows both tracks.** Spec §5 lists the per-basis ledgers and the Text entry, and says the working track is an ink block. So the opened filing has a Numbers entry above the ledgers and a Text entry below them. Each is a `Track`, ink while `now`, with "Try again" when it stopped.
9. **"1 not found: see the figure" has no destination yet.** Phase 4 keeps results XBRL out of Research tables (its Departure 6), so a results figure has no cell to link to, and `DESIGN.md` §7 forbids a link to nowhere. The ledger says "Found: 51 of 52" (bold), then "1 not found.", then a link "Open the results PDF at page 4", where the statement pages start. The Research link waits for the open question in spec §11.
10. **Announcements.** These are said:
    - a batch: once at the start, and once at the end;
    - a new question: once;
    - the result of the investor's own action: once.

    Track changes are never said. New questions are held back during a batch, and while any file is still being checked or identified (`identifying(read)`). A folder of 806 files keeps being identified for minutes after it is sent, and each 5 s read would otherwise say a new count. So the end of a batch says "806 files sent." alone. Once identification settles, one line says the questions that arrived: "31 companies need you." When one arrives on its own, it is said by name. This splits spec §6's single line "806 files sent. 31 companies need you." in two, because the count is not known when sending ends.
11. **"Send the rest"** (spec §10) sends again the files the batch never tried, plus those that failed offline. The page keeps them as `Picked[]` while it is open. A file that had in fact arrived comes back as a duplicate (hash), which the spec allows.
12. **Polling.** The two polls are these:
    - The open filing reads its own documents (`GET …/documents/:id`, at most 3) every 2 s while any track is live. Its sources table lags until the next filings read.
    - The filings read is repeated every 5 s while any other filing in Working on is live. It is read once more when the open filing's work stops.

    Neither runs while the tab is hidden or the investor is signed out. The page never polls one request per file of the list.
13. **The XBRL figure panel cannot be reached with real data in this phase**, again because phase 4 keeps results XBRL out of Research. Task 11 builds its words from spec §8 against the `CellSource` `xbrl` variant and tests them with hand-built cells. The browser check (Task 13) cannot reach that branch, and says so. Two notes on the data:
    - "Rounded to the lakh" comes from the cell's own `decimals`, because `CellSource` does not carry the coarsest `decimals`.
    - A column counts as an XBRL column when its cells' sources are `xbrl`. If phase 4 adds `FinancialColumn.source`, use it instead.
14. **Words the spec does not give** are decided here. They cover the not-checked reasons `no_value` and `not_yet`, a partial text index, and the waiting, stopped and kept tracks. Each is in the task that owns it, in `lib/content/`.
15. **A file opens as a link.** Spec §5 calls it "an underlined button that opens the stored file". Opening a URL in a new tab is a link's job, so it is an `<a>` to `…/documents/:id/file`, underlined as every link is.
16. **The standing note** "Leaving this page doesn’t stop anything…" goes. Spec §2's order has no place for it. The sending note ("Files are still being sent…") stays under the drop strip while a batch sends.

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
- **Words.** Spec §4–§8 are the words, verbatim. Board S1 fills states the spec does not word; where S1 and the spec differ, the spec wins. Sentence case, curly apostrophes (’). All copy lives in `apps/web/src/lib/content/documents.ts` and `research.ts`.
- **Look.** These rules hold:
  - Nothing in the filing list is an ink block. "Needs you" and "Stopped" are bold there.
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

1. **"Read it again" on a filing whose PDF the XBRL covers.** No `extract` call goes to that PDF; only the XBRL files are read again (a paid Gemini call avoided). Task 4.
2. **A file that changes filing while it is open.** This happens when it is identified, when its company is confirmed, or when its kind is changed. The open filing follows the document, and focus stays inside it. Tasks 5 and 10.
3. **A refused file, or an upload that never finished, after a reload.** Neither sits in Working on for ever. Each sits in Done, under "Company not known yet", with "Stopped" and why. Tasks 1 and 5.
4. **The connection drops 214 files into an 806-file batch.** "Send the rest" sends exactly the untried files and those that failed offline, in the order chosen, and none that went. Task 7.
5. **A filings read that lands after the open filing's own poll.** It never puts a file back to an older state. Task 5.

---

### Task 1: What the screen needs from the API beyond phase 4

**Files:**
- Modify: `packages/contracts/src/filings.ts` (`FilingFile`), `packages/contracts/src/document.ts` (`IndexResponse`), `packages/contracts/src/index.ts`
- Modify: `packages/db/src/queries/filings.ts` (`listFilingRows`), `apps/api/src/documents/filings.ts` (`buildFilings`), `apps/api/src/documents/pipeline.ts` (`computePipeline`), `apps/api/src/routes/documents.ts`
- Modify: `docs/systems/api.md` (STE)
- Test: `apps/api/test/filings-build.test.ts`, `apps/api/test/pipeline.test.ts`; Create: `apps/api/test/documents-index.test.ts`

**Interfaces:**
- Consumes these:
  - phase 4's `FilingFile`, `buildFilings(input: FilingsInput)`, `computePipeline(input: PipelineInput, plan)` and `listFilingRows`;
  - `createJob` and `retryJob(db, dispatcher, workspaceId, jobId)` from `apps/api/src/jobs/create.ts`;
  - `indexPipelineVersion(model)` from `@maester/document-index`;
  - `JobTypes.DOCUMENT_INDEX` and `DOCUMENT_INDEX_SUBJECT` from `@maester/contracts`;
  - the API env's `EMBEDDING_MODEL`.
- Produces:
  - `FilingFile` gains `state: DocumentState` and `rejectionCode: RejectionCode.nullable()`. `listFilingRows` selects both, and `buildFilings` copies them.
  - `computePipeline` gives `stored: "failed"` when the document is `uploaded` or `verifying` and its latest job of subject type `document` is `document.verify` in state `failed`. Every other branch is unchanged.
  - `IndexResponse = z.object({ job: Job })`.
  - `POST /v1/workspaces/:ws/documents/:id/index` (session and membership as the other document routes) answers 202 `IndexResponse`. It works as follows:
    - A document that is not `stored`, or is a duplicate, gives 409 `INVALID_STATE`.
    - Otherwise it calls `createJob` (type `document.index`, subject type `document_index`, pipeline version `indexPipelineVersion(env.EMBEDDING_MODEL)`), which returns the existing job for that key.
    - A `failed` job goes through `retryJob`.
    - A `succeeded` job gives 409 `INVALID_STATE` ("the index is built").
    - A `queued` or `running` job is answered as it is.

- [ ] **Step 1: Write the failing tests**

```ts
// filings-build.test.ts
it("an unsorted file carries its document state and rejection code", () => {
  // a rejected document, rejection_code UNSUPPORTED_TYPE, no classification
  expect(built.unsorted[0]).toMatchObject({ state: "rejected", rejectionCode: "UNSUPPORTED_TYPE" });
});
// pipeline.test.ts
it("a document whose verify job failed for good is stored failed, not now", () => {
  expect(computePipeline(inputWith({ docState: "verifying", latestDocumentJob: { type: "document.verify", state: "failed" } }), null).stored).toBe("failed");
});
// documents-index.test.ts (database; fake dispatcher)
it("a failed index job is queued again with its attempts given back", async () => {
  expect(res.status).toBe(202); expect(job.state).toBe("queued"); expect(job.maxAttempts).toBe(job.attempt + 5);
});
it("with no index job, one is created under 1:<EMBEDDING_MODEL>", async () => {
  expect(job.idempotencyKey).toBe(`document.index:${docId}:1:Snowflake/snowflake-arctic-embed-l-v2.0`);
});
it("a running index job is answered as it is, and no second job exists", async () => {});
it("a succeeded index job gives 409 INVALID_STATE", async () => {});
it("a duplicate gives 409 INVALID_STATE and no job", async () => {});
it("another workspace's document is 404; signed out is 401", async () => {});
```

- [ ] **Step 2: Run to see them fail.** `pnpm --filter @maester/api exec vitest run test/filings-build.test.ts test/pipeline.test.ts test/documents-index.test.ts`. Expected: FAIL (no `state` on `FilingFile`, `stored` is `now`, 404 on the route).
- [ ] **Step 3: Implement.** Then add the route and the two fields to `docs/systems/api.md`, in STE.
- [ ] **Step 4: Run the API and contracts suites.** `pnpm --filter @maester/api exec vitest run && pnpm --filter @maester/contracts exec vitest run`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/contracts packages/db apps/api docs/systems/api.md
git commit -m "feat(api): FilingFile carries its document state; a failed verify reads stored failed; POST …/documents/:id/index queues the text index again"
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
  - `DocumentPipeline`: exactly phase 4's shape (`stored`, `identified`, `numbers { source, state, coveredByXbrl, waitingOn, reason, format }`, `text { state, pages, pagesRead, pagesOcr, chunks, xbrlBlocks, ahead }`).
  - `StatementSourceReason`, `InPdfCount`, `StatementSource`, `BasisSources`.
  - `FilingFile`, with Task 1's `state` and `rejectionCode`.
  - `WorkspaceFiling`, `HeldIdentity`, `WorkspaceFilings`, `ConfirmCompanyRequest`, `ConfirmCompanyResponse`.
  - `DocumentRecord` gains `format: DocumentFormat` and `pipeline: DocumentPipeline`; `Company` and `Classification` gain `isin: string | null`.
- Produces (`client.ts`, inside `documentsApi`):
  - `listFilings(): Promise<WorkspaceFilings>` (`GET …/filings`);
  - `confirmCompany(request: ConfirmCompanyRequest): Promise<ConfirmCompanyResponse>` (`POST …/companies/confirm`);
  - `index(id: string): Promise<{ job: Job }>` (`POST …/documents/:id/index`);
  - `fileHref(id: string): string`, which returns `…/documents/<id>/file` for a plain link to the stored file.

  `listDocuments` and `DOCUMENT_PAGE` stay until Task 10 removes their last caller.
- Produces (`intake.ts`): `PrintedIdentifier.label` gains `'ISIN'`, and `identifiers()` lists the ISIN after NSE.
- Produces (`testing.ts`): `pipe(over?: DeepPartial<DocumentPipeline>): DocumentPipeline`, `fileOf(over?: Partial<FilingFile> & { pipeline?: DeepPartial<DocumentPipeline> }): FilingFile`, `filingOf(over?: Partial<WorkspaceFiling>): WorkspaceFiling`, `companyOf(over?)`, `heldOf(over?)`.
  - The defaults are a stored PDF, everything `done`, `format 'pdf'`, `basis 'consolidated'`, `createdAt '2026-10-19T08:32:00Z'`, and ids `doc-1`, `doc-2` and so on in order.
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
- Consumes: `FilingFile`, `BasisSources` (Task 2).
- Produces:
  - `TrackState = 'now' | 'next' | 'done' | 'needs-you' | 'stopped' | 'not-read'`.
  - `TrackWords = { state: TrackState; first: string; second: string | null }`. Bold when `needs-you` or `stopped`; ink (opened filing only) when `now`.
  - `TrackContext = { uploading: (documentId: string) => boolean; nameOf: (documentId: string) => string | null }`.
  - `numbersTrack(files: FilingFile[], sources: BasisSources[], ctx: TrackContext): TrackWords`;
  - `textTrack(files: FilingFile[], ctx: TrackContext): TrackWords`;
  - `formatWords(kind: XbrlFormatKind): string`: `banking` gives "the banking format", `nbfc` "the NBFC format", `other_than_ind_as` "the “other than Ind AS” format", `ind_as` "the Ind AS format" and `unknown` "a format Maester doesn’t know yet".

**The Numbers rule.** Let X be the filing's XBRL files and P its PDFs (duplicates are never in `files`). The first row that matches wins:

| # | When | state | first | second |
| --- | --- | --- | --- | --- |
| 1 | a file `pending_upload` that this page is sending | now | Sending | — |
| 2 | a file `pending_upload` that this page is not sending | stopped | Stopped | The upload didn’t finish. Add it again. |
| 3 | `stored` `failed` | stopped | Stopped | `state` `rejected`, by `rejectionCode`: `UNSUPPORTED_TYPE` "Not a PDF or an XBRL file.", `TOO_LARGE` "Larger than 50 MB.", `OBJECT_MISSING` or null "The upload didn’t arrive."; otherwise (a failed verify, Task 1) "Maester couldn’t check this file." |
| 4 | `stored` `now` | now | Checking the file | — |
| 5 | `identified` `failed` | stopped | Stopped | Maester couldn’t work out what this is. |
| 6 | `identified` `now` | now | Working out what it is | — |
| 7 | `identified` `needs_you` | needs-you | Needs you | `needs_kind`: "Say what it is."; otherwise "Confirm the company." |
| 8 | a PDF with numbers `failed` | stopped | Stopped | Maester couldn’t read the numbers. |
| 9 | X not empty, every X `failed`, P empty | stopped | Stopped | Maester couldn’t read the XBRL file. |
| 10 | an X `now` | now | From XBRL · reading now | a P `waiting` `waiting_for_xbrl`: "The PDF waits for it, so Gemini reads only what XBRL doesn’t cover."; else — |
| 11 | a P `waiting` `waiting_for_xbrl` with `waitingOn` not empty | next | Waiting for XBRL | one id: "{name} is being read. Gemini reads only what it doesn’t cover." (name from `ctx.nameOf`, else "An XBRL file"); n ids: "{n} XBRL files are being read. Gemini reads only what they don’t cover." |
| 12 | a P `now` | now | Read from the PDF · now | `pdfReason` |
| 13 | an X `waiting` | next | From XBRL · next | — |
| 14 | a P `waiting` | next | Read from the PDF · next | `pdfReason` |
| 15 | an X `done` and a P `done` with `source` `pdf` | done | From XBRL and the PDF · done | `splitWords` |
| 16 | an X `done` | done | From XBRL · done | `checkLine` |
| 17 | a P `done` | done | Read from the PDF · done | `pdfReason` |
| 18 | X not empty, every X `not_read` `format_unmapped`, P empty | not-read | Not read from XBRL | The XBRL is in {formatWords}, not mapped yet. |
| 19 | every file `not_read` `not_a_read_kind` | not-read | Not read | Maester reads annual reports and financial results for now. |
| 20 | otherwise | next | — | — |

The three helpers:
- `pdfReason`:
  - X is empty: "No XBRL for this filing.";
  - an X is `not_read` `format_unmapped`: "The XBRL is in {formatWords(format)}, not mapped yet.";
  - an X `failed`: "The XBRL file couldn’t be read.";
  - an X `done`: `splitWords`.
- `splitWords` keeps the bases apart (spec §3). Statements are listed in the order profit and loss, balance sheet, cash flow, lower case after the first word. Bases are in the order consolidated, standalone, not stated.
  - Every basis has the same split: "XBRL: profit and loss, balance sheet. PDF: cash flow."
  - Every basis has one source: "Consolidated from XBRL; standalone from the PDF."
  - Otherwise, one part per basis joined by "; ": "Consolidated: XBRL for profit and loss, balance sheet, the PDF for cash flow; standalone from the PDF."
- `checkLine` counts each basis apart, over the `inPdf` of its `xbrl` statements. The bases never share a count (spec §3).
  - One basis with checks, nothing missed: "{found} of {checked} figures found in the PDF."
  - One basis with checks, n missed: "{n} figure(s) not found in the PDF."
  - Two bases with checks: "In the PDF: consolidated {found} of {checked} found, standalone {found} of {checked} found." A basis with none checked reads "consolidated not checked".
  - None checked on any basis: by the first `notChecked`: `no_pdf` "No PDF of these results in your documents.", `scanned` "The PDF’s statement pages are scanned, so the check didn’t run.", `no_statement_pages` "Maester didn’t find the statement pages in the PDF.", `disabled` "The check against the PDF is turned off.", `not_yet` "Checking against the PDF.", `no_value` and null —.

**The Text rule.** It looks at files that are `stored`:

| # | When | state | first | second |
| --- | --- | --- | --- | --- |
| 1 | a PDF `now` | now | Page {pagesRead} of {pages} (pages 0: "Reading the pages") | "{ocr} pages by OCR · {chunks} passages so far" (OCR part left out at 0; singular "1 page", "1 passage") |
| 2 | an XBRL `now` | now | Reading the XBRL notes | — |
| 3 | any `waiting` | next | the smallest `ahead`: null "In line", 0 "Next in line", n "In line, {n} ahead" | waiting files joined by " · ": PDF "PDF: {pages} pages" (pages 0: "PDF"), XBRL "XBRL: its notes" |
| 4 | any `failed` | stopped | Stopped | The text wasn’t indexed. Your numbers aren’t affected. |
| 5 | every file `done` or `partial` | done | "Done", or "Done, some pages without text" when any is `partial` | "{pages} pages, {ocr} by OCR · {chunks} passages · {blocks} XBRL notes". Pages, OCR and passages are summed over PDFs; notes are summed over XBRL `xbrlBlocks`; each part is left out at 0 |
| 6 | no stored file | next | — | — |

- [ ] **Step 1: Write the failing tests** (one per row; these are the load-bearing ones):

```ts
const ctx = { uploading: () => false, nameOf: (id: string) => (id === 'x-q2' ? '500999_Q2_FY27_Consolidated.xml' : null) };
it('XBRL reading and the PDF waiting for it (spec §4 row 1)', () => {
  const x = fileOf({ documentId: 'x-q2', format: 'xbrl', pipeline: { numbers: { source: 'xbrl', state: 'now' } } });
  const p = fileOf({ pipeline: { numbers: { source: null, state: 'waiting', reason: 'waiting_for_xbrl', waitingOn: ['x-q2'] } } });
  expect(numbersTrack([x, p], [], ctx)).toEqual({ state: 'now', first: 'From XBRL · reading now', second: 'The PDF waits for it, so Gemini reads only what XBRL doesn’t cover.' });
});
it('a PDF alone, read now (row 2)', () => { expect(numbersTrack([pdfNow], [], ctx)).toEqual({ state: 'now', first: 'Read from the PDF · now', second: 'No XBRL for this filing.' }); });
it('an unmapped banking XBRL and the PDF next (row 3)', () => {
  expect(numbersTrack([bankingUnmapped, pdfWaitingIdentified], [], ctx).second).toBe('The XBRL is in the banking format, not mapped yet.');
  expect(numbersTrack([bankingUnmapped, pdfWaitingIdentified], [], ctx).first).toBe('Read from the PDF · next');
});
it('XBRL done, the PDF not needed, 214 of 214 found in its one basis (row 4)', () => {
  expect(numbersTrack([xDone, pdfNotNeeded], sources214of214, ctx)).toEqual({ state: 'done', first: 'From XBRL · done', second: '214 of 214 figures found in the PDF.' });
});
it('one figure missed', () => { expect(numbersTrack([xDone, pdfNotNeeded], sources213of214, ctx).second).toBe('1 figure not found in the PDF.'); });
it('XBRL and the PDF split the statements, the same in both bases', () => {
  expect(numbersTrack([xDone, pdfDone], plBsXbrlCfPdf, ctx).second).toBe('XBRL: profit and loss, balance sheet. PDF: cash flow.');
});
it('consolidated XBRL only: the split follows the bases', () => {
  expect(numbersTrack([xConsolidatedDone, pdfDone], consolidatedXbrlStandalonePdf, ctx).second).toBe('Consolidated from XBRL; standalone from the PDF.');
});
it('two bases checked: counted apart, never summed', () => {
  expect(numbersTrack([xC, xS, pdfNotNeeded], checked107and106of107, ctx).second).toBe('In the PDF: consolidated 107 of 107 found, standalone 106 of 107 found.');
});
it('waiting on an XBRL file elsewhere, named', () => {
  expect(numbersTrack([pdfWaitingOn(['x-q2'])], [], ctx).second).toBe('500999_Q2_FY27_Consolidated.xml is being read. Gemini reads only what it doesn’t cover.');
});
it('the XBRL failed and Gemini reads the PDF', () => { expect(numbersTrack([xFailed, pdfNow], [], ctx).second).toBe('The XBRL file couldn’t be read.'); });
it('an abandoned upload is stopped; one being sent is "Sending"', () => {});
it('a refused file says why', () => { expect(numbersTrack([rejected('UNSUPPORTED_TYPE')], [], ctx)).toEqual({ state: 'stopped', first: 'Stopped', second: 'Not a PDF or an XBRL file.' }); });
it('a kept document is not read', () => {});
it('needs you: what is it?', () => { expect(numbersTrack([needsKind], [], ctx)).toEqual({ state: 'needs-you', first: 'Needs you', second: 'Say what it is.' }); });
it('text: page 140 of 286 (spec §4)', () => {
  expect(textTrack([pdfText({ state: 'now', pages: 286, pagesRead: 140, pagesOcr: 38, chunks: 412 })], ctx)).toEqual({ state: 'now', first: 'Page 140 of 286', second: '38 pages by OCR · 412 passages so far' });
});
it('text: in line, 2 ahead', () => {
  expect(textTrack([pdfText({ state: 'waiting', ahead: 2 }), xbrlText({ state: 'waiting', ahead: 5 })], ctx)).toEqual({ state: 'next', first: 'In line, 2 ahead', second: 'PDF · XBRL: its notes' });
});
it('text: done, the XBRL counted as notes', () => {
  expect(textTrack([pdfText({ state: 'done', pages: 22, pagesOcr: 4, chunks: 61 }), xbrlText({ state: 'done', chunks: 30, xbrlBlocks: 12 })], ctx).second).toBe('22 pages, 4 by OCR · 61 passages · 12 XBRL notes');
});
it('text: partial and failed', () => {});
```

- [ ] **Step 2: Run to see them fail.** `cd apps/web && pnpm vitest run src/lib/documents/tracks.test.ts`. Expected: FAIL ("Cannot find module './tracks'").
- [ ] **Step 3: Implement** `tracks.ts`, and the copy under `documentsContent.tracks`, as functions where a count goes in.
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/documents/tracks.ts apps/web/src/lib/documents/tracks.test.ts apps/web/src/lib/content/documents.ts
git commit -m "feat(web): a filing's Numbers and Text tracks in words, from its files' pipelines"
```

---

### Task 4: Statement sources, and which files a button acts on

**Files:**
- Create: `apps/web/src/lib/documents/sources.ts`
- Modify: `apps/web/src/lib/content/documents.ts` (group `sources`)
- Test: Create `apps/web/src/lib/documents/sources.test.ts`

**Interfaces:**
- Consumes: `BasisSources`, `StatementSource`, `InPdfCount`, `FilingFile`, `WorkspaceFiling`, `StatementFound` (Task 2).
- Produces:
  - `SourceRow = { statement: StatementKind; label: string; from: { text: string; note: string | null }; inPdf: { text: string; strong: boolean; missed: string | null; open: { documentId: string; pageIndex: number; label: string } | null } }`.
  - `sourceRows(basis: BasisSources, filing: WorkspaceFiling, pdfStatements: StatementFound[] | null): SourceRow[]`. Rows come in the order profit and loss, balance sheet, cash flow. `pdfStatements` is the filing's PDF classification's `statementsFound`, once loaded.
  - `basisTitle(basis: ReportingBasis): string`: "Consolidated", "Standalone", "Basis not stated".
  - `readAgainIds(files: FilingFile[]): string[]`: XBRL files whose numbers are `done` or `failed`, and PDFs whose `numbers.source` is `pdf` and whose state is `done` or `failed`, in file order. Never a PDF that is `not_needed` or `not_read`.
  - `retryIds(files, track: 'identify' | 'numbers' | 'text'): string[]`: `identify` gives the files with `identified` `failed` (to `classify`); `numbers` the files with numbers `failed` (to `extract`); `text` the files with text `failed` (to `index`).
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
  | `not_read_yet` | — | "Not read yet." |
  | `read_failed` | — | "The read stopped." |
  | null with `not_in_filing` | Not in this filing | — |

  The words of **In the PDF**:
  - `inPdf` null: "—".
  - `checked` > 0: "Found: {found} of {checked}". `strong` is true when `notFound` is not empty. Then `missed` is "{n} not found." and `open` is "Open the results PDF at page {first}". `{first}` is the first page of `pdfStatements` for that statement and basis, and `open` is null without it.
  - None checked: `notCheckedWords(notChecked)`, or "—" when null.

- [ ] **Step 1: Write the failing tests**

```ts
it('the C2 ledger, consolidated', () => {
  const rows = sourceRows(q2Consolidated, q2Filing, [{ statement: 'balance_sheet', basis: 'consolidated', pages: [3, 4, 5] }]);
  expect(rows.map((r) => [r.label, r.from.text, r.from.note, r.inPdf.text])).toEqual([
    ['Profit and loss', 'XBRL · quarter and half year', null, 'Found: 38 of 38'],
    ['Balance sheet', 'XBRL · at 30 Sep 2026', null, 'Found: 51 of 52'],
    ['Cash flow', 'PDF, read by Gemini · pages 7–8', 'The quarter’s XBRL has no cash flow', '—'],
  ]);
  expect(rows[1].inPdf).toMatchObject({ strong: true, missed: '1 not found.', open: { documentId: 'pdf-q2', pageIndex: 3, label: 'Open the results PDF at page 4' } });
});
it('unmapped, no XBRL, not in the filing, not read yet, read failed', () => {});
it('a not-checked statement says why', () => { expect(row.inPdf.text).toBe('Not checked: the PDF’s statement pages are scanned, so their text can’t be searched.'); });
it('read it again: the XBRL only when it covers the PDF (no Gemini call)', () => {
  expect(readAgainIds([xDone('x1'), pdfNotNeeded('p1')])).toEqual(['x1']);
});
it('read it again: a PDF read by Gemini, and both when they split', () => {
  expect(readAgainIds([pdfDone('p1')])).toEqual(['p1']);
  expect(readAgainIds([xDone('x1'), pdfDone('p1')])).toEqual(['x1', 'p1']);
  expect(readAgainIds([kept('k1')])).toEqual([]);
});
it('try again goes to the files whose track stopped', () => { expect(retryIds([textFailed('p1'), xDone('x1')], 'text')).toEqual(['p1']); });
it('pagesWords', () => { expect([pagesWords([6]), pagesWords([6, 7]), pagesWords([3, 5, 8])]).toEqual(['page 7', 'pages 7–8', 'pages 4, 6 and 9']); });
```

- [ ] **Step 2: Run to see them fail.** `cd apps/web && pnpm vitest run src/lib/documents/sources.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/documents/sources.ts apps/web/src/lib/documents/sources.test.ts apps/web/src/lib/content/documents.ts
git commit -m "feat(web): a filing's statement sources per basis in words; read it again never sends a covered PDF to Gemini"
```

---

### Task 5: The page's view model

**Files:**
- Create: `apps/web/src/lib/documents/filings.ts`
- Modify: `apps/web/src/lib/content/documents.ts`. It adds three groups:
  - `sections` (`{ working: 'Working on', done: 'Done', confirm: 'Not in your workspace yet', unknownCompany: 'Company not known yet' }`);
  - `titles` (the title, heading, meta, file-line and count words below);
  - `questions`.
- Test: Create `apps/web/src/lib/documents/filings.test.ts`

**Interfaces:**
- Consumes: `numbersTrack`, `textTrack`, `TrackWords`, `TrackContext` (Task 3); `addedAt`, `whatItIs` and `normalizeCompanyName` (`intake.ts`); `fyLabel` (`$lib/research/view`).
- Produces:
  - `FilingView = { key: string; companyId: string | null; title: string; files: FilingFile[]; numbers: TrackWords; text: TrackWords; settled: boolean; addedAt: string; filing: WorkspaceFiling | null }`. An unsorted file is a `FilingView` with key `file:<documentId>`, `filing: null` and title its file name.
  - `CompanyGroup = { companyId: string | null; name: string; codes: string; filings: FilingView[] }`. The codes are "BSE 500999 · NSE SYNCEM", plus " · ISIN …" when set. The group with no company is named "Company not known yet", has no codes and comes last.
  - `PageView = { unnamed: FilingFile[]; working: CompanyGroup[]; done: CompanyGroup[]; workingCount: string; doneCount: string; empty: boolean }`. The counts read "4 filings · 7 files" and "12 filings" (singulars "1 filing", "1 file").
  - `buildView(read: WorkspaceFilings, ctx: TrackContext): PageView`. Company filings go by the server's `settled`. Unsorted files go by `unsortedSettled`. An unsorted `needs_company` file goes to `unnamed`. Groups keep the server's order, and unsorted files go newest first.
  - `unsortedSettled(file: FilingFile, uploading: boolean): boolean`: true for `rejected`, for a `pending_upload` not being sent, for `stored` `failed`, and for `kept`.
  - `filingTitle(f: WorkspaceFiling, files: FilingFile[]): string`:
    - `financial_results`: "Results, {shortest span} to {d Mon yyyy}". The spans order is quarter, half year, nine months, full year. "Results to 30 Sep 2026" with no span; "Results, period not stated" with no period.
    - `annual_report`: "Annual report 2025–26" for a year to 31 March (`fyLabel`), else "Annual report, year to 31 Dec 2025".
    - `other`: "{other type}, {d Mon yyyy}" from `periodEnd`, else from `addedAt` ("Investor presentation, 14 Aug 2026").
    - `not_sure`: the first file's name.
  - `filingHeading(name: string | null, title: string, kind: ClassificationKind | null): string`: "Synthetic Cements · results, quarter to 30 Sep 2026". The title's first letter is lower-cased, except for a file name. With no company, the title alone.
  - `filingMeta(view: FilingView, now?: Date, timeZone?: string): string`: "Consolidated and standalone · 3 files · added 14:02". The bases come from the files' `basis`; "added" uses `addedAt()`.
  - `fileLine(file: FilingFile): string`: "XBRL · 500999_Q2_FY27_Consolidated.xml" or "PDF · ar.pdf". It adds " · Added twice" for one duplicate and " · Added {n+1} times" for more.
  - `DONE_SHOWN = 3`; `shownFilings(group: CompanyGroup, expanded: boolean): { shown: FilingView[]; hidden: number }`. The button reads "Show all {n} filings of {name}", or "Show the newest 3" while expanded.
  - `Opened = { key: string; documentId: string }`; `pickFiling(view: PageView, opened: Opened | null): FilingView | null`. The order of choice is:
    1. the filing with `opened.key`;
    2. the filing that now holds `opened.documentId`;
    3. the Working on filing with the newest `addedAt`;
    4. the Done filing with the newest `addedAt`;
    5. null.
  - `pin(view: PageView, opened: Opened | null): Opened | null`. It pins whatever `pickFiling` finds: `{ key: found.key, documentId }`, where `documentId` is `opened.documentId` when `found` still holds it, else `found.files[0].documentId`. The page sets `opened = pin(view, opened)` after every read. So a filing that opened by itself stays open while newer filings arrive or its own work finishes, as today's slip stays pinned.
  - `identifying(read: WorkspaceFilings): boolean`: any file is still being checked or identified (`stored` or `identified` `now`), anywhere in the read.
  - `filingLive(view: FilingView, ctx: TrackContext): boolean`: true when a track is `now`, or `next` and not the "—" fallback, or the filing holds a file this page is sending.
  - `listWatched(view: PageView, openedKey: string | null, ctx): boolean`: any live Working on filing other than the opened one.
  - `applyDocument(read: WorkspaceFilings, doc: DocumentRecord): WorkspaceFilings`. It replaces the matching `FilingFile`'s `pipeline`, `intakeState`, `state` and `rejectionCode`, wherever the file sits. It returns `read` itself (the same object) when no file matches.
  - `withUpload(read, doc: DocumentRecord): WorkspaceFilings`: the document as a `FilingFile` in `unsorted`, added or replaced.
  - `keepFresher(current: WorkspaceFilings, next: WorkspaceFilings, ids: readonly string[]): WorkspaceFilings`: `next`, with the `FilingFile` copies from `current` for `ids`.
  - `questionKeys(read): Map<string, Question>`, where `Question = { kind: 'company' | 'file'; aloud: string }`. The entries are:
    - each held identity, keyed `held:<key>`: "{short name} needs you: confirm the company.";
    - each unnamed file, keyed `doc:<id>`: "{name} needs you: which company is this?";
    - each `needs_kind` file, keyed `doc:<id>`: "{name} needs you: what is it?".

    The short name is the printed name without a trailing "Limited" or "Ltd", in the case printed, or else the codes.
  - `newQuestions(seen: ReadonlySet<string>, read): { aloud: string | null; seen: Set<string> }`. No new key gives null. One new key gives its sentence. Several give "{a} companies and {b} files need you.", with each part left out at 0 and singular at 1.

- [ ] **Step 1: Write the failing tests**

```ts
it('titles', () => {
  expect(filingTitle(filingOf({ kind: 'financial_results', spans: ['half_year', 'quarter'], periodEnd: '2026-09-30' }), [])).toBe('Results, quarter to 30 Sep 2026');
  expect(filingTitle(filingOf({ kind: 'annual_report', periodEnd: '2026-03-31' }), [])).toBe('Annual report 2025–26');
  expect(filingTitle(filingOf({ kind: 'annual_report', periodEnd: '2025-12-31' }), [])).toBe('Annual report, year to 31 Dec 2025');
  expect(filingTitle(filingOf({ kind: 'other', otherType: 'investor_presentation', periodEnd: '2026-08-14' }), [])).toBe('Investor presentation, 14 Aug 2026');
  expect(filingTitle(filingOf({ kind: 'not_sure', periodEnd: null }), [fileOf({ originalName: 'scan-0042.pdf' })])).toBe('scan-0042.pdf');
});
it('heading and meta', () => {
  expect(filingHeading('Synthetic Cements', 'Results, quarter to 30 Sep 2026', 'financial_results')).toBe('Synthetic Cements · results, quarter to 30 Sep 2026');
  expect(filingMeta(q2View, new Date('2026-10-19T12:00:00Z'), 'Asia/Kolkata')).toBe('Consolidated and standalone · 3 files · added 14:02');
});
it('a duplicate is "Added twice" on the first copy', () => { expect(fileLine(fileOf({ originalName: 'ar.pdf', duplicates: ['d9'] }))).toBe('PDF · ar.pdf · Added twice'); });
it('sections: settled to Done, unsettled to Working on, no identity to the confirm notices', () => {});
it('a refused file and an abandoned upload go to Done, not Working on, after a reload', () => {
  const view = buildView(readWith({ unsorted: [rejected('r1'), abandoned('u1')] }), ctx);
  expect(view.working).toEqual([]);
  expect(view.done[0]).toMatchObject({ companyId: null, name: 'Company not known yet' });
});
it('a file this page is sending stays in Working on', () => {});
it('Done shows the newest 3 of 9', () => { expect(shownFilings(nine, false)).toMatchObject({ hidden: 6 }); });
it('the open filing follows its document when the filing key changes', () => {
  // opened { key: 'file:d1', documentId: 'd1' }; d1 now sits in 'co-1:financial_results:2026-09-30'
  expect(pickFiling(view, { key: 'file:d1', documentId: 'd1' })?.key).toBe('co-1:financial_results:2026-09-30');
});
it('with nothing opened, the newest unsettled filing opens', () => {});
it('once pinned, a newer unsettled filing does not take over', () => {
  const opened = pin(viewOf([olderWorking]), null);
  expect(pin(viewOf([olderWorking, newerWorking]), opened)?.key).toBe(olderWorking.key);
  expect(pin(viewOf([olderNowDone, newerWorking]), opened)?.key).toBe(olderWorking.key); // its work finished: still open
});
it('identifying is true while any file is checked or identified', () => {
  expect(identifying(readWith({ unsorted: [fileOf({ pipeline: { identified: 'now' } })] }))).toBe(true);
  expect(identifying(readWith({ unsorted: [] }))).toBe(false);
});
it('a filings read never rolls back a file its own poll wrote', () => {
  expect(fileIn(keepFresher(polledReading, staleRead, ['d1']), 'd1').pipeline.numbers.state).toBe('now');
});
it('applyDocument returns the same read when no file matches', () => { expect(applyDocument(read, docOf({ id: 'nope' }))).toBe(read); });
it('one new question is said by name', () => {
  expect(newQuestions(new Set(), readWith({ held: [heldOf({ key: 'bse:532999', nameAsPrinted: 'Coastline Bank Limited' })] })).aloud).toBe('Coastline Bank needs you: confirm the company.');
});
it('many new questions are said as one count', () => {
  expect(newQuestions(new Set(), read31Companies2Files).aloud).toBe('31 companies and 2 files need you.');
  expect(newQuestions(questionKeySet(read31Companies2Files), read31Companies2Files).aloud).toBeNull();
});
```

- [ ] **Step 2: Run to see them fail.** `cd apps/web && pnpm vitest run src/lib/documents/filings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `buildView` takes a 400-filing read without sorting it again: the server's order stands.
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/documents/filings.ts apps/web/src/lib/documents/filings.test.ts apps/web/src/lib/content/documents.ts
git commit -m "feat(web): the Documents view model: filings by company in Working on and Done, titles, the open filing, merges and questions"
```

---

### Task 6: Companies to confirm

**Files:**
- Create: `apps/web/src/lib/documents/confirm.ts`
- Modify: `apps/web/src/lib/content/documents.ts` (group `confirm`)
- Test: Create `apps/web/src/lib/documents/confirm.test.ts`

**Interfaces:**
- Consumes: `HeldIdentity`, `Company`, `ConfirmCompanyRequest`, `ConfirmCompanyResponse`, `ApiError` (Task 2). It reuses the regexes in `intake.ts`, exported as `CIN`, `BSE` and `NSE`, and adds `ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/`.
- Produces:
  - `CONFIRM_SHOWN = 4`.
  - `ConfirmRow = { identity: HeldIdentity; title: string; codes: string; counts: string; addLabel: string; mode: 'add' | 'pick'; primary: boolean; matches: Company[] }`. The fields are these:
    - `title` is the printed name, or the codes when there is none;
    - `codes` is "BSE 532999 · NSE COASTBANK · ISIN INE999Z01011 · CIN …", each part only when set;
    - `counts` is "9 filings · 26 files";
    - `addLabel` is "Add Coastline Bank" (the short name), or "Add this company" with no name;
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
  - `unnamedTitle(file: FilingFile): string`: "meridian-q2.pdf: which company is this?", with "Say which company" and the detail "Maester couldn’t find the company on the first pages. Say which it is and it carries on."

- [ ] **Step 1: Write the failing tests**

```ts
it('rows: four shown, the rest counted, the first Add primary', () => {
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
- Test: `apps/web/src/lib/documents/batch.test.ts`

**Interfaces:**
- Consumes: `sendAll`, `Outcome`, `Picked`, `sendFailure` (as built, after phase 4 Task 19).
- Produces:
  - `Outcome` gains `rest: Picked[]`: the files refused with stop `offline`, then the files never tried, in the order chosen. `sendAll`'s result gains it too. It is empty unless `stopped` is `offline`.
  - `unfinishedTitle(outcome: Outcome): string`: "The upload didn’t finish. 214 of 806 files were sent." The 806 is `outcome.total`, so it counts files the browser refused too.
  - `refusedTitle` is unchanged, except that a batch stopped `offline` takes `unfinishedTitle` as the Notice's first line. The offline sentence `drop.stopped.offline` goes. The Notice's action is an outline "Send the rest", where today's is "Choose files to add".
  - `DropStrip` gains `onresend: (rest: Picked[]) => void` (wired in Task 10).

- [ ] **Step 1: Write the failing tests**

```ts
// inside describe('sendAll'), with its many() and pick()
it('offline at the third file: the rest is the offline failures and the untried, in order', async () => {
  const result = await sendAll(many(10), null, async (item) => {
    if (item.path >= 'f2.pdf') throw new ApiError(0, 'NETWORK', 'offline');
  });
  expect(result.stopped).toBe('offline');
  expect(result.sent).toBe(2);
  expect(result.rest.map((p) => p.path)).toEqual(['f2.pdf', 'f3.pdf', 'f4.pdf', 'f5.pdf', 'f6.pdf', 'f7.pdf', 'f8.pdf', 'f9.pdf']);
  // f0–f3 start together; f2 and f3 fail offline; f4–f9 are never tried
});
it('the files that went are never in the rest', () => { /* sent paths ∩ rest paths is empty */ });
it('signed out has no rest', () => { expect(result.rest).toEqual([]); });
it('the unfinished title', () => {
  expect(unfinishedTitle({ total: 806, sent: 214, stopped: 'offline' } as Outcome)).toBe('The upload didn’t finish. 214 of 806 files were sent.');
});
```

- [ ] **Step 2: Run to see them fail.** `cd apps/web && pnpm vitest run src/lib/documents/batch.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `rest: []` to the existing `sendAll` cases that compare the whole result with `toEqual`. In `DropStrip.svelte`, show "Send the rest" (outline) calling `onresend(outcome.rest)` for an offline stop.
- [ ] **Step 4: Run** `cd apps/web && pnpm vitest run src/lib/documents && pnpm check`. Expected: PASS; `svelte-check found 0 errors and 0 warnings`.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/documents/batch.ts apps/web/src/lib/documents/batch.test.ts apps/web/src/lib/components/documents/DropStrip.svelte apps/web/src/lib/content/documents.ts
git commit -m "feat(web): a batch that stops offline says how many went and offers Send the rest"
```

---

### Task 8: `Track`, `FilingList` and `ConfirmCompanies`

**Files:**
- Create: `apps/web/src/lib/components/documents/{Track.svelte,FilingList.svelte,ConfirmCompanies.svelte}`

**Interfaces:**
- Consumes: Tasks 3, 5 and 6; `Notice`, `TextField`, `CompanyForm` (unchanged).
- Produces (props):
  - `Track`: `{ label: string; words: TrackWords; ink?: boolean; children?: Snippet }`. Its layout:
    - a 76px label column ("Numbers", "Text"; 14px, 700) and a body;
    - the first line at 16px, weight 700 when `needs-you` or `stopped`, else 400;
    - the second line at 14px, `--ink-muted`;
    - with `ink` and `now`, an ink block: paper text, `--paper-muted` second line. `children` renders under the words (the opened filing's "Try again").
  - `FilingList`: `{ heading: string; count: string; groups: CompanyGroup[]; collapse: boolean; openedKey: string | null; onopen: (view: FilingView) => void; idPrefix: string }`. Its structure:
    - A `section` labelled by its `h2`, with the count in muted text beside it.
    - Each group is an `h3` with id `${idPrefix}-co-${companyId ?? 'none'}` and `tabindex="-1"`, with its codes muted.
    - Rows are a `ul` with 1px `--ink-muted` rules between them, and a 2px rule closes the list.
    - In each row, the left side is the title, an underlined button (as `EarlierList`'s name today) carrying `aria-current="true"` when opened, then `fileLine`s at 14px muted. The right side is a 1px `--ink-muted` box with Numbers over Text, never `ink`.
    - The opened row carries a 2px `--ink` left rule.
    - Two columns (1.1fr / 1.6fr) from a 36rem container, stacked below that (board C3).
    - With `collapse`, each group shows `shownFilings`, then a text button with `aria-expanded` and `aria-controls` the group's list.
  - `ConfirmCompanies`: `{ rows; more; expanded; lede; unnamed: FilingFile[]; companies: Company[]; onexpand: () => void; onconfirm: (request: ConfirmCompanyRequest, name: string, isNew: boolean) => Promise<boolean>; classificationOf: (documentId: string) => Promise<DocumentClassification | null>; onanswer: (documentId: string, basedOn: string, company: CompanyAnswer) => Promise<boolean> }`. Its structure:
    - A `section` with `h2` "Not in your workspace yet" and the lede.
    - One row per `ConfirmRow`:
      - the name in bold, the counts right-aligned and tabular, the codes muted;
      - mode `add`: "Add …" (filled when `primary`, else outline) and an outline "It’s one of mine", which shows the picker (`aria-expanded`);
      - mode `pick`: the question "Which of your companies is this?", the picker shown, matches first and chosen, "Use this company" (filled when `primary`) and an outline "Add …";
      - a row with no printed name shows a `TextField` "Company name" before Add, with today's empty-name error.
    - The picker is a labelled `select`, "Your companies", with matches first.
    - "Show all" when `more > 0`.
    - Then each unnamed file as a `Notice role="note"` with `unnamedTitle`, its detail and "Say which company". The first unnamed file's button is filled when there are no rows, and every other one is outline. It loads the file's classification and shows `CompanyForm mode="ask"` inline.
    - A busy action disables its own buttons and points at a visible "Saving…" line. A failure shows a `Notice` under its row.

- [ ] **Step 1: Write the components.** Start from `EarlierList.svelte` (row button and hairlines) and `Slip.svelte` (the text-button and Notice patterns). Scoped styles only, tokens only.
- [ ] **Step 2: Check them.** Run `npx @sveltejs/mcp svelte-autofixer ./apps/web/src/lib/components/documents/Track.svelte`, then the same for `FilingList.svelte` and `ConfirmCompanies.svelte`. Expected: no issues. Then `cd apps/web && pnpm check && pnpm lint && pnpm vitest run src/lib/styles`. Expected: `svelte-check found 0 errors and 0 warnings`, lint clean, design guard PASS.
- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/components/documents/Track.svelte apps/web/src/lib/components/documents/FilingList.svelte apps/web/src/lib/components/documents/ConfirmCompanies.svelte
git commit -m "feat(web): Track, FilingList and ConfirmCompanies for the Documents page"
```

---

### Task 9: `Filing`, the filing opened

**Files:**
- Create: `apps/web/src/lib/components/documents/Filing.svelte`

**Interfaces:**
- Consumes: Tasks 3–5; `KindForm`, `CompanyForm`, `Notice`, `SectionIssue`; `sourceOf`, `whatItIs`, `periodWords`, `statementsWords`, `identifiers`, `kindSaveLabel`, `companyCandidates` (`intake.ts`); `companyHref` (`$lib/research/links`).
- Produces (props): `{ view: FilingView; company: Company | null; companies: Company[]; answers: Record<string, DocumentClassification | null>; answersFailed: readonly string[]; ctx: TrackContext; primaryAvailable: boolean; message: string | null; fileHref: (id: string) => string; onchange: (documentId: string, change: Change) => Promise<boolean>; onretry: (track: 'identify' | 'numbers' | 'text') => Promise<void>; onreadagain: () => Promise<void>; onreload: () => Promise<boolean>; heading?: HTMLHeadingElement /* bindable */ }`. `Change` moves from `Slip.svelte`'s module script to this one, unchanged.
- The filing is a 2px `article` labelled by its `h2` (`tabindex="-1"`), in this order:
  1. **Heading.** `filingHeading`, then `filingMeta` muted.
  2. **Numbers.** A spec entry holding `Track label="Numbers" ink`. When it is `stopped` and `retryIds(files, 'identify' | 'numbers')` is not empty, it shows an outline "Try again", which calls `onretry`. While that runs, the button is disabled and points at "Asking Maester to try again…".
  3. **Sources.** For each `BasisSources`, an `h3` (`basisTitle`) and a `table` with column headers Statement, Numbers from and In the PDF. The rows are `sourceRows(basis, filing, pdfStatements)`, where `pdfStatements` is the PDF file's loaded `statementsFound`:
     - "Numbers from" has the note muted under its text;
     - "In the PDF" is bold when `strong`, then `missed` and the `open` link (`${fileHref(id)}#page=${pageIndex + 1}`, new tab, `rel="noopener"`);
     - below a 36rem container, rows stack. The table, `tr`, `th` and `td` carry explicit `role`s (`table`, `row`, `columnheader`, `cell`), so stacking keeps the table semantics. Each cell holds its column's name as a span with `aria-hidden="true"`, shown only when stacked.
     - With no sources (an unsorted file, a kept document), the section is left out.
  4. **Text.** A spec entry holding `Track label="Text" ink`, with "Try again" calling `onretry('text')` when `stopped`.
  5. **Files.** A spec entry listing each file as a link (`fileHref`, new tab) named "XBRL · name" or "PDF · name", then "added …" muted. Duplicates are named under their file ("Added twice").
  6. **Questions.** A file in `needs_kind` shows today's `Notice` "Maester couldn’t tell what this is." and `KindForm`, with `primary` only when `primaryAvailable` (the page passes `filingPrimary`). After a save, focus goes to the heading.
  7. **Read as.** An `h3` "Read as", then one `h4` per file ("PDF · name"), each with today's spec list (What it is, Company, Period, Statements), its evidence lines and "Change" for What it is and Company, as the slip has them. XBRL evidence reads "ScripCode 500999" through `sourceOf`. When a file's answers did not load, a `SectionIssue role="note"` shows "What Maester worked out didn’t load." with "Try again" (`onreload`).
  8. **Actions.**
     - "See the figures" is a link (`companyHref`), shown when the company is confirmed and the Numbers track is `done`.
     - "Read it again" is an outline button, shown when `readAgainIds(files)` is not empty and no track is `now`. It is disabled with its busy line while it runs.
     - Both are secondary actions.
- Focus works as today. After a Change saves, focus returns to the Change that opened the form. If that file left this filing, focus goes to this filing's heading. An `h2` the page opened takes focus.

- [ ] **Step 1: Write the component.** Move `Slip.svelte`'s Read-as markup, its `changeButton` and `sourceLine` snippets and its styles in, adapted per file. Do not change `KindForm` or `CompanyForm`.
- [ ] **Step 2: Check it.** `npx @sveltejs/mcp svelte-autofixer ./apps/web/src/lib/components/documents/Filing.svelte`, then `cd apps/web && pnpm check && pnpm lint && pnpm vitest run src/lib/styles`. Expected: no issues; `svelte-check found 0 errors and 0 warnings`; PASS.
- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/components/documents/Filing.svelte
git commit -m "feat(web): the filing opened: both tracks, statement sources per basis, files, Read as per file, read it again"
```

---

### Task 10: `DocumentsPage` on filings; the slip, the ladder and Earlier go

**Files:**
- Modify: `apps/web/src/lib/components/documents/DocumentsPage.svelte` (rewritten), `DropStrip.svelte` (`onresend`), `apps/web/src/lib/documents/intake.ts`, `apps/web/src/lib/documents/client.ts` (drop `listDocuments`, `DOCUMENT_PAGE`), `apps/web/src/lib/content/documents.ts`
- Delete: `apps/web/src/lib/components/documents/{Slip.svelte,StageLadder.svelte,EarlierList.svelte}`
- Test: `apps/web/src/lib/documents/intake.test.ts`, `client.test.ts`

**Interfaces:**
- Consumes: everything above; `SignedInPage` (unchanged route `apps/web/src/routes/terminal/documents/+page.svelte`); `Hatch`, `SectionIssue`, `Notice`; `signInAgainHref`.
- `intake.ts` loses these: `StepStatus`, `Step`, `ViewOptions`, `ladder`, `stateLabel`, `isLive`, `anyLive`, `mergeList`, `pickSlip` and their helpers, with their tests. It keeps these: `MAX_UPLOAD_BYTES`, `POLL_MS` (2000), `LIST_POLL_MS` (5000), `whatItIs`, `sourceOf`, `statementsWords`, `periodWords`, `identifiers`, `companyAnswer`, `normalizeCompanyName`, `companyCandidates`, `kindSaveLabel`, `addedAt`, `changeFailure`, `Failure`, and the regexes.
- Copy changes (`documentsContent`):
  - `lede` becomes "Your filings, by company. A filing’s PDF and XBRL sit together: numbers come from XBRL when there is one, and every page’s text is indexed."
  - `slip` is renamed `filing`, without `steps`, `stepsLabel` and `step`.
  - `states`, `earlier`, `announce` and `leaving` go.
  - `empty` is "Nothing added yet. Drop a filing above, or a whole folder of XBRL files."
  - `signedOut` reads `{ title: 'You’re signed out.', detail: 'Sign in to see where your filings stand. Nothing you added is lost.', action: 'Sign in' }`.
- The page's state: `load` (`'loading' | 'failed' | 'no-workspace' | 'signed-out' | 'ready'`), `read` (`$state.raw<WorkspaceFilings>`), `companies`, `opened: Opened | null`, `answers` (`$state.raw<Record<string, DocumentClassification | null>>`) and `answersFailed`, `uploadingIds`, `busy`, `sending`, `outcome`, `message`, `announcement`, `hidden`, `seenQuestions`, and `writes: Record<string, number>`.
- Derived values:
  - `ctx` and `view = buildView(read, ctx)`;
  - `openFiling = opened ? pickFiling(view, opened) : null`;
  - `confirm = confirmRows(read.held, companies, confirmExpanded)`;
  - `unnamedPrimary`: no confirm rows;
  - `filingPrimary`: no confirm rows and no unnamed files.
- **Pinning.** After every read (first load, polls, changes, uploads, confirms), `opened = pin(view, opened)`. `Filing` renders only while `opened` is set, and is keyed by `opened.documentId`.
- **First load.** `readMe`, then `listFilings` and `listCompanies` at once. `seenQuestions` is seeded from `questionKeys(read)`, and `opened` is pinned. Then the open filing's answers load (`getClassification` per file, at once).
  - While it loads, the drop strip shows, disabled and pointing at the status line. Hatch boxes the size of two company groups stand in (each a 1.5rem `h3` box, then two 4.5rem rows), with one `role="status"` line, "Loading your documents.", and `aria-busy` on the region.
  - A failure shows `SectionIssue` "Your documents didn’t load." with "Try again".
  - No workspace, or 403 or 404 on the filings read, shows today's no-workspace issue.
- **Order on the page.** The `h1` and the lede, the drop strip (with the sending note under it while `sending`), `ConfirmCompanies` (only with rows or unnamed files), then the desk, then Done. The desk is `Filing` (keyed by `opened.documentId`) beside `FilingList` Working on: the filing first in the DOM, 1.3fr and 1fr from 1024px, stacked below that with the filing first. Done (`FilingList`, `collapse`) comes after, full width. With `view.empty`, the empty sentence replaces the desk and Done.
- **Polls.** They follow Decision 12, with today's back-off (base × min(1 + failures, 5)) and today's `visibilitychange`.
  - The open filing: every `POLL_MS` while `filingLive(openFiling, ctx)` and no file of it is being sent, `getDocument` for each file, then `applyDocument`, counting `writes`. When it stops being live, the filings are read once.
  - The list: every `LIST_POLL_MS` while `listWatched(view, openFiling?.key ?? null, ctx)`. The read uses `keepFresher` with the ids written since it began.
  - After each list read, when no batch is sending and `identifying(read)` is false, `newQuestions` says any new question. Otherwise `seenQuestions` is left as it is, so the held-back questions are said together once identification settles.
- **Signed out.** Any `UNAUTHENTICATED` from a read or an action sets `load = 'signed-out'`. Polls stop, and a `Notice role="alert"` shows `signedOut` with a link to `signInAgainHref('/terminal/documents')`. The read already on the page stays visible under it.
- **Adding files.** This is today's `addFiles`, with four changes:
  - `onCreated` calls `withUpload`;
  - a lone file opens `{ key: 'file:<id>', documentId: <id> }` and focuses the filing heading;
  - a batch pins the open filing to its first file without moving focus;
  - at the end, the page reads the filings once and says `endAloud(outcome)`. When `identifying(read)` is already false, the `newQuestions(...).aloud` line is added to it; otherwise the questions follow later, as one line (Decision 10). `onresend` calls `addFiles(rest)`.
- **Actions.**
  - `onopen(view)` sets `opened` to `{ key: view.key, documentId: view.files[0].documentId }` and focuses the heading.
  - `onchange` posts the classification, applies the returned document, stores its answers, reads the filings again and keeps `opened.documentId`. Failures go through `changeFailure`, as today.
  - `onretry(track)` calls `classify`, `extract` or `index` for each `retryIds` id, then refreshes.
  - `onreadagain` calls `extract` for each `readAgainIds` id, never for any other id, then refreshes.
  - `onconfirm` calls `confirmCompany`. It reads the filings and the companies again, says `confirmedAloud` and focuses the company's Working on `h3` (or the Working on `h2`). Failures go through `confirmFailure`.
  - `onanswer` posts the unnamed file's company, as the slip does today.
- **Leaving.** `beforeunload` asks first while `sending`, as today.

- [ ] **Step 1: Delete the old tests and adjust the rest.** Remove `intake.test.ts`'s `ladder`, `stateLabel`, `isLive`, `pickSlip`, `anyLive` and `mergeList` blocks, and `client.test.ts`'s `listDocuments` case. Run `cd apps/web && pnpm vitest run src/lib/documents`. Expected: PASS.
- [ ] **Step 2: Rewrite `DocumentsPage.svelte`**, delete the three components and the dead code and copy, and wire `DropStrip`'s `onresend`.
- [ ] **Step 3: Check.** Run `npx @sveltejs/mcp svelte-autofixer ./apps/web/src/lib/components/documents/DocumentsPage.svelte` (expected: no issues). Then `cd apps/web && pnpm verify`. Expected: `svelte-check found 0 errors and 0 warnings`, Prettier and ESLint clean, all tests PASS, build OK. Also, from the repository root, `grep -rn "Slip\|StageLadder\|EarlierList\|pickSlip\|stateLabel" apps/web/src`. Expected: no output.
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
- Test: `apps/web/src/lib/research/view.test.ts`, `apps/web/src/lib/research/summary.test.ts`

**Interfaces:**
- Consumes: phase 4 Task 14's `CellSource`, `XbrlInPdf` and `Restated` unions; `notCheckedWords` and `pagesWords` (Task 4).
- Produces (`types.ts`): `PageSource = { kind: 'page'; documentId; pageIndex; pageCount; textLayerMatch }`; `XbrlSource = { kind: 'xbrl'; documentId; originalName; element; contextId; decimals: string | null; nil: boolean; periodStart: string | null; span: FactSpan | null; inPdf: XbrlInPdf }`; `CellSource = PageSource | XbrlSource` (the page variant's `kind` is now required); `XbrlInPdf`; `Restated` as phase 4's two variants.
- Produces (`view.ts`, pure):
  - `sourcePage(cell: FinancialCell): number | null`: the 1-based page of a page source, else null. `cellReason`, `pageWords`, `onPage` and the P/E note use it.
  - `cellReason` for an XBRL cell. `unparsed` with `nil` gives "The XBRL file gives no value for this line." `missing` is unchanged.
  - `xbrlFrom(source: XbrlSource, periodEnd: string): { text: string; note: string }`. The text is "Results for the {span} to {d Mon yyyy}: the XBRL filed with the PDF". The span is quarter, half year, nine months or year; an instant reads "Results at 31 Mar 2026". It ends "…: the XBRL file" when `inPdf.pdfDocumentId` is null. The note is "{originalName} · tagged {element}". `contextId` never appears.
  - `xbrlUnit(unit: string, decimals: string | null): string`: "₹ crore, as the filing declares; rounded to the lakh". The word comes from −decimals: 1 ten, 2 hundred, 3 thousand, 4 ten thousand, 5 lakh, 6 million, 7 crore, 8 ten crore, 9 billion; 0 is "the rupee"; 2 decimal places is "the paisa"; any other n is "n decimal places". `INF` is "; not rounded", and null leaves the clause out.
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
  - the XBRL restated words are "{filing} filed {printed} for this year in its XBRL file."
- `FigurePanel`, for an XBRL source, shows these entries:
  - From (`xbrlFrom`, the note muted);
  - Unit (`xbrlUnit`);
  - In the PDF (`inPdfWords`, in place of "On the page");
  - Adds up, Restated, Used in and Reviewed, as today;
  - the `xbrlOpen` link and its note, built with `pageHref` or `fileHref`, or no link.

  A page source is unchanged. `StatementTable` uses `columnFrom` for the sub-label. `CompanyPage` lists `yearSources` as a muted spec list under the table's note.

- [ ] **Step 1: Write the failing tests** with hand-built cells, which are test inputs, not data the page shows:

```ts
const x: XbrlSource = { kind: 'xbrl', documentId: 'x4', originalName: '500999_Q4_FY26_Consolidated.xml', element: 'RevenueFromOperations', contextId: 'FourD', decimals: '-5', nil: false, periodStart: '2025-04-01', span: 'year', inPdf: { status: 'passed', pdfDocumentId: 'p4', pageIndex: 4, statementPages: [3, 4, 5], reason: null } };
it('From names the filing and the file, never the context', () => {
  expect(xbrlFrom(x, '2026-03-31')).toEqual({ text: 'Results for the year to 31 Mar 2026: the XBRL filed with the PDF', note: '500999_Q4_FY26_Consolidated.xml · tagged RevenueFromOperations' });
  expect(JSON.stringify(xbrlFrom(x, '2026-03-31'))).not.toContain('FourD');
});
it('From with no PDF stored', () => { expect(xbrlFrom({ ...x, inPdf: { ...x.inPdf, status: 'not_checked', pdfDocumentId: null, reason: 'no_pdf' } }, '2026-03-31').text).toBe('Results for the year to 31 Mar 2026: the XBRL file'); });
it('Unit', () => { expect(xbrlUnit('₹ crore', '-5')).toBe('₹ crore, as the filing declares; rounded to the lakh'); expect(xbrlUnit('₹ a share', 'INF')).toBe('₹ a share, as the filing declares; not rounded'); });
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
it('a nil XBRL value is "—" with its reason, never zero', () => {
  expect(cellText(xbrlCell({ status: 'unparsed', value: null, nil: true }))).toBe('—');
  expect(cellReason(xbrlCell({ status: 'unparsed', value: null, nil: true }), 'Results, XBRL')).toBe('The XBRL file gives no value for this line.');
});
it('a year from two sources is named; one source names nothing', () => {});
// summary.test.ts: a P/E note on a page source still reads "(annual report, page 213)"
```

- [ ] **Step 2: Run to see them fail.** `cd apps/web && pnpm vitest run src/lib/research`. Expected: FAIL.
- [ ] **Step 3: Implement**, including the page variant's `kind: 'page'` in the existing `view.test.ts` and `summary.test.ts` fixtures. Run `npx @sveltejs/mcp svelte-autofixer` on the three components.
- [ ] **Step 4: Run** `cd apps/web && pnpm verify`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/research apps/web/src/lib/components/research apps/web/src/lib/content/research.ts
git commit -m "feat(web): the figure panel for an XBRL figure: the filing and file, the declared unit, the PDF check in words, the page it was found on"
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
      - Done's "Show all {n} filings of {company}".
    - **Filing:**
      - the Numbers entry above the ledgers;
      - the ledgers as tables whose rows stack below a 36rem container;
      - Read as per file, under an `h4` for each;
      - "Read it again reads the XBRL files again, and a PDF only when Gemini read its numbers; never a PDF that XBRL covers.";
      - "A miss is bold, with “Open the results PDF at page n” where the statement pages start.";
      - the open filing asks for its files every 2 seconds while a track is working, and the filings are read every 5 seconds while another filing in Working on is working.
    - **Track:** the Numbers and Text words table of Task 3, by reference to `lib/documents/tracks.ts`; "In the list a track is words only; in the opened filing the working track is an ink block."
    - **Companies to confirm:**
      - the `pick` mode ("Which of your companies is this?", matches first and chosen, "Use this company");
      - "Past four rows, “27 more companies” and “Show all”.";
      - the unnamed Notice;
      - the confirmed line said once.
  - **Figure panel:** add spec §12's sentence, plus the Unit entry and that "In the PDF" replaces "On the page" for an XBRL figure.
  - **Statement table:** the new note, the "Results, XBRL" sub-label and the per-year sources list.
  - **Section issue:** "on the slip when a step stopped" becomes "when an opened filing’s answers do not load".
  - **Hatch:** "while the slip and the Earlier list first load" becomes "while the filings first load: two company groups".
- `DESIGN.md` §10 **Documents** is rewritten to spec §2's order and §10's states:
  - the lede;
  - drop strip, Not in your workspace yet (only when some), Working on beside the opened filing from 1024px (the filing about 1.3 times as wide, first), Done below;
  - stacked below 1024px, with the opened filing first;
  - which filing opens, by `pickFiling`'s order;
  - loading, failed, empty, stopped, offline and signed out;
  - "Copy lives in `lib/content/documents.ts`; the logic, free of Svelte and tested, in `lib/documents/`."
- `docs/systems/web.md` changes, in STE:
  - **Terms:** replace "slip", "Earlier list" and "live document" with "filing", "filing list", "track", "held company" and "live filing".
  - **Documents components:** the components table row lists `FilingList`, `Filing`, `Track`, `ConfirmCompanies` and `DropStrip`.
  - **Documents logic:** add the logic modules `tracks.ts`, `sources.ts`, `filings.ts` and `confirm.ts`.
  - **Documents sections:** rewrite "first load", "upload", "polls" and "answers", and add "confirm a company". The stale "one file at a time" goes.
  - **Research:** "Open the PDF at page N" adds the XBRL button.
- `docs/systems/maester.md`, in STE: the `slip` term (today's line 29) and the three steps that name the slip (today's lines 106, 112 and 115) read "the opened filing", with the poll split of Decision 12.

- [ ] **Step 1: Edit the three files.** Check every component name, route and copy string against the code built in Tasks 1–11.
- [ ] **Step 2: Check.** `grep -n -i "slip\|Earlier list\|Stage ladder\|StageLadder" docs/DESIGN.md docs/systems/web.md docs/systems/maester.md`. Expected: no output. Then `cd apps/web && pnpm vitest run src/lib/styles`. Expected: PASS. Then the workspace and local-docs check that CI runs: `uv run --locked python scripts/check_workspace.py`. Expected: `Workspace OK`.
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
  - **One filled button on the screen:** the first Add; with no rows, the first "Say which company"; with neither, the open filing's own question.
  - **Targets:** every target is at least 44px tall.
- [ ] **Step 3: Keyboard and screen reader.** Tab from the skip link through the page:
  - the drop strip's two buttons, the confirm rows, the opened filing's controls, then the filing titles, in DOM order;
  - opening a filing moves focus to its `h2`;
  - "Show all" toggles `aria-expanded`;
  - a Change that saves returns focus to its Change;
  - confirming one company (the investor's pick) moves focus to its Working on `h3`. The polite status line says "{name} added. Its {n} files carry on." once, and its files leave "Not in your workspace yet".
  - The status region says nothing while tracks move (watch it for a minute with a filing indexing).
- [ ] **Step 4: The states (UI specification §14).** Check each:
  - **Loading:** throttle to Slow 3G and reload. The hatch boxes for two company groups and "Loading your documents." appear, the drop strip is disabled, and nothing moves on arrival.
  - **Failed:** block `*/filings` in the network panel and reload. The section issue "Your documents didn’t load." shows; unblock it, and "Try again" recovers.
  - **Empty:** no live workspace is empty. `buildView`'s `empty` test covers it; say so in the PR.
  - **Stopped:** ask first, because no document can be deleted and the file stays in the workspace. Upload `broken.xml`: the first 2,000 bytes of a real instance from the folder, so the root is there and the rest is cut off (free). The browser takes it. One of two things then happens; record which:
    - Verify passes it and `document.classify` fails `XBRL_UNREADABLE` without a retry. It shows under "Company not known yet" with "Stopped" in bold and "Maester couldn’t work out what this is." Opened, it shows "Try again" on that track only, and the other filings carry on.
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

1 → 2 → (3, 4, 6, 7 in any order) → 5 → 8 → 9 → 10 → 11 → 12 → 13.

- Task 1 (API) needs phase 4 on `staging`.
- Task 2 needs Task 1's contract.
- Tasks 3, 4, 6 and 7 need only Task 2.
- Task 5 needs Task 3.
- Task 8 needs Tasks 3, 5 and 6.
- Task 9 needs Tasks 3, 4 and 5.
- Task 10 needs Tasks 7, 8 and 9.
- Task 11 needs Tasks 2 and 4 (`notCheckedWords`, `pagesWords`), and may run after Task 4.
- Task 12 needs everything it describes.
- Task 13 comes last.

## Open questions for the investor

1. **Q4 results XBRL for the annual columns** (spec §11; yours). This plan does not decide it. Until it is decided, no results XBRL figure reaches a Research table, so the XBRL figure panel is built but cannot be seen on real data.
2. **"1 not found: see the figure."** With nowhere in Research to land, the opened filing says "1 not found." and opens the results PDF where the statement pages start. Once results figures reach Research (question 1, or the data layer's quarter view), the link and a `fact` selection on the company page can follow.
3. **Working on during a long text backfill.** Text indexes one file at a time, so hundreds of filings can sit in Working on for days. The spec collapses only Done. Keep it, or collapse Working on per company too?
4. **Names printed in capitals.** XBRL prints "SYNTHETIC CEMENTS LIMITED". "Add …" adds the name as printed, never re-cased.
5. **"Read it again"** reads the numbers only (Decision 2). Should it also index the text again?

## After this plan

- The data layer's phase 4 (the quarter view), or a yes to question 1, puts XBRL cells into Research. The browser check of the XBRL figure panel and the "see the figure" link then follow. They need Task 11's `xbrlFrom`, `xbrlUnit`, `inPdfWords` and `xbrlOpen`, and a `fact` query on the company page.
- Phase 5 (measure the numbers) needs nothing from this plan.
- Every later Documents change starts from `lib/documents/{tracks,sources,filings,confirm}.ts` and `DESIGN.md` §5's Filing list, Filing, Track and Companies to confirm entries.
