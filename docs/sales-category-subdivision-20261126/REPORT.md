# 品类细分（直饮机）交付报告

状态：**候选，已推送分支，未合并、未发布**。方案见 [PLAN.md](PLAN.md)。

- 分工：Claude Opus 5.5 方案与审查；Claude Sonnet 5.5 编码（提交 `d8090db1`）。
- 映射：`backend/sales/subdivision_maps/water_dispenser.py`，来源《直饮机分类规格匹配.xlsx》SHA-256 `46a801de7e106487367df5adc38320bb9b7747e4ae6346576852a45e6beb44f4`，603 条（95 条有编码），15 个细分。更新映射：用本目录 `generate_water_dispenser_map.py` 重新生成后走正常交付。

## 变更

- Django：`backend/sales/subdivisions.py`（注册与规范化匹配）、`category.py` 新增 `get_category_subdivision`，抽取 `_comparison_queryset/_comparison_aggregates`（原品类分析行为不变），`get_category_analysis` 追加 `subdivisionParents`；新路由 `GET /api/sales/category-analysis/subdivision`。
- Worker：`app/api/sales/category-analysis/subdivision/route.ts` 薄转发；`lib/sales/category-response.ts` 新增 `validCategorySubdivision`。
- 前端：`app/sales-category-view.tsx` 在“品类经营明细”后新增“品类细分”面板（汇总、匹配覆盖、细分表、商品展开前 50、映射外商品提示、口径脚注），“直饮机”行增加“细分”按钮；`app/globals.css` 少量 `category-subdivision-*` 样式。
- 文档：`README.md`、`docs/规范/业务口径.md` 各一条；演示 `subdivision-panel-demo.html`（合成数据）。

## 必需检查

| 检查 | 结果 |
| --- | --- |
| `python -m py_compile`（改动 Python 文件） | 通过 |
| `manage.py check`（临时 venv、假环境变量） | no issues |
| `manage.py test sales.tests.test_api -k category`（既有测试） | 6 通过 |
| `npx tsc --noEmit` | 改动文件 0 错误；仓库既有 172 个错误不变 |
| `npx eslint`（改动 TS/TSX） | 无输出 |
| `npm run check:backend-boundary` | 退出码 0 |
| `node --import tsx --test tests/django-sales-route-integration.test.ts` | 2 通过 |
| `npm run build` | 退出码 0 |

## 未做 / 待用户

- 未用真实数据核对映射命中率；上线后看面板“匹配覆盖”与“映射表商品不在直饮机品类”提示，若大量商品落在其他 ERP 品类，可调整父品类范围。
- 未接 AI 中央工具；无数据库迁移、无数据写入。
- 范围：Django + Worker 均有变化；合并与上线需分别授权。
