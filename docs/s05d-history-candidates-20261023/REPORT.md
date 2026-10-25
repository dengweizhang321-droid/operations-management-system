# S05d 十一个历史候选的只读归属核对

2026-10-23，**本次只读核对完成，建议原位保留。** 11 项的登记身份、残留形态与固定原生域引用已查明；没有删除、移动、封存或修改现场资格规则。

## 主要结果

- 11 项均不在新鲜核验的当前有效发布链中，manifest 登记的来源树、来源路径摘要均不同于原 a3。它们不是因命中 a3 source-tuple 而入选，而是未取得 `source-snapshot` 内实际源码差异见证，被 collector 保守纳入。
- 所有 11 项均缺 `source-snapshot`、`dist`、`helper`、`node_modules`，保留工具与审计/元数据等；83 个实际工具叶与 manifest 和此前独审的全文 SHA 对齐。
- 8 项仍被 8 份旧 rotation plan 以 candidate 身份引用，sidecar 摘要成立。3 项在本次固定五域的 937 件 JSON 内未命中，不能说成全机无引用或从未使用。
- 185 个枚举文件逻辑大小合计 **9,054,803 字节，约 8.635 MiB**；含 11 个多链接文件，不代表可释放磁盘空间。`.dev.vars` 只查属性，未读内容。
- 主负责人一次固定脚本 **7.738 秒完成**，不重跑全 collector、不构建、不改运行状态。独审直接核统一证据及逐项绑定，未重复采集或运行测试。

**不建议直接删除。** 本轮确认的是旧登记身份、当前链归属及有限引用事实，不是完整实际源码差异或零作用证明，也没有赋予删除许可。若继续 S05d，应处理这种旧候选残留的有限分类/排除规则，保留历史原件；不能把 11 项全部当作 a3 产物搬走，也不能靠删除凑过门禁。这项代码变更未在本轮执行，S05d 整体 / S05b 现场仍阻塞。

## 授权与基线

用户在了解不能直接安全删除后，明确要求核对这 11 个历史候选。该请求覆盖此前“不再核对”的停止点，仅授权本次只读调查，不视为删除或生产恢复授权。

已从现有 hook 与 `git ls-remote` 核对：远端 main 仍为 `36668589cab03d5d2d9d98383fb58eeb19c391ee`。从该基线创建 `codex/s05d-history-candidates-20261023` 独立分支/worktree，再 fast-forward 复用已推 `244cfa9152acab6f71964ec6ee1117a0caf43ff5`；未 fetch、未推进 main，旧树及用户主检出改动保留。

复用上一轮已完成的只读 observation：10,989,211 字节，SHA `0f92c078993b1cf3e8b6893ecf9510f57f6070b19ee80aa2b043c8a27f7e40ae`。原件位于 `D:/codex-artifacts/s05d-guard-cas-fix-20261023/inspect-be589986-49fe-413c-b3cd-8ecdb25e8e72.observation.json`。范围精确为 sourceActions 中 `conservative-no-positive-difference` 的 11 个旧 release，不重跑全 collector 或完整构建。

## 核对边界

核对实际来源身份、现有引用与目录角色，区分“已证明不是原 a3 生产来源”“未见当前消费”“现有规则可否排除”“可否删除”这些不同结论。仅凭日期较早、manifest 不同或缺 snapshot 不能证明零作用；不根据文件夹名字或一次搜索未命中作删除判断。

具体证据和逐项结论见 [OWNERSHIP.md](OWNERSHIP.md)、[统一原件](ownership-evidence.json)与[只读脚本](inspect-ownership.mjs)，独立核对见 [REVIEW.md](REVIEW.md)。本轮没有 source-close、控制采用、queue/resolution 写入、任务/服务/数据库操作或 Windows 重启。

仅将文档、诊断脚本和证据提交/推送 `codex/s05d-history-candidates-20261023`，不推进 main。精确提交与远端核验记录在外部任务 artifact 的 `delivery.json` 及交付答复中；未合并树保留。原 2 处代码修复和完整只读通过的有效结果继续复用。
