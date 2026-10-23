export type ReportWorkflowPeriod = "yesterday" | "last7" | "last30";

/** Complete Shanghai calendar days; UTC arithmetic avoids host timezone/DST drift. */
export function reportWorkflowDates(period: ReportWorkflowPeriod, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const anchor = Date.parse(`${today}T00:00:00Z`);
  const days = period === "yesterday" ? 1 : period === "last7" ? 7 : 30;
  const date = (offset: number) => new Date(anchor - offset * 86_400_000).toISOString().slice(0, 10);
  return { startDate: date(days), endDate: date(1) };
}
