# S05d 现场验证

2026-10-23。用户明确“OK，执行现场验证任务”。本轮仅验证已审 `9925e6ac0a616f7c83c710f2a98993a7a58dad42` 两处小修：一次无业务的 Hidden=false 同链任务，以及四个来源的新鲜完整只读扫描和统一复验。

## 已发生结果及当前止点

1. **Hidden=false 无业务同链正例通过。** 普通侧 3 次、高侧 8 次均看到唯一且与 RunEx/EnginePID 对应的实例，完整候选定义、ACL、实际普通 token 和父子链对应；原 runner direct EXIT=0、输出完整。唯一诊断 Task 已按定义/权限不变、精确进程均退出及包括隐藏项的原生列表无实例等前置清理。见 [HANDOFF.md](HANDOFF.md) 和 [证据索引](handoff-evidence.json)。这不等于 native prepare/adopt 成功。
2. **新鲜全局 closure 在 66.010 秒拒绝。** 最后来源为 `D:/codex-worktrees/s05d-handoff-staging-diagnostic-20261023`，错误为 `Original Git source is partial; missing members are not a difference witness`。实际限定核对为同 HEAD `36668589`、9,653 原成员对 9,697 当前成员、额外 44 个诊断文件、缺失 0、tracked diff 为空。错误来自同目标 HEAD 的成员集合不一致，不是已经证明源码丢失。见 [原始失败](closure-result.json)、[成员证据](scope-blocker.json)。没有取得完整 closure，也没有进入该轮 snapshot 或组合 CAS；不能无视这个新注册来源。
3. **独立四对象完整前像及同轮四对象 CAS 通过。** 为完成用户已授权的原四来源前像验证，复用原 `inspect-snapshots.mjs`，仅改新冻结代码、私有输出和本诊断 1,200 秒预算，明确 `globalClosureSucceeded=false`。旧 observation 只提供四地址和原 Git 基准，各实体/manifest/Git 角色均新核，各叶全部新读，最后同调用四对象统一 snapshot CAS。实际 417.808 秒完成、冻结字节前后相同，采样 RSS 峰值 333,922,304 B（约 318.5 MiB）。不会把独立结果代替失败的全局 closure 或组合 CAS。见 [输入](four-object-input.json)、[driver](readonly-four-objects.mjs)、[完整结果](four-object-result.json)及[原件摘要](evidence.json)。

| 对象 | 清单项 | 逻辑字节 | 完整 snapshot 用时 |
| --- | ---: | ---: | ---: |
| 原 packet/source | 9,654 | 159,152,641 | 10.234 秒 |
| merge-20261022 | 9,654 | 159,152,647 | 9.717 秒 |
| 原相关 staging | 41,262 | 921,007,136 | 175.426 秒 |
| 原候选 f5 | 41,291 | 922,241,408 | 173.742 秒 |

Git 清单项含其受控依赖 junction 记录，不能将总项数当独立物理文件数或可释放空间。四对象统一 snapshot CAS 用时 **38.860 秒**，不含 closure、普通写者、boot/ref、adoption CAS；完整生产 40 秒门禁仍未证明，不能因该子项小于 40 秒就放行。未进行生产写者操作，也没有将不同轮次耗时相加冒充一次原生测量。

没有改动、提交、删除或移走旧诊断工作树。处理其额外来源身份属于后续具体事项，本次不靠调整清单或放宽同 HEAD 规则放行。

**结论：本次两个小修的限定现场验证通过；S05b 完整现场准入仍阻塞。** 下一步需要先保全并明确处理上述旧诊断工作树的来源身份，再取得完整新鲜 closure 和完整原生预算准入；本次不继续采取这些动作。成功的同链检查及未改代码的审查可复用，不重复注册空任务。四对象前像证明仅属于本次读取，后续写者仍按协议取新鲜证据。

独审见 [REVIEW.md](REVIEW.md)。[保全状态](preserved-state.json)确认原 config/CONTROL-INSTALLATION/hook、c6/28a RUN 与 EXIT 摘要均保持；安装代际仍为 `83e4158f…`，原失败未知状态没有被成功诊断覆盖。

## 范围

- 新建独立分支/worktree `codex/s05d-field-validation-20261023`，从 ls-remote 核同的 main `36668589cab03d5d2d9d98383fb58eeb19c391ee` 建立，再 fast-forward 复用 `9925e6ac`。不 fetch、不推进 main/origin/main；保留用户主检出和所有旧树。
- 同链诊断使用候选固定定义、原 runner、冻结白名单环境与普通 token；唯一新诊断 Task 只运行一次，不调用 native prepare/adopt。正常退出且定义/权限未漂移、确无实例后仅清理本 Task，保留原件。原 c6/28a 与 unknown 不改、不重放。
- 扫描复用此前组合只读 driver，冻结 33 叶逐字匹配 `9925e6ac`。重新收集 closure，不跨调用借用旧哈希证明；只用旧清单的四个地址限定扫描范围，当前范围变化即拒绝额外扫描。读取全部实际字节及链接资格，完成各对象内部 CAS 后，再统一核本轮 closure 与全部 snapshot。
- 只读诊断自身总预算为 1,200,000 ms，内存由 Node 768 MiB heap 限定，并每 5 秒落 RSS 进度。此预算只约束本诊断，不改生产 40/60 秒门禁。完整最终文件复验时长另记，排除尚未执行的普通写者/boot/ref/adoption CAS，不能当完整生产时限通过。

没有控制包准备/采用、应用构建、队列协调、来源移动/删除、Windows 重启、服务/数据库变更或上线。本轮结果只用于后续现场动作的判断，不自动开启这些动作。

## 输入和证据

[只读冻结输入](readonly-input.json)、[冻结脚本](freeze-readonly.mjs)、[实际只读 driver](readonly-field-scan.mjs)。33 件工具副本在 `D:/codex-artifacts/s05d-field-validation-20261023/inspect-code-5f1cef12-2d2a-41fc-bf95-7762e7eb349f`，PINS SHA `d650d66875f4d36163cc9461fa4d171d6ec9ac92624b99b332ce20f3cda51a54`。

只读 driver 已经原独审上下文静态复核，无生产写入口；实际两项结果将由同一独审上下文直接核原件，不重复测试。
