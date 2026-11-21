import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// 2026-11-21T02:00:00Z is 11-21 10:00 in Beijing but 11-20 18:00 in Los Angeles.
test("workflow dates are Beijing dates even when the host zone is America/Los_Angeles", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "tests/workflow-beijing-time-probe.ts"], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, TZ: "America/Los_Angeles" },
  });
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
  assert.equal(out.hostZone, "America/Los_Angeles");
  assert.equal(out.zone, "Asia/Shanghai");
  assert.equal(out.today, "2026-11-21");
  assert.equal(out.yesterday, "2026-11-20");
  assert.deepEqual(out.period, { scheduledDate: "2026-11-21", startDate: "2026-10-22", endDate: "2026-11-20" });
  assert.match(out.beijingYesterdayAccepted, /SENTINEL_COVERAGE_REACHED/);
  assert.match(out.beijingTodayRejected, /不晚于北京时间昨天/);
});
