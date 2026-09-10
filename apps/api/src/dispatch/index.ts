import type { JobRow } from "@maester/db";

export interface Dispatcher {
  enqueue(job: JobRow): Promise<void>;
}

export class RecordingDispatcher implements Dispatcher {
  readonly enqueued: JobRow[] = [];
  async enqueue(job: JobRow) {
    this.enqueued.push(job);
  }
}
