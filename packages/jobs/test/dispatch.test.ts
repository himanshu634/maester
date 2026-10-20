import { afterAll, describe, expect, it, vi } from "vitest";
import { closeDb, createDb, type JobRow } from "@maester/db";
import { CloudTasksDispatcher, QueueNotifier, type TasksClientLike } from "../src/index.js";

// Same convention as the db package: a throwaway pgvector Postgres (see docker-compose test notes).
const TEST_DATABASE_URL = process.env.DATABASE_URL_TEST_DB ?? "postgres://maester:maester@localhost:5433/maester_test_db";

const logger = { info: () => {}, error: () => {} };

function makeJob(): JobRow {
  return { id: crypto.randomUUID(), type: "document.extract", attempt: 0 } as JobRow;
}

describe("CloudTasksDispatcher", () => {
  const config = {
    project: "p",
    location: "asia-south1",
    queue: "maester-jobs",
    workerUrl: "https://worker.example",
    invokerServiceAccount: "api@p.iam",
  };
  const client = (createTask: ReturnType<typeof vi.fn>): TasksClientLike => ({
    queuePath: (p: string, l: string, q: string) => `projects/${p}/locations/${l}/queues/${q}`,
    createTask: createTask as unknown as TasksClientLike["createTask"],
  });

  it("sets a dispatch deadline when configured", async () => {
    const createTask = vi.fn().mockResolvedValue([{}]);
    await new CloudTasksDispatcher({ ...config, dispatchDeadlineSeconds: 1800 }, logger, client(createTask)).enqueue(makeJob());
    const call = createTask.mock.calls[0]![0] as { task: { dispatchDeadline?: { seconds: number } } };
    expect(call.task.dispatchDeadline).toEqual({ seconds: 1800 });
  });

  it("leaves the deadline to Cloud Tasks by default", async () => {
    const createTask = vi.fn().mockResolvedValue([{}]);
    await new CloudTasksDispatcher(config, logger, client(createTask)).enqueue(makeJob());
    const call = createTask.mock.calls[0]![0] as { task: Record<string, unknown> };
    expect(call.task).not.toHaveProperty("dispatchDeadline");
  });
});

describe("QueueNotifier", () => {
  const db = createDb(TEST_DATABASE_URL);
  afterAll(() => closeDb(db));

  // pg_notify needs no table, so this test does not migrate: the db package's tests migrate the same database at the same time.
  it("notifies job_ready with the job type as the payload", async () => {
    const listener = await db.$client.connect();
    try {
      const received: string[] = [];
      listener.on("notification", (msg) => {
        if (msg.channel === "job_ready" && msg.payload) received.push(msg.payload);
      });
      await listener.query("LISTEN job_ready");
      await new QueueNotifier(db).enqueue(makeJob());
      await vi.waitFor(() => expect(received).toEqual(["document.extract"]));
    } finally {
      // A client that ran LISTEN is destroyed, not returned to the pool still listening.
      listener.release(true);
    }
  });
});
