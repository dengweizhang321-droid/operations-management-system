import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import type { SalesDatabase } from "@/lib/sales/database";
import {
  listWorkflowTasks,
  updateWorkflowTask,
} from "@/lib/workflow/tasks";

test("updates every editable work-item field and persists completed classification", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  const original = (await listWorkflowTasks(db))[0];

  const updated = await updateWorkflowTask(original.id, {
    title: "8 月运营复盘",
    workContent: "复核销售、退款与推广数据并完成复盘。",
    category: "数据分析",
    owner: "运营负责人",
    shopName: "京东-测试店铺",
    startDate: "2026-08-18",
    due: "2026-08-20",
    status: "已完成",
    priority: "high",
  }, "admin@example.com", db);

  assert.ok(updated);
  assert.deepEqual({
    title: updated.title,
    workContent: updated.workContent,
    category: updated.category,
    owner: updated.owner,
    shopName: updated.shopName,
    startDate: updated.startDate,
    due: updated.due,
    status: updated.status,
    priority: updated.priority,
  }, {
    title: "8 月运营复盘",
    workContent: "复核销售、退款与推广数据并完成复盘。",
    category: "数据分析",
    owner: "运营负责人",
    shopName: "京东-测试店铺",
    startDate: "2026-08-18",
    due: "2026-08-20",
    status: "已完成",
    priority: "high",
  });
  assert.equal((await listWorkflowTasks(db)).find((item) => item.id === original.id)?.status, "已完成");
  sqlite.close();
});

test("rejects invalid edit values without changing the saved work item", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteAdapter(sqlite);
  const original = (await listWorkflowTasks(db))[0];

  await assert.rejects(
    updateWorkflowTask(original.id, { startDate: "2026-08-20", due: "2026-08-19" }, "admin@example.com", db),
    /截止时间不能早于开始时间/,
  );
  await assert.rejects(
    updateWorkflowTask(original.id, { priority: "urgent" }, "admin@example.com", db),
    /工作项紧急程度无效/,
  );

  const saved = (await listWorkflowTasks(db)).find((item) => item.id === original.id);
  assert.equal(saved?.startDate, original.startDate);
  assert.equal(saved?.due, original.due);
  assert.equal(saved?.priority, original.priority);
  sqlite.close();
});

function sqliteAdapter(sqlite: DatabaseSync): SalesDatabase {
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
  } as unknown as SalesDatabase;
}
