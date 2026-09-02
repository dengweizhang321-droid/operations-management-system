import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getInventoryCleanupStrategy } from "../app/inventory-workbench-panels";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("滞销清理策略按风险状态给出有界的人工执行建议", () => {
  assert.equal(getInventoryCleanupStrategy("stagnant").label, "促销 / 调拨 / 清退");
  assert.equal(getInventoryCleanupStrategy("slow").label, "控补货并提动销");
  assert.equal(getInventoryCleanupStrategy("aged").label, "调拨 / 人工复核");
  assert.equal(getInventoryCleanupStrategy("no_stock").label, "等待快照确认");
  assert.equal(getInventoryCleanupStrategy("healthy").label, "持续观察");
});

test("库存五个工作页补充决策说明、全量汇总和执行闭环", async () => {
  const [view, panels] = await Promise.all([
    source("../app/inventory-module-view.tsx"),
    source("../app/inventory-workbench-panels.tsx"),
  ]);

  assert.match(view, /<InventoryOverviewRulePanel settings=\{overview\.settings\} qualityStatus=\{overview\.quality\.status\}/);
  assert.match(view, /<InventoryAgeSummaryPanel/);
  assert.match(view, /<InventoryPlanWorkflowPanel summary=\{overview\.planSummary\}/);
  assert.match(view, /<InventoryStalePlaybookPanel/);
  assert.match(view, /<InventoryInboundActionPanel/);
  assert.match(view, /品牌 \/ 品类/);
  assert.match(view, /报表 \/ 计划在途/);
  assert.match(view, /导出当前页 CSV/);

  assert.match(panels, /库存决策规则/);
  assert.match(panels, /10 个标准区间/);
  assert.match(panels, /系统建议 → 人工确认 → 采购执行 → 库存快照复盘/);
  assert.match(panels, /系统只创建运营事项，不会自动删除、调减或重导库存/);
  assert.match(panels, /当前不展示伪造差异/);
});

test("库存工作台继续披露既有数据质量与业务边界", async () => {
  const panels = await source("../app/inventory-workbench-panels.tsx");

  assert.match(panels, /始终排除“刷刷仓”/);
  assert.match(panels, /成本缺失不按 0 元/);
  assert.match(panels, /只使用所选周期内的正向销量/);
  assert.match(panels, /人工确认 · 不自动下单/);
  assert.match(panels, /计算口径，不替代京东原生口径/);
});
