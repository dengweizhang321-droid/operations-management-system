/** UI date adapter for the owning sales-period-v1 contract. Golden fixtures are
 * generated from store_overview.periods / sales.summary, including quarter-end.
 * Selection arithmetic still belongs to the original StatisticalPeriodPicker.
 */
import { resolveNetshopQueryPeriod, isNetshopIsoDate, NetshopQueryError } from "./query-contract";
import { periodKinds, type InsightPeriods, type InsightWindow } from "./insights-contract";

function fail(): never { throw new NetshopQueryError("invalid_date_range", "日期或期间意图不符合共享日历"); }
function addDays(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate()+offset);
  const result = date.toISOString().slice(0, 10); if (!isNetshopIsoDate(result)) return fail(); return result;
}
function lastDay(year: number, month: number): number { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
function moveMonth(day: string, offset: number): string {
  const [year, month, d] = day.split("-").map(Number), index = year*12+month-1+offset, y = Math.floor(index/12), m = index-y*12+1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(d, lastDay(y, m))).padStart(2, "0")}`;
}
function moveYear(day: string): string { const [year, month, d] = day.split("-").map(Number); return `${String(year-1).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(d, lastDay(year-1, month))).padStart(2, "0")}`; }
function window(startDate: string, endDate: string): InsightWindow {
  const parsed = resolveNetshopQueryPeriod(startDate, endDate, 731); if (!parsed) return fail(); return parsed;
}
export function resolveNetshopPeriods(startDate: string, endDate: string, kind = "custom", maximumCurrentDays = 366): InsightPeriods {
  if (!periodKinds.includes(kind as typeof periodKinds[number]) || ![366, 730].includes(maximumCurrentDays)) return fail();
  const current = resolveNetshopQueryPeriod(startDate, endDate, maximumCurrentDays); if (!current || Number(startDate.slice(0, 4)) < 2 || Number(endDate.slice(0, 4)) > 9998) return fail();
  const [year, month, startDay] = startDate.split("-").map(Number), endDay = Number(endDate.slice(8)), sameMonth = startDate.slice(0, 7) === endDate.slice(0, 7);
  const presets = { today: 1, yesterday: 1, last7: 7, last15: 15, last30: 30 };
  if (kind in presets && current.days !== presets[kind as keyof typeof presets] || kind === "month" && (!sameMonth || startDay !== 1)) return fail();
  let previousStart: string, previousEnd: string, rule: string;
  if (["last7", "last15", "last30", "rolling"].includes(kind)) {
    previousEnd = addDays(startDate, -1); previousStart = addDays(previousEnd, 1-current.days); rule = "紧邻之前的等长滚动区间";
  } else if (kind === "quarter") {
    const ey = Number(endDate.slice(0, 4)), em = Number(endDate.slice(5, 7)), qm = Math.floor((em-1)/3)*3+1;
    const quarterStart = `${ey}-${String(qm).padStart(2, "0")}-01`, quarterEnd = `${ey}-${String(qm+2).padStart(2, "0")}-${lastDay(ey, qm+2)}`;
    if (startDate !== quarterStart) return fail();
    previousStart = moveMonth(startDate, -3);
    const previousQuarterEnd = addDays(startDate, -1), elapsedEnd = addDays(previousStart, current.days-1);
    previousEnd = endDate === quarterEnd ? previousQuarterEnd : elapsedEnd < previousQuarterEnd ? elapsedEnd : previousQuarterEnd;
    rule = "现系统季度规则";
  } else if (current.days === 1) {
    previousStart = previousEnd = addDays(startDate, -1); rule = "前一日";
  } else if (sameMonth) {
    previousStart = moveMonth(startDate, -1);
    const [py, pm] = previousStart.split("-").map(Number);
    const wholeMonth = startDay === 1 && endDay === lastDay(year, month);
    previousEnd = wholeMonth ? `${py}-${String(pm).padStart(2, "0")}-${lastDay(py, pm)}` : moveMonth(endDate, -1);
    rule = wholeMonth ? "上一完整自然月" : "上月对应日期，月末收敛";
  } else {
    previousEnd = addDays(startDate, -1); previousStart = addDays(previousEnd, 1-current.days); rule = "紧邻之前的等长区间";
  }
  return { timezone: "Asia/Shanghai", rule, ruleVersion: "sales-period-v1", current, previous: window(previousStart, previousEnd), yearAgo: window(moveYear(startDate), moveYear(endDate)) };
}
