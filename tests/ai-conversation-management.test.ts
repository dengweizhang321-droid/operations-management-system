import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  assertAiConversationAccess,
  deleteAiConversationData,
  isAiChatCapableModelType,
} from "../lib/ai/conversation-management";
import type { AppPrincipal } from "../lib/auth/authorization";
import type { D1Database } from "../lib/database/d1";

const owner: AppPrincipal = { email: "owner@example.com", displayName: "Owner", role: "analyst", scope: null };
const otherUser: AppPrincipal = { email: "other@example.com", displayName: "Other", role: "analyst", scope: null };

test("chat capability admits text and vision models while rejecting legacy or unknown types", async () => {
  assert.equal(isAiChatCapableModelType("text"), true);
  assert.equal(isAiChatCapableModelType("vision"), true);
  assert.equal(isAiChatCapableModelType("image"), false);
  assert.equal(isAiChatCapableModelType("audio"), false);

  const [service, workflow] = await Promise.all([
    readFile(new URL("../lib/ai/assistant-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/question-workflow.ts", import.meta.url), "utf8"),
  ]);
  assert.match(service, /WHERE model_type IN \('text', 'vision'\) AND status = 'enabled'/);
  assert.match(service, /WHERE id = \? AND model_type IN \('text', 'vision'\) AND status = 'enabled'/);
  assert.match(workflow, /selectConversationModel/);
  assert.doesNotMatch(workflow, /已有对话已固定模型/);
});

test("conversation deletion denies non-owners and atomically removes messages and artifacts", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE ai_conversations (id TEXT PRIMARY KEY, created_by TEXT NOT NULL);
    CREATE TABLE ai_conversation_messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL);
    CREATE TABLE ai_artifacts (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL);
    CREATE TABLE ai_artifact_deliveries (id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL);
    INSERT INTO ai_conversations VALUES ('conversation-1','owner@example.com');
    INSERT INTO ai_conversation_messages VALUES ('message-1','conversation-1');
    INSERT INTO ai_artifacts VALUES ('artifact-1','conversation-1');
    INSERT INTO ai_artifact_deliveries VALUES ('delivery-1','artifact-1');
  `);
  const db = sqliteAdapter(sqlite);

  assert.throws(() => assertAiConversationAccess({ createdBy: owner.email }, otherUser), /无权访问该对话/);
  assert.doesNotThrow(() => assertAiConversationAccess({ createdBy: owner.email }, owner));
  assert.equal(await deleteAiConversationData("conversation-1", db), true);
  assert.equal(countRows(sqlite, "ai_conversations"), 0);
  assert.equal(countRows(sqlite, "ai_conversation_messages"), 0);
  assert.equal(countRows(sqlite, "ai_artifacts"), 0);
  assert.equal(countRows(sqlite, "ai_artifact_deliveries"), 1);
  assert.equal(await deleteAiConversationData("conversation-1", db), false);
  sqlite.close();
});

function countRows(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) total FROM ${table}`).get() as { total: number }).total);
}

function sqliteAdapter(sqlite: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      let values: Array<string | number | bigint | Uint8Array | null> = [];
      return {
        bind(...nextValues: unknown[]) { values = nextValues as typeof values; return this; },
        async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
        async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
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
    },
  } as unknown as D1Database;
}
