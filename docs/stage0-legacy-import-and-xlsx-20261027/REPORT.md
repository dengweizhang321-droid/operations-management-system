# 阶段 0：tests/legacy 导入归位与 xlsx 双锁文件（2026-10-27）

- 分支：`codex/stage0-legacy-import-and-xlsx-20261027`（自 `main` = `e0dffdec` 创建）
- 来源：2026-10-24 系统审查报告「阶段 0 止血」第 4、22 项
- 状态：**改动完成并自测通过，未提交、未合并、未推送、未准备制品、未发布**（AGENTS.md 规则 4）
- 分工：sonnet 施工，lead 独立验收

## 一、任务一：生产代码从 tests/legacy 导入（审查 #4）

### 派工单前提有误，施工方已拦下

原派工单写「把 `tests/legacy/market/annotation-model.ts` 移回 `lib/market/`」。施工方读文件后发现这不可行并停下来报告，lead 独立核实后更正。

**事实**：`lib/market/annotation-model.ts` 已存在，且是**活的现行 Django 版实现**（接 `AppPrincipal`、调 `aiConsumer`）；`tests/legacy/market/annotation-model.ts` 是**另一套更早的 D1 版实现**（接 `db: MarketDatabase`、裸 SQL）。两者同名但不是同一文件被移走，是两套分叉的实现。

签名对照（lead 实测）：

| | lib 版（现行） | tests/legacy 版（D1） |
| --- | --- | --- |
| `listAnnotationModels` | `(principal?: AppPrincipal)` | `(db: MarketDatabase)` |
| `runPromptTextCompletion` | `(modelId, instruction, principal?)` | `(db, modelId, instruction)` |

若按原指令执行，会用旧 D1 文件覆盖活的 Django 文件，连带弄坏 10 多个已正确引用 `@/lib/market/annotation-model` 的生产与测试文件。

### 根因

提交 `a0a6f33d`（2026-09-06，"Remove D1 dependencies from production search and aggregate paths"）把 `lib/market/annotation-model.ts` 原地改写成 Django 版 API，但没有更新它的两个 D1 风格调用方（`lib/market/admin-service.ts`、`lib/market/annotation-service.ts`），而是把旧实现复制到 `tests/legacy/market/`，再把这两个调用方的导入指过去。**审查 #4 这条发现就是这么产生的。**

### 死代码事实

`lib/market/admin-service.ts`（2040 行）与 `lib/market/annotation-service.ts`（2415 行）在 `app/`、`worker/`、`lib/`、`backend/` 内**零生产引用**（lead 用 `grep -rln` 四目录复核均为 0），只有各自的测试在引用。

本轮**不删**：删除需连带处理 8 个测试文件共 8138 行，远超阶段 0 止血范围，且违反 AGENTS.md 规则 3「只做本需求所需的修复，避免无关重构」。

### 实际改动（lead 决定的选项 A）

1. `git mv tests/legacy/market/annotation-model.ts lib/market/legacy/annotation-model.ts`（保留历史，git 识别为重命名）
2. 在移动后的文件加头部注释：说明其 D1 时代来源、与现行 Django 文件 API 不兼容、唯一消费者无生产调用方、整族待退役
3. 修正两处导入为 `@/lib/market/legacy/annotation-model`
4. **全仓搜索发现第三处过期引用**：`tests/ai-legacy-market-fixture.ts` 的 Node 模块解析 hook 写死了旧相对路径，已更新（当前虽是死代码，但保持正确而非留下断路径地雷）
5. 删除已空的 `tests/legacy/market/` 目录（`tests/legacy/` 本身保留——`tests/legacy/ai/` 一族仍在使用）
6. `eslint.config.mjs` 加 `no-restricted-imports` 规则：`app/**`、`lib/**`、`worker/**` 不得导入 `**/tests/**` 或 `@/tests/**`

### lead 独立验收

| 项 | 结果 |
| --- | --- |
| 基线 | 分支确认含 `e0dffdec` |
| 迁移形态 | `git diff --stat` 显示 `{tests/legacy => lib/market/legacy}/annotation-model.ts`，重命名被正确识别 |
| **活文件未被动** | `git diff --name-only` 中 `lib/market/annotation-model.ts` 命中 **0**，该文件 29307 字节原样保留 ✓ |
| 导入修正 | 两处均指向 `@/lib/market/legacy/annotation-model`；fixture hook 两行也已更新 |
| `tests/legacy` 残留 | 正当——`tests/legacy/ai/` 下仍有大量在用文件，仅 `market/` 子目录被清 |
| **eslint 规则实测** | lead 自建探针独立验证：`@/tests/...` 别名形态报错 ✓、`../tests/...` 相对形态报错 ✓，探针已清理无残留 |
| 构建 | `npm run build` 通过，全部路由编译成功（含 `app/api/market/annotations/route.ts`） |
| 既有失败对照 | 施工方报告 219 测试 / 214 过 / 5 败，并自建干净基线 worktree 对照得同样 219/214/5。**lead 另建独立基线 worktree 复核**：`e0dffdec` 上出现同一处失败、同一个正则断言（`set_cloud_run_state`，断言去匹配 `app/market-annotation-view.tsx` 源码文本）。该基线连 `node_modules` 都未安装仍同样失败，确认与依赖和本次改动均无关，是 main 上既有问题。lead 的临时基线 worktree 已清理 |
| 其余测试 | `market-database-review`、`market-industry-report`、`market-master-first-load-performance`、`market-performance-cache`、`market-price-band-publish-safety` 共 100/100 通过 |
| lint 全仓 | 零 `no-restricted-imports` 命中（证明无其他 app/lib/worker 文件导入 tests/）。既有 56 errors / 171 warnings 全在 `tools/*.ts`，经干净基线对照确认同样存在，本次未碰 `tools/` |

## 二、任务二：xlsx 漏洞版本与双锁文件（审查 #22）

### 双锁文件：已删 pnpm-lock.yaml

证据链：

| 项 | package-lock.json | pnpm-lock.yaml |
| --- | --- | --- |
| 提交数 | 10 | 2 |
| 最近提交 | 2026-10-18（正常功能驱动更新） | 2026-07-20（均非依赖变更提交） |

另：无 `pnpm-workspace.yaml`、无 `.npmrc`、无 `packageManager` 字段，README 全程使用 `npm run`。两份锁文件对 xlsx 版本无分歧（都是 0.18.5）。

已 `git rm pnpm-lock.yaml`（删 6932 行）。验证：worktree 内 `npm install` 干净完成（611 包），无锁文件漂移；`npm run build` 通过。

### xlsx 版本：硬阻断，未改动，待用户决定方向

实测：

```
npm view xlsx dist-tags --json  →  {"latest":"0.18.5"}
npm view xlsx versions --json   →  最高 0.18.5
```

**0.20.x 无法从 npm 安装** —— xlsx 自 0.19 起转为官方 CDN 分发，npm 包停在 0.18.5。所以审查报告 #22 写的「换成 0.20.x」在 npm 渠道走不通。

按派工单约束**未擅自改用 exceljs**：API 完全不兼容，会牵动 10 个生产文件（`lib/customer-service/import-service.ts`、`lib/finance/annual-target-workbook.ts`、`lib/finance/parser.ts`、`lib/inventory/` 下 4 个、`lib/market/parser.ts`、`lib/netshop/normalized-import.ts`）外加约 25 个测试文件与约 6 个 tools 文件，属范围扩大。

`package.json` 中 xlsx 版本号**未改动**。

三条候选方向（须用户决定）：

1. 接受 0.18.5 的已知漏洞，配输入校验兜底
2. 评估改用 CDN 分发的包
3. 另行授权 exceljs 迁移（独立任务）

## 三、最终差异

```
 eslint.config.mjs                                  |   15 +
 lib/market/admin-service.ts                        |    2 +-
 lib/market/annotation-service.ts                   |    2 +-
 .../market/legacy}/annotation-model.ts             |   12 +
 pnpm-lock.yaml                                     | 6932 --------------------
 tests/ai-legacy-market-fixture.ts                  |    4 +-
 6 files changed, 31 insertions(+), 6936 deletions(-)
```

未碰 `tools/`、`automation/n8n/`、主工作区 stash 与 `docs/施工协调-20261027/`。

## 四、待用户决定

1. 本分支是否提交并合并到 main（AGENTS.md 规则 4，需单独授权）。
2. **xlsx 方向**（上述三条候选）—— 版本天花板是既成事实而非可调项。
3. `lib/market` 死代码族是否清理：`admin-service.ts` + `annotation-service.ts` + `legacy/annotation-model.ts` 共约 4768 行，零生产调用方，连带 8 个测试文件 8138 行。属独立任务。
4. main 上既有的 5 个测试失败（`market-annotation.test.ts` 中针对 `app/market-annotation-view.tsx` 源码文本的过期正则断言）是否单独立项修复。
