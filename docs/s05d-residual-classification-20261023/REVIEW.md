# 旧候选残留分类增量独审

2026-10-23。本树基线 `c7f94a79`，用户授权限定分类修正、最小检查与独审；现场采用和准入由主负责人串行执行。本审查复用既有 11 项原件、已审 helper/入口语义、guard 兼容与 reader 末次 CAS 证据；已读共享记忆入口及本树 AGENTS，同一上下文的现行规范和模型分工 v3 继续适用。独审不参与实现、不子派工、不执行生产或另扫 collector。

只审新增角色适用与拒绝、producer/consumer 闭包、8 份旧 plan/sidecar 原位保留及最后动态 CAS。旧 consumed-history 的链锚定条件不得删除；不能用候选 ID/日期白名单，不能仅据缺 snapshot 或不同 tuple 放行。正常原生误用按既有 source-close/full-boot 模型判断，不扩大为恶意同 SID 任意脚本模型。

## 结论与冻结范围

**限定分类增量通过独审；本次真实只读 closure 与统一 CAS 亦已完成。** 未发现本范围内尚未闭合的代码阻断。可交主负责人继续已授权的 archive 只读前像及准入测量、控制材料准备和原生门禁；这些步骤的结果仍须来自各自原生回执。本结论不表示已经退休、可删除残留或已完成 S05b。

最终 [pins.json](pins.json) SHA 为 `fcba2950c36ca2db763b56906c56d2544ceb7b77bd08166b73ab70d4b764da3d`，所列 15 件实际原字节逐件匹配。两个生产叶为：

- history：`3ebf251a19f8f06d164acc9dca6e2395cef7c6c10c7cd440f282e805582c9e9f`。
- collector：`4fc3afbb0974d0ce163b2279e561f51ee8ba6bb23b4ad5b502ec888151cea2a9`。

本次仅改这两个生产模块，collector 仍从原 history 相对路径导入；没有新增模块、relative import 边、循环、控制包成员或 CLI 参数。原实际 32 成员包的 4/4 结构检查可复用，无须再跑整包检查。`git diff --check` 通过。独审未修改实现、运行旧 CLI 或执行生产动作。

## 角色与原生边界

已核 [限定方案](PLAN-ADDENDUM.md)与实际差异。原 `qualifyRetirementHistoricalSource` 的已消费链锚条件保留；抽出的共用工具资格仍核 manifest keyFiles、实际工具全文 SHA、有限 source policy 与 launcher。新增独立 `retained-unconsumed-residual` 只接非 protected、无实际 snapshot 差异见证的分支；缺 snapshot、不同 tuple 均不能单独取得资格，不按候选 ID、日期或 dispatch 放行。

新角色同时核固定 16/19 叶形状、全部非秘密叶摘要及对象签名、有限工具家族、manifest/receipt/fence 原生绑定、缺失载荷与非 Git 身份。未知成员、来源/载荷恢复、未知字节或链接关系均拒绝。共享 `.dev.vars` 只核固定 native base 与残留叶的原生对象/链接身份，不读秘密正文、不拆链。实际 package-lock 摘要与声明来源绑定一致。

producer 仍依赖真实外部来源：默认根、登记根和已解码 binding 的 sourceRoot 都必须进入既有共同来源 finalizer；待关闭原源仅能在 planning 阶段登记，after-close 不可继续存在。残留也进入 source-entry/ref fence 资格。原 target 永久禁重放、旧入口 ref fence、source-close/full-boot、observer/普通权限 ACK 及动态时限没有放宽。

consumer 资格限本次实际出现、已审全文 SHA 的 5 个 Worker 家族，不让其余 history 家族自动继承。独立静态复核确认这 5 件实际源码的 `validateTree` 及无条件 source-snapshot 验证块相同。私有反例取精确 `0d945…c57c0d` 原 verifier、真实 payload/tree/file 读取函数；只替换之前的 npm/provenance 运输与后续禁止到达的进程运输，确实到达私有 `source-snapshot` 的 ENOENT。它证明**此前置满足后的候选校验拒绝缺载荷**，不证明完整旧 CLI 全程零作用，也不替代真实退休。

五域引用仅允许精确 candidate ID/manifest 配对命中的有限 rotation plan。实际匹配 plan 与 65 字节 sidecar 均重读绑定原 metadata SHA，核 hash 文件名、原生 payload/version/status、candidate 与实际 guard receipt；其它字段、prepared/publication/consumption/successor 命中拒绝。8 份旧计划及 sidecar 原位保留；既不要求它们仍有当前可执行 lineage，也不据此证明历史零作用。若其中任何记录再命中原 a3 闭包，collector 的最终交集检查仍拒绝保留豁免。

## 同调用与 reader 复验

新 proof 纳入最后统一 CAS：目录成员与身份、全部非秘密叶的 `dev/ino/size/nlink/mtimeNs/ctimeNs`、所有缺失载荷/Git 项、共享配置对象关系全部复核。plan/sidecar 继续受原五域 metadata CAS 约束。seal reader 复用前次已审的重新分类与最后统一 closure/archive CAS，不跨调用沿用本次摘要。

本轮独审发现并已闭合两处窄漏：已解码 source-binding envelope 起初未进入最终绝对地址集合，现与 manifest/普通对象一并检查后续扩展 alias；该 binding 的 sourceRoot 现同时进入新 residual 的 `requiredFixedSourceRoots`，由原 finalizer 拒绝未获资格的独立外部根。第二项只增新角色一项义务，旧 consumed return 未动；本案 11 项没有 binding，不改变其实际输出。

## 最小证据复用

[checks-2.txt](checks-2.txt) 原始结果为 4/4、exit 0、833.039 ms，涵盖两种有限形状与计划保留、引用拒绝、未知代码/载荷及迟到变更/链接与外部来源义务、真实旧 verifier 的缺载荷拒绝。第一轮正例夹具误复用 candidate 摘要到 predecessor，严格引用检查拒绝，原失败保存在 [checks-1.txt](checks-1.txt)；修的是夹具，没有放宽生产规则。

解码地址修正只重跑原第 1 项，[checks-3.txt](checks-3.txt) 为 1/1、exit 0、380.331 ms，覆盖 raw envelope 与普通对象，另 3 项结果复用。最后 sourceRoot 义务按主负责人要求静态核对并复用既有未知外部根反例，未新增检查。test-only opaque policy 只用于受约束私有 seam，不作为生产新字节资格。没有重跑历史矩阵、npm/构建、旧 CLI 或现场 collector。

## 本次真实只读结果

主负责人使用最终冻结 33 文件副本 `inspect-code-d1468c7b-6ba6-4565-a5d3-9b6dd41369aa` 运行一次既定只读组合。独审读取原始 `D:/codex-artifacts/s05d-residual-classification-20261023/inspect-b0a2ddc1-7453-4cbf-b580-eb1e7dd3ab88.result.json` 与 observation 的限定投影：实际 history/collector SHA 与上文相同；`readOnly=true`、`writeAuthority=false`、`complete/closureComplete/pinsUnchanged=true`。耗时 99.228 秒，collect 83.734 秒，closure CAS 12.937 秒。observation 为 11,090,085 字节，实际 SHA `cbdab9cbdaca750354df19a92d5ad4448b34b957af10a74d844f339da2cf0f54`，与 result 一致。

实际返回 11 项 retained residual、221 项 consumed history，8 个旧 plan 引用；`sourceActions` 仅 4 项：原 packet/source、`merge-20261022`、原相关 stage、原 source tuple 绑定的 f5 候选。`artifactActions=[]`，旧残留和 8 份 plan/sidecar 没有进入移动清单。该结果闭合了本次分类与只读范围问题。

原件仍明确 `retirementProved=false`、`productionWriterReady=false`。12.937 秒是 closure CAS，并非完整 archive 前像/轻 CAS 的协议预算证明；archive 兼容性与吞吐、控制采用、普通权限 writer、source-close 后 full boot、最终 observer/ACK/SEALED 仍由后续各自门禁判定。没有从只读通过推导这些步骤已通过。

## 后续只读前像的止点及采用顺序

已核主负责人随后一次 `snapshot-9a75927e-00d6-43f4-9ba1-e345ab5591a5.result.json` 和阶段原件，均在上述 artifact 根。它使用同一最终冻结副本、新取实际前像，明确不复用上次 closure 的哈希证明；`readOnly=true`、`writeAuthority=false`、`pinsUnchanged=true`。两处 Git 源各 9,654 叶、159,152,641 / 159,152,647 字节的前像已完成；原相关 stage 在第 49.337 秒开始后尚无完成记录，整个诊断于 300.043 秒预算终止。第四个候选未取得完整前像，统一 snapshot CAS 未执行完成，原件因此明确 `complete/writerReady/productionGateProved=false`。

这留下实际 archive 前像兼容性与吞吐准入缺口，没有产生结构拒绝，也不是生产 40/60 秒协议门禁的失败或通过。两处 Git 的局部完成结果不能替代同调用全部对象的前像与统一 CAS，不据此开始来源移动或封存。

本轮没有已知代码阻断要求把上述缺口或“尚未退休”作为新 reader 控制安装的前置。原顺序本就允许先完成控制 prepare/adopt，再关闭来源及执行退休门禁；因此可由主负责人按最终冻结代码、同配置、普通权限 handoff 与原生采用门禁继续控制材料准备/采用。该顺序判断仅适用于控制采用，不豁免后续移动、完整 archive 准入、full boot、observer/ACK 或 SEALED 门禁。

## 首次真实 handoff：native prepare 前拒绝

已对 run `c6be141b-9f7a-488a-9671-f97807c26458` 的原始 RUN、ATTEMPT、PARENT、直接 EXIT、完整 stdout/stderr 及冻结 host/runner 代码完成只读核对，索引见 [handoff-first-attempt.json](handoff-first-attempt.json)。本段只整理该次已有证据，没有重跑任务或检查。

RUN 实际摘要 `b3381f4f…1982e` 与各回执绑定相同；PARENT 为同 SID、session 1、medium 8192、非 elevated，摘要 `31581f77…fcb4` 与 EXIT 一致。runner 对固定 Node PID 40860 使用直接进程 WaitForExit，记录 exit 1、`outputComplete=true`；stdout 为 0 字节，stderr 为完整 92 字节，实际摘要 `fc375738…4035` 与 EXIT 绑定，仅报 `Runner task instance count is ambiguous / 0 !== 1`。实际 host `da1e08c8…c397`、runner `7ad4e67e…531c` 与 RUN 固定摘要一致。

可以确认**本次未进入 native prepare**，依据是完整绑定退出证据与冻结代码顺序：`executeHandoff` 第 78 行在 load、ordinary identity、unchanged、task definition 和 state 4 检查后，于 instances 必须等于 1 的断言抛出；第 83 行 STARTED 及第 87 行 installer 动态导入、`prepareControlUpgrade` 均在其后不可达。STARTED/RESULT/materials 缺失只作旁证，不单独据其推断未调用。索引记录控制配置 `a90c9b80…7642`、安装 `74724dfa…4b0e`、hook `582301cd…f987` 仍保持原摘要；尚无 native 完成回执。

原状态继续保留 `attempted-unknown-no-replay`，不得因已定位这一次前置拒绝而重放同 run。实例计数可见性根因尚未由本段证据证明，不降低 instances 门禁，不预先批准尚未发生的空 Task 诊断或新修复。该 handoff 阻断与先前 snapshot 300 秒未完成是两项独立事实；本段没有控制采用、来源关闭、重启或退休成功结论。
