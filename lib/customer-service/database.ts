import { env } from "cloudflare:workers";
import {
  CustomerServiceImportError,
  summarizeCustomerServiceWarnings,
  validateCustomerServiceConversationMessages,
  type CustomerServiceConversationInput,
  type CustomerServiceParseResult,
} from "./import-service";
import {
  buildImportAttemptHash,
  buildImportContentFingerprint,
  ensureImportFingerprintSchema,
  failImportFingerprint,
  findImportFingerprintByBatch,
  importReservationCommitFence,
  rethrowImportPublishError,
  nextImportScopeStateToken,
  readImportScopeStateToken,
  recordImportFingerprint,
  renewImportFingerprintReservation,
  reserveImportFingerprint,
} from "@/lib/imports/content-fingerprint";
import { requireUnrestrictedDataScope, type AppPrincipal } from "@/lib/auth/authorization";
import {
  createDjangoSalesConsumerReader,
  type SalesConsumerReader,
  type SalesConsumerResponseMap,
} from "@/lib/django/sales-consumer-reader";
import {
  createDjangoNetshopConsumerReader,
  type NetshopConsumerReader,
  type NetshopConsumerResponseMap,
} from "@/lib/django/netshop-consumer-reader";
import { PublicApiError } from "@/lib/http/api-error";
import { customerServiceConversionStatuses, customerServiceProblemTypes, customerServiceRobotScopes, type CustomerServiceAnnotationInput, type CustomerServiceConversionStatus, type CustomerServiceProblemType, type CustomerServiceRobotScope } from "./contracts";
import { buildCustomerServiceProductMappings, customerServiceOnlineSpecCodes, type CustomerServiceMasterProductRow, type CustomerServiceProductMapping, type CustomerServiceSalesProductRow } from "./product-mapping";

export { customerServiceConversionStatuses, customerServiceProblemTypes, customerServiceRobotScopes } from "./contracts";
export type { CustomerServiceAnnotationInput, CustomerServiceConversionStatus, CustomerServiceProblemType, CustomerServiceRobotScope } from "./contracts";

type CustomerServiceDatabase = NonNullable<typeof env.DB>;

export type CustomerServiceImportBatch = {
  id: string; shopName: string; sessionFileName: string; chatFileName: string; fileHash: string; status: string; conversationCount: number; matchedCount: number; sessionOnlyCount: number; chatOnlyCount: number; ambiguousCount: number; warnings: string[]; warningTotalCount: number; warningsTruncated: boolean; createdAt: string; completedAt: string | null;
};

export type CustomerServiceConversation = {
  id: number; shopName: string; consultedAt: string; customerId: string; customerAlias: string; consultationType: string; agent: string; transferredAgent: string; skillGroup: string; productSku: string; matchedSkuId: string; productSpuId: string; erpProductCode: string; productCategory: string; productName: string; firstResponseAt: string; responseSeconds: number | null; durationMinutes: number | null; customerMessageCount: number | null; agentMessageCount: number | null; satisfaction: string; resolved: string; conversationId: string; matchStatus: string; matchConfidence: string; chatStartedAt: string; chatEndedAt: string; chatCustomerAlias: string; messages: Array<{ sender: string; sentAt: string; content: string }>; messageTotalCount: number; messageReturnedCount: number; messagesTruncated: boolean; robotScope: CustomerServiceRobotScope | ""; problemType: CustomerServiceProblemType | ""; conversionStatus: CustomerServiceConversionStatus | ""; serviceIssues: string; summaryText: string; analysisSource: "ai" | "manual" | ""; analyzedAt: string | null; annotatedAt: string | null; version: number; updatedAt: string;
};

export const CUSTOMER_SERVICE_MESSAGE_LIMIT = 200;
export const CUSTOMER_SERVICE_AI_MESSAGE_LIMIT = 24;
export const CUSTOMER_SERVICE_MESSAGE_CONTENT_LIMIT = 1_000;
export const CUSTOMER_SERVICE_MESSAGE_BYTES_LIMIT = 64 * 1024;
export const CUSTOMER_SERVICE_IMPORT_PAYLOAD_BYTES_LIMIT = 256 * 1024;
export const CUSTOMER_SERVICE_IMPORT_TOTAL_PAYLOAD_BYTES_LIMIT = 8 * 1024 * 1024;
export const CUSTOMER_SERVICE_IMPORT_BATCH_STATEMENT_LIMIT = 90;
const CUSTOMER_SERVICE_IMPORT_FIXED_STATEMENTS = 3;

export function planCustomerServiceImportPayloads(
  shopName: string,
  conversations: readonly CustomerServiceConversationInput[],
) {
  try {
    validateCustomerServiceConversationMessages(conversations);
  } catch (error) {
    if (error instanceof CustomerServiceImportError) {
      throw new PublicApiError(422, "invalid_request", error.message);
    }
    throw error;
  }
  const encoder = new TextEncoder();
  const payloads: string[] = [];
  let currentItems: string[] = [];
  let currentBytes = 2;
  let totalBytes = 0;
  const flush = () => {
    if (!currentItems.length) return;
    payloads.push(`[${currentItems.join(",")}]`);
    currentItems = [];
    currentBytes = 2;
  };
  conversations.forEach((item, index) => {
    const serialized = JSON.stringify({
      ...item,
      storageConversationKey: `${shopName}:${item.conversationKey}`,
    });
    const itemBytes = encoder.encode(serialized).byteLength;
    if (itemBytes + 2 > CUSTOMER_SERVICE_IMPORT_PAYLOAD_BYTES_LIMIT) {
      throw new PublicApiError(422, "invalid_request", `第 ${index + 1} 条客服会话序列化后超过 256KB 单语句上限`);
    }
    const separatorBytes = currentItems.length ? 1 : 0;
    if (currentItems.length >= 80 || currentBytes + separatorBytes + itemBytes > CUSTOMER_SERVICE_IMPORT_PAYLOAD_BYTES_LIMIT) flush();
    currentItems.push(serialized);
    currentBytes += (currentItems.length > 1 ? 1 : 0) + itemBytes;
    totalBytes += itemBytes + 1;
    if (totalBytes * 2 > CUSTOMER_SERVICE_IMPORT_TOTAL_PAYLOAD_BYTES_LIMIT) {
      throw new PublicApiError(422, "invalid_request", "客服会话 D1 原子发布绑定数据超过 8MB 安全预算，请拆分为更小的独立业务范围后重试");
    }
  });
  flush();
  const statementCount = CUSTOMER_SERVICE_IMPORT_FIXED_STATEMENTS + payloads.length * 2;
  if (statementCount > CUSTOMER_SERVICE_IMPORT_BATCH_STATEMENT_LIMIT) {
    throw new PublicApiError(422, "invalid_request", `客服会话需要 ${statementCount} 条发布语句，超过单次原子发布安全上限`);
  }
  return { payloads, totalBytes, totalBoundBytes: totalBytes * 2, statementCount };
}

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
  `CREATE TABLE IF NOT EXISTS customer_service_conversation_versions (
    conversation_id INTEGER PRIMARY KEY NOT NULL REFERENCES customer_service_conversations(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS customer_service_deletion_audits (
    audit_id TEXT PRIMARY KEY NOT NULL,
    conversation_id INTEGER NOT NULL,
    conversation_key TEXT NOT NULL,
    actor TEXT NOT NULL,
    old_version INTEGER NOT NULL CHECK (old_version > 0),
    expected_version INTEGER NOT NULL CHECK (expected_version > 0),
    reason TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `INSERT OR IGNORE INTO customer_service_conversation_versions (conversation_id, version, updated_at)
    SELECT id, 1, CURRENT_TIMESTAMP FROM customer_service_conversations`,
  `CREATE TRIGGER IF NOT EXISTS customer_service_conversation_version_insert
    AFTER INSERT ON customer_service_conversations
    BEGIN
      INSERT OR IGNORE INTO customer_service_conversation_versions (conversation_id, version, updated_at)
      VALUES (NEW.id, 1, CURRENT_TIMESTAMP);
    END`,
  `CREATE TRIGGER IF NOT EXISTS customer_service_conversation_version_update
    BEFORE UPDATE ON customer_service_conversations
    WHEN EXISTS (SELECT 1 FROM customer_service_conversation_versions WHERE conversation_id = OLD.id)
    BEGIN
      UPDATE customer_service_conversation_versions
      SET version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE conversation_id = OLD.id;
    END`,
  `CREATE INDEX IF NOT EXISTS customer_service_conversations_consulted_idx ON customer_service_conversations (consulted_at DESC)`,
  `CREATE INDEX IF NOT EXISTS customer_service_conversations_filter_idx ON customer_service_conversations (agent, match_status, consulted_at DESC)`,
  `CREATE INDEX IF NOT EXISTS customer_service_conversations_shop_last_batch_idx ON customer_service_conversations (shop_name, last_import_batch_id)`,
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
    for (const migration of migrations) {
      try {
        await migration.run();
      } catch (error) {
        if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) throw error;
      }
    }
    if (conversationColumns.results.some((column) => column.name === "version")) {
      await db.prepare(`UPDATE customer_service_conversation_versions
        SET version = MAX(version, COALESCE((
          SELECT legacy.version FROM customer_service_conversations legacy
          WHERE legacy.id = customer_service_conversation_versions.conversation_id
        ), version))`).run();
    }
    await db.prepare("UPDATE customer_service_conversations SET conversation_key = shop_name || ':' || conversation_key WHERE conversation_key NOT LIKE shop_name || ':%'").run();
  })().catch((error: unknown) => { ready.delete(key); throw error; });
  ready.set(key, task);
  return task;
}
function safeJson<T>(input: string, fallback: T) { try { return JSON.parse(input) as T; } catch { return fallback; } }
function mapBatch(row: Record<string, unknown>): CustomerServiceImportBatch {
  const allWarnings = safeJson<unknown>(String(row.warnings_json), []);
  const warningItems = Array.isArray(allWarnings)
    ? allWarnings
    : allWarnings && typeof allWarnings === "object" && Array.isArray((allWarnings as { items?: unknown }).items)
      ? (allWarnings as { items: unknown[] }).items
      : [];
  const persistedTotal = allWarnings && typeof allWarnings === "object" && !Array.isArray(allWarnings)
    ? Number((allWarnings as { totalCount?: unknown }).totalCount ?? 0)
    : 0;
  const warningSummary = summarizeCustomerServiceWarnings(warningItems, Math.max(persistedTotal, Number(row.warning_total_count ?? 0)));
  return { id: String(row.id), shopName: String(row.shop_name || "志高商用设备"), sessionFileName: String(row.session_file_name), chatFileName: String(row.chat_file_name), fileHash: String(row.file_hash), status: String(row.status), conversationCount: Number(row.conversation_count), matchedCount: Number(row.matched_count), sessionOnlyCount: Number(row.session_only_count), chatOnlyCount: Number(row.chat_only_count), ambiguousCount: Number(row.ambiguous_count), ...warningSummary, createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : null };
}

export async function listCustomerServiceBatches(input: { page?: number; pageSize?: number } = {}) {
  const db = getCustomerServiceDatabase(); await ensureCustomerServiceSchema(db);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 20;
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) throw new PublicApiError(400, "invalid_request", "page 必须为 1 到 10000 的整数。");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new PublicApiError(400, "invalid_request", "pageSize 必须为 1 到 100 的整数。");
  const [result, count] = await Promise.all([
    db.prepare(`SELECT id, shop_name, session_file_name, chat_file_name, file_hash, status,
      conversation_count, matched_count, session_only_count, chat_only_count, ambiguous_count,
      CASE
        WHEN json_type(warnings_json) = 'array' THEN json_array_length(warnings_json)
        WHEN json_type(warnings_json) = 'object' THEN COALESCE(CAST(json_extract(warnings_json, '$.totalCount') AS INTEGER), 0)
        ELSE 0
      END AS warning_total_count,
      created_at, completed_at
      FROM customer_service_import_batches ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(pageSize, (page - 1) * pageSize).all<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) AS total FROM customer_service_import_batches").first<{ total: number }>(),
  ]);
  const batchIds = result.results.map((row) => String(row.id));
  const warnings = batchIds.length
    ? await db.prepare(`SELECT batch.id AS batch_id,
          substr(COALESCE(CAST(warning.value AS TEXT), ''), 1, 500) AS warning
        FROM customer_service_import_batches batch
        JOIN json_each(CASE
          WHEN json_type(batch.warnings_json) = 'array' THEN batch.warnings_json
          WHEN json_type(batch.warnings_json) = 'object' THEN COALESCE(json_extract(batch.warnings_json, '$.items'), '[]')
          ELSE '[]'
        END) warning
        WHERE batch.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
          AND CAST(warning.key AS INTEGER) >= 0
          AND CAST(warning.key AS INTEGER) < 50
        ORDER BY batch.created_at DESC, batch.id DESC, CAST(warning.key AS INTEGER)`)
      .bind(JSON.stringify(batchIds)).all<{ batch_id: string; warning: string }>()
    : { results: [] as Array<{ batch_id: string; warning: string }> };
  const warningsByBatch = new Map<string, string[]>();
  warnings.results.forEach((row) => {
    const items = warningsByBatch.get(String(row.batch_id)) ?? [];
    items.push(String(row.warning));
    warningsByBatch.set(String(row.batch_id), items);
  });
  const items = result.results.map((row) => mapBatch({
    ...row,
    warnings_json: JSON.stringify(warningsByBatch.get(String(row.id)) ?? []),
  }));
  const total = Number(count?.total ?? 0);
  return { items, pagination: { page, pageSize, total, returned: items.length, truncated: (page - 1) * pageSize + items.length < total } };
}

export async function saveCustomerServiceImport(
  input: { shopName: string; sessionFileName: string; chatFileName: string; fileHash: string; parsed: CustomerServiceParseResult },
  database?: CustomerServiceDatabase,
) {
  if (!input.shopName.trim() || input.shopName.trim().length > 100) {
    throw new PublicApiError(422, "invalid_request", "客服导入店铺名称必须为 1 到 100 字");
  }
  if (input.parsed.conversations.length === 0) throw new PublicApiError(422, "invalid_request", "客服导入没有可保存的会话资料。");
  const { payloads } = planCustomerServiceImportPayloads(input.shopName, input.parsed.conversations);
  const db = database ?? getCustomerServiceDatabase();
  await ensureCustomerServiceSchema(db);
  await ensureImportFingerprintSchema(db);
  const warningSummary = summarizeCustomerServiceWarnings(input.parsed.warnings, input.parsed.warningTotalCount);
  const warningMetadata = {
    warnings: warningSummary.warnings,
    warningTotalCount: warningSummary.warningTotalCount,
    warningsTruncated: warningSummary.warningsTruncated,
  };

  const identityFingerprint = await buildImportContentFingerprint({
    domain: "customer-service-identities",
    scope: { shopName: input.shopName },
    rows: input.parsed.conversations.map((item) => ({ conversationKey: item.conversationKey })),
  });
  const fingerprint = await buildImportContentFingerprint({
    domain: "customer-service",
    scope: { shopName: input.shopName, identitySetHash: identityFingerprint.contentHash },
    lockScope: { shopName: input.shopName },
    rows: input.parsed.conversations,
    ignoredTopLevelKeys: ["sourceRowNumber"],
  });
  const storageConversationKeys = input.parsed.conversations
    .map((item) => `${input.shopName}:${item.conversationKey}`);
  const readScopeOwnership = async () => {
    const current = await db.prepare(
      `SELECT last_import_batch_id AS batch_id, COUNT(*) AS row_count
       FROM customer_service_conversations
       WHERE shop_name = ?
         AND conversation_key IN (SELECT value FROM json_each(?))
       GROUP BY last_import_batch_id
       ORDER BY last_import_batch_id`,
    ).bind(input.shopName, JSON.stringify(storageConversationKeys))
      .all<{ batch_id: string; row_count: number }>();
    return current.results.map((row) => ({ batchId: row.batch_id, rowCount: Number(row.row_count) }));
  };
  const scopeOwnership = await readScopeOwnership();
  const currentStateToken = await readImportScopeStateToken(db, fingerprint);
  const currentBatchId = scopeOwnership.length === 1
    && scopeOwnership[0]?.rowCount === input.parsed.conversations.length
    ? scopeOwnership[0].batchId
    : null;
  const currentBatch = currentBatchId
    ? await db.prepare("SELECT * FROM customer_service_import_batches WHERE id = ? LIMIT 1")
      .bind(currentBatchId).first<Record<string, unknown>>()
    : null;
  const currentFingerprint = currentBatchId
    ? await findImportFingerprintByBatch(db, { domain: fingerprint.domain, batchId: currentBatchId })
    : null;
  if (currentBatch && String(currentBatch.status) === "completed"
    && currentFingerprint?.scopeKey === fingerprint.scopeKey
    && currentFingerprint.contentHash === fingerprint.contentHash) {
    await recordImportFingerprint(db, {
      ...fingerprint,
      batchId: currentBatchId!,
      importHash: currentFingerprint.importHash,
      rawFileHash: input.fileHash,
      publishedStateToken: currentStateToken,
      metadata: { fileName: `${input.sessionFileName} + ${input.chatFileName}`, ...warningMetadata },
      outcome: "duplicate",
    });
    return { status: "duplicate" as const, batch: mapBatch(currentBatch), warningSummary };
  }
  const importHash = await buildImportAttemptHash({
    fingerprint,
    currentStateToken,
  });
  const id = `cs_${importHash}`;
  const reservation = await reserveImportFingerprint(db, {
    ...fingerprint,
    batchId: id,
    importHash,
    rawFileHash: input.fileHash,
    currentStateToken,
    metadata: { fileName: `${input.sessionFileName} + ${input.chatFileName}`, ...warningMetadata },
  });
  if (!reservation.claimed) throw new PublicApiError(409, "conflict", "同一客服会话范围正在处理或已被更新，请稍后刷新重试。");
  await renewImportFingerprintReservation(db, { ...fingerprint, batchId: id, attemptId: reservation.attemptId });
  try {
  const { summary } = input.parsed;
  const statements = [
    db.prepare(`INSERT INTO customer_service_import_batches (
      id, shop_name, session_file_name, chat_file_name, file_hash, status,
      conversation_count, matched_count, session_only_count, chat_only_count,
      ambiguous_count, warnings_json
    ) VALUES (?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_hash) DO NOTHING`).bind(
      id,
      input.shopName.slice(0, 100),
      input.sessionFileName.slice(0, 240),
      input.chatFileName.slice(0, 240),
      importHash,
      input.parsed.conversations.length,
      summary.matchedCount + summary.timeOnlyMatchedCount,
      summary.sessionOnlyCount,
      summary.chatOnlyCount,
      summary.ambiguousCount,
      JSON.stringify({ items: warningSummary.warnings, totalCount: warningSummary.warningTotalCount, truncated: warningSummary.warningsTruncated }),
    ),
  ];
  for (const payload of payloads) {
    statements.push(
      db.prepare(`DELETE FROM customer_service_conversations
        WHERE shop_name = ? AND match_status = 'chat_only'
          AND EXISTS (
            SELECT 1 FROM json_each(?) item
            WHERE json_extract(item.value, '$.chatStartedAt') <> ''
              AND json_array_length(json_extract(item.value, '$.messages')) > 0
              AND customer_service_conversations.chat_started_at = json_extract(item.value, '$.chatStartedAt')
              AND customer_service_conversations.chat_ended_at = json_extract(item.value, '$.chatEndedAt')
              AND customer_service_conversations.chat_customer_alias = json_extract(item.value, '$.chatCustomerAlias')
              AND customer_service_conversations.messages_json = json(json_extract(item.value, '$.messages'))
              AND customer_service_conversations.conversation_key <> json_extract(item.value, '$.storageConversationKey')
          )
          AND EXISTS (SELECT 1 FROM customer_service_import_batches WHERE id = ? AND status = 'processing')`)
        .bind(input.shopName, payload, id),
      db.prepare(`INSERT INTO customer_service_conversations (
        conversation_key, first_import_batch_id, last_import_batch_id, shop_name,
        consulted_at, customer_id, customer_alias, consultation_type, agent,
        transferred_agent, skill_group, product_sku, product_name, first_response_at,
        response_seconds, duration_minutes, customer_message_count, agent_message_count,
        satisfaction, resolved, conversation_id, match_status, match_confidence,
        chat_started_at, chat_ended_at, chat_customer_alias, messages_json, updated_at
      )
      SELECT
        json_extract(item.value, '$.storageConversationKey'), ?, ?, ?,
        json_extract(item.value, '$.consultedAt'), json_extract(item.value, '$.customerId'),
        json_extract(item.value, '$.customerAlias'), json_extract(item.value, '$.consultationType'),
        json_extract(item.value, '$.agent'), json_extract(item.value, '$.transferredAgent'),
        json_extract(item.value, '$.skillGroup'), json_extract(item.value, '$.productSku'),
        json_extract(item.value, '$.productName'), json_extract(item.value, '$.firstResponseAt'),
        json_extract(item.value, '$.responseSeconds'), json_extract(item.value, '$.durationMinutes'),
        json_extract(item.value, '$.customerMessageCount'), json_extract(item.value, '$.agentMessageCount'),
        json_extract(item.value, '$.satisfaction'), json_extract(item.value, '$.resolved'),
        json_extract(item.value, '$.conversationId'), json_extract(item.value, '$.matchStatus'),
        json_extract(item.value, '$.matchConfidence'), json_extract(item.value, '$.chatStartedAt'),
        json_extract(item.value, '$.chatEndedAt'), json_extract(item.value, '$.chatCustomerAlias'),
        json(json_extract(item.value, '$.messages')), CURRENT_TIMESTAMP
      FROM json_each(?) item
      WHERE EXISTS (SELECT 1 FROM customer_service_import_batches WHERE id = ? AND status = 'processing')
      ON CONFLICT(conversation_key) DO UPDATE SET
        last_import_batch_id = excluded.last_import_batch_id,
        shop_name = excluded.shop_name,
        consulted_at = excluded.consulted_at,
        customer_id = excluded.customer_id,
        customer_alias = excluded.customer_alias,
        consultation_type = excluded.consultation_type,
        agent = excluded.agent,
        transferred_agent = excluded.transferred_agent,
        skill_group = excluded.skill_group,
        product_sku = excluded.product_sku,
        product_name = excluded.product_name,
        first_response_at = excluded.first_response_at,
        response_seconds = excluded.response_seconds,
        duration_minutes = excluded.duration_minutes,
        customer_message_count = excluded.customer_message_count,
        agent_message_count = excluded.agent_message_count,
        satisfaction = excluded.satisfaction,
        resolved = excluded.resolved,
        conversation_id = excluded.conversation_id,
        match_status = excluded.match_status,
        match_confidence = excluded.match_confidence,
        chat_started_at = excluded.chat_started_at,
        chat_ended_at = excluded.chat_ended_at,
        chat_customer_alias = excluded.chat_customer_alias,
        messages_json = excluded.messages_json,
        updated_at = CURRENT_TIMESTAMP`).bind(id, id, input.shopName, payload, id),
    );
  }
  statements.push(
    db.prepare(`UPDATE customer_service_import_batches
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'processing'
        AND (SELECT COUNT(*) FROM customer_service_conversations WHERE last_import_batch_id = ?) = ?`)
      .bind(id, id, input.parsed.conversations.length),
  );
  statements.push(importReservationCommitFence(db, {
    domain: fingerprint.domain,
    scopeKey: fingerprint.scopeKey,
    batchId: id,
    attemptId: reservation.attemptId,
  }));
  const results = await db.batch(statements).catch((error: unknown) => rethrowImportPublishError(db, {
    domain: fingerprint.domain,
    scopeKey: fingerprint.scopeKey,
    batchId: id,
    attemptId: reservation.attemptId,
  }, error));
  const created = Number(results[0]?.meta?.changes ?? 0) === 1;
  const batch = await db.prepare("SELECT * FROM customer_service_import_batches WHERE file_hash = ? LIMIT 1")
    .bind(importHash).first<Record<string, unknown>>();
  const postOwnership = await readScopeOwnership();
  if (!batch || String(batch.status) !== "completed" || postOwnership.length !== 1
    || postOwnership[0]?.batchId !== String(batch.id)
    || postOwnership[0].rowCount !== input.parsed.conversations.length) {
    throw new Error("客服会话导入发布后回查不一致");
  }
  await recordImportFingerprint(db, {
    ...fingerprint,
    batchId: String(batch.id),
    importHash,
    rawFileHash: input.fileHash,
    attemptId: reservation.attemptId,
    publishedStateToken: await nextImportScopeStateToken({
      previousStateToken: currentStateToken,
      batchId: String(batch.id),
      contentHash: fingerprint.contentHash,
      rowCount: fingerprint.rowCount,
    }),
    metadata: { fileName: `${input.sessionFileName} + ${input.chatFileName}`, ...warningMetadata },
    outcome: created ? "imported" : "duplicate",
  });
  return { status: created ? "imported" as const : "duplicate" as const, batch: mapBatch(batch), warningSummary };
  } catch (error) {
    await failImportFingerprint(db, { ...fingerprint, batchId: id, importHash, rawFileHash: input.fileHash, attemptId: reservation.attemptId, metadata: { fileName: `${input.sessionFileName} + ${input.chatFileName}`, ...warningMetadata }, errorCode: "CUSTOMER_SERVICE_IMPORT_FAILED" }).catch(() => undefined);
    throw error;
  }
}

function splitIds(value?: string | null) {
  const raw = (value ?? "").split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean);
  if (raw.length > 100 || raw.some((item) => !/^[A-Za-z0-9_-]{2,80}$/.test(item))) {
    throw new PublicApiError(400, "invalid_request", "SKU/SPU 筛选最多 100 项，且每项须为 2 到 80 位字母、数字、下划线或连字符。");
  }
  return [...new Set(raw)];
}
function filterValues(values?: readonly string[], fallback?: string | null, label = "筛选项", max = 50, maxLength = 120) {
  const raw = [...(values ?? []), fallback ?? ""].map((value) => value.trim()).filter(Boolean);
  if (raw.length > max || raw.some((value) => value.length > maxLength)) {
    throw new PublicApiError(400, "invalid_request", `${label}最多 ${max} 项，且每项不能超过 ${maxLength} 字。`);
  }
  return [...new Set(raw)];
}
function enumFilter(values: readonly string[], allowed: readonly string[], label: string) {
  const invalid = values.filter((value) => !allowed.includes(value));
  if (invalid.length) throw new PublicApiError(400, "invalid_request", `${label}包含无效值：${invalid.join("、")}`);
  return values;
}
function addInFilter(conditions: string[], bindings: unknown[], column: string, selected: readonly string[]) {
  if (!selected.length) return;
  conditions.push(`${column} IN (SELECT CAST(value AS TEXT) FROM json_each(?))`);
  bindings.push(JSON.stringify(selected));
}
type CustomerServiceConversationFilters = {
  shopNames?: string[]; shopName?: string | null;
  startDate?: string | null; endDate?: string | null;
  agents?: string[]; agent?: string | null;
  statuses?: string[]; status?: string | null;
  robotScopes?: string[]; robotScope?: string | null;
  problemTypes?: string[]; problemType?: string | null;
  conversionStatuses?: string[]; conversionStatus?: string | null;
  categories?: string[]; category?: string | null;
  query?: string | null; skuIds?: string | null; spuIds?: string | null;
  page?: number | null; pageSize?: number | null; includeOptions?: boolean;
};

const conversationSummaryColumns = `
  id, shop_name, consulted_at, customer_id, customer_alias, consultation_type,
  agent, transferred_agent, skill_group, product_sku, product_name,
  first_response_at, response_seconds, duration_minutes, customer_message_count,
  agent_message_count, satisfaction, resolved, conversation_id, match_status,
  match_confidence, chat_started_at, chat_ended_at, chat_customer_alias,
  robot_scope, problem_type, conversion_status, service_issues, summary_text,
  analysis_source, analyzed_at, annotated_at,
  COALESCE((SELECT version FROM customer_service_conversation_versions version_state
    WHERE version_state.conversation_id = customer_service_conversations.id), 1) AS version,
  updated_at,
  CASE WHEN json_valid(messages_json) THEN json_array_length(messages_json) ELSE 0 END AS message_total_count
`;

async function loadCustomerServiceMasterRows(
  principal: AppPrincipal,
  netshopReader: NetshopConsumerReader,
  input: { lookupCodes?: readonly string[]; spuIds?: readonly string[]; limit: number; signal?: AbortSignal },
) {
  const result = await netshopReader.read(principal, {
    operation: "product_master_lookup",
    lookupCodes: [...new Set(input.lookupCodes ?? [])],
    spuIds: [...new Set(input.spuIds ?? [])],
    limit: input.limit,
  }, { signal: input.signal });
  const data = result?.data as NetshopConsumerResponseMap["product_master_lookup"] | undefined;
  if (!result?.revision || !data || !Array.isArray(data.rows) || typeof data.truncated !== "boolean"
    || data.truncated || data.rows.length > input.limit || !data.rows.every((row) => (
      row && typeof row === "object" && typeof row.skuId === "string" && row.skuId.length <= 200
      && typeof row.spuId === "string" && row.spuId.length <= 200
      && typeof row.productCode === "string" && row.productCode.length <= 200
      && typeof row.onlineSpecCode === "string" && row.onlineSpecCode.length <= 200
      && row.raw && typeof row.raw === "object" && !Array.isArray(row.raw)
    ))) {
    throw new PublicApiError(503, "service_unavailable", "Django 网店读取服务返回了无效的货品映射。");
  }
  return data.rows.map<CustomerServiceMasterProductRow>((row) => ({
    sku_id: row.skuId,
    spu_id: row.spuId,
    product_code: row.productCode,
    raw_json: JSON.stringify(row.raw),
  }));
}

function lookupCodesForOnlineSpecs(rows: CustomerServiceMasterProductRow[]) {
  const byOnlineSpec = new Map<string, Set<string>>();
  for (const row of rows) {
    const raw = safeJson<Record<string, unknown>>(row.raw_json, {});
    const onlineSpec = String(raw["商家SKU"] ?? "").trim();
    if (!onlineSpec) continue;
    const skuIds = byOnlineSpec.get(onlineSpec) ?? new Set<string>();
    if (row.sku_id) skuIds.add(row.sku_id);
    byOnlineSpec.set(onlineSpec, skuIds);
  }
  const result = new Set<string>();
  for (const [onlineSpec, skuIds] of byOnlineSpec) {
    for (const skuId of skuIds) result.add(skuId);
    if (skuIds.size === 1) result.add(onlineSpec);
  }
  return [...result];
}

function normalizeNaturalDate(value: string, label: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new PublicApiError(400, "invalid_request", `${label}必须为 YYYY-MM-DD 格式。`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2199 || candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    throw new PublicApiError(400, "invalid_request", `${label}不是有效自然日期。`);
  }
  return value;
}

function nextNaturalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

type CustomerServiceSalesOptions = {
  salesReader?: SalesConsumerReader;
  netshopReader?: NetshopConsumerReader;
  signal?: AbortSignal;
};

function salesConsumerUnavailable(): PublicApiError {
  return new PublicApiError(503, "service_unavailable", "Django 销售读取服务暂时不可用，请稍后重试。");
}

function validSalesProductRow(
  value: unknown,
): value is SalesConsumerResponseMap["customer_service_products"]["rows"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.onlineSpecCode === "string" && row.onlineSpecCode.length <= 200
    && typeof row.productCode === "string" && row.productCode.length <= 200
    && typeof row.category === "string" && row.category.length <= 200
    && (row.latestAt === null || (typeof row.latestAt === "string" && row.latestAt.length <= 80));
}

async function readCustomerServiceSalesProducts(
  principal: AppPrincipal,
  salesReader: SalesConsumerReader,
  input: { onlineSpecCodes?: string[]; categories?: string[]; signal?: AbortSignal },
): Promise<CustomerServiceSalesProductRow[]> {
  const onlineSpecCodes = [...new Set(input.onlineSpecCodes ?? [])];
  const chunks = onlineSpecCodes.length > 0
    ? Array.from({ length: Math.ceil(onlineSpecCodes.length / 2_000) }, (_, index) => onlineSpecCodes.slice(index * 2_000, (index + 1) * 2_000))
    : [[]];
  const rows: CustomerServiceSalesProductRow[] = [];
  let revision: string | null = null;
  for (const chunk of chunks) {
    const result = await salesReader.read(principal, {
      operation: "customer_service_products",
      ...(chunk.length > 0 ? { onlineSpecCodes: chunk } : {}),
      ...(input.categories?.length ? { categories: input.categories } : {}),
      limit: 5_000,
    }, { signal: input.signal });
    if (!result || typeof result.revision !== "string" || !result.revision
      || (revision !== null && result.revision !== revision)
      || !result.data || !Array.isArray(result.data.rows)
      || typeof result.data.truncated !== "boolean" || result.data.truncated
      || !result.data.rows.every(validSalesProductRow)) {
      throw salesConsumerUnavailable();
    }
    revision = result.revision;
    const requested = new Set(chunk);
    for (const row of result.data.rows) {
      if (requested.size > 0 && !requested.has(row.onlineSpecCode)) throw salesConsumerUnavailable();
      rows.push({
        online_spec_code: row.onlineSpecCode,
        product_code: row.productCode,
        category: row.category,
      });
    }
  }
  return rows;
}

export async function listCustomerServiceConversations(
  filters: CustomerServiceConversationFilters,
  principal: AppPrincipal,
  options: CustomerServiceSalesOptions = {},
) {
  requireUnrestrictedDataScope(principal, "客服会话");
  const shopFilters = filterValues(filters.shopNames, filters.shopName, "店铺筛选", 50, 100);
  const agentFilters = filterValues(filters.agents, filters.agent, "客服筛选", 50, 120);
  const statusFilters = enumFilter(
    filterValues(filters.statuses, filters.status, "匹配状态筛选", 20, 40),
    ["matched", "session_only", "chat_only", "ambiguous"],
    "匹配状态筛选",
  );
  const robotScopeFilters = enumFilter(
    filterValues(filters.robotScopes, filters.robotScope, "机器人筛选", 20, 40),
    customerServiceRobotScopes,
    "机器人筛选",
  );
  const problemTypeFilters = enumFilter(
    filterValues(filters.problemTypes, filters.problemType, "问题类型筛选", 20, 40),
    customerServiceProblemTypes,
    "问题类型筛选",
  );
  const conversionStatusFilters = enumFilter(
    filterValues(filters.conversionStatuses, filters.conversionStatus, "转化状态筛选", 20, 40),
    customerServiceConversionStatuses,
    "转化状态筛选",
  );
  const categoryFilters = filterValues(filters.categories, filters.category, "品类筛选", 50, 120);
  const db = getCustomerServiceDatabase(); await ensureCustomerServiceSchema(db);
  const salesReader = options.salesReader ?? createDjangoSalesConsumerReader();
  const netshopReader = options.netshopReader ?? createDjangoNetshopConsumerReader();
  const conditions: string[] = []; const values: unknown[] = [];
  addInFilter(conditions, values, "shop_name", shopFilters);
  const startDate = filters.startDate ? normalizeNaturalDate(filters.startDate, "开始日期") : null;
  const endDate = filters.endDate ? normalizeNaturalDate(filters.endDate, "结束日期") : null;
  if (startDate && endDate && startDate > endDate) throw new PublicApiError(400, "invalid_request", "开始日期不能晚于结束日期。");
  if (startDate) { conditions.push("consulted_at >= ?"); values.push(`${startDate} 00:00:00`); }
  if (endDate) { conditions.push("consulted_at < ?"); values.push(`${nextNaturalDate(endDate)} 00:00:00`); }
  addInFilter(conditions, values, "agent", agentFilters);
  addInFilter(conditions, values, "match_status", statusFilters);
  addInFilter(conditions, values, "robot_scope", robotScopeFilters);
  addInFilter(conditions, values, "problem_type", problemTypeFilters);
  addInFilter(conditions, values, "conversion_status", conversionStatusFilters);
  if (categoryFilters.length) {
    const salesRows = await readCustomerServiceSalesProducts(principal, salesReader, {
      categories: categoryFilters,
      signal: options.signal,
    });
    const matchedOnlineSpecCodes = [...new Set(salesRows.map((row) => row.online_spec_code).filter(Boolean))];
    if (matchedOnlineSpecCodes.length === 0) {
      conditions.push("1 = 0");
    } else {
      const masterRows = await loadCustomerServiceMasterRows(principal, netshopReader, {
        lookupCodes: matchedOnlineSpecCodes,
        limit: 5_000,
        signal: options.signal,
      });
      const mappedProductCodes = lookupCodesForOnlineSpecs(masterRows);
      if (mappedProductCodes.length) {
        conditions.push("product_sku IN (SELECT CAST(value AS TEXT) FROM json_each(?))");
        values.push(JSON.stringify(mappedProductCodes));
      } else {
        conditions.push("1 = 0");
      }
    }
  }
  const query = filters.query?.trim() ?? "";
  if (query && (query.length < 2 || query.length > 100)) throw new PublicApiError(400, "invalid_request", "搜索关键词长度必须为 2 到 100 个字符。");
  if (query) {
    conditions.push("(customer_id LIKE ? ESCAPE '\\' OR customer_alias LIKE ? ESCAPE '\\' OR agent LIKE ? ESCAPE '\\' OR product_sku LIKE ? ESCAPE '\\' OR product_name LIKE ? ESCAPE '\\' OR messages_json LIKE ? ESCAPE '\\' OR service_issues LIKE ? ESCAPE '\\' OR summary_text LIKE ? ESCAPE '\\')");
    const wildcard = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    values.push(wildcard, wildcard, wildcard, wildcard, wildcard, wildcard, wildcard, wildcard);
  }
  const skuIds = splitIds(filters.skuIds);
  const spuIds = splitIds(filters.spuIds);
  if (skuIds.length) { conditions.push("product_sku IN (SELECT CAST(value AS TEXT) FROM json_each(?))"); values.push(JSON.stringify(skuIds)); }
  if (spuIds.length) {
    const masterRows = await loadCustomerServiceMasterRows(principal, netshopReader, {
      spuIds,
      limit: 5_000,
      signal: options.signal,
    });
    const matchedCodes = [...new Set(masterRows.flatMap((row) => [row.sku_id, row.product_code]).filter(Boolean))];
    if (matchedCodes.length) {
      conditions.push("product_sku IN (SELECT CAST(value AS TEXT) FROM json_each(?))");
      values.push(JSON.stringify(matchedCodes));
    } else {
      conditions.push("1 = 0");
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const page = filters.page == null ? 1 : Number(filters.page);
  const pageSize = filters.pageSize == null ? 30 : Number(filters.pageSize);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) throw new PublicApiError(400, "invalid_request", "page 必须为 1 到 10000 的整数。");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new PublicApiError(400, "invalid_request", "pageSize 必须为 1 到 100 的整数。");
  const includeOptions = filters.includeOptions !== false;
  const [items, summaryResult, agents, shops, optionProducts] = await Promise.all([
    db.prepare(`SELECT ${conversationSummaryColumns} FROM customer_service_conversations ${where} ORDER BY consulted_at DESC, id DESC LIMIT ? OFFSET ?`).bind(...values, pageSize, (page - 1) * pageSize).all<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END) AS matched, SUM(CASE WHEN match_status = 'session_only' THEN 1 ELSE 0 END) AS session_only, SUM(CASE WHEN match_status = 'chat_only' THEN 1 ELSE 0 END) AS chat_only FROM customer_service_conversations ${where}`).bind(...values).first<Record<string, number | null>>(),
    includeOptions
      ? db.prepare(`SELECT DISTINCT agent FROM customer_service_conversations WHERE agent <> '' ORDER BY agent COLLATE NOCASE ASC LIMIT 100`).all<{ agent: string }>()
      : Promise.resolve({ results: [] as Array<{ agent: string }> }),
    includeOptions
      ? db.prepare(`SELECT DISTINCT shop_name FROM customer_service_conversations WHERE shop_name <> '' ORDER BY shop_name COLLATE NOCASE ASC LIMIT 100`).all<{ shop_name: string }>()
      : Promise.resolve({ results: [] as Array<{ shop_name: string }> }),
    includeOptions
      ? db.prepare(`SELECT DISTINCT product_sku
          FROM customer_service_conversations
          WHERE product_sku <> ''
          ORDER BY product_sku COLLATE NOCASE ASC LIMIT 5001`)
        .all<{ product_sku: string }>()
      : Promise.resolve({ results: [] as Array<{ product_sku: string }> }),
  ]);
  if (optionProducts.results.length > 5_000) {
    throw new PublicApiError(503, "service_unavailable", "客服商品筛选范围超过 5000 个有界映射上限。");
  }
  const optionProductCodes = optionProducts.results.map((item) => item.product_sku).filter(Boolean);
  const categoryMasterRows = includeOptions && optionProductCodes.length > 0
    ? await loadCustomerServiceMasterRows(principal, netshopReader, {
      lookupCodes: optionProductCodes,
      limit: 5_000,
      signal: options.signal,
    })
    : [];
  const categoryOnlineSpecCodes = customerServiceOnlineSpecCodes(categoryMasterRows);
  const categorySalesRows = includeOptions && categoryOnlineSpecCodes.length > 0
    ? await readCustomerServiceSalesProducts(principal, salesReader, {
      onlineSpecCodes: categoryOnlineSpecCodes,
      signal: options.signal,
    })
    : [];
  const categoryOptions = [...new Set(categorySalesRows.map((item) => item.category.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 100);
  const customerItems = items.results.map((row) => mapCustomerServiceConversation(row));
  const productSkus = [...new Set(customerItems.map((item) => item.productSku).filter(Boolean))];
  let catalog = new Map<string, CustomerServiceProductMapping>();
  if (productSkus.length) {
    const rows = await loadCustomerServiceMasterRows(principal, netshopReader, {
      lookupCodes: productSkus,
      limit: 5_000,
      signal: options.signal,
    });
    const onlineSpecCodes = customerServiceOnlineSpecCodes(rows);
    let salesRows: CustomerServiceSalesProductRow[] = [];
    if (onlineSpecCodes.length) {
      salesRows = await readCustomerServiceSalesProducts(principal, salesReader, {
        onlineSpecCodes,
        signal: options.signal,
      });
    }
    catalog = buildCustomerServiceProductMappings(productSkus, rows, salesRows);
  }
  const total = Number(summaryResult?.total ?? 0);
  return { items: customerItems.map((item) => { const matched = catalog.get(item.productSku); return { ...item, matchedSkuId: matched?.matchedSkuId ?? "", productSpuId: matched?.spuId ?? "", erpProductCode: matched?.erpProductCode ?? "", productCategory: matched?.category ?? "" }; }), agents: agents.results.map((item) => item.agent), shops: shops.results.map((item) => item.shop_name), categories: categoryOptions, summary: { total, matched: Number(summaryResult?.matched ?? 0), sessionOnly: Number(summaryResult?.session_only ?? 0), chatOnly: Number(summaryResult?.chat_only ?? 0) }, pagination: { page, pageSize, total, returned: customerItems.length, truncated: page * pageSize < total } };
}

function boundedMessages(row: Record<string, unknown>, includeMessages: boolean) {
  const parsed = includeMessages ? safeJson<unknown>(String(row.messages_json ?? "[]"), []) : [];
  const source = Array.isArray(parsed) ? parsed : [];
  const projectedTotal = Math.max(0, Number(row.message_total_count ?? 0));
  const total = includeMessages ? Math.max(source.length, projectedTotal) : projectedTotal;
  if (!includeMessages) return { messages: [] as CustomerServiceConversation["messages"], total, truncated: total > 0 };
  const messages: CustomerServiceConversation["messages"] = [];
  const encoder = new TextEncoder();
  for (const raw of source.slice(0, CUSTOMER_SERVICE_MESSAGE_LIMIT)) {
    if (!raw || typeof raw !== "object") continue;
    const message = raw as Record<string, unknown>;
    const candidate = {
      sender: String(message.sender ?? "").slice(0, 120),
      sentAt: String(message.sentAt ?? "").slice(0, 80),
      content: String(message.content ?? "").slice(0, CUSTOMER_SERVICE_MESSAGE_CONTENT_LIMIT),
    };
    if (encoder.encode(JSON.stringify([...messages, candidate])).byteLength > CUSTOMER_SERVICE_MESSAGE_BYTES_LIMIT) break;
    messages.push(candidate);
  }
  return { messages, total, truncated: messages.length < total };
}

function mapCustomerServiceConversation(row: Record<string, unknown>, includeMessages = false): CustomerServiceConversation {
  const bounded = boundedMessages(row, includeMessages);
  return { id: Number(row.id), shopName: String(row.shop_name || "志高商用设备"), consultedAt: String(row.consulted_at), customerId: String(row.customer_id), customerAlias: String(row.customer_alias), consultationType: String(row.consultation_type), agent: String(row.agent), transferredAgent: String(row.transferred_agent), skillGroup: String(row.skill_group), productSku: String(row.product_sku), matchedSkuId: "", productSpuId: "", erpProductCode: "", productCategory: "", productName: String(row.product_name), firstResponseAt: String(row.first_response_at), responseSeconds: row.response_seconds === null ? null : Number(row.response_seconds), durationMinutes: row.duration_minutes === null ? null : Number(row.duration_minutes), customerMessageCount: row.customer_message_count === null ? null : Number(row.customer_message_count), agentMessageCount: row.agent_message_count === null ? null : Number(row.agent_message_count), satisfaction: String(row.satisfaction), resolved: String(row.resolved), conversationId: String(row.conversation_id), matchStatus: String(row.match_status), matchConfidence: String(row.match_confidence), chatStartedAt: String(row.chat_started_at), chatEndedAt: String(row.chat_ended_at), chatCustomerAlias: String(row.chat_customer_alias), messages: bounded.messages, messageTotalCount: bounded.total, messageReturnedCount: bounded.messages.length, messagesTruncated: bounded.truncated, robotScope: String(row.robot_scope || "") as CustomerServiceConversation["robotScope"], problemType: String(row.problem_type || "") as CustomerServiceConversation["problemType"], conversionStatus: String(row.conversion_status || "") as CustomerServiceConversation["conversionStatus"], serviceIssues: String(row.service_issues || ""), summaryText: String(row.summary_text || ""), analysisSource: String(row.analysis_source || "") as CustomerServiceConversation["analysisSource"], analyzedAt: row.analyzed_at ? String(row.analyzed_at) : null, annotatedAt: row.annotated_at ? String(row.annotated_at) : null, version: Math.max(1, Number(row.version ?? 1)), updatedAt: String(row.updated_at ?? "") };
}

async function getProjectedCustomerServiceConversationsByIds(ids: number[], messageLimit: number) {
  const normalized = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 20);
  if (!normalized.length) return [];
  const db = getCustomerServiceDatabase(); await ensureCustomerServiceSchema(db);
  const placeholders = normalized.map(() => "?").join(",");
  const snapshots = await db.prepare(`SELECT ${conversationSummaryColumns},
      COALESCE((
        SELECT json_group_array(json_object(
          'sender', projected.sender,
          'sentAt', projected.sent_at,
          'content', projected.content
        ))
        FROM (
          SELECT
            substr(COALESCE(CAST(json_extract(message.value, '$.sender') AS TEXT), ''), 1, 120) AS sender,
            substr(COALESCE(CAST(json_extract(message.value, '$.sentAt') AS TEXT), ''), 1, 80) AS sent_at,
            substr(COALESCE(CAST(json_extract(message.value, '$.content') AS TEXT), ''), 1, ?) AS content
          FROM json_each(CASE
            WHEN json_valid(customer_service_conversations.messages_json) THEN customer_service_conversations.messages_json
            ELSE '[]'
          END) message
          WHERE message.type = 'object'
            AND CAST(message.key AS INTEGER) >= 0
          ORDER BY CAST(message.key AS INTEGER)
          LIMIT ?
        ) projected
      ), '[]') AS messages_json
      FROM customer_service_conversations
      WHERE id IN (${placeholders})
      ORDER BY consulted_at DESC, id DESC`)
    .bind(CUSTOMER_SERVICE_MESSAGE_CONTENT_LIMIT, messageLimit, ...normalized)
    .all<Record<string, unknown>>();
  return snapshots.results.map((row) => mapCustomerServiceConversation(row, true));
}

export async function getCustomerServiceConversationById(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new PublicApiError(400, "invalid_request", "会话 ID 无效。");
  const [item] = await getProjectedCustomerServiceConversationsByIds([id], CUSTOMER_SERVICE_MESSAGE_LIMIT);
  if (!item) throw new PublicApiError(404, "not_found", "客服会话不存在。");
  return item;
}

export async function getCustomerServiceConversationsByIds(ids: number[]) {
  const normalized = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 20);
  if (!normalized.length) return [];
  return getProjectedCustomerServiceConversationsByIds(normalized, CUSTOMER_SERVICE_AI_MESSAGE_LIMIT);
}

function normalizedAnnotation(input: CustomerServiceAnnotationInput) {
  const output: CustomerServiceAnnotationInput = {};
  if (input.robotScope !== undefined) { if (!customerServiceRobotScopes.includes(input.robotScope)) throw new PublicApiError(422, "invalid_request", "机器人标注无效。"); output.robotScope = input.robotScope; }
  if (input.problemType !== undefined) { if (!customerServiceProblemTypes.includes(input.problemType)) throw new PublicApiError(422, "invalid_request", "问题类型无效。"); output.problemType = input.problemType; }
  if (input.conversionStatus !== undefined) { if (!customerServiceConversionStatuses.includes(input.conversionStatus)) throw new PublicApiError(422, "invalid_request", "订单转化状态无效。"); output.conversionStatus = input.conversionStatus; }
  if (input.serviceIssues !== undefined) output.serviceIssues = input.serviceIssues.trim().slice(0, 1000);
  if (input.summaryText !== undefined) output.summaryText = input.summaryText.trim().slice(0, 1000);
  if (input.analysisSource !== undefined) { if (!(["ai", "manual"] as const).includes(input.analysisSource)) throw new PublicApiError(422, "invalid_request", "分析来源无效。"); output.analysisSource = input.analysisSource; }
  return output;
}

export async function updateCustomerServiceConversationAnnotation(id: number, input: CustomerServiceAnnotationInput, expectedVersion: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new PublicApiError(400, "invalid_request", "会话 ID 无效。");
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) throw new PublicApiError(400, "invalid_request", "expectedVersion 必须为正整数。");
  const values = normalizedAnnotation(input);
  const columns: Record<keyof CustomerServiceAnnotationInput, string> = { robotScope: "robot_scope", problemType: "problem_type", conversionStatus: "conversion_status", serviceIssues: "service_issues", summaryText: "summary_text", analysisSource: "analysis_source" };
  const entries = Object.entries(values) as Array<[keyof CustomerServiceAnnotationInput, string]>;
  if (!entries.length) throw new PublicApiError(400, "invalid_request", "没有可保存的标注内容。");
  const db = getCustomerServiceDatabase(); await ensureCustomerServiceSchema(db);
  const assignments = entries.map(([key]) => `${columns[key]} = ?`);
  const analyzedAt = values.analysisSource === "ai";
  assignments.push("annotated_at = CURRENT_TIMESTAMP", "updated_at = CURRENT_TIMESTAMP");
  if (analyzedAt) assignments.push("analyzed_at = CURRENT_TIMESTAMP");
  const updated = await db.prepare(`UPDATE customer_service_conversations SET ${assignments.join(", ")}
      WHERE id = ?
        AND EXISTS (
          SELECT 1 FROM customer_service_conversation_versions version_state
          WHERE version_state.conversation_id = customer_service_conversations.id
            AND version_state.version = ?
        )
      RETURNING (
        SELECT version FROM customer_service_conversation_versions version_state
        WHERE version_state.conversation_id = customer_service_conversations.id
      ) AS version, updated_at`)
    .bind(...entries.map(([, value]) => value), id, expectedVersion)
    .first<{ version: number; updated_at: string }>();
  if (!updated) {
    const current = await db.prepare(`SELECT version_state.version
      FROM customer_service_conversations conversation
      LEFT JOIN customer_service_conversation_versions version_state ON version_state.conversation_id = conversation.id
      WHERE conversation.id = ?`).bind(id).first<{ version: number | null }>();
    if (!current) throw new PublicApiError(404, "not_found", "客服会话不存在。");
    throw new PublicApiError(409, "version_conflict", "客服会话已被其他操作更新，请刷新后重试。");
  }
  return { id, updated: true, version: Number(updated.version), updatedAt: String(updated.updated_at) };
}

export async function getCustomerServiceConversationsForAi(
  args: Record<string, unknown>,
  principal: AppPrincipal,
  options: CustomerServiceSalesOptions = {},
) {
  const payload = await listCustomerServiceConversations({ startDate: typeof args.startDate === "string" ? args.startDate : null, endDate: typeof args.endDate === "string" ? args.endDate : null, agent: typeof args.agent === "string" ? args.agent : null, problemType: typeof args.problemType === "string" ? args.problemType : null, conversionStatus: typeof args.conversionStatus === "string" ? args.conversionStatus : null, category: typeof args.category === "string" ? args.category : null, query: typeof args.query === "string" ? args.query : null, page: 1, pageSize: Math.max(1, Math.min(50, Number(args.limit) || 20)), includeOptions: false }, principal, options);
  return { filtersApplied: { startDate: args.startDate ?? null, endDate: args.endDate ?? null, agent: args.agent ?? null, problemType: args.problemType ?? null, conversionStatus: args.conversionStatus ?? null, category: args.category ?? null, query: args.query ?? null }, returned: payload.items.length, totalMatched: payload.pagination.total, truncated: payload.pagination.total > payload.items.length, items: payload.items.map((item) => ({ id: item.id, shopName: item.shopName, consultedAt: item.consultedAt, agent: item.agent, sourceProductCode: item.productSku, matchedSkuId: item.matchedSkuId, productSpuId: item.productSpuId, erpProductCode: item.erpProductCode, productCategory: item.productCategory, robotScope: item.robotScope, problemType: item.problemType, conversionStatus: item.conversionStatus, serviceIssues: item.serviceIssues, summary: item.summaryText, matchStatus: item.matchStatus })) };
}

export async function deleteCustomerServiceConversation(id: number, expectedVersion: number, actor: string, reason: string) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new PublicApiError(400, "invalid_request", "会话 ID 无效。");
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) throw new PublicApiError(400, "invalid_request", "expectedVersion 必须为正整数。");
  const normalizedActor = actor.trim().toLowerCase();
  const normalizedReason = reason.trim();
  if (!normalizedActor || normalizedActor.length > 254) throw new PublicApiError(400, "invalid_request", "删除操作缺少有效执行人。");
  if (!normalizedReason || normalizedReason.length > 200) throw new PublicApiError(400, "invalid_request", "删除原因必须为 1 到 200 字。");
  const db = getCustomerServiceDatabase(); await ensureCustomerServiceSchema(db);
  const auditId = crypto.randomUUID();
  const [auditResult, deleteResult] = await db.batch([
    db.prepare(`INSERT INTO customer_service_deletion_audits (
        audit_id, conversation_id, conversation_key, actor, old_version, expected_version, reason
      )
      SELECT ?, conversation.id, conversation.conversation_key, ?, version_state.version, ?, ?
      FROM customer_service_conversations conversation
      JOIN customer_service_conversation_versions version_state ON version_state.conversation_id = conversation.id
      WHERE conversation.id = ? AND version_state.version = ?`)
      .bind(auditId, normalizedActor, expectedVersion, normalizedReason, id, expectedVersion),
    db.prepare(`DELETE FROM customer_service_conversations
      WHERE id = ?
        AND EXISTS (
          SELECT 1 FROM customer_service_deletion_audits audit
          WHERE audit.audit_id = ? AND audit.conversation_id = customer_service_conversations.id
            AND audit.expected_version = ?
        )`).bind(id, auditId, expectedVersion),
    db.prepare(`UPDATE customer_service_deletion_audits
      SET old_version = CASE WHEN changes() = 1 THEN old_version ELSE 0 END
      WHERE audit_id = ?`).bind(auditId),
  ]);
  if (Number(auditResult.meta.changes ?? 0) === 1 && Number(deleteResult.meta.changes ?? 0) === 1) return { id, deleted: true, auditId };
  const current = await db.prepare(`SELECT version_state.version
    FROM customer_service_conversations conversation
    LEFT JOIN customer_service_conversation_versions version_state ON version_state.conversation_id = conversation.id
    WHERE conversation.id = ?`).bind(id).first<{ version: number | null }>();
  if (!current) throw new PublicApiError(404, "not_found", "客服会话不存在或已被删除。");
  throw new PublicApiError(409, "version_conflict", "客服会话已被其他操作更新，请刷新后重试。");
}
