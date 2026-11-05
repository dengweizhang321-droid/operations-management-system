import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  CUSTOMER_SERVICE_IMPORT_MESSAGE_LIMIT,
  CUSTOMER_SERVICE_IMPORT_MESSAGE_CONTENT_LIMIT,
  CUSTOMER_SERVICE_WARNING_LIMIT,
  matchCustomerServiceRecords,
  parseChatLog,
  parseCustomerServiceImport,
  parseSessionWorkbook,
  validateCustomerServiceConversationMessages,
} from "../lib/customer-service/import-service";
import { buildCustomerServiceDailyFiles } from "../tools/jd-customer-service-daily-files";

const timestamp = "2026-10-05 10:00:00";
function pair(messageCount: number, conversationCount = 1) {
  const rows = [["咨询时间", "顾客", "cid"]];
  const logs: string[] = [];
  for (let index = 0; index < conversationCount; index++) {
    const customer = `synthetic-${index}`;
    rows.push([timestamp, customer, `cid-${index}`]);
    logs.push("/* 以下为一通会话 */\n" + Array.from({ length: messageCount }, (_, message) =>
      `${customer} ${timestamp}\n合成消息${message}\n`).join(""));
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "会话");
  return { session: new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })), chat: logs.join("\n") };
}

test("200条无警告，201条保留完整匹配会话并只计一次警告", () => {
  assert.equal(CUSTOMER_SERVICE_IMPORT_MESSAGE_LIMIT, 200);
  for (const count of [200, 201]) {
    const input = pair(count);
    const parsed = parseCustomerServiceImport(input.session, input.chat);
    assert.equal(parsed.conversations.length, 1);
    assert.equal(parsed.conversations[0].conversationId, "cid-0");
    assert.equal(parsed.conversations[0].messages.length, count);
    assert.equal(parsed.conversations[0].messages.at(-1)?.content, `合成消息${count - 1}`);
    assert.equal(parsed.summary.matchedCount, 1);
    assert.equal(parsed.warningTotalCount, count === 201 ? 1 : 0);
    assert.equal(parsed.warnings.length, count === 201 ? 1 : 0);
    if (count === 201) assert.match(parsed.warnings[0], /第 1 条.*201 条.*200 条.*保留全部消息/);
    // Revalidation by import planners must neither reject nor double-count.
    assert.doesNotThrow(() => validateCustomerServiceConversationMessages(parsed.conversations));
    assert.equal(parsed.warningTotalCount, count === 201 ? 1 : 0);
  }
});

test("超限警告沿用50条摘要，完整总数和全部会话保留", () => {
  const input = pair(201, CUSTOMER_SERVICE_WARNING_LIMIT + 1);
  const parsed = parseCustomerServiceImport(input.session, input.chat);
  assert.equal(parsed.conversations.length, 51);
  assert.ok(parsed.conversations.every(row => row.messages.length === 201));
  assert.equal(parsed.warningTotalCount, 51);
  assert.equal(parsed.warnings.length, 50);
  assert.equal(parsed.warningsTruncated, true);
});

test("条数警告与既有匹配警告累加，未匹配内容也完整保留", () => {
  const input = pair(201, 2);
  const chat = input.chat.split("/* 以下为一通会话 */")[1].replaceAll("synthetic-0", "unknown");
  const parsed = parseCustomerServiceImport(input.session, chat);
  assert.equal(parsed.summary.ambiguousCount, 1);
  assert.equal(parsed.warningTotalCount, 2);
  assert.equal(parsed.warnings.length, 2);
  assert.match(parsed.warnings[0], /未自动拼接/);
  assert.match(parsed.warnings[1], /201 条.*200 条/);
  assert.equal(parsed.conversations.find(row => row.matchStatus === "ambiguous")?.messages.length, 201);
});

test("closure_evidence的201条输入保持原匹配结果和零条数警告", () => {
  const input = pair(201);
  const expected = matchCustomerServiceRecords(parseSessionWorkbook(input.session), parseChatLog(input.chat, "closure_evidence"));
  const warnings: string[] = [];
  assert.equal(validateCustomerServiceConversationMessages(expected.conversations, "closure_evidence", warning => warnings.push(warning)), undefined);
  assert.deepEqual(warnings, []);
  assert.deepEqual(parseCustomerServiceImport(input.session, input.chat, "closure_evidence"), expected);
  assert.equal(expected.warningTotalCount, 0);
  assert.equal(expected.conversations[0].messages.length, 201);
});

test("两种policy下单条内容、消息时间和会话总字节限制仍拒绝", () => {
  const input = pair(201);
  const original = parseCustomerServiceImport(input.session, input.chat).conversations;
  for (const policy of ["import", "closure_evidence"] as const) {
    for (const [change, code] of [
      [(rows: typeof original) => { rows[0].messages[0].content = "x".repeat(CUSTOMER_SERVICE_IMPORT_MESSAGE_CONTENT_LIMIT + 1); }, "MESSAGE_CONTENT_LIMIT_EXCEEDED"],
      [(rows: typeof original) => { rows[0].messages[0].sentAt = "invalid"; }, "MESSAGE_TIME_INVALID"],
      [(rows: typeof original) => { rows[0].messages.forEach(message => { message.content = "x".repeat(1_000); }); }, "CONVERSATION_BYTES_LIMIT_EXCEEDED"],
    ] as const) {
      const rows = structuredClone(original);
      change(rows);
      assert.throws(() => validateCustomerServiceConversationMessages(rows, policy), { code });
    }
  }
});

test("201条完整会话通过既有分天重解析和指纹等价检查", () => {
  const input = pair(201);
  const daily = buildCustomerServiceDailyFiles(input.session, new TextEncoder().encode(input.chat), {
    scheduledDate: "2026-10-06", startDate: "2026-09-06", endDate: "2026-10-05",
  });
  assert.equal(daily.files.length, 1);
  const parsed = parseCustomerServiceImport(daily.files[0].sessionBytes, new TextDecoder().decode(daily.files[0].chatBytes));
  assert.equal(parsed.conversations[0].messages.length, 201);
  assert.equal(parsed.warningTotalCount, 1);
});
