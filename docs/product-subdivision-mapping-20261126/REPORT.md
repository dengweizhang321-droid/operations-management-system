# 货品细分映射 + 品类分析“品类细分”三级 tab 交付报告

状态：**候选，分支已推送，未合并、未发布**。方案见 [PLAN.md](PLAN.md)，演示见 [demo.html](demo.html)（合成数据，可直接打开）。

- 分工（用户指定）：Claude Opus 5.5 写方案与提示词，并做独立复审（新上下文，含一轮增量复审）；Claude Sonnet 5.5 编码。
- 模型映射差异：`docs/规范/任务模型分工.md` 当前映射为 GPT 系列，本任务按用户当次明确指令使用 Claude 模型。
- 提交：`f535c6ce`（后端、Worker、校验）、`c639888f`（前端、文档、演示）、`bb1ed48e`（复审修复），以及本报告与方案的文档提交。

## 用户确认的口径

1. 表格“代码”= 吉客云货品编号（`product_code`）。映射页的“吉客云规格代码”“吉客云货品代码”两列都显示货品编号，因为系统没有单独的规格代码字段。
2. 匹配时货品编号优先、名称次之，比较前做 NFKC、去空白、casefold 规范化。只要命中就计入对应细分，不论吉客云分类。
3. 吉客云分类只用于展示、筛选和发现“未归类”货品。“未归类”指覆盖分类“直饮机”中没有进入映射的货品，不计入细分，单独列出提示。
4. 系统设置“货品细分映射”参照仓库映射，只读：从 ERP 货品主数据（吉客云货品档案）列出货品并展示归类结果。映射随代码发布，换 Excel 后重新生成模块再交付。**无新表、无 migration。**

## 变更

- **Django（sales）**
  - 重写 `subdivisions.py`：映射全局注册，覆盖分类为“直饮机”。
  - 新增 `subdivision_analysis.py`，提供 `GET /api/sales/category-analysis/subdivisions`：明细与品类经营明细同口径，排序、分页、趋势、同比、环比也同口径，并附货品清单前 50、匹配覆盖和未归类。
  - 新增 `subdivision_mapping.py`，提供 `GET /api/sales/product-subdivisions`：返回货品列表，状态分为已归类、未归类、吉客云未找到；受限数据范围账号返回 403。
  - 删除上一版 `get_category_subdivision`、`category-analysis/subdivision` 以及响应字段 `subdivisionParents`。
- **Django（ai_assistant）**：`page_context.py` 设置视图清单加入 `subdivisions`。
- **Worker**
  - 新增 `app/api/sales/category-analysis/subdivisions/route.ts`。
  - 新增 `app/api/settings/product-subdivisions/route.ts`，鉴权与仓库映射 GET 相同。转发路径固定，只透传 5 个经过校验的参数。
  - 删除旧路由 `category-analysis/subdivision/route.ts`。
  - `lib/sales/category-response.ts` 改用 `validCategorySubdivisions`，新增 `lib/sales/product-subdivision-contract.ts`。
  - `lib/ai/page-context.ts` 设置视图清单加入 `subdivisions`。
- **前端**
  - `app/sales-category-view.tsx`：删除旧“品类细分”面板和“细分”按钮；新增三级 tab “品类经营 / 品类细分”，URL 键为 `salesCategoryTab`。细分 tab 包含：
    - KPI；
    - 未归类提示，可展开货品；
    - 明细表，带排序、分页、趋势和“查看货品”；
    - 映射来源脚注。
  - 新增 `app/product-subdivision-settings.tsx`。
  - `settings-view.tsx` 与 `navigation-catalog.ts` 在“仓库映射”后加入“货品细分映射”。
  - `globals.css` 删除不再使用的 `category-subdivision-*` 规则，补少量样式。
- **文档与测试**
  - `README.md`、`docs/规范/业务口径.md` 替换上一版细分描述。
  - 路由测试清单换成新路径；`settings-view` 与 `module-view-contract` 测试的设置视图期望同步更新。

## 必需检查

| 检查 | 结果 |
| --- | --- |
| `python -m py_compile`（改动的 Python 文件） | 通过 |
| `manage.py check`（临时 venv、假环境变量） | no issues |
| `manage.py test sales.tests.test_api -k category` | 6 通过 |
| `npx tsc --noEmit` | 改动文件 0 错误；全仓 172 个错误均在既有 `tests/*`，与基线相同 |
| `npx eslint`（改动的 TS/TSX） | 退出码 0 |
| `npm run check:backend-boundary` | 退出码 0，`violations: []` |
| `node --import tsx --test tests/django-sales-route-integration.test.ts` | 2 通过 |
| `tests/ai-page-context.test.ts`、`tests/settings-view.test.ts` | 19 通过 |
| `tests/module-view-contract.test.ts` | 11/12 通过；失败项为库存 `tmall_warehouse`，基线 `267944ec` 就已失败，与本次无关 |
| `npm run build` | 退出码 0 |

## 独立复审

- 首轮发现阻断 B1：AI 页面上下文的设置视图清单缺 `subdivisions`，打开设置页时 `createAiPageContext` 抛错。另有两条建议：展开行 `colSpan` 多写一列；防抖更新函数不纯。
- 三项均在 `bb1ed48e` 修复。增量复审确认无剩余阻断，也没有其他枚举设置视图的位置漏改。
- 待确认项：`summary.productCount` 是各细分货品数直接相加，同一编号以不同名称命中不同细分时会重复计。前端未展示该字段，影响很小，未改。

## 已知限制 / 未做

- 覆盖分类以外的货品只能按原值精确命中，规范化差异只在“直饮机”分类内生效。
- 未用真实数据核对命中率和未归类规模。上线后请在两个页面查看“匹配覆盖 / 未归类 / 吉客云未找到”。
- 细分 tab 不受顶部“品类多选”影响，渠道、平台、店铺和商品搜索仍然生效；排序与分页只保存在组件状态里，不进 URL。
- `demo.html` 只做了脚本语法检查，未在浏览器里查看。
- 未接 AI 中央工具；无数据库迁移，无数据写入。
- 发布范围：Worker 与 Django 两个组件都有变化，无 migration。合并、上线须分别授权。
