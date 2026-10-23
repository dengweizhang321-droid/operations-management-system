# 诊断来源清理与发布控制链稳定性

2026-10-23。本轮最初获用户“能否删除和闭合”的明确要求，随后用户强调“整个发布过程的稳定执行，而不是个例通过就算；需要优化”。因此清理只是第一项，后续按独立 [STABILITY-PLAN.md](STABILITY-PLAN.md) 补固定诊断流程、提前来源判定及有界完整复验，不以个例清理代替整体就绪。

## 44 个文件的来源

这批文件不是 11 个九月历史候选，而是后来的 handoff/staging 限定诊断生成的脚本、日志、直接退出回执、原始测量和报告。它们此前只在 `D:/codex-worktrees/s05d-handoff-staging-diagnostic-20261023` 本地保存，未提交。该工作树的 HEAD 仍是原目标 `36668589`；9,653 个原成员加 44 个诊断文件后变为 9,697 个，缺失 0、tracked diff 为空。

上次全局核验拒绝的是同目标 HEAD 的来源成员身份无法分类，不是 44 个业务残留凭空出现，也不是源码丢失。诊断结束后只保留证据却没有完成工作树保全/退出，造成了新的恢复来源障碍。单删 44 个文件仍留下同源检出，因此本轮保全后移除了整个已停用普通 Git 工作树及其登记。

## 已完成的有限清理

- 目标精确限定为上述一个工作树。Git 管理目录只有标准 linked-worktree 元数据，无 locked/应用托管标记；既往报告记录其原生 Git 创建。HEAD 没有独有提交，tracked clean、ignored 文件为空，未跟踪文件恰为这 44 项；全物理成员和无 reparse 情况也已检查。
- [bindings.json](bindings.json)检查当前进程、服务及 314 个含隐藏项/子目录/EncodedCommand 的计划任务，未见目标路径引用；原诊断 Task 已不存在。未停止进程、服务或任何业务任务。
- 44 件原字节合计 274,879 B 已复制并逐件复核；9,653 个 tracked 成员另有完整 Git archive，逐条校核 Git blob 内容。仅 5 个显式 `text/eol=crlf` 的 BAT 按 Git 正常 checkout 换行规则核验，清单明确记录，没有泛化内容变换。备份为 `D:/codex-artifacts/s05d-diagnostic-cleanup-20261023/preserved-3f15a48b-c867-473e-95df-5875dda958db`；[preservation.json](preservation.json) SHA `ae9192d5d975530718f69e79ad9347db15d4b5da4f29ccedd3d5dbbc40ca455e`，包含原位置、全部叶摘要和可恢复 tracked archive。
- 保全过程最初因 Python 路径/句柄的 ctime 视图不同拒绝；改为两种视图各自严格前后不变，跨视图仍绑定 dev/ino/size/mtime/nlink。随后严格 blob 原字节比较识别上述显式 CRLF 转换，核明属性后继续验证原 archive，没有重打包。所有拒绝均发生在删除前，未覆盖原源或原失败记录，临时不完整保全目录保留为诊断线索。
- 独审通过后执行固定清理脚本：首次删除前核完整 manifest/备份/源/成员/占用，逐叶再次核 SHA 后仅删除 44 个精确路径，再删三个确为空的诊断目录。工作树变 clean 后使用原生 `git worktree remove`，没有 `--force` 或递归 shell 删除。见 [cleanup-result.json](cleanup-result.json)：44 删除、目标目录与 Git 登记均已不存在；原本地分支保留，main 不变。

备份的 `files/` 保持原 44 项相对目录，原报告到 diagnostics 的相对链接仍可读取；恢复说明在备份 `RESTORE.txt`。不复制过期 `.git` 指针。c6/28a 原 unknown、冻结 host、原 native 日志、11 项历史候选和四个正式来源均未改动。

## 已完成的稳定性代码候选

已完成并通过增量独审：固定仓库外诊断入口及有限生命周期回执、前置准确来源分类、共享四槽完整 snapshot CAS、同实现组合计时、owned 诊断总预算监督。保留原属性读取点，不为省一次读取合并检查边界。来源两项复用已有通过结果，最后直接检查 8/8、19.918 秒，涵盖实际文件/Git、变化与中断/drain、诊断隔离/超时和原私有恢复集成。见 [STABILITY-IMPLEMENTATION.md](STABILITY-IMPLEMENTATION.md)、[stability-pins.json](stability-pins.json) 和 [REVIEW.md](REVIEW.md)。

原普通权限 handoff 成功及不受影响的检查直接复用；不重跑全仓测试、不构建、不增加生产试跑。不改 40/60 秒门禁、原两个 decision、unknown/no-replay 或迟到作用保护。固定入口的一次真实 `--mode preflight` 尚待完成；只读结果始终不代表普通写者/锁/退休 intent 已取得。

## 整体目标尚未闭合的额外发现

按用户“整个发布流程稳定”要求继续核实际调用链，发现常规队列的 generation、旧 unknown resolution、observe/admit/freeze 等路径都会读取退休回执，退休 schema 又会全量核验 archive；一次新准备可多次触达，次数取决于实际分支。当前四槽 CAS 不消除重复全读。原历史 catalog、消费链及 target ban 不能替代当前档案字节验证，不直接套用缓存或只保 marker。准确调用点及后续边界见 [STABILITY-PLAN.md](STABILITY-PLAN.md) 的追加分析。

因此本轮候选只能称已完成上述局部稳定性工程，不能称整个发布稳定目标已闭合。下一步需在同次操作内复用与跨操作免全读之间明确证据模型及范围；新保护没有设计和审定前不放宽现有验证。

本页此时只确认清理成功，尚未把新鲜全局 closure 或完整组合时限标为通过。后续实际证据及交付状态在本页更新；控制准备/采用、新 dispatch、正式来源移动、重启、数据库/服务变更与应用上线不在本轮执行范围。
