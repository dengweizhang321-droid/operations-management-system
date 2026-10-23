# S05d 两项现场验证独审

2026-10-23。基线 `9925e6ac0a616f7c83c710f2a98993a7a58dad42`，独立工作树 `D:/codex-worktrees/s05d-field-validation-20261023`。已读共享 Home 与本树完整 AGENTS；同一上下文的现行专题及模型分工 v3 继续复用。此次仅审用户授权的 Hidden=false 同链无业务 Task 正例及全部 4 来源的新鲜只读 closure/snapshot/最终同轮 CAS。独审不运行 Task、driver 或额外扫描，不修改生产实现。

**最终结论：同链正例、完整原 4 对象快照及其统一 CAS 两项局部现场验证通过；fresh 全局 closure 仍阻塞，未完成全局 closure+snapshot 组合或完整生产准入。** 本次不采用控制、不移动来源、不重启；旧诊断树及两次失败 run 保留。

## 只读 driver

**driver 静态审查通过，可以执行该次限定诊断。** [freeze-readonly.mjs](freeze-readonly.mjs) 只从固定基线逐件比较本树生产字节、复制原清单 33 叶并写私有 artifact/docs；没有执行生产写入口。[readonly-field-scan.mjs](readonly-field-scan.mjs) 实际 SHA 为 `f5ed38cd1283e73646b3595c2b457650b625582ee0cd943b76dce32510370e72`，与 [readonly-input.json](readonly-input.json) 一致；freeze SHA 为 `e0afd61b8da4a7a1318a8d455d6857bdb868e50fbdd10340b36d56f7d7f6435a`。

driver 限固定 config/原 a3 dispatch，使用 `retirementInspectionContext` 并要求 `writeAuthority=false`，只调用 collector、closure CAS、snapshot 及 snapshot CAS。未调用取锁、intent、prepareArchive、移动、拆链、控制采用或 Task API。snapshot 路径的 inventory/hash/stat/readlink 均只读，archive 模块其它写函数没有进入该调用链。

必须使用 `--snapshots`；在首个 action 对象扫描前，精确比较本次行动地址与先前成功 observation 的 4 地址清单，变化即拒绝额外对象扫描。新 closure/每个对象前像均当次重新取得；旧 observation 只作清单约束，不作摘要证明。最后同一调用再次核 closure 与全部 snapshot，才写 complete。所有 driver 自身结果、进度及前像写入固定私有 artifact 根的本次 UUID 文件。

1,200,000 ms 只是本次诊断总预算，不传给生产协议，也不改变生产 40/60 秒门禁。driver 自己明确 `retirementProved=false`、`productionWriterReady=false`；combined CAS 字段明确不含 ordinary Task、boot、ref 与 adoption CAS。即使这次诊断完成，也不能称控制采用、来源关闭或完整生产准入完成。

## Hidden=false 同链正例

**本次无业务 Task 正例通过。** 原件目录 `D:/codex-artifacts/s05d-field-validation-20261023/handoff-e131561d-2ade-4e1b-ab59-2dade0288dcc`。已核候选源码、诊断 spec、注册定义/回读、普通及高侧原件、RUN/PARENT/直接 EXIT 与清理前置记录，没有重新运行。

候选实际源码摘要 `4a9384bfc6ba10300139c769b2f796ff3ffa0baa2be6d256b9eff1bf7dd5e5ac`，runner 仍为原字节 `7ad4e67e…531c`。诊断完整定义对应候选普通 demand 模式的设置：同用户 InteractiveToken/RunLevel 0、单 action、无 trigger、单实例、PT0S、Hidden=false 及其它候选设置；通过固定 encoded-command/原 runner/清空后固定环境启动 Node。仅把业务入口替为私有诊断 Node，未调用生产 handoff execute、installer 或 native prepare。Task 的 Hidden=false 与 PowerShell 的 WindowStyle Hidden 各自按候选定义保留。

普通侧 3/3 的候选原查询块 exactJson、原表达式、保存 collection、显式 COM Count 均为 1，state 4、Hidden=false；高侧 8/8 同样唯一。全部 GUID 都与唯一 RunEx 回执 `{3CD38486-5285-4A84-953E-31AB6565A67F}` 相同，engine/action PID 6288，GetInstances/Count/Item HRESULT 均为 0。三个实际 query PID 50440/57004/49884 → Node 36872 → action 6288 的父链及创建身份与回执吻合，三层均同 SID/session 1、medium 8192、非 elevated。

已核原件实际摘要：RUN `148860c12662d9bc79044741c16099938cbeba380b9a8a056bbd411ee4aad10f`、PARENT `3863ae23d360428fe171a2e1de0fc4f49425493722668b3e0da18d55e2ee29a8`、EXIT `2534c8afa26481be849c93a445dc1ce3302752fdb573dd060b71775438894e81`；绑定相同 run，直接 Node exit 0、输出完整、stdout/stderr 均空。清理前核精确 PID+创建时间对应进程均已退出，定义 XML/SDDL 与注册快照相同、Ready/0 instance，包含 hidden 的全局集合也无该精确任务名实例，才删除这一个诊断 Task，并核其不存在；没有终止进程。

它证明候选配置在本次真实同链具备唯一实例正例，不能推导普通查询永远可见、此前两次失败的其它因果已完全排除、旧 run 可重放或控制 prepare/adopt 已完成。原失败原件与 no-replay 不变。

## 四来源只读组合

**本次 fresh 全局 closure 未通过，未进入 snapshot。** 已核 artifact 根的 `inspect-3aebf329-c821-457f-8de6-1979a3546e3c.result.json` 及阶段尾部原件：66.010 秒，154 个事件，pinsUnchanged=true，在登记源 index 140 的 `D:/codex-worktrees/s05d-handoff-staging-diagnostic-20261023` 拒绝，错误为 `Original Git source is partial; missing members are not a difference witness`；没有完整 observation、snapshot 或最终组合 CAS。

[scope-blocker.json](scope-blocker.json) 的最小成员解释记录该树 HEAD 与原 target 同为 366，原清单 9,653、当前 9,697，新增 44 项、missing/listedButAbsent/trackedDiff 均为空。此次是同 HEAD 且成员集合不同触发保守前置拒绝；错误文字不能当作实际缺文件的证据，成员解释也没有提供完整实际源码字节差异资格。独审没有扫描或修改该树，没有清理它以制造通过。

## 原四对象独立前像诊断

为完成同一授权范围的 4 个原地址新鲜前像测量，已静态核 [readonly-four-objects.mjs](readonly-four-objects.mjs) 及 [转换脚本](prepare-object-scan.mjs)，实际 driver SHA `475f965556c7c3fec70459808c0168a96fd06d602da312c2da5fe318e93077ff`。相对此前独立 snapshot driver，仅替换本次固定 33 叶副本/私有输出根/1,200,000 ms 诊断预算，并增加 `globalClosureSucceeded:false` 及上述失败原件路径；旧 b0a observation 仍用原绝对路径并核原 SHA，只约束原 4 个行动地址、原对象身份及原 Git 基准。

每个对象重新核实体身份、候选 manifest 摘要、原 Git 角色并完整新读字节；末尾统一核全部 4 snapshot。未改变生产代码，未进入取锁、intent、移动或封存。这条独立只读调用明确不含全局 closure CAS、ordinary/boot/Task/control CAS，**不能替代刚失败的组合验证或完整生产准入**。

**该次独立 4 对象前像及统一 snapshot CAS 已完成。** 原件前缀为 `D:/codex-artifacts/s05d-field-validation-20261023/snapshot-ad9b8dca-9705-491c-8a0a-af8a2e3b2d39`，result 实际 SHA `5609521c5396943e88069d09370477fcb991da18902381a15973d084a66d2c28`。已核 result、阶段尾部、4 份实际 snapshot JSON 的摘要/计数/字节数，并逐件核本次冻结副本全部 33 叶的摘要与长度，零差异；PINS 实际 SHA `d650d66875f4d36163cc9461fa4d171d6ec9ac92624b99b332ce20f3cda51a54`，commit 为本次 9925 基线。

| 原范围对象 | 文件数 | 已读逻辑字节数 | snapshot JSON 实际 SHA256 |
| --- | ---: | ---: | --- |
| 原 packet/source | 9,654 | 159,152,641 | `945c140149299914ae33a3befcec25b0e57aa2ad74b3e16246dd84e59b40cbea` |
| merge-20261022 | 9,654 | 159,152,647 | `47063c207d161b5d204a22582514a7991f655a0352c27218ea89335d62c928ef` |
| 原相关 stage | 41,262 | 921,007,136 | `db8f98d4bf71ed243b336f989596a62de3c4e9aee4535776ff9e2b288d6711d5` |
| f5 候选 | 41,291 | 922,241,408 | `e5721d89550d21e803135d139948e7cda3b8cdc5bf9cecbca606d9539c852731` |

四份 JSON 的实际统计及摘要全部与 result 对应。总耗时 417.808 秒；stage/candidate 的 snapshot 分别约 175.426/173.742 秒。末尾统一 snapshot CAS 为 **38.860274 秒**，`complete=true`、`pinsUnchanged=true`。result 仍明确 `globalClosureSucceeded=false`、`excludesClosureCasAndOrdinaryBootTaskControlCas=true`、`writerReady=false`、`productionGateProved=false`。

因此 38.86 秒仅证明此次 4 对象 snapshot CAS 的耗时与完成，不能称完整 40 秒生产准入通过，也不能把它同先前其它调用的 closure CAS 拼成同轮通过。新登记诊断树的全局闭包问题仍在，没有运行另一轮 collector 或处理该树。

主负责人 [preserved-state.json](preserved-state.json) 记录 config、CONTROL-INSTALLATION、hook 及 c6/28a RUN/EXIT 原摘要均保持，与前次已核证据一致；本审仅读该记录，没有再次操作生产。两个失败 run 的 unknown/no-replay 不变。本轮现场验证在上述局部结论处收口，不据此执行控制采用、来源移动、full boot 或退休。
