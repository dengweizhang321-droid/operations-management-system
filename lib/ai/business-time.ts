export const OPERATIONS_TIME_ZONE = "Asia/Shanghai";

function isoDateInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addIsoDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getOperationsBusinessDates(now = new Date()) {
  const today = isoDateInTimeZone(now, OPERATIONS_TIME_ZONE);
  return {
    timeZone: OPERATIONS_TIME_ZONE,
    today,
    yesterday: addIsoDays(today, -1),
  };
}

export function buildOperationsTimePrompt(now = new Date()): string {
  const dates = getOperationsBusinessDates(now);
  return `业务时区：${dates.timeZone}（UTC+8）；当前业务日期：${dates.today}；“今天”固定为 ${dates.today}，“昨天”固定为 ${dates.yesterday}。涉及相对日期时必须使用这些服务端日期调用工具，不得根据模型自身时间推测。`;
}
