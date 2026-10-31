# 单品口径修正 · 发布就绪与范围（2026-10-27）

本文件只记录第 4 步（必需程序代码检查）的结果与第 5、6 步的待授权范围。合并、制品、发布三步均未执行。

## 交付位置

- 分支：`codex/product-single-spec-20261027`（从最新 `origin/main` 创建）
- worktree：`D:\.codex\worktrees\product-single-spec-20261027`
- 候选提交：`2ed2e0e047fe3ffc3632c5c862c130ae5dce1ab3`
- 基线：`f2c2c414862e3f01ddcc6cc5543081d9c69ec2e0`（`origin/main`，与本地 `main` 一致）

生产检出 `D:\运营管理系统` 已还原，不含本次代码改动；其余未跟踪文件属别的任务，未触碰。

## 范围计划

`node tools/release-scope-plan.mjs --base origin/main --head HEAD` 输出：

- `planSha256`：`d79e6ea025d7198165ca0406ae7e1bbb19aae568cacefbd7c2df6017d08c9329`
- `scope`：`combined`，`components`：`worker` + `django`，`domains`：`products`
- `migrate`：`false`（无 migration 变化，不执行迁移）
- `databaseProtection`：`verified-current`；`businessDataProcessing`：`separate-authorization-required`
- `unknown`：空（三个文件全部命中已知分类）

变更文件三个：[app/product-module-view.tsx](../../app/product-module-view.tsx)（前端→Worker）、[backend/products/query.py](../../backend/products/query.py)、[backend/products/tests/test_combinations.py](../../backend/products/tests/test_combinations.py)（后端→Django）。

## 第 4 步 · 必需程序代码检查结果

全部在隔离 worktree 内执行，未改动生产运行目录。

| 检查 | 结果 |
| --- | --- |
| Python 语法编译（改动的两个 .py） | 通过 |
| `manage.py check` | `no issues (0 silenced)` |
| Django 受影响测试：`test_combinations` `test_api` `test_retirement` `test_migration` | 22 项全部通过 |
| TypeScript 类型检查（项目本地 tsc，全仓） | 基线 205 个既有错误，候选 205 个，**新增 0**；改动文件本身无错误 |
| ESLint（改动的前端文件） | 通过，无告警 |
| Worker 生产构建 `vinext build` | `Build complete`，成功 |
| 发布范围计划自测 `tests/release-scope-plan.test.mjs` 及三个 product 前端契约测试 | 25 项全部通过 |

### 既有问题（非本次引入，未阻断）

- `products.tests.test_summary_cache` 的 `test_expiry_failed_load_revision_and_oversize_never_reuse` 不稳定：该用例用 `ttl=.001` 配 `sleep(.002)`，低于 Windows 时钟分辨率。在**未改动的基线提交**上单独连跑 5 次失败 4 次，在候选上同样 5 次失败 4 次，失败率一致，与本次改动无关。
- 按 app 标签整体运行 `manage.py test products` 因 `ai_business_v4_seal_tickets` 建表缺失中断，同为既有环境问题，故改为按模块运行受影响测试。

两项都是既有状态，本次未修复也未掩盖。

## 第 5 步 · 合并与推送（已按授权执行，制品未准备）

用户 2026-10-27 的授权原文范围：「先只授权合并和推送到 main，不要准备制品，停下来等我下一步授权。」据此只执行了 `merge-main` 与 `push-main`，`prepare-worker-immutable-release` 和 `prepare-django-app` **未执行**。

- 合并前核验：`git fetch origin main` 后远端仍停在基线 `f2c2c414`，无新提交，候选为其直系后代，故为纯 fast-forward，无冲突、无实际代码变化，不需要补做任何受影响的必需代码检查。
- 合并方式：`git merge --ff-only`，改动仅前述三个文件（38 插入 / 14 删除）。
- 推送结果：`f2c2c414..2ed2e0e0  main -> main`。
- 远端核验：`git ls-remote origin refs/heads/main` 为 `2ed2e0e047fe3ffc3632c5c862c130ae5dce1ab3`，与本地 `main` 一致；`git diff origin/main..main` 为空；远端文件内容已抽查确认包含本次两处口径改动。

**最终合并提交：`2ed2e0e047fe3ffc3632c5c862c130ae5dce1ab3`**（后续制品须绑定此提交）

合并不等于上线。当前生产仍运行 `D:\teruisi-runtime` 的旧快照，本次改动尚未生效。

## 交付收尾 · 分支与 worktree 清理（已按授权执行）

用户 2026-10-27 授权：「清理本次已合并的 codex/product-single-spec-20261027 分支与 worktree，制品等我另行通知。」

清理前核验：分支已完整合入本地 `main` 与 `origin/main`（`origin/main..分支` 无提交）；worktree 无已跟踪或未跟踪改动；非应用受管 worktree（`.git` 为普通 gitdir 指针，管理目录无归属标记）；无进程占用（唯一匹配项是核查命令本身的命令行）。

执行与结果：

- `git worktree remove` 成功；目录、`git worktree list` 登记与 `.git/worktrees/` 管理目录均已消失，`git worktree prune --dry-run` 无陈旧项，无 junction 或空目录残留。
- 同名远端分支从未推送（`git ls-remote` 为空），无远端分支需要删除。
- `git branch -d`（仅删已合并）删除本地分支成功。

保全确认：提交 `2ed2e0e0` 仍可从 `main` 与 `origin/main` 到达，代码未丢失。仓库级 3 条 stash 条目属其他任务，未触碰；生产检出其余未跟踪文件未改动。

## 第 6 步 · 待授权范围（尚未执行）

制品准备（第 5 步剩余部分）：`prepare-worker-immutable-release`、`prepare-django-app`，须绑定最终合并提交 `2ed2e0e0`。
发布：`verify-current-database-backup`、`activate-worker-release`、`deploy-django-app`、`verify-startup`、`verify-affected-function`。

各需用户对该步骤的单独明确授权，本次未取得，故均未执行。

## 功能验收分工

按 AGENTS.md 第 4 条与[发布检查与功能验收分工](../../docs/规范/验证与发布.md#发布检查与功能验收分工)，上面只做了影响构建、部署和启动的必需代码检查，未做业务功能验收。单品维度修正后的实际数值、页面展示和业务口径是否符合预期，由用户上线后自行检测判断。

本机 :3000 服务读取的是 `D:\teruisi-runtime` 的已部署快照，所以 [REPORT.md](REPORT.md) 中的真实数据数字反映修正**前**的行为；本次改动在发布后才会生效。
