import { CloudTasksClient } from "@google-cloud/tasks";
import type { JobRow } from "@maester/db";

/** The subset of a pino logger the dispatchers use. */
export interface DispatchLogger {
  info(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

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
    private readonly logger: DispatchLogger,
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

export interface CloudTasksConfig {
  project: string;
  location: string;
  queue: string;
  workerUrl: string;
  /** Service account whose OIDC token Cloud Tasks attaches; the worker accepts only this identity. */
  invokerServiceAccount: string;
  /** Optional per-task dispatch deadline; Cloud Tasks' default applies when unset. */
  dispatchDeadlineSeconds?: number;
}

export class CloudTasksDispatcher implements Dispatcher {
  private readonly client: TasksClientLike;
  private readonly parent: string;

  constructor(
    private readonly config: CloudTasksConfig,
    private readonly logger: DispatchLogger,
    client?: TasksClientLike,
  ) {
    this.client = client ?? new CloudTasksClient();
    this.parent = this.client.queuePath(config.project, config.location, config.queue);
  }

  async enqueue(job: JobRow): Promise<void> {
    const name = `${this.parent}/tasks/${job.id}-${job.attempt}`;
    try {
      await this.client.createTask({
        parent: this.parent,
        task: {
          name,
          ...(this.config.dispatchDeadlineSeconds ? { dispatchDeadline: { seconds: this.config.dispatchDeadlineSeconds } } : {}),
          httpRequest: {
            httpMethod: "POST",
            url: `${this.config.workerUrl}/tasks/${encodeURIComponent(job.type)}`,
            headers: { "Content-Type": "application/json" },
            body: Buffer.from(JSON.stringify({ jobId: job.id })).toString("base64"),
            oidcToken: { serviceAccountEmail: this.config.invokerServiceAccount, audience: this.config.workerUrl },
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
