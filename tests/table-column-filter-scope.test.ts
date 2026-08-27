import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  scoreTableFilterControl,
  tableSummaryShowsPartialDataset,
} from "../lib/ui/table-column-filter";

test("full-scope controls match table headers by business dimension", () => {
  assert.ok(scoreTableFilterControl("健康状态", "健康状态筛选") > scoreTableFilterControl("健康状态", "搜索商品名称"));
  assert.ok(scoreTableFilterControl("库存类型 / 仓库", "仓库") >= 30);
  assert.equal(scoreTableFilterControl("库存类型 / 仓库", "库存类型"), 120);
  assert.ok(scoreTableFilterControl("品牌", "搜索货品、品牌、品类或仓库") >= 30);
  assert.ok(scoreTableFilterControl("榜单口径", "榜单范围") >= 30);
  assert.ok(scoreTableFilterControl("覆盖日期", "统计周期") >= 30);
  assert.equal(scoreTableFilterControl("库龄", "库龄仓库"), 0);
  assert.equal(scoreTableFilterControl("销售净额", "统计周期"), 0);
  assert.equal(scoreTableFilterControl("操作", "刷新"), 0);
});

test("paging and server-truncated table summaries never use page-local values", () => {
  assert.equal(tableSummaryShowsPartialDataset("显示 50 / 22,386 行", 50), true);
  assert.equal(tableSummaryShowsPartialDataset("优先处理 4,195 项货品仓库", 50), true);
  assert.equal(tableSummaryShowsPartialDataset("当前页 20 条", 20), true);
  assert.equal(tableSummaryShowsPartialDataset("共 24 家店铺", 24), false);
});

test("global table filters route partial tables to full-scope business controls", async () => {
  const source = await readFile(new URL("../app/ui/table-column-filters.tsx", import.meta.url), "utf8");
  assert.match(source, /tableUsesPartialDataset/);
  assert.match(source, /table\.closest<HTMLElement>\("\.table-panel, article, section"\)/);
  assert.match(source, /externalFilterControls/);
  assert.match(source, /tableSummaryShowsPartialDataset/);
  assert.match(source, /不会再使用当前页临时选项/);
  assert.match(source, /打开\$\{partialDataset \? "全量" : ""\}列筛选/);
});
