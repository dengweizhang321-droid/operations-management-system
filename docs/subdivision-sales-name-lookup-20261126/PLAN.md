# 货品细分映射：按吉客云销售明细补找“吉客云未找到”货品 + 供应链名称

- 分支 / worktree：`codex/subdivision-sales-name-lookup-20261126`，`D:/codex-worktrees/subdivision-sales-name-lookup-20261126`，基于 `origin/main` `67ce785d`（已上线）。
- 分工（用户指定）：Claude Opus 5.5 写方案与提示词并反审；Claude Sonnet 5.5 编码。
- 前序：`docs/subdivision-category-edit-20261126/PLAN.md`、`REPORT.md`。

## 0. 用户需求（2026-11-26）

系统设置 › 货品细分映射：
1. “吉客云未找到”的货品名称要按表格准确归类。销售数据可以通过吉客云过往销售明细查找。
2. 供应链名称可以在吉客云明细数据里找到。

## 1. 只读比对结论（Opus，用户桌面《7-9月至今直饮机.xlsx》，吉客云销售明细导出）

- 静态表中只有名称的 508 条里，291 条能在这份 3 个月的销售明细中按规范化名称精确找到货品编号。
- 原因推断：这些名称来自历史销售明细，吉客云货品档案（`ErpProductMaster`）里的名称后来改过，所以只查档案会落入“吉客云未找到”。
- 模糊匹配不可靠，**禁止使用**。最接近的名称常常是不同型号，例如 30L↔60L、BJZK-30S↔60S。只允许 `normalize()`（NFKC + 去空白 + casefold）后完全相等。
- 销售明细 `SalesOrderLine.supplier` 对应导出表的“货品默认供应商”。

## 2. 生效映射改动（`backend/sales/subdivisions.py`，唯一实现）

1. **新增销售明细名称索引** `sales_name_index()`：
   - 从 `SalesOrderLine`（`is_business_row=True`，全部历史）按 `(product_code, product_name)` 分组，取不重复组合；
   - 另按 `(product_code, supplier)` 分组并取 `Max(business_date)`，为每个代码取**最近一次**非空供应商；
   - 返回 `{normalize(name): set(raw codes)}` 与 `{raw code: supplier}`。
   - 该查询会扫全表。结果按销售数据修订号（`calculation_cache.revision_token()` 或同义的现有 revision 读取）做**进程内备忘**：修订号不变就直接复用，每次导入后才重算一次。不要依赖 30 秒 TTL 的 `reuse`。并发时允许重复计算，但不得返回半成品。
   - 若不重复组合超过 200000 条，报 `SalesRequestError`，失败关闭。
2. **`_build_data` 名称转代码顺序**：
   1. 先查档案（现状不变，`source="name_to_code"`）；
   2. 档案没找到的名称，再查销售明细名称索引，`source="sales_name_to_code"`。
      - 一个名称对应多个代码时，全部写入。
      - 已被手动或静态代码占用的代码不覆盖（现有先写者优先规则）。
      - 找到的名称加入 `found_names`，不再进入 `name_fallback`。
   3. 销售明细也找不到的，才留在 `name_fallback`，即真正的“吉客云未找到”，仍按名称兜底计入。
   - `MATCH_ORDER` 加入 `sales_name_to_code`，放在 `name_to_code` 之后。
   - `raw_codes()` 包含这些代码，接口 A 的品类细分分析随之按代码计入，无需另改。
3. **缓存身份**：`load_effective` 的 scope 加入销售数据修订号，保证导入新明细后重新解析。若 `reuse` 的 key 已含 revision token，就确认后在报告里说明，不必重复添加。
4. **供应商**：提供 `supplier_for(code, erp_supplier)`。优先用档案的 `supplier`（非空），否则用销售明细中该代码最近的非空供应商，都没有则为空。

## 3. 接口 B（`backend/sales/subdivision_mapping.py`）

- 档案行的 `supplier` 改用 `supplier_for`。
- 新增一类行：`sales_name_to_code` 得到的代码不在档案候选里时，按销售明细列出：
  - `specCode` = 代码，`productName` = 表格名称，`erpCategory` 为空；
  - `supplier` = 销售明细供应商，`matchedBy="sales_name_to_code"`，`status="mapped"`（标签已删除时为 `unclassified`）。
  - 同一代码只列一行。
- `missing` 行只保留销售明细也找不到的名称条目，以及带代码但档案和销售明细都没有该代码的条目。后者需检查代码是否在销售明细代码集合中；在的话，按上面的规则以销售来源列为 `mapped`，`matchedBy="code"`。
- 手动归类行（代码不在档案）的 `supplier` 也用 `supplier_for`。

## 4. 前端与校验

- `app/product-subdivision-settings.tsx`、`app/sales-category-view.tsx` 的匹配方式文案增加 `sales_name_to_code: "名称转代码（销售明细）"`。
- `lib/sales/product-subdivision-contract.ts`、`lib/sales/category-response.ts` 中凡是枚举 `matchedBy` 的校验，都加入新值。必须检查清楚，否则页面会报“响应不完整”。
- 设置页说明文字补一句：只有名称的条目先在吉客云货品档案中找规格代码，找不到再到吉客云历史销售明细中按名称精确查找；名称不完全一致的不会自动归类，可手动补规格代码。供应链名称优先取货品档案的供应商，为空时取销售明细中最近一次的“货品默认供应商”。
- 品类细分 tab 脚注同步更新这一规则。

## 5. 文档

- `docs/规范/业务口径.md` 中的细分口径条目同步更新。
- 本目录 `REPORT.md` 由 Opus 写，编码方不写。

## 6. 边界与检查

- 无 migration，无数据写入，不改静态映射数据，不做模糊匹配。
- 不新增功能测试或业务验收。只调整被本次改动直接影响的既有测试。
- 必需检查：
  - `py_compile`、`manage.py check`、`makemigrations sales --check --dry-run`（必须无变化）；
  - `manage.py test sales.tests.test_api -k category`；
  - `npx tsc --noEmit`：改动文件 0 新错误；
  - 改动的 TS/TSX 跑 `npx eslint`；
  - `npm run check:backend-boundary`；
  - `node --import tsx --test tests/django-sales-route-integration.test.ts tests/settings-view.test.ts`；
  - `npm run build`。
- **结构发布包**：`config/main-schema-releases/sales-0014.json` 的 `codeSha256` 绑定了包括 `backend/sales/*` 在内的文件。改了 `subdivisions.py` 等文件后，必须用 `$TEMP/teruisi-test-venv/.venv/Scripts/python.exe tools/check_schema_code_digest.py --recipe config/main-schema-releases/sales-0014.json` 检查。
  - 如果失败，要判断：已上线的 163 代际在**没有新迁移**时，发布器是否仍会用到这份 recipe。查 `tools/main-schema-release.mjs` 的 `planSpec`：没有迁移差异时是否完全跳过结构发布。
  - 只有发布器在无迁移时不读取 recipe，才可以不重绑。CI 静态检查失败需要在报告中说明，并按先例决定是否重绑。没有把握就停下报告，不要自行重做 rehearsal。
- 只提交本任务文件，不合并、不推送、不发布。
