# 退休、对账、封存路线独立审查

2026-10-23，上海时间。请求角色为 `deep-review / gpt-6.1-sol / xhigh`，仅对未知结果、迟到作用、跨代消费与恢复并发局部升级；工具没有提供可独立确认的实际底层型号。审查者未参与本路线规划或实现，未转派、修改被审源码或接管现场操作。

## 结论

**设计逻辑有条件成立，值得进一步验证具体屏障；现有代码尚不能直接执行这条路线，现场也未就绪。** 原 a3 unknown、原 target 禁止重放和 S05d/S05b 阻塞继续保持。本结论不是退休、封存、控制采用或新 dispatch 的许可。

新证明目标有效：不必恢复缺失的原 PID 或证明原执行当时零作用。若能从新边界 T 起，正面退休覆盖全部可能旧执行的集合，持久封闭其正常再入与消费路径，并将 T 时全部相关对象和实际运行状态对账后封存，则历史 unknown 可以原样保留，未来有限新工作可以从经确认的基线开始。退休集合、不可消费集合可以保守地大于原 actor/原产物集合；不要求每个残片唯一归属 a3。

但“新 marker + 换控制代际 + 当前进程/任务空闲 + 再拿到锁”不是充分实现，已有真实旧代码和隔离反例否定了它。PLAN 中现有门禁组合 R1 尚未闭合；新增 R1b 是较窄的受管执行面/输入隔离候选，R2 是对象能力隔离的充分候选。没有证据证明 broker/独立 SID 是所有可行实现的唯一选择，也没有证据证明这些候选已适配本机普通权限、ACL、DPAPI 和现有生命周期契约。R1b 仍须对下面实际入口给出同样充分的拒绝证明。

| 判定层 | 本轮结论 | 依据及限制 |
| --- | --- | --- |
| 设计可行 | 有条件成立 | 退休、持久再入/消费屏障、完整对账及原子准入能使未来安全性不再依赖原结局；未发现该证明目标自相矛盾 |
| 当前代码可直接实施 | 否 | 没有退休 provider、新封存 ledger/reader 和覆盖全部相关原生入口的持久否定边界；反例已确认若干缺口 |
| 工程上能否补齐 | 仍可研究 | 已有原件绑定、严格 reader、锁序、adoption CAS 可复用；权限/执行隔离与消费闭包未完成原生正向验证，不能承诺小改即可完成 |
| 当前现场就绪 | 否 | 未安装/执行新屏障；五个非空 staging 未分类；无完整作用/消费盘点、全退休或最终同锁准入证明 |

## 核查范围与 a3 精确闭包

按共享记忆启动协议读取相关偏好、工作流、项目记忆与现存最近复盘，完整读取本工作树 AGENTS、README、开发与交付、模型分工及架构/前端、运行、安全、发布与恢复细则；读取前轮 PLAN、IMPLEMENTATION、REPORT、REVIEW 和 evidence 的原件绑定、目录保全及限制。沿本次直接依赖核查 queue/dispatch/task、控制 adoption、publisher/native prepare、Worker plan/reuse/apply 和 Django PrepareApp/DeployApp。

现场材料由负责人统一采集，审查者没有重复查询现场。独立读取本轮 PLAN、FEASIBILITY、原始 metadata、source pins、request scope、staging markers 和隔离脚本；未将根 ACL 摘要、短时间窗或文件名当作恢复准入。

[request-scope.json](request-scope.json) 与 [a3-request-closure.json](a3-request-closure.json) 绑定同一 7,174 字节原请求，SHA-256 为 `1f43dd8d5e978dd6b79cada8b7210a45a0a0abba6c3ad072454a3098a3a00b32`：components 为 Worker/Django，migrate=false，无 schemaRelease，完整 diff 有 36 项且无 Pi Runner Python 改动。结合 `publish-prepared-main.mjs:68–76`，正常 a3 分支的 schema 为 null、piUpgradeRequired=false。**Pi/WSL 升级属于工具通用能力，不是 a3 此次正常调用的退休必需域，也不是已发生作用。** 这不证明 npm/编译依赖没有其他进程外作用。

[source-evidence.json](source-evidence.json) 对 15 件 a3 冻结源文件和 5 件已安装控制模块给出逐字节匹配；本地所审相关函数与该命名范围相同。该证据没有穷尽整个依赖树，不能被写成完整 producer 闭包已通过。后增的 `pi_native_addition.py` 中 `successor` 直接返回 `verify_active`，读取原 schema/source/receipt；本次核到的该分支不进入数据库采用或 WSL Runner 升级。

## 已确认的具体不足与方案处理

### 1. 新 fence 不撤销已越过旧门禁的执行

`publish-latest-main.mjs:141` 启动冻结包 publisher；`publish-prepared-main.mjs:208–241` 在进入构建前检查 PREPARING，之后不会读取后来新建的退休 marker，也不重新读取 adopted generation。隔离夹具暂停真实旧 publisher 的 plan 调用，插入新 fence 后放行，真实旧控制流仍写 worker-plan/PREPARED。原生 plan 在该夹具中是受控替身，故这不是生产构建成功证明。

这构成 R1 中“只换入口/加文件就退休”的实际代码反例。PLAN 已将已开句柄/越门禁执行与未来再入分开，并要求正面退休 provider；此设计处理正确。未来完整启动周期可退休其真实覆盖的本机内存执行域，但必须同时保持持久再入关闭，并核实际可达的持久/外部执行。当前 boot 早于 a3，不能当现成屏障；也不因缺原 PID 就否定未来覆盖整个旧域的屏障。

### 2. 互斥、当前 task 空闲和新控制采用不足以证明旧域退休

现有 adoption 使用 v1 queue→v2 queue→rotation，且不要求先解决 a3 unknown，因此没有必然的安装/封存循环依赖。`install-main-prebuild.mjs:235–260` 的三次短 census 只覆盖其定义的相关控制窗口；旧 holder 退出后，orphan npm/Vinext 可能失去已选父链且位于 runtime staging，不能由这三帧推定不存在。此为源码支持的交错条件，没有断言现场存在该进程。

独立私有子进程反例确认：释放并重新取得 named pipe 后，另一个已开文件句柄仍能写。负责人私有单叶 DACL 实验进一步确认新 write open 拒绝时，原 write handle 仍能写。两者都不能证明新权限方案已可部署。task state=3/instances=0 且 enabled/allowDemandStart=true，也不是持久关闭。

PLAN 用两个跨 boot epoch、持久屏障连接，且不伪造连续持锁；将现有 adoption 与真正退休区分，此处可接受。完整 provider 和其有效权限尚未实现/资格化。

### 3. 旧消费者必须逐项封闭，不能只改 queue

Worker 原生 plan/reuse/apply 有真实 rotation、source/predecessor/guard/消费门禁，也有 release-batch active ownership；不是无门禁工具。但它们不因新 queue resolution 或任意新 marker 自动失效。`worker-local-release-rotation.mjs:1152–1189,1283–1384` 的复用和消费仍须纳入本路线，不能手写 batch active 代替原 batch 协议。

Django 有更具体的反例：`Get-PreparedApplication:2353–2388` 核 id/hash、树及实际前驱；`Deploy-Application:2401–2428` 核维护和停稳后消费它；`Assert-ProductionMaintenance:4860–4870` 要求维护存在及 Worker 停稳，**没有将本次维护/target/retirement 与该 prepared 绑定**。因此原前驱仍相同时，旧 prepared 的正确 id/hash 在未来正常维护窗口仍可能被旧 DeployApp 接受。在线时被维护门禁拒绝不等于永久失效。另 `PrepareApp:5484` 直入口不持 service mutex，不能把外层 publisher rotation 推广成它自身的全域互斥。

这是条件式正常误调用反例，未证明 a3 现场已创建 Django prepared，更没有执行该命令。PLAN 已把消费否定和 direct source 纳入封闭域，保持未覆盖入口阻塞；当前实现仍缺失，不能把该发现写成已修复。

最终 PLAN 新增 R1b，以保守封存旧可寻址工件、关闭受支持旧 source/native 入口并由有限新 adapter 接管合法调用，作为比身份改造更窄的候选。此边界没有被现有反例普遍否定，但尚无原生正向证明。后续须逐入口验证现有拒绝点，避免机械替换所有运行 helper：Django PrepareApp 的 `:2090`、DeployApp 的 `:2402` 已拒从 installed app 自我准备/部署。真正必须接管的 manifest-pinned helper 若依赖新应用包，应另核能否在封存前持续闭锁状态下交付，不能先放开新准备来解决接管材料缺口。无需为本轮可行性文档实施该接管。

### 4. 原 packet 缺记录不代表全产物/作用闭合

Worker 原生构建先产生 staging/source/build/release，再将候选 rename 到共享 releases，之后才发布 rotation-plan/prepared-build，publisher 最后写 packet worker-plan/PREPARED。故 packet 缺 worker-plan 不能单独排除先前共享候选/计划。必须按 manifest/sourceBinding、prepared receipt、plan、consumption、successor 和当前 head 逐引用核对，并保留临时/残片。

本次五个非空 staging 及与 a3 内容树相同的 activation marker 是线索；同内容不是唯一 dispatch 归属。PLAN 允许在准确授权范围内保守封存全部未消费同域对象，避免强迫补造归属；同时保留其他任务和当前运行链，处理正确。尚未完成完整盘点，不能称封存集合已经确定。

npm offline 不等于其 lifecycle/编译代码全面网络撤权。已知项目 postinstall 和 Sites plugin 的本地作用不自动证明全部依赖没有进程外作用；也不能由这个闭包缺口反向声称发生了远端写入、Pi/WSL 或业务数据修改。本轮不因通用能力扩大 a3 已知作用域，后续仅沿其真实可达边补证。

### 5. 封存自身的 unknown、兼容与原目标禁重放已明确

PLAN 的 INTENT→ISOLATING→RETIRED_CLOSED→INVENTORIED→SEALED→ADMITTED 要求每步正面回执，崩溃保持关闭，不以新 operationId 重做未知安装/移动。跨对象封存不是单文件 rename/CAS。旧 reader 的新 decision 拒绝、原两个 decision/operator 清单保持、新 reader 每次准入复核完整 ledger/屏障和原 target ban，是必要兼容边界。

独立 A→B→A 夹具只说明两次 stableBytes/SHA 不能观察中间历史，不证明当前采用协议本身有 ABA 缺陷；未来防线应来自经审 ownership、锁序及持久 epoch，而非用该夹具要求无关重构。当前没有新的 reader/ledger/sealer，故这些仍是设计条件。

## 必要隔离验证

独立运行 `node --test --test-timeout=30000 docs/s05d-retirement-feasibility-20261023/retirement-boundaries.test.mjs`：6/6 通过、exit 0。覆盖原 PREPARING 拒重入、越门禁后忽略新 marker、独立句柄与锁、前后字节 ABA、opaque controller 拒绝、旧 reader 拒新 decision。

实施者随后仅将私有 child 清理改成 IPC disconnect 后关闭自己的 fd 自然退出，删除进程终止回调。审查者读过此增量，并只重跑 `--test-name-pattern='released private named-pipe'`，1/1 通过、exit 0；其余五项复用原结果。当前测试 SHA-256 为 `4f879bb65388a77475e0323b4cd1f2cd15af8ab4324e5be4a4622540b5e01d5e`。原始集中记录由 [boundary-checks.json](boundary-checks.json) 定位。

独立读取私有单叶权限脚本及其范围/恢复逻辑，未重复执行；其实际结果和首轮共享模式失败由 [private-acl-check.json](private-acl-check.json) 保留。权限实验只证明既开 handle 不因 DACL 修改而撤销；未测试新身份、父目录替换、完整 ACL 或 broker 能力。

本轮反例足以排除所述不充分方案，**没有新退休 provider 或可执行封存协议的正向成功用例**。未运行无关测试、完整构建、原生产命令、task/service/process 状态变更或业务接口验证。

## 增量意见与停止点

首读 FEASIBILITY 的 Pi 段误把三个 changed tools 表述为 a3 全部变化；已要求按原请求的 36 项完整 diff 修正，并明确 Pi 升级分支不在 a3 正常调用域。另要求 PLAN 将新身份/权限授权与已单独授权的私有单叶实验区分；R2 工程代价应作为候选约束，不能声称所有更窄实现都必然需要身份重构。最终增量复核结果在下节记录。

当前可接受的交付是设计、直接边界证据与反例审查。下一步若继续，应验证一个具体、有限的持久屏障及其原生兼容，而不是重新寻找已经缺失的历史 PID，或写一个以 `retired=true` 自证成功的 sealer。原 a3 unknown、原 target 禁重放和 S05d/S05b 停止点不变。

## 最终增量复核

已增量核对以下修正：a3 请求恢复为完整 36 项变化并明确无 migration/Pi upgrade；新增源码证据 20 件全部为 identical，Pi153 successor 分支没有被误当 Runner 升级；PLAN 新增 R1b 并将 R2 明确为充分、非唯一方案，私有叶 DACL 授权与生产权限变更已分开。六项最终反例集中记录和私有权限实验记录已读，脚本最终 SHA 与集中 pins 一致。

上述增量只改变事实范围和候选取舍，未改变原生工具或创建恢复能力，不需要重复完整测试或构建。**本轮设计与反证交付可接受；R1b 仍待具体闭包验证，S05d/S05b 保持阻塞。** 没有遗留本轮文档结论阻断，也没有新生产 go 结论。

随后仅增量复核 [inspect-lifecycle-sources.mjs](inspect-lifecycle-sources.mjs)、[lifecycle-sources.json](lifecycle-sources.json) 与 FEASIBILITY 的 npm 有限核查段，没有重跑六项反例或 DACL 实验。collector 只读指定源码，不 import/执行依赖、运行 npm 或联网；只新建本任务证据 JSON。指定叶预算为最多 24 次、单叶 128 KiB、叶字节合计 256 KiB；逐行重算确为 24 次定位、23 叶存在、114,552 字节，均未超界。已单独绑定 SHA/440,085 字节的根 lockfile 是选叶输入，另行读取，不属于该 114,552 字节叶统计。

八个外部 hasInstallScript 包中，七个在指定 Windows stage 取得匹配版本的 manifest，fsevents 缺失且 lock 的 OS 为 darwin；这不能反推历史执行 trace。所列片段支持 esbuild/workerd 的本地安装、版本检查和 HTTPS GET 下载 fallback，unrs→napi 的 registry 配置读取/本地写入/GET fallback，以及 sharp 的本地 source-build/node-gyp 路径。未将 GET 下载写成远端业务变更；未见显式远端变更、daemon/任务注册的观察限定在已读入口，不能被提升为整个依赖闭包零效果证明。napi target、node-gyp/npm 内部、native binary 与编译 plugin 是明确的后续有限调查边，不是原则不可验证的理由。

新增段落据此收窄了此前泛称 npm 可能性的缺口，未借当前 stage 字节补造 a3 归属/历史执行、退休或生产就绪结论。本轮交付结论不变，具备提交条件。
