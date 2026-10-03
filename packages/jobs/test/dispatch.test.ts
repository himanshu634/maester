import { describe, expect, it, vi } from "vitest";
import type { JobRow } from "@maester/db";
import { CloudTasksDispatcher, type TasksClientLike } from "../src/index.js";

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
