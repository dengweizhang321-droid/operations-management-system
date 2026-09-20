import assert from "node:assert/strict";
import test from "node:test";
import { buildOperationsTimePrompt, getOperationsBusinessDates } from "../lib/ai/business-time";

test("AI relative dates follow the Shanghai day boundary", () => {
  assert.deepEqual(getOperationsBusinessDates(new Date("2026-07-29T15:59:59.000Z")), {
    timeZone: "Asia/Shanghai",
    today: "2026-07-29",
    yesterday: "2026-07-28",
  });
  assert.deepEqual(getOperationsBusinessDates(new Date("2026-07-29T16:00:00.000Z")), {
    timeZone: "Asia/Shanghai",
    today: "2026-07-30",
    yesterday: "2026-07-29",
  });
});

test("AI time prompt supplies explicit today and yesterday dates", () => {
  const prompt = buildOperationsTimePrompt(new Date("2026-07-29T16:00:00.000Z"));
  assert.match(prompt, /Asia\/Shanghai（UTC\+8）/);
  assert.match(prompt, /当前业务日期：2026-07-30/);
  assert.match(prompt, /“昨天”固定为 2026-07-29/);
  assert.match(prompt, /不得根据模型自身时间推测/);
});
