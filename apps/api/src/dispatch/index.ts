import {
  CloudTasksDispatcher as SharedCloudTasksDispatcher,
  QueueNotifier,
  type Dispatcher,
  type TasksClientLike,
} from "@maester/jobs";
import type { Db } from "@maester/db";
import type { Env } from "../env.js";
import type { Logger } from "../logger.js";

export { QueueNotifier, RecordingDispatcher, type Dispatcher, type TasksClientLike } from "@maester/jobs";

/** Cloud Tasks dispatcher configured from the API environment. */
export class CloudTasksDispatcher extends SharedCloudTasksDispatcher {
  constructor(env: Env, logger: Logger, client?: TasksClientLike) {
    super(
      {
        project: env.GOOGLE_CLOUD_PROJECT!,
        location: env.GOOGLE_CLOUD_LOCATION,
        queue: env.CLOUD_TASKS_QUEUE,
        workerUrl: env.WORKER_URL,
        invokerServiceAccount: env.WORKER_INVOKER_SA!,
      },
      logger,
      client,
    );
  }
}

export function createDispatcher(env: Env, logger: Logger, db: Db): Dispatcher {
  if (env.DISPATCH_MODE === "cloud-tasks") return new CloudTasksDispatcher(env, logger);
  return new QueueNotifier(db);
}
