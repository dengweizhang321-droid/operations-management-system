// Child-process probe for workflow-beijing-time.test.ts; run with TZ set to a non-Shanghai zone.
import { workflowLocalDate, workflowTimeZone } from "../lib/imports/local-time";
import { customerServicePeriod } from "../lib/jd/customer-service-workflow";
import { planJdPromotionN8nRun } from "../tools/jd-promotion-n8n-pipeline";

const now = new Date("2026-11-21T02:00:00Z");
const store = { storeKey: "jd-yiyong-director", enabled: true, promotionInitialStartDate: "2026-11-01" };
async function plan(endDate: string) {
  try {
    await planJdPromotionN8nRun({
      executionId: "123", root: process.cwd(), store, storeKey: store.storeKey,
      startDate: "2026-11-20", endDate, now, baseUrl: "http://localhost:3000",
      request: async () => { throw new Error("SENTINEL_COVERAGE_REACHED"); },
    } as never);
    return "ok";
  } catch (error) { return (error as Error).message; }
}
console.log(JSON.stringify({
  hostZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  zone: workflowTimeZone(),
  today: workflowLocalDate(now), yesterday: workflowLocalDate(now, -1),
  period: customerServicePeriod(now),
  beijingYesterdayAccepted: await plan("2026-11-20"),
  beijingTodayRejected: await plan("2026-11-21"),
}));
