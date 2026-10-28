# lib/market 死代码族清理报告（2026-10-28）

worktree：`D:/.codex/worktrees/market-deadcode-20261028/运营管理系统`
分支：`codex/market-deadcode-cleanup-20261028`
基线：`main` = `72d07ad7`（干净，无未提交改动）
本次未 commit、未 push、未合并。

## 删除清单（共 12 个文件，约 12926 行）

### lib/market 死代码源文件（3 个，4780 行）

| 路径 | 行数 |
| --- | --- |
| `lib/market/admin-service.ts` | 2040 |
| `lib/market/annotation-service.ts` | 2415 |
| `lib/market/legacy/annotation-model.ts` | 325 |

`lib/market/legacy/` 目录在删除 `annotation-model.ts` 后已是空目录，一并移除（`rmdir`）。

### 仅为它们存在的测试（9 个，8146 行）

| 路径 | 行数 |
| --- | --- |
| `tests/ai-legacy-market-fixture.ts` | 8 |
| `tests/market-admin-workflow.test.ts` | 1792 |
| `tests/market-analysis.test.ts` | 680 |
| `tests/market-annotation.test.ts` | 2011 |
| `tests/market-database-review.test.ts` | 1585 |
| `tests/market-industry-report.test.ts` | 162 |
| `tests/market-master-first-load-performance.test.ts` | 182 |
| `tests/market-performance-cache.test.ts` | 1266 |
| `tests/market-price-band-publish-safety.test.ts` | 460 |

全部 12 个文件均按完整路径删除（`rm -f`/`rmdir`），未按文件名批量匹配，避免误删同名的活文件。

## 删除依据：零调用方的实测证据

对三个死文件分别在全仓（含 `app/`、`lib/`、`worker/`、`tools/`、`tests/`、`docs/`）按多种写法搜索（`@/lib/market/...` 绝对路径、`./admin-service`、`../market/annotation-service` 等相对路径）：

- `admin-service.ts`：命中仅为（a）本清单内的测试文件、（b）`docs/*/evidence/*.json` 里的历史哈希清单（审计存档，非代码引用）、（c）`lib/market/legacy/annotation-model.ts` 注释里的文字说明、（d）`tests/django-market-routing-static.test.ts` 的正则字符串字面量（见下节单独说明，不是 import）。
- `annotation-service.ts`：命中模式与上相同。
- `legacy/annotation-model.ts`：唯一真实 import 方是死文件自己（`admin-service.ts`、`annotation-service.ts`）和清单内的 `tests/ai-legacy-market-fixture.ts`（通过 `node:module` 的 `registerHooks` 做路径重定向）。

删除前后分别跑 `npm run build`（含 Next/vinext 的完整 TypeScript 类型检查），结果均为 0 错误、全部路由正常产出，包括全部 10 个现行 `/api/market/*` 路由，证明不存在悬空 import。

## 活/死两套实现的区别（避坑记录）

**`lib/market/annotation-model.ts`（活，10 个 API 路由在用）与 `lib/market/legacy/annotation-model.ts`（死，已删）是两个同名不同物的文件。**

- 活文件：`import { aiConsumer } from "@/lib/django/ai-service"`，走 Django/PG，不含 D1 裸 SQL；入参以 `principal?: AppPrincipal` 为核心，依赖 `@/lib/ai/endpoint-security`、`@/lib/ai/model-gateway` 等现行 AI 基础设施。
- 死文件：以 `db.prepare("SELECT * FROM ai_models ...")` 直接操作已退役的 D1 `MarketDatabase`，入参为 `(db: MarketDatabase)`。

删除操作**只**按完整路径 `lib/market/admin-service.ts`、`lib/market/annotation-service.ts`、`lib/market/legacy/annotation-model.ts` 执行，自始至终未触碰 `lib/market/annotation-model.ts`（活文件）。`git status --short` 核对的 12 条删除记录中不含该活文件路径。

`tests/ai-legacy-market-fixture.ts` 里的 loader hook（第 4、6 行）专门把 `@/lib/market/annotation-model` 重定向到 `../lib/market/legacy/annotation-model.ts`；删除前确认过该 fixture 唯一的 import 方是 `tests/market-annotation.test.ts`（`import "./ai-legacy-market-fixture";`），且该测试文件本身也在本次删除清单内，因此 fixture 删除时没有遗留消费者。

## `tests/django-market-routing-static.test.ts` 的特殊处理（未改动）

该文件内有四处字符串字面量提到 `market\/admin-service`、`market\/annotation-service`（均在正则表达式里，用于 `assert.doesNotMatch`），但它**不 import** 这两个死文件——它读取的是现行 10 个活跃 API 路由的源码文本，断言这些活路由的源码字符串里不包含对死模块路径的引用。删除死文件对这个断言没有影响（活路由从未引用过死模块），因此本次未修改该文件。`npm run build` 和 CI 白名单回归测试证实它不受影响（它本身不在 CI 白名单里，但也不在本次删除清单里，状态不变）。

## 四项检查结果

全部在 worktree 内执行，依赖已通过 `npm ci` 安装（worktree 原本无 `node_modules`，与本次改动无关，是环境初始化缺口）：

| 检查 | 结果 |
| --- | --- |
| `npm run build` | **通过**，exit 0。含完整 TypeScript 类型检查，全部路由（含 10 个 `/api/market/*`）正常产出，无悬空 import |
| `node .github/workflows/check-lint-baseline.mjs` | **通过**。`eslint: 56 errors, 171 warnings (baseline: 56 errors)`，PASS |
| `npm run check:backend-boundary` | **通过**。`"violations": []`，729 个模块检查无违规 |
| `npm run check:pi152-acl` | **通过**。`PI152_ACL_CONTRACT_PASSED tables=3 append_only=2 checks=27 no_database=True` |

CI 单测白名单回归（`node --import tsx --test --test-timeout=30000 $(grep -v '^#' .github/workflows/ci-unit-test-files.txt | ...)`）：53 个测试全部通过，0 失败。确认本次删除的 9 个测试文件均**不在**白名单（`.github/workflows/ci-unit-test-files.txt` 实际列出的 11 行）内；白名单注释第 4 行提到的 `tests/market-annotation.test.ts` 只是解释性文字（说明它为什么被排除在白名单外），不是白名单条目，因此**不需要**同步修改白名单文件。

## lint 基线：未调整

删除前后 error 数均为 56（**持平，未上升**），因为全部 56 个既有 error 分布在被删文件之外的其他文件（`@typescript-eslint/no-explicit-any` 53 个、`@next/next/no-assign-module-variable` 2 个、`react-hooks/refs` 1 个）。按 `check-lint-baseline.mjs` 文件头注释的要求，只有在数值**下降**时才调低 `BASELINE_ERRORS`；本次持平，因此 `BASELINE_ERRORS` 保持 `56`，未作修改。

## eslint.config.mjs：未改动

检查了 `eslint.config.mjs` 中对 `app/`、`lib/`、`worker/` 禁止导入 `tests/**` 的 `no-restricted-imports` 规则（第 17–27 行）。该规则是通用的生产/测试边界保护，不是专门针对本次删除的三个死文件或任何具体路径配置的，删除后规则语义依然完全适用（继续防止任何生产代码导入 `tests/`），不存在"规则变成死配置"的情况。未做改动。

## 发现但未删的疑似孤儿文件

逐一检查 `lib/market/` 目录下所有 `.ts` 文件，确认是否存在"仅被 `admin-service.ts`/`annotation-service.ts` 引用、删除后变孤儿"的情况：**未发现任何此类孤儿文件**。

脚本化排查（按 `market/<basename>"`、`./<basename>"`、`../market/<basename>"` 等写法匹配全仓引用）得到 4 个初筛疑似无引用的文件，经逐一人工核实后确认均为**误报**（脚本正则转义问题导致漏判，实际均有生产或测试引用，与本次删除无关）：

| 文件 | 实际引用情况 |
| --- | --- |
| `lib/market/django-import-contract.ts` | `app/api/market/import/route.ts`、`app/api/market/master/execute/route.ts` 生产引用 |
| `lib/market/django-import-rejection.ts` | 同上两个生产路由引用 |
| `lib/market/import-service.ts` | `tests/jd-market-ranking-recovery.test.ts` 等测试引用；无生产 import，但不在本次清单内，本次不处理 |
| `lib/market/netshop-projection.ts` | `worker/index.ts`（经 `django-netshop-projection-runner.ts`）、`tests/django-sales-netshop-market-consumers.test.ts` 引用 |

结论：本次删除范围内无需要追加处理的孤儿文件，未删除清单外的任何文件。

## 交付状态

- 已删除：3 个死代码源文件 + 1 个空目录 + 9 个专属测试文件，共 12 个路径，约 12926 行
- 四项检查全绿
- lint 基线持平（56），未调整
- `eslint.config.mjs` 无需改动
- CI 单测白名单无需改动
- 未发现需要用户决定的孤儿文件或冲突
- 未 commit、未 push、未合并，等待后续授权
