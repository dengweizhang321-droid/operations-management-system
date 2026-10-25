# S05d：原位保留旧残留的有限分类增量

2026-10-23；基于 `c7f94a79`，补充[已审 R1b 规划](../s05d-retirement-implementation-20261023/PLAN.md)。本页只作规划；不实施、不现场扫描、不执行旧 CLI。结论是**可以新增独立资格，但只能证明这些实际残留不是需要移动的原 a3 本地来源，不能证明历史零作用或完整旧源码不同**。保留目录、旧计划、原 unknown 和原两个 decision；不新增清理、调度、身份、DPAPI 或 broker 工程。正常原生入口误用属于本协议，手工从 archive 恢复源码或自写任意脚本仍在原边界之外。

## 1. 适用条件：独立角色，不放宽已消费历史

新增 `retained-unconsumed-residual` proof/版本，接入 collector 的“非 protected、无实际 snapshot 差异见证”分支；全部资格成立才不加入 `sourceActions/targetReleases/targetManifestShas`。不改 `qualifyRetirementHistoricalSource` 的消费链锚条件，不按 11 个 ID、日期或 dispatch 白名单放行。

- 当前 native chain 已完整解析，残留不在有效链；manifest 原字节、payload 摘要、路径/releaseId 和必需来源字段有效，未声明原来源路径、tree、binding 或其 alias。tuple 不同只是拒绝误归类的必要条件。
- 只接受本次已见两种有限形状：顶层恰为 `.dev.vars`、`.runtime`、`audit`、`deployment-manifest.json`、`package.json`、`package-lock.json`、`tools`、`运行项目.bat`；`.runtime` 仅 activation fence；`audit` 为 helper-build、legacy-worker-guard、sales-retired-code 三份 receipt，或再加 `global-d1-retirement.json` 并配套两件已审 D1 工具。工具集合精确等于 manifest 声明集合，逐叶 SHA 同时匹配 keyFiles 和已审 history registry，BAT 同已审 launcher。其余非秘密叶有界完整读取、保存摘要，声明了 keyFile 的须核同；目录、文件角色及 manifest/fence 的原生绑定不能互相矛盾。拒未知叶、额外子层、reparse、未解释硬链接；`source-snapshot/dist/helper/node_modules/.git` 均缺失，祖先不得使其成为 Git 源。
- `.dev.vars` 保留原位，只按现有原生共享配置资格核类型及对象/链接身份，不读秘密正文、不拆链；它不是本地源码或载荷区别证据。若当前已审资格不能解释其对象关系，补该精确关系，不能因“其它 184 叶已知”略过。
- 复用 collector 已读五个 native state 域按精确 ID、manifest SHA、规范路径做引用匹配。仅允许 rotation plan 的 `candidate.releaseId` / `candidate.manifestSha256` 配对命中；有限记录资格核固定目录、hash 文件名/sidecar、已知 version/status/payloadSHA、candidate ID/manifest 及已有 guard receipt 的实际字节绑定，不另造完整 rotation validator，不要求旧计划具有当前可执行 lineage。原位保存并纳入动态证据；8 份计划不算消费。其它字段或 prepared/publication/consumption/successor 命中均拒绝此角色并保留原保守判定，不把 3 项域内未命中说成全机无引用。原 a3 的全部引用闭包照常处理；若某旧计划另命中原 a3，不能由本角色豁免。

## 2. 为什么不重造或消费原 a3

复用[历史入口语义审查](../s05d-retirement-implementation-20261023/HISTORY.md)及其全文 SHA registry；[本次归属证据](../s05d-history-candidates-20261023/ownership-evidence.json) SHA 为 `8fa856543b3a40d17839ced81f59275cc99879f116f703323bccce456323f3b8`，证明实际 83 工具属于这些家族，而不是由 manifest 推定实际代码。

**Producer：**残留没有完整本地 source/payload/Git 树；已审 Worker builder 从显式 source 或固定默认根取真实源码，实体前置不由 test flag 绕过，rotation 不会凭 manifest/旧 plan checkout、clone 或合成原来源。复用 `assertRetirementHistorySourceClosure` 的共同外部来源义务及 `qualifyRetirementSourceEntries`：原来源/alias 必须关闭，其余默认根、登记源必须缺失或有真实内容/完整 Git 成员差异；能重造 target 的入口仍受既有 ref fence/永久 target ban。planning 可记录同身份待关闭，after-close 不可。仅凭 manifest tuple 或不同 HEAD 不足。

**Consumer：**旧 apply/自动复用仍定位固定 plan/receipt/candidate 并核实际来源与完整载荷；保留计划和 manifest 不能补回缺失的 snapshot/dist/helper/dependencies。跨 helper 直接消费原 a3 则继续受原生全部旧 ID/receipt/候选封存闭包约束，不能把这 11 项的不同 ID 当成封存完成。复用已审具体家族的 native 前置证据；仅在缺少“这两种残留布局经旧 apply/复用拒绝”的直接证据时补一个私有原生反例，不运行现场旧命令。旧控制/helper 仍可能操作其它合法 runtime、写审计或准备其它来源，**本结论不是无任何作用**，也不新增此类操作授权。

## 3. 同调用 CAS 与后续 reader

新 proof 保存独立 kind、policy SHA、全部目录成员、实际已读叶摘要及 `dev/ino/size/nlink/mtimeNs/ctimeNs`、配置对象资格、外部源义务和引用摘要；可共享 history 的字节/外部源核验函数，不伪造 consumed binding。加入 `assertRetirementClosureUnchanged`：同调用末尾复核每层成员/叶签名、全部缺失项、配置对象资格及原五域 metadata CAS；不能只复核 tools 或 source-snapshot，也不跨调用用 mtime 代替完整摘要。

继续原“先关闭原 source → full boot → 最终盘点/observer/ACK/CAS → SEALED”顺序。boot 后、新 reader 每次完整重新资格化残留、外部源、引用、控制与 ref fence；复用 `validateRetirementSeal` 的动态 collector 和最终 CAS。新出现载荷/alias/引用、未知字节、原地址恢复或 full-boot 证据不足即阻断，不沿用旧 ownership 报告授权通过。现场成功前只能称资格实现完成。

## 4. 必要反例与交接止点

仅补直接增量的 2–4 项私有检查，可在四项中合并断言，既有未受影响证据复用：

1. 两种已知残留可原位分类，8 份形式的候选计划保留；增加 prepared/consumption 或非 candidate 字段引用后拒绝，原 a3 命中仍按原闭包处理。
2. 工具未知 SHA、额外源码/子目录、载荷恢复或新 Git 身份均拒绝；同调用读取后替换 package/audit/fence、加成员或改链接须由末 CAS 捕获。
3. 外部默认源为原内容或原地址重现时拒绝；关闭/真实差异可满足义务；相同源码仅换 commit/日期不能通过。ref fence 失败或无关闭后 full boot 时不能 seal/read。
4. 若既有证据未覆盖残留 consumer，用已审实际家族在私有根证明旧 plan apply/自动复用不能在缺载荷时消费该候选；失败若发生在其它未满足前置，不能冒充载荷门禁证明。

若出现具体旧 helper 能从某正常地址重建原 a3，或能以保留计划绕过完整候选校验，应报告**确切文件 SHA、入口/参数、首个可达原作用与缺失门禁**；最小补证仅是该家族/该地址的源码顺序和私有反例，不泛断永久不可能，不扩全平台/PID审计。本页交 Sol 实施，完成后原 Sol 独审增量；通过即交 root 继续 S05b 控制采用与现场准入，不安排例行二次规划。
