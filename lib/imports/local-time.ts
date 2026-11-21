/** Workflows always use fixed Beijing time, never the host zone; persisted plans keep their frozen zone. */
export const workflowFixedTimeZone = "Asia/Shanghai";
export function workflowTimeZone(): string {
  return workflowFixedTimeZone;
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
