import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseCustomerServiceImport, parseSessionWorkbook } from "../lib/customer-service/import-service";

function workbookBytes(rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "咨询会话查询");
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

test("京东缺失指标短横线保留为null，零保持零，无效和负值仍拒绝", () => {
  const make = (value: unknown) => new Uint8Array(workbookBytes([
    ["咨询时间", "顾客", "新平均响应时间(S)", "会话时长(M)", "客户消息数", "客服消息数"],
    ["2026-10-05 23:37:17", "synthetic", value, "-", "-", 0],
  ]));
  const row = parseSessionWorkbook(make("-"))[0];
  assert.equal(row.responseSeconds, null);
  assert.equal(row.durationMinutes, null);
  assert.equal(row.customerMessageCount, null);
  assert.equal(row.agentMessageCount, 0);
  assert.equal(parseSessionWorkbook(make(0))[0].responseSeconds, 0);
  for (const invalid of [-1, "--", "未知", "NaN"]) assert.throws(() => parseSessionWorkbook(make(invalid)));
});

test("客服导入按咨询时间和脱敏顾客标识匹配聊天记录", () => {
  const sessions = workbookBytes([
    ["咨询时间", "客服", "顾客", "商品编号", "cid", "客户消息数", "客服消息数"],
    ["2026-07-21 21:50:11", "特睿思-小何", "jd_6accf6affe5db", 10227184452217, "cid-a", 2, 3],
    ["2026-07-21 21:51:00", "特睿思-小周", "jd_other", 10001, "cid-b", 1, 1],
  ]);
  const log = `/*****************以下为一通会话************************************/\n j****db 2026-07-21 21:50:11\n商品链接\n特睿思-小何 2026-07-21 21:50:15\n您好\nj****db 2026-07-21 21:50:18\n容量多大？\n`;
  const result = parseCustomerServiceImport(new Uint8Array(sessions), log);
  assert.equal(result.summary.matchedCount, 1);
  assert.equal(result.summary.sessionOnlyCount, 1);
  assert.equal(result.conversations[0]?.productSku, "10227184452217");
  assert.equal(result.conversations[0]?.messages.length, 3);
  assert.equal(result.conversations[0]?.matchConfidence, "exact");
});

test("同一咨询时间存在多个候选时不强行匹配", () => {
  const sessions = workbookBytes([
    ["咨询时间", "顾客", "cid"],
    ["2026-07-21 21:50:11", "jd_abc01", "cid-a"],
    ["2026-07-21 21:50:11", "jd_xyz02", "cid-b"],
  ]);
  const log = `/*****************以下为一通会话************************************/\n客户 2026-07-21 21:50:11\n咨询\n`;
  const result = parseCustomerServiceImport(new Uint8Array(sessions), log);
  assert.equal(result.summary.ambiguousCount, 1);
  assert.equal(result.summary.chatOnlyCount, 0);
  assert.equal(result.summary.sessionOnlyCount, 2);
  assert.equal(result.conversations.filter(row => row.matchStatus === "ambiguous").length, 1);
  assert.equal(result.conversations.length, result.summary.matchedCount + result.summary.timeOnlyMatchedCount
    + result.summary.sessionOnlyCount + result.summary.chatOnlyCount + result.summary.ambiguousCount);
});

test("仅聊天记录的去重键不受导出顺序影响", () => {
  const sessions = workbookBytes([
    ["咨询时间", "顾客", "cid"],
    ["2026-02-01 09:00:00", "jd_unrelated", "cid-unrelated"],
  ]);
  const first = `/*****************以下为一通会话************************************/\na****01 2026-02-02 10:00:00\n咨询A\n/*****************以下为一通会话************************************/\nb****02 2026-02-02 11:00:00\n咨询B\n`;
  const reversed = `/*****************以下为一通会话************************************/\nb****02 2026-02-02 11:00:00\n咨询B\n/*****************以下为一通会话************************************/\na****01 2026-02-02 10:00:00\n咨询A\n`;
  const firstKeys = parseCustomerServiceImport(new Uint8Array(sessions), first).conversations.filter((item) => item.matchStatus === "chat_only").map((item) => item.conversationKey).sort();
  const reversedKeys = parseCustomerServiceImport(new Uint8Array(sessions), reversed).conversations.filter((item) => item.matchStatus === "chat_only").map((item) => item.conversationKey).sort();
  assert.deepEqual(firstKeys, reversedKeys);
});
