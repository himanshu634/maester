# Ingestion phase 1: the job runner — Implementation Plan

**Status: built.** Merged into `staging` on 20 Oct 2026 as PR #12 (merge commit `8fe0c77`, branch `feat/ingestion-runner`, last commit `e713cc9`). Task 7's live check on the compose stack has not been run; it is the investor's open item (see "As built"). The plan below has been corrected to describe the code that exists.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The worker pulls jobs from the `job` table with a concurrency limit per job type, retries with backoff, recovers jobs whose worker died, and keeps long jobs' leases alive, so many uploaded files process in parallel without exhausting the machine.

**Architecture:** A new dispatch mode, `queue`, becomes the default. `createJob` and `retryJob` keep calling `dispatcher.enqueue`, which now sends `pg_notify('job_ready', type)`. The worker runs one claim loop per job type (single-statement `FOR UPDATE SKIP LOCKED` claim, an in-process limit per type), wakes on `LISTEN job_ready` from a dedicated connection with a poll as a safety net, sweeps expired leases every 30 s, and heartbeats on a timer. The HTTP `/tasks/:type` route stays for `cloud-tasks` mode only. Postgres moves to the pgvector image, which later phases need.

**Tech Stack:** TypeScript, Node, `pg` (node-postgres), Drizzle ORM and drizzle-kit, Hono, Vitest against the Postgres test databases, Docker Compose.

**Spec:** [`docs/superpowers/specs/2026-10-19-ingestion-pipeline-design.md`](../specs/2026-10-19-ingestion-pipeline-design.md) §9 (Parallel processing) and §16 phase 1. Research: [`docs/research/2026-10-19-ingestion-research.md`](../../research/2026-10-19-ingestion-research.md) §5.

## Global Constraints

- Every deadline is computed in SQL with `now()`; never compare `Date.now()` with `lease_expires_at`.
- Backoff after a failed attempt `n` (1-based): `min(900, 30 × 2^(n−1))` seconds, plus up to 20% jitter.
- Default limits per type (`DEFAULT_CONCURRENCY` in `queue.ts`): `document.verify` 4, `document.classify` 2, `document.extract` 2, `document.index` 1 (added by phase 2); any other type with a handler 1. `document.xbrl` 2 is added by its phase.
- Automatic attempts (`maxAttemptsFor` in `packages/jobs/src/create.ts`): `document.classify` and `document.extract` 2, every other type `DEFAULT_MAX_ATTEMPTS` 5. A manual retry gives the job its type's attempts again.
- `NOTIFY` once per enqueue, never per progress write. One listener, its own `pg.Client` (never the pool), serves every loop.
- No transaction is held open while a handler runs.
- Poll interval `JOB_POLL_MS` default 1000; sweep interval `JOB_SWEEP_MS` default 30000; timer heartbeat `JOB_HEARTBEAT_MS` default 15000, at most half of `LEASE_SECONDS` (start-up refuses more); `LEASE_SECONDS` stays 600.
- `EXTRACT_TIMEOUT_SECONDS` default 1800 replaces `EXTRACTOR_TIMEOUT_SECONDS` (900).
- Postgres image `pgvector/pgvector:pg16` in compose and CI, `shm_size: 1gb` in compose.
- `DISPATCH_MODE` is `queue` (default) or `cloud-tasks`; the old value `local` is read as `queue` and the API and the worker log a warning at start.
- No document text, label or figure in any log line (`CLAUDE.md`).
- `docs/systems/*.md` are written in ASD-STE100 Simplified Technical English; keep that style (the `writing-ste` skill).
- The migration took number 0006 (`packages/db/drizzle/0006_job_queue.sql`).

## Review Focus

1. **A worker dies mid-job.** The job's lease expires; the sweeper puts it back to `queued` with backoff, or fails it with `LEASE_EXPIRED` (running `onFinalFailure`) when its attempts are spent. Task 3 (the sweep) and Task 5 (the runner calls the hook).
2. **A notification is missed** (the listener's connection drops, or a job is created while the worker is down). The poll still finds it within `JOB_POLL_MS`, and the listener reconnects. Task 5.
3. **A failed job is retried by hand** (`POST /v1/jobs/:id/retry`). `retryJob` resets `run_after` to now and notifies, so it runs at once rather than after its old backoff. Task 6.
4. **SIGTERM while jobs run.** Loops stop claiming at once; the process waits up to 25 s for running handlers (compose gives the worker `stop_grace_period: 30s`, so Docker does not kill it first), then gives back the lease of any job still running (`releaseLease`: queued, ready now, its attempt restored) and exits. Tests in Task 2 (`releaseLease`) and Task 5 (`stop`); the signal wiring and the live check in Task 7.
5. **A queued job of a type with no handler** (an old type, a typo). No loop claims it, so it stays `queued`; the sweeper does not touch queued rows. The worker logs the queued count per unknown type once at start. Task 7.

## As built

Where the build departed from the first version of this plan. Each Interfaces block and step below already describes the built code; this list says what changed and why.

1. **`stop` gives back running jobs' leases** (`633235f`). The plan left a job still running after the grace to its lease. That made every restart cost the job about 10.5 minutes of waiting and one of its attempts. New `releaseLease(db, jobId, leaseToken): Promise<boolean>` in `lease.ts` puts the job back to `queued`, ready now, with `attempt - 1`, fenced by the token and `state = 'running'`. `startQueueRunner` keeps a `held` map (job id to lease token) and calls it for each job left after `graceMs`.
2. **Two automatic attempts for paid-model job types** (`63e3657`). In queue mode a retryable failure runs again by itself, so a fault that repeats would have cost 5 paid runs per document. `MAX_ATTEMPTS_BY_TYPE` (`document.classify` 2, `document.extract` 2) and `maxAttemptsFor(type)` in `packages/jobs/src/create.ts`; `createJob` sets `max_attempts` from it, and `retryJob` sets `max_attempts = attempt + maxAttemptsFor(type)`. Other types keep `DEFAULT_MAX_ATTEMPTS` (5). The same commit adds `logJobBacklog`: at start the worker logs the queued and running count per type (type and counts only), because its first claims take the whole backlog.
3. **`DISPATCH_MODE=local` is read as `queue`, with a warning** (`ee9b8d1`). The plan removed `local`. An existing `.env` still said `local`, and both env schemas then refused to start (`pnpm dev`, `market:refresh`). Both schemas now map `local` to `queue` before validation (`z.preprocess`); `dispatchModeWarning(source?)` in each `env.ts` returns the warning text, and the API server, the worker server and `market:refresh` log it once at start. An unknown value still fails.
4. **The heartbeat must be at most half the lease** (`38aff12`). `loadWorkerEnv` throws when `JOB_HEARTBEAT_MS * 2 > LEASE_SECONDS * 1000`, because one missed renewal would otherwise let the sweeper hand a running job to another worker.
5. **One listener for all loops** (`ef4c922`, with `a59d450`). One `pg.Client` runs `LISTEN job_ready` for the whole process; it is not one connection per loop. `pgListen` does not hold up start when the database is down: the first failure goes to the reconnect schedule. If `listen` itself rejects, the runner logs it and polls only.
6. **`sweepExpired` works out the backoff in SQL** (`ba7e120`). It uses the same formula and jitter as `backoffSeconds` (`least(900, 30 * power(2, greatest(attempt - 1, 0))) * (1 + 0.2 * random())`) from each row's own attempt, in one statement per outcome, instead of calling `backoffSeconds` row by row. A test pins the per-row attempt.
7. **The runner wakes a loop on three events, not two** (`a59d450`). A loop sleeping with nothing to claim wakes when the poll interval passes, when `job_ready` names its type, or when one of its own jobs finishes (freeing a slot). A notification that arrives while the loop is mid-claim is kept (`pendingWake`) so its next sleep returns at once. A claim that throws is logged, and the loop waits one poll interval and goes on. A job whose execution rejects is logged and never unhandled.
8. **`parseConcurrency` is stricter** (`a59d450`): it also throws for a malformed entry (not `type=limit`) and for a type the worker has no handler for. `DEFAULT_CONCURRENCY` is exported, and holds `document.index` 1 since phase 2.
9. **New `apps/worker/src/start.ts`** (`c95acb8`, `63e3657`): `buildQueueOptions`, `logUnhandledQueued` and `logJobBacklog`, kept out of `server.ts` so they can be tested (`apps/worker/test/app.test.ts`, `env.test.ts`). `server.ts` exits at start with `logger.fatal` when `JOB_CONCURRENCY` is bad.
10. **`verifyDispatchRequest` refuses outside `cloud-tasks`** (`6e3ee99`). The plan only deleted the `local` branch. It now throws `DispatchAuthError("push dispatch is off in queue mode")` in any other mode, as a second guard behind the route not being mounted.
11. **`executeJob` details** (`150ec95`). It exports `JobOutcome`; a job with no handler is failed with `UNKNOWN_JOB_TYPE`; when the lease was lost and the handler then throws, the outcome is `lease_lost` and nothing is written. The handler's own `heartbeat()` (throttled by `HEARTBEAT_THROTTLE_MS`, 5 s) still exists beside the timer.
12. **`pg` becomes a dependency of `apps/worker`** (`@types/pg` as a dev dependency), for `pgListen` (`a59d450`).
13. **The `QueueNotifier` test does not migrate the shared test database** (`ff64bb9`). `pg_notify` needs no table, and migrating `maester_test_db` raced the `@maester/db` tests that turbo runs at the same time.
14. **The disk store's signed URLs are keyed by `BETTER_AUTH_SECRET` alone** (`6e3ee99`). `DISPATCH_SECRET` was not only the dispatch secret: `createStore` in `apps/api/src/store.ts` and the `/dev/blobs` route in `apps/api/src/routes/dev.ts` signed and checked local upload and download URLs with `DISPATCH_SECRET ?? BETTER_AUTH_SECRET`. With `DISPATCH_SECRET` gone, both use `BETTER_AUTH_SECRET`, so the auth secret is now reused as the HMAC key for blob URLs (`apps/api/test/dev.test.ts` builds its store the same way). A setup that never set `DISPATCH_SECRET` sees no change. Where it was set (the old compose file and `.env.example` set it), a link signed before the upgrade stops verifying; such a link lives at most `UPLOAD_URL_TTL_SECONDS` (900 s) for an upload and `DOWNLOAD_URL_TTL_SECONDS` (300 s) for a download. The disk driver is refused in production (`loadEnv`), so the reuse stays on a development machine.

**Open item for the investor: Task 7 Step 5 (live check) has not been run.** No commit or doc records a run on the compose stack. It needs the investor's go-ahead and runs from the main checkout, with an uncommitted override file that takes `EXTRACTOR_URL` away from the worker and keeps the extractor down, so no job reaches Gemini. Its part B (graceful stop and a dead worker) also needs phase 2 Task 13's models volume; without it part B is skipped and the unit tests named there stand as the proof.

**Open for the investor (optional follow-up, not in this plan):** the worker refuses an empty `EXTRACTOR_URL=` (`z.url()` rejects `""`), where the API reads an empty `EMBEDDER_URL` as unset (`.transform((v) => v || undefined)`). Reading an empty `EXTRACTOR_URL` as unset too, with an env test, would let `EXTRACTOR_URL=` turn extraction off. It is a code change; the live check does not need it.

---

### Task 1: Postgres image and the job migration

**Files:**
- Modify: `docker-compose.yml` (service `postgres`: `image`, add `shm_size`)
- Modify: `.github/workflows/ts.yml` (service `postgres` image)
- Modify: `packages/db/src/schema/platform.ts` (the `job` table)
- Create: `packages/db/drizzle/0006_job_queue.sql` (generated, then edited), with the generated `packages/db/drizzle/meta/0006_snapshot.json` and the `meta/_journal.json` entry
- Test: `packages/db/test/migrate.test.ts`

**Interfaces:**
- Produces: column `job.run_after` (`runAfter: Date`, not null, default `now()`); index `job_claimable` on `(type, run_after)` where `state = 'queued'`; index `job_running_lease` on `(lease_expires_at)` where `state = 'running'`; `job_state_lease` dropped; `job` fill factor 80.

**Precondition:** the test databases run on the pgvector image on `localhost:5433`. Recreating the shared Postgres container is the investor's action: from the main checkout, with their go-ahead, `docker compose up -d --force-recreate postgres` (`docs/DEVELOPMENT.md` section 3; the data volume stays, same major version). This task never runs `docker compose up` itself, and never in a worktree.

- [ ] **Step 1: Write the failing test** in `packages/db/test/migrate.test.ts`:

```ts
it("the job table has run_after, the claim indexes and fillfactor 80", async () => {
  const cols = await db.execute(sql`select column_name, is_nullable, column_default from information_schema.columns where table_name = 'job' and column_name = 'run_after'`);
  expect(cols.rows[0]).toMatchObject({ is_nullable: "NO" });
  expect(String(cols.rows[0]!.column_default)).toContain("now()");
  const idx = await db.execute(sql`select indexname, indexdef from pg_indexes where tablename = 'job'`);
  const names = idx.rows.map((r) => r.indexname);
  expect(names).toContain("job_claimable");
  expect(names).toContain("job_running_lease");
  expect(names).not.toContain("job_state_lease");
  expect(idx.rows.find((r) => r.indexname === "job_claimable")!.indexdef).toContain("WHERE (state = 'queued'");
  const opts = await db.execute(sql`select reloptions from pg_class where relname = 'job'`);
  expect(opts.rows[0]!.reloptions).toContain("fillfactor=80");
});
it("the vector extension is available on the image", async () => {
  const rows = await db.execute(sql`select 1 from pg_available_extensions where name = 'vector'`);
  expect(rows.rows).toHaveLength(1);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @maester/db exec vitest run test/migrate.test.ts`
Expected: FAIL on `run_after` (the column does not exist). The `vector` case passes when the precondition holds; it fails only while `localhost:5433` is still the stock `postgres:16` image.

- [ ] **Step 3: Switch the image.** In `docker-compose.yml` set `image: pgvector/pgvector:pg16` and `shm_size: 1gb` on `postgres`; in `.github/workflows/ts.yml` set the service image to `pgvector/pgvector:pg16`. Edit the files only; the container is recreated by the investor (see the precondition).

- [ ] **Step 4: Change the schema and generate the migration.** In `platform.ts`, add `runAfter: ts("run_after").notNull().defaultNow()` to `job`, replace `index("job_state_lease")` with `index("job_claimable").on(t.type, t.runAfter).where(sql\`${t.state} = 'queued'\`)` and `index("job_running_lease").on(t.leaseExpiresAt).where(sql\`${t.state} = 'running'\`)`. Run `pnpm --filter @maester/db generate`, then append `ALTER TABLE "job" SET (fillfactor = 80);` to the generated file (drizzle has no table option for it).

- [ ] **Step 5: Run the test to see it pass**

Run: `pnpm --filter @maester/db exec vitest run test/migrate.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .github/workflows/ts.yml packages/db/src/schema/platform.ts packages/db/drizzle packages/db/test/migrate.test.ts
git commit -m "feat(db): pgvector image, job.run_after, claim indexes and fillfactor 80"
```

---

### Task 2: Claim, backoff and failure with `run_after`

**Files:**
- Modify: `apps/worker/src/lease.ts`
- Test: `apps/worker/test/lease.test.ts`

**Interfaces:**
- Consumes: `job.run_after` (Task 1).
- Produces:
  - `claimNext(db: Db, type: string, leaseSeconds: number): Promise<JobRow | null>`: one statement; takes the oldest `queued` job of `type` whose `run_after <= now()`, by `run_after` then `created_at`, `FOR UPDATE SKIP LOCKED`; sets `state = 'running'`, a new `lease_token`, `lease_expires_at = now() + leaseSeconds`, `attempt = attempt + 1`, `started_at = coalesce(started_at, now())`; returns the row as `JobRow` (Date fields, camelCase).
  - `backoffSeconds(attempt: number, random: () => number = Math.random): number`: `min(900, 30 × 2^(attempt−1)) × (1 + 0.2 × random())`.
  - `failAttempt(db: Db, job: JobRow, leaseToken: string, err: { code: string; message: string }, final: boolean): Promise<void>` (existing signature): when not final also sets `run_after = now() + make_interval(secs => backoffSeconds(job.attempt))`.
  - `acquireLease` stays for `cloud-tasks` mode, unchanged.
  - `releaseLease(db: Db, jobId: string, leaseToken: string): Promise<boolean>` (added after review, `633235f`): sets `state = 'queued'`, `run_after = now()`, `attempt = attempt - 1`, clears the lease; only where `lease_token` matches and `state = 'running'`; returns whether a row changed.
  - `renewLease`, `writeProgress` and `completeJob` are unchanged.

- [ ] **Step 1: Write the failing tests** in `apps/worker/test/lease.test.ts`:

```ts
it("claimNext gives each of many concurrent claimers a different job, and none twice", async () => {
  const { workspaceId } = await seedWorkspace(ctx.db);
  const ids = await Promise.all(Array.from({ length: 5 }, () => seedJob(ctx.db, workspaceId, { type: "test.claim" })));
  const claimed = await Promise.all(Array.from({ length: 8 }, () => claimNext(ctx.db, "test.claim", 600)));
  const got = claimed.filter(Boolean).map((j) => j!.id);
  expect(new Set(got).size).toBe(5);
  expect(got.sort()).toEqual(ids.sort());
});
it("claimNext skips a job whose run_after is in the future and jobs of other types", async () => {
  const { workspaceId } = await seedWorkspace(ctx.db);
  await seedJob(ctx.db, workspaceId, { type: "test.later", runAfter: new Date(Date.now() + 60_000) });
  await seedJob(ctx.db, workspaceId, { type: "test.other" });
  expect(await claimNext(ctx.db, "test.later", 600)).toBeNull();
});
it("claimNext takes the earliest run_after first", async () => {
  const { workspaceId } = await seedWorkspace(ctx.db);
  const late = await seedJob(ctx.db, workspaceId, { type: "test.order", runAfter: new Date(Date.now() - 1_000) });
  const early = await seedJob(ctx.db, workspaceId, { type: "test.order", runAfter: new Date(Date.now() - 60_000) });
  expect((await claimNext(ctx.db, "test.order", 600))!.id).toBe(early);
  expect((await claimNext(ctx.db, "test.order", 600))!.id).toBe(late);
});
it("backoffSeconds doubles from 30 s and stops at 900 s, with at most 20% jitter", () => {
  expect(backoffSeconds(1, () => 0)).toBe(30);
  expect(backoffSeconds(2, () => 0)).toBe(60);
  expect(backoffSeconds(6, () => 0)).toBe(900);
  expect(backoffSeconds(9, () => 0)).toBe(900);
  expect(backoffSeconds(1, () => 1)).toBe(36);
});
it("a retryable failure puts the job back with run_after in the future", async () => {
  const { workspaceId } = await seedWorkspace(ctx.db);
  await seedJob(ctx.db, workspaceId, { type: "test.fail" });
  const job = (await claimNext(ctx.db, "test.fail", 600))!;
  await failAttempt(ctx.db, job, job.leaseToken!, { code: "X", message: "x" }, false);
  const [row] = await ctx.db.execute(sql`select state, run_after > now() + interval '25 seconds' as later from job where id = ${job.id}`).then((r) => r.rows);
  expect(row).toMatchObject({ state: "queued", later: true });
});
it("releaseLease gives a held job back with its attempt restored, only for the holder", async () => {
  const { workspaceId } = await seedWorkspace(ctx.db);
  const id = await seedJob(ctx.db, workspaceId, { runAfter: new Date(Date.now() - 60_000) });
  const held = (await acquireLease(ctx.db, id, 600))!;
  expect(held.attempt).toBe(1);
  expect(await releaseLease(ctx.db, id, crypto.randomUUID())).toBe(false);
  const [untouched] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
  expect(untouched).toMatchObject({ state: "running", attempt: 1, leaseToken: held.leaseToken });
  expect(await releaseLease(ctx.db, id, held.leaseToken!)).toBe(true);
  const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
  expect(row).toMatchObject({ state: "queued", attempt: 0, leaseToken: null, leaseExpiresAt: null });
  expect(Math.abs(row!.runAfter.getTime() - Date.now())).toBeLessThan(5_000);
  expect(await releaseLease(ctx.db, id, held.leaseToken!)).toBe(false);
  // A job no longer running is left alone, even with its old token.
  await ctx.db.update(schema.job).set({ state: "succeeded", leaseToken: held.leaseToken }).where(eq(schema.job.id, id));
  expect(await releaseLease(ctx.db, id, held.leaseToken!)).toBe(false);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @maester/worker exec vitest run test/lease.test.ts`
Expected: FAIL: `claimNext`, `backoffSeconds` and `releaseLease` are not exported.

- [ ] **Step 3: Implement** `claimNext`, `backoffSeconds`, `releaseLease` and the `failAttempt` change in `apps/worker/src/lease.ts`. As built, the claim is Drizzle's `db.update(schema.job).set(…).where(sql\`id = (select id from job where type = … and state = 'queued' and run_after <= now() order by run_after, created_at for update skip locked limit 1)\`).returning()`, which returns typed rows (a test pins the Date fields and camelCase).

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @maester/worker exec vitest run test/lease.test.ts`
Expected: PASS, with the existing lease tests still passing.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/lease.ts apps/worker/test/lease.test.ts
git commit -m "feat(worker): claim the next ready job by type with SKIP LOCKED; retry backoff"
```

---

### Task 3: The expired-lease sweeper

**Files:**
- Modify: `apps/worker/src/lease.ts`
- Test: `apps/worker/test/lease.test.ts`

**Interfaces:**
- Consumes: `backoffSeconds` (Task 2).
- Produces: `sweepExpired(db: Db): Promise<{ requeued: JobRow[]; failed: JobRow[] }>`: every `running` job with `lease_expires_at < now()` goes to `queued` with `run_after = now() + backoff(attempt)` and `last_error_code = 'LEASE_EXPIRED'`, or, when `attempt >= max_attempts`, to `failed` with `finished_at = now()` and the same code; lease token and expiry cleared. One statement per outcome, each guarded by `lease_expires_at < now()` so a job renewed meanwhile is untouched. The backoff is worked out in SQL from each row's own attempt, with the formula and jitter of `backoffSeconds`: `least(900, 30 * power(2, greatest(attempt - 1, 0))) * (1 + 0.2 * random())`. Both statements return the changed rows.

- [ ] **Step 1: Write the failing tests**:

```ts
it("sweepExpired requeues a running job whose lease expired, with backoff", async () => {
  const { workspaceId } = await seedWorkspace(ctx.db);
  const id = await seedJob(ctx.db, workspaceId, { state: "running", attempt: 1, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() - 1_000) });
  const out = await sweepExpired(ctx.db);
  expect(out.requeued.map((j) => j.id)).toContain(id);
  const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
  expect(row).toMatchObject({ state: "queued", leaseToken: null, lastErrorCode: "LEASE_EXPIRED" });
  expect(row!.runAfter.getTime()).toBeGreaterThan(Date.now() + 20_000);
});
it("sweepExpired fails a job whose attempts are spent", async () => {
  const { workspaceId } = await seedWorkspace(ctx.db);
  const id = await seedJob(ctx.db, workspaceId, { state: "running", attempt: 5, maxAttempts: 5, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() - 1_000) });
  const out = await sweepExpired(ctx.db);
  expect(out.failed.map((j) => j.id)).toContain(id);
  const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
  expect(row).toMatchObject({ state: "failed", leaseToken: null, leaseExpiresAt: null, lastErrorCode: "LEASE_EXPIRED" });
  expect(row!.finishedAt).not.toBeNull();
});
it("sweepExpired leaves live leases and queued jobs alone", async () => {
  const { workspaceId } = await seedWorkspace(ctx.db);
  const live = await seedJob(ctx.db, workspaceId, { state: "running", attempt: 1, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) });
  const queued = await seedJob(ctx.db, workspaceId);
  const out = await sweepExpired(ctx.db);
  expect([...out.requeued, ...out.failed].map((j) => j.id)).not.toContain(live);
  expect([...out.requeued, ...out.failed].map((j) => j.id)).not.toContain(queued);
});
it("sweepExpired backs off by each job's own attempt count", async () => {
  const { workspaceId } = await seedWorkspace(ctx.db);
  const expired = () => ({ state: "running" as const, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() - 1_000) });
  const first = await seedJob(ctx.db, workspaceId, { ...expired(), attempt: 1 });
  const third = await seedJob(ctx.db, workspaceId, { ...expired(), attempt: 3 });
  await sweepExpired(ctx.db);
  const [a] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, first));
  const [b] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, third));
  // attempt 1 waits 30-36 s, attempt 3 waits 120-144 s
  expect(a!.runAfter.getTime()).toBeLessThan(Date.now() + 50_000);
  expect(b!.runAfter.getTime()).toBeGreaterThan(Date.now() + 100_000);
});
```

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @maester/worker exec vitest run test/lease.test.ts` — FAIL: `sweepExpired` is not exported.

- [ ] **Step 3: Implement `sweepExpired`** in `lease.ts`.

- [ ] **Step 4: Run to see them pass** — same command — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/lease.ts apps/worker/test/lease.test.ts
git commit -m "feat(worker): sweep expired leases back to queued, or fail them when attempts are spent"
```

---

### Task 4: Run a leased job, with a timer heartbeat

**Files:**
- Modify: `apps/worker/src/run.ts`
- Modify: `apps/worker/src/env.ts` (`JOB_HEARTBEAT_MS` and the half-lease check)
- Test: `apps/worker/test/run.test.ts`, `apps/worker/test/env.test.ts`

**Interfaces:**
- Consumes: `failAttempt` with backoff (Task 2).
- Produces:
  - `type JobOutcome = "succeeded" | "failed" | "retry" | "lease_lost"` (exported).
  - `executeJob(deps: WorkerDeps, job: JobRow, opts: { heartbeatMs?: number } = {}): Promise<{ outcome: JobOutcome }>`: runs the handler for an already-leased job (the body of today's `runJob` after `acquireLease`), with a `setInterval` every `heartbeatMs` (default `env.JOB_HEARTBEAT_MS`) calling `renewLease`, cleared in `finally`. When a renewal returns `false`, the timer stops and the outcome after the handler returns is `lease_lost` (completion is already fenced by the token); if the handler throws after the lease was lost, nothing is written and the outcome is `lease_lost`. A job whose type has no handler is failed at once with `UNKNOWN_JOB_TYPE`. The timer skips a tick while a renewal is still in flight and is `unref`'d. The handler's own `ctx.heartbeat()` (throttled by `HEARTBEAT_THROTTLE_MS`, 5 s) stays.
  - `runJob(deps: WorkerDeps, type: string, jobId: string): Promise<RunResult>` (unchanged signature, used by the `/tasks` route): `acquireLease`, then `executeJob`; `retry` maps to status 500, every other outcome to 200, a lease held elsewhere to 409.
  - `WorkerEnv` gains `JOB_HEARTBEAT_MS` (positive integer, default 15000). `loadWorkerEnv` throws when `JOB_HEARTBEAT_MS * 2 > LEASE_SECONDS * 1000`.

- [ ] **Step 1: Write the failing tests** in `apps/worker/test/run.test.ts`:

```ts
it("executeJob renews the lease on a timer while a quiet handler runs", async () => {
  let seen: Date | null = null;
  const handler: JobHandler = async (job, ctx) => {
    await new Promise((r) => setTimeout(r, 250)); // no heartbeat() call from the handler
    const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, job.id));
    seen = row!.leaseExpiresAt;
    return { ok: true };
  };
  const c = await createWorkerContext({ "test.quiet": handler }); // LEASE_SECONDS 600
  const { workspaceId } = await seedWorkspace(c.db);
  await seedJob(c.db, workspaceId, { type: "test.quiet" });
  const job = (await claimNext(c.db, "test.quiet", 1))!; // claimed with a 1-second lease
  const out = await executeJob(c, job, { heartbeatMs: 50 });
  expect(out.outcome).toBe("succeeded");
  expect(seen!.getTime()).toBeGreaterThan(job.leaseExpiresAt!.getTime() + 60_000); // renewed to LEASE_SECONDS
  await c.close();
});
it("executeJob reports lease_lost when another worker took the job", async () => {
  const c = await createWorkerContext({ "test.slow": async (job, ctx) => { await ctx.db.update(schema.job).set({ leaseToken: crypto.randomUUID() }).where(eq(schema.job.id, job.id)); await new Promise((r) => setTimeout(r, 120)); } });
  const { workspaceId } = await seedWorkspace(c.db);
  await seedJob(c.db, workspaceId, { type: "test.slow" });
  const job = (await claimNext(c.db, "test.slow", 600))!;
  expect((await executeJob(c, job, { heartbeatMs: 30 })).outcome).toBe("lease_lost");
  await c.close();
});
```

Add to `apps/worker/test/env.test.ts` (`38aff12`), over the file's existing `base` environment:

```ts
it("refuses a heartbeat that does not renew well inside the lease", () => {
  expect(() => loadWorkerEnv({ ...base, LEASE_SECONDS: "10" })).toThrow(/JOB_HEARTBEAT_MS/); // the default 15000 is more than half of 10 s
  expect(() => loadWorkerEnv({ ...base, LEASE_SECONDS: "10", JOB_HEARTBEAT_MS: "5001" })).toThrow(/JOB_HEARTBEAT_MS/);
  expect(loadWorkerEnv({ ...base, LEASE_SECONDS: "10", JOB_HEARTBEAT_MS: "5000" }).JOB_HEARTBEAT_MS).toBe(5000);
});
```

Keep every existing `run.test.ts` case passing through `runJob`.

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @maester/worker exec vitest run test/run.test.ts test/env.test.ts` — FAIL: `executeJob` is not exported, and the heartbeat check does not exist.

- [ ] **Step 3: Implement** `executeJob` and rewrite `runJob` over it; add `JOB_HEARTBEAT_MS` and the half-lease check to `env.ts`.

- [ ] **Step 4: Run to see them pass** — same command — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/run.ts apps/worker/src/env.ts apps/worker/test/run.test.ts apps/worker/test/env.test.ts
git commit -m "feat(worker): execute a leased job with a timer heartbeat; runJob uses it"
```

---

### Task 5: The queue runner: one loop per type, a limit, a listener, a poll

**Files:**
- Create: `apps/worker/src/queue.ts`
- Modify: `apps/worker/src/env.ts`
- Modify: `apps/worker/package.json` (`pg`, `@types/pg`), `pnpm-lock.yaml`
- Modify: `apps/worker/test/context.ts` (the `waitFor` and `countState` helpers)
- Test: `apps/worker/test/queue.test.ts`

**Interfaces:**
- Consumes: `claimNext` and `releaseLease` (Task 2), `sweepExpired` (Task 3), `executeJob` (Task 4).
- Produces:
  - `DEFAULT_CONCURRENCY: Readonly<Record<string, number>>` (the limits in Global Constraints) and `type Listen = (onReady: (type: string) => void) => Promise<() => Promise<void>>`, both exported.
  - `parseConcurrency(spec: string | undefined, types: string[]): Record<string, number>`: `"document.extract=3,document.verify=8"` over the defaults; any other type 1; throws for an entry that is not `type=limit`, for a type not in `types`, and for a limit below 1 or not a whole number.
  - `interface QueueRunnerOptions { concurrency: Record<string, number>; pollMs: number; sweepMs: number; listen: Listen }` and `interface QueueRunner { stop(graceMs: number): Promise<void>; running(): Record<string, number> }` (both exported).
  - `startQueueRunner(deps: WorkerDeps, opts: QueueRunnerOptions): QueueRunner`: for each type in `deps.handlers`, a loop that, while running jobs of that type are below its limit, calls `claimNext` and starts `executeJob` without awaiting it; with nothing to claim, or at its limit, the loop sleeps until `pollMs` passes, `onReady(type)` fires or one of its jobs finishes. A notification that comes while the loop is mid-claim is kept for its next sleep. A claim that throws is logged and the loop waits `pollMs`; a rejected `executeJob` is logged. A sweep runs every `sweepMs`; for each `failed` job it calls the handler's `onFinalFailure`. If `listen` rejects the runner logs it and polls only.
  - `stop(graceMs)` stops claiming at once, wakes every sleeper, closes the listener, and waits up to `graceMs` for running jobs. A job still running after that is given back with `releaseLease` (Task 2) using the token the runner holds for it, and the runner logs which were released and which kept. `stop` resolves even if handlers are still running, and a second call shares the first's shutdown.
  - `pgListen(connectionString: string, logger: Logger): Listen`: the `listen` implementation. Called with `onReady`, it opens one dedicated `pg.Client` for the whole process (`application_name: "maester-job-listener"`), runs `LISTEN job_ready`, calls `onReady(payload)` for each notification, and on error or end reconnects after 1 s (doubling to at most 30 s, reset on success), logging each reconnect. It resolves even when the first connect fails (the failure goes to the retry schedule), and to a close function that stops retrying.
  - `WorkerEnv` gains `JOB_CONCURRENCY` (optional string), `JOB_POLL_MS` (positive integer, 1000), `JOB_SWEEP_MS` (positive integer, 30000).
  - `apps/worker/package.json` gains `pg` `^8.16.0` (dependency) and `@types/pg` `^8.15.0` (dev dependency).

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @maester/worker add pg@^8.16.0` and `pnpm --filter @maester/worker add -D @types/pg@^8.15.0`
Expected: `apps/worker/package.json` lists `"pg": "^8.16.0"` under `dependencies` and `"@types/pg": "^8.15.0"` under `devDependencies`, and `pnpm-lock.yaml` changes with it, so CI's frozen install still passes.

- [ ] **Step 2: Write the failing tests** in `apps/worker/test/queue.test.ts`:

```ts
it("never runs more jobs of a type at once than its limit, and finishes them all", async () => {
  let now = 0, peak = 0;
  const handler: JobHandler = async () => { now++; peak = Math.max(peak, now); await new Promise((r) => setTimeout(r, 40)); now--; };
  const c = await createWorkerContext({ "test.limited": handler });
  const { workspaceId } = await seedWorkspace(c.db);
  await Promise.all(Array.from({ length: 20 }, () => seedJob(c.db, workspaceId, { type: "test.limited" })));
  const runner = startQueueRunner(c, { concurrency: { "test.limited": 2 }, pollMs: 20, sweepMs: 60_000, listen: async () => async () => {} });
  await waitFor(async () => (await countState(c.db, "succeeded", "test.limited")) === 20, 10_000);
  await runner.stop(1_000);
  expect(peak).toBe(2);
  await c.close();
});
it("a notification wakes an idle loop before the poll would", async () => {
  let fire: (t: string) => void = () => {};
  const c = await createWorkerContext({ "test.wake": async () => {} });
  const { workspaceId } = await seedWorkspace(c.db);
  const runner = startQueueRunner(c, { concurrency: {}, pollMs: 60_000, sweepMs: 60_000, listen: async (onReady) => { fire = onReady; return async () => {}; } });
  await new Promise((r) => setTimeout(r, 50));
  await seedJob(c.db, workspaceId, { type: "test.wake" });
  fire("test.wake");
  await waitFor(async () => (await countState(c.db, "succeeded", "test.wake")) === 1, 2_000);
  await runner.stop(1_000);
  await c.close();
});
it("a job left running by a dead worker is swept and run again", async () => {
  const c = await createWorkerContext({ "test.orphan": async () => ({ ok: true }) });
  const { workspaceId } = await seedWorkspace(c.db);
  await seedJob(c.db, workspaceId, { type: "test.orphan", state: "running", attempt: 1, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() - 1_000) });
  await c.db.execute(sql`update job set run_after = now() where type = 'test.orphan'`); // backoff skipped for the test
  const runner = startQueueRunner(c, { concurrency: {}, pollMs: 20, sweepMs: 30, listen: async () => async () => {} });
  await waitFor(async () => {
    await c.db.execute(sql`update job set run_after = now() where type = 'test.orphan' and state = 'queued'`);
    return (await countState(c.db, "succeeded", "test.orphan")) === 1;
  }, 5_000);
  await runner.stop(1_000);
  await c.close();
});
it("parseConcurrency applies overrides over defaults and refuses bad values", () => {
  expect(parseConcurrency("document.extract=3", ["document.extract", "document.verify", "test.x"])).toEqual({ "document.extract": 3, "document.verify": 4, "test.x": 1 });
  expect(() => parseConcurrency("document.extract=0", ["document.extract"])).toThrow();
  expect(() => parseConcurrency("document.extract=two", ["document.extract"])).toThrow();
});
```

`waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number, intervalMs = 20): Promise<void>` and `countState(db: Db, state: string, type: string): Promise<number>` are small helpers added to `apps/worker/test/context.ts`. Three more live in `queue.test.ts`: `noListen: Listen` (`async () => async () => {}`), `captureLogger(): { logger, lines }` (pino at `debug`, each JSON line parsed into `lines`) and `flakyDb(db: Db, method: "update", failures: number): Db` (a `Proxy` whose first `failures` calls to `db.update` throw `Error("connection refused")`). The cases below close the context, and stop a runner still running, in a `finally` that is left out here.

The final-failure hook, a failing claim and a rejecting execution (Review Focus 1, As built item 7):

```ts
it("a job swept with its attempts spent is failed and its handler's final-failure hook runs", async () => {
  const finals: JobRow[] = [];
  const handler: JobHandler = Object.assign(async () => {}, { onFinalFailure: async (job: JobRow) => void finals.push(job) });
  const throwing: JobHandler = Object.assign(async () => {}, { onFinalFailure: async () => { throw new Error("hook broke"); } });
  const { logger, lines } = captureLogger();
  const c = await createWorkerContext({ "test.spent": handler, "test.spent.hook": throwing }, { logger });
  const runner = startQueueRunner(c, { concurrency: {}, pollMs: 20, sweepMs: 30, listen: noListen });
  const { workspaceId } = await seedWorkspace(c.db);
  const expired = { state: "running" as const, attempt: 5, maxAttempts: 5, leaseExpiresAt: new Date(Date.now() - 1_000) };
  const id = await seedJob(c.db, workspaceId, { type: "test.spent", leaseToken: crypto.randomUUID(), ...expired });
  await seedJob(c.db, workspaceId, { type: "test.spent.hook", leaseToken: crypto.randomUUID(), ...expired });
  await waitFor(() => finals.length === 1 && lines.some((l) => l.msg === "final-failure hook failed"), 5_000);
  expect(finals[0]!.id).toBe(id);
  expect(finals[0]!.lastErrorCode).toBe("LEASE_EXPIRED");
  expect(await countState(c.db, "failed", "test.spent")).toBe(1);
});
it("a claim that throws is logged and the loop carries on after the poll interval", async () => {
  const { logger, lines } = captureLogger();
  const c = await createWorkerContext({ "test.flaky": async () => {} }, { logger });
  const runner = startQueueRunner({ ...c, db: flakyDb(c.db, "update", 2) }, { concurrency: {}, pollMs: 20, sweepMs: 60_000, listen: noListen });
  const { workspaceId } = await seedWorkspace(c.db);
  await seedJob(c.db, workspaceId, { type: "test.flaky" });
  await waitFor(async () => (await countState(c.db, "succeeded", "test.flaky")) === 1, 5_000);
  expect(lines.filter((l) => l.msg === "claim failed")).toHaveLength(2);
  expect(lines.find((l) => l.msg === "claim failed")).toMatchObject({ type: "test.flaky", err: "connection refused" });
});
it("a job whose execution rejects is logged, never unhandled, and the loop goes on", async () => {
  const { logger, lines } = captureLogger();
  const c = await createWorkerContext({}, { logger });
  let updates = 0; // the claim's update passes; the second (failAttempt's) throws, so executeJob rejects
  const db = new Proxy(c.db, { get: (t, p, r) => (p === "update" && ++updates === 2 ? () => { throw new Error("db gone"); } : Reflect.get(t, p, r)) });
  const handlers: Record<string, JobHandler> = { "test.reject": async () => { throw new JobFailure("BOOM", "boom", false); } };
  const { workspaceId } = await seedWorkspace(c.db);
  await seedJob(c.db, workspaceId, { type: "test.reject" });
  await seedJob(c.db, workspaceId, { type: "test.reject" });
  const runner = startQueueRunner({ ...c, db, handlers }, { concurrency: {}, pollMs: 20, sweepMs: 60_000, listen: noListen });
  await waitFor(() => lines.some((l) => l.msg === "job execution threw"), 5_000);
  await waitFor(async () => (await countState(c.db, "failed", "test.reject")) === 1, 5_000);
  expect(lines.find((l) => l.msg === "job execution threw")).toMatchObject({ type: "test.reject", err: "db gone" });
  expect(runner.running()).toEqual({ "test.reject": 0 });
});
```

`stop`: the grace, the give-back and the wake-up (Review Focus 4):

```ts
it("stop claims nothing more, waits for running jobs, and gives up after the grace period", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  let started = 0;
  const c = await createWorkerContext({ "test.slow": async () => { started++; await gate; } });
  const runner = startQueueRunner(c, { concurrency: { "test.slow": 1 }, pollMs: 20, sweepMs: 60_000, listen: noListen });
  const { workspaceId } = await seedWorkspace(c.db);
  await Promise.all(Array.from({ length: 3 }, () => seedJob(c.db, workspaceId, { type: "test.slow" })));
  await waitFor(() => started === 1, 5_000);
  const t0 = Date.now();
  await runner.stop(100); // the job is held at the gate: stop resolves anyway, and gives its lease back
  expect(Date.now() - t0).toBeLessThan(1_000);
  expect(runner.running()).toEqual({ "test.slow": 1 });
  expect(await countState(c.db, "queued", "test.slow")).toBe(3);
  release();
  await waitFor(() => runner.running()["test.slow"] === 0, 5_000);
  expect(started).toBe(1); // nothing more was claimed
  expect(await countState(c.db, "succeeded", "test.slow")).toBe(0); // the late finish is fenced out by the old token
  expect(await countState(c.db, "queued", "test.slow")).toBe(3);
});
it("stop(500) waits for a 200 ms job to finish", async () => {
  let started = 0, finished = 0;
  const c = await createWorkerContext({ "test.short": async () => { started++; await new Promise((r) => setTimeout(r, 200)); finished++; } });
  const runner = startQueueRunner(c, { concurrency: {}, pollMs: 20, sweepMs: 60_000, listen: noListen });
  const { workspaceId } = await seedWorkspace(c.db);
  await seedJob(c.db, workspaceId, { type: "test.short" });
  await waitFor(() => started === 1, 5_000);
  const t0 = Date.now();
  await runner.stop(500);
  expect(finished).toBe(1);
  expect(Date.now() - t0).toBeLessThan(500);
  expect(await countState(c.db, "succeeded", "test.short")).toBe(1);
});
it("stop(500) gives up at about 500 ms on a 2 s job and gives it back with its attempt restored", async () => {
  let started = 0, finished = 0;
  const c = await createWorkerContext({ "test.long": async () => { started++; await new Promise((r) => setTimeout(r, 2_000)); finished++; } });
  const runner = startQueueRunner(c, { concurrency: {}, pollMs: 20, sweepMs: 60_000, listen: noListen });
  const { workspaceId } = await seedWorkspace(c.db);
  await seedJob(c.db, workspaceId, { type: "test.long" });
  await waitFor(() => started === 1, 5_000);
  const t0 = Date.now();
  await runner.stop(500);
  const took = Date.now() - t0;
  expect(took).toBeGreaterThanOrEqual(450);
  expect(took).toBeLessThan(1_000);
  expect(finished).toBe(0);
  const job = async () => (await c.db.execute(sql`select state, attempt, lease_token, lease_expires_at, run_after <= now() as ready from job where type = 'test.long'`)).rows[0];
  expect(await job()).toEqual({ state: "queued", attempt: 0, lease_token: null, lease_expires_at: null, ready: true });
  await waitFor(() => finished === 1, 5_000); // the handler still finishes in this process,
  await waitFor(() => runner.running()["test.long"] === 0, 5_000);
  expect(await job()).toMatchObject({ state: "queued", attempt: 0 }); // but its old token no longer completes the job
});
it("stop wakes loops mid-sleep and closes the listener", async () => {
  let closed = false;
  const c = await createWorkerContext({ "test.idle": async () => {} });
  const runner = startQueueRunner(c, { concurrency: {}, pollMs: 60_000, sweepMs: 60_000, listen: async () => async () => { closed = true; } });
  await new Promise((r) => setTimeout(r, 50));
  const t0 = Date.now();
  await runner.stop(5_000);
  expect(Date.now() - t0).toBeLessThan(1_000);
  expect(closed).toBe(true);
});
```

The stricter `parseConcurrency` (As built item 8; `document.index` is phase 2's):

```ts
it("runs document.index one at a time by default", () => {
  expect(parseConcurrency(undefined, ["document.index"])).toEqual({ "document.index": 1 });
});
it("uses the defaults when unset, reads several overrides, and refuses malformed entries", () => {
  expect(DEFAULT_CONCURRENCY).toEqual({ "document.verify": 4, "document.classify": 2, "document.extract": 2, "document.index": 1 });
  expect(parseConcurrency(undefined, ["document.classify", "test.x"])).toEqual({ "document.classify": 2, "test.x": 1 });
  expect(parseConcurrency(" document.extract=3 , document.verify=8 ", ["document.extract", "document.verify"])).toEqual({ "document.extract": 3, "document.verify": 8 });
  for (const bad of ["document.extract=1.5", "document.extract=-2", "document.extract"]) expect(() => parseConcurrency(bad, ["document.extract"])).toThrow();
  expect(() => parseConcurrency("document.extrct=3", ["document.extract"])).toThrow(/document\.extrct/);
});
```

`pgListen` against the real test database, and with the database unreachable (Review Focus 2, As built item 5):

```ts
it("hears job_ready, and hears it again after its connection is killed", async () => {
  const c = await createWorkerContext();
  const name = `qtest-${crypto.randomUUID().slice(0, 8)}`; // the URL's application_name wins over the client's own, so the test can find the backend
  const url = c.env.DATABASE_URL + (c.env.DATABASE_URL.includes("?") ? "&" : "?") + `application_name=${name}`;
  const pids = async () => (await c.db.execute<{ pid: number }>(sql`select pid from pg_stat_activity where application_name = ${name}`)).rows.map((r) => r.pid);
  const { logger, lines } = captureLogger();
  const heard: string[] = [];
  const close = await pgListen(url, logger)((type) => heard.push(type));
  await c.db.execute(sql`select pg_notify('job_ready', 'test.real')`);
  await waitFor(() => heard.includes("test.real"), 2_000);
  const before = await pids();
  expect(before).toHaveLength(1);
  await c.db.execute(sql`select pg_terminate_backend(${before[0]!})`);
  await waitFor(async () => { // notify until the reconnected listener hears it, rather than sleeping a fixed time
    await c.db.execute(sql`select pg_notify('job_ready', 'test.real.again')`);
    return heard.includes("test.real.again");
  }, 10_000, 200);
  expect(lines.some((l) => l.msg === "job listener lost; reconnecting" && l.retryInMs === 1_000)).toBe(true);
  const after = await pids();
  expect(after).toHaveLength(1);
  expect(after[0]).not.toBe(before[0]);
  await close();
  await waitFor(async () => (await pids()).length === 0, 5_000);
});
it("resolves when the database is unreachable, keeps retrying, and stops when closed", async () => {
  const { logger, lines } = captureLogger();
  const close = await pgListen("postgres://maester:maester@127.0.0.1:1/none", logger)(() => {});
  expect(lines.filter((l) => l.msg === "job listener lost; reconnecting")).toHaveLength(1);
  await close();
  await new Promise((r) => setTimeout(r, 1_200));
  expect(lines.filter((l) => l.msg === "job listener lost; reconnecting")).toHaveLength(1);
});
```

- [ ] **Step 3: Run to see them fail** — `pnpm --filter @maester/worker exec vitest run test/queue.test.ts` — FAIL: `../src/queue.js` does not exist, so every case fails, the `stop` and `pgListen` cases included.

- [ ] **Step 4: Implement** `apps/worker/src/queue.ts` and the env additions.

- [ ] **Step 5: Run all queue tests to see them pass** — same command — PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/queue.ts apps/worker/src/env.ts apps/worker/test/queue.test.ts apps/worker/test/context.ts apps/worker/package.json pnpm-lock.yaml
git commit -m "feat(worker): queue runner with a limit per job type, LISTEN wake-up, poll and sweep"
```

---

### Task 6: Enqueue by notifying, in the API and the worker

**Files:**
- Modify: `packages/jobs/src/dispatch.ts` (add `QueueNotifier`, delete `LocalHttpDispatcher`), `packages/jobs/src/create.ts` (`MAX_ATTEMPTS_BY_TYPE`, `maxAttemptsFor`, `createJob`'s `max_attempts`), `packages/jobs/src/index.ts` (exports)
- Modify: `apps/api/src/dispatch/index.ts`, `apps/api/src/env.ts`, `apps/api/src/server.ts` (`createDispatcher` gets `db`; logs the alias warning)
- Modify: `apps/api/src/store.ts` and `apps/api/src/routes/dev.ts` (the disk store signs and checks blob URLs with `BETTER_AUTH_SECRET` alone; As built item 14)
- Modify: `apps/api/src/jobs/create.ts` (`retryJob` resets `run_after` and `max_attempts`)
- Modify: `apps/worker/src/dispatch.ts`, `apps/worker/src/env.ts`, `apps/worker/src/auth.ts`, `apps/worker/src/server.ts` (`createDispatcher` gets `db`; logs the alias warning), `apps/worker/src/market/run-once.ts` (the `market:refresh` CLI logs the alias warning)
- Test: `packages/jobs/test/dispatch.test.ts`, `packages/jobs/test/create.test.ts`, `apps/api/test/jobs.test.ts`, `apps/api/test/dispatch.test.ts`, `apps/api/test/env.test.ts`, `apps/api/test/dev.test.ts` (its store is built with `BETTER_AUTH_SECRET`), `apps/worker/test/env.test.ts`, `apps/worker/test/run.test.ts` (the two local-secret cases become "refuses pushed jobs in queue mode": 401, the job stays `queued`)
- Fixtures: `apps/api/test/env.ts`, `apps/worker/test/context.ts`, `apps/worker/test/market-refresh-cli.test.ts` (`DISPATCH_MODE: "local"` becomes `"queue"`; `DISPATCH_SECRET` goes)

**Interfaces:**
- Produces:
  - `class QueueNotifier implements Dispatcher { constructor(db: Db) }`: `enqueue(job)` runs `select pg_notify('job_ready', ${job.type})` on a pool connection. Callers enqueue after their transaction commits, as `decideIntake` already does; a notify sent too early only costs a poll interval, because the poll finds the job anyway.
  - `DISPATCH_MODE` becomes `z.preprocess((v) => (v === "local" ? "queue" : v), z.enum(["queue", "cloud-tasks"]).default("queue"))` in both apps (the `local` alias is `ee9b8d1`, see "As built"). `dispatchModeWarning(source: NodeJS.ProcessEnv = process.env): string | null` in both `env.ts` files returns `"DISPATCH_MODE=local is now queue; update .env"` when the raw value is `local`; both servers log it at start. `cloud-tasks` authenticates with OIDC (`apps/worker/src/auth.ts`), so `DISPATCH_SECRET` is no longer used by dispatch or by the disk store (which now signs with `BETTER_AUTH_SECRET` alone, As built item 14): its env entries and its start-up check are removed, and `verifyDispatchRequest` throws `DispatchAuthError("push dispatch is off in queue mode")` when the mode is not `cloud-tasks`. `LocalHttpDispatcher` is deleted with its test cases.
  - `createDispatcher(env: Env, logger: Logger, db: Db): Dispatcher` in the API and `createDispatcher(env: WorkerEnv, logger: Logger, db: Db): Dispatcher` in the worker return `QueueNotifier(db)` for `queue`.
  - `retryJob(db, dispatcher, workspaceId, jobId)` also sets `run_after: sql\`now()\`` and `max_attempts = attempt + maxAttemptsFor(type)`.
  - `MAX_ATTEMPTS_BY_TYPE: Readonly<Record<string, number>>` and `maxAttemptsFor(type: string): number` in `packages/jobs/src/create.ts`, exported from `@maester/jobs`; `createJob` sets `max_attempts` from it (`63e3657`).

- [ ] **Step 1: Write the failing tests.** In `packages/jobs/test/dispatch.test.ts`: a `QueueNotifier` over the test database, with a `pg.Client` listening on `job_ready`, delivers the job's type as the payload. In the `retryJob` test: a failed job whose `run_after` is an hour ahead is, after `retryJob`, `queued` with `run_after <= now()`, and the recording dispatcher received it. In `packages/jobs/test/create.test.ts`: `maxAttemptsFor` gives `document.classify` and `document.extract` 2 and any other type 5. In both env tests: `DISPATCH_MODE=local` loads as `queue`, `dispatchModeWarning` returns the text, and an unknown mode still fails.

The `QueueNotifier` test must not migrate the shared test database (`ff64bb9`): `pg_notify` needs no table, and migrating raced the `@maester/db` tests. Destroy the `LISTEN` client instead of returning it to the pool.

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @maester/jobs exec vitest run`, `pnpm --filter @maester/api exec vitest run -t retry`, `pnpm --filter @maester/api exec vitest run test/env.test.ts` and `pnpm --filter @maester/worker exec vitest run test/env.test.ts` — FAIL.

- [ ] **Step 3: Implement** `QueueNotifier`; switch both `createDispatcher` functions to it for `queue` (both gain a `db` parameter, passed from each `server.ts`); change both env schemas and log `dispatchModeWarning` in both servers and in `market/run-once.ts`; delete `LocalHttpDispatcher`; sign the disk store's URLs with `BETTER_AUTH_SECRET` in `store.ts` and `routes/dev.ts`; add `MAX_ATTEMPTS_BY_TYPE` and `maxAttemptsFor`; reset `run_after` and `max_attempts` in `retryJob`.

- [ ] **Step 4: Run the whole TypeScript suite** from the repo root — `pnpm test` (turbo's `test` task; it passes `DATABASE_URL_TEST_DB`, `DATABASE_URL_TEST_API` and `DATABASE_URL_TEST_WORKER` through, and unset each suite uses its `localhost:5433` default, which needs the pgvector Postgres of Task 1's precondition) — PASS: turbo reports every test task successful and none failed. The env tests and fixtures that set `DISPATCH_MODE: "local"` change to `"queue"` first (Files, "Fixtures").

- [ ] **Step 5: Commit**

```bash
git add packages/jobs apps/api/src apps/worker/src apps/api/test apps/worker/test
git commit -m "feat(jobs): enqueue by NOTIFY in queue mode; retry resets run_after; drop the local HTTP dispatcher"
```

---

### Task 7: Wire the worker process, timeouts and shutdown

**Files:**
- Create: `apps/worker/src/start.ts`
- Modify: `apps/worker/src/server.ts` (the runner, the signals, `EXTRACT_TIMEOUT_SECONDS` into `HttpExtractorClient`), `apps/worker/src/app.ts`, `apps/worker/src/env.ts` (`EXTRACTOR_TIMEOUT_SECONDS` 900 becomes `EXTRACT_TIMEOUT_SECONDS` 1800)
- Modify: `docker-compose.yml` (shared env: `DISPATCH_MODE: queue`, drop `DISPATCH_SECRET`; the worker gets `stop_grace_period: 30s`). Compose never set either timeout variable, so the rename does not touch it.
- Modify: `.env.example` (`DISPATCH_MODE=queue`, drop `DISPATCH_SECRET`, a commented `# JOB_CONCURRENCY=document.extract=3,document.verify=8` and a commented `# EXTRACT_TIMEOUT_SECONDS=1800`)
- Test: `apps/worker/test/env.test.ts`, `apps/worker/test/app.test.ts`

**Interfaces:**
- Consumes: `startQueueRunner`, `pgListen`, `parseConcurrency` (Task 5); `QueueNotifier` (Task 6).
- Produces:
  - `apps/worker/src/start.ts` exports `buildQueueOptions(env: WorkerEnv, handlers: Record<string, JobHandler>, logger: Logger): QueueRunnerOptions` (`{ concurrency: parseConcurrency(env.JOB_CONCURRENCY, Object.keys(handlers)), pollMs: env.JOB_POLL_MS, sweepMs: env.JOB_SWEEP_MS, listen: pgListen(env.DATABASE_URL, logger) }`; throws on a bad `JOB_CONCURRENCY`), `logUnhandledQueued(db: Db, handlerTypes: string[], logger: Logger): Promise<{ type: string; count: number }[]>` (one warning per queued type with no handler: type and count only) and `logJobBacklog(db: Db, logger: Logger): Promise<{ type: string; queued: number; running: number }[]>` (one info line per type: type and counts only).
  - In `queue` mode `server.ts` calls `buildQueueOptions` before anything runs (a bad `JOB_CONCURRENCY` logs `fatal` and exits 1), logs the backlog, starts `startQueueRunner(deps, options)`, logs the unhandled queued types (neither log call is awaited, so a slow database does not hold up start), and on `SIGTERM` or `SIGINT` calls `runner.stop(25_000)` before closing the server. A job still running after the grace is given back by `stop` (Task 5), so the restart costs it no attempt. The existing 10-second forced exit in `server.ts` becomes 28 seconds, and the worker service in `docker-compose.yml` gets `stop_grace_period: 30s` (Docker's default of 10 s would kill it mid-wait).
  - `createWorkerApp` mounts `/tasks/:type` only when `env.DISPATCH_MODE === "cloud-tasks"`; `/healthz` always.
  - `EXTRACT_TIMEOUT_SECONDS` (default 1800) feeds `HttpExtractorClient`; `EXTRACTOR_TIMEOUT_SECONDS` is removed.

- [ ] **Step 1: Write the failing tests.** `env.test.ts`: defaults give `DISPATCH_MODE === "queue"`, `EXTRACT_TIMEOUT_SECONDS === 1800`, `JOB_POLL_MS === 1000`, `JOB_SWEEP_MS === 30000`, `JOB_HEARTBEAT_MS === 15000`, and `expect(env).not.toHaveProperty("EXTRACTOR_TIMEOUT_SECONDS")`; `JOB_CONCURRENCY=bad` makes `buildQueueOptions` throw; `DISPATCH_MODE=local` loads as `queue`. `app.test.ts` also covers `logUnhandledQueued` and `logJobBacklog` (type and counts only in the log lines). `app.test.ts`: in `queue` mode `POST /tasks/test.noop` answers 404; in `cloud-tasks` mode it reaches `verifyDispatchRequest` (401 without a token). The `stop` tests (grace and give-back) are Task 5's, where `stop` is built.

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @maester/worker exec vitest run test/env.test.ts test/app.test.ts` — FAIL.

- [ ] **Step 3: Implement** the wiring, the route condition, the timeout rename (in `env.ts` and `server.ts`), and the compose and `.env.example` changes.

- [ ] **Step 4: Run the worker suite** — `pnpm --filter @maester/worker exec vitest run` — PASS.

- [ ] **Step 5: Live check on the compose stack, with no model calls.** The first version of this step was not runnable as written. `docker compose up -d --build postgres migrate api worker` also starts the extractor, because the worker `depends_on` it, and the worker then sends every classify job to it, which calls Gemini (a paid API) whenever the investor's `.env` sets `GOOGLE_CLOUD_PROJECT` and credentials. Setting `EXTRACTOR_URL=` instead stops the worker from starting (`z.url()` refuses an empty string). The recipe below keeps the extractor out. It runs from the main checkout with the investor's go-ahead, never in a worktree; `<T0>` and `<id>` are values noted on the way.

  Setup:
  1. In the main checkout's root, create `docker-compose.no-model.yml`. Never commit it; delete it after the check.
     ```yaml
     # Phase 1 live check only: the worker has no EXTRACTOR_URL and does not wait for the extractor.
     services:
       worker:
         environment:
           EXTRACTOR_URL: !reset null
         depends_on: !override
           migrate:
             condition: service_completed_successfully
     ```
     `depends_on` takes `!override`, not `!reset`: `!reset` ignores the value it is given, so it would drop the `migrate` dependency too (checked with `docker compose config` on Compose v5.1.3).
  2. `export COMPOSE_FILE=docker-compose.yml:docker-compose.no-model.yml`. Every `docker compose` command below then uses the override; a plain `docker compose up worker` without it would recreate the worker with the extractor's URL.
  3. `docker compose up -d postgres`, then check the backlog: `docker compose exec -T postgres psql -U maester -c "select type, state, count(*) from job where state in ('queued', 'running') group by 1, 2"`. The worker claims the whole backlog at start, and without the extractor a queued `document.classify` or `document.extract` job fails at once (`CLASSIFIER_NOT_CONFIGURED`, `EXTRACTOR_NOT_CONFIGURED`). If either type is listed, stop and ask the investor.
  4. `docker compose up -d --build postgres migrate api worker web`. `web` is needed: `pnpm smoke` talks to `http://localhost:5173`, and the disk store signs upload URLs for `BETTER_AUTH_URL` (`http://localhost:5173`), which only the `web` container's nginx proxies to the API.
  5. Pre-checks, before any upload:
     - `docker compose exec worker printenv EXTRACTOR_URL; echo "exit $?"` prints only `exit 1` (the variable is not set).
     - `docker compose ps --services --status running` lists `api`, `postgres`, `web` and `worker`, and not `extractor`. If `extractor` is listed (left from an earlier run), run `docker compose stop extractor` and check again.
     - `docker compose exec -T postgres psql -U maester -tAc "select now()"`; note the time as `<T0>`.

  Part A, the limits and the failures, with no indexer:
  6. In one terminal: `while sleep 1; do docker compose exec -T postgres psql -U maester -tAc "select type, count(*) from job where state = 'running' group by type"; done`.
  7. In another: `for f in <folder of 20 small PDFs>/*.pdf; do pnpm smoke "$f" & done; wait`. Each run signs up a new `smoke-…@example.com` account and prints `document stored <sha256> null`.
  8. Expected: the watch never shows `document.verify` above 4, `document.classify` above 2 or `document.index` above 1. Then `docker compose exec -T postgres psql -U maester -c "select type, state, attempt, last_error_code, count(*) from job where created_at >= '<T0>' group by 1, 2, 3, 4 order by 1, 2"` shows `document.verify | succeeded | 1 | | 20` and `document.classify | failed | 1 | CLASSIFIER_NOT_CONFIGURED | 20` (no retry). `document.index` rows are `queued` with `INDEXER_UNAVAILABLE`: the worker has an `INDEXER_URL`, but the indexer is not started, so each index job backs off 30, 60, 120 and 240 s and is `failed` with `INDEXER_UNAVAILABLE` after its fifth attempt. There is no `document.extract` row, and no extractor container starts.

  Part B, the graceful stop and a dead worker. It needs a job that runs longer than the 25 s grace and calls no paid model. Verify only hashes the stored file and ends within seconds, so it cannot show the give-back. The one long job that is free is `document.index` on a long filing against the local indexer: Docling with RapidOCR, and the TEI embedder, all local (`git grep -n -i -E "anthropic|claude|gemini|vertex" apps/indexer/src packages/document-index/src apps/worker/src/jobs/document-index.ts` finds nothing). It needs phase 2 Task 13's models volume (`docker compose --profile setup run --rm models`). Without it, skip part B and record it as skipped. The give-back is then proven by `queue.test.ts` "stop(500) gives up at about 500 ms on a 2 s job and gives it back with its attempt restored", and the sweep by "a job left running by a dead worker is swept and run again" and the `sweepExpired` cases in `lease.test.ts`.
  9. `docker compose up -d indexer embedder`, and wait until `docker compose ps indexer embedder` shows both `(healthy)`. Then wait until `select count(*) from job where type = 'document.index' and state in ('queued', 'running') and created_at >= '<T0>'` is 0: part A's index jobs that still have attempts run first, one at a time.
  10. `pnpm smoke <a long annual report, 100 pages or more, under 50 MiB>` (`MAX_UPLOAD_BYTES` is 52428800). Note its index job: `select id, state, attempt from job where type = 'document.index' and state = 'running'` gives `<id> | running | 1`.
  11. The give-back: while it runs, `docker compose stop worker` (SIGTERM; compose waits up to the 30 s `stop_grace_period`). Expected: `docker compose logs --since 2m worker` shows `stopped with jobs still running; gave their leases back` with `<id>` in `released`, and `select state, attempt, lease_token is null as freed, run_after <= now() as ready from job where id = '<id>'` gives `queued | 0 | t | t`. Then `docker compose start worker`: the job is claimed again at once (attempt 1) and goes on. Use `stop` and then `start`, not `restart`: after a restart the job is claimed again within a second, so the `queued` row is never seen. If the job ends inside the grace, it is `succeeded` before the stop returns, the give-back is not seen, and the case is recorded as skipped.
  12. The dead worker: while that job runs again (or a second long filing's index job, if it has finished), `docker compose kill worker` (SIGKILL: nothing is given back), then `docker compose start worker`. Expected, polling `select state, attempt, last_error_code, lease_expires_at, run_after from job where id = '<id>'` every 30 s: the row stays `running` (attempt 1) until its lease expires, up to `LEASE_SECONDS` (600 s) after its last heartbeat (every 15 s), and the next sweep has run (`JOB_SWEEP_MS`, 30 s). It is then `queued` with `LEASE_EXPIRED`, attempt 1 and `run_after` 30 to 36 s ahead, then claimed (attempt 2), and it ends `succeeded`. Allow about 11 minutes.
  13. Clean up: `unset COMPOSE_FILE` and delete `docker-compose.no-model.yml`. The next plain `docker compose up` recreates the worker with `EXTRACTOR_URL` and starts the extractor again.

  Any check that would call a model is asked of the investor first.

  **Status: not run.** This is the investor's open item; it runs from the main checkout with the investor's go-ahead, with the override above, and part B waits for phase 2 Task 13's models volume.

- [ ] **Step 6: Commit**

```bash
git add apps/worker docker-compose.yml .env.example
git commit -m "feat(worker): run the queue in-process, /tasks only for cloud tasks, 30-minute extract timeout, graceful stop"
```

The later fixes landed as separate commits: `633235f` (release leases on stop), `38aff12` (heartbeat at most half the lease), `ee9b8d1` (`local` read as `queue`), `63e3657` (two attempts for paid-model types, start-up backlog log).

---

### Task 8: Documentation

**Files:**
- Modify: `docs/systems/worker.md` (dispatch modes, the runner, the limits and settings table, recovery), `docs/systems/api.md` (dispatch mode), `docs/DEVELOPMENT.md` (the pgvector image, recreating the Postgres container, `JOB_CONCURRENCY`), `docs/ARCHITECTURE.md` if it describes dispatch.

- [ ] **Step 1:** Replace every `local` dispatch description with `queue`: how a job is claimed, the per-type limits and `JOB_CONCURRENCY`, the poll, `LISTEN`, the sweeper, the timer heartbeat, backoff, `EXTRACT_TIMEOUT_SECONDS`. Remove `DISPATCH_SECRET` and its warning. Keep STE.
- [ ] **Step 2: Check for leftover names.** Run: `git grep -n -E "DISPATCH_MODE=local|DISPATCH_SECRET|EXTRACTOR_TIMEOUT_SECONDS|LocalHttpDispatcher" -- . ':!docs/superpowers' ':!docs/research'` (git pathspecs; `rg` would read `':!…'` as a file name and fail). Expected: only the places that name the old value on purpose, nothing else (line numbers as of `aede6d2`; `git grep` exits 0 because these lines match):
  - `apps/api/src/env.ts:54` and `:56`, `apps/worker/src/env.ts:70` and `:72`: the `local` alias and its warning
  - `apps/api/test/env.test.ts:58` and `:60`, `apps/worker/test/env.test.ts:26` and `:28`: the alias tests
  - `apps/worker/test/env.test.ts:23`: the assertion that `EXTRACTOR_TIMEOUT_SECONDS` is gone
  - `docs/DEVELOPMENT.md:197`: the upgrade note for an older `.env`
- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: the queue runner, its limits and recovery"
```

---

## After this plan

Phase 2 (the index: indexer and embedder services, index tables, `document.index`, search) has its own plan from spec §8, §13 and §16 and added `document.index` with limit 1 to `DEFAULT_CONCURRENCY`. Later phases that add a job type (`document.xbrl` with limit 2) add it to `DEFAULT_CONCURRENCY` and, if the type calls a paid model, to `MAX_ATTEMPTS_BY_TYPE`.
