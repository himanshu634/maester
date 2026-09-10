import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobRow } from "@maester/db";
import { CloudTasksDispatcher, LocalHttpDispatcher, type TasksClientLike } from "../src/dispatch/index.js";
import { silentLogger } from "../src/logger.js";
import { testEnv } from "./env.js";

function makeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    type: "document.verify",
    subjectType: "document",
    subjectId: crypto.randomUUID(),
    idempotencyKey: "document.verify:subject:1",
    state: "queued",
    attempt: 0,
    maxAttempts: 5,
    leaseToken: null,
    leaseExpiresAt: null,
    progress: {},
    result: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
    updatedAt: new Date(),
    ...overrides,
  } as JobRow;
}

describe("LocalHttpDispatcher", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("posts the job to the worker with the dispatch secret", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const dispatcher = new LocalHttpDispatcher("http://localhost:8788", "local-dispatch-secret", silentLogger);
    const job = makeJob({ type: "document.verify" });

    await dispatcher.enqueue(job);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8788/tasks/document.verify");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-dispatch-secret"]).toBe("local-dispatch-secret");
    expect(init.body).toBe(JSON.stringify({ jobId: job.id }));
  });
});

describe("CloudTasksDispatcher", () => {
  it("creates a task via the injected client", async () => {
    const createTask = vi.fn().mockResolvedValue([{}]);
    const client: TasksClientLike = {
      queuePath: (p: string, l: string, q: string) => `projects/${p}/locations/${l}/queues/${q}`,
      createTask,
    };
    const env = testEnv({ DISPATCH_MODE: "cloud-tasks", WORKER_INVOKER_SA: "api@test.iam" });
    const dispatcher = new CloudTasksDispatcher(env, silentLogger, client);
    const job = makeJob({ type: "document.verify" });

    await dispatcher.enqueue(job);

    expect(createTask).toHaveBeenCalledTimes(1);
    const parent = "projects/test-project/locations/asia-south1/queues/maester-jobs";
    const call = createTask.mock.calls[0]![0] as {
      parent: string;
      task: { name: string; httpRequest: { url: string; oidcToken: unknown; body: string } };
    };
    expect(call.parent).toBe(parent);
    expect(call.task.name).toBe(`${parent}/tasks/${job.id}-${job.attempt}`);
    expect(call.task.httpRequest.url).toBe("http://localhost:8788/tasks/document.verify");
    expect(call.task.httpRequest.oidcToken).toEqual({
      serviceAccountEmail: "api@test.iam",
      audience: "http://localhost:8788",
    });
    expect(JSON.parse(Buffer.from(call.task.httpRequest.body, "base64").toString())).toEqual({ jobId: job.id });
  });

  it("swallows ALREADY_EXISTS (code 6) but rethrows other errors", async () => {
    const env = testEnv({ DISPATCH_MODE: "cloud-tasks", WORKER_INVOKER_SA: "api@test.iam" });
    const job = makeJob({ type: "document.verify" });

    const alreadyExistsClient: TasksClientLike = {
      queuePath: (p: string, l: string, q: string) => `projects/${p}/locations/${l}/queues/${q}`,
      createTask: vi.fn().mockRejectedValue(Object.assign(new Error("exists"), { code: 6 })),
    };
    await expect(new CloudTasksDispatcher(env, silentLogger, alreadyExistsClient).enqueue(job)).resolves.toBeUndefined();

    const otherErrorClient: TasksClientLike = {
      queuePath: (p: string, l: string, q: string) => `projects/${p}/locations/${l}/queues/${q}`,
      createTask: vi.fn().mockRejectedValue(Object.assign(new Error("permission denied"), { code: 7 })),
    };
    await expect(new CloudTasksDispatcher(env, silentLogger, otherErrorClient).enqueue(job)).rejects.toThrow(
      "permission denied",
    );
  });
});
