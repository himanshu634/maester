import { CloudTasksClient } from "@google-cloud/tasks";
import type { JobRow } from "@maester/db";
import type { Env } from "../env.js";
import type { Logger } from "../logger.js";

export interface Dispatcher {
  enqueue(job: JobRow): Promise<void>;
}

export class RecordingDispatcher implements Dispatcher {
  readonly enqueued: JobRow[] = [];
  async enqueue(job: JobRow): Promise<void> {
    this.enqueued.push(job);
  }
}

export class LocalHttpDispatcher implements Dispatcher {
  constructor(
    private readonly workerUrl: string,
    private readonly secret: string,
    private readonly logger: Logger,
  ) {}

  async enqueue(job: JobRow): Promise<void> {
    const url = `${this.workerUrl}/tasks/${encodeURIComponent(job.type)}`;
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-dispatch-secret": this.secret },
      body: JSON.stringify({ jobId: job.id }),
    })
      .then((res) => this.logger.info({ jobId: job.id, status: res.status }, "local dispatch completed"))
      .catch((err: Error) => this.logger.error({ jobId: job.id, err: err.message }, "local dispatch failed"));
  }
}

export type TasksClientLike = Pick<CloudTasksClient, "queuePath" | "createTask">;

export class CloudTasksDispatcher implements Dispatcher {
  private readonly client: TasksClientLike;
  private readonly parent: string;

  constructor(
    private readonly env: Env,
    private readonly logger: Logger,
    client?: TasksClientLike,
  ) {
    this.client = client ?? new CloudTasksClient();
    this.parent = this.client.queuePath(env.GOOGLE_CLOUD_PROJECT, env.GOOGLE_CLOUD_LOCATION, env.CLOUD_TASKS_QUEUE);
  }

  async enqueue(job: JobRow): Promise<void> {
    const name = `${this.parent}/tasks/${job.id}-${job.attempt}`;
    try {
      await this.client.createTask({
        parent: this.parent,
        task: {
          name,
          httpRequest: {
            httpMethod: "POST",
            url: `${this.env.WORKER_URL}/tasks/${encodeURIComponent(job.type)}`,
            headers: { "Content-Type": "application/json" },
            body: Buffer.from(JSON.stringify({ jobId: job.id })).toString("base64"),
            oidcToken: { serviceAccountEmail: this.env.WORKER_INVOKER_SA!, audience: this.env.WORKER_URL },
          },
        },
      });
    } catch (err) {
      // gRPC code 6 = ALREADY_EXISTS: a duplicate enqueue for the same job/attempt is harmless.
      if ((err as { code?: number }).code === 6) {
        this.logger.info({ jobId: job.id }, "task already exists");
        return;
      }
      throw err;
    }
  }
}

export function createDispatcher(env: Env, logger: Logger): Dispatcher {
  if (env.DISPATCH_MODE === "cloud-tasks") return new CloudTasksDispatcher(env, logger);
  return new LocalHttpDispatcher(env.WORKER_URL, env.DISPATCH_SECRET!, logger);
}
