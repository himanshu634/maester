import { CloudTasksDispatcher, LocalHttpDispatcher, type Dispatcher } from "@maester/jobs";
import type { WorkerEnv } from "./env.js";
import type { Logger } from "./logger.js";

/** Dispatcher for follow-up jobs the worker enqueues itself (document.extract after verify). */
export function createDispatcher(env: WorkerEnv, logger: Logger): Dispatcher {
  if (env.DISPATCH_MODE === "cloud-tasks") {
    if (!env.GOOGLE_CLOUD_PROJECT || !env.WORKER_INVOKER_SA) {
      return {
        async enqueue(job) {
          throw new Error(`cannot enqueue ${job.type}: GOOGLE_CLOUD_PROJECT and WORKER_INVOKER_SA are not set`);
        },
      };
    }
    return new CloudTasksDispatcher(
      {
        project: env.GOOGLE_CLOUD_PROJECT,
        location: env.GOOGLE_CLOUD_LOCATION,
        queue: env.CLOUD_TASKS_QUEUE,
        workerUrl: env.WORKER_URL,
        invokerServiceAccount: env.WORKER_INVOKER_SA,
        dispatchDeadlineSeconds: env.TASK_DISPATCH_DEADLINE_SECONDS,
      },
      logger,
    );
  }
  return new LocalHttpDispatcher(env.WORKER_URL, env.DISPATCH_SECRET!, logger);
}
