import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";

const testEnvironment: { DB?: unknown } = {};
(globalThis as typeof globalThis & { __aiAssistantSafetyEnv?: typeof testEnvironment }).__aiAssistantSafetyEnv = testEnvironment;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        url: "data:text/javascript,export const env=globalThis.__aiAssistantSafetyEnv;",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  AI_MESSAGE_PAGE_CONTENT_BYTES_MAX,
  AI_MESSAGE_RESPONSE_BYTES_MAX,
  appendConversationMessage,
  createConversation,
  deleteAiConversation,
  ensureAiAssistantSchema,
  listAiConversations,
  listConversationMessages,
  requireConversationAccess,
  sendAiChannelText,
  upsertAiChannel,
  upsertAiModel,
} = await import("../lib/ai/assistant-service");
const {
  ensureAiArtifactSchema,
  getAiArtifactDownload,
  listAiArtifactsForConversation,
  persistAiTableArtifacts,
} = await import("../lib/ai/artifacts");
const {
  aiRouteErrorResponse,
  parseAiPositiveInteger,
  readAiJsonObject,
} = await import("../app/api/ai/route-helpers");
const { readBoundedJsonObject } = await import("../lib/http/bounded-json");

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

const owner = { email: "owner@example.com", displayName: "Owner", role: "analyst" as const, scope: null };
const other = { email: "other@example.com", displayName: "Other", role: "analyst" as const, scope: null };
const admin = { email: "admin@example.com", displayName: "Admin", role: "admin" as const, scope: null };
const wideOwner = {
  ...owner,
  scope: { warehouses: ["华东仓"], channels: ["线上"], platforms: ["京东", "天猫"] },
};
const narrowedOwner = {
  ...owner,
  scope: { warehouses: ["华东仓"], channels: ["线上"], platforms: ["京东"] },
};
const expandedOwner = {
  ...owner,
  scope: { warehouses: ["华东仓", "华南仓"], channels: ["线上"], platforms: ["京东", "天猫", "拼多多"] },
};

async function createReadyDatabase(queries: QueryRecord[] = []) {
  const sqlite = new DatabaseSync(":memory:");
  const database = sqliteAdapter(sqlite, queries);
  await ensureAiAssistantSchema(database as never);
  return { sqlite, database };
}

test("AI conversation pagination applies owner scope before LIMIT and remains bounded", async () => {
  const queries: QueryRecord[] = [];
  const { sqlite, database } = await createReadyDatabase(queries);
  const insert = sqlite.prepare(`INSERT INTO ai_conversations
    (id, title, model_id, created_by, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)`);
  for (let index = 0; index < 205; index += 1) {
    const timestamp = `2026-08-${String((index % 20) + 1).padStart(2, "0")} 00:${String(index % 60).padStart(2, "0")}:00`;
    insert.run(`owner-${String(index).padStart(3, "0")}`, `owner ${index}`, owner.email, timestamp, timestamp);
  }
  for (let index = 0; index < 50; index += 1) {
    insert.run(`other-${String(index).padStart(3, "0")}`, `other ${index}`, other.email, "2026-08-20 12:00:00", "2026-08-20 12:00:00");
  }

  queries.length = 0;
  const secondPage = await listAiConversations(owner, { page: 2, pageSize: 100 }, database as never);
  assert.equal(secondPage.items.length, 100);
  assert.equal(secondPage.pagination.total, 205);
  assert.equal(secondPage.pagination.returned, 100);
  assert.equal(secondPage.pagination.hasMore, true);
  assert.equal(secondPage.items.every((item) => item.createdBy === owner.email), true);
  const listQuery = queries.find((query) => /FROM ai_conversations c/i.test(query.sql)
    && /WHERE 1 = 1 AND c\.created_by = \?/i.test(query.sql)
    && /LIMIT \? OFFSET \?/i.test(query.sql));
  assert.ok(listQuery, "owner predicate must be inside the paginated SQL query");
  assert.deepEqual(listQuery.values.slice(-2), [100, 100]);

  const finalPage = await listAiConversations(owner, { page: 3, pageSize: 100 }, database as never);
  assert.equal(finalPage.items.length, 5);
  assert.equal(finalPage.pagination.hasMore, false);
  const adminPage = await listAiConversations(admin, { page: 1, pageSize: 100 }, database as never);
  assert.equal(adminPage.pagination.total, 255);
  await assert.rejects(() => listAiConversations(owner, { page: 1, pageSize: 101 }, database as never), /pageSize/);
  sqlite.close();
});

test("AI conversation and artifacts keep immutable scope snapshots across scope tightening", async () => {
  const { sqlite, database } = await createReadyDatabase();
  sqlite.exec(`CREATE TRIGGER reject_ai_conversation_scope BEFORE INSERT ON ai_conversation_scopes
    BEGIN SELECT RAISE(ABORT, 'scope storage unavailable'); END`);
  await assert.rejects(
    () => createConversation("must roll back", wideOwner, null, database as never),
    /scope storage unavailable/,
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) total FROM ai_conversations WHERE title='must roll back'").get()?.total, 0);
  sqlite.exec("DROP TRIGGER reject_ai_conversation_scope");
  const conversationId = await createConversation("跨平台分析", wideOwner, null, database as never);
  const messageId = await appendConversationMessage(conversationId, "assistant", "分析结果", "message", database as never);
  const [artifact] = await persistAiTableArtifacts({
    conversationId,
    messageId,
    principal: wideOwner,
    candidates: [{
      kind: "table",
      title: "跨平台结果",
      sourceTool: "get_sales_summary",
      columns: ["platform"],
      rows: [["京东"], ["天猫"]],
      rowCount: 2,
      truncated: false,
    }],
    database: database as never,
  });

  assert.equal((await requireConversationAccess(conversationId, expandedOwner, database as never)).id, conversationId);
  await assert.rejects(
    () => requireConversationAccess(conversationId, narrowedOwner, database as never),
    /不存在或无权访问/,
  );
  const restrictedAdmin = { ...admin, scope: narrowedOwner.scope };
  await assert.rejects(
    () => requireConversationAccess(conversationId, restrictedAdmin, database as never),
    /不存在或无权访问/,
  );
  const coveringAdmin = { ...admin, scope: expandedOwner.scope };
  assert.equal((await requireConversationAccess(conversationId, coveringAdmin, database as never)).id, conversationId);
  await assert.rejects(
    () => persistAiTableArtifacts({
      conversationId,
      messageId,
      principal: narrowedOwner,
      candidates: [{
        kind: "table",
        title: "迟到写入",
        sourceTool: "get_sales_summary",
        columns: ["platform"],
        rows: [["不得写入"]],
        rowCount: 1,
        truncated: false,
      }],
      database: database as never,
    }),
    /target is unavailable/,
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) total FROM ai_artifacts WHERE conversation_id=?").get(conversationId)?.total, 1);
  assert.equal((await listAiArtifactsForConversation(conversationId, narrowedOwner, database as never)).size, 0);
  assert.equal(
    (await listAiArtifactsForConversation(conversationId, expandedOwner, database as never)).get(messageId)?.[0]?.id,
    artifact.id,
  );
  assert.equal(await getAiArtifactDownload(artifact.id, narrowedOwner, database as never), null);
  assert.ok(await getAiArtifactDownload(artifact.id, expandedOwner, database as never));

  sqlite.prepare(`INSERT INTO ai_conversations (id, title, model_id, created_by)
    VALUES ('legacy-without-scope', 'legacy', NULL, ?)` ).run(owner.email);
  assert.equal((await requireConversationAccess("legacy-without-scope", owner, database as never)).id, "legacy-without-scope");
  await assert.rejects(
    () => requireConversationAccess("legacy-without-scope", narrowedOwner, database as never),
    /不存在或无权访问/,
  );
  const malformedId = "malformed-scope";
  sqlite.prepare(`INSERT INTO ai_conversations (id, title, model_id, created_by)
    VALUES (?, 'malformed', NULL, ?)` ).run(malformedId, owner.email);
  sqlite.prepare(`INSERT INTO ai_conversation_scopes (conversation_id, scope_json)
    VALUES (?, '{"platforms":["京东"]}')`).run(malformedId);
  await assert.rejects(
    () => requireConversationAccess(malformedId, narrowedOwner, database as never),
    /不存在或无权访问/,
  );
  const invalidJsonId = "invalid-json-scope";
  sqlite.prepare(`INSERT INTO ai_conversations (id, title, model_id, created_by)
    VALUES (?, 'invalid json', NULL, ?)` ).run(invalidJsonId, owner.email);
  sqlite.prepare(`INSERT INTO ai_conversation_scopes (conversation_id, scope_json)
    VALUES (?, '{')`).run(invalidJsonId);
  await assert.rejects(
    () => requireConversationAccess(invalidJsonId, narrowedOwner, database as never),
    /不存在或无权访问/,
  );
  sqlite.close();
});

test("AI message cursor returns recent bounded UTF-8 content and loads older pages without overlap", async () => {
  const queries: QueryRecord[] = [];
  const { sqlite, database } = await createReadyDatabase(queries);
  await ensureAiArtifactSchema(database as never);
  sqlite.prepare(`INSERT INTO ai_conversations (id, title, model_id, created_by)
    VALUES ('conversation-owner', '安全分页', NULL, ?)` ).run(owner.email);
  const insert = sqlite.prepare(`INSERT INTO ai_conversation_messages
    (id, conversation_id, role, content, message_kind, created_at)
    VALUES (?, 'conversation-owner', 'assistant', ?, 'message', ?)`);
  const largeContent = "😀".repeat(10_000);
  for (let index = 0; index < 135; index += 1) {
    insert.run(`message-${String(index).padStart(3, "0")}`, `${index}:${largeContent}`, `2026-08-20 12:${String(index % 60).padStart(2, "0")}:00`);
  }
  const insertArtifact = sqlite.prepare(`INSERT INTO ai_artifacts (
    id, conversation_id, message_id, owner_email, kind, title, file_name, mime_type,
    source_tool, columns_json, rows_json, row_count, truncated, content_digest, created_at
  ) VALUES (?, 'conversation-owner', ?, ?, 'table', 'table', 'table.csv',
    'text/csv; charset=utf-8', 'test_tool', '["value"]', '[[1]]', 1, 0, 'digest', ?)`);
  for (let messageIndex = 0; messageIndex < 135; messageIndex += 1) {
    const messageId = `message-${String(messageIndex).padStart(3, "0")}`;
    for (let artifactIndex = 0; artifactIndex < 3; artifactIndex += 1) {
      insertArtifact.run(`artifact-${messageIndex}-${artifactIndex}`, messageId, owner.email, `2026-08-20 12:${String(messageIndex % 60).padStart(2, "0")}:0${artifactIndex}`);
    }
  }

  queries.length = 0;
  const recent = await listConversationMessages("conversation-owner", owner, { pageSize: 30 }, database as never);
  assert.equal(recent.pagination.total, 135);
  assert.equal(recent.pagination.returned, 30);
  assert.equal(recent.pagination.hasMore, true);
  assert.ok(recent.pagination.nextBefore);
  assert.equal(recent.items[0]?.id, "message-105");
  assert.equal(recent.items.at(-1)?.id, "message-134");
  assert.equal(recent.items.every((item) => item.contentTruncated), true);
  assert.equal(recent.items.every((item) => item.contentBytes <= AI_MESSAGE_RESPONSE_BYTES_MAX), true);
  assert.ok(recent.items.reduce((total, item) => total + item.contentBytes, 0) <= AI_MESSAGE_PAGE_CONTENT_BYTES_MAX);
  assert.equal(recent.items.every((item) => !item.content.includes("�")), true);
  assert.equal(recent.items.every((item) => item.artifacts.length === 3), true);
  const artifactQuery = queries.find((query) => /FROM ai_artifacts/i.test(query.sql) && /json_each\(\?\)/i.test(query.sql));
  assert.ok(artifactQuery, "artifacts must be filtered to the current message page in SQL");
  assert.equal(JSON.parse(String(artifactQuery.values[3])).length, 30);
  assert.equal(artifactQuery.values.at(-1), 90);

  const older = await listConversationMessages("conversation-owner", owner, {
    pageSize: 30,
    before: recent.pagination.nextBefore,
  }, database as never);
  assert.equal(older.items[0]?.id, "message-075");
  assert.equal(older.items.at(-1)?.id, "message-104");
  assert.equal(new Set([...recent.items, ...older.items].map((item) => item.id)).size, 60);
  await assert.rejects(
    () => listConversationMessages("conversation-owner", other, { pageSize: 30 }, database as never),
    /不存在或无权访问/,
  );
  sqlite.close();
});

test("AI conversation deletion is owner-fenced, audited, and rolls back when audit storage fails", async () => {
  const { sqlite, database } = await createReadyDatabase();
  sqlite.prepare(`INSERT INTO ai_conversations (id, title, model_id, created_by)
    VALUES ('conversation-delete', '不要进入审计的消息', NULL, ?)` ).run(owner.email);
  sqlite.prepare(`INSERT INTO ai_conversation_messages
    (id, conversation_id, role, content, message_kind)
    VALUES ('message-delete', 'conversation-delete', 'user', 'raw customer message', 'message')`).run();

  assert.equal(await deleteAiConversation("conversation-delete", other, "越权删除", database as never), false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) total FROM ai_conversations").get()?.total, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) total FROM ai_conversation_deletion_audits").get()?.total, 0);

  assert.equal(await deleteAiConversation("conversation-delete", owner, "用户确认删除", database as never), true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) total FROM ai_conversations").get()?.total, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) total FROM ai_conversation_messages").get()?.total, 0);
  const audit = sqlite.prepare(`SELECT conversation_owner conversationOwner, actor_email actorEmail,
    actor_role actorRole, reason, deleted_message_count deletedMessageCount
    FROM ai_conversation_deletion_audits WHERE conversation_id='conversation-delete'`).get() as Record<string, unknown>;
  assert.deepEqual({ ...audit }, {
    conversationOwner: owner.email,
    actorEmail: owner.email,
    actorRole: owner.role,
    reason: "用户确认删除",
    deletedMessageCount: 1,
  });
  assert.equal(JSON.stringify(audit).includes("raw customer message"), false);

  sqlite.prepare(`INSERT INTO ai_conversations (id, title, model_id, created_by)
    VALUES ('conversation-rollback', 'rollback', NULL, ?)` ).run(owner.email);
  sqlite.prepare(`INSERT INTO ai_conversation_messages
    (id, conversation_id, role, content, message_kind)
    VALUES ('message-rollback', 'conversation-rollback', 'user', 'must survive', 'message')`).run();
  sqlite.exec(`CREATE TRIGGER reject_ai_conversation_deletion_audit
    BEFORE INSERT ON ai_conversation_deletion_audits
    BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
  await assert.rejects(
    () => deleteAiConversation("conversation-rollback", owner, "用户确认删除", database as never),
    /audit unavailable/,
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) total FROM ai_conversations WHERE id='conversation-rollback'").get()?.total, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) total FROM ai_conversation_messages WHERE conversation_id='conversation-rollback'").get()?.total, 1);
  sqlite.close();
});

test("concurrent append and delete never leave an orphan AI message", async () => {
  const { sqlite, database } = await createReadyDatabase();
  for (let index = 0; index < 12; index += 1) {
    const conversationId = `conversation-race-${index}`;
    sqlite.prepare(`INSERT INTO ai_conversations (id, title, model_id, created_by)
      VALUES (?, 'race', NULL, ?)` ).run(conversationId, owner.email);
    await Promise.allSettled([
      appendConversationMessage(conversationId, "user", `message ${index}`, database as never),
      deleteAiConversation(conversationId, owner, "并发删除", database as never),
    ]);
    assert.equal(sqlite.prepare("SELECT COUNT(*) total FROM ai_conversations WHERE id=?").get(conversationId)?.total, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) total FROM ai_conversation_messages WHERE conversation_id=?").get(conversationId)?.total, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) total FROM ai_conversation_deletion_audits WHERE conversation_id=?").get(conversationId)?.total, 1);
  }
  sqlite.close();
});

test("late AI artifact persistence cannot recreate downloadable data after conversation deletion", async () => {
  const { sqlite, database } = await createReadyDatabase();
  sqlite.prepare(`INSERT INTO ai_conversations (id, title, model_id, created_by)
    VALUES ('conversation-artifact-race', 'artifact race', NULL, ?)` ).run(owner.email);
  sqlite.prepare(`INSERT INTO ai_conversation_messages
    (id, conversation_id, role, content, message_kind)
    VALUES ('message-artifact-race', 'conversation-artifact-race', 'assistant', 'table ready', 'message')`).run();

  assert.equal(
    await deleteAiConversation("conversation-artifact-race", owner, "并发删除", database as never),
    true,
  );
  await assert.rejects(
    () => persistAiTableArtifacts({
      conversationId: "conversation-artifact-race",
      messageId: "message-artifact-race",
      principal: owner,
      candidates: [{
        kind: "table",
        title: "迟到表格",
        sourceTool: "get_sales_summary",
        columns: ["name"],
        rows: [["must not survive"]],
        rowCount: 1,
        truncated: false,
      }],
      database: database as never,
    }),
    /target is unavailable/,
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) total FROM ai_artifacts").get()?.total, 0);
  sqlite.prepare(`INSERT INTO ai_artifacts (
      id, conversation_id, message_id, owner_email, kind, title, file_name, mime_type,
      source_tool, columns_json, rows_json, row_count, truncated, content_digest
    ) VALUES (
      'ai-artifact-00000000-0000-4000-8000-000000000000',
      'conversation-artifact-race', 'message-artifact-race', ?, 'table', 'legacy orphan',
      'legacy.csv', 'text/csv; charset=utf-8', 'get_sales_summary', '["name"]',
      '[["must not download"]]', 1, 0, 'legacy-digest'
    )`).run(owner.email);
  assert.equal(
    await getAiArtifactDownload("ai-artifact-00000000-0000-4000-8000-000000000000", owner, database as never),
    null,
  );
  const audit = sqlite.prepare(`SELECT deleted_artifact_count deletedArtifactCount
    FROM ai_conversation_deletion_audits
    WHERE conversation_id='conversation-artifact-race'`).get() as { deletedArtifactCount: number };
  assert.equal(audit.deletedArtifactCount, 0);
  sqlite.close();
});

test("0062 forward migration and runtime upgrade are idempotent in both orders", async () => {
  const baseMigration = await readFile(new URL("../drizzle/0013_ai_assistant.sql", import.meta.url), "utf8");
  const auditMigration = await readFile(new URL("../drizzle/0062_ai_conversation_deletion_audit.sql", import.meta.url), "utf8");

  const migrationFirst = new DatabaseSync(":memory:");
  migrationFirst.exec(baseMigration);
  migrationFirst.exec(auditMigration);
  migrationFirst.exec(auditMigration);
  const migrationFirstDb = sqliteAdapter(migrationFirst);
  await ensureAiAssistantSchema(migrationFirstDb as never);
  assert.equal(migrationFirst.prepare("SELECT COUNT(*) total FROM ai_conversation_deletion_audits").get()?.total, 0);
  migrationFirst.close();

  const runtimeFirst = new DatabaseSync(":memory:");
  const runtimeFirstDb = sqliteAdapter(runtimeFirst);
  await ensureAiAssistantSchema(runtimeFirstDb as never);
  runtimeFirst.exec(auditMigration);
  runtimeFirst.exec(auditMigration);
  assert.equal(runtimeFirst.prepare(`SELECT COUNT(*) total FROM sqlite_master
    WHERE type='table' AND name='ai_conversation_deletion_audits'`).get()?.total, 1);
  runtimeFirst.close();
});

test("0063 scope migration and runtime upgrade are idempotent in both orders and preserve legacy rows", async () => {
  const baseMigration = await readFile(new URL("../drizzle/0013_ai_assistant.sql", import.meta.url), "utf8");
  const scopeMigration = await readFile(new URL("../drizzle/0063_ai_conversation_scope_snapshots.sql", import.meta.url), "utf8");

  const migrationFirst = new DatabaseSync(":memory:");
  migrationFirst.exec("PRAGMA foreign_keys = ON");
  migrationFirst.exec(baseMigration);
  migrationFirst.prepare(`INSERT INTO ai_conversations (id, title, model_id, created_by)
    VALUES ('legacy-before-0063', 'legacy', NULL, 'legacy@example.com')`).run();
  migrationFirst.exec(scopeMigration);
  migrationFirst.exec(scopeMigration);
  const migrationFirstDb = sqliteAdapter(migrationFirst);
  await ensureAiAssistantSchema(migrationFirstDb as never);
  assert.equal(migrationFirst.prepare("SELECT COUNT(*) total FROM ai_conversations WHERE id='legacy-before-0063'").get()?.total, 1);
  assert.equal(migrationFirst.prepare("SELECT COUNT(*) total FROM ai_conversation_scopes WHERE conversation_id='legacy-before-0063'").get()?.total, 0);
  const createdId = await createConversation("scoped", wideOwner, null, migrationFirstDb as never);
  assert.equal(migrationFirst.prepare("SELECT COUNT(*) total FROM ai_conversation_scopes WHERE conversation_id=?").get(createdId)?.total, 1);
  migrationFirst.prepare("DELETE FROM ai_conversations WHERE id=?").run(createdId);
  assert.equal(migrationFirst.prepare("SELECT COUNT(*) total FROM ai_conversation_scopes WHERE conversation_id=?").get(createdId)?.total, 0);
  migrationFirst.close();

  const runtimeFirst = new DatabaseSync(":memory:");
  runtimeFirst.exec("PRAGMA foreign_keys = ON");
  const runtimeFirstDb = sqliteAdapter(runtimeFirst);
  await ensureAiAssistantSchema(runtimeFirstDb as never);
  runtimeFirst.exec(scopeMigration);
  runtimeFirst.exec(scopeMigration);
  assert.equal(runtimeFirst.prepare(`SELECT COUNT(*) total FROM sqlite_master
    WHERE type='table' AND name='ai_conversation_scopes'`).get()?.total, 1);
  const foreignKey = runtimeFirst.prepare("PRAGMA foreign_key_list(ai_conversation_scopes)").get() as Record<string, unknown>;
  assert.equal(foreignKey.table, "ai_conversations");
  assert.equal(String(foreignKey.on_delete).toUpperCase(), "CASCADE");
  runtimeFirst.close();

  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.equal(journal.entries.at(-1)?.idx, 63);
  assert.equal(journal.entries.at(-1)?.tag, "0063_ai_conversation_scope_snapshots");
});

test("default AI model clear and upsert are one atomic D1 batch", async () => {
  const { sqlite, database } = await createReadyDatabase();
  const modelInput = (id: string, name: string) => ({
    id,
    name,
    protocol: "openai_compatible" as const,
    modelType: "text" as const,
    modelName: `provider-${id}`,
    baseUrl: "https://api.example.com/v1",
    status: "enabled" as const,
    isDefaultTextModel: true,
  });
  await upsertAiModel(modelInput("model-a", "A"), database as never);
  sqlite.exec(`CREATE TRIGGER reject_model_b BEFORE INSERT ON ai_models
    WHEN NEW.id = 'model-b'
    BEGIN SELECT RAISE(ABORT, 'model insert unavailable'); END`);
  await assert.rejects(
    () => upsertAiModel(modelInput("model-b", "B"), database as never),
    /model insert unavailable/,
  );
  assert.equal(sqlite.prepare("SELECT is_default_text_model value FROM ai_models WHERE id='model-a'").get()?.value, 1);
  sqlite.exec("DROP TRIGGER reject_model_b");

  await Promise.all([
    upsertAiModel(modelInput("model-b", "B"), database as never),
    upsertAiModel(modelInput("model-c", "C"), database as never),
  ]);
  const defaults = sqlite.prepare(`SELECT id FROM ai_models
    WHERE model_type='text' AND status='enabled' AND is_default_text_model=1`).all();
  assert.equal(defaults.length, 1);
  assert.ok(["model-b", "model-c"].includes(String(defaults[0]?.id)));
  sqlite.close();
});

test("AI channel consumes streaming bodies under a 64 KiB cap and never exposes provider text", async () => {
  const { sqlite, database } = await createReadyDatabase();
  const channel = await upsertAiChannel({
    name: "企业微信群机器人",
    kind: "wechat_work_group_bot",
    status: "enabled",
    sendEnabled: true,
    callbackEnabled: false,
    webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=masked",
  }, database as never);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(40 * 1024));
        controller.enqueue(new Uint8Array(40 * 1024));
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    await assert.rejects(
      () => sendAiChannelText(channel.id, "hello", database as never),
      /64 KiB 安全上限/,
    );

    globalThis.fetch = (async () => Response.json({
      errcode: 40001,
      errmsg: "token=TOP_SECRET provider internal stack",
    }, { status: 500 })) as typeof fetch;
    let message = "";
    try {
      await sendAiChannelText(channel.id, "hello", database as never);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.match(message, /HTTP 500 · code 40001/);
    assert.equal(message.includes("TOP_SECRET"), false);
    assert.equal(message.includes("provider internal stack"), false);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("bounded JSON reader enforces the actual streamed bytes and strict UTF-8", async () => {
  const oversized = new Request("https://example.test", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`{"value":"${"x".repeat(80)}"}`));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  await assert.rejects(
    () => readBoundedJsonObject(oversized, 32),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 413,
  );

  const malformedUtf8 = new Request("https://example.test", {
    method: "POST",
    body: new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
  });
  await assert.rejects(
    () => readBoundedJsonObject(malformedUtf8),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 400,
  );
});

test("AI route contract rejects ambiguous integers and masks unknown failures", async () => {
  assert.throws(
    () => parseAiPositiveInteger(new URLSearchParams("page=1e2"), "page", 1, 10_000),
    /十进制正整数/,
  );
  assert.throws(
    () => parseAiPositiveInteger(new URLSearchParams("page=1&page=2"), "page", 1, 10_000),
    /不能重复/,
  );
  await assert.rejects(
    () => readAiJsonObject(new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ message: "x".repeat(70_000) }),
      headers: { "content-type": "application/json" },
    })),
    (error: unknown) => error instanceof Error && error.name === "PublicApiError" && "status" in error && error.status === 413,
  );
  const response = aiRouteErrorResponse(new Error("secret SQL table name"), "AI 请求失败");
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "AI 请求失败", code: "internal_error" });

  const routeFiles = await Promise.all([
    "chat/route.ts",
    "conversations/route.ts",
    "models/route.ts",
    "channels/route.ts",
    "tools/route.ts",
    "artifacts/[artifactId]/route.ts",
    "webhooks/[channelId]/route.ts",
  ].map((path) => readFile(new URL(`../app/api/ai/${path}`, import.meta.url), "utf8")));
  assert.equal(routeFiles.some((source) => /error instanceof Error \? error\.message/.test(source)), false);
  assert.equal(routeFiles.some((source) => /request\.json\(/.test(source)), false);
  assert.match(routeFiles[0], /parseAiPositiveInteger/);
  assert.match(routeFiles[1], /parseAiPositiveInteger/);
});

test("enabled WeCom callbacks require an exact receiver identity at save and verification time", async () => {
  const { sqlite, database } = await createReadyDatabase();
  await assert.rejects(
    () => upsertAiChannel({
      name: "企业微信回调",
      kind: "wechat_work_app",
      status: "enabled",
      sendEnabled: false,
      callbackEnabled: true,
      callbackToken: "callback-token",
      aesKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      receiverId: "",
    }, database as never),
    /接收方 ID/,
  );
  const webhookRoute = await readFile(
    new URL("../app/api/ai/webhooks/[channelId]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(webhookRoute, /!channel\.receiverId/);
  assert.match(webhookRoute, /expectedReceiverId: channel\.receiverId/);
  assert.doesNotMatch(webhookRoute, /channel\.receiverId \|\| undefined/);
  sqlite.close();
});

test("AI assistant UI aborts stale list and message requests and exposes incremental loading", async () => {
  const page = await readFile(new URL("../app/ai-assistant-view.tsx", import.meta.url), "utf8");
  assert.match(page, /conversationGenerationRef/);
  assert.match(page, /messageGenerationRef/);
  assert.match(page, /conversationControllerRef\.current\?\.abort\(\)/);
  assert.match(page, /messageControllerRef\.current\?\.abort\(\)/);
  assert.match(page, /generation !== conversationGenerationRef\.current/);
  assert.match(page, /generation !== messageGenerationRef\.current/);
  assert.match(page, /加载更多对话/);
  assert.match(page, /加载更早消息/);
  assert.match(page, /contentTruncated/);
});
