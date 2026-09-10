import type { Db, JobProgressJson, JobRow } from "@maester/db";
import type { ObjectStore } from "@maester/storage";
import type { WorkerEnv } from "../env.js";
import type { Logger } from "../logger.js";

export interface JobContext {
  db: Db;
  store: ObjectStore;
  logger: Logger;
  env: WorkerEnv;
  progress(p: JobProgressJson): Promise<void>;
}

export type JobHandler = (job: JobRow, ctx: JobContext) => Promise<unknown>;
