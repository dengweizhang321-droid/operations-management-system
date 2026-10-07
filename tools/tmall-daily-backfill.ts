import { planTmallDailyGaps } from "./tmall-daily-gap-plan";

export const tmallBackfillMaximumDays = 14;
export const tmallBackfillMaximumMs = 30 * 60_000;
export const tmallSevenDayBackfillRoute = "/plan-seven-day-backfill-v1" as const;
export const tmallSevenDayBackfillPolicy = "seven-day-complete-v1" as const;
export type BackfillPlan = ReturnType<typeof planTmallDailyGaps> & {
  startDate: string; endDate: string; planPathBase64: string;
};
export type TmallBackfillState = {
  version: 1; executionId: string; storeKey: string; startedAt: number;
  startDate: string; endDate: string; cycle: number; currentDates: string[];
  completedDates: string[]; remainingDates: string[];
  missingProductDates: string[]; missingPromotionDates: string[];
  planPathsBase64: string[];
  status: "running" | "completed" | "budget_exhausted";
  budgetReason: "days" | "time" | null;
  policy?: typeof tmallSevenDayBackfillPolicy;
};

function missing(plan: BackfillPlan) {
  return [...new Set([...plan.missingProductDates, ...plan.missingPromotionDates])].sort();
}

function assertSevenDayPlan(plan: BackfillPlan) {
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  const count = (Date.parse(plan.endDate) - Date.parse(plan.startDate)) / 86400000 + 1;
  const gaps = missing(plan);
  if (!valid(plan.startDate) || !valid(plan.endDate) || !Number.isInteger(count) || count < 1 || count > 7
    || gaps.some(date => !valid(date) || date < plan.startDate || date > plan.endDate)
    || plan.selectedDates.length !== Math.min(gaps.length, 1)
    || (gaps.length > 0 && plan.selectedDates[0] !== gaps[0])) {
    throw new Error("天猫近七日补缺范围或最早缺口计划无效");
  }
}

/** Finite seven-date window: finish every available gap without a 30-minute cutoff. */
export function beginTmallSevenDayBackfill(executionId: string, storeKey: string, plan: BackfillPlan, now: number) {
  assertSevenDayPlan(plan);
  return { ...beginTmallBackfill(executionId, storeKey, plan, now), policy: tmallSevenDayBackfillPolicy };
}

export function beginTmallBackfill(executionId: string, storeKey: string, plan: BackfillPlan, now: number): TmallBackfillState {
  if (!/^\d{1,20}$/.test(executionId) || !/^tmall-[a-z0-9-]+$/.test(storeKey)
    || !Number.isFinite(now) || plan.selectedDates.length > 1) throw new Error("天猫补缺执行身份或计划无效");
  return {
    version: 1, executionId, storeKey, startedAt: now, startDate: plan.startDate, endDate: plan.endDate,
    cycle: 0, currentDates: [...plan.selectedDates], completedDates: [], remainingDates: missing(plan),
    missingProductDates: [...plan.missingProductDates], missingPromotionDates: [...plan.missingPromotionDates],
    planPathsBase64: [plan.planPathBase64], status: "running", budgetReason: null,
  };
}

// Called only after C and P have succeeded. The fresh coverage must also prove
// every completed date still exists in BOTH datasets before another day starts.
export function advanceTmallBackfill(state: TmallBackfillState, input: {
  executionId: string; storeKey: string; cycle: string | string[] | undefined; plan: BackfillPlan; now: number;
}): TmallBackfillState {
  const { plan, now } = input;
  const sevenDay = state.policy === tmallSevenDayBackfillPolicy;
  if (sevenDay) assertSevenDayPlan(plan);
  if (state.status !== "running" || input.executionId !== state.executionId || input.storeKey !== state.storeKey
    || input.cycle !== String(state.cycle) || plan.startDate !== state.startDate || plan.endDate !== state.endDate
    || !Number.isFinite(now) || now < state.startedAt || plan.selectedDates.length > 1) {
    throw new Error("天猫补缺执行、店铺、日期或循环序号不一致");
  }
  const remainingDates = missing(plan);
  const completedDates = [...state.completedDates, ...state.currentDates];
  if (new Set(completedDates).size !== completedDates.length
    || completedDates.some(date => remainingDates.includes(date))) {
    throw new Error("天猫补缺无进展或已完成日期覆盖回退，已停止循环");
  }
  const budgetReason = sevenDay ? null : completedDates.length >= tmallBackfillMaximumDays ? "days"
    : now - state.startedAt >= tmallBackfillMaximumMs ? "time" : null;
  const status = remainingDates.length === 0 ? "completed" : budgetReason ? "budget_exhausted" : "running";
  return {
    ...state, cycle: state.cycle + 1, completedDates, remainingDates,
    currentDates: status === "running" ? [...plan.selectedDates] : [],
    missingProductDates: [...plan.missingProductDates], missingPromotionDates: [...plan.missingPromotionDates],
    planPathsBase64: [...state.planPathsBase64, plan.planPathBase64], status,
    budgetReason: status === "budget_exhausted" ? budgetReason : null,
  };
}

export function publicTmallBackfill(state: TmallBackfillState) {
  const { planPathsBase64: _paths, ...summary } = state;
  void _paths;
  const sevenDay = state.policy === tmallSevenDayBackfillPolicy;
  return { ...summary, maximumDays: sevenDay ? 7 : tmallBackfillMaximumDays,
    maximumMinutes: sevenDay ? null : tmallBackfillMaximumMs / 60_000 };
}
