import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import * as XLSX from "xlsx";
import type { AppPrincipal } from "../lib/auth/authorization";
import type { SalesConsumerReader } from "../lib/django/sales-consumer-reader";
import type { CustomerServiceParseResult } from "../lib/customer-service/import-service";

const testEnvironment: {
  DB?: unknown;
  TERUISI_DJANGO_SALES_READER_BASE_URL?: string;
  TERUISI_DJANGO_SALES_WRITER_BASE_URL?: string;
  TERUISI_DJANGO_INTERNAL_SECRET?: string;
} = {};
(globalThis as typeof globalThis & { __fourthBatchEnv?: typeof testEnvironment }).__fourthBatchEnv = testEnvironment;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        url: "data:text/javascript,export const env=globalThis.__fourthBatchEnv;",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  CUSTOMER_SERVICE_AI_MESSAGE_LIMIT,
  CUSTOMER_SERVICE_MESSAGE_BYTES_LIMIT,
  CUSTOMER_SERVICE_MESSAGE_CONTENT_LIMIT,
  CUSTOMER_SERVICE_MESSAGE_LIMIT,
  deleteCustomerServiceConversation,
  ensureCustomerServiceSchema,
  getCustomerServiceConversationById,
  getCustomerServiceConversationsByIds,
  listCustomerServiceBatches,
  listCustomerServiceConversations,
  planCustomerServiceImportPayloads,
  saveCustomerServiceImport,
  updateCustomerServiceConversationAnnotation,
} = await import("../lib/customer-service/database");
const {
  CUSTOMER_SERVICE_IMPORT_MESSAGE_CONTENT_LIMIT,
  CUSTOMER_SERVICE_IMPORT_MESSAGE_LIMIT,
  parseChatLog,
  parseSessionWorkbook,
} = await import("../lib/customer-service/import-service");
const {
  analyzeCustomerServiceConversations,
  applyCustomerServiceAnalysisResults,
  normalizeCustomerServiceAnalysisIds,
} = await import("../lib/customer-service/analysis");
const {
  deleteFinanceTarget,
  ensureFinanceSchema,
  getFinanceTargetOptions,
  listFinanceImportBatches,
  listFinanceTargets,
  upsertFinanceTarget,
} = await import("../lib/finance/database");
const {
  getFinanceAnalysis,
  MAX_FINANCE_ANALYSIS_MONTHS,
  MAX_FINANCE_SHOP_OPTIONS,
  resolveFinanceDimensionFilters,
} = await import("../lib/finance/analysis");
const { importFinanceReportBytes } = await import("../lib/finance/import-service");
const { importInventoryStockBytes } = await import("../lib/inventory/import-service");
const { importErpReferenceBytes } = await import("../lib/erp-reference/import-service");
const { ensureInventorySchema, listInventoryImportBatches } = await import("../lib/inventory/database");
const { ensureErpReferenceSchema, listErpReferenceBatches } = await import("../lib/erp-reference/database");
const { AuthorizationError, requireUnrestrictedDataScope } = await import("../lib/auth/authorization");
const { PublicApiError, importExecutionHttpStatus, safeApiErrorResponse } = await import("../lib/http/api-error");
const { importSalesLedgerBytes, validateSalesImportChannels, validateSalesImportDateRange } = await import("../lib/sales/import-service");

const unrestrictedAdmin: AppPrincipal = {
  email: "admin@example.com",
  displayName: "Admin",
  role: "admin",
  scope: null,
};

const emptySalesConsumerReader: SalesConsumerReader = {
  read: (async (_principal: AppPrincipal, request: Record<string, unknown>) => {
    if (request.operation === "customer_service_products") {
      const categories = Array.isArray(request.categories) ? request.categories as string[] : [];
      return {
        revision: "9:1",
        data: {
          rows: categories.map((category, index) => ({
            onlineSpecCode: `SPEC-${index}`,
            productCode: `ERP-${index}`,
            category,
            latestAt: "2026-08-01 00:00:00",
          })),
          truncated: false,
        },
      };
    }
    if (request.operation === "category_options") {
      return { revision: "9:1", data: { categories: [], truncated: false } };
    }
    throw new Error(`unexpected sales operation ${String(request.operation)}`);
  }) as SalesConsumerReader["read"],
};

type QueryRecord = { sql: string; values: SQLInputValue[]; returned?: number };

function sqliteAdapter(sqlite: DatabaseSync, queries: QueryRecord[] = []) {
  let batchTail: Promise<unknown> = Promise.resolve();
  return {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      return {
        bind(...nextValues: unknown[]) {
          values = nextValues as SQLInputValue[];
          return this;
        },
        async first<T>(column?: string) {
          queries.push({ sql, values: [...values] });
          const row = sqlite.prepare(sql).get(...values) as Record<string, unknown> | undefined;
          return (column ? row?.[column] : row ?? null) as T | null;
        },
        async all<T>() {
          const results = sqlite.prepare(sql).all(...values) as T[];
          queries.push({ sql, values: [...values], returned: results.length });
          return { results };
        },
        async run() {
          queries.push({ sql, values: [...values] });
          const result = sqlite.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const execute = async () => {
        sqlite.exec("BEGIN");
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      };
      const current = batchTail.then(execute, execute);
      batchTail = current.catch(() => undefined);
      return current;
    },
  };
}

function monthAt(index: number) {
  const date = new Date(Date.UTC(2023, index, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function customerImport(agent: string, content: string): CustomerServiceParseResult {
  return {
    conversations: [{
      sourceRowNumber: 2,
      consultedAt: "2026-08-05 10:00:00",
      customerId: "customer-1",
      customerAlias: "顾客一",
      consultationType: "售前",
      agent,
      transferredAgent: "",
      skillGroup: "",
      productSku: "SKU-1",
      productName: "测试商品",
      firstResponseAt: "2026-08-05 10:00:05",
      responseSeconds: 5,
      durationMinutes: 2,
      customerMessageCount: 1,
      agentMessageCount: 1,
      satisfaction: "满意",
      resolved: "是",
      conversationId: "conversation-1",
      conversationKey: "conversation-1",
      matchStatus: "matched" as const,
      matchConfidence: "exact" as const,
      chatStartedAt: "2026-08-05 10:00:00",
      chatEndedAt: "2026-08-05 10:02:00",
      chatCustomerAlias: "顾客一",
      messages: [{ sender: "顾客", sentAt: "2026-08-05 10:00:00", content }],
    }],
    summary: {
      sessionCount: 1,
      chatSessionCount: 1,
      matchedCount: 1,
      timeOnlyMatchedCount: 0,
      sessionOnlyCount: 0,
      chatOnlyCount: 0,
      ambiguousCount: 0,
    },
    warnings: [],
  };
}

function customerSessionWorkbook(overrides: Record<string, unknown> = {}) {
  const row = {
    咨询时间: "2026-08-05 10:00:00",
    顾客: "customer-1",
    首次响应时间: "2026-08-05 10:00:05",
    "新平均响应时间(S)": "",
    "会话时长(M)": "",
    客户消息数: "",
    客服消息数: "",
    ...overrides,
  };
  const worksheet = XLSX.utils.json_to_sheet([row]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "会话记录");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

test("客服导入严格验证上海自然时间，空数值为 null 且计数拒绝负数/小数", () => {
  const [valid] = parseSessionWorkbook(customerSessionWorkbook());
  assert.equal(valid.responseSeconds, null);
  assert.equal(valid.durationMinutes, null);
  assert.equal(valid.customerMessageCount, null);
  assert.equal(valid.agentMessageCount, null);
  assert.throws(() => parseSessionWorkbook(customerSessionWorkbook({ 咨询时间: "2026-02-31 25:99:99" })), /咨询时间.*有效/);
  assert.throws(() => parseSessionWorkbook(customerSessionWorkbook({ 首次响应时间: "2025-02-29 10:00:00" })), /首次响应时间.*有效/);
  assert.throws(() => parseSessionWorkbook(customerSessionWorkbook({ "新平均响应时间(S)": -1 })), /平均响应时间.*非负/);
  assert.throws(() => parseSessionWorkbook(customerSessionWorkbook({ "会话时长(M)": -0.5 })), /会话时长.*非负/);
  assert.throws(() => parseSessionWorkbook(customerSessionWorkbook({ 客户消息数: 1.5 })), /客户消息数.*非负整数/);
  assert.throws(() => parseSessionWorkbook(customerSessionWorkbook({ 客服消息数: -1 })), /客服消息数.*非负整数/);
  assert.throws(() => parseChatLog("/* 以下为一通会话 */\n顾客 2026-02-30 10:00:00\n内容"), /无效.*日期时间/);
  const leap = parseChatLog("/* 以下为一通会话 */\n顾客 2024-02-29 23:59:59\n内容");
  assert.equal(leap[0]?.startedAt, "2024-02-29 23:59:59");
});

test("客服消息与 D1 原子发布按单会话、总字节和语句数预算在数据库访问前拒绝", async () => {
  assert.throws(
    () => parseChatLog(`/* 以下为一通会话 */\n顾客 2026-08-05 10:00:00\n${"x".repeat(25 * 1024 * 1024)}`),
    new RegExp(`${CUSTOMER_SERVICE_IMPORT_MESSAGE_CONTENT_LIMIT} 字符`),
  );
  const tooManyMessages = customerImport("客服甲", "内容");
  tooManyMessages.conversations[0]!.messages = Array.from({ length: CUSTOMER_SERVICE_IMPORT_MESSAGE_LIMIT + 1 }, (_, index) => ({
    sender: "顾客",
    sentAt: `2026-08-05 10:${String(index % 60).padStart(2, "0")}:00`,
    content: "内容",
  }));
  assert.throws(() => planCustomerServiceImportPayloads("测试店铺", tooManyMessages.conversations), /消息数超过/);

  const boundary = customerImport("客服甲", "内容");
  boundary.conversations = Array.from({ length: 81 }, (_, index) => ({
    ...boundary.conversations[0]!,
    conversationKey: `boundary-${index}`,
  }));
  const boundaryPlan = planCustomerServiceImportPayloads("测试店铺", boundary.conversations);
  assert.equal(boundaryPlan.payloads.length, 2);
  assert.equal(boundaryPlan.statementCount, 7);

  const statementOverflow = customerImport("客服甲", "");
  statementOverflow.conversations = Array.from({ length: 3_600 }, (_, index) => ({
    ...statementOverflow.conversations[0]!,
    conversationKey: `statement-${index}`,
    messages: [],
  }));
  assert.throws(() => planCustomerServiceImportPayloads("测试店铺", statementOverflow.conversations), /发布语句.*安全上限/);

  const totalOverflow = customerImport("客服甲", "内容");
  const largeMessages = Array.from({ length: 32 }, (_, index) => ({
    sender: "顾客",
    sentAt: `2026-08-05 10:${String(index).padStart(2, "0")}:00`,
    content: "x".repeat(3_900),
  }));
  totalOverflow.conversations = Array.from({ length: 70 }, (_, index) => ({
    ...totalOverflow.conversations[0]!,
    conversationKey: `bytes-${index}`,
    messages: largeMessages,
  }));
  let databaseAccesses = 0;
  const untouchedDatabase = {
    prepare() { databaseAccesses += 1; throw new Error("database must remain untouched"); },
    batch() { databaseAccesses += 1; throw new Error("database must remain untouched"); },
  } as never;
  await assert.rejects(
    saveCustomerServiceImport({
      shopName: "测试店铺",
      sessionFileName: "large.xlsx",
      chatFileName: "large.log",
      fileHash: "f".repeat(64),
      parsed: totalOverflow,
    }, untouchedDatabase),
    (error: unknown) => error instanceof PublicApiError && error.status === 422 && /8MB/.test(error.message),
  );
  assert.equal(databaseAccesses, 0, "领域 planner 必须在 schema、指纹、范围锁和事实写入前拒绝");
});

test("客服直传与分片对发布预算拒绝只写有界 rejected-attempt 审计", async () => {
  for (const relativePath of [
    "../app/api/customer-service/import/route.ts",
    "../app/api/customer-service/import/chunks/route.ts",
  ]) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    const planner = source.indexOf("planCustomerServiceImportPayloads(", source.indexOf("const resolvedShopName"));
    const save = source.indexOf("saveCustomerServiceImport(", planner);
    assert.ok(planner >= 0 && save > planner, `${relativePath} 必须在保存前执行预算 planner`);
    assert.match(source.slice(planner, save), /recordRejectedImportAttempt[\s\S]*CUSTOMER_SERVICE_PUBLISH_BUDGET_REJECTED/);
  }
});

test("客服列表仅返回摘要，详情消息有条数、单条和总字节硬上限", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const queries: QueryRecord[] = [];
  const db = sqliteAdapter(sqlite, queries) as never;
  testEnvironment.DB = db;
  await ensureCustomerServiceSchema(db);
  const messages = Array.from({ length: 250 }, (_, index) => ({
    sender: `客服-${index}`,
    sentAt: `2026-08-01 10:${String(index % 60).padStart(2, "0")}:00`,
    content: "客服内容".repeat(600),
  }));
  sqlite.prepare(`INSERT INTO customer_service_conversations (
    conversation_key, first_import_batch_id, last_import_batch_id, shop_name,
    consulted_at, customer_id, customer_alias, agent, match_status, match_confidence,
    messages_json
  ) VALUES (?, 'batch-1', 'batch-1', '测试店铺', ?, 'customer-1', '顾客一', '客服甲', 'matched', 'high', ?)`)
    .run("测试店铺:conversation-1", "2026-08-01 23:59:59", JSON.stringify(messages));
  sqlite.prepare(`INSERT INTO customer_service_conversations (
    conversation_key, first_import_batch_id, last_import_batch_id, shop_name,
    consulted_at, customer_id, customer_alias, agent, match_status, match_confidence,
    messages_json
  ) VALUES (?, 'batch-2', 'batch-2', '测试店铺', ?, 'customer-2', '顾客二', '客服甲', 'matched', 'high', '[]')`)
    .run("测试店铺:conversation-2", "2026-08-02 00:00:00");

  const page = await listCustomerServiceConversations({
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    page: 1,
    pageSize: 10,
    includeOptions: false,
  }, unrestrictedAdmin, { salesReader: emptySalesConsumerReader });
  assert.equal(page.pagination.total, 1, "结束日期应使用下一日零点的左闭右开边界");
  assert.equal(page.items[0]?.messages.length, 0);
  assert.equal(page.items[0]?.messageTotalCount, 250);
  assert.equal(page.items[0]?.messagesTruncated, true);
  assert.doesNotMatch(JSON.stringify(page), /客服内容/);

  queries.length = 0;
  const detail = await getCustomerServiceConversationById(page.items[0]!.id);
  assert.ok(detail.messages.length <= CUSTOMER_SERVICE_MESSAGE_LIMIT);
  assert.ok(detail.messages.every((item) => item.content.length <= CUSTOMER_SERVICE_MESSAGE_CONTENT_LIMIT));
  assert.ok(new TextEncoder().encode(JSON.stringify(detail.messages)).byteLength <= CUSTOMER_SERVICE_MESSAGE_BYTES_LIMIT);
  assert.equal(detail.messageTotalCount, 250);
  assert.equal(detail.messagesTruncated, true);
  const detailQueries = queries.filter(({ sql }) => /customer_service_conversations/i.test(sql));
  assert.equal(detailQueries.length, 1, "详情摘要、version 与有界消息必须共用一个读快照");
  assert.ok(detailQueries.every(({ sql }) => !/SELECT\s+\*/i.test(sql)), "详情查询不得把完整 messages_json 拉入后端");
  assert.ok(detailQueries.some(({ sql }) => /json_each/i.test(sql) && /substr/i.test(sql)), "消息必须在 SQL 投影层截断");

  queries.length = 0;
  const [aiConversation] = await getCustomerServiceConversationsByIds([page.items[0]!.id]);
  assert.ok(aiConversation.messages.length <= CUSTOMER_SERVICE_AI_MESSAGE_LIMIT);
  assert.equal(aiConversation.messageTotalCount, 250);
  assert.equal(aiConversation.messagesTruncated, true);
  assert.ok(queries.filter(({ sql }) => /customer_service_conversations/i.test(sql)).every(({ sql }) => !/SELECT\s+\*/i.test(sql)));

  queries.length = 0;
  await listCustomerServiceConversations({ query: "%_", page: 1, pageSize: 10, includeOptions: false }, unrestrictedAdmin, { salesReader: emptySalesConsumerReader });
  assert.ok(queries.some(({ sql }) => /LIKE \? ESCAPE '\\'/i.test(sql)), "LIKE 元字符必须按字面值转义");

  await assert.rejects(
    listCustomerServiceConversations({ startDate: "2026-02-30", page: 1, pageSize: 10 }, unrestrictedAdmin, { salesReader: emptySalesConsumerReader }),
    (error: unknown) => error instanceof PublicApiError && error.status === 400,
  );
  for (const invalidFilters of [
    { page: 1.5, pageSize: 10 },
    { page: Number.POSITIVE_INFINITY, pageSize: 10 },
    { page: 10_001, pageSize: 10 },
    { page: 1, pageSize: 101 },
    { page: 1, pageSize: 10, query: " 单 " },
    { page: 1, pageSize: 10, query: "长".repeat(101) },
  ]) {
    await assert.rejects(
      listCustomerServiceConversations(invalidFilters, unrestrictedAdmin, { salesReader: emptySalesConsumerReader }),
      (error: unknown) => error instanceof PublicApiError && error.status === 400,
    );
  }

  const routeSource = await readFile(new URL("../app/api/customer-service/conversations/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(routeSource, /get\("page(?:Size)?"\)\s*\|\|/, "显式 0/空页码不得被静默改成默认值");
  sqlite.close();
});

test("客服枚举筛选 fail-closed 且最大合法组合保持 D1 bind≤100", async () => {
  const invalidInputs = [
    { statuses: ["matched", "invalid"] },
    { robotScopes: ["exclude_robot", "invalid"] },
    { problemTypes: ["商品咨询", "invalid"] },
    { conversionStatuses: ["unknown", "invalid"] },
  ];
  for (const input of invalidInputs) {
    await assert.rejects(
      listCustomerServiceConversations({ ...input, page: 1, pageSize: 20 }, unrestrictedAdmin, { salesReader: emptySalesConsumerReader }),
      (error: unknown) => error instanceof PublicApiError && error.status === 400,
    );
  }
  const sqlite = new DatabaseSync(":memory:");
  const queries: QueryRecord[] = [];
  const db = sqliteAdapter(sqlite, queries) as never;
  testEnvironment.DB = db;
  const values = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index}`);
  await listCustomerServiceConversations({
    shopNames: values("店铺", 50),
    agents: values("客服", 50),
    statuses: ["matched", "session_only", "chat_only", "ambiguous"],
    robotScopes: ["robot_only", "contains_robot", "exclude_robot"],
    problemTypes: ["商品咨询", "价格优惠", "物流发货", "售后维修", "退换货", "安装使用", "发票开票", "催单改单", "其他"],
    conversionStatuses: ["converted", "not_converted", "unknown"],
    categories: values("品类", 50),
    query: "测试",
    skuIds: values("SKU", 100).join(","),
    spuIds: values("SPU", 100).join(","),
    page: 1,
    pageSize: 100,
    includeOptions: false,
  }, unrestrictedAdmin, { salesReader: emptySalesConsumerReader });
  assert.ok(queries.length > 0);
  assert.ok(queries.every((query) => query.values.length <= 100), `客服查询最大 bind 数为 ${Math.max(...queries.map((query) => query.values.length))}`);
  sqlite.close();
});

test("客服人工标注与 AI 共用 expectedVersion 栅栏", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite) as never;
  testEnvironment.DB = db;
  await ensureCustomerServiceSchema(db);
  const inserted = sqlite.prepare(`INSERT INTO customer_service_conversations (
    conversation_key, first_import_batch_id, last_import_batch_id, consulted_at,
    customer_id, customer_alias, agent, match_status, match_confidence
  ) VALUES ('conversation-cas', 'batch', 'batch', '2026-08-01 12:00:00', '', '', '', 'matched', 'high')`).run();
  const id = Number(inserted.lastInsertRowid);

  const updated = await updateCustomerServiceConversationAnnotation(id, { summaryText: "已处理", analysisSource: "manual" }, 1);
  assert.equal(updated.version, 2);
  assert.match(updated.updatedAt, /^\d{4}-\d{2}-\d{2}/);
  await assert.rejects(
    updateCustomerServiceConversationAnnotation(id, { summaryText: "迟到写入", analysisSource: "ai" }, 1),
    (error: unknown) => error instanceof PublicApiError && error.status === 409 && error.code === "version_conflict",
  );
  assert.equal((await getCustomerServiceConversationById(id)).version, 2);
  sqlite.close();
});

test("客服导入 UPSERT 推进 version，消息与版本由单 SQL 快照读取", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const queries: QueryRecord[] = [];
  const db = sqliteAdapter(sqlite, queries) as never;
  testEnvironment.DB = db;
  const first = await saveCustomerServiceImport({
    shopName: "测试店铺",
    sessionFileName: "session-v1.xlsx",
    chatFileName: "chat-v1.log",
    fileHash: "1".repeat(64),
    parsed: customerImport("客服甲", "旧消息"),
  }, db);
  assert.equal(first.status, "imported");
  queries.length = 0;
  const [oldSnapshot] = await getCustomerServiceConversationsByIds([1]);
  assert.equal(oldSnapshot.version, 1);
  assert.equal(oldSnapshot.messages[0]?.content, "旧消息");
  const snapshotQueries = queries.filter(({ sql }) => /FROM customer_service_conversations/i.test(sql));
  assert.equal(snapshotQueries.length, 1, "消息、摘要和 version 必须在同一 SQLite 读快照中返回");
  assert.match(snapshotQueries[0]!.sql, /customer_service_conversation_versions[\s\S]*json_each/i);

  const changed = await saveCustomerServiceImport({
    shopName: "测试店铺",
    sessionFileName: "session-v2.xlsx",
    chatFileName: "chat-v2.log",
    fileHash: "2".repeat(64),
    parsed: customerImport("客服乙", "新消息"),
  }, db);
  assert.equal(changed.status, "imported");
  const current = await getCustomerServiceConversationById(oldSnapshot.id);
  assert.equal(current.version, 2, "导入 UPSERT 必须触发 companion version bump");
  assert.equal(current.messages[0]?.content, "新消息");
  await assert.rejects(
    updateCustomerServiceConversationAnnotation(oldSnapshot.id, {
      summaryText: `基于${oldSnapshot.messages[0]?.content}的迟到结论`,
      analysisSource: "ai",
    }, oldSnapshot.version),
    (error: unknown) => error instanceof PublicApiError && error.code === "version_conflict",
  );
  sqlite.close();
});

test("客服海量告警在响应、批次和指纹审计前统一有界摘要", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite) as never;
  testEnvironment.DB = db;
  const parsed = customerImport("客服甲", "普通消息");
  const oversizedWarning = `告警-${"长".repeat(1_000)}`;
  parsed.warnings = Array(26_000).fill(oversizedWarning);
  const saved = await saveCustomerServiceImport({
    shopName: "告警测试店铺",
    sessionFileName: "warnings.xlsx",
    chatFileName: "warnings.log",
    fileHash: "9".repeat(64),
    parsed,
  }, db);
  assert.equal(saved.warningSummary.warningTotalCount, 26_000);
  assert.ok(saved.warningSummary.warnings.length <= 50);
  assert.equal(saved.warningSummary.warningsTruncated, true);
  assert.ok(saved.warningSummary.warnings.every((warning) => warning.length <= 500));
  assert.ok(new TextEncoder().encode(JSON.stringify(saved.warningSummary.warnings)).byteLength <= 32 * 1024);
  const batchWarnings = String(sqlite.prepare("SELECT warnings_json FROM customer_service_import_batches").get()?.warnings_json ?? "");
  assert.ok(new TextEncoder().encode(batchWarnings).byteLength <= 34 * 1024);
  assert.equal(JSON.parse(batchWarnings).totalCount, 26_000);
  const metadataRows = sqlite.prepare(`SELECT warnings_json FROM import_content_attempts
    WHERE domain = 'customer-service'`).all() as Array<{ warnings_json: string }>;
  assert.ok(metadataRows.length > 0);
  assert.ok(metadataRows.every((row) => new TextEncoder().encode(row.warnings_json).byteLength <= 34 * 1024));
  assert.ok(metadataRows.every((row) => !row.warnings_json.includes("长".repeat(501))));
  assert.ok(metadataRows.every((row) => JSON.parse(row.warnings_json).totalCount === 26_000));
  sqlite.close();
});

test("客服删除只接受精确 ID + expectedVersion，禁用自由文本批删", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = sqliteAdapter(sqlite) as never;
  testEnvironment.DB = db;
  await ensureCustomerServiceSchema(db);
  const inserted = sqlite.prepare(`INSERT INTO customer_service_conversations (
    conversation_key, first_import_batch_id, last_import_batch_id, consulted_at,
    customer_id, customer_alias, agent, match_status, match_confidence
  ) VALUES ('delete-cas', 'batch', 'batch', '2026-08-01 12:00:00', '客服', '', '', 'matched', 'high')`).run();
  const id = Number(inserted.lastInsertRowid);
  await updateCustomerServiceConversationAnnotation(id, { summaryText: "并发变化", analysisSource: "manual" }, 1);
  await assert.rejects(
    deleteCustomerServiceConversation(id, 1, "admin@test", "清理重复测试会话"),
    (error: unknown) => error instanceof PublicApiError && error.code === "version_conflict",
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM customer_service_deletion_audits").get()?.total, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM customer_service_conversations WHERE id = ?").get(id)?.total, 1);
  const deleted = await deleteCustomerServiceConversation(id, 2, "admin@test", "清理重复测试会话");
  assert.equal(deleted.id, id);
  assert.equal(deleted.deleted, true);
  assert.match(deleted.auditId, /^[0-9a-f-]{36}$/i);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM customer_service_conversation_versions WHERE conversation_id = ?").get(id)?.total, 0);
  assert.deepEqual({ ...sqlite.prepare(`SELECT conversation_id, conversation_key, actor, old_version, expected_version, reason
    FROM customer_service_deletion_audits WHERE audit_id = ?`).get(deleted.auditId)! }, {
    conversation_id: id,
    conversation_key: "delete-cas",
    actor: "admin@test",
    old_version: 2,
    expected_version: 2,
    reason: "清理重复测试会话",
  });
  const route = await readFile(new URL("../app/api/customer-service/conversations/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /deleteCustomerServiceConversationsByText|body\.text/);
  assert.match(route, /deleteCustomerServiceConversation\(id, expectedVersion, principal\.email, reason\)/);

  const protectedInsert = sqlite.prepare(`INSERT INTO customer_service_conversations (
    conversation_key, first_import_batch_id, last_import_batch_id, consulted_at,
    customer_id, customer_alias, agent, match_status, match_confidence
  ) VALUES ('delete-audit-failure', 'batch', 'batch', '2026-08-01 12:00:00', '', '', '', 'matched', 'high')`).run();
  const protectedId = Number(protectedInsert.lastInsertRowid);
  sqlite.exec(`CREATE TRIGGER reject_customer_deletion_audit
    BEFORE INSERT ON customer_service_deletion_audits
    BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END`);
  await assert.rejects(
    deleteCustomerServiceConversation(protectedId, 1, "admin@test", "审计失败时不得删除"),
    /injected audit failure/,
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM customer_service_conversations WHERE id = ?").get(protectedId)?.total, 1);
  sqlite.close();
});

test("AI 批量写回在中间版本冲突时返回逐项可观测结果", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite) as never;
  testEnvironment.DB = db;
  await ensureCustomerServiceSchema(db);
  const ids: number[] = [];
  const insert = sqlite.prepare(`INSERT INTO customer_service_conversations (
    conversation_key, first_import_batch_id, last_import_batch_id, consulted_at,
    customer_id, customer_alias, agent, match_status, match_confidence
  ) VALUES (?, 'batch', 'batch', '2026-08-01 12:00:00', '', '', '', 'matched', 'high')`);
  for (let index = 0; index < 8; index += 1) {
    ids.push(Number(insert.run(`analysis-${index}`).lastInsertRowid));
  }
  const expectedVersions = new Map(ids.map((id) => [id, 1]));
  await updateCustomerServiceConversationAnnotation(ids[3]!, { summaryText: "人工抢先保存", analysisSource: "manual" }, 1);

  const results = await applyCustomerServiceAnalysisResults(ids.map((id) => ({
    id,
    robotScope: "exclude_robot" as const,
    problemType: "商品咨询" as const,
    conversionStatus: "unknown" as const,
    serviceIssues: "未发现明显服务问题",
    summaryText: `AI-${id}`,
  })), expectedVersions);
  assert.equal(results.length, 8);
  assert.equal(results.filter((item) => item.status === "updated").length, 7);
  assert.deepEqual(results.find((item) => item.id === ids[3]), {
    id: ids[3],
    status: "conflict",
    code: "version_conflict",
  });
  const rows = sqlite.prepare(`SELECT conversation.id, conversation.summary_text, version_state.version
    FROM customer_service_conversations conversation
    JOIN customer_service_conversation_versions version_state ON version_state.conversation_id = conversation.id
    ORDER BY conversation.id`).all() as Array<{ id: number; summary_text: string; version: number }>;
  assert.equal(rows.find((row) => row.id === ids[3])?.summary_text, "人工抢先保存");
  assert.ok(rows.filter((row) => row.id !== ids[3]).every((row) => row.summary_text === `AI-${row.id}` && row.version === 2));
  const route = await readFile(new URL("../app/api/customer-service/analyze/route.ts", import.meta.url), "utf8");
  assert.match(route, /status:\s*partial \? 207 : 200/);
  sqlite.close();
});

test("客服 analyze 严格保留请求 ID 集合并逐项披露缺失项", async () => {
  for (const invalid of [["1"], [1.5], [0], [Number.NaN], Array.from({ length: 9 }, (_, index) => index + 1)]) {
    assert.throws(
      () => normalizeCustomerServiceAnalysisIds(invalid),
      (error: unknown) => error instanceof PublicApiError && error.status === 400,
    );
  }
  assert.deepEqual(normalizeCustomerServiceAnalysisIds([2, 1, 2]), [2, 1]);
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite) as never;
  testEnvironment.DB = db;
  await ensureCustomerServiceSchema(db);
  const result = await analyzeCustomerServiceConversations([999, 999], {
    email: "admin@test",
    displayName: "Admin",
    role: "admin",
    scope: null,
  });
  assert.equal(result.requested, 1);
  assert.equal(result.incomplete, 1);
  assert.deepEqual(result.results, [{ id: 999, status: "not_found", code: "not_found" }]);
  const route = await readFile(new URL("../app/api/customer-service/analyze/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /\.map\(Number\)|\.slice\(0,\s*8\)/);
  assert.match(route, /status:\s*partial \? 207 : 200/);
  sqlite.close();
});

test("客服导入历史在 SQL 层分页并限制告警体积", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const queries: QueryRecord[] = [];
  const db = sqliteAdapter(sqlite, queries) as never;
  testEnvironment.DB = db;
  await ensureCustomerServiceSchema(db);
  const insert = sqlite.prepare(`INSERT INTO customer_service_import_batches (
    id, shop_name, session_file_name, chat_file_name, file_hash, status, warnings_json
  ) VALUES (?, '测试店铺', 'session.xlsx', 'chat.log', ?, 'completed', ?)`);
  const warnings = Array.from({ length: 60 }, (_, index) => `告警-${index}-${"长".repeat(600)}`);
  for (let index = 0; index < 105; index += 1) insert.run(`batch-${String(index).padStart(3, "0")}`, `hash-${index}`, JSON.stringify(warnings));
  queries.length = 0;
  const result = await listCustomerServiceBatches({ page: 2, pageSize: 100 });
  assert.equal(result.items.length, 5);
  assert.equal(result.pagination.total, 105);
  assert.ok((result.items[0]?.warnings.length ?? 0) <= 50);
  assert.equal(result.items[0]?.warningTotalCount, 60);
  assert.equal(result.items[0]?.warningsTruncated, true);
  assert.ok(result.items[0]?.warnings.every((warning) => warning.length <= 500));
  assert.ok(queries.some(({ sql }) => /json_each/i.test(sql) && /substr/i.test(sql)), "告警应在 SQL 投影层截断");
  assert.ok(queries.every(({ sql }) => !/SELECT\s+\*\s+FROM\s+customer_service_import_batches/i.test(sql)), "历史列表不得读取完整批次行");
  sqlite.close();
});

test("财务目标创建、修改、删除均执行 CAS，0061 只包含前向 version 列", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = sqliteAdapter(sqlite) as never;
  await ensureFinanceSchema(db);
  const base = {
    id: "target-1",
    periodType: "month" as const,
    periodKey: "2026-08",
    platform: "京东",
    shopName: "测试店铺",
    category: "净水器",
    manager: "负责人",
    salesTargetCents: 100_000,
    profitTargetCents: 10_000,
    smallMarginBps: 1200,
    inventoryCleanupTargetCents: 0,
    promotionFeeRatioBps: 500,
    stagnantInventoryTargetCents: 0,
  };
  const created = await upsertFinanceTarget(db, base);
  assert.equal(created.version, 1);
  const updated = await upsertFinanceTarget(db, { ...base, expectedVersion: 1, salesTargetCents: 120_000 });
  assert.equal(updated.version, 2);
  await assert.rejects(
    upsertFinanceTarget(db, { ...base, expectedVersion: 1, salesTargetCents: 130_000 }),
    (error: unknown) => error instanceof PublicApiError && error.status === 409,
  );
  await assert.rejects(
    deleteFinanceTarget(db, base.id, 1, "admin@test", "删除过期目标"),
    (error: unknown) => error instanceof PublicApiError && error.status === 409,
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM finance_target_scoped_deletion_audits").get()?.total, 0);
  const deleted = await deleteFinanceTarget(db, base.id, 2, "admin@test", "删除过期目标");
  assert.equal(deleted.deleted, true);
  assert.match(deleted.auditId, /^[0-9a-f-]{36}$/i);
  assert.equal(sqlite.prepare("SELECT platform, reason FROM finance_target_scoped_deletion_audits WHERE audit_id = ?").get(deleted.auditId)?.platform, "京东");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM finance_target_scoped_versions WHERE target_id = ?").get(base.id)?.total, 0);
  const recreated = await upsertFinanceTarget(db, base);
  assert.equal(recreated.version, 1, "同 ID 删除后重建必须从全新的 version=1 开始");
  sqlite.exec(`CREATE TRIGGER reject_finance_target_deletion_audit
    BEFORE INSERT ON finance_target_scoped_deletion_audits
    BEGIN SELECT RAISE(ABORT, 'injected finance audit failure'); END`);
  await assert.rejects(
    deleteFinanceTarget(db, base.id, 1, "admin@test", "审计失败时不得删除"),
    /injected finance audit failure/,
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM finance_targets_scoped WHERE id = ?").get(base.id)?.total, 1);

  const migration = await readFile(new URL("../drizzle/0061_customer_finance_optimistic_concurrency.sql", import.meta.url), "utf8");
  assert.match(migration, /customer_service_conversations[\s\S]*version/i);
  assert.match(migration, /finance_targets[\s\S]*version/i);
  assert.doesNotMatch(migration, /\b(?:DROP\s+TABLE|DELETE\s+FROM)\b/i);
  sqlite.close();
});

test("0061 与 runtime 双顺序重放保留旧数据和最大 version", async () => {
  const migration = (await readFile(new URL("../drizzle/0061_customer_finance_optimistic_concurrency.sql", import.meta.url), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
  const legacy = new DatabaseSync(":memory:");
  legacy.exec(`CREATE TABLE customer_service_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_key TEXT NOT NULL UNIQUE,
    shop_name TEXT NOT NULL DEFAULT '测试店铺', last_import_batch_id TEXT NOT NULL DEFAULT '',
    consulted_at TEXT NOT NULL DEFAULT '', agent TEXT NOT NULL DEFAULT '', match_status TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO customer_service_conversations (
    conversation_key, shop_name, last_import_batch_id, consulted_at, agent, match_status, version
  ) VALUES ('测试店铺:legacy', '测试店铺', '', '2026-08-01 00:00:00', '', 'matched', 5);
  CREATE TABLE finance_targets (
    id TEXT PRIMARY KEY NOT NULL, period_type TEXT NOT NULL, period_key TEXT NOT NULL,
    shop_name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', manager TEXT NOT NULL DEFAULT '',
    sales_target_cents INTEGER NOT NULL DEFAULT 0, profit_target_cents INTEGER NOT NULL DEFAULT 0,
    small_margin_bps INTEGER NOT NULL DEFAULT 0, inventory_cleanup_target_cents INTEGER NOT NULL DEFAULT 0,
    promotion_fee_ratio_bps INTEGER NOT NULL DEFAULT 0, stagnant_inventory_target_cents INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(period_type, period_key, shop_name, category)
  );
  INSERT INTO finance_targets (id, period_type, period_key, shop_name, category, version)
  VALUES ('legacy-target', 'month', '2026-08', '测试店铺', '', 5)`);
  const firstRuntime = sqliteAdapter(legacy) as never;
  testEnvironment.DB = firstRuntime;
  await Promise.all([ensureCustomerServiceSchema(firstRuntime), ensureFinanceSchema(firstRuntime)]);
  legacy.exec(migration);
  const secondRuntime = sqliteAdapter(legacy) as never;
  testEnvironment.DB = secondRuntime;
  await Promise.all([ensureCustomerServiceSchema(secondRuntime), ensureFinanceSchema(secondRuntime)]);
  assert.equal(legacy.prepare("SELECT version FROM customer_service_conversation_versions").get()?.version, 5);
  assert.equal(legacy.prepare("SELECT version FROM finance_target_scoped_versions").get()?.version, 5);
  assert.equal(legacy.prepare("SELECT platform FROM finance_targets_scoped WHERE id = 'legacy-target'").get()?.platform, "");
  await assert.rejects(
    updateCustomerServiceConversationAnnotation(1, { summaryText: "迟到写入", analysisSource: "manual" }, 1),
    (error: unknown) => error instanceof PublicApiError && error.code === "version_conflict",
  );
  await assert.rejects(
    upsertFinanceTarget(secondRuntime, { id: "legacy-target", expectedVersion: 1, periodType: "month", periodKey: "2026-08", platform: "京东", shopName: "测试店铺" }),
    (error: unknown) => error instanceof PublicApiError && error.code === "version_conflict",
  );
  legacy.prepare("DELETE FROM finance_targets_scoped WHERE id = 'legacy-target'").run();
  const replayRuntime = sqliteAdapter(legacy) as never;
  await ensureFinanceSchema(replayRuntime);
  assert.equal(legacy.prepare("SELECT COUNT(*) AS total FROM finance_targets_scoped WHERE id = 'legacy-target'").get()?.total, 0, "legacy ledger 必须阻止已删除目标被重复回填");
  legacy.close();

  const migrationFirst = new DatabaseSync(":memory:");
  migrationFirst.exec(`CREATE TABLE customer_service_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_key TEXT NOT NULL UNIQUE,
    shop_name TEXT NOT NULL DEFAULT '测试店铺', last_import_batch_id TEXT NOT NULL DEFAULT '',
    consulted_at TEXT NOT NULL DEFAULT '', agent TEXT NOT NULL DEFAULT '', match_status TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE finance_targets (
    id TEXT PRIMARY KEY NOT NULL, period_type TEXT NOT NULL, period_key TEXT NOT NULL,
    shop_name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', manager TEXT NOT NULL DEFAULT '',
    sales_target_cents INTEGER NOT NULL DEFAULT 0, profit_target_cents INTEGER NOT NULL DEFAULT 0,
    small_margin_bps INTEGER NOT NULL DEFAULT 0, inventory_cleanup_target_cents INTEGER NOT NULL DEFAULT 0,
    promotion_fee_ratio_bps INTEGER NOT NULL DEFAULT 0, stagnant_inventory_target_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(period_type, period_key, shop_name, category)
  )`);
  migrationFirst.exec(migration);
  const migrationFirstDb = sqliteAdapter(migrationFirst) as never;
  await Promise.all([ensureCustomerServiceSchema(migrationFirstDb), ensureFinanceSchema(migrationFirstDb)]);
  migrationFirst.exec(migration);
  assert.equal(migrationFirst.prepare("SELECT COUNT(*) AS total FROM customer_service_conversation_versions").get()?.total, 0);
  assert.equal(migrationFirst.prepare("SELECT COUNT(*) AS total FROM finance_target_scoped_versions").get()?.total, 0);
  migrationFirst.close();
});

test("财务目标在 SQL 层分页并返回真实 total/returned/truncated", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite) as never;
  await ensureFinanceSchema(db);
  const insert = sqlite.prepare(`INSERT INTO finance_targets_scoped (
    id, period_type, period_key, platform, shop_name, category, manager
  ) VALUES (?, 'month', '2026-08', '京东', '测试店铺', ?, '')`);
  for (let index = 0; index < 105; index += 1) insert.run(`target-${index}`, `品类-${index}`);
  const result = await listFinanceTargets(db, { page: 2, pageSize: 100 });
  assert.equal(result.items.length, 5);
  assert.deepEqual(result.pagination, { page: 2, pageSize: 100, total: 105, returned: 5, truncated: false });
  await assert.rejects(
    listFinanceTargets(db, { page: 1, pageSize: 101 }),
    (error: unknown) => error instanceof PublicApiError && error.status === 400,
  );
  sqlite.close();
});

test("财务、库存和 ERP 导入历史都可严格分页访问第 105 条", async () => {
  const cases = [
    {
      ensure: ensureFinanceSchema,
      insertSql: `INSERT INTO finance_import_batches (
        id, source, file_name, file_size_bytes, file_hash, status
      ) VALUES (?, 'test', 'test.xlsx', 1, ?, 'completed')`,
      list: (db: never) => listFinanceImportBatches(db, { page: 2, pageSize: 100 }),
    },
    {
      ensure: ensureInventorySchema,
      insertSql: `INSERT INTO inventory_import_batches (
        id, source, file_name, file_size_bytes, file_hash, sheet_name, snapshot_date, status
      ) VALUES (?, 'test', 'test.xlsx', 1, ?, 'Sheet1', '2026-08-01', 'completed')`,
      list: (db: never) => listInventoryImportBatches(db, { page: 2, pageSize: 100 }),
    },
    {
      ensure: ensureErpReferenceSchema,
      insertSql: `INSERT INTO erp_reference_import_batches (
        id, source_key, source_label, file_name, file_size_bytes, file_hash, sheet_name, status
      ) VALUES (?, 'products', '货品', 'test.xlsx', 1, ?, 'Sheet1', 'completed')`,
      list: (db: never) => listErpReferenceBatches(db, undefined, { page: 2, pageSize: 100 }),
    },
  ] as const;
  for (const [caseIndex, item] of cases.entries()) {
    const sqlite = new DatabaseSync(":memory:");
    const db = sqliteAdapter(sqlite) as never;
    await item.ensure(db);
    const insert = sqlite.prepare(item.insertSql);
    for (let index = 0; index < 105; index += 1) {
      const identity = `${caseIndex}-${String(index).padStart(3, "0")}`;
      insert.run(`batch-${identity}`, `hash-${identity}`);
    }
    const result = await item.list(db);
    assert.equal(result.items.length, 5);
    assert.deepEqual(result.pagination, {
      page: 2,
      pageSize: 100,
      total: 105,
      returned: 5,
      truncated: false,
    });
    sqlite.close();
  }
});

test("财务分析最多选择 24 个真实月份且 SQL 不再读取全部历史明细", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const queries: QueryRecord[] = [];
  const db = sqliteAdapter(sqlite, queries) as never;
  await ensureFinanceSchema(db);
  const months = Array.from({ length: 130 }, (_, index) => monthAt(index));
  const insert = sqlite.prepare(`INSERT INTO finance_months (
    month, batch_id, sheet_name, business_name, source_file_name, status, shop_count, subject_count, imported_at
  ) VALUES (?, ?, 'Sheet1', '测试业务', ?, 'completed', 0, 0, CURRENT_TIMESTAMP)`);
  months.forEach((month) => insert.run(month, `batch-${month}`, `${month}.xlsx`));
  queries.length = 0;

  const analysis = await getFinanceAnalysis(db, { allMonths: true });
  assert.equal(analysis.selectedMonths.length, MAX_FINANCE_ANALYSIS_MONTHS);
  assert.equal(analysis.selection?.truncated, true);
  assert.equal(analysis.months.length, 120);
  assert.deepEqual(analysis.monthPagination, { total: 130, returned: 120, truncated: true });
  const lineQueries = queries.filter((query) => /FROM finance_lines/.test(query.sql) && /month IN/.test(query.sql));
  assert.ok(lineQueries.length >= 3);
  assert.ok(lineQueries.every((query) => !query.values.includes(months[0]!)), "明细 SQL 不应绑定未被分析的最早月份");
  await assert.rejects(
    getFinanceAnalysis(db, { requestedMonths: ["2099-01"] }),
    (error: unknown) => error instanceof PublicApiError && error.status === 400,
  );
  const insertProject = sqlite.prepare(`INSERT INTO finance_targets_scoped (
    id, period_type, period_key, platform, shop_name, category, manager
  ) VALUES (?, 'project', ?, '', '', '', '')`);
  for (let index = 0; index < 105; index += 1) insertProject.run(`project-${index}`, `项目-${index}`);
  const boundedProjects = await getFinanceAnalysis(db, { requestedMonths: [months.at(-1)!] });
  assert.equal(boundedProjects.targets?.projects.length, 100);
  assert.deepEqual(boundedProjects.targets?.projectPagination, { total: 105, returned: 100, truncated: true });
  const targetQueries = queries.filter((query) => /FROM finance_targets/.test(query.sql));
  assert.ok(targetQueries.some((query) => /period_type = 'project'[\s\S]*LIMIT 100/.test(query.sql)));
  assert.ok(targetQueries.some((query) => /period_type = 'month'[\s\S]*period_key IN/.test(query.sql)));
  sqlite.close();
});

test("财报只在显式允许的初始缺失月份上回退到最新 completed 月份", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite) as never;
  await ensureFinanceSchema(db);
  const insert = sqlite.prepare(`INSERT INTO finance_months (
    month, batch_id, sheet_name, business_name, source_file_name, status, shop_count, subject_count, imported_at
  ) VALUES (?, ?, 'Sheet1', '测试业务', ?, 'completed', 0, 0, CURRENT_TIMESTAMP)`);
  insert.run("2026-06", "batch-2026-06", "2026-06.xlsx");
  insert.run("2026-07", "batch-2026-07", "2026-07.xlsx");

  await assert.rejects(
    getFinanceAnalysis(db, { requestedMonths: ["2026-08"] }),
    (error: unknown) => error instanceof PublicApiError
      && error.status === 400
      && /财务月份尚未导入/.test(error.message),
    "ordinary explicit selection must keep the strict missing-month contract",
  );
  const fallback = await getFinanceAnalysis(db, {
    requestedMonths: ["2026-08"],
    fallbackToLatestCompletedMonth: true,
  });
  assert.equal(fallback.selectedMonth, "2026-07");
  assert.deepEqual(fallback.selectedMonths, ["2026-07"]);
  assert.equal(fallback.selection?.fallbackApplied, true);
  assert.deepEqual(fallback.selection?.requestedMonths, ["2026-08"]);
  assert.equal(fallback.sync?.dataCutoffMonth, "2026-07");

  const alreadyImported = await getFinanceAnalysis(db, {
    requestedMonths: ["2026-06"],
    fallbackToLatestCompletedMonth: true,
  });
  assert.equal(alreadyImported.selectedMonth, "2026-06", "a valid requested month must never be replaced by the latest month");
  assert.equal(alreadyImported.selection?.fallbackApplied, false);
  await assert.rejects(
    getFinanceAnalysis(db, { requestedMonths: ["2026-13"], fallbackToLatestCompletedMonth: true }),
    (error: unknown) => error instanceof PublicApiError && error.status === 400 && /必须使用 YYYY-MM/.test(error.message),
    "fallback must not weaken month syntax validation",
  );
  sqlite.close();
});

test("财务平台 KPI 全量聚合但店铺、目标明细与费用科目保持有界", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const queries: QueryRecord[] = [];
  const db = sqliteAdapter(sqlite, queries) as never;
  await ensureFinanceSchema(db);
  sqlite.prepare(`INSERT INTO finance_months (
    month, batch_id, sheet_name, business_name, source_file_name, status
  ) VALUES ('2026-08', 'batch', 'Sheet1', '测试业务', 'finance.xlsx', 'completed')`).run();
  const insertLine = sqlite.prepare(`INSERT INTO finance_lines (
    month, section, metric_key, subject_name, scope_key, scope_type, scope_name,
    group_name, value_type, amount_cents, rate_bps, raw_value, source_row_count, sort_order, is_total
  ) VALUES ('2026-08', 'summary', 'net_sales', '净销售额', ?, 'shop', ?,
    '京东', 'amount', 100, NULL, '1', 1, 1, 1)`);
  for (let index = 0; index < 600; index += 1) {
    const shop = `店铺-${String(index).padStart(3, "0")}`;
    insertLine.run(`shop:${shop}:net_sales`, shop);
  }
  const targetOptions = await getFinanceTargetOptions(db, unrestrictedAdmin, { salesReader: emptySalesConsumerReader });
  assert.equal(targetOptions.shops.length, 300);
  assert.deepEqual(targetOptions.pagination.shops, { total: 600, returned: 300, truncated: true });
  const insertExpense = sqlite.prepare(`INSERT INTO finance_lines (
    month, section, metric_key, subject_name, scope_key, scope_type, scope_name,
    group_name, value_type, amount_cents, rate_bps, raw_value, source_row_count, sort_order, is_total
  ) VALUES ('2026-08', 'kingdee', '', ?, ?, 'business', '测试业务',
    '', 'amount', 1, NULL, '1', 1, ?, 0)`);
  for (let index = 0; index < 600; index += 1) insertExpense.run(`费用-${index}`, `expense:${index}`, index);
  queries.length = 0;
  const filtered = await getFinanceAnalysis(db, { requestedMonths: ["2026-08"], platformNames: ["京东"] });
  assert.equal(filtered.current?.netSalesCents, 60_000, "KPI 必须包含全部 600 店，而非前 500 店");
  assert.equal(filtered.shops?.length, 500);
  const aggregateQuery = queries.find((query) => /GROUP BY month, metric_key/.test(query.sql));
  assert.ok(aggregateQuery && (aggregateQuery.returned ?? Infinity) <= 12, "主 KPI 查询只能返回 month×metric 聚合行");
  assert.ok(queries.every((query) => (query.returned ?? 0) <= 501 || /rankedShopSummary|scope_name IN \(SELECT/.test(query.sql)));

  const insertTarget = sqlite.prepare(`INSERT INTO finance_targets_scoped (
    id, period_type, period_key, platform, shop_name, category, manager, sales_target_cents
  ) VALUES (?, 'month', '2026-08', '京东', ?, '', '', 100)`);
  for (let index = 0; index < 1_005; index += 1) insertTarget.run(`target-${index}`, `目标店-${index}`);
  const targets = await getFinanceAnalysis(db, { requestedMonths: ["2026-08"] });
  assert.equal(targets.targets?.month.targetCount, 1_005);
  assert.equal(targets.targets?.month.salesTargetCents, 100_500);
  assert.deepEqual(targets.targets?.periodPagination, { total: 1_005, returned: 1_000, truncated: true });
  assert.equal(targets.expenses?.length, 500);
  assert.deepEqual(targets.expensePagination, { total: 600, returned: 500, truncated: true });
  sqlite.close();
});

test("财务同名店全程使用 platform+shop 复合身份，旧空平台目标仅在名称唯一时兼容", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = sqliteAdapter(sqlite) as never;
  await ensureFinanceSchema(db);
  sqlite.prepare(`INSERT INTO finance_months (
    month, batch_id, sheet_name, business_name, source_file_name, status
  ) VALUES ('2026-08', 'same-name-batch', 'Sheet1', '测试业务', 'same-name.xlsx', 'completed')`).run();
  const insertLine = sqlite.prepare(`INSERT INTO finance_lines (
    month, section, metric_key, subject_name, scope_key, scope_type, scope_name,
    group_name, value_type, amount_cents, rate_bps, raw_value, source_row_count, sort_order, is_total
  ) VALUES ('2026-08', 'summary', 'net_sales', '净销售额', ?, 'shop', ?, ?,
    'amount', ?, NULL, '1', 1, 1, 1)`);
  insertLine.run("jd:same:net_sales", "同名店", "京东", 1_000);
  insertLine.run("tmall:same:net_sales", "同名店", "天猫", 2_000);
  insertLine.run("jd:unique:net_sales", "唯一店", "京东", 300);
  insertLine.run("jd:cross-month:net_sales", "跨月同名店", "京东", 400);
  sqlite.prepare(`INSERT INTO finance_lines (
    month, section, metric_key, subject_name, scope_key, scope_type, scope_name,
    group_name, value_type, amount_cents, rate_bps, raw_value, source_row_count, sort_order, is_total
  ) VALUES ('2026-07', 'summary', 'net_sales', '净销售额', 'tmall:cross-month:net_sales', 'shop', '跨月同名店',
    '天猫', 'amount', 500, NULL, '1', 1, 1, 1)`).run();

  await upsertFinanceTarget(db, {
    id: "jd-same-target", periodType: "month", periodKey: "2026-08", platform: "京东", shopName: "同名店", salesTargetCents: 10_000,
  });
  await upsertFinanceTarget(db, {
    id: "tmall-same-target", periodType: "month", periodKey: "2026-08", platform: "天猫", shopName: "同名店", salesTargetCents: 20_000,
  });
  sqlite.prepare(`INSERT INTO finance_targets_scoped (
    id, period_type, period_key, platform, shop_name, category, manager, sales_target_cents
  ) VALUES ('legacy-ambiguous', 'month', '2026-08', '', '同名店', '', '', 90_000),
           ('legacy-unique', 'month', '2026-08', '', '唯一店', '', '', 3_000),
           ('legacy-cross-month', 'month', '2026-08', '', '跨月同名店', '', '', 40_000)`).run();

  const jd = await getFinanceAnalysis(db, { requestedMonths: ["2026-08"], platformNames: ["京东"] });
  assert.equal(jd.current?.netSalesCents, 1_700);
  assert.deepEqual(jd.shops.map((shop) => [shop.groupName, shop.name, shop.actual.netSalesCents]), [
    ["京东", "同名店", 1_000],
    ["京东", "跨月同名店", 400],
    ["京东", "唯一店", 300],
  ]);
  assert.equal(jd.targets?.month.salesTargetCents, 13_000, "京东目标只能包含京东显式目标和全局唯一旧目标");
  assert.equal(jd.targets?.month.targetCount, 2);
  assert.equal(jd.targets?.legacyCompatibility.excluded, 2, "历史月份出现过另一平台也必须视为全局歧义");
  const jdSame = await getFinanceAnalysis(db, {
    requestedMonths: ["2026-08"],
    shopKeys: [JSON.stringify(["京东", "同名店"])],
  });
  assert.equal(jdSame.current?.netSalesCents, 1_000);
  assert.equal(jdSame.shops.length, 1);
  assert.equal(jdSame.shops[0]?.groupName, "京东");
  assert.equal(jdSame.targets?.month.salesTargetCents, 10_000);

  const tmall = await getFinanceAnalysis(db, { requestedMonths: ["2026-08"], platformNames: ["天猫"] });
  assert.equal(tmall.current?.netSalesCents, 2_000);
  assert.deepEqual(tmall.shops.map((shop) => [shop.groupName, shop.name]), [["天猫", "同名店"]]);
  assert.equal(tmall.targets?.month.salesTargetCents, 20_000);
  assert.equal(tmall.targets?.month.targetCount, 1);
  assert.equal(tmall.targets?.legacyCompatibility.excluded, 2);
  sqlite.close();
});

test("财务维度筛选不会因无效值或第 501 个选项退化为全事业部", () => {
  const options = Array.from({ length: MAX_FINANCE_SHOP_OPTIONS + 1 }, (_, index) => ({
    name: `店铺-${String(index + 1).padStart(3, "0")}`,
    platform: index % 2 === 0 ? "京东" : "天猫",
    key: JSON.stringify([index % 2 === 0 ? "京东" : "天猫", `店铺-${String(index + 1).padStart(3, "0")}`]),
  }));
  assert.throws(
    () => resolveFinanceDimensionFilters(options, [], ["不存在的店铺"]),
    (error: unknown) => error instanceof PublicApiError && error.status === 400,
  );
  assert.throws(
    () => resolveFinanceDimensionFilters(options, ["京东", "不存在的平台"], [options[0]!.key]),
    (error: unknown) => error instanceof PublicApiError && error.status === 400,
  );
  const beyondVisiblePage = resolveFinanceDimensionFilters(options, [], [options[500]!.key]);
  assert.equal(beyondVisiblePage.hasDimensionFilter, true);
  assert.deepEqual([...beyondVisiblePage.shopFilter], [options[500]!.key]);
});

test("销售权威日期严格校验，直传和分片均在创建会话或发布前拒绝伪日期", async () => {
  assert.equal(validateSalesImportDateRange("2026-02-30", "2026-03-01").ok, false);
  assert.equal(validateSalesImportDateRange("2024-02-29", "2024-02-29").ok, true);
  assert.equal(validateSalesImportDateRange("2025-02-29", "2025-02-29").ok, false);
  const leapRange = validateSalesImportDateRange("2024-02-28", "2024-02-29");
  assert.deepEqual(leapRange.ok ? { endExclusive: leapRange.endExclusive, dayCount: leapRange.dayCount } : null, {
    endExclusive: "2024-03-01",
    dayCount: 2,
  });
  assert.equal(validateSalesImportDateRange("2025-01-01", "2026-01-02").ok, false);

  const direct = await readFile(new URL("../app/api/imports/sales/route.ts", import.meta.url), "utf8");
  assert.ok(direct.indexOf("validateSalesImportDateRange(expectedStartDate, expectedEndDate)") < direct.indexOf("entry.arrayBuffer()"));
  const chunks = await readFile(new URL("../app/api/imports/sales/chunks/route.ts", import.meta.url), "utf8");
  const initValidation = chunks.indexOf("validateSalesImportDateRange(expectedStartDate, expectedEndDate)");
  const completeValidation = chunks.indexOf("validateSalesImportDateRange(expectedStartDate, expectedEndDate)", initValidation + 1);
  assert.ok(initValidation >= 0 && initValidation < chunks.indexOf("beginSalesUpload("));
  assert.ok(completeValidation >= 0 && completeValidation < chunks.indexOf("claimSalesUpload(principal, uploadId)"));
});

test("销售部分台账只能声明去重后的白名单精确渠道范围", async () => {
  assert.deepEqual(validateSalesImportChannels(null), { ok: true, channels: null });
  assert.deepEqual(validateSalesImportChannels(JSON.stringify([
    "阿里巴巴-亿用店",
    "阿里巴巴-炊之王店",
    "阿里巴巴-震坤行",
  ])), {
    ok: true,
    channels: ["阿里巴巴-炊之王店", "阿里巴巴-亿用店", "阿里巴巴-震坤行"],
  });
  assert.equal(validateSalesImportChannels(["阿里巴巴-炊之王店", "阿里巴巴-炊之王店"]).ok, false);
  assert.equal(validateSalesImportChannels(["阿里巴巴-振坤行"]).ok, false);

  const direct = await readFile(new URL("../app/api/imports/sales/route.ts", import.meta.url), "utf8");
  assert.ok(direct.indexOf("validateSalesImportChannels(expectedChannels)") < direct.indexOf("entry.arrayBuffer()"));
  const chunks = await readFile(new URL("../app/api/imports/sales/chunks/route.ts", import.meta.url), "utf8");
  const initValidation = chunks.indexOf("validateSalesImportChannels(body.expectedChannels)");
  const completeValidation = chunks.indexOf("validateSalesImportChannels(body.expectedChannels)", initValidation + 1);
  assert.ok(initValidation >= 0 && initValidation < chunks.indexOf("beginSalesUpload("));
  assert.ok(completeValidation >= 0 && completeValidation < chunks.indexOf("claimSalesUpload(principal, uploadId)"));
});

test("导入结果状态码区分并发、校验、体积和依赖故障，直传/分片共用映射", async () => {
  assert.equal(importExecutionHttpStatus({ ok: false, errors: [{ code: "IMPORT_SCOPE_CHANGED" }] }), 409);
  assert.equal(importExecutionHttpStatus({ ok: false, errors: [{ code: "INVALID_XLSX_SIGNATURE" }] }), 422);
  assert.equal(importExecutionHttpStatus({ ok: false, errors: [{ code: "PAYLOAD_TOO_LARGE" }] }), 413);
  assert.equal(importExecutionHttpStatus({ ok: false, errors: [{ code: "MIGRATION_REQUIRED" }] }), 503);
  assert.equal(importExecutionHttpStatus({ ok: true, status: "duplicate" }), 200);
  assert.equal(importExecutionHttpStatus({ ok: true, status: "imported" }), 201);
  for (const relativePath of [
    "../app/api/imports/sales/route.ts",
    "../app/api/imports/sales/chunks/route.ts",
    "../app/api/imports/finance/route.ts",
    "../app/api/imports/inventory/route.ts",
    "../app/api/imports/inventory/chunks/route.ts",
    "../app/api/imports/erp/route.ts",
    "../app/api/imports/erp/chunks/route.ts",
  ]) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /importExecutionHttpStatus\(/, `${relativePath} must use the shared status contract`);
    assert.doesNotMatch(source, /payload\.ok\s*\?[\s\S]{0,80}:\s*422|result\.ok\s*\?[\s\S]{0,80}:\s*422/);
  }
});

test("销售、财务、库存和 ERP 畸形工作簿只返回受控解析错误", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite) as never;
  testEnvironment.DB = db;
  const malformedWorkbook = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0xaa, 0x55]);
  const originalFetch = globalThis.fetch;
  const previousReader = testEnvironment.TERUISI_DJANGO_SALES_READER_BASE_URL;
  const previousWriter = testEnvironment.TERUISI_DJANGO_SALES_WRITER_BASE_URL;
  const previousSecret = testEnvironment.TERUISI_DJANGO_INTERNAL_SECRET;
  testEnvironment.TERUISI_DJANGO_SALES_READER_BASE_URL = "http://127.0.0.1:8001";
  testEnvironment.TERUISI_DJANGO_SALES_WRITER_BASE_URL = "http://127.0.0.1:8002";
  testEnvironment.TERUISI_DJANGO_INTERNAL_SECRET = "s".repeat(32);
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false,
    status: "rejected",
    message: "销售 Excel 文件解析失败，请确认文件格式和模板",
    code: "XLSX_PARSE_ERROR",
    warnings: [],
    errors: [{ code: "XLSX_PARSE_ERROR", message: "销售 Excel 文件解析失败，请确认文件格式和模板" }],
    errorCount: 1,
  }), { status: 422, headers: { "content-type": "application/json" } });
  let salesResult: Awaited<ReturnType<typeof importSalesLedgerBytes>>;
  try {
    salesResult = await importSalesLedgerBytes({
      principal: unrestrictedAdmin,
      bytes: malformedWorkbook,
      fileName: "sales.xlsx",
      fileSizeBytes: malformedWorkbook.byteLength,
      expectedStartDate: "2026-08-01",
      expectedEndDate: "2026-08-01",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousReader === undefined) delete testEnvironment.TERUISI_DJANGO_SALES_READER_BASE_URL;
    else testEnvironment.TERUISI_DJANGO_SALES_READER_BASE_URL = previousReader;
    if (previousWriter === undefined) delete testEnvironment.TERUISI_DJANGO_SALES_WRITER_BASE_URL;
    else testEnvironment.TERUISI_DJANGO_SALES_WRITER_BASE_URL = previousWriter;
    if (previousSecret === undefined) delete testEnvironment.TERUISI_DJANGO_INTERNAL_SECRET;
    else testEnvironment.TERUISI_DJANGO_INTERNAL_SECRET = previousSecret;
  }
  const results = [salesResult, ...await Promise.all([
    importFinanceReportBytes({ bytes: malformedWorkbook, fileName: "finance.xlsx", fileSizeBytes: malformedWorkbook.byteLength }),
    importInventoryStockBytes({ bytes: malformedWorkbook, fileName: "inventory.xlsx", fileSizeBytes: malformedWorkbook.byteLength, snapshotDateOverride: "2026-08-01" }),
    importErpReferenceBytes({ source: "products", bytes: malformedWorkbook, fileName: "products.xlsx", fileSizeBytes: malformedWorkbook.byteLength }),
  ])];
  const expectedMessages = [
    "销售 Excel 文件解析失败，请确认文件格式和模板",
    "月度财报解析失败，请确认文件格式和模板",
    "库存 Excel 文件解析失败，请确认文件格式和模板",
    "吉客云 ERP · 货品导出解析失败，请确认文件格式和模板",
  ];
  results.forEach((result, index) => {
    assert.equal(result.ok, false);
    assert.equal(result.message, expectedMessages[index]);
    assert.equal(result.errors?.[0]?.message, expectedMessages[index]);
    assert.doesNotMatch(JSON.stringify(result), /unsupported|central directory|sql|stack|cloudflare/i);
  });
  sqlite.close();
});

test("过期销售 PG 分片清理先领取 lease，响应丢失仍用同 token 重放", async () => {
  const { sweepExpiredSalesUploads } = await import("../lib/sales/chunked-upload");
  const originalFetch = globalThis.fetch;
  const uploadId = "11111111-1111-4111-8111-111111111111";
  const cleanupToken = "a".repeat(32);
  const purgePayloads: Array<Record<string, unknown>> = [];
  try {
    testEnvironment.TERUISI_DJANGO_SALES_READER_BASE_URL = "http://127.0.0.1:8001";
    testEnvironment.TERUISI_DJANGO_SALES_WRITER_BASE_URL = "http://127.0.0.1:8002";
    testEnvironment.TERUISI_DJANGO_INTERNAL_SECRET = "s".repeat(32);
    globalThis.fetch = async (_input, init) => {
      const payload = JSON.parse(Buffer.from(init?.body as Uint8Array).toString("utf8")) as Record<string, unknown>;
      if (payload.action === "sweep") {
        return new Response(JSON.stringify({
          sweep: {
            items: [{
               id: uploadId,
               ownerGeneration: 2,
               cleanupToken,
             }],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      assert.equal(payload.action, "purge");
      purgePayloads.push(payload);
      if (purgePayloads.length === 1) {
        // Simulate a lost response after the server may have observed the same
        // token. A later sweep must remain safely replayable.
        throw new Error("injected purge response loss");
      }
      return new Response(JSON.stringify({ ok: true, status: "purged" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await sweepExpiredSalesUploads(unrestrictedAdmin);
    assert.equal(purgePayloads.length, 1);

    await sweepExpiredSalesUploads(unrestrictedAdmin);
    assert.equal(purgePayloads.length, 2);
    assert.ok(purgePayloads.every((payload) => payload.cleanupToken === cleanupToken));
    assert.ok(purgePayloads.every((payload) => payload.ownerGeneration === 2));
    assert.ok(purgePayloads.every((payload) => payload.uploadId === uploadId));
    assert.ok(purgePayloads.every((payload) => !("objectKeys" in payload)));
  } finally {
    globalThis.fetch = originalFetch;
    delete testEnvironment.TERUISI_DJANGO_SALES_READER_BASE_URL;
    delete testEnvironment.TERUISI_DJANGO_SALES_WRITER_BASE_URL;
    delete testEnvironment.TERUISI_DJANGO_INTERNAL_SECRET;
  }
});

test("受限 admin/operator 被写路由 fail-closed，未知错误固定脱敏", async () => {
  const scope = { warehouses: ["测试仓"], channels: [], platforms: [] };
  for (const role of ["admin", "operator"] as const) {
    assert.throws(
      () => requireUnrestrictedDataScope({ email: `${role}@test`, displayName: role, role, scope }, "客服会话", "修改"),
      (error: unknown) => error instanceof AuthorizationError && error.status === 403,
    );
  }
  const response = safeApiErrorResponse(new Error("SQL: secret_table failed"), "操作失败。");
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "操作失败。", code: "internal_error" });

  const writeRoutes = [
    "../app/api/imports/sales/route.ts",
    "../app/api/imports/sales/chunks/route.ts",
    "../app/api/imports/finance/route.ts",
    "../app/api/imports/inventory/route.ts",
    "../app/api/imports/inventory/chunks/route.ts",
    "../app/api/imports/erp/route.ts",
    "../app/api/imports/erp/chunks/route.ts",
    "../app/api/inventory/import/route.ts",
    "../app/api/inventory/replenishment/route.ts",
    "../app/api/customer-service/import/route.ts",
    "../app/api/customer-service/import/chunks/route.ts",
    "../app/api/customer-service/conversations/route.ts",
    "../app/api/customer-service/analyze/route.ts",
    "../app/api/finance/targets/route.ts",
  ];
  for (const relativePath of writeRoutes) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /requireUnrestrictedDataScope\(principal,/, `${relativePath} must reject unsupported restricted scope`);
  }
});
