# Broker plugins (Kite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the JSON broker definitions with compiled-in TypeScript plugins, with Kite as the one plugin. Remove Dhan, Upstox, Groww and ICICI Direct as Holdings brokers.

**Architecture:**
- `packages/brokers` becomes a host and some plugins:
  - **Kit:** a host-locked `BrokerHttp`, value readers and `sessionExpiry`.
  - **Contract:** `BrokerPlugin`, made of a manifest, a `RedirectSignIn` and `reads.holdings`.
  - **Registry:** checks every plugin at start.
  - **Host functions:** they wrap every plugin call, enforce hosts, map errors and validate output.
- `apps/api` calls only the host functions. The web only loses the branches for the brokers that go.
- Kite keeps exactly the same calls and behaviour.

**Tech Stack:** TypeScript (ESM), zod 4, Hono, Drizzle and Postgres, vitest 4, ESLint 10 (typescript-eslint), SvelteKit 2 with Svelte 5, pnpm with turbo.

**Spec:** [`docs/superpowers/specs/2026-10-27-broker-plugins-design.md`](../specs/2026-10-27-broker-plugins-design.md). The decision record is [ADR 0009](../../decisions/0009-broker-plugins.md).

## Global Constraints

**Before you start**
- The broker tables' migration (`packages/db/drizzle/0009_broker_holdings.sql`) must be on `origin/staging` first. If `git ls-tree origin/staging packages/db/drizzle/` does not list it, stop and tell the user. Do not write or copy that migration yourself.
- Branch `feat/broker-plugins` from `origin/staging`, and open the PR into `staging`. Run `gh-help` first. Push with `gh-git push`.

**Figures**
- Figures are decimal strings, exactly as printed. Never call `Number()` or `parseFloat` on a quantity or a price, and compute nothing in a plugin. Quantity plus T+1, cost, value and gain stay in `@maester/financial-engine`.

**Errors**
- There are exactly four broker error codes: `BROKER_UNAVAILABLE`, `BROKER_SIGNED_OUT`, `BROKER_REFUSED` and `BROKER_ANSWER_UNREADABLE`.
- A broker's own error text, a URL, a credential or a token never goes into an error message, a log line or a response.

**Network**
- Every broker URL is `https:` on a host in the plugin's `manifest.hosts`. No redirects are followed (`redirect: "error"`). The timeout is 20 000 ms.

**Kite stays exactly as it is**
- **Login:** `https://kite.zerodha.com/connect/login?v=3&api_key=<apiKey>&redirect_params=<encodeURIComponent("state=" + nonce)>`.
- **Session:** `POST https://api.kite.trade/session/token` with the form `api_key`, `request_token` and `checksum = sha256hex(apiKey + request_token + apiSecret)`, and the header `X-Kite-Version: 3`.
- **Holdings:** `GET https://api.kite.trade/portfolio/holdings` with `Authorization: token <apiKey>:<accessToken>`.
- **Expiry and sign-out:** a session expires daily at 06:00 Asia/Kolkata, and a 403 means signed out.

**Unchanged**
- There is no schema change and no migration.
- `BrokerAccount`, `HoldingsSnapshot` and every holding type keep their shape.

**Web**
- Svelte edits go through the `svelte-code-writer` skill.
- Logic stays in `apps/web/src/lib/holdings/`, free of Svelte and tested.
- Run `pnpm verify` in `apps/web` before the PR (DESIGN.md §9).
- Copy is sentence case and uses `’` in interface text, as `lib/content/holdings.ts` already does.

**Dhan**
- Dhan stays as the Settings market-data connection. Do not touch `packages/market`, `market_connection`, Settings, the worker, or the copy that says closes come "from your Dhan data".

**Test database and processes**
- The API tests need Postgres with pgvector. In a worktree, never run `docker compose up`. Start your own container on your own port and stop it when you are done:

  ```bash
  docker run --rm -d --name maester-pg-plugins -p 55433:5432 -e POSTGRES_USER=maester -e POSTGRES_PASSWORD=maester -e POSTGRES_DB=maester_test_api pgvector/pgvector:pg16
  export DATABASE_URL_TEST_API=postgres://maester:maester@localhost:55433/maester_test_api
  ```

  Stop it with `docker stop maester-pg-plugins`.
- Kill processes only by exact PID. Never use `pkill` or `killall`.

## Review Focus

1. **A Kite return with no `status` parameter**, only `request_token` and `state`. It is accepted, as today, because the status check only applies when the parameter is present. Test in Task 4.
2. **A workspace that still has a `broker_connection` row for a removed broker** (`dhan`, `groww`). The accounts list and `GET /holdings` leave it out, and nothing fails with a 500. Test in Task 6.
3. **`GET /v1/brokers/dhan/return` from an old bookmark**, a broker that is not in the registry. It answers 404 `NOT_FOUND`, never a 500. Test in Task 6.
4. **A broker answer with the same (ISIN, exchange) twice.** Today that would hit `holding_line`'s primary key and be reported as `BROKER_UNAVAILABLE`. The host rejects it first as `BROKER_ANSWER_UNREADABLE`. Test in Task 3.
5. **A plugin switched off with `enabled: false` while an account exists.** `PUT` and `sign-in` are refused with `INVALID_STATE`. The existing account still lists, and still reads with the token it has. Test in Task 6.

---

### Task 1: Contracts for manifests and holding lines

This task only adds. The old definition types stay until Task 7.

**Files:**
- Modify: `packages/contracts/src/brokers.ts`
- Test: `packages/contracts/test/brokers.test.ts` (new)

**Interfaces:**
- Produces (zod schemas, each with its inferred type):
  - `BrokerCopy`, which is today's `BrokerDefinition.shape.copy`, extracted and reused by it.
  - `BrokerManifest = z.object({ id: BrokerId, name, enabled, notOfferedReason?, hosts: z.array(z.string().regex(/^[a-z0-9.-]+$/)).min(1).max(8), copy: BrokerCopy, credentials: z.array(BrokerCredentialField).min(1).max(4), credentialShown: z.string(), signIn: z.discriminatedUnion("kind", [z.object({ kind: z.literal("redirect") })]), signedOutStatuses: z.array(z.number().int().min(400).max(599)).default([401, 403]) })`.
  - `BrokerHoldingLine = z.object({ isin: z.string().min(1), symbol: z.string().min(1), exchange: z.string().min(1), quantity: DecimalString, t1Quantity: DecimalString, averagePrice: DecimalString, lastPrice: DecimalString.nullable() })`.

- [ ] **Step 1: Write the failing tests**
  - `BrokerManifest parses a Kite-shaped manifest and defaults signedOutStatuses to [401, 403]`.
  - `BrokerManifest refuses an empty credentials list`.
  - `BrokerManifest refuses a signIn kind other than redirect`, for example `{ kind: "direct" }`.
  - `BrokerHoldingLine refuses "1e3", "NaN" and the number 120`. Each must be a decimal string.
  - `BrokerHoldingLine accepts lastPrice null`.
- [ ] **Step 2:** Run `pnpm --filter @maester/contracts test -- brokers`. Expected: FAIL, because `BrokerManifest` is not exported.
- [ ] **Step 3:** Add the three schemas to `packages/contracts/src/brokers.ts` and export them from `src/index.ts` if the barrel lists names. Leave `BrokerDefinition`, which uses `BrokerCopy`, and `BrokerSummary` as they are.
- [ ] **Step 4:** Run `pnpm --filter @maester/contracts test && pnpm --filter @maester/contracts typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(contracts): BrokerManifest and BrokerHoldingLine for broker plugins`.

### Task 2: The kit

**Files:**
- Create: `packages/brokers/src/errors.ts`, `src/kit/http.ts`, `src/kit/values.ts`, `src/kit/expiry.ts` (moved from `src/expiry.ts`, unchanged), and `src/kit/index.ts`.
- Modify: `packages/brokers/src/client.ts`, which now imports `BrokerError` from `./errors.js` and `sessionExpiry` from `./kit/expiry.js`. Delete `src/expiry.ts`. `src/index.ts` keeps its exports.
- Test: `packages/brokers/test/kit/http.test.ts`, `test/kit/values.test.ts` and `test/kit/expiry.test.ts`. Move the `sessionExpiry` describe block out of `test/brokers.test.ts`.

**Interfaces:**
- Produces:
  - `errors.ts`: `type BrokerErrorCode`, and `class BrokerError extends Error { constructor(readonly code: BrokerErrorCode, message: string) }`. Same as today.
  - `kit/values.ts`:
    - `at(value: unknown, path: string): unknown`;
    - `text(v: unknown, field: string): string`;
    - `decimal(v: unknown, field: string): string`;
    - `sha256hex(...parts: string[]): string`.

    The first three are today's `at`, `text` and `decimal`, moved. `sha256hex` joins its parts with nothing between them.
  - `kit/http.ts`:
    - `type BrokerHttp = { get(url: string, init?: { headers?: Record<string, string> }): Promise<unknown>; post(url: string, init: { headers?: Record<string, string>; form?: Record<string, string>; json?: unknown }): Promise<unknown> }`;
    - `type HttpPhase = "sign-in" | "read"`;
    - `createBrokerHttp(manifest: BrokerManifest, opts: { phase: HttpPhase; fetch?: typeof globalThis.fetch; timeoutMs?: number }): BrokerHttp`.
  - `kit/index.ts` re-exports all of the above and `sessionExpiry`.

`createBrokerHttp` behaviour, copied from `BrokerClient.call` (spec §5.5):

| Condition | Result |
| --- | --- |
| A URL that is not `https:`, or whose hostname is not in `manifest.hosts` | `BROKER_UNAVAILABLE`, before `fetch` is called |
| `fetch` throws | `BROKER_UNAVAILABLE`, with a message of only `${phase}: ${manifest.name} could not be reached` |
| A status in `signedOutStatuses` | `BROKER_REFUSED` on sign-in, `BROKER_SIGNED_OUT` on a read |
| A 400 on sign-in | `BROKER_REFUSED` |
| Any other status that is not 200 | `BROKER_UNAVAILABLE` |
| A body that is not JSON | `BROKER_ANSWER_UNREADABLE` |
| `form` given | Sent as `application/x-www-form-urlencoded` |
| `json` given | Sent as `application/json` |

Every request is made with `redirect: "error"` and `AbortSignal.timeout(timeoutMs ?? 20_000)`.

- [ ] **Step 1: Write the failing tests** in `test/kit/http.test.ts`, with a manifest on host `broker.test` and a `vi.fn` fetch:
  - `refuses http and other hosts before fetch is called`: `expect(fetch).not.toHaveBeenCalled()`.
  - `maps a signed-out status to BROKER_SIGNED_OUT on a read and BROKER_REFUSED on sign-in`.
  - `maps 400 on sign-in to BROKER_REFUSED and 500 to BROKER_UNAVAILABLE`.
  - `never puts the URL or the broker's text in the message`: fetch throws an error carrying `?api_key=leak123`, and the message excludes `leak123`.
  - `sends a form url-encoded and json as JSON, with redirect "error"`.
  - `calls a body that is not JSON BROKER_ANSWER_UNREADABLE`.

  Values tests:
  - `decimal keeps "1512.4" from the number 1512.4`.
  - `decimal refuses 1e21, "ten" and NaN`.
  - `sha256hex("a","b") equals sha256 of "ab"`.

  Move the expiry tests as they are.
- [ ] **Step 2:** Run `pnpm --filter @maester/brokers test -- kit`. Expected: FAIL (the modules are missing).
- [ ] **Step 3:** Implement `errors.ts`, `kit/values.ts`, `kit/http.ts` and `kit/expiry.ts`, and repoint `client.ts`'s imports.
- [ ] **Step 4:** Run `pnpm --filter @maester/brokers test && pnpm --filter @maester/brokers typecheck && pnpm --filter @maester/brokers lint`. Expected: PASS. The old `brokers.test.ts` still passes.
- [ ] **Step 5: Commit** with `feat(brokers): the plugin kit (host-locked http, values, expiry)`.

### Task 3: Plugin contract, registry and host functions

**Files:**
- Create: `packages/brokers/src/plugin.ts`, `src/registry.ts` and `src/host.ts`.
- Create: `packages/brokers/test/fake-plugin.ts`, a test-only plugin on host `broker.test` reused by Tasks 4 and 6. Expose it as the subpath `"./testing": "./test/fake-plugin.ts"` in `packages/brokers/package.json` `exports`, so `apps/api` imports `@maester/brokers/testing` rather than a path across packages.
- Test: `packages/brokers/test/registry.test.ts` and `test/host.test.ts`.

`plugin.ts` uses the contracts' `BrokerHoldingLine` (Task 1) and re-exports its type. The old TypeScript type of that name in `client.ts` goes with Task 7.

**Interfaces:**
- Consumes: `BrokerManifest` and `BrokerHoldingLine` (Task 1); `BrokerHttp`, `createBrokerHttp` and `BrokerError` (Task 2).
- Produces:
  - `plugin.ts`, exactly the spec's §5.3 types: `Credentials`, `BrokerSession`, `RedirectSignIn`, `ReadCtx` and `BrokerPlugin`. Plus `type ReturnRead = { state: string | null; payload: Record<string, string> } | { state: string | null; refused: true }`.
  - `registry.ts`:
    - `type BrokerRegistry = ReadonlyMap<string, BrokerPlugin>`;
    - `class RegistryError extends Error`;
    - `createRegistry(plugins: readonly BrokerPlugin[]): BrokerRegistry`. It parses each manifest with `BrokerManifest` and stores the parsed manifest back on the plugin. It throws `RegistryError("broker plugin <id>: <why>")` for a duplicate id, a `credentialShown` that is not a credential, two credentials with one key, or `manifest.signIn.kind !== plugin.signIn.kind`. It returns a frozen map.
  - `host.ts`, the only way the API calls a plugin:
    - `loginUrlFor(p: BrokerPlugin, ctx: { creds: Credentials; state: string; returnUrl: string }): string`. It throws `BrokerError("BROKER_UNAVAILABLE", …)` when the URL is not https on a manifest host.
    - `completeSignIn(p, ctx: { creds; payload; returnUrl; now: Date; fetch?: typeof fetch }): Promise<BrokerSession>`. It uses http with phase `"sign-in"`, and requires a non-empty `accessToken` (otherwise `BROKER_ANSWER_UNREADABLE`).
    - `readHoldings(p, ctx: { creds; session: { accessToken: string; accountId: string | null }; now: Date; fetch?: typeof fetch }): Promise<BrokerHoldingLine[]>`. It uses http with phase `"read"`, parses every line with `BrokerHoldingLine`, and rejects a repeated `(isin, exchange)`. Both failures are `BROKER_ANSWER_UNREADABLE`.
    - `toBrokerError(err: unknown): BrokerError`. A `BrokerError` passes through, and anything else becomes `BROKER_UNAVAILABLE` with the message `"the broker call failed"`. `completeSignIn` and `readHoldings` route every throw through it.
  - `test/fake-plugin.ts`:
    - `fakePlugin(over?: Partial<BrokerManifest>): BrokerPlugin`. Id `fake`, name `Fake broker`, hosts `["broker.test"]`, one credential `apiKey`, with copy filled in.
    - `loginUrl` is `https://broker.test/login?key=<apiKey>&state=<state>`.
    - `readReturn` reads `token` and `state`, and `refused` when there is no `token`. Its token comes back in the return, the shape Angel One will have.
    - `complete` does `GET https://broker.test/profile` and takes `accountId = data.id`.
    - `reads.holdings` does `GET https://broker.test/holdings` with list `data`.
    - Expiry is daily at 00:00 Asia/Kolkata.

- [ ] **Step 1: Write the failing tests**
  - Registry:
    - `createRegistry accepts the fake plugin and is frozen`.
    - `refuses a duplicate id`.
    - `refuses credentialShown that is not a credential`.
    - `refuses a manifest whose signIn kind disagrees with the plugin's`.
  - Host:
    - `loginUrlFor refuses a plugin URL on another host`.
    - `readHoldings turns a plain Error carrying "SECRET-xyz" into BROKER_UNAVAILABLE without the text`.
    - `readHoldings refuses a line with quantity 1e3` (`BROKER_ANSWER_UNREADABLE`).
    - `readHoldings refuses the same isin and exchange twice` (Review Focus 4).
    - `completeSignIn refuses an empty access token`.
    - `a plugin's calls only reach fetch through ctx.http`: the fake fetch records the URLs, and all of them are on `broker.test`.
- [ ] **Step 2:** Run `pnpm --filter @maester/brokers test -- registry host`. Expected: FAIL.
- [ ] **Step 3:** Implement `plugin.ts`, `registry.ts`, `host.ts` and `test/fake-plugin.ts`.
- [ ] **Step 4:** Run `pnpm --filter @maester/brokers test && pnpm --filter @maester/brokers typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(brokers): plugin contract, registry and host functions`.

### Task 4: The Kite plugin and the conformance suite

**Files:**
- Create: `packages/brokers/src/plugins/kite/manifest.ts`, `src/plugins/kite/plugin.ts` and `src/plugins/index.ts`.
- Create: `packages/brokers/test/conformance.ts`, `test/plugins/kite/kite.test.ts` and `test/plugins/kite/fixtures/`.
- Fixtures: `session.json`, `holdings.json`, `signed-out.json` and `holdings-bad-figure.json`. They are today's answers from `test/brokers.test.ts`, with keys replaced.

**Interfaces:**
- Consumes: `BrokerPlugin` and `createRegistry` (Task 3); the kit (Task 2).
- Produces:
  - `export const kite: BrokerPlugin`.
  - `export const plugins: readonly BrokerPlugin[] = [kite]`.
  - `export function defaultRegistry(): BrokerRegistry`, which is `createRegistry(plugins)`. It goes in `src/plugins/index.ts`.
  - `runConformance(plugin: BrokerPlugin, f: ConformanceFixtures): void`, which defines a `describe(\`${plugin.manifest.id} conformance\`)`. `ConformanceFixtures` is:

    ```ts
    {
      creds: Credentials;
      goodReturn: Record<string, string>;
      refusedReturn: Record<string, string>;
      answers: Record<string, Answer>;
      expectedLines: BrokerHoldingLine[];
      signInAt: Date;
      expectedExpiry: string;
    }
    ```

    `answers` maps a URL to `{ status, body }`.

The Kite manifest and copy are `definitions/kite.json`, unchanged, as a typed `BrokerManifest` object. The plugin's behaviour is spec §12.1 and the Global Constraints.

`readReturn` follows today's rule:
- `state` is `query.state ?? null`;
- it is refused when the code or state is missing, or when `status` is present and is not `"success"`;
- otherwise the payload is `{ requestToken: query.request_token }`.

The conformance checks (spec §14.1):
- the registry accepts the plugin;
- the login URL is https on a manifest host and carries the nonce, whether URL-encoded or not;
- `goodReturn` gives back its state and a payload, and `refusedReturn` is refused;
- every call goes to a manifest host;
- a signed-out status on a read is `BROKER_SIGNED_OUT`, and on sign-in is `BROKER_REFUSED`;
- a body of the wrong shape (`{}`) is `BROKER_ANSWER_UNREADABLE`, never `[]`;
- the lines equal `expectedLines`;
- no error message contains any credential value, the token or the fixture's error text;
- the expiry equals `expectedExpiry`.

- [ ] **Step 1: Write the failing tests.** `kite.test.ts` calls `runConformance(kite, …)`, plus these Kite cases ported from `test/brokers.test.ts`:
  - `builds the login URL with the key and the state sent back as redirect_params`: `redirect_params` equals `state=nonce-1`.
  - `signs in with SHA-256(api_key + request_token + api_secret)`: the checksum is `sha256hex("kitekey123","rt","kitesecret456")`, no `api_secret` in the form, and expiry `2026-10-20T00:30:00.000Z` for a sign-in at `2026-10-19T03:30:00Z`.
  - `reads holdings as decimal strings, as printed`: `{ quantity: "120", t1Quantity: "0", averagePrice: "1512.4", lastPrice: "1742.6" }` and the header `Authorization: token kitekey123:tok`.
  - `accepts a return with no status parameter` (Review Focus 1).
  - `refuses a return whose status is "cancelled"`.
- [ ] **Step 2:** Run `pnpm --filter @maester/brokers test -- kite`. Expected: FAIL.
- [ ] **Step 3:** Implement `manifest.ts`, `plugin.ts`, `plugins/index.ts` and `test/conformance.ts`.
- [ ] **Step 4:** Run `pnpm --filter @maester/brokers test`. Expected: PASS. Both the old and the new Kite tests pass.
- [ ] **Step 5: Commit** with `feat(brokers): Kite as a plugin, with the conformance suite`.

### Task 5: Lint guard for plugins

**Files:**
- Modify: `packages/brokers/eslint.config.js`.
- Create: `packages/brokers/test/lint.test.ts`.

**Interfaces:**
- Produces: an ESLint block for `files: ["src/plugins/**/*.ts"]` with:
  - `no-restricted-globals`: `fetch`, `XMLHttpRequest`, `WebSocket` and `process`;
  - `no-restricted-imports`: `node:http`, `node:https`, `node:net`, `node:tls`, `node:fs`, `node:child_process`, `http`, `https`, `fs` and `undici`.

  Each comes with the message "Plugins reach the network only through ctx.http (spec §5.5)".

- [ ] **Step 1: Write the failing test** `lint.test.ts`. It uses `new ESLint({ cwd: packageRoot })` and `lintText(code, { filePath: "src/plugins/x/bad.ts" })` with code that calls `fetch("https://x")` and imports `node:https`. It expects at least 2 errors, naming `no-restricted-globals` and `no-restricted-imports`. The same code with `filePath: "src/host.ts"` has neither rule's error.
- [ ] **Step 2:** Run `pnpm --filter @maester/brokers test -- lint`. Expected: FAIL (0 errors).
- [ ] **Step 3:** Extend `eslint.config.js`: spread the shared config, then add the block.
- [ ] **Step 4:** Run `pnpm --filter @maester/brokers test && pnpm --filter @maester/brokers lint`. Expected: PASS, and Kite's plugin is lint-clean.
- [ ] **Step 5: Commit** with `feat(brokers): lint ban on network and file access inside plugins`.

### Task 6: The API on the registry

**Files:**
- Modify:
  - `apps/api/src/routes/brokers.ts`;
  - `apps/api/src/app.ts`, where `brokerDefinitions?: Map<…>` becomes `brokerRegistry?: BrokerRegistry`;
  - `apps/api/src/env.ts` and `.env.example`, which drop `BROKER_DEFINITIONS_DIR`;
  - `apps/api/test/context.ts`, whose deps pick list uses `brokerRegistry`;
  - `packages/contracts/src/brokers.ts`, where `BrokerSummary.signIn` becomes `z.discriminatedUnion("kind", [z.object({ kind: z.literal("redirect") })])`.
- Test: `apps/api/test/brokers.test.ts`.

**Interfaces:**
- Consumes: `defaultRegistry`, `createRegistry`, `loginUrlFor`, `completeSignIn`, `readHoldings`, `toBrokerError` and `BrokerRegistry` from `@maester/brokers`; `fakePlugin` from `@maester/brokers/testing` (Task 3).
- Produces:
  - `brokerRegistry(deps: AppDeps): BrokerRegistry`, which returns `deps.brokerRegistry ?? defaultRegistry()`.
  - `summary(deps, manifest)` with `signIn: { kind: "redirect" }` and `returnUrl` always set.

Route behaviour follows spec §7 and §9:
- `POST …/:broker/session` is removed.
- `connectionOf`, `settingsConnections`, `settingsState`, and the `settings-connection` branches of `PUT`, `accountOf` and `readHoldings` are removed.
- The filter `defs.has(row.broker)` becomes `registry.has(row.broker)`.
- `readHoldings` builds `creds` and `session` as today and calls `readHoldings(plugin, …)` from `@maester/brokers`. Name the route-side function `readAccount` to avoid the clash.

- [ ] **Step 1: Rewrite the tests.**
  - The main describes run with `brokerRegistry: createRegistry([fakePlugin()])`, and `brokerFetch` answers `https://broker.test/profile` and `/holdings`.
  - Keep, with the fake broker:
    - `keeps the key encrypted and names it by its last 4`;
    - `signs in, reads the holdings and sends the investor back to Holdings`;
    - `refuses a return whose state was not issued, or was used already`;
    - a return with no `state` gives `error=SIGN_IN_EXPIRED`;
    - `says when the broker refused the sign-in, and keeps no token`: `/profile` answers 403, and the result is `error=BROKER_REFUSED` with no `token_ciphertext`;
    - `says when the investor cancelled`;
    - `marks the account signed out when the broker refuses the token, and keeps the last read`;
    - `refuses a second read within seconds`;
    - `disconnects`;
    - both `GET /holdings` cases.
  - Delete the Groww and Dhan describes and the Dhan and Groww branches of `brokerFetch`.
  - Add:
    - `lists accounts and holdings without a row whose broker left the registry`: insert a `dhan` `broker_connection` with credentials. The list holds only `fake`, and `/holdings` answers 200 (Review Focus 2).
    - `answers 404 for the return of a broker not in the registry` (Review Focus 3).
    - `refuses PUT and sign-in for a switched-off plugin, but lists and reads the account it already has` (Review Focus 5).
    - `logs no query value from the return route`: no log line contains the return's `token` value.
    - `Kite through the default registry: save, sign in, return and read`: no `brokerRegistry` is injected. It is the current Kite flow, with the current `session` and `holdings` answers.
    - `GET /v1/brokers lists the default registry's brokers`: exactly `["kite"]`, each with `signIn: { kind: "redirect" }`, and no call URLs in the body.
- [ ] **Step 2:** Start the test Postgres (Global Constraints). Run `pnpm --filter @maester/api test -- brokers`. Expected: FAIL, because `brokerRegistry` is not a dep.
- [ ] **Step 3:** Change `routes/brokers.ts`, `app.ts`, `env.ts`, `.env.example`, `test/context.ts` and `BrokerSummary` as listed.
- [ ] **Step 4:** Run `pnpm --filter @maester/api test && pnpm --filter @maester/api typecheck && pnpm --filter @maester/api lint`. Expected: PASS. Then `docker stop maester-pg-plugins`.
- [ ] **Step 5: Commit** with `feat(api): brokers through the plugin registry; drop Settings-connection and direct sign-ins`.

### Task 7: Remove the JSON interpreter and its vocabulary

**Files:**
- Delete:
  - `packages/brokers/definitions/` (all five files);
  - `src/client.ts`, `src/definitions.ts`, `src/template.ts` and `src/built-in.ts`;
  - `test/brokers.test.ts`.
- Modify:
  - `packages/brokers/src/index.ts`, which exports only the kit, `BrokerError`, the contract types, `createRegistry`, `defaultRegistry`, `plugins` and the host functions;
  - `packages/contracts/src/brokers.ts`, which removes `BrokerDefinition`, `BrokerSignIn`, `SettingsConnectionProvider`, `BrokerDerivedValue`, `BrokerHoldingFields`, the `Call` object and `BrokerSessionExpiry`. That last one moves to `kit/expiry.ts` as a plain type if nothing else imports it from contracts.
  - `packages/brokers/README.md`, rewritten: plugins, the kit, the §6 invariants, the §15 recipe and the Kite notes;
  - `docs/systems/packages.md`, where the `@maester/brokers` row becomes "Broker plugins (Kite) behind a host-locked kit and a registry; read-only".

- [ ] **Step 1:** Run `git grep -n "BrokerClient\|builtInDefinitions\|loadDefinitions\|parseDefinition\|BrokerDefinition\|SettingsConnectionProvider\|BROKER_DEFINITIONS_DIR" -- apps packages`. Expected: hits only in the files this task deletes or edits.
- [ ] **Step 2:** Delete and edit as listed.
- [ ] **Step 3:** Run the Step 1 grep again. Expected: no hits outside `docs/`.
- [ ] **Step 4:** Run `pnpm typecheck && pnpm lint`, then `pnpm --filter @maester/brokers test && pnpm --filter @maester/contracts test`, then `pnpm --filter @maester/api test` with the test Postgres. Expected: PASS.
- [ ] **Step 5: Commit** with `refactor(brokers): remove the JSON definitions and their interpreter`.

### Task 8: The web without the Settings-connection and direct branches

This task does not depend on Tasks 1–7; the web has its own types. Use the `svelte-code-writer` skill for the `.svelte` edits.

**Files:**
- Modify:
  - `apps/web/src/lib/holdings/types.ts`, where `BrokerSummary.signIn` is `{ kind: 'redirect' }` only;
  - `apps/web/src/lib/holdings/view.ts`;
  - `apps/web/src/lib/holdings/client.ts`;
  - `apps/web/src/lib/content/holdings.ts`;
  - `apps/web/src/lib/components/holdings/AddBroker.svelte`, `AccountsLedger.svelte` and `HoldingsNudge.svelte`;
  - `docs/DESIGN.md`.
- Test: `apps/web/src/lib/holdings/view.test.ts`.

**Interfaces:**
- Produces: `accountAction(a: BrokerAccount, broker?: BrokerSummary): 'sign_in' | 'read'`.
- Removes:
  - `settingsProvider`;
  - `client.session`;
  - the `copy.settings` group;
  - `copy.add.saveDirect`, `copy.accounts.readDirect`, `copy.nudge.whatDirect` and `copy.table.staleSettings`.
- Keeps: the close notes that say "from your Dhan data".

- [ ] **Step 1: Update the tests.** Delete the Dhan and Groww fixtures and their cases. Keep or add:
  - `accountAction is sign_in for a saved, signed-out or never-signed-in account, and read when signed in`;
  - `accountAction is read for a failing account that signed in and has not signed out`;
  - `staleNote names the broker and the oldest read`.
- [ ] **Step 2:** Run `pnpm --filter @maester/web test -- holdings`. Expected: FAIL, because `accountAction` still returns `'settings'` and `'direct'`, and the types don't narrow.
- [ ] **Step 3:** Edit `types.ts`, `view.ts`, `client.ts` and the copy. In `AddBroker`, remove the `provider` branch, the `direct` save branch and the `Notice` for a missing Settings connection. In `AccountsLedger` and `HoldingsNudge`, remove the `settings` and `direct` actions and the `read(a, true)` path.
- [ ] **Step 4:** Edit `docs/DESIGN.md`:
  - **§5 Accounts ledger:** drop the Dhan sentences ("An account on a Settings connection (Dhan)…").
  - **§5 Add a broker:** drop "A broker on a Settings connection (Dhan)…" and the Notice sentence.
  - **§10 Holdings:** "A broker is a JSON definition the API loads (`packages/brokers/definitions/`, plus `BROKER_DEFINITIONS_DIR`) and serves at `/v1/brokers`" becomes "A broker is a plugin in `packages/brokers/src/plugins/`, and the API serves what its manifest says at `/v1/brokers`".
  - **§10 Holdings, broker list:** "Zerodha (Kite Connect) is the first; Dhan is the second, and it reads…" becomes "Zerodha (Kite Connect) is the one broker for now".
- [ ] **Step 5:** Run `pnpm verify` in `apps/web`, which covers svelte-check with `--fail-on-warnings`, prettier, eslint, vitest and the build. Expected: PASS, with the design guard green.
- [ ] **Step 6: Commit** with `feat(web): Holdings for redirect brokers only; Dhan stays in Settings`.

### Task 9: Whole-branch check and PR

**Files:**
- Modify: `docs/superpowers/specs/2026-10-27-broker-plugins-design.md`. Its status line becomes "built (#<PR>), 2026-10-xx; no live Kite run yet".
- Modify: `docs/decisions/0009-broker-plugins.md`. Its status becomes "accepted <date>, built by #<PR>".
- Modify: `docs/README.md`. The spec row's "not built" becomes "built".

- [ ] **Step 1:** With the test Postgres up and all four `DATABASE_URL_TEST_*` set to it, run `pnpm lint && pnpm typecheck && pnpm test` at the root. Expected: PASS.
- [ ] **Step 2:** Run `git grep -n -i "groww\|upstox\|icici\|settings-connection" -- apps packages`. Expected: no hits outside comments that explain removals. Dhan hits must all be market-data code or close notes.
- [ ] **Step 3:** Update the three docs as listed, then `docker stop maester-pg-plugins`. Confirm with `ps -axo pid,command | grep broker-plugins` that no server is left.
- [ ] **Step 4:** Commit, `gh-git push -u origin feat/broker-plugins`, and run `gh pr create --base staging`. Open items in the body: the live Kite run (needs a public https return URL), and the Angel One plugin (its own session, `docs/research/2026-10-27-angel-one-publisher-login.md`).
