# @maester/jobs

Job creation and dispatch shared by `apps/api` and `apps/worker`.

- `createJob(db, dispatcher, input)` inserts a queued job keyed by `type:subjectId:pipelineVersion` and dispatches it, or returns the existing job with that key without dispatching again. A key owned by another workspace raises `JobScopeConflictError`.
- `QueueNotifier` runs `pg_notify('job_ready', <type>)` to wake the worker's queue runner (the `queue` mode).
- `CloudTasksDispatcher` creates a Cloud Tasks HTTP task with an OIDC token for the configured invoker service account, and an optional dispatch deadline.
- `RecordingDispatcher` records enqueued jobs for tests.

Apps that import this package must also list `@google-cloud/tasks` as their own dependency and keep it external in their bundle; see the apps' `tsup.config.ts`.
