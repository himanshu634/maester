import type { Logger } from "../logger.js";

const FIRST_RUN_MS = 10_000;

/**
 * Runs `refresher.refresh()` 10 seconds after the call, then every `minutes`. Chained timeouts
 * with an in-flight flag: a pass that outlasts the interval makes the next tick skip rather than
 * overlap. An error is logged and the schedule carries on. Returns a function that stops it.
 */
export function startMarketSchedule(
  refresher: { refresh(): Promise<unknown> },
  minutes: number,
  logger: Logger,
): () => void {
  let stopped = false;
  let inFlight = false;
  let timer: NodeJS.Timeout | undefined;

  const arm = (ms: number) => {
    if (stopped) return;
    timer = setTimeout(tick, ms);
    timer.unref();
  };

  const tick = async () => {
    if (stopped) return;
    if (!inFlight) {
      inFlight = true;
      try {
        await refresher.refresh();
      } catch (err) {
        logger.error({ message: err instanceof Error ? err.message : String(err) }, "market refresh threw");
      } finally {
        inFlight = false;
      }
    }
    arm(minutes * 60_000);
  };

  arm(FIRST_RUN_MS);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
