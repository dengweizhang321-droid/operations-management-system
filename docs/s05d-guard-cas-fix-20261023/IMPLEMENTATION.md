# S05d 两处窄修正

2026-10-23；隔离树 `D:/codex-worktrees/s05d-guard-cas-fix-20261023`，复用基线 `a116fc55`。本轮只修旧 guard 有限兼容与 sealed reader 的读末统一复验。请求角色沿用 complex / Sol XHigh；没有工具独立确认实际底层型号。

## 旧 guard 的实际边界

直接只读原路径 `D:/codex-isolated/auto-wake-control-c36ea996/source/tools/` 的两件小源码：`frozen-main-source.mjs` 为 `b4bb57dff7a659a94520bc592e0f42b026d5b2a4def4dacfb928e8635f21f9c6`，相邻 `publish-main.mjs` 为 `228e151242e4c5351fb4ec294df44f9e4adadcf6c5a007931517e4c17ef82063`。未执行旧 publication CLI。摘要见 [source-inspection.json](source-inspection.json)。

该 publisher 从自身根选择 source、读取相邻固定 request；固定历史 resume 仍有原资格与非原 target 限制。它在 check/prepare 分支之前调用 guard。旧 guard 分三次读取 HEAD、HEAD tree、批准 commit tree，仍要求完整 commit 等于批准值、两个 tree 相等、可选 request.sourceTree 相等和源码 clean；现 c0b4 版将三个值合为一次 Git 查询，status 仍单独读取。

分次查询存在交错：首个 HEAD 正确而后续 tree 变成另一 tree 时拒绝；HEAD 后来移到同 tree 的不同 commit 或发生 ABA，旧 guard 可能仍接受先前观察。合并查询也不把后续 status、准备与执行变成原子事务。本次没有把 guard 当退休证明，也没有改变这些旧代码。只在既有 228e publisher 配对内增加这一个全文 SHA；未知字节、own-root HEAD 仍是原 target、未知 resume 等继续拒绝。实际来源区别、原生 ref fence、source-close/full-boot 与最终复验仍是必要条件，已越过旧检查的 actor 仍须由原退休边界覆盖。

## sealed reader 的最后复验

`validateRetirementSealInternal` 保存本次每件档案的完整实际快照。全部档案全读并与封存前像核同后，复用 `assertRetirementClosureUnchanged` 重核本次 closure，再逐件确认原地址仍缺失并调用 `assertRetirementSnapshotUnchanged`。目录成员、叶身份/大小/链接数/时间与既有固定 junction 规则沿用原函数；不重复全量哈希、不跨调用缓存。末尾原 native/control/ref/original/SEALED 检查保留。没有将未来其他 target 的运行元数据永久固定到历史 seal。

## 最小隔离检查

[原始输出](checks.txt)及[精确命令](checks-command.json)：单次 Node 定向运行，**4/4 通过，exit 0，18,381.842 ms**。

- 原 pinned publisher 资格用例追加真实旧 guard：有限配对可读，原 target own-root 与改字节仍拒绝。
- 实际旧 guard 夹具逐 SHA 绑定；私有原生 Git 稳定值通过，changed commit、错误可选 tree、dirty bytes 拒绝。受控分次返回演示不同 tree 拒绝及非原子观察边界。
- 复用原单个私有集成用例；在最后一件档案开始全读时，分别实际修改已采 closure 小叶、重现原 source 地址、修改此前已全读档案，均由新读末复验拒绝。原观察失败后的同 intent 续接及原 unknown 保留仍通过。

测试只在专用临时拓扑中使用真实文件、Git 和证据。boot/token/chain/CIM 仍为已明确的测试替身；受控 Git 返回也不冒充现场交错证据。唯一附带补正为既有测试 fixture 在首 commit 前绑定新建私有空 hooks 目录并关闭签名，没有改全局或生产 Git 配置。没有新增生产测试注入接口。

本轮未运行真实 collector、生产 writer、完整构建、旧全套或额外 bundle 检查；没有控制采用、任务更改、来源移动、重启或 queue 写入。两处代码缺口已完成窄修正；完整现场清单、吞吐与退休资格仍以主负责人后续只读结果及原生门禁为准，当前不宣称 S05d/S05b 就绪。冻结文件摘要见 [pins.json](pins.json)。
