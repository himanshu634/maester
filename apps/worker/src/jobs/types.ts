import type { Db, JobProgressJson, JobRow } from "@maester/db";
import type { Dispatcher } from "@maester/jobs";
import type { ObjectStore } from "@maester/storage";
import type { WorkerEnv } from "../env.js";
import type { ExtractorClient } from "../extractor.js";
import type { Logger } from "../logger.js";

export interface JobContext {
  db: Db;
  store: ObjectStore;
  logger: Logger;
  env: WorkerEnv;
  dispatcher: Dispatcher;
  /** Null when EXTRACTOR_URL is unset. */
  extractor: ExtractorClient | null;
  progress(p: JobProgressJson): Promise<void>;
  /** Renew the job lease; cheap to call often (calls are throttled). */
  heartbeat(): Promise<void>;
}

export type JobHandler = ((job: JobRow, ctx: JobContext) => Promise<unknown>) & {
  /** Runs once when the job fails for good, to leave its subject in a stated failure. */
  onFinalFailure?: (job: JobRow, db: Db) => Promise<void>;
};

/**
 * A failure with a stable code. The runner records the code and, when
 * `retryable` is false, fails the job without spending further attempts.
 */
export class JobFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "JobFailure";
  }
}
