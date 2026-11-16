# 广东入仓型号明细：销量汇总列与冻结列（2026-11-16）

分支 `codex/guangdong-sales-summary-freeze-20261116`，基点 `origin/main` a7cf1e47。
分工：Opus 策划与反审，Sonnet 实现。范围只含 Django `backend/inventory` 与 Worker 前端。无迁移。

## 需求（用户原话与确认）

1. 「生产周期 / 安全天数」前方增加「销量汇总」。用户确认口径：**全部仓库 7/15/30 天的汇总**。
2. 增加冻结栏：商品后一列冻结，即横向滚动时「商品」「规格编码」两列固定在左侧。

## 现状（origin/main）

- 明细表头 `app/inventory-guangdong-view.tsx:228` 顺序：商品、规格编码、供应商、运营负责人、采购负责人、库存 / 在途、7 / 15 / 30日出库、销售周转 / 库龄、天猫仓总库存 / 7·15·30日销量、京东仓总库存 / 7·15·30日销量、**生产周期 / 安全天数**、建议下单、备货数量 / 下单剩余库存、风险及原因、创建备货计划、操作（16 列）。
- 销量来源 `backend/inventory/guangdong.py` `_uncached_project_items`：`inventory_inbound_windows` 已按（型号, 仓库键）返回全部仓库的 7/15/30/90 日正向出库；目前只取广东仓（`demand`）与天猫/京东分类（`channel_sales`）。覆盖判断用同一个 `covered(days)`。
- 业务口径 `docs/规范/业务口径.md:10`：`刷刷仓` 是销售、库存、成本分析的业务排除仓，不得混入经营指标。

## 设计

### 1. 销量汇总（Django + 契约 + 页面）

- `guangdong.py`：在遍历 `sales["rows"]` 时，按型号累计全部仓库的 `sales{7,15,30}dQuantity`，**排除仓库键等于 `_warehouse_key("刷刷仓")` 的行**。字段名 `allOutbound7dQuantity` / `allOutbound15dQuantity` / `allOutbound30dQuantity`；覆盖不足（`covered(days)` 为假）时为 `None`，与现有天猫/京东列一致。该型号没有任何销量行但覆盖足够时为 0。
- 汇总只供展示，**不参与**广东仓风险、销售周转、建议下单判定（`risk_fields` 入参不变）。
- `lib/inventory/guangdong-contract.ts` 的 `GuangdongItem` 增加三个 `number | null` 字段。
- 页面：在「京东仓总库存 / 7·15·30日销量」之后、「生产周期 / 安全天数」之前插入列「销量汇总 7 / 15 / 30日」，单元格 `numberText(7) / numberText(15) / numberText(30)`，样式与「7 / 15 / 30日出库」一致；单元格 `title` 写「全部仓库正向出库合计，不含刷刷仓」。空表行 `colSpan` 从 16 改为 17（按实际列数核对，不照抄数字）。
- 同步沿用 08dcc11d 的做法：`lib/inventory/guangdong-workbook.ts` 导出在京东仓列后加「全仓7日销量」「全仓15日销量」「全仓30日销量」三列；`lib/ai/page-data-tools.ts` 广东监控 `boundedRecords` 字段表加三个字段；`disclosures`（`guangdong.py` 末尾）加一句「销量汇总=全部仓库近7/15/30日正向出库合计，不含刷刷仓，仅供展示」。
- `docs/使用手册/商品库存/inventory-management.md`：在 2026-11-14 那段后追加一段 2026-11-16 说明（列位置、口径、排除刷刷仓、覆盖不足显示空、冻结列）。

### 2. 冻结前两列（纯 CSS）

- 给明细表 `<table>` 加专用类（如 `styles.detailTable`，写在 `app/inventory-guangdong.module.css`），参照 `app/globals.css:400` `.inventory-mapping-table` 的写法：第 1、2 列 `position: sticky`，第 1 列 `left: 0`，第 2 列 `left` 等于第 1 列固定宽度；两列设固定 `width/min-width`（建议 180px / 150px，商品名允许换行）；`td` 背景不透明（与行底色一致，含 hover 状态）；表头这两格 `z-index` 高于正文冻结格；第 2 列右侧加分隔阴影。
- 外层 `.data-table-wrap` 已是 `overflow-x: auto`（`globals.css:244`），不改结构，不改其它表。

### 3. 测试与工具

- `backend/inventory/tests/test_guangdong.py`：新增用例，sales 夹具含广东仓、广东仓-欧洲站、京东仓、天猫类仓、**刷刷仓**，断言 all 字段 = 除刷刷仓外全部之和；覆盖不足时为 None；无销量行时为 0；风险判定结果与不加该字段前一致。
- `tests/inventory-guangdong.test.ts`：夹具补三个字段；如有表头/导出断言同步。
- `tools/verify-guangdong-ui.mjs`、`tools/verify-guangdong-plan-ui.mjs`：若夹具或表头断言受影响同步更新（08dcc11d 曾改这两处）。
- 只读交付演示：`docs/guangdong-sales-summary-freeze-20261116/demo.html`，单文件内嵌样式和合成数据（标明“合成演示数据”），展示新列与横向滚动冻结效果，可用 `file:///` 直接打开。

## 不做

- 不改风险/周转算法，不改天猫/京东列，不改其它页面表格，不新增后端查询或迁移。

## 必需检查

- Django：`backend` 下 `python -m pytest backend/inventory/tests/test_guangdong.py`（或仓库惯用 runner）。
- Worker：`node --import tsx --test tests/inventory-guangdong.test.ts`，`npx tsc --noEmit` 与 main 基线对比（tsc 基线需另开 worktree 取，不用主检出）。
- 构建：按 `docs/规范/验证与发布.md` 的 Worker 构建必需检查执行一次。
