# S05 最终候选与批次关系（非生产部分）

2026-10-24 夜间只读核对。未运行 准备main.bat/发布main.bat，未写队列、控制包或生产目录。

## 结论

- S05 最终候选为 origin/main `36668589cab03d5d2d9d98383fb58eeb19c391ee`（B1），与 a3d53227 的原目标相同。本地视图如此；github.com 今晚不可达，未刷新远端，早上执行前须以准备main.bat 实际观察到的目标为准，main 若已前移则候选随之变化，须重新判定。
- 生产为 `4059afea884151d881e3eb87159e401c2c1579c3`（`PUBLISHED-MAIN.json`：status deployed_and_ready，2026-10-22T05:34:48.011Z，Worker release `20261022T034924Z-1667fc5e107422e1`，Django manifest `bbc9a5ef…`）。4059afea 是 36668589 的祖先，相差 8 个提交。
- 生产到候选的范围为完整 Worker + Django，无 migration、无未知路径；旧分类器（a6cc9fcd）与新分类器（c35de78e，含 S08 仅控制包规则）输出逐字段相同，S08 对本批没有影响。
- 批次关系：
  1. S05b 必须先完成。队列被 a3d53227 的 unknown 拦住，只有采用含 S05d 的控制包后，消费者才会写放弃记录并把同一目标准备到新目录 `36668589cab0-71ecf390-bbc9a5ef-r2`（实时绑定不变时），见 [S05B-RUNBOOK](S05B-RUNBOOK.md)。
  2. S08、S16 的代码在 `codex/release-rework-20261024`，按用户要求不合入 main，所以不在本批候选里，不能随 S05 上线；合入 main 后随 S09/S17 的真实批次走。S16 的计时改动在原生工具 `worker-local-release-rotation.mjs` 中，只在其所在提交被准备时生效。
  3. 本批准备用的原生发布器来自 36668589 冻结源码，不含 S05d 的原生结构化失败记录（`publish-main.mjs` 改动在分支上）。若本批准备再次以非零退出失败，仍记 unknown；新消费者会在期限加 15 分钟后按放弃规则解除阻塞，不需要人工 resolution。

## 差异分类

`diff --name-status --find-renames=50% 4059afea 36668589` 共 36 项（A 28、M 8）：

| 类别 | 项数 | 路径 | 判定 |
| --- | --- | --- | --- |
| 文档 | 27 | `docs/start-timing-20261022/` 25 项，`docs/任务记录/README.md`，`docs/文档目录.md` | non-production |
| 测试 | 6 | `tests/dingtalk-startup.test.ts`、`tests/manual-maintenance-continuation.test.mjs`、`tests/operations-system-control.test.ts`、`tests/start-timing*.{mjs,ps1}`（3 项） | non-production |
| 运行或发布工具 | 3 | `tools/manual-maintenance-continuation.mjs`、`tools/operations-system-control.ps1`、`tools/worker-local-service.ps1` | full（Worker + Django） |

两版分类器结果：scope `full`，components `["worker","django"]`，unknown 为空，原因列表相同，新版无 `controlOnly` 字段，`JSON.stringify` 全等。

对照：生产到分支头 `22193950` 共 383 项，新分类器为 full 且带 `controlOnly`（10-23 链改过 hook/status），与旧版不再全等；这只说明分支合入 main 后的批次仍需完整准备。

## 使用的命令

```powershell
$env:GIT_CONFIG_GLOBAL='NUL'
& D:\git\Git\cmd\git.exe -c safe.directory=* -c core.quotepath=false -C D:\运营管理系统 diff --name-status --find-renames=50% 4059afea884151d881e3eb87159e401c2c1579c3 36668589cab03d5d2d9d98383fb58eeb19c391ee
& D:\git\Git\cmd\git.exe -c safe.directory=* -C D:\运营管理系统 rev-parse refs/remotes/origin/main
& D:\git\Git\cmd\git.exe -c safe.directory=* -C D:\运营管理系统 merge-base --is-ancestor 4059afea884151d881e3eb87159e401c2c1579c3 36668589cab03d5d2d9d98383fb58eeb19c391ee
```

分类：用 node 只导入（不起子进程）草稿仓库 `tools/release-scope-plan.mjs` 的 `parseNameStatus`/`classifyRelease`，旧版取 `git show a6cc9fcd:tools/release-scope-plan.mjs` 的临时副本，输入为上述差异转成的 NUL 分隔串。`PUBLISHED-MAIN.json` 与队列 dispatch 只读读取。
