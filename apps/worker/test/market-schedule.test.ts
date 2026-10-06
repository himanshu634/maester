import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "../src/logger.js";
import { startMarketSchedule } from "../src/market/schedule.js";

const MINUTE = 60_000;

function refresher(fn: () => Promise<unknown>) {
  return { refresh: vi.fn(fn) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startMarketSchedule", () => {
  it("refreshes once after 10 seconds, then every interval", async () => {
    const r = refresher(async () => "ran");
    const stop = startMarketSchedule(r, 30, silentLogger);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(r.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(r.refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30 * MINUTE - 1);
    expect(r.refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(r.refresh).toHaveBeenCalledTimes(3);
    stop();
  });

  it("never runs two at once: a slow refresh skips the ticks it overlaps", async () => {
    let release: () => void = () => {};
    const r = refresher(() => new Promise<void>((res) => { release = res; }));
    const stop = startMarketSchedule(r, 1, silentLogger);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(r.refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(r.refresh).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(r.refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops when the stop function is called", async () => {
    const r = refresher(async () => "ran");
    const stop = startMarketSchedule(r, 1, silentLogger);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(r.refresh).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(r.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not start a refresh if stopped before the first one", async () => {
    const r = refresher(async () => "ran");
    const stop = startMarketSchedule(r, 1, silentLogger);
    stop();
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(r.refresh).not.toHaveBeenCalled();
  });

  it("logs and swallows a thrown error, and carries on", async () => {
    const error = vi.fn();
    const logger = { ...silentLogger, error } as unknown as typeof silentLogger;
    const r = refresher(async () => { throw new Error("boom"); });
    const stop = startMarketSchedule(r, 1, logger);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(r.refresh).toHaveBeenCalledTimes(2);
    stop();
  });
});
