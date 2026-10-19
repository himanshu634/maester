# Ingestion phase 1: the job runner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The worker pulls jobs from the `job` table with a concurrency limit per job type, retries with backoff, recovers jobs whose worker died, and keeps long jobs' leases alive, so many uploaded files process in parallel without exhausting the machine.

**Architecture:** A new dispatch mode, `queue`, becomes the default. `createJob` and `retryJob` keep calling `dispatcher.enqueue`, which now sends `pg_notify('job_ready', type)`. The worker runs one claim loop per job type (single-statement `FOR UPDATE SKIP LOCKED` claim, an in-process limit per type), wakes on `LISTEN job_ready` from a dedicated connection with a poll as a safety net, sweeps expired leases every 30 s, and heartbeats on a timer. The HTTP `/tasks/:type` route stays for `cloud-tasks` mode only. Postgres moves to the pgvector image, which later phases need.

**Tech Stack:** TypeScript, Node, `pg` (node-postgres), Drizzle ORM and drizzle-kit, Hono, Vitest against the Postgres test databases, Docker Compose.

**Spec:** [`docs/superpowers/specs/2026-10-19-ingestion-pipeline-design.md`](../specs/2026-10-19-ingestion-pipeline-design.md) §9 (Parallel processing) and §16 phase 1. Research: [`docs/research/2026-10-19-ingestion-research.md`](../../research/2026-10-19-ingestion-research.md) §5.

## Global Constraints

- Every deadline is computed in SQL with `now()`; never compare `Date.now()` with `lease_expires_at`.
- Backoff after a failed attempt `n` (1-based): `min(900, 30 × 2^(n−1))` seconds, plus up to 20% jitter.
- Default limits per type: `document.verify` 4, `document.classify` 2, `document.extract` 2; any other type with a handler 1. `document.xbrl` 2 and `document.index` 1 are added by their phases.
- `NOTIFY` once per enqueue, never per progress write. The listener uses its own `pg.Client`, never the pool.
- No transaction is held open while a handler runs.
- Poll interval `JOB_POLL_MS` default 1000; sweep interval `JOB_SWEEP_MS` default 30000; timer heartbeat `JOB_HEARTBEAT_MS` default 15000; `LEASE_SECONDS` stays 600.
- `EXTRACT_TIMEOUT_SECONDS` default 1800 replaces `EXTRACTOR_TIMEOUT_SECONDS` (900).
- Postgres image `pgvector/pgvector:pg16` in compose and CI, `shm_size: 1gb` in compose.
- No document text, label or figure in any log line (`CLAUDE.md`).
- `docs/systems/*.md` are written in ASD-STE100 Simplified Technical English; keep that style (the `writing-ste` skill).
- The migration takes the next free number when it is generated (the data layer's phase 1 has 0006 planned; whichever lands first takes it).

## Review Focus

1. **A worker dies mid-job.** The job's lease expires; the sweeper puts it back to `queued` with backoff, or fails it with `LEASE_EXPIRED` (running `onFinalFailure`) when its attempts are spent. Task 3.
2. **A notification is missed** (the listener's connection drops, or a job is created while the worker is down). The poll still finds it within `JOB_POLL_MS`, and the listener reconnects. Task 5.
3. **A failed job is retried by hand** (`POST /v1/jobs/:id/retry`). `retryJob` resets `run_after` to now and notifies, so it runs at once rather than after its old backoff. Task 6.
4. **SIGTERM while jobs run.** Loops stop claiming at once; the process waits up to 25 s for running handlers (compose gives the worker `stop_grace_period: 30s`, so Docker does not kill it first), then exits; an unfinished job's lease expires and the sweeper recovers it. Task 7.
5. **A queued job of a type with no handler** (an old type, a typo). No loop claims it, so it stays `queued`; the sweeper does not touch queued rows. The worker logs the queued count per unknown type once at start. Task 7.

---

### Task 1: Postgres image and the job migration

**Files:**
- Modify: `docker-compose.yml` (service `postgres`: `image`, add `shm_size`)
- Modify: `.github/workflows/ts.yml` (service `postgres` image)
- Modify: `packages/db/src/schema/platform.ts` (the `job` table)
- Create: `packages/db/drizzle/<next>_job_queue.sql` (generated, then edited)
- Test: `packages/db/test/migrate.test.ts`

**Interfaces:**
- Produces: column `job.run_after` (`runAfter: Date`, not null, default `now()`); index `job_claimable` on `(type, run_after)` where `state = 'queued'`; index `job_running_lease` on `(lease_expires_at)` where `state = 'running'`; `job_state_lease` dropped; `job` fill factor 80.

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

Run: `docker compose up -d postgres && pnpm --filter @maester/db exec vitest run test/migrate.test.ts`
Expected: FAIL on `run_after` (the column does not exist) and on `vector` (the stock image has no pgvector).

- [ ] **Step 3: Switch the image.** In `docker-compose.yml` set `image: pgvector/pgvector:pg16` and `shm_size: 1gb` on `postgres`; in `.github/workflows/ts.yml` set the service image to `pgvector/pgvector:pg16`. The data volume stays (same major version). Recreate the container: `docker compose up -d --force-recreate postgres`.

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
  - `claimNext(db: Db, type: string, leaseSeconds: number): Promise<JobRow | null>`: one statement; takes the oldest `queued` job of `type` whose `run_after <= now()`, by `run_after` then `created_at`, `FOR UPDATE SKIP LOCKED`; sets `state = 'running'`, a new `lease_token`, `lease_expires_at = now() + leaseSeconds`, `attempt = attempt + 1`, `started_at = coalesce(started_at, now())`.
  - `backoffSeconds(attempt: number, random?: () => number): number`: `min(900, 30 × 2^(attempt−1)) × (1 + 0.2 × random())`.
  - `failAttempt(db, job, leaseToken, err, final)` (existing signature): when not final also sets `run_after = now() + backoffSeconds(job.attempt)` seconds.
  - `acquireLease` stays for `cloud-tasks` mode, unchanged.

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
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @maester/worker exec vitest run test/lease.test.ts`
Expected: FAIL: `claimNext` and `backoffSeconds` are not exported.

- [ ] **Step 3: Implement** `claimNext`, `backoffSeconds` and the `failAttempt` change in `apps/worker/src/lease.ts`. The claim is one `UPDATE job SET … WHERE id = (SELECT id FROM job WHERE type = $1 AND state = 'queued' AND run_after <= now() ORDER BY run_after, created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *` through `db.execute(sql\`…\`)`, mapped to `JobRow` the way Drizzle returns it (or written with Drizzle's query builder and a subquery, if it expresses `SKIP LOCKED`).

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
- Produces: `sweepExpired(db: Db): Promise<{ requeued: JobRow[]; failed: JobRow[] }>`: every `running` job with `lease_expires_at < now()` goes to `queued` with `run_after = now() + backoff(attempt)` and `last_error_code = 'LEASE_EXPIRED'`, or, when `attempt >= max_attempts`, to `failed` with `finished_at = now()` and the same code; lease token and expiry cleared. One statement per outcome, each guarded by `lease_expires_at < now()` so a job renewed meanwhile is untouched.

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
});
it("sweepExpired leaves live leases and queued jobs alone", async () => {
  const { workspaceId } = await seedWorkspace(ctx.db);
  const live = await seedJob(ctx.db, workspaceId, { state: "running", attempt: 1, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) });
  const queued = await seedJob(ctx.db, workspaceId);
  const out = await sweepExpired(ctx.db);
  expect([...out.requeued, ...out.failed].map((j) => j.id)).not.toContain(live);
  expect([...out.requeued, ...out.failed].map((j) => j.id)).not.toContain(queued);
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
- Test: `apps/worker/test/run.test.ts`

**Interfaces:**
- Consumes: `failAttempt` with backoff (Task 2).
- Produces:
  - `executeJob(deps: WorkerDeps, job: JobRow, opts?: { heartbeatMs?: number }): Promise<{ outcome: "succeeded" | "failed" | "retry" | "lease_lost" }>`: runs the handler for an already-leased job (the body of today's `runJob` after `acquireLease`), with a `setInterval` every `heartbeatMs` (default `env.JOB_HEARTBEAT_MS`) calling `renewLease`, cleared in `finally`. When a renewal returns `false`, the timer stops and the outcome after the handler returns is `lease_lost` (completion is already fenced by the token).
  - `runJob(deps, type, jobId)` (unchanged signature, used by the `/tasks` route): `acquireLease`, then `executeJob`, mapping outcomes to the existing `RunResult` statuses.
  - `WorkerEnv` gains `JOB_HEARTBEAT_MS` (default 15000).

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

Keep every existing `run.test.ts` case passing through `runJob`.

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @maester/worker exec vitest run test/run.test.ts` — FAIL: `executeJob` is not exported.

- [ ] **Step 3: Implement** `executeJob` and rewrite `runJob` over it; add `JOB_HEARTBEAT_MS` to `env.ts`.

- [ ] **Step 4: Run to see them pass** — same command — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/run.ts apps/worker/src/env.ts apps/worker/test/run.test.ts
git commit -m "feat(worker): execute a leased job with a timer heartbeat; runJob uses it"
```

---

### Task 5: The queue runner: one loop per type, a limit, a listener, a poll

**Files:**
- Create: `apps/worker/src/queue.ts`
- Modify: `apps/worker/src/env.ts`
- Test: `apps/worker/test/queue.test.ts`

**Interfaces:**
- Consumes: `claimNext` (Task 2), `sweepExpired` (Task 3), `executeJob` (Task 4).
- Produces:
  - `parseConcurrency(spec: string | undefined, types: string[]): Record<string, number>`: `"document.extract=3,document.verify=8"` over the defaults in Global Constraints; any other type 1; a value below 1 or not an integer throws.
  - `startQueueRunner(deps: WorkerDeps, opts: { concurrency: Record<string, number>; pollMs: number; sweepMs: number; listen: (onReady: (type: string) => void) => Promise<() => Promise<void>> }): { stop(graceMs: number): Promise<void>; running(): Record<string, number> }`: for each type in `deps.handlers`, a loop that, while running jobs of that type are below its limit, calls `claimNext` and starts `executeJob` without awaiting it; when `claimNext` returns null the loop sleeps until `pollMs` passes or `onReady(type)` fires. A sweep runs every `sweepMs`; for each `failed` job it calls the handler's `onFinalFailure`. `stop` stops claiming at once and waits up to `graceMs` for running jobs.
  - `pgListen(connectionString: string, logger: Logger): (onReady: (type: string) => void) => Promise<() => Promise<void>>`: the `listen` implementation. Called with `onReady`, it opens a dedicated `pg.Client`, runs `LISTEN job_ready`, calls `onReady(payload)` for each notification, and on error or end reconnects after 1 s (doubling to at most 30 s), logging each reconnect; it resolves to a close function.
  - `WorkerEnv` gains `JOB_CONCURRENCY` (optional string), `JOB_POLL_MS` (1000), `JOB_SWEEP_MS` (30000).

- [ ] **Step 1: Write the failing tests** in `apps/worker/test/queue.test.ts`:

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

`waitFor(predicate, timeoutMs)` and `countState(db, state, type)` are small helpers added to `apps/worker/test/context.ts`.

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @maester/worker exec vitest run test/queue.test.ts` — FAIL: `./src/queue.js` does not exist.

- [ ] **Step 3: Implement** `apps/worker/src/queue.ts` and the env additions.

- [ ] **Step 4: Add a listener test against the real database** in `queue.test.ts`: `pgListen` on the test database, then `select pg_notify('job_ready', 'test.real')` from the pool, expecting `onReady("test.real")` within 2 s; then `pg_terminate_backend` on the listener's backend pid and a second notify after 1.5 s, expecting it to arrive after the reconnect.

- [ ] **Step 5: Run all queue tests to see them pass** — same command — PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/queue.ts apps/worker/src/env.ts apps/worker/test/queue.test.ts apps/worker/test/context.ts
git commit -m "feat(worker): queue runner with a limit per job type, LISTEN wake-up, poll and sweep"
```

---

### Task 6: Enqueue by notifying, in the API and the worker

**Files:**
- Modify: `packages/jobs/src/dispatch.ts` (add `QueueNotifier`)
- Modify: `apps/api/src/dispatch/index.ts`, `apps/api/src/env.ts`, `apps/worker/src/dispatch.ts`, `apps/worker/src/env.ts`
- Modify: `apps/api/src/jobs/create.ts` (`retryJob` resets `run_after`)
- Test: `packages/jobs/test/dispatch.test.ts`, `apps/api/test/jobs.test.ts` (or wherever `retryJob` is tested today; `rg -l retryJob apps/api/test`)

**Interfaces:**
- Produces:
  - `class QueueNotifier implements Dispatcher { constructor(db: Db) }`: `enqueue(job)` runs `select pg_notify('job_ready', ${job.type})` on a pool connection. Callers enqueue after their transaction commits, as `decideIntake` already does; a notify sent too early only costs a poll interval, because the poll finds the job anyway.
  - `DISPATCH_MODE` becomes `z.enum(["queue", "cloud-tasks"]).default("queue")` in both apps. `cloud-tasks` authenticates with OIDC (`apps/worker/src/auth.ts`), so `DISPATCH_SECRET` is no longer used by any mode: its env entries, its start-up check and the `local` branch of `verifyDispatchRequest` are removed. `LocalHttpDispatcher` is deleted with its test cases.
  - `retryJob` also sets `run_after: sql\`now()\``.

- [ ] **Step 1: Write the failing tests.** In `packages/jobs/test/dispatch.test.ts`: a `QueueNotifier` over the test database, with a `pg.Client` listening on `job_ready`, delivers the job's type as the payload. In the `retryJob` test: a failed job whose `run_after` is an hour ahead is, after `retryJob`, `queued` with `run_after <= now()`, and the recording dispatcher received it.

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @maester/jobs exec vitest run` and `pnpm --filter @maester/api exec vitest run -t retry` — FAIL.

- [ ] **Step 3: Implement** `QueueNotifier`; switch both `createDispatcher` functions to it for `queue`; change both env schemas; delete `LocalHttpDispatcher`; reset `run_after` in `retryJob`.

- [ ] **Step 4: Run the whole TypeScript suite** — `pnpm -r --filter "./apps/*" --filter "./packages/*" exec vitest run` — PASS (env tests that set `DISPATCH_MODE: "local"` change to `"queue"`).

- [ ] **Step 5: Commit**

```bash
git add packages/jobs apps/api/src apps/worker/src apps/api/test apps/worker/test
git commit -m "feat(jobs): enqueue by NOTIFY in queue mode; retry resets run_after; drop the local HTTP dispatcher"
```

---

### Task 7: Wire the worker process, timeouts and shutdown

**Files:**
- Modify: `apps/worker/src/server.ts`, `apps/worker/src/app.ts`, `apps/worker/src/env.ts`
- Modify: `docker-compose.yml` (shared env: `DISPATCH_MODE: queue`, drop `DISPATCH_SECRET`, `EXTRACTOR_TIMEOUT_SECONDS` → `EXTRACT_TIMEOUT_SECONDS`), `.env.example`
- Test: `apps/worker/test/env.test.ts`, `apps/worker/test/app.test.ts` (create if absent)

**Interfaces:**
- Consumes: `startQueueRunner`, `pgListen`, `parseConcurrency` (Task 5); `QueueNotifier` (Task 6).
- Produces:
  - In `queue` mode `server.ts` starts `startQueueRunner(deps, { concurrency: parseConcurrency(env.JOB_CONCURRENCY, Object.keys(handlers)), pollMs: env.JOB_POLL_MS, sweepMs: env.JOB_SWEEP_MS, listen: pgListen(env.DATABASE_URL, logger) })`, logs once per type with queued jobs but no handler (type and count only), and on `SIGTERM` calls `runner.stop(25_000)` before closing the server. The existing 10-second forced exit in `server.ts` becomes 28 seconds, and the worker service in `docker-compose.yml` gets `stop_grace_period: 30s` (Docker's default of 10 s would kill it mid-wait).
  - `createWorkerApp` mounts `/tasks/:type` only when `env.DISPATCH_MODE === "cloud-tasks"`; `/healthz` always.
  - `EXTRACT_TIMEOUT_SECONDS` (default 1800) feeds `HttpExtractorClient`; `EXTRACTOR_TIMEOUT_SECONDS` is removed.

- [ ] **Step 1: Write the failing tests.** `env.test.ts`: defaults give `DISPATCH_MODE === "queue"`, `EXTRACT_TIMEOUT_SECONDS === 1800`, `JOB_POLL_MS === 1000`, `JOB_SWEEP_MS === 30000`, `JOB_HEARTBEAT_MS === 15000`; `JOB_CONCURRENCY=bad` fails at start through `parseConcurrency`. `app.test.ts`: in `queue` mode `POST /tasks/test.noop` answers 404; in `cloud-tasks` mode it reaches `verifyDispatchRequest` (401 without a token). `queue.test.ts`: `runner.stop(500)` resolves only after a running 200 ms handler finishes, and resolves at about 500 ms while a 2 s handler is still running (that job is left to its lease).

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @maester/worker exec vitest run test/env.test.ts test/app.test.ts` — FAIL.

- [ ] **Step 3: Implement** the wiring, the route condition, the timeout rename, and the compose and `.env.example` changes.

- [ ] **Step 4: Run the worker suite** — `pnpm --filter @maester/worker exec vitest run` — PASS.

- [ ] **Step 5: Live check on the compose stack, with no model calls.** The project has no budget, so this step must not reach Gemini: run the stack with `EXTRACTOR_URL` unset for the worker (`docker compose up -d --build postgres migrate api worker`, the extractor not started, or `EXTRACTOR_URL=` in the worker's environment). Upload 20 small PDFs through the API in a loop; verify runs, classification fails at once with `CLASSIFIER_NOT_CONFIGURED`, and nothing is sent to a model. While they process, run `docker compose exec postgres psql -U maester -c "select type, count(*) from job where state = 'running' group by type"` every second. Expected: `document.verify` never above 4. Then `docker compose restart worker` while a verify job runs (slow it by uploading a 50 MB PDF); expected: after `LEASE_SECONDS` plus a sweep the job is queued again and completes (`select state, attempt, last_error_code from job where id = …`). Any check that would call a model is asked of the investor first.

- [ ] **Step 6: Commit**

```bash
git add apps/worker docker-compose.yml .env.example
git commit -m "feat(worker): run the queue in-process, /tasks only for cloud tasks, 30-minute extract timeout, graceful stop"
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/systems/worker.md` (dispatch modes, the runner, the limits and settings table, recovery), `docs/systems/api.md` (dispatch mode), `docs/DEVELOPMENT.md` (the pgvector image, recreating the Postgres container, `JOB_CONCURRENCY`), `docs/ARCHITECTURE.md` if it describes dispatch.

- [ ] **Step 1:** Replace every `local` dispatch description with `queue`: how a job is claimed, the per-type limits and `JOB_CONCURRENCY`, the poll, `LISTEN`, the sweeper, the timer heartbeat, backoff, `EXTRACT_TIMEOUT_SECONDS`. Remove `DISPATCH_SECRET` and its warning. Keep STE.
- [ ] **Step 2:** `rg -n "DISPATCH_MODE=local|DISPATCH_SECRET|EXTRACTOR_TIMEOUT_SECONDS|LocalHttpDispatcher" -- . ':!node_modules'` returns nothing outside `docs/superpowers/` history.
- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: the queue runner, its limits and recovery"
```

---

## After this plan

Phase 2 (the index: indexer and embedder services, index tables, `document.index`, search) gets its own plan from spec §8, §13 and §16, adding `document.index` with limit 1 to the defaults here.
