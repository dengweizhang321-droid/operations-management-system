import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { customerServiceFailureCode, customerServiceFailureReason, customerServiceHelperError, planCustomerServiceRun, publicCustomerServicePlan } from "../tools/jd-customer-service-n8n-pipeline";
import { JdLoginGateError, jdLoginGateReason } from "../tools/jd-saved-login";
test("客服helper阶段必须属于已领取的同一execution", () => {
  assert.equal(customerServiceHelperError("ready", false, "/jd/customer-service/plan", "fixture", "fixture"), null);
  assert.equal(customerServiceHelperError("planned", false, "/jd/customer-service/run", "fixture", "fixture"), null);
  assert.equal(customerServiceHelperError("executed", false, "/jd/customer-service/verify", "fixture", "fixture"), null);
  for (const args of [
    ["ready", false, "/jd/customer-service/plan", "fixture", null],
    ["planned", false, "/jd/customer-service/run", "other", "fixture"],
    ["planned", true, "/jd/customer-service/run", "fixture", "fixture"],
    ["failed", false, "/jd/customer-service/run", "fixture", "fixture"],
    ["planned", false, "/jd/customer-service/plan", "fixture", "fixture"],
  ] as const) assert.ok(customerServiceHelperError(args[0], args[1], args[2], args[3], args[4]));
});
test("同一店铺未闭合计划不能被新execution或跨日覆盖", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jd-customer-plan-test-"));
  try {
    const plan = await planCustomerServiceRun(root, "fixture-1", new Date("2026-10-06T01:00:00Z"));
    assert.equal(plan.period.startDate, "2026-09-06");
    await assert.rejects(planCustomerServiceRun(root, "fixture-2", new Date("2026-10-07T01:00:00Z")), /PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION/);
    const saved = JSON.parse(await readFile(path.join(root, "outputs/jd-customer-service-pipeline/fixture-1.json"), "utf8"));
    assert.equal(saved.stage, "planned");
    assert.equal(saved.period.endDate, "2026-10-05");
    assert.equal("source" in publicCustomerServicePlan(plan), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("路径穿越execution被拒绝", async () => {
  await assert.rejects(planCustomerServiceRun(os.tmpdir(), "../other"), /INVALID_EXECUTION_ID/);
});
test("n8n候选禁用、固定9点和时间锚点，不包含旧日期或自动重放", async () => {
  const candidate = JSON.parse(await readFile(new URL("../automation/n8n/jd-customer-service-daily.candidate.workflow.json", import.meta.url), "utf8"));
  assert.equal(candidate.active, false);
  assert.equal(candidate.settings.timezone, undefined);
  assert.equal(candidate.nodes.find((node: {type: string}) => node.type === "n8n-nodes-base.scheduleTrigger").parameters.rule.interval[0].expression, "0 9 * * *");
  const names = new Set(candidate.nodes.map((node: {name: string}) => node.name));
  for (const group of Object.values(candidate.connections) as Array<{main: Array<Array<{node: string}>>}>)
    for (const edges of group.main) for (const edge of edges) assert.ok(names.has(edge.node));
  for (const node of candidate.nodes.filter((item: {type: string}) => item.type === "n8n-nodes-base.httpRequest")) {
    assert.equal(node.retryOnFail, false);
    assert.ok(node.parameters.headerParameters.parameters.some((header: {name: string}) => header.name === "X-TERUISI-SCHEDULED-AT"));
  }
  assert.ok(!JSON.stringify(candidate).includes("2026-08-20"));
});

// LOGIN_GATE_MANUAL_ACTION collapses nine login-gate causes and the message that
// told them apart is dropped on purpose (page text and signed URLs must not
// leak). The fixed reason token is the only thing left that can distinguish a
// captcha from a slow surface, so assert it survives — and that it stays a
// closed vocabulary rather than anything derived from the page.
test("客服登录闸失败保留可诊断的原因细分码，且只含固定词表", () => {
  const store = { storeKey: "jd-cuizhiwang-dengweizhang", shopName: "志高商用洗碗机旗舰店",
    loginMode: "windows_dpapi_credentials" as const };
  const reasons = new Set<string>();
  for (const [reason, message] of [
    ["challenge_present", `waiting_login：${store.shopName} 出现验证码或安全验证，需要人工处理`],
    ["surface_pending", `waiting_login：${store.shopName} 登录状态在有界等待后仍无法确认，需要人工检查`],
    ["session_absent", `waiting_login：${store.shopName} 独立 Chromium 尚未登录，请先人工登录`],
    ["credential_rejected", `waiting_login：${store.shopName} 本机加密凭据未被平台接受，请重新配置并人工核验`],
    ["temporarily_locked", `waiting_login：${store.shopName} 登录操作受限或过于频繁，需要稍后人工检查`],
    ["post_submit_unconfirmed", `waiting_login：${store.shopName} 自动提交后仍未完成登录，可能需要人工安全验证`],
  ] as const) {
    const error = new JdLoginGateError(message, reason);
    assert.equal(jdLoginGateReason(error), reason);
    // The collapsed code is unchanged: existing closure whitelists key off it.
    assert.equal(customerServiceFailureCode(error),
      reason === "surface_pending" ? "CUSTOMER_SERVICE_LOGIN_PENDING" : "LOGIN_GATE_MANUAL_ACTION");
    // This is what makes the cause recoverable downstream.
    assert.equal(customerServiceFailureReason(error), reason);
    reasons.add(reason);
  }
  assert.equal(reasons.size, 6);
  // No shop name, page text or URL may ride along in a reason token.
  for (const reason of reasons) assert.match(reason, /^[a-z][a-z_]{0,40}$/);

  // A non-login failure must not acquire a login reason.
  assert.equal(customerServiceFailureReason(new Error("导入未全部完成")), undefined);
});
