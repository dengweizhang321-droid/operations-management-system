# 全系统代码排查与安全清理

- 日期：2026-10-21
- 基线：`origin/main` `988810cf`
- 分支：`codex/full-code-audit-20261021`
- 工作树：`D:\.codex\worktrees\full-code-audit-20261021\运营管理系统`
- 范围：TERUISI 运营管理系统的前端、Worker 适配、Django 后端与发布/测试脚本的静态排查；不做生产数据、服务启停、部署或真实外发操作。

## 结论摘要

本轮确认并修复了 2 个有实际使用影响的前后端页面上下文契约缺陷，并清理了 3 处已无引用的代码/类型冗余：

1. AI 对话在“数据导入 → 链路规则”“系统设置 → 仓库映射/数据库备份”会因后端页面上下文白名单缺少对应 view 而拒绝请求。
2. “商品经营”页面把 `productKind` 放入 AI 页面筛选，但前后端白名单都没有该键；前端会丢弃整组页面筛选并显示误导性的“筛选过多/文字过长”提示。
3. 商品汇总的本地重复类型缺少 `productKind`/`components`，导致 7 个 TypeScript 诊断；已改为复用权威类型。
4. 清理了 1 个未使用导入、1 组未使用解构；没有删除仍被测试、迁移、审计或设计证据引用的内容。

没有发现证据充分的金额/库存/导入幂等/权限绕过类新缺陷；这不等同于系统不存在此类问题。未覆盖范围见文末。

## 已确认缺陷与修复

### 1. AI 页面上下文视图白名单不一致（已修复）

**代码位置**

- 当前前端子视图：`app/shell/navigation-catalog.ts:36-37`
  - `import`: `files`、`history`、`chains`
  - `settings`: `parameters`、`master`、`warehouses`、`dingtalk`、`backups`、`permissions`
- 前端页面上下文：`app/page.tsx:475-478` → `app/ai-assistant-view.tsx:814`
- 前端路由校验：`lib/ai/django-route.ts:38-41`
- 后端校验：`backend/ai_assistant/chat.py:762` → `backend/ai_assistant/page_context.py:42-50`

**触发条件**

在“数据导入 → 链路规则”或“系统设置 → 仓库映射 / 数据库备份”页面直接向 AI 提问。页面上下文会随 `/api/ai/chat` 发送；前端允许这些 view，但修复前后端 `VIEWS` 只允许：

- `import`: `files`、`history`、`continuity`
- `settings`: `parameters`、`master`、`dingtalk`、`permissions`

**影响**

`page_context.normalize()` 对不在白名单中的 view 抛出 `AiError("页面视图无效")`（默认 HTTP 400），整个 AI 对话请求失败；不是仅丢失页面筛选。该问题影响实际使用，且与业务数据是否已同步无关。

**修复**

`backend/ai_assistant/page_context.py:19` 增加 `chains`、`warehouses`、`backups`；保留旧 `continuity` 以兼容既有会话保存的页面上下文。前端目录未改动，因为其与当前导航一致。

**验证**

新增 `tests/ai-page-context.test.ts` 的跨层白名单测试：逐个断言 `AI_PAGE_CONTEXT_CATALOG` 的每个 view 都存在于后端 `VIEWS`。修复前该测试会因 `import/chains`、`settings/warehouses`、`settings/backups` 失败；修复后 7 项测试全部通过。

### 2. 商品经营 `productKind` 被 AI 页面上下文丢弃（已修复）

**代码位置**

- 页面传值：`app/product-module-view.tsx:342`
- 前端筛选白名单：`lib/ai/page-context.ts:68-80`
- 整组判空：`lib/ai/page-context.ts:82-94`
- 后端筛选白名单：`backend/ai_assistant/page_context.py:22-33`
- 结果与错误提示：`app/page.tsx:477-481`

**触发条件**

打开“商品经营”页（单品/组合装任选），在页面上向 AI 提问。`useAiPageDetails` 的 filters 包含 `productKind`，同时包含 `query`、平台、店铺、类目、毛利区间等。

**影响**

修复前 `normalizeAiPageFilters` 对未知键 `productKind` 直接返回 `null`，`app/page.tsx` 随后以 `filters: undefined` 发送；整组页面筛选被静默丢弃，AI 可能按旧范围或全量范围回答。与此同时 `aiContextError` 显示“当前筛选项目过多或查询文字过长”，与实际原因不符。

单独修改前端还不够：`/api/ai/chat` 路由会再次用同一前端白名单校验，且 Django `page_context.FILTERS` 也会拒绝未知筛选键。因此本轮同时修改前端与后端。

**修复**

- `lib/ai/page-context.ts:70` 增加 `productKind`。
- `lib/ai/page-context.ts:201` 增加中文标签“商品类型”。
- `backend/ai_assistant/page_context.py:24` 增加 `productKind`。

**验证**

- 新增测试 `product kind filter is preserved in page context`：修复前 `normalizeAiPageFilters({ productKind: "combo", query: "abc" })` 返回 `null`；修复后返回 `{ productKind: "combo", query: "abc" }`，并可通过 `createAiPageContext`/`normalizeAiPageContext`。
- 跨层测试同时保证前端筛选键全部存在于后端 `FILTERS`。

### 3. 商品汇总重复类型缺少 `productKind`/`components`（已修复）

**代码位置**

- 旧本地类型：`app/module-view-shared.tsx`（修复前约 114-139 行）
- 权威类型：`lib/products/summary.ts:18-49`
- 使用处：`app/product-module-view.tsx:347/388/473/490/496/525`

**影响**

`tsc --noEmit` 报 7 个 `TS2339/TS2322`：本地 `ProductSummaryItem` 缺少 `productKind` 与 `components`。生产构建（Vinext）当前不做类型检查，因此没有直接运行时影响；但类型契约与真实 API 已经分叉，后续维护者会按错误类型改代码。

**修复**

`app/module-view-shared.tsx:9-10` 改为 `import type` 并原样再导出 `lib/products/summary` 的权威类型。类型导入在编译期擦除，不把服务端模块带入客户端 bundle；修复后相关类型错误全部消失。

## 已清理内容与用途核查

| 内容 | 位置 | 核查依据 |
| --- | --- | --- |
| 未使用的 `MARKET_V2_VIEWS` 导入 | `app/ai-business-market-v2-preview.tsx:5-6` | 该组件只使用 `MarketView` 类型和 `validateMarketPreview`；仓库无其他引用该导入。修复后 ESLint `no-unused-vars` 消失。`MARKET_V2_VIEWS` 本身仍保留在 `lib/ai/business-market-v2-preview.ts`，未删除公共导出。 |
| 未使用的 `salesStartDate`/`salesEndDate` 解构 | `lib/inventory/overview.ts:1231` | 该函数内两变量无任何读取；同类变量在 1055、1075 行仍被使用，未误删。修复后 ESLint 不再报告。 |
| 重复的 `ProductSummaryItem` 类型 | `app/module-view-shared.tsx` | 与 `lib/products/summary.ts` 重复且缺字段；所有引用点均只依赖该类型，改为 type-only 再导出后 `tsc` 与构建通过。 |

以上均为无运行时分支、无动态加载、无路由注册、无构建配置引用的清理。未删除任何迁移、测试夹具、恢复工具、演示证据或历史文档。

## 暂时保留及待决定事项

### 有证据的潜在风险

- **统一 Chat/Pi 会话外壳的 render 期 ref 访问**：`app/ai-conversation-shell.tsx:19` 的 `latest.current = surface` 被 `react-hooks/refs` 判为 Error；`AiConversationShell` 还会在 render 中调用 `registered[...].read()`。这是有意的 latest-ref 模式，但在 React 并发渲染下，废弃 render 可能把 ref 指向未提交的 surface，事件回调可能短暂使用旧闭包。当前无复现证据，重构会触及 Chat/Pi 统一控制层，本轮保留并记录，建议由该模块负责人决定是否改为提交阶段更新 + 稳定回调注册。
- **AI 页面上下文单项上限与商品搜索不一致**：`lib/ai/page-context.ts:90` 对任一筛选值超过 160 字符或数组超过 20 项时返回 `null`，而 `app/product-module-view.tsx:510` 的商品搜索允许 1000 字符。用户粘贴长查询时，整组 filters 会被丢弃，`app/page.tsx:477-481` 显示“筛选过多/文字过长”。这是既有的 fail-closed 行为，不会发送错误数据，但会丢失其他有效筛选；建议产品/UX 决定是截断查询还是统一放宽上限，本轮未改。
- **前端/后端上下文长度口径不一致**：前端 `lib/ai/page-context.ts:93` 约 3000 字节，后端 `backend/ai_assistant/page_context.py:74` 为 4000 字符；前端更早失败，组合筛选很多时会先丢 filters。属非阻断的口径差异。
- **未映射仓库的库存计入回退**：`lib/inventory/warehouse-classification.ts:99-113` 对未配置的“代发/菜鸟/售后/广东/样品”仓库推断为 `includeInInventory: true`；`docs/规范/系统架构.md:11` 要求库存健康分布排除工厂代发、售后、样品、海外等。已配置仓库以 `config/inventory-warehouse-mapping.json` 为准，因此当前生产是否受影响取决于是否存在未映射仓库；本轮未查询生产数据，不能确认。若确认存在，需要业务决定回退规则，不能由代码清理直接改变。
- **发布工具中的未调用函数**：`tools/worker-local-release.mjs:1425` 的 `runSalesContractTests` 无调用点，但同文件仍在校验 contract test 回执（`validateContractTests`）。这可能表示某条销售合约测试生成路径已被替代，也可能是预留能力；本轮未删除，避免掩盖发布检查缺口，建议发布工具负责人核对。

### 静态类型/检查债务（未修复）

- `lib/ai/business-market-v2-tool-candidate.ts:34`：`allowed` 的 TS2454 控制流诊断；该工具由环境开关默认关闭，现有分支在运行时会先赋值或抛错，未证明运行时缺陷，故未改。
- `lib/market/annotation-model.ts:266`：请求头对象联合类型不满足 `HeadersInit`；运行时对象形状正确，未改热路径。
- `tools/*`：`erp-sales-automation.ts` 的 `pageName` 类型缺失（JSON 配置实际有该字段）、`sales-import-runner.ts` 的 `fee` 空值收窄（824-828 行已拒绝空值）、`tmall-*` 的 signal/unknown 类型、`jd-n8n-pipeline.ts` 的操作类型等。它们属于离线工具，未纳入应用构建，保留原行为。
- `app/inventory-module-view.tsx:643`、`app/operations-view.tsx:1043` 的 `exhaustive-deps` 警告：依赖实际由 `principalKey`、`canWrite`、`currentUser?.email` 覆盖身份变化，未发现确定的 stale closure。
- `app/netshop/shared/integrated-layout.tsx:9` 的 `_value` 是 context 默认函数的占位参数，属样式性 lint。

### 文档与资产

- `pnpm-lock.yaml` 最后更新 `2026-07-20`，`package-lock.json` 更新至 `2026-10-18`；全仓未发现 `pnpm` 脚本、`packageManager` 或文档引用。它可能是早期模板残留，但删除会改变依赖管理器表面，保留待用户决定。
- `系统架构线路图(1).html` 生成于 `2026-07-08`（main `6dab9fe`），仅被历史发布 manifest 引用；属用户可见架构资料，未删除。
- `app/netshop/comparison/demo/**`、`app/netshop/panorama/demo/**`、`demos/**`：分别被设计说明、UI 验证脚本、README 和发布证据引用，不能按“搜索不到业务调用”删除。
- `lib/**` 旧 D1 领域实现、`drizzle/**`、迁移/恢复/审计脚本：按系统架构和数据存储规范保留为隔离迁移、退役审计或测试材料。
- `docs/文档目录.md:9` 的文档数量描述（1087）与当前 tracked Markdown 数量不一致（约 1133）；属既有文档计数漂移，本轮只补充导航，未改写总数。

## 完成的检查

在隔离 worktree 执行：

- `npm ci --no-audit --no-fund`：成功，611 packages，postinstall workerd/heap patch 正常。
- `npm run build`：修复前、修复后均成功，Vinext API 路由清单正常生成。
- `node tools/check-django-production-boundary.mjs`：`violations: []`。
- `python -m compileall -q backend`：通过。
- `npx tsc --noEmit`：修复前 app/lib/tools 非测试诊断 20 个；修复后 15 个；商品相关 7 个已消失，剩余为上述既有债务。
- `npx eslint app lib worker`：10 条消息降至 7 条；剩余为 refs/exhaustive-deps/no-img-element 和 `_value`，无新增未使用变量。
- `node --import tsx --test tests/ai-page-context.test.ts`：7/7 通过。
- `node --import tsx --test tests/product-progressive-contract.test.ts tests/product-summary-projection.test.ts`：7/7 通过。
- `node --import tsx --test tests/ai-page-data-tools.test.ts`：14/14 通过。
- `git diff --check`：通过。

**未执行**：全量 `npm test`、Django 运行时/数据库测试（本机开发环境未安装 Django，未连接任何生产库）、浏览器/E2E、真实 `/api/ai/chat` 请求、生产数据回查、服务启停、迁移、部署或外部发送。因此上述缺陷为静态调用链确认和定向测试确认，不是生产环境复现。

**模型分工**：当前 DSH 客户端不能按 `docs/规范/任务模型分工.md` 的模型 ID/思考强度指定执行或审查模型；本轮由当前主模型执行，独立审查使用未参与实现的子代理上下文并要求直接核对源码/测试，实际模型与强度未独立确认。没有用“另一模型同意”替代证据。

## 覆盖与未覆盖范围

已检查：应用入口 `app/page.tsx`、导航/URL 契约、AI 页面上下文前后端、商品经营汇总契约与类型、库存总览的部分读取/分类逻辑、权限路由扫描（201 个 API route 中写操作的角色检查）、ESLint/TypeScript/构建/边界检查、相关测试与文档引用。

未逐行覆盖：全部 12 个业务域的金额/库存/导入实现、全部 201 个 API route 的响应字段、Django 迁移与运行时、n8n 工作流实际执行、外部平台登录/下载/导入、生产数据。未发现更多缺陷不等于这些范围没有问题。

## Git 与制品状态

- 代码提交：`58f292b5 fix(ai): align page context allowlists and product kind`
- 首份报告提交：`9d33fe7d docs(audit): record full-system code audit report`
- 本状态更新：见本次 docs 提交
- 合并/推送：代码与首份报告已快进合并到 `origin/main`（`988810cf..9d33fe7d`），`git ls-remote` 已核验 `refs/heads/main`。
- 制品准备：已安装的 `refs/remotes/origin/main` 自动准备 hook 在 16:08:30 创建 v2 ticket `95a85f8f-336e-4039-b036-73033fd67484`，16:09:12 返回 `blocked`：`Prior dispatch lacks a complete terminal result; no preparation replay`。被引用的先前 dispatch `e786aed6-25c2-4cce-b433-4fd21d3ac2c2`（13:09:18）不属于本任务，原记录已保留；本轮没有清除、重放或绕过它，也没有生成 `PREPARED.json`。
- 独立审查：未参与实现的子代理上下文复核，结论“可合并，未发现阻断”；指出上述 160 字符/20 项与 3000/4000 口径风险。审查未运行 Git/tsc/构建/测试，且当前客户端无法指定规范表模型 ID，实际模型未独立确认。
- 生产状态：未执行服务启停、迁移、部署或上线；等待用户明确说“上线”，且需先处理被阻断的制品准备。
