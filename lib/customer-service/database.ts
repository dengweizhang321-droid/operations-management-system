import { env } from "cloudflare:workers";
import type { CustomerServiceConversationInput, CustomerServiceParseResult } from "./import-service";
import { ensureNetshopSchema, getNetshopDatabase } from "@/lib/netshop/database";
import { ensureSalesSchema, getSalesDatabase } from "@/lib/sales/database";
import { customerServiceConversionStatuses, customerServiceProblemTypes, customerServiceRobotScopes, type CustomerServiceAnnotationInput, type CustomerServiceConversionStatus, type CustomerServiceProblemType, type CustomerServiceRobotScope } from "./contracts";

export { customerServiceConversionStatuses, customerServiceProblemTypes, customerServiceRobotScopes } from "./contracts";
export type { CustomerServiceAnnotationInput, CustomerServiceConversionStatus, CustomerServiceProblemType, CustomerServiceRobotScope } from "./contracts";

type CustomerServiceDatabase = NonNullable<typeof env.DB>;

export type CustomerServiceImportBatch = {
  id: string; shopName: string; sessionFileName: string; chatFileName: string; fileHash: string; status: string; conversationCount: number; matchedCount: number; sessionOnlyCount: number; chatOnlyCount: number; ambiguousCount: number; warnings: string[]; createdAt: string; completedAt: string | null;
};

export type CustomerServiceConversation = {
  id: number; shopName: string; consultedAt: string; customerId: string; customerAlias: string; consultationType: string; agent: string; transferredAgent: string; skillGroup: string; productSku: string; productSpuId: string; erpProductCode: string; productCategory: string; productName: string; firstResponseAt: string; responseSeconds: number | null; durationMinutes: number | null; customerMessageCount: number | null; agentMessageCount: number | null; satisfaction: string; resolved: string; conversationId: string; matchStatus: string; matchConfidence: string; chatStartedAt: string; chatEndedAt: string; chatCustomerAlias: string; messages: Array<{ sender: string; sentAt: string; content: string }>; robotScope: CustomerServiceRobotScope | ""; problemType: CustomerServiceProblemType | ""; conversionStatus: CustomerServiceConversionStatus | ""; serviceIssues: string; summaryText: string; analysisSource: "ai" | "manual" | ""; analyzedAt: string | null; annotatedAt: string | null;
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS customer_service_import_batches (
    id TEXT PRIMARY KEY NOT NULL, shop_name TEXT NOT NULL DEFAULT '志高商用设备', session_file_name TEXT NOT NULL, chat_file_name TEXT NOT NULL, file_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
    conversation_count INTEGER NOT NULL DEFAULT 0, matched_count INTEGER NOT NULL DEFAULT 0, session_only_count INTEGER NOT NULL DEFAULT 0, chat_only_count INTEGER NOT NULL DEFAULT 0, ambiguous_count INTEGER NOT NULL DEFAULT 0,
    warnings_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS customer_service_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_key TEXT NOT NULL UNIQUE, first_import_batch_id TEXT NOT NULL, last_import_batch_id TEXT NOT NULL,
    shop_name TEXT NOT NULL DEFAULT '志高商用设备', consulted_at TEXT NOT NULL, customer_id TEXT NOT NULL DEFAULT '', customer_alias TEXT NOT NULL DEFAULT '', consultation_type TEXT NOT NULL DEFAULT '', agent TEXT NOT NULL DEFAULT '', transferred_agent TEXT NOT NULL DEFAULT '', skill_group TEXT NOT NULL DEFAULT '', product_sku TEXT NOT NULL DEFAULT '', product_name TEXT NOT NULL DEFAULT '', first_response_at TEXT NOT NULL DEFAULT '', response_seconds REAL, duration_minutes REAL, customer_message_count INTEGER, agent_message_count INTEGER, satisfaction TEXT NOT NULL DEFAULT '', resolved TEXT NOT NULL DEFAULT '', conversation_id TEXT NOT NULL DEFAULT '', match_status TEXT NOT NULL, match_confidence TEXT NOT NULL, chat_started_at TEXT NOT NULL DEFAULT '', chat_ended_at TEXT NOT NULL DEFAULT '', chat_customer_alias TEXT NOT NULL DEFAULT '', messages_json TEXT NOT NULL DEFAULT '[]', robot_scope TEXT NOT NULL DEFAULT '', problem_type TEXT NOT NULL DEFAULT '', conversion_status TEXT NOT NULL DEFAULT '', service_issues TEXT NOT NULL DEFAULT '', summary_text TEXT NOT NULL DEFAULT '', analysis_source TEXT NOT NULL DEFAULT '', analyzed_at TEXT, annotated_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS customer_service_conversations_consulted_idx ON customer_service_conversations (consulted_at DESC)`,
  `CREATE INDEX IF NOT EXISTS customer_service_conversations_filter_idx ON customer_service_conversations (agent, match_status, consulted_at DESC)`,
];
const ready = new WeakMap<object, Promise<void>>();

export function getCustomerServiceDatabase(): CustomerServiceDatabase {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  return env.DB;
}
export async function ensureCustomerServiceSchema(db = getCustomerServiceDatabase()) {
  const key = db as unknown as object;
  const cached = ready.get(key);
  if (cached) return cached;
  const task = (async () => {
    await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
    const [batchColumns, conversationColumns] = await Promise.all([
      db.prepare("PRAGMA table_info(customer_service_import_batches)").all<{ name: string }>(),
      db.prepare("PRAGMA table_info(customer_service_conversations)").all<{ name: string }>(),
    ]);
    const migrations = [];
    if (!batchColumns.results.some((column) => column.name === "shop_name")) migrations.push(db.prepare("ALTER TABLE customer_service_import_batches ADD COLUMN shop_name TEXT NOT NULL DEFAULT '志高商用设备'"));
    if (!conversationColumns.results.some((column) => column.name === "shop_name")) migrations.push(db.prepare("ALTER TABLE customer_service_conversations ADD COLUMN shop_name TEXT NOT NULL DEFAULT '志高商用设备'"));
    for (const [name, definition] of [
      ["robot_scope", "TEXT NOT NULL DEFAULT ''"], ["problem_type", "TEXT NOT NULL DEFAULT ''"], ["conversion_status", "TEXT NOT NULL DEFAULT ''"],
      ["service_issues", "TEXT NOT NULL DEFAULT ''"], ["summary_text", "TEXT NOT NULL DEFAULT ''"], ["analysis_source", "TEXT NOT NULL DEFAULT ''"],
      ["analyzed_at", "TEXT"], ["annotated_at", "TEXT"],
    ] as const) if (!conversationColumns.results.some((column) => column.name === name)) migrations.push(db.prepare(`ALTER TABLE customer_service_conversations ADD COLUMN ${name} ${definition}`));
    if (migrations.length) await db.batch(migrations);
    await db.prepare("UPDATE customer_service_conversations SET conversation_key = shop_name || ':' || conversation_key WHERE conversation_key NOT LIKE shop_name || ':%'").run();
  })().catch((error: unknown) => { ready.delete(key); throw error; });
  ready.set(key, task);
  return task;
}
function safeJson<T>(input: string, fallback: T) { try { return JSON.parse(input) as T; } catch { return fallback; } }
function batchId() { return `cs_${crypto.randomUUID().replace(/-/g, "")}`; }
function mapBatch(row: Record<string, unknown>): CustomerServiceImportBatch {
  return { id: String(row.id), shopName: String(row.shop_name || "志高商用设备"), sessionFileName: String(row.session_file_name), chatFileName: String(row.chat_file_name), fileHash: String(row.file_hash), status: String(row.status), conversationCount: Number(row.conversation_count), matchedCount: Number(row.matched_count), sessionOnlyCount: Number(row.session_only_count), chatOnlyCount: Number(row.chat_only_count), ambiguousCount: Number(row.ambiguous_count), warnings: safeJson(String(row.warnings_json), []), createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : null };
}

export async function listCustomerServiceBatches(limit = 20) {
  const db = getCustomerServiceDatabase(); await ensureCustomerServiceSchema(db);
  const result = await db.prepare(`SELECT * FROM customer_service_import_batches ORDER BY created_at DESC LIMIT ?`).bind(Math.max(1, Math.min(100, limit))).all<Record<string, unknown>>();
  return result.results.map(mapBatch);
}

export async function saveCustomerServiceImport(input: { shopName: string; sessionFileName: string; chatFileName: string; fileHash: string; parsed: CustomerServiceParseResult }) {
  const db = getCustomerServiceDatabase(); await ensureCustomerServiceSchema(db);
  const existing = await db.prepare(`SELECT * FROM customer_service_import_batches WHERE file_hash = ? LIMIT 1`).bind(input.fileHash).first<Record<string, unknown>>();
  if (existing) return { status: "duplicate" as const, batch: mapBatch(existing) };
  const id = batchId(); const { summary } = input.parsed;
  await db.prepare(`INSERT INTO customer_service_import_batches (id,shop_name,session_file_name,chat_file_name,file_hash,status,conversation_count,matched_count,session_only_count,chat_only_count,ambiguous_count,warnings_json,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(id, input.shopName.slice(0, 100), input.sessionFileName.slice(0, 240), input.chatFileName.slice(0, 240), input.fileHash, "completed", input.parsed.conversations.length, summary.matchedCount + summary.timeOnlyMatchedCount, summary.sessionOnlyCount, summary.chatOnlyCount, summary.ambiguousCount, JSON.stringify(input.parsed.warnings.slice(0, 200))).run();
  const statements = input.parsed.conversations.flatMap((item) => {
    const cleanup = cleanupSupersededChatOnly(db, input.shopName, item);
    return cleanup ? [cleanup, upsertConversation(db, id, input.shopName, item)] : [upsertConversation(db, id, input.shopName, item)];
  });
  for (let offset = 0; offset < statements.length; offset += 80) await db.batch(statements.slice(offset, offset + 80));
  const batch = await db.prepare(`SELECT * FROM customer_service_import_batches WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!batch) throw new Error("客服会话导入批次写入失败");
  return { status: "imported" as const, batch: mapBatch(batch) };
}
function cleanupSupersededChatOnly(db: CustomerServiceDatabase, shopName: string, item: CustomerServiceConversationInput) {
  // A later session workbook can turn a previously chat-only row into a
  // matched conversation.  Remove the earlier copy before the matched row is
  // written so supplementary imports replace old content instead of doubling
  // the conversation.
  if (!item.chatStartedAt || !item.messages.length) {
    return null;
  }
  return db.prepare(`DELETE FROM customer_service_conversations
    WHERE shop_name = ? AND match_status = 'chat_only' AND chat_started_at = ?
      AND chat_ended_at = ? AND chat_customer_alias = ? AND messages_json = ?
      AND conversation_key <> ?`).bind(
    shopName,
    item.chatStartedAt,
    item.chatEndedAt,
    item.chatCustomerAlias,
    JSON.stringify(item.messages),
    `${shopName}:${item.conversationKey}`,
  );
}
function upsertConversation(db: CustomerServiceDatabase, batchIdValue: string, shopName: string, item: CustomerServiceConversationInput) {
  return db.prepare(`INSERT INTO customer_service_conversations (conversation_key,first_import_batch_id,last_import_batch_id,shop_name,consulted_at,customer_id,customer_alias,consultation_type,agent,transferred_agent,skill_group,product_sku,product_name,first_response_at,response_seconds,duration_minutes,customer_message_count,agent_message_count,satisfaction,resolved,conversation_id,match_status,match_confidence,chat_started_at,chat_ended_at,chat_customer_alias,messages_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(conversation_key) DO UPDATE SET last_import_batch_id=excluded.last_import_batch_id, shop_name=excluded.shop_name, consultation_type=excluded.consultation_type, agent=excluded.agent, transferred_agent=excluded.transferred_agent, skill_group=excluded.skill_group, product_sku=excluded.product_sku, product_name=excluded.product_name, first_response_at=excluded.first_response_at, response_seconds=excluded.response_seconds, duration_minutes=excluded.duration_minutes, customer_message_count=excluded.customer_message_count, agent_message_count=excluded.agent_message_count, satisfaction=excluded.satisfaction, resolved=excluded.resolved, match_status=excluded.match_status, match_confidence=excluded.match_confidence, chat_started_at=excluded.chat_started_at, chat_ended_at=excluded.chat_ended_at, chat_customer_alias=excluded.chat_customer_alias, messages_json=excluded.messages_json, updated_at=CURRENT_TIMESTAMP`).bind(`${shopName}:${item.conversationKey}`, batchIdValue, batchIdValue, shopName, item.consultedAt, item.customerId, item.customerAlias, item.consultationType, item.agent, item.transferredAgent, item.skillGroup, item.productSku, item.productName, item.firstResponseAt, item.responseSeconds, item.durationMinutes, item.customerMessageCount, item.agentMessageCount, item.satisfaction, item.resolved, item.conversationId, item.matchStatus, item.matchConfidence, item.chatStartedAt, item.chatEndedAt, item.chatCustomerAlias, JSON.stringify(item.messages));
}

function splitIds(value?: string | null) {
  return [...new Set((value ?? "").split(/[\s,，;；]+/).map((item) => item.trim()).filter((item) => /^[A-Za-z0-9_-]{2,80}$/.test(item)))].slice(0, 100);
}
export async function listCustomerServiceConversations(filters: { shopName?: string | null; startDate?: string | null; endDate?: string | null; agent?: string | null; status?: string | null; robotScope?: string | null; problemType?: string | null; conversionStatus?: string | null; query?: string | null; skuIds?: string | null; spuIds?: string | null; page?: number | null; pageSize?: number | null }) {
  const db = getCustomerServiceDatabase(); await ensureCustomerServiceSchema(db);
  await Promise.all([ensureNetshopSchema(getNetshopDatabase()), ensureSalesSchema(getSalesDatabase())]);
  const conditions: string[] = []; const values: unknown[] = [];
  if (filters.shopName) { conditions.push("shop_name = ?"); values.push(filters.shopName); }
  if (filters.startDate) { conditions.push("consulted_at >= ?"); values.push(`${filters.startDate} 00:00:00`); }
  if (filters.endDate) { conditions.push("consulted_at <= ?"); values.push(`${filters.endDate} 23:59:59`); }
  if (filters.agent) { conditions.push("agent = ?"); values.push(filters.agent); }
  if (filters.status) { conditions.push("match_status = ?"); values.push(filters.status); }
  if (filters.robotScope && customerServiceRobotScopes.includes(filters.robotScope as CustomerServiceRobotScope)) { conditions.push("robot_scope = ?"); values.push(filters.robotScope); }
  if (filters.problemType && customerServiceProblemTypes.includes(filters.problemType as CustomerServiceProblemType)) { conditions.push("problem_type = ?"); values.push(filters.problemType); }
  if (filters.conversionStatus && customerServiceConversionStatuses.includes(filters.conversionStatus as CustomerServiceConversionStatus)) { conditions.push("conversion_status = ?"); values.push(filters.conversionStatus); }
  if (filters.query) { conditions.push("(customer_id LIKE ? OR customer_alias LIKE ? OR agent LIKE ? OR product_sku LIKE ? OR product_name LIKE ? OR messages_json LIKE ? OR service_issues LIKE ? OR summary_text LIKE ?)"); const wildcard = `%${filters.query.replace(/[\\%_]/g, "\\$&")}%`; values.push(wildcard, wildcard, wildcard, wildcard, wildcard, wildcard, wildcard, wildcard); }
  const skuIds = splitIds(filters.skuIds);
  const spuIds = splitIds(filters.spuIds);
  if (skuIds.length) { conditions.push(`product_sku IN (${skuIds.map(() => "?").join(",")})`); values.push(...skuIds); }
  if (spuIds.length) {
    conditions.push(`EXISTS (SELECT 1 FROM netshop_rows n WHERE n.source = 'jd_product_master' AND (n.sku_id = customer_service_conversations.product_sku OR n.product_code = customer_service_conversations.product_sku) AND (n.spu_id IN (${spuIds.map(() => "?").join(",")}) OR n.product_code IN (${spuIds.map(() => "?").join(",")})))`);
    values.push(...spuIds, ...spuIds);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""; const pageSize = Math.max(10, Math.min(100, Number(filters.pageSize) || 30)); const page = Math.max(1, Number(filters.page) || 1);
  const [items, totalResult, summaryResult, agents, shops] = await Promise.all([
    db.prepare(`SELECT * FROM customer_service_conversations ${where} ORDER BY consulted_at DESC, id DESC LIMIT ? OFFSET ?`).bind(...values, pageSize, (page - 1) * pageSize).all<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) AS total FROM customer_service_conversations ${where}`).bind(...values).first<{ total: number }>(),
    db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END) AS matched, SUM(CASE WHEN match_status = 'session_only' THEN 1 ELSE 0 END) AS session_only, SUM(CASE WHEN match_status = 'chat_only' THEN 1 ELSE 0 END) AS chat_only FROM customer_service_conversations ${where}`).bind(...values).first<Record<string, number | null>>(),
    db.prepare(`SELECT DISTINCT agent FROM customer_service_conversations WHERE agent <> '' ORDER BY agent COLLATE NOCASE ASC LIMIT 100`).all<{ agent: string }>(),
    db.prepare(`SELECT DISTINCT shop_name FROM customer_service_conversations WHERE shop_name <> '' ORDER BY shop_name COLLATE NOCASE ASC LIMIT 100`).all<{ shop_name: string }>(),
  ]);
  const map = (row: Record<string, unknown>): CustomerServiceConversation => mapCustomerServiceConversation(row);
  const customerItems = items.results.map(map);
  const productSkus = [...new Set(customerItems.map((item) => item.productSku).filter(Boolean))];
  const catalog = new Map<string, { spuId: string; category: string; erpProductCode: string }>();
  if (productSkus.length) {
    const rows = await db.prepare(`SELECT sku_id, spu_id, product_code, raw_json FROM netshop_rows WHERE source = 'jd_product_master' AND (sku_id IN (${productSkus.map(() => "?").join(",")}) OR product_code IN (${productSkus.map(() => "?").join(",")}))`).bind(...productSkus, ...productSkus).all<{ sku_id: string; spu_id: string; product_code: string; raw_json: string }>();
    for (const row of rows.results) {
      const raw = safeJson<Record<string, unknown>>(row.raw_json, {});
      const spuId = String(raw.SPUID ?? raw.spuId ?? row.spu_id ?? row.product_code ?? "").trim();
      const entry = { spuId, category: "", erpProductCode: "" };
      for (const key of [row.sku_id, row.product_code].filter(Boolean)) if (!catalog.has(key)) catalog.set(key, entry);
    }
    const erpRows = await db.prepare(`SELECT shop_name, online_spec_code, product_code, category, MAX(sales_time) AS latest_at FROM sales_order_lines WHERE online_spec_code IN (${productSkus.map(() => "?").join(",")}) GROUP BY shop_name, online_spec_code, product_code, category ORDER BY latest_at DESC`).bind(...productSkus).all<{ shop_name: string; online_spec_code: string; product_code: string; category: string }>();
    for (const row of erpRows.results) {
      const current = catalog.get(`${row.shop_name}\u001f${row.online_spec_code}`) ?? catalog.get(row.online_spec_code) ?? { spuId: "", category: "", erpProductCode: "" };
      const entry = { ...current, category: row.category || current.category, erpProductCode: row.product_code || current.erpProductCode };
      if (!catalog.has(`${row.shop_name}\u001f${row.online_spec_code}`)) catalog.set(`${row.shop_name}\u001f${row.online_spec_code}`, entry);
      if (!catalog.has(row.online_spec_code) || !catalog.get(row.online_spec_code)?.erpProductCode) catalog.set(row.online_spec_code, entry);
    }
  }
  return { items: customerItems.map((item) => { const matched = catalog.get(`${item.shopName}\u001f${item.productSku}`) ?? catalog.get(item.productSku); return { ...item, productSpuId: matched?.spuId ?? "", erpProductCode: matched?.erpProductCode ?? "", productCategory: matched?.category ?? "" }; }), agents: agents.results.map((item) => item.agent), shops: shops.results.map((item) => item.shop_name), summary: { total: Number(summaryResult?.total ?? 0), matched: Number(summaryResult?.matched ?? 0), sessionOnly: Number(summaryResult?.session_only ?? 0), chatOnly: Number(summaryResult?.chat_only ?? 0) }, pagination: { page, pageSize, total: Number(totalResult?.total ?? 0) } };
}

function mapCustomerServiceConversation(row: Record<string, unknown>): CustomerServiceConversation {
  return { id: Number(row.id), shopName: String(row.shop_name || "志高商用设备"), consultedAt: String(row.consulted_at), customerId: String(row.customer_id), customerAlias: String(row.customer_alias), consultationType: String(row.consultation_type), agent: String(row.agent), transferredAgent: String(row.transferred_agent), skillGroup: String(row.skill_group), productSku: String(row.product_sku), productSpuId: "", erpProductCode: "", productCategory: "", productName: String(row.product_name), firstResponseAt: String(row.first_response_at), responseSeconds: row.response_seconds === null ? null : Number(row.response_seconds), durationMinutes: row.duration_minutes === null ? null : Number(row.duration_minutes), customerMessageCount: row.customer_message_count === null ? null : Number(row.customer_message_count), agentMessageCount: row.agent_message_count === null ? null : Number(row.agent_message_count), satisfaction: String(row.satisfaction), resolved: String(row.resolved), conversationId: String(row.conversation_id), matchStatus: String(row.match_status), matchConfidence: String(row.match_confidence), chatStartedAt: String(row.chat_started_at), chatEndedAt: String(row.chat_ended_at), chatCustomerAlias: String(row.chat_customer_alias), messages: safeJson(String(row.messages_json), []), robotScope: String(row.robot_scope || "") as CustomerServiceConversation["robotScope"], problemType: String(row.problem_type || "") as CustomerServiceConversation["problemType"], conversionStatus: String(row.conversion_status || "") as CustomerServiceConversation["conversionStatus"], serviceIssues: String(row.service_issues || ""), summaryText: String(row.summary_text || ""), analysisSource: String(row.analysis_source || "") as CustomerServiceConversation["analysisSource"], analyzedAt: row.analyzed_at ? String(row.analyzed_at) : null, annotatedAt: row.annotated_at ? String(row.annotated_at) : null };
}

export async function getCustomerServiceConversationsByIds(ids: number[]) {
  const normalized = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 20);
  if (!normalized.length) return [];
  const db = getCustomerServiceDatabase(); await ensureCustomerServiceSchema(db);
  const result = await db.prepare(`SELECT * FROM customer_service_conversations WHERE id IN (${normalized.map(() => "?").join(",")}) ORDER BY consulted_at DESC`).bind(...normalized).all<Record<string, unknown>>();
  return result.results.map(mapCustomerServiceConversation);
}

function normalizedAnnotation(input: CustomerServiceAnnotationInput) {
  const output: CustomerServiceAnnotationInput = {};
  if (input.robotScope !== undefined) { if (!customerServiceRobotScopes.includes(input.robotScope)) throw new Error("机器人标注无效"); output.robotScope = input.robotScope; }
  if (input.problemType !== undefined) { if (!customerServiceProblemTypes.includes(input.problemType)) throw new Error("问题类型无效"); output.problemType = input.problemType; }
  if (input.conversionStatus !== undefined) { if (!customerServiceConversionStatuses.includes(input.conversionStatus)) throw new Error("订单转化状态无效"); output.conversionStatus = input.conversionStatus; }
  if (input.serviceIssues !== undefined) output.serviceIssues = input.serviceIssues.trim().slice(0, 1000);
  if (input.summaryText !== undefined) output.summaryText = input.summaryText.trim().slice(0, 1000);
  if (input.analysisSource !== undefined) { if (!(["ai", "manual"] as const).includes(input.analysisSource)) throw new Error("分析来源无效"); output.analysisSource = input.analysisSource; }
  return output;
}

export async function updateCustomerServiceConversationAnnotation(id: number, input: CustomerServiceAnnotationInput) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("会话 ID 无效");
  const values = normalizedAnnotation(input);
  const columns: Record<keyof CustomerServiceAnnotationInput, string> = { robotScope: "robot_scope", problemType: "problem_type", conversionStatus: "conversion_status", serviceIssues: "service_issues", summaryText: "summary_text", analysisSource: "analysis_source" };
  const entries = Object.entries(values) as Array<[keyof CustomerServiceAnnotationInput, string]>;
  if (!entries.length) throw new Error("没有可保存的标注内容");
  const db = getCustomerServiceDatabase(); await ensureCustomerServiceSchema(db);
  const assignments = entries.map(([key]) => `${columns[key]} = ?`);
  const analyzedAt = values.analysisSource === "ai";
  assignments.push("annotated_at = CURRENT_TIMESTAMP", "updated_at = CURRENT_TIMESTAMP");
  if (analyzedAt) assignments.push("analyzed_at = CURRENT_TIMESTAMP");
  const result = await db.prepare(`UPDATE customer_service_conversations SET ${assignments.join(", ")} WHERE id = ?`).bind(...entries.map(([, value]) => value), id).run();
  if (!Number(result.meta.changes ?? 0)) throw new Error("客服会话不存在");
  return { id, updated: true };
}

export async function getCustomerServiceConversationsForAi(args: Record<string, unknown>) {
  const payload = await listCustomerServiceConversations({ startDate: typeof args.startDate === "string" ? args.startDate : null, endDate: typeof args.endDate === "string" ? args.endDate : null, agent: typeof args.agent === "string" ? args.agent : null, problemType: typeof args.problemType === "string" ? args.problemType : null, conversionStatus: typeof args.conversionStatus === "string" ? args.conversionStatus : null, query: typeof args.query === "string" ? args.query : null, page: 1, pageSize: Math.max(1, Math.min(50, Number(args.limit) || 20)) });
  return { filtersApplied: { startDate: args.startDate ?? null, endDate: args.endDate ?? null, agent: args.agent ?? null, problemType: args.problemType ?? null, conversionStatus: args.conversionStatus ?? null, query: args.query ?? null }, returned: payload.items.length, totalMatched: payload.pagination.total, truncated: payload.pagination.total > payload.items.length, items: payload.items.map((item) => ({ id: item.id, shopName: item.shopName, consultedAt: item.consultedAt, agent: item.agent, productSku: item.productSku, productSpuId: item.productSpuId, productCategory: item.productCategory, robotScope: item.robotScope, problemType: item.problemType, conversionStatus: item.conversionStatus, serviceIssues: item.serviceIssues, summary: item.summaryText, matchStatus: item.matchStatus })) };
}

export async function deleteCustomerServiceConversationsByText(text: string) {
  const term = text.trim();
  const isValidLength = term.length >= 2 && term.length <= 120;
  if (!isValidLength) {
    throw new Error("删除关键词长度必须为 2 到 120 个字符。");
  }

  // 关键词会被包裹进 LIKE 模式；拒绝模式字符以避免扩大删除范围。
  if (/[\\%_]/.test(term)) {
    throw new Error("删除关键词不得包含通配符。");
  }

  const db = getCustomerServiceDatabase(); await ensureCustomerServiceSchema(db);
  const wildcard = `%${term}%`;
  const statement = "customer_id LIKE ? OR customer_alias LIKE ? OR agent LIKE ? OR product_sku LIKE ? OR product_name LIKE ? OR messages_json LIKE ?";
  const values = [wildcard, wildcard, wildcard, wildcard, wildcard, wildcard];
  const before = await db.prepare(`SELECT COUNT(*) AS total FROM customer_service_conversations WHERE ${statement}`).bind(...values).first<{ total: number }>();
  const result = await db.prepare(`DELETE FROM customer_service_conversations WHERE ${statement}`).bind(...values).run();
  return { deletedCount: Number(before?.total ?? 0), databaseChanges: Number(result.meta.changes ?? 0) };
}
