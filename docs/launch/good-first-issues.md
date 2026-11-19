# Good first issues: launch draft

Status: draft, 19 November 2026. None of these is on GitHub yet. Once the maintainer approves the list, each section below becomes one issue with the `good first issue` label (plus the label named under it), its title as written and the text under "Body" as its body.

Every issue here was checked against the code on this date: the gap is real, and every file named exists. None touches an extraction prompt, a mapping rule, the taxonomy, the text-layer reader, a check or a metric (those need an evaluation run, which is not first-issue work), and none needs a paid API key to test.

Every body ends with the same footer. Links in the bodies are absolute, so they work in an issue:

> **Before you open a pull request:** read [CONTRIBUTING.md](https://github.com/himanshu634/maester/blob/staging/CONTRIBUTING.md). Sign off your commits (`git commit -s`), add yourself to CONTRIBUTORS.md and agree to the [CLA](https://github.com/himanshu634/maester/blob/staging/CLA.md) in your first pull request. Comment here first so two people don't pick the same issue.

---

## 1. `maester` import: answer `--help` and unknown flags with the usage line

Labels: `good first issue`, `enhancement`

**Body**

Roadmap: F04 (private upload and durable jobs). The folder importer is how a whole folder of filings gets in at once.

**Today.** `apps/import/src/cli.ts` parses its arguments with `parseArgs` in strict mode and knows only `--workspace` and `--api` (lines 15–19). So `--help` throws `ERR_PARSE_ARGS_UNKNOWN_OPTION`, the top-level catch prints "Import failed: Unknown option '--help'…" and the command exits 1. The `USAGE` line (line 12) only shows when the folder argument is missing. `main` has no tests.

**Done when**

- `--help` and `-h` print `USAGE` and the three settings from `apps/import/README.md`, and exit 0.
- An unknown flag prints which flag it was and `USAGE`, and exits 64, the code already used for a missing argument.
- New tests in `apps/import/test/import.test.ts` call `main([...], env, out)` and check the output and exit code for help, an unknown flag and a missing argument.
- `pnpm --filter @maester/import test`, `lint` and `typecheck` pass.

**Start here:** `apps/import/src/cli.ts`, `apps/import/test/import.test.ts`, `apps/import/README.md`.

Size: small.

---

## 2. Test the Holdings API client

Labels: `good first issue`, `enhancement`

**Body**

Roadmap: F35 (read-only broker connections, started early with Zerodha).

**Today.** `apps/web/src/lib/holdings/client.ts` builds every request the Holdings page makes and has no test. Its header comment promises that a broker's credentials travel only in a PUT body, never in a URL. The Research, Settings and Market mood clients each have a `client.test.ts`; Holdings does not. (`holdings/format.ts` is already covered by `view.test.ts`.)

**Done when**

- A new `apps/web/src/lib/holdings/client.test.ts` checks the URL and method for `brokers`, `snapshot`, `save`, `signInUrl`, `read` and `remove`, including that the broker id is escaped with `encodeURIComponent` (`a/b` becomes `a%2Fb`).
- It proves `save` sends credentials only in the JSON body, and that no request URL contains them.
- It proves a non-2xx answer rejects, as it does for the other clients.
- `pnpm --dir apps/web verify` passes.

**Start here:** `apps/web/src/lib/holdings/client.ts`; copy the pattern in `apps/web/src/lib/research/client.test.ts`; the shared request helpers are in `apps/web/src/lib/documents/client.ts`.

Size: small. No broker account needed: the test stubs `fetch`.

---

## 3. Stop describing Holdings as "coming soon" in the docs

Labels: `good first issue`, `documentation`

**Body**

Roadmap: R0. The [delivery plan](https://github.com/himanshu634/maester/blob/staging/docs/DELIVERY_PLAN.md) asks that "what exists today" is updated when a feature starts to run.

**Today.** Holdings works: it reads Zerodha holdings, read-only (`soon: false` in `apps/web/src/lib/terminal/pages.ts`; [DESIGN.md](https://github.com/himanshu634/maester/blob/staging/docs/DESIGN.md) §10). Three places still call it a coming-soon page:

- `docs/DEVELOPMENT.md` line 425
- `apps/web/README.md` line 3, which also says "holdings snapshot … still planned" and lists only Documents, Research, Market mood and Settings as working
- `apps/web/README.md` lines 40–42

**Done when**

- All three name Holdings among the working pages and describe it as read-only Zerodha holdings, with no transaction ledger.
- `make check` passes (it runs the local-link checker).

**Start here:** the three lines above.

Size: small.

---

## 4. Fill the gaps in the repository maps

Labels: `good first issue`, `documentation`

**Body**

Roadmap: F00 (root commands and docs).

**Today.** Two lists tell a newcomer what is in the repository, and both have fallen behind:

- The layout block in `CONTRIBUTING.md` (lines 95–116) leaves out `apps/mcp`, `apps/indexer`, `apps/import`, `packages/brokers`, `packages/market`, `packages/document-index` and `packages/financial-engine-ts`. Line 98 leaves `document.index` out of the worker's jobs, and line 101 still says "investor journeys planned".
- The table in `docs/DEVELOPMENT.md` §1 (lines 12–27) leaves out `apps/import` and the same four packages.

**Done when**

- Both lists name every directory under `apps/` and `packages/`, each with a one-line status taken from that directory's own README.
- Each entry links to a README only where one exists.
- `make check` passes.

**Start here:** `CONTRIBUTING.md`, `docs/DEVELOPMENT.md`, and the README in each `apps/*` and `packages/*` directory.

Size: small.

---

## 5. List the missing settings in DEVELOPMENT.md

Labels: `good first issue`, `documentation`

**Body**

Roadmap: F00. This trips up anyone who opens Settings on a fresh checkout.

**Today.** The API and worker read these variables, and `.env.example` (lines 86–91) sets them, but the configuration table in `docs/DEVELOPMENT.md` §6 does not list them:

- `CONNECTIONS_KEY`: without it, Settings answers `409 INVALID_STATE`.
- `DHAN_REQUESTS_PER_SECOND`, `MARKET_REFRESH_MINUTES` and `XBRL_SNIFF_BYTES` (`apps/worker/src/env.ts`, lines 18, 70 and 71).

**Done when**

- Each variable has a row with the service that reads it, whether it is required and its default, matching the zod schema in that service's `env.ts`.
- The `CONNECTIONS_KEY` row says how to make one: `openssl rand -base64 32`.
- `make check` passes.

**Start here:** `docs/DEVELOPMENT.md` §6, `.env.example`, `apps/worker/src/env.ts`, `apps/api/src/env.ts`.

Size: small.

---

## 6. Bring the API route lists up to date

Labels: `good first issue`, `documentation`

**Body**

Roadmap: F04, F07 and F35. These two lists are how a frontend contributor finds a route.

**Today.** `apps/api/src/app.ts` (lines 91–110) mounts routes that the "What it owns" list in `apps/api/README.md` and the §4 table in `packages/contracts/README.md` (lines 128–158) don't mention:

- `/v1/brokers` and `/v1/brokers/:broker/return`
- the workspace's `…/brokers/:broker` (PUT, DELETE), `…/sign-in` and `…/read`
- `…/holdings` and `…/search`
- `…/documents/:id/index` and `…/companies/confirm` (missing from the API README only)
- the research, financials, stock, `/v1/market-mood` and `/v1/settings/connections` routes, which the API README has and the contracts table lacks

**Done when**

- Every route in `apps/api/src/routes/*.ts` appears in both lists.
- Any JSON example added under a `<!-- schema: X -->` marker passes `packages/contracts/test/readme-examples.test.ts`.
- `pnpm --filter @maester/contracts test` passes (no Postgres needed).

**Start here:** `apps/api/src/app.ts`, `apps/api/src/routes/`, `apps/api/README.md`, `packages/contracts/README.md`.

Size: medium (about 15 routes). Happy to see it split into one pull request per list.

---

## 7. Write READMEs for `packages/market`, `packages/storage` and `packages/db`

Labels: `good first issue`, `documentation`

**Body**

Roadmap: F00.

**Today.** `packages/brokers`, `contracts`, `jobs` and `document-index` each explain themselves in a README; `market`, `storage` and `db` have none. `market` holds the Dhan and FRED sources, the scrip-master parser and the encryption of saved keys; `storage` holds the local-disk, in-memory and Cloud Storage drivers; `db` holds the schema, queries and migrations.

**Done when**

- Each of the three has a README saying what it exports, which apps import it and how to run its tests.
- The `db` README links to `docs/DEVELOPMENT.md` §8 for migrations rather than repeating it.
- The `docs/DEVELOPMENT.md` §1 table links to the new READMEs.
- `make check` passes.

**Start here:** `packages/market/src/`, `packages/storage/src/`, `packages/db/src/`; follow the shape of `packages/jobs/README.md`.

Size: small. One pull request per package is fine.

---

## 8. Add issue and pull request templates

Labels: `good first issue`, `documentation`

**Body**

Roadmap: R0. CONTRIBUTING.md asks every issue to name a feature ID from the [feature roadmap](https://github.com/himanshu634/maester/blob/staging/docs/FEATURE_ROADMAP.md), but nothing prompts for it.

**Today.** `.github/` holds only `workflows/`: there is no issue template and no pull request template.

**Done when**

- `.github/PULL_REQUEST_TEMPLATE.md` carries the pull request checklist from CONTRIBUTING.md, word for word.
- `.github/ISSUE_TEMPLATE/` has a bug report and a feature request, each with a field for the roadmap feature ID.
- No new policy text: the templates only repeat what CONTRIBUTING.md already says. (A SECURITY.md needs the maintainer's own disclosure contact, so it is out of scope here.)

**Start here:** `CONTRIBUTING.md`, `.github/`.

Size: small.

---

## Left out, and why

- **The company or reading name in the browser tab title** (`SignedInPage.svelte` gives every company page the title "Research. Maester"). A real accessibility gap, but the title wording is the maintainer's call first; file it once that is decided.
- **The workspace check skipping root Markdown files** (`scripts/check_workspace.py` lines 59–61 skip CONTRIBUTING.md, CLA.md and CONTRIBUTORS.md). Small and real, but low value while those files have no broken links; a good second batch.
- **New `financial-engine-ts` functions, extractor, indexer or eval work.** These count as metrics, prompts or checks and need an evaluation run.
- **A local guide to Market mood or Zerodha.** Testing it needs Dhan or Kite keys.
