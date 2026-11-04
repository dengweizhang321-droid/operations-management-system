/** Workflows use the execution host's calendar; persisted plans keep their zone. */
export function workflowTimeZone(): string {
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!zone) throw new Error("WORKFLOW_LOCAL_TIMEZONE_UNAVAILABLE");
  new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
  return zone;
}

export function workflowLocalDate(now = new Date(), offsetDays = 0, timeZone = workflowTimeZone()): string {
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(offsetDays)) throw new Error("WORKFLOW_INVALID_CLOCK");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find(p => p.type === type)?.value);
  // UTC is only a calendar arithmetic carrier here, never the business zone.
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day") + offsetDays)).toISOString().slice(0, 10);
}
