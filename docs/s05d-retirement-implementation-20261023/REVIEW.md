# S05d R1b 实现独立审查

2026-10-23。请求角色为 `deep-review / gpt-6.1-sol / xhigh`，局部用于结果未知、并发、跨重启及旧消费边界；工具未独立确认实际底层型号。审查上下文未参与方案与实现，不转派，不修改被审实现，不执行生产动作。

## 当前判定

**只读入口与冻结包检查通过；真实完整闭包拒绝，完整写者未就绪，S05d / S05b 保持 blocked。** 按用户最新“简单的工具审查和只读核验……简化”要求，复用既有结果，不新增矩阵或资格家族；不追加现场 archive 全量哈希。原 unknown、原 target 禁重放保持。

冻结清单 `current-handoff-pins.json` SHA `cc573e60ea16b77a2695e85d540cf1c3c9598ea99ddd0655126ac8058528c099`，其中 22 个工具 rawSHA 已逐项核同。collector `591265c9…bf4f` / core `7cbf5677…516d`：缺根只返回 null，无跨调用缓存；稀疏探测有界且无见证不判 different；live Django 在别名固定点后再核；live manifest、bootstrap/root marker 和 config 原件进入 metadata CAS。只读 context 仍为 writeAuthority=false，未进入锁、intent、ACL 设置、move、queue 或任务写入路径。

复用实施者的 collector 定向 5/5 与私有 integration 1/1，未重复运行：后者覆盖观察失败后同 intent 的新 epoch、成功私有 reader、缺 resolution 续接及原 unknown 保留；OS boot/token/chain/CIM 是明确替身，不能当生产退休证据。实际 32 成员冻结包 4/4、1.502 秒的原始输出及摘要已核同，依赖/五入口 fresh import/help/缺成员拒绝均通过，bundle `cd2ba86d…1386`，未重复整组。

仍有明确边界：完整现场清单与范围、archive/轻 CAS 吞吐及原生写者/退休门禁未闭合；当前 reader 在全量档案哈希后未统一重核 closure 与此前已哈希档案的 stat 一致性，末尾只重核 native/control/original。该一致性缺口已交回，不能把静态私有成功当完整写者就绪。本次仅做工具审查与只读核验，不执行控制采用、退休封存、应用发布、新生产 dispatch 或身份/DPAPI 改造。

最后一轮真实只读记录 `inspect-b397213c-a15c-4761-a070-4f4b63a7c13f.result.json`：**54.497 秒拒绝**，486 个阶段事件，源码 pin 前后不变；未产生完整 observation，CAS 未执行，无生产写。阻塞在 `preparation-retirement-entry.mjs:70` 的 `Frozen source identity reader changed`：已知 publisher `228e1512…2063` 需要同根 `tools/frozen-main-source.mjs` 匹配已审 guard `c0b4f216…b882`。负责人随后仅定位固定小叶，2.680 秒读取 3,112,334 字节；规范去重的 22 处实际 guard 均为 `b4bb57dff7a659a94520bc592e0f42b026d5b2a4def4dacfb928e8635f21f9c6`，未在本轮已审 guard 表内，首例 `D:/codex-isolated/auto-wake-control-c36ea996/source/tools/frozen-main-source.mjs`。证据 [source-guard-rejection.json](source-guard-rejection.json) SHA `699f5aae…a1e3` 已核；25 原始行含 slash 表示重复，510 是输入表示数，不是唯一根计数。未将新 guard 扩入资格，不宣称文件损坏，不再重跑。

## 启动与范围

已按共享 Obsidian memory 启动协议读取相关偏好、工作流、项目记忆及现存最近复盘，完整读取本 worktree 的 AGENTS、README、开发与交付、任务模型分工 v3、架构、前端、安全、运行及发布门禁；读取前轮可行性 PLAN、FEASIBILITY、REPORT、REVIEW 及 S05d/S05b 当前施工约定。基线 HEAD 为 `6d8efc50`，main 基线为 `36668589cab03d5d2d9d98383fb58eeb19c391ee`；未 fetch 或推进 main。

审查采用本案原 target/source/工件闭包，不要求禁绝全机旧代码。当前 405 immutable helper 仍可读可执行本身不是 R1b 的否决证据；必须判断它能否按原受支持参数继续产生或消费原集合。主动恢复封存字节、修改 argv 指向 archive 等超出约定误调用模型。

## 首批 A：旧 Django 私有边界

独立读取并运行 `node --test --test-timeout=60000 tests/preparation-retirement-boundary.test.mjs`，PS5/PS7 共 **10/10 通过，exit 0，9.67 秒**。原入口脚本 SHA-256 为 `65f057297208b32ac6d3c2e71a12016b1fd4afdc0ed7ea455fbda13181fffb61`，与前轮冻结 a3 的同名原件 pin 一致。测试和 wrapper 当时 SHA 分别为 `0434402639a183f2a5128be45f687d881ce3f0226ec797bde4b933a4c11f980d`、`3e2a15189b93802c19198becd536dd406766539aa45fb7cd0bd6b2619918a15e`。

以下结论限于真实旧函数固定寻址及前置边界：

- installed-app 的真实 CLI 自拒 PrepareApp/DeployApp，未增加 candidate。
- 原 366 source 的 Prepare 可到达复制边界；既存但遗漏的 366 alias 在主 source 移出后仍可到达该边界，证明 alias 清单不能省。
- 405 helper 的 Deploy 本体可按旧 id/hash 消费 366 candidate；调用源码不同并不会使旧候选自动失效。
- 将原 source 与固定 app.deploy-id/app.prepare-id 两件移出后，原 source 调用失败，405 helper 对旧 id 的 GetPrepared 原生 PathNotFound 拒绝；其自身候选 Verify 保持可用。

私有 RuntimeRoot 在 parser/函数寻址中贯穿。原 Assert-ProductionMaintenance 对非生产 RuntimeRoot 原生返回，停止/树/installed-binding 前提由明确替身提供；Prepare、Deploy、GetPrepared、Verify 本体保持原字节。所有写入限测试创建的临时根，无生产 fallback。此证据不是完整原生维护/部署/启动测试，也尚未证明现场 alias/消费闭包已完整。

已反馈实施者补足 Worker bound-source、explicit reuse、自动 prepared cache 及无 id Deploy 自动 Prepare 的直接边界材料；未将首批 10 项通过提升为 A 全门槛通过。

随后仅独立运行新增边界 `--test-name-pattern='no-id Deploy|old Worker'`，4/4 通过、exit 0、1.96 秒。真实旧 Deploy 的无 id 分支调用 Prepare，夹具只替换 Prepare 结果以确认其 ExecutionRoot 仍为保留 helper 的 source；Prepare 源码实际取同一 ExecutionRoot/backend，不能把此项说成完整 Prepare 成功。原 Worker reader 对缺失 bound source 原生 ENOENT，候选 verifier 对已移 manifest 原生 ENOENT，未调用 predecessor callback；没有回退到其他 source/candidate。explicit plan 与自动 cache 的完整读根对应仍待正式 collector 材料闭合。

## 再入早界：待实现检查点

基线 `observeLatestMain` 只 fetch/read 并返回目标与 packet；真正 `mkdir/worktree add` 在 `prepareLatestMainOnce`。原 queue 的 target ban 位于 observe 后、once 前，不能误报为 queue 已在禁重放之前重建来源。实际应补的路径是固定 CLI 的 `--check`/普通 deploy 经 `prepareLatestMain` 直接 observe→once，以及导出的 once/reuse 入口。新实现须在任何来源冻结或恢复写入之前拒绝已退休 target；仅证明没有新 DISPATCH 不够。已将这一精确调用图反馈负责人，等待新代码和对应反例。

## 已读现场投影的有限线索

审查者只读负责人采集的 `candidate-metadata.json`，没有重复查询生产。该投影中 `20261022T071208Z-f5db87473edebc45` 的 manifest 明确绑定原 a3 packet/source，sourceTree 为 `abe18170a70b35e845660f8b01eb7d20c8946b4dace28a6ed66d55c462e164db`。它与前轮 `fca7de7a…` staging 均须纳入本案来源/引用闭包判断。字段检索命中少不证明没有其他同内容或未标识对象，投影本身不证明完整性、未消费、可移动或退休。

## Collector 草稿首读：待增量闭合

首读发现并交回实施者处理以下关键问题，保留发现理由；修复与增量结果见本节末：

1. 原来源命中 `app.previous`/rollback 不得按未消费候选直接搬走。它是已发生采用或恢复引用的冲突，须离开本有限分支；缺 manifest 的 rollback 也不能冒称未消费原工件。
2. post-close 的目标来源集合须保留所有冻结的原 alias。草稿只从当前 Git 注册和原 packet 建集合，已移动的 merge alias 会丢失；原内存 actor 在 close→boot 间从该旧址产生的 Django candidate 只声明此 sourceRoot，可能漏判而在下一维护被旧 helper 消费。修复需将闭锁清单的原址/身份持续纳入判断，遇新可执行 alias 保持阻塞。
3. staging 的 `native.api.validatePayloadSha?.()` 是未导出函数的可选调用，原来并未校验 fence；不能靠不同 fingerprint 声明就排除。须严格验证真实 schema/payload，并核实际 source/snapshot 的区别，未知 partial 保守处理。
4. 所有保留的可执行 Worker snapshot 需要实际字节区别见证或绑定其实际完整性的有效原生证明，不能只信 manifest/fence 声明。缺文件或不完整成员不能单独证明不同来源，因为也可能是原来源 partial。

collector 本体读取固定根、Git 只读命令和原生 chain；草稿输出仍不具完整闭包资格，不能据此建写 intent。隔离 collector 验证须显式使用全体私有根，不能只替换 Worker 根却回退生产 Django。负责人采集的普通 Git merge worktree 归属材料按原生注册/元数据和本轮来源封闭授权审，不因没有聊天归属推定受管，也不以 caller 自填 authority 替代实际分类。

增量已将上述 rollback 冲突硬拒，冻结 origin/destination 及子 source 纳入后续 provenance，严格本地 fence payload/schema 校验，并对所有保留 snapshot 使用实际存在叶的 SHA 不同见证；缺叶不排除 partial。另修正已关闭 Django candidate 的 receipt 必须在当前与冻结 sourceActions 联合集配对，并持续追踪其 manifest SHA。archive Git 注册仅按冻结映射跳过，不作为可重新执行的搬移源。

独立运行 `tests/preparation-retirement-collector.test.mjs` **7/7 通过、exit 0、13.41 秒**。全体根均显式私有，绑定 parser/chain 为已声明传输替身，实际执行旧 producer 文件 pin、原生 Git worktree 与真实文件读取/移动；覆盖上述拒绝与重入条件。collector 当时 SHA 为 `3b9e3aa56b5ffda194efc9f51a7800db3412ca29afb3a787a5c171b4a97a111a`，测试 SHA 为 `c164b37b431c47a912145590a4f7809e2c996e25b35aa5de9d961b818472a645`。这些具体发现已在该增量闭合，仍不等于完整 ledger/CLI、实际现场闭包或退休通过。

后续新增 pre-adoption `inspectRetirementClosure` 只读入口，使用原完整 adopted reader 及固定 native，`writeAuthority=false` 在 writer 取锁前拒绝。已独立确认其不建 INTENT/actions/queue、不改任务或 ACL。负责人对 collector `71576d9a…543c`、native `a501105c…3cd6` 等六叶冻结字节作一次有界实际兼容检查，1.687 秒拒绝；已读取外部原始 result。旧 successor512 namespace 未公开 `hashRelativeFilesWithInventory`，没有取得完整闭包，也没有生产写入。此实际 ABI 缺口由实施者修复新工具适配，旧 native 不得被修改或伪造导出；七项私有替身测试不能代替该真实 ABI 资格。

新增 `preparation-retirement-source.mjs` 明确作为本工具自有受控 streaming hash/inventory，保持原 ordinal/path-length/content 协议，并双绑原 sourceBinding 的 tree 与 inventory 摘要。native loader 改核完整实际公开 ABI、固定四根与 Django 根，未改原三件 native。独立 `preparation-retirement-source.test.mjs` **1/1 通过、exit 0、0.15 秒**：将精确三件旧代码复制到私有根，仅调用公开纯 hash，与新 helper 在空叶、Unicode、超过 1 MiB 分块上结果一致；拒多链接/越界，未调用实际 runtime resolver。collector/native/source 当时 SHA 分别为 `4a6f4ef3…89baf`、`e277a6d1…3d245`、`47747f6d…2b279`，具备一次实际只读兼容再采条件，完整现场闭包仍待实际结果。

已读取负责人第二次有界实际检查原 result：54.362 秒在 packet 目录角色分类拒绝，`complete=false`、`retirementProved=false`，没有生产写入。负责人随后仅枚举 60 个 packet 的直系形状定位普通 invocations/logs/schema 与一件既往 Pi 失败证据目录；最终处理须依据真实生成器/reader角色，不能靠名字全放行，也不能把无 Pi 的 a3 扩为全机 Pi 退休。该 packet 兼容增量仍待复审。

## Archive 叶的必要验证

独立读取固定 archive/private ACL 与硬链接断开代码：新临时叶在仍为空时设置并核验精确私有 ACL 后才复制字节，不修改原配置对象；只接受 native manifest 声明的两个 `.dev.vars` 角色、固定 base dev/ino/字节，未知多链拒绝。directory/file inheritance flags 已分别严格核验。

独立定向运行 archive ACL 与同 base 双叶例 **2/2 通过、exit 0、11.75 秒**。两叶依次断链后均为 nlink1、原字节保持；私有 base 后续改变，同 intent 重入仍保 archive 原字节。第一叶引起其余 base/link 的合法 nlink/ctime 变化未被误当篡改：角色绑定不固定旧 link count，每叶开始时采其前像，最终文件元数据在全断链后采。没有触及真实配置或生产 ACL。archive/test 当时 SHA 分别为 `d4793e88…5def`、`096f8e67…6aac`，更细中断与完整 core 集成仍待补。

## 固定普通权限 handoff

负责人已确认当前工具 token 为 high，不能直接执行 ordinary writer；新适配仅提供固定 control-prepare/control-adopt/plan/close-sources/seal-after-retirement 五阶段，不开放任意命令、argv 或外部 proof。已读审 RunLevel0/InteractiveToken、同 SID/实际 medium、自有 Task 定义 CAS、精确代码/config/intent/native 回执、原完整 adopted reader、冻结环境白名单，以及 ATTEMPT→PARENT→STARTED→RESULT→EXIT 的身份/创建时间/PID/阶段/SHA 交叉绑定。首读发现的简化 adopted gate、环境及完成绑定不足已由专责叶修复。

对冻结 mjs `34101ac9…13f1`、runner `ba42a17a…4953`、test `a3f8b255…ca52` 独立运行 `preparation-retirement-handoff.test.mjs` **12/12 通过、exit 0、5.30 秒**。包括真实 PS5/已知 D 盘 PS7 parser、SID 拒绝、真实 EncodedCommand/CIM 传输和内存 COM Task 定义；没有注册或启动计划任务，没有执行 native writer。早期专责叶使用 ProgramFiles PS7 路径缺失而跳过的结果不冒称 PS7 已跑；本轮实际 D 盘宿主已覆盖。

随后发现 logon 触发可能早于 Explorer，专责叶增加仅 seal-after-retirement/afterLogon 的 Stopwatch 30 秒等待窗，owner 不可读仍立即拒绝，普通 demand 不等，ATTEMPT 先消费且不重试业务。已独立读审并只运行新增 `logon Explorer admission`：**1/1 通过、exit 0、1.35 秒**，真实 PS5/D 盘 PS7 中只替换底层 CIM/owner 与超时测试时钟，覆盖 Explorer 迟到、demand 不等、owner 不可读及期限到期。

当前 handoff mjs SHA 仍为 `34101ac94dcc69a8127f12310950042f2df76388b7057b6a5e007b46527713f1`，runner 为 `7ad4e67e94fcdf5996dc2a962045e6f1d10ba6a1a0337058b211dea5312b531c`，测试为 `ee75fe67ef97caabc5d15b7c8928b9ffba28ff7a571390b73912f4bd948e6764`。叶级必要检查无遗留阻断，复用前 12 项加此单项，不冒称 13 项全重跑；仍待最终 core API/observer/包闭包集成，不表示实际普通 Task 或 writer 已运行。

进一步实际只读一个固定 OS 宿主叶发现：System32 `powershell.exe` 为原生 nlink2，495,616 字节，非 reparse，realpath 一致。handoff 原通用单链接 reader 会使 prepare/load/parent 路径拒绝，早期私有例未覆盖此角色。已修为无参数、固定 System32 路径的 OS-host reader，保留路径/祖先/句柄/全 metadata/SHA 稳定校验；其他代码、RUN、材料仍严格单链接。独立新增定向 **1/1 通过、exit 0、0.11 秒**，实际 OS 叶仅读与私有双链代码拒绝均通过。当前 mjs SHA 为 `da1e08c8b1d8b0adf2285c5a3d31f7dce4c3b2ff35a05e4f3b375c302111c397`，runner 仍为上版，测试为 `d7755418c8987d9c800b7712992f41e6aa3275d52ca85fd34233a1f1ae989af6`。此实际兼容阻断已修，复用 12+1+1 各自绑定结果，未注册/启动 Task，整体集成仍待。

## 原生 boot collector 兼容检查

独立只读核对 `collectFullBootObservation` 的固定调用链：PS5 只读取 MachineGuid（仅输出摘要）、CIM 启动时间和两个 provider 各最多两件系统事件，不调用 reboot/seal/queue/任务写入。审查时 boot 模块 SHA 为 `096845b4efd8d90be86f5bb6ccfe8ba6b932f6ea58539fb01b7b8e0634424aad`，taskPowerShell 模块为 `9f05dedcb953fec984d9c6ee3938a6254f7d5875bbe43018ff88869264c7cb62`。

主负责人随后对该字节执行一次真实只读采集，PS5 报事件 XML 不能绑定到 System.Int64 的 Id，未产生完整观察。错误指向短名 `H` 与 PowerShell 原生 `h=Get-History` alias 的解析冲突；它是实际兼容发现，不能据此放宽 XML/schema 或冒称已取得退休凭据。修复与增量复核待补。当前 boot 无论采集是否成功，均不晚于来源封闭，不可作为本次退休证明。

增量已将两个短 helper 改为唯一长名，固定现场实际 provider GUID 与 General12/schema0、Boot27/schema1，重新从 raw XML 导出字段并与 JSON 投影逐项比对。新模块 SHA 为 `e00fe4ee68faff34b82fbe94317f56e1feb6908fb6f9c7cd40a19ee7fa9da133`。独立运行 `tests/preparation-retirement-boot.test.mjs` **4/4 通过、exit 0、0.53 秒**，包括保留原 h alias 的真实 PS5，仅对注册表/CIM/事件传输使用私有替身，以及同 boot、混合启动、缺事件、跨 host、重复记录、未知 schema/GUID 与投影伪造拒绝。该增量具备一次实际只读再采条件，尚不表示真实新 boot 已出现。

负责人随后按该 SHA 真实只读再采 exit 0。已独立读取 [native-boot-parser-check.json](native-boot-parser-check.json)，并核外部 5,567 字节观察 SHA `4e9560bbd8bc6486030a88d036028e6158382df669c8934b7facf4f82916a7db` 相符。当前 boot 为 `2026-10-17T14:43:44.5000000Z`，`retirementProved=false`。本项只证明实际 parser/传输兼容，首轮失败保持；没有重复采集或真实退休结论。

## 后续 collector 原生兼容增量

在 `92c07d3b…7277c` 增量独立只运行新增两项私有例，**2/2 通过，exit 0，2.88 秒**。原生 packet 的 invocations/logs/schema/Pi 诊断按实际生成器的有限角色分类；3 MiB 日志正文不读取，FAILED、invocation、进度保留原位，真正的 worker-plan 仍收集。未知目录及本案不允许的 Pi 诊断在昂贵来源摘要前拒绝。原第二轮 54.362 秒失败仍保留，不把分类修正说成现场闭包通过。

负责人第三次实际只读检查在 1.921 秒拒绝无 request 的既有 packet；只读形状材料显示 12 个，分别仅 source 或 source 加空 schema。原 Once 先创建并锁定 worktree、再形成 request，故不能据缺 request 推断零作用。`356da7e4…f5e3b` 的严格 pre-request 分类独立新增 **1/1 通过，exit 0，2.38 秒**，source 仍进入 Git/字节闭包，未绑定 schema 仍拒。审查同时发现已移动 source 后重入会只剩空 packet/schema 的兼容缺口，已要求只凭 frozen closedMap 接受该状态，不能接受未冻结的缺源。

负责人第四次实际只读检查在 3.155 秒拒绝原发布租约。原 418 字节 SHA `d3eb87756b424e3175df710913c408e0839dd2ee060b67dd51b9a5f656199d5c` 保留原位；旧生成器及服务明确把它用于过期的 advisory hint，并不能证明退休或未产生作用。`560de4831aca746384b8604c25a16e2fae5f1cdcc7e7a39465dc25f6feb4c73c` 仅接受原 target/out、固定 v1/18 分钟 TTL、有限 prepare phase 的过期角色，保留 raw/SHA，两个 retirementProved 字段均 false；active/foreign/unknown 拒绝，不删除或归档原租约凑通过。独立仅运行此项与 pre-request 关闭后重收两项，**2/2 通过，exit 0，5.34 秒**。

后续实际 packet metadata 属性统计为 930 件/1,901,151 字节，加 2,390 件原 native metadata 已超过此前共用 3,072 叶限额。按实际两个域拆分预算具有依据，仍待与 Git 差异叶见证、同调用原摘要复用合批审查。仅准许下一次独立只读诊断采用 120 秒截止、512 MiB heap 和持续 RSS 观察；该调整不改变 writer/observer 的动态 60 秒门禁，也不把超时或 incomplete 当作成功。

上述合批在 collector `ea1bba1d3ae03b31c5462668a1cd52884779e511b098512549528f139d330621`、source `9edd123d29daba63921e994750c0ea11cdf9f2beacaf36d198d25c9352c56d47` 独立新增 **3/3 通过，exit 0，7.76 秒**。Git diff 仅用于选取实际存在的原 inventory 叶，仍以实际 SHA 不同作为证据；added-only Git 来源另须完整 clean/HEAD/tree/非 sparse/完整 committed members 及实际 extra 叶，不能据 partial 的缺叶排除。原摘要只在本次调用内复用，并重核完整成员与每叶 dev/ino/size/nlink/mtimeNs/ctimeNs；真实迟到修改 package.json 会拒绝。未变的其余五叶 pin 已核对。

负责人第五次实际只读检查在 46.934 秒拒绝受保护 immutable release 的来源不能区分；已读原 result，`complete=false`，无写。该失败须先定位具体 release、declared 原因及实际可比字节；目前 snapshot 搜索仅原 request/固定 priority/64 个叶，存在尚未取得真正区别见证的可能，不能直接判整个方案不可行，也不能信不同 manifest 或缺文件就放行。

随后原生有限形状投影确认原 dispatch 锚定的 protected history 为 262 件，其中 221 件已无 source-snapshot；bootstrap 为最早 `20260829T194525Z-9a33f178481e6c8e`。其 manifest 仍声明 snapshot，故不能据缺目录单独推断来源差异或退休。按实施者给定的固定小源路径只读相关函数（未执行工具），确认 bootstrap helper 的 `listGitSourceFiles` 使用 Git 且无 fallback，显式原 source 的 `assertNoReparsePoint` 在 runtime marker 写入前。另发现并已反馈：支持的 `--allow-test-runtime-root` 会跳过固定 source/runtime 限制，旧实现没有 true 加生产 runtime 的独立禁令；因此有限家族资格不能声称所有参数只能使用 combined。仍须以原来源地址实体关闭、全部支持 alias 闭合、原 artifact ID 失效和真实 boot 的组合判断，本身不要求删除该历史 helper。

完整不同来源副本还可能带有旧 `publish-latest-main` 等生成器。其受支持 CLI 若能重新 freeze 原 366，必须闭合；若已有 controlProtocol/expectedBundleRoot/代际门禁会原生自拒，应以实际代码证明，不能只凭一个不同文档叶就遗漏此入口。审查未把任意自写导入内部函数当作正常旧 CLI，也未把此疑点无证升级为不可行。

来源入口投影实际覆盖 141 个 Git 树及 41 个保留副本。独立核 15 个 latest-main 与 8 个 publish-main 唯一版本代表字节 SHA 后发现：多件旧 latest-main CLI 无 controlProtocol/代际门禁，直接 JSON.parse config，新增 config version 字段也不会让它们原生自拒。15 版都使用同一 target/predecessor 命名和 Git `worktree add -b codex/manual-main-…`，没有 force/改名 fallback；保留原分支只能证明当前同 predecessor 的原生 fence，不能以通常 main 先推进来证明永久关闭。其它合法 helper 可能在 main 仍 366 时改变前驱，故该边界必须补原生约束。负责人已选择仅针对 native manual-main 命名空间加完整 target SHA 的 prepared reference-transaction fence，待真实私有 Git 反例、hook 实际有效路径/完整性、bridge 持续性及后续采用保留审查，尚未作为已实现结果。

8 个 publish-main 版本则均读取控制根父目录的固定 request，并使用自身来源（或已知续接固定源），在原生制品准备前要求 Git HEAD 等于 request.mainCommit 且 clean，未见 fetch/clone/任意 target 入口；新一版通过原 `assertFrozenSource` 校验。此结论不代替其固定续接源/相邻 request 与原 closed set 的配对核验。

独立复用 `history-top-tools.json` 的 16 个 worker 唯一版本代表路径，核实际全文 SHA 与投影相等，并审来源选择关键闭包，未执行 helper。16 个 `assertNoReparsePoint` 函数均同字节 `40d8d772…97b62`，默认缺源拒绝并核祖先/realpath；16 个 Git 来源枚举函数均同字节 `10c24d5a…cc5bb`，无其它来源 fallback。CLI deploy 均显式必填 source-root；其余 15 个 deploy/candidate wrapper 仅向同一 builder 增加 publicationMode。四类 guard 都在首次 runtime marker 写前核 source 实体，最后 bound 家族还先核绑定 root/完整 identity。此有限结论覆盖显式已关闭原址的写前拒绝，仍以全文 SHA 资格为前提；不扩大为所有业务语义已审。rotation 的旧域/cache/无 id 选择与其它 batch/控制入口仍须本案范围闭合。

## 新入口的来源写入前门禁

独立读审 `publish-latest-main.mjs` 调用图与 admission：pending retirement 在 fetch 前拒绝，原 target 在 Once 创建目录/worktree 前永久拒绝，queue selected/CLI/check 路径同样经过早界。独立新增 admission **3/3 通过，exit 0，0.147 秒**，包括坏 seal 不能绕过 target ban、缺 ban/未知 registry 成员拒绝。此项证明早界位置；完整有效封存的后续准入与 resolution reader 仍待最终实现，未借占位 reader 声称成功。

prepared native fence 最小增量已独立 **3/3 通过，exit 0，3.658 秒**，前后 SHA 一致：ref `66b61d6355bb6940ee7f0af3b7799b8b0d318a9ef08ea081ef0d005f19197f68`，hook `34aab4f4cbfb9f501081a680d12614d072a86c96be0842bef2c832892e4c88e5`，test `b31ba2f513d203c71c19d27750c8ad4d80c7da92456ddfa6192a49713511d1a8`。测试先真实创建原 native branch/source，再 move 并 lock 保留原 branch；真实旧 `4623c8e6` 函数配私有 live 传输，在前驱变化后无 fence 仍可重新 checkout，装新 fence 后 source/branch/Git 注册均未产生，原 archive HEAD/branch 保持。普通 codex 开发分支从同 target 创建及 committed 委托通过，prepared 不写 queue/controller/evidence。Git hook/config/env 全部私有，未执行生产 fetch/CLI。完整有效 hook 路径、bridge、采用及防降级仍待集成。

对后续回退入口另读审 `installer-entry-projection.json`：15 个唯一字节含本轮草稿，14 个旧版为 5 个直接安装器及 9 个 prepare/adopt 版本。它们均先读 config，再原生要求 core.hooksPath 为空；直接安装器在 guard 前无 fs 写，prepare 在 guard 前无材料写。9 个旧 adopter 均先做 installation rawSHA CAS、再首个 mkdir；resume 只接受四键 v2/installing/同 intent，不能接受新 adopted v3。显式绑定同一实际 common/hooks 的 hooksPath 可利用旧 guard 拒绝新的旧安装调用；绑定前材料还须由新代际 rawSHA CAS 拒绝，已越 guard 的在途进程须在绑定后的原生完整 census 中闭合。config 原文可能不变，不能把 config preimage 一项当全部证明。尚未修改生产 Git 配置，仍待有限原生私有反例与最终实现。

控制小批随后独立 **3/3 通过，exit 0，8.459 秒**，前后 installer `eb7b2b10…7192` / dispatch `3dae7ceb…25a7` / admission `dd53e7c0…1c24` / ref `f7f4ceb0…ffa6` / test `f06f8371…33e8` 相同。真实旧 direct/prepare 在等价但非空 hooksPath 下写前拒；真实旧 adopter 对 stale installation 及越旧 guard 的 old-config 材料拒绝。新实际 prepare/private adopt 覆盖 null→同一 hooks 目录，绑定先于新 CONFIG，保存原配置字节，并在 S4 主动抛出停在 census/Task 注册之前；不把此项称完整采用成功。shell 新增 prepared namespace 预滤仅定向再核 native fence **1/1 通过，2.140 秒**。当前未改生产 Git 设置。

负责人的实际只读 hook 基线已核 effective path 等于当前 installation 所指 common/hooks/reference-transaction，core.hooksPath 未设置，只有不影响取 hook 的 GIT_PAGER。合法 extensions.worktreeConfig=true 无需关闭；后续须核本次 config.repository 的实际 effective/local 路径与同一 hook，不以关 extension 凑通过。

## 历史缺 payload 叶的隔离检查

有限 history registry 与实际投影逐项独立比对为 19 名/104 全文 SHA，无多漏；16 个 worker 的固定根逐项等于其真实源码常量。首读发现 manifest 缺 root hash/fileCount 可被当不同身份，以及移动后的 archive Git 注册会被误当可执行来源，两项均已修复。module `a6a8f03c…dc6c` / test `d8eee7c0…92c9` 独立 **6/6 通过，exit 0，0.728 秒**，含原前驱 prefix、unknown code/原 tuple、缺身份字段、严格布局、实际叶变化、close 后来源重现，以及真实私有 Git move 后仅精确冻结 archive destination/身份/HEAD/branch 可复用的正反例。它不是把缺 snapshot 当成零作用或来源差异。

随后叶增加读前字节预算、实际 single-link 及同次工具/launcher/manifest stat 签名交付，供 final ACK 后轻 CAS；补齐 hash 返回签名的 nlink 再检查。最终 module `1bcc7c965127e74116f7a84608251a83cce18eb76a7b6be9c8e1376398961ea2` / test `4079c2a171675a51ff9f7808c2bbde74ad016ea420dda096b60ed26eacdfdb16` 独立仅运行三个相关增量，**3/3 通过，exit 0，0.219 秒**，原六项未受影响结果复用。详见 [HISTORY.md](HISTORY.md)，独立读核 10 个 rotation 代表全文 SHA 和固定消费域/来源取法与其说明一致，叶级无遗留阻断；collector 的最终集成尚须闭合，不能据私有成功提前宣布 221 个现场 history 已过资格。

## 完整协议仍待审的闭合点

- 真实完整 closure 被未资格化 guard 阻断，尚无可据以执行的具体来源/制品清单。
- 首 move 前全量前像与完整 CAS、两轮独立完整观察、ordinary ACK、40 秒/60 秒原生吞吐与运行门禁仍缺真实证据；私有 parser/集成和包加载结果已按当前判定复用。
- 当前 reader 全量档案哈希后的统一 closure/全部已读档案 stat CAS 仍未落入本轮冻结版本，不能宣布完整写者就绪。
- archive copy 已写而 prepared journal 未落盘的中断目前作为未知临时物保全拒绝，不能笼统声称所有中断均自动幂等恢复；已 journal 的安全重入能力按具体阶段分别核验。

core 前像小批已独立 **4/4 通过，exit 0，1.290 秒**，当时 core `91fb5d7b…51c4`、archive `833619ec…0abe`、collector `801b4d1e…2ba9`、test `8b00a129…14ef` 前后相同。所有完整前像先于首 move；native eligible members、HEAD/registration、clean/ownership、junction 和原 producer 叶再核，随后逐目录成员/逐叶完整 stat CAS。第二源未知硬链、迟到 producer 改动和 production test root 均在首 move 前拒。独审另发现重核误把 ordinary alias 自认 originalSource，已修为真实冻结 origin；真实普通 merge preflight 及迟到未跟踪所有权标记反例通过。

archive/core 的两处重入增量独立 **2/2 通过，exit 0，26.006 秒**。真实私有双 hardlink 断开后，final/witness/reader 的完整 clean profile 一致；base 后变不改档案字节，同 intent preserve record/evidence ref 不漂。实际 copy 的三个中断点分别验证：sync 后尚无 prepared journal 保全临时物并 unknown 拒绝；prepared 和 replaced 已落 journal 后可同 intent 收敛且字节不变。archive `e87f06b7…53f6` / test `7709037e…e0a3`；实施者确认运行期间相关 archive/preserve/ForTest 函数未改，仅无关 final 草稿继续施工。测试入口在 transport 前核全体 Temp/runtime/vars 根，无生产故障参数。

fs 重入原先即使 result 已 durable 仍返回新 at/reconciled，会使 ARTIFACTS-CLOSED 的引用自变，已修为验证后返回原冻结结果。仅对应 native Git 例独立 **1/1 通过，exit 0，1.195 秒**，fs `3fac306a…6113` / test `fabfacc9…a257`；原 refs、归档 HEAD/lock 和字节仍保全。core 完整 observer 失败后新 epoch 重入仍待集成验证。

独审同时交回并跟踪修正：final proof 不能保留已断开链接的旧 qualifiedLinks 而 reader 用空 profile 比对；只读 seal reader 也须重核实际有效 ref fence，不能只信 retirement marker；writer 的重启后 ordinary token 证据须与本轮 epoch 对应。最后完整 proof/轻 CAS/60 秒实际写前校验和成功 reader 仍未整体通过。

后续 reader 兼容边界已按调用图核对：reader 使用 inspection context，仅查 preparation Task 定义，不要求它 idle，也不重新执行本轮封存的全机 controller census；因此不能因自身 consumer Task Running 就拒绝旧 resolution。当前 boot 允许晚于封存 boot 的正常完整重启，同机 source-close 后及 bootAt 不回退即可，未要求等于旧 epoch。历史原 lease raw 仍保在静态 proof；其它 target 正常覆盖/删除 advisory lease 的有限 reader 兼容增量仍待提交，不能让 writer strict gate 顺便放宽。

两轮 witness 证据绑定叶独立 **4/4 通过，exit 0，0.264 秒**，module `4018bb6a61f336ae5c77c34a9c7c642b663b242e09deda56cea0e34c9edf5ab8` / test `b217a022da8705d00ab69769986ee9824f9b4f2cb6f581b229fcf328944ee62f` 前后一致。稳定 boot fingerprint 与不同 sample 时间可以共存；同 PID 换执行、复用同 observer、非规范 attempt 路径、最后 60 秒过期及当次 seal writer 高权限/异 SID 均拒绝。此批是私有 immutable evidence 的协议检查，未替代原生 token/boot/census 资格和完整 writer/observer 运行。

maintenance/drain 仍是临时 reader 拒绝条件，符合 `readLivePublication` 冻结前原生门禁；不改删 seal/unknown，标志清除后重新动态读取。无需为此放宽未知维护来源。

后续独审曾发现 live Django 来源消费检查早于别名固定点，以及 live manifest/bootstrap 小叶未入完整 CAS。冻结 collector `591265c9…bf4f` 已分别后置检查并纳 metadata CAS；复用实施定向结果，未把这些代码缺口报告为现场已命中。

file archive profile 曾遗漏显式 nlink=1，不能只靠原址 metadata 覆盖已移文件的后续读取；冻结 archive `adadf242…6be6` 已对 file snapshot 和 stat CAS 补上断言，未泛改 OS host 特例，未新增测试矩阵。

完整现场 closure 即使返回，也须逐 action 核 role/attribution/native tuple/实际 payload 与本案授权。现行保守策略会将非 protected、缺 snapshot 且无实际差异见证的 release 纳入，即使 manifest tuple 不同；这不是已证原 a3 专属。负责人已确认先核具体清单，若仅 missing 使其它历史候选纳入，则以有限 helper/consumer 闭包证据排除或保持 scope 冲突拒绝，不自动扩大到全部历史搬移。目前尚无完整清单，未声称已发生范围越界。

## 执行边界

完整只读第六次现场检查触及 120 秒诊断预算，33 个源码 pin 前后一致；23 个 RSS 样本峰值 262.42 MiB、末次 115 秒为 203.55 MiB，无完整 observation，不能判闭包通过。随后只核诊断增量：collector `52256b4a51d8b4e901e1cdb6729910c08c144b3ff7c00ea672853eac9450c146`，新增定向检查独立 **1/1 通过，exit 0，1.914 秒**。两个 context 事件与最多 1022 个 collector 事件均只含显式 primitive；达上限停止诊断、不跳过原验证，回调不入 closure、不改变 writeAuthority 或来源、不写生产日志。允许负责人从逐 rawSHA 相同的 33 文件私有固定副本执行同一只读入口，以私有 JSONL 定位阶段，保留 120 秒/512 MiB 预算；此许可不构成 writer、退休或封存就绪结论。

负责人报告第七次诊断于 120.008 秒预算止，固定副本 33 pin 与两件实际 CLI pin 均保持。276 个阶段事件表明仍有进展：Git 第 126/141 根在 28.28 秒，release 第 93/328 件在 100.4 秒，第 120/328 件在 117.685 秒；尚无完整 observation。下一步可按实际线性成本定位同调用重复工作，保持每叶实际哈希与 CAS。单次诊断时限不是 writer 20 分钟或最终动态 60 秒门禁的变更；两轮 writer/observer 各自全量复算必须在原期限内有实际余量。

有界三根 profile 随后定位缺 snapshot 的重复探测：每根扫描 9653 个实际 Git 文件名，产生 9653 次 lstat、约 799–836 毫秒；单次缺根探测为一次 lstat、小于 0.1 毫秒。此证据未读 tool/payload、未资格化 history。允许将根缺失前置返回“没有差异见证”null，随后仍执行已审受保护 history 的完整身份/每 tool 哈希与末次成员/CAS；不得据 missing 直接判 different 或放行。该增量代码与测试尚待冻结，history 原模块无需改变。

负责人拟追加的 inspection context →完整 closure→同调用 closure CAS→各 action 源的 snapshot/统一 stat CAS 调用组合已作副作用审查：这些函数只读 FS/限定 Git，未调用 archive ACL 设置、脱链、intent、写者锁或 move，可用已核冻结副本作有界诊断。snapshot 自带逐对象 CAS，仍需另计最终全对象统一轮，才对应首 move 前总预算；移前按精确原生 link role 资格，不用空 qualifiedLinks 跳过此边界。吞吐观察不能充当普通写者或退休资格。

至当前记录，仅执行自身私有边界测试并新增本审查文档；未采用控制包、写生产 queue/ledger/archive、改变任务/ACL/服务/进程、重启、准备制品、迁移、访问业务接口或发布应用。后续只对提交增量及直接影响复审。
