import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  assertCustomerServicePeriod, customerServicePeriod, inspectCustomerServicePair,
  jdCustomerServiceWorkflow, recordCustomerServiceFailure,
  type CustomerServiceExportEvidence, type CustomerServiceFailureLedger,
} from "../lib/jd/customer-service-workflow";

const period = customerServicePeriod(new Date("2026-10-06T01:00:00Z"));
function fixture(at = "2026-10-05 10:00:00", agent = "志高亿用-测试") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["咨询时间", "客服", "顾客", "cid"], [at, agent, "synthetic_01", "fixture-only"],
  ]), "会话");
  const evidence: CustomerServiceExportEvidence = {
    ...period, storeKey: jdCustomerServiceWorkflow.storeKey, shopId: jdCustomerServiceWorkflow.shopId,
    shopName: jdCustomerServiceWorkflow.shopName, view: "list", queryConfirmed: true,
    unfiltered: true, exportCompleted: true,
  };
  return {
    period, sessionBytes: new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" })),
    chatBytes: new TextEncoder().encode(`/*****************以下为一通会话************************************/\nsynthetic_01 ${at}\n合成测试内容\n`),
    sessionEvidence: evidence, chatEvidence: { ...evidence, view: "messages" as const },
  };
}
test("滚动30天截止上海昨天，跨月、跨年和闰日正确", () => {
  assert.deepEqual(period, { scheduledDate: "2026-10-06", startDate: "2026-09-06", endDate: "2026-10-05" });
  assert.deepEqual(customerServicePeriod(new Date("2026-01-01T01:00:00Z")),
    { scheduledDate: "2026-01-01", startDate: "2025-12-02", endDate: "2025-12-31" });
  assert.deepEqual(customerServicePeriod(new Date("2024-03-01T01:00:00Z")),
    { scheduledDate: "2024-03-01", startDate: "2024-01-31", endDate: "2024-02-29" });
  assert.equal(customerServicePeriod(new Date("2026-10-05T16:00:00Z")).scheduledDate, "2026-10-06");
});
test("拒绝截图28天示例、无效日期和无效时钟", () => {
  assert.throws(() => assertCustomerServicePeriod({ ...period, startDate: "2026-09-08" }), /PERIOD_MISMATCH/);
  assert.throws(() => assertCustomerServicePeriod({ ...period, endDate: "2026-02-30" }), /INVALID_DATE/);
  assert.throws(() => customerServicePeriod(new Date(NaN)), /INVALID_DATE/);
});
test("同范围配对沿用现有解析器，不要求每天一定有咨询", () => {
  const parsed = inspectCustomerServicePair(fixture());
  assert.equal(parsed.summary.sessionCount, 1);
  assert.equal(parsed.summary.chatSessionCount, 1);
  assert.equal(parsed.summary.matchedCount, 1);
});
for (const field of ["storeKey", "shopId", "shopName"] as const) {
  test(`两份文件必须精确绑定同店身份：${field}`, () => {
    const input = fixture(); input.chatEvidence[field] = "wrong-store";
    assert.throws(() => inspectCustomerServicePair(input), /STORE_IDENTITY_MISMATCH/);
  });
}
test("拒绝另一日期范围和错误视图", () => {
  const input = fixture(); input.chatEvidence.startDate = "2026-09-07";
  assert.throws(() => inspectCustomerServicePair(input), /EXPORT_SCOPE_MISMATCH/);
  input.chatEvidence.startDate = period.startDate;
  input.sessionEvidence.view = "messages";
  assert.throws(() => inspectCustomerServicePair(input), /EXPORT_SCOPE_MISMATCH/);
});
for (const field of ["queryConfirmed", "unfiltered", "exportCompleted"] as const) {
  test(`缺少真实导出证据不导入：${field}`, () => {
    const input = fixture(); input.sessionEvidence[field] = false;
    assert.throws(() => inspectCustomerServicePair(input), /EXPORT_EVIDENCE_INCOMPLETE/);
  });
}
test("范围外、店铺重写和空文件拒绝", () => {
  assert.throws(() => inspectCustomerServicePair(fixture("2026-10-06 00:00:00")), /FILE_DATE_OUT_OF_SCOPE/);
  assert.throws(() => inspectCustomerServicePair(fixture("2026-09-05 23:59:59")), /FILE_DATE_OUT_OF_SCOPE/);
  assert.throws(() => inspectCustomerServicePair(fixture(undefined, "志高厨电-测试")), /IMPORT_SHOP_REWRITE_REJECTED/);
  const input = fixture(); input.chatBytes = new Uint8Array();
  assert.throws(() => inspectCustomerServicePair(input), /INVALID_FILE_SIZE/);
});
test("解析异常只产生固定错误码，不泄漏聊天内容或客户字段", () => {
  const input = fixture(); input.chatBytes = new Uint8Array([0xff, 0xff]);
  assert.throws(() => inspectCustomerServicePair(input), /^Error: PAIR_PARSE_REJECTED$/);
});
function ledger(): CustomerServiceFailureLedger { return { logicalRunId: "daily-20261006", period, failures: [] }; }
test("第4次独立失败触发AI和本人通知，前三次仅允许零导出效果重试", () => {
  let state = ledger();
  for (let index = 1; index <= 4; index++) {
    const decision = recordCustomerServiceFailure(state, `execution-${index}`, "safe_before_export");
    assert.equal(decision.retry, index < 4);
    assert.equal(decision.aiRequired, index === 4);
    assert.equal(decision.notifyOwner, index === 4);
    state = decision.ledger;
  }
  assert.throws(() => recordCustomerServiceFailure(state, "execution-5", "safe_before_export"), /FAILURE_LEDGER_TERMINAL/);
});
test("重复失败回调不累计次数，矛盾回调拒绝，原账本不修改", () => {
  const original = ledger();
  const first = recordCustomerServiceFailure(original, "execution-1", "safe_before_export");
  const second = recordCustomerServiceFailure(first.ledger, "execution-1", "safe_before_export");
  assert.equal(original.failures.length, 0);
  assert.equal(second.ledger.failures.length, 1);
  assert.equal(first.escalationKey, second.escalationKey);
  assert.throws(() => recordCustomerServiceFailure(first.ledger, "execution-1", "import_unknown"), /FAILURE_REPLAY_MISMATCH/);
});
test("提交未决、登录、校验和回查失败立即通知，不等待第4次或盲目重放", () => {
  for (const kind of ["export_unknown", "import_unknown", "login_or_identity", "validation", "verification"] as const) {
    const decision = recordCustomerServiceFailure(ledger(), "execution-1", kind);
    assert.equal(decision.retry, false);
    assert.equal(decision.notifyOwner, true);
    assert.equal(decision.aiRequired, false);
    assert.equal(recordCustomerServiceFailure(decision.ledger, "execution-2", "safe_before_export").retry, false);
  }
});
test("拒绝损坏账本，不把重复execution当作达到阈值", () => {
  const input = ledger(); input.failures = Array(4).fill({ executionId: "same", kind: "safe_before_export" });
  assert.throws(() => recordCustomerServiceFailure(input, "same", "safe_before_export"), /INVALID_FAILURE_LEDGER/);
});
