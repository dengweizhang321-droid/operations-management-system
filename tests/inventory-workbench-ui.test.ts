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

test("库存五个工作页补充缺口明细、全量汇总和执行闭环", async () => {
  const [view, panels] = await Promise.all([
    source("../app/inventory-module-view.tsx"),
    source("../app/inventory-workbench-panels.tsx"),
  ]);

  assert.doesNotMatch(view, /InventoryOverviewRulePanel|库存决策规则/);
  assert.match(view, /<InventoryAgeSummaryPanel/);
  assert.match(view, /<InventoryPlanWorkflowPanel summary=\{overview\.planSummary\}/);
  assert.match(view, /<InventoryStalePlaybookPanel/);
  assert.match(view, /<InventoryInboundActionPanel/);
  assert.match(view, /品牌 \/ 品类/);
  assert.match(view, /报表 \/ 计划在途/);
  assert.match(view, /导出当前页 CSV/);

  assert.doesNotMatch(panels, /库存决策规则/);
  assert.match(panels, /10 个标准区间/);
  assert.match(panels, /系统建议 → 人工确认 → 采购执行 → 库存快照复盘/);
  assert.match(panels, /系统只创建运营事项，不会自动删除、调减或重导库存/);
  assert.match(panels, /当前不展示伪造差异/);
});

test("销量映射缺口工作台同步公共筛选并提供完整仓别与备货计划字段", async () => {
  const [view, query, route, model] = await Promise.all([
    source("../app/inventory-module-view.tsx"),
    source("../backend/inventory/query.py"),
    source("../app/api/inventory/replenishment/route.ts"),
    source("../backend/inventory/models.py"),
  ]);

  for (const label of [
    "货品编号", "货品名称", "品牌", "分类", "供应商", "京东仓库", "京东仓销量",
    "代发仓销量", "售后仓库存", "广东仓库存", "样品仓库存", "菜鸟仓库存", "自营库存",
    "总库存金额", "总周转天数", "建议补货", "预警", "创建备货计划",
  ]) assert.match(view, new RegExp(label));
  for (const label of [
    "对应采购", "入库库房", "现有库存", "近30天销量（含自营入仓）", "备货数量",
    "预计消耗周期\(天\)", "下单日期", "备货类型", "对应运营", "部门", "预计到货日", "是否验货", "备注",
  ]) assert.ok(view.includes(label.replaceAll("\\(", "(").replaceAll("\\)", ")")), `missing ${label}`);

  assert.match(query, /mapping_samples = _mapping_samples\(filtered/);
  assert.match(query, /"supplier": \(master\.supplier\.strip\(\)/);
  assert.match(route, /"manual"/);
  assert.match(model, /expected_arrival_date = models\.DateField/);
  assert.match(model, /requires_inspection = models\.BooleanField/);
});

test("库存工作台继续披露既有数据质量与业务边界", async () => {
  const [panels, docs] = await Promise.all([
    source("../app/inventory-workbench-panels.tsx"),
    source("../docs/INVENTORY_MANAGEMENT.md"),
  ]);

  assert.match(docs, /`刷刷仓` 始终排除/);
  assert.match(docs, /成本不完整时页面必须标注覆盖率/);
  assert.match(docs, /正向销量/);
  assert.match(panels, /人工确认 · 不自动下单/);
  assert.match(panels, /计算口径，不替代京东原生口径/);
});
