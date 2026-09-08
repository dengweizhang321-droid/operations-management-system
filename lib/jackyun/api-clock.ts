import type { JackyunServerClock } from "./direct-http";

/** Clock evidence comes from the authenticated, uncached baseline task response, before the POST. */
export function apiTaskWindowStart(clock: JackyunServerClock | undefined, exportIntentAt: string): string {
  if (!clock) throw new Error("API_SERVER_CLOCK_MISSING");
  const start = Date.parse(clock.requestStartedAt), end = Date.parse(clock.receivedAt), server = Date.parse(clock.serverDate), intent = Date.parse(exportIntentAt);
  if (![start, end, server, intent].every(Number.isFinite) || end < start || end - start > 5000
    || intent < end || intent - end > 5000 || Math.abs(server - end) > 10000 || server % 1000 !== 0) throw new Error("API_SERVER_CLOCK_UNVERIFIED");
  return clock.serverDate;
}
