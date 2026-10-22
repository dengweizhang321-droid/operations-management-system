# S05d 退休、对账与封存：源码可行性核查

2026-10-23。此文件是实施角色的源码调查、边界反证与必要隔离验证，不另作独立路线规划，也不是生产退休证明。角色请求为 `complex / gpt-6.1-sol / xhigh`；工具未另行确认实际底层型号。独立设计由 PLAN 承担，独立审查由其他上下文承担。

**结论：现有链路提供若干可复用门禁，但不足以把新建的标记/控制代际当作原未知执行已经退休。当前不能据此对 a3 执行退休、封存或解除队列阻塞。** 缺原 PID 不必在逻辑上永远阻断新的退休方案；要替代它，必须正面建立此后不能产生或消费原作用的边界。本轮源码和反例未证明这条总边界已成立，且已经找到正常迟到/误用旧工具下的缺口。

威胁范围是正常并发、崩溃遗留、迟到作用和误调用旧来源，不假设同 SID 的人恶意篡改 ACL、源码或证据。下述旧入口缺口不依赖恶意改写。只读 metadata 不是 effective access、完整进程归属或完整消费盘点证明。

## 实际源码与现场证据

精确核对 a3 冻结 source 中 15 个命名源码/锁文件、已安装 `83e4158f…` bundle 中 5 个命名控制模块，均与本 worktree 对应文件字节一致；路径、大小、SHA 见 [source-evidence.json](source-evidence.json)。这保证下列直接边界适用于被核字节，**不声称 20 个文件已经穷尽整个 producer/依赖/权限闭包**。

现场只读采集由主负责人完成，引用 [native-metadata.json](native-metadata.json)、[file-metadata.json](file-metadata.json)、[staging-markers.json](staging-markers.json)。本实施没有重复运行任务/进程/boot 普查或真实执行入口。读到的事实及限制是：

- task 为 state 3、instances 0，定义与安装记录匹配；仍 `enabled=true`、`allowDemandStart=true`。这证明采样时无 task 实例，不等于持久撤权或不存在遗留子进程。
- 原 a3 时间窗取得两个 control-execution 身份：hook 与 consume-preparation，绑定同一安装/bundle、入口 PID/创建时间/普通 token。记录没有直接 dispatch/子树关联，不能把 consume PID 自动升级成原 publisher 或全后裔身份。
- `.staging` 有 5 个非空 deploy 目录。`deploy-fca7de7a-978e-42f6-a752-b168d69903ea/build/.runtime/worker-release-activation-fence.json` 的源码内容树与 a3 source-binding 相同；这支持同源码来源线索，仍不能唯一归属 dispatch。
- ACL metadata 只给读取范围的 owner/ACE。Django 有当前用户 FullControl；其他根存在继承/group 条目。没有由此计算完整 token effective access，也没验证可执行的撤权/新 broker 权限。

## 旧入口真正执行的边界

| 入口/门禁 | 已确认行为 | 不能由它推出 |
| --- | --- | --- |
| `main-control-dispatch.mjs:31` / `:61` | `readAdoptedControl` 核 adopted、原字节/完整 bundle、task；expectedBundle 不同则拒旧 consumer。`assertControlGeneration` 再核 installation SHA | 已加载的 publisher/npm/Vinext/WSL 子进程也会识别新 generation |
| `main-prebuild-hook.mjs:64` | admission 失败写 deferred，成功才 submit/wake；旧 bundle 不能跨新 adopted 路径继续消费 | 换 hook/task 能撤销已 spawn 的原作用 |
| `publish-prepared-main.mjs:142,208` | publisher 持 rotation；已有 PREPARING 且无 PREPARED 时，新进入者在 plan 前拒绝 | 已越过该判断的原 actor 会被后来新 fence 拦住 |
| `main-prebuild-queue.mjs:134` / `preparation-resolution.mjs:65` | unknown 持续拦新 dispatch；未知 decision reader 直接拒；合法 resolution 默认禁止原 target 重放 | 将未知 decision 写成 sealed 就能兼容旧 queue，或旧原件可以改写 |
| `worker-local-release-rotation.mjs:83,1097,1462` | 真实 release-batch active ownership 可使未带正确 batch SHA 的旧 plan/apply/publisher 拒绝 | 可以伪造 active.json 当退休标记，或该 gate 已覆盖 Django/Pi 全部消费者 |

`publish-main.mjs` 的冻结包原生入口没有调用 `readAdoptedControl`。它核原 source、request、PowerShell/npm-cache、普通 token，然后调用原 producer。已有 PREPARING 是该包新重入的真实防线；control bundle 代际本身不是这条原生入口的通用 fence。

直接 `worker-local-release-rotation.mjs plan --prepare-online` 支持带精确 source-binding/复用计划，绕 queue 和 control generation，仍持真实 rotation 及原生前驱/版本门禁。不能把它描述成无门禁工具。`worker-local-release.mjs deploy` 是 first-deploy，现有 authority/current 已使普通首次 deploy 永久拒绝；也不能把此命令误报为任意覆盖现运行版。另有导出的 `buildWorkerReleaseCandidate`，其内部没有 rotation/control-generation gate；这是导出 API，不是该文件 CLI 的 candidate 子命令。

## 作用写入与消费顺序

### Worker

1. `worker-local-release.mjs:2005` 建 `.staging/deploy-UUID/build`，复制源码，安装依赖，编译与 helper；并建 `release/source-snapshot`。npm 生命周期和编译子进程可能独立于外层 named-pipe holder 存活。
2. `:2080` 向 `build/.runtime/worker-release-activation-fence.json` 写 `createdAt/sourceFingerprint/buildFingerprint`。它是构建身份，不是本轮提出的新退休 fence；只同源码内容不能确定 dispatch。
3. `:2235–2239` 写 release manifest、创建 `.dev.vars` 硬链接，再把 releaseStage **rename 到共享 `releases/<id>`**。完整候选复验在 rename 之后；失败有删除候选/残片的 best-effort 路径。
4. rotation `:1245–1255` 之后才发布 `state/worker-release-rotation-plans/<planSHA>.json` 及 sidecar、`state/worker-prepared-builds/<planSHA>.json` 及 sidecar。
5. publisher `:219` 再写 packet worker-plan，`:222` 才进入 Django；最终才写 PREPARED。因此缺 packet worker-plan 不能排除共享 release/plan 已写，也不能排除原清理曾移除某记录。

真正可用于来源对账的小对象是 release manifest 的 `source.rootPathSha256`、`source.sourceBinding.sourceRoot/identity`、runtime 路径身份；plan 的 `sourceBinding`、candidate tuple；prepared-build receipt 的 `identity/sourceBinding`。worker 五域、publication staging、consumption、successor 与实际 head 必须按结构与引用链结合。裸 target 字串/时间先后、一个相同 sourceFingerprint 都不是完整归属证明。

同包复用核原 preparation identity、sourceBinding、前驱与 manifest tuple。正常新 queue 不会仅凭相同内容树任意捡旧 candidate；但显式原生 reuse/apply 仍是单独消费面。释放 rotation 后若又运行旧 direct 工具，其是否必拒须有持久 gate；只能依赖大家暂时不点旧命令不算退休边界。

### Django

`django-local-service.ps1:2089` 的 PrepareApp 建 `app.deploy-<UUID>`、复制 backend/config/tools/runtime-tools，`:2318` 在独立 `run/wrangler-smoke-<UUID>` 做 **local** R2 round trip，再写 deployment manifest、`app.prepare-<UUID>.json`。失败会尝试删除 staging。CLI `:5484` 的 PrepareApp **没有包在 service mutex 内**；正常由 publisher 外层 rotation 串行并不代表 direct PrepareApp 自带该锁。

Get-PreparedApplication `:2353` 核精确 id/receipt SHA、目录/manifest、当前前驱与树完整性；DeployApp `:2399` 要求源码入口、维护及停稳，再消费该 prepared。重要缺口是 `Assert-ProductionMaintenance :4860` 只要求有效维护存在、Worker 停稳，不将本次 MaintenanceId/目标/retirement 与该候选绑定；DeployApp 也不读取新 control generation/退休标记。VerifyPreparedApp 的 sourceRoot 相等不是 DeployApp 对本次封存/授权目标的持久消费否定。

因此，**前驱仍相同时，旧 prepared 的正确 id/hash 在未来正常维护窗口仍可能满足旧 DeployApp**。当前在线状态拒绝 direct DeployApp，是瞬时生命周期保护，不是对封存工件的永久撤销。全程不需要恶意修改文件就存在这条误调用条件；本轮没有断言现场 a3 已生成这种工件。

### a3 的最小闭包与 Pi 范围排除

已独立读取精确原 request（7,174 字节，原 SHA 及字段投影见 [a3-request-closure.json](a3-request-closure.json)）：完整 releasePlan 为 36 个变化，其中 3 个 tools 源码变化；`migrate=false`、没有 schemaRelease，真实 `schemaForRequest(request)=null`，没有 `backend/pi_runner/*.py` 变化。按 `publish-prepared-main.mjs:72–78`，**a3 的 piUpgradeRequired=false，不会从正常 publisher 调 PreparePiUpgrade**。不能把一般 Pi/WSL 能力当 a3 事故必扫全域，也不能为退休 a3 默认要求全局 Pi 身份迁移。

若原 Worker plan 阶段完成，a3 接下来可进入 PrepareApp；其源码调用包含复制、原迁移代际校验、本地 Wrangler R2 自检、树摘要和准备回执。`Assert-NoUnapprovedProtectedAiMigration` 的既有 Pi153 `successor` 分支调用 `pi_native_addition.py`；该命令在 `main:322` 直接走 `verify_active` 读取原 schema/source/receipt，不调用 Runner upgrade/WSL。没有找到 PrepareApp 在本次无 migration 路线隐式启动 PreparePiUpgrade 的调用。因此本案最小对账面是原 packet、Worker staging/release/plan/prepared/消费与原调用可产生的 Django prepared/run/lease；Pi Runner 候选不是仅因一般工具存在就加入的本案执行面。

以下只说明**未来若泛化退休协议**到确实包含 Pi 升级的批次需要的边界，不作为 a3 当前阻塞理由或本轮扩大现场盘点的依据：

`django-ai.ps1:111` PreparePiUpgrade 调用 Windows `pi_agent_upgrade_runtime.py`，它先写 `config/pi-agent-upgrades/<sourceSHA>/preparing.json`，通过 WSL 在 Linux `.../teruisi-pi-runner/releases/<newSHA>` 建 source/config/key/unit/plan 后，再回写 Windows prepared receipt。Windows 包装器退出不能单独证明已提交的 WSL 操作取消。Linux prepare 的 Docker 调用为 image inspect；不能把它泛称为本阶段已启动/更新生产 Runner。

旧 Pi apply 对精确 plan/config/source/key、Linux predecessor unit、Runner inactive/无 running containers 及一次 intent 有严格检查；它不读取本轮 retirement fence。直接手工执行这种旧 Pi plan 是另一个独立业务动作，不属于 a3 正常路径。只有未来方案明确要覆盖它时，才需相应的消费撤销/远端闭包，不能因此要求本次扫描或改造全部 WSL/Pi。

### npm、构建与“远端零作用”的限制

冻结 request 在 `publish-main.mjs:68` 给 npm 设置 offline/prefer-offline；builder 仍以 `--ignore-scripts=false` 执行 npm ci。440,085 字节 lockfile 有项目本身及 8 个外部 `hasInstallScript` 条目。项目 postinstall 调 `install-workerd-heap-patch.mjs`，已读源码是在本次构建 node_modules 内补 Miniflare/Inspector；Sites 自有 plugin 是 dist/.openai 的本地复制。

已对 root 指定同内容树 stage 作一次有限静态核对，不再笼统用“npm 可能任意执行”作为不可行理由。脚本 [inspect-lifecycle-sources.mjs](inspect-lifecycle-sources.mjs) 的指定叶预算为最多 24 次定位、单叶 128 KiB、叶字节合计 256 KiB；已单独绑定 SHA 和 440,085 字节的根 package-lock 作为选叶输入另行读取，不计入叶字节统计。实际 24 次定位、23 叶存在、114,552 字节。原 SHA、版本、lifecycle 命令、有限调用行与分类见 [lifecycle-sources.json](lifecycle-sources.json)：

- 4 份 esbuild 与 workerd 的 install.js 是局部安装/写二进制、版本检查及 fallback npm install/HTTPS GET tarball 下载。
- unrs-resolver 调 napi-postinstall；直接 CLI/index/helper/constant 层是 npm registry 配置读取（`npm config get registry`）、局部安装/写文件、HTTP(S) GET 下载。没有执行这些代码或请求；并未因配置了 npm offline 就声称直接 HTTPS GET 不可能发生。
- sharp 的 install check 在 global-libvips/build-from-source 条件下走 node-gyp；直接 build/libvips 层是本地探测/子构建。其 node-gyp 与编译器更深调用未继续展开。
- fsevents 在该 Windows stage 缺失，lock 明确只适用 darwin；这与平台选择相容，仍不是原执行历史证明。

在这些已读入口没有见显式远端变更请求、daemon 或计划任务注册；不能把下载 GET 写成远端业务写入。尚未展开的是**明确有限的后续调用**：napi 平台表、node-gyp/npm 内部/native binary，以及 Vinext/Cloudflare 编译 plugin 的实际链路。需要时可继续按具体调用补证，不是原则无法验证，也不要求扫描全 node_modules。本次没有监测/重放 npm 或网络，没有证据声称实际发生了远端写入；同样未把当前 stage 字节当作原 a3 生命周期的完整执行 trace。

## 控制采用不存在简单的 unknown 循环依赖

`install-main-prebuild.mjs:216–261` 的 adopt 保留 queue 原件，并没有要求先 resolve unknown。它按 v1-queue→v2-queue→native-rotation 持锁、原安装/入口 CAS、桥 hook、installing、最终 hook/config、相关控制进程观察、精确 task 注册与 adopted 落盘。故“必须先解 a3 才能安装新 reader”不是当前源码事实。

但采用中的 `controlProcessSnapshot` 依入口路径、已选父链等识别。若旧 holder 异常退出，`.staging/build` 中 orphan npm/Vinext 并非必然还通过父链或控制/source 路径命中；三次短空帧不构成独立旧后裔退休 provider。这是源码支持的条件反例，未断言现场有该进程。控制采用可更换受支持入口，不能借其自身快照推导全作用已经退休。

## 私有反例验证及其证明上限

[retirement-boundaries.test.mjs](retirement-boundaries.test.mjs) 直接导入未修改的旧 publishPreparedMain/queue/evidence 函数。原生构建、生命周期、源码身份等使用私有受控替身，不执行真正构建或发布；一个私有 child 仅操作生成的临时叶文件，靠 IPC 正常退出，不终止任何进程。

| 反例 | 实际观察 | 有效边界 |
| --- | --- | --- |
| 原 PREPARING 重入 | 真实旧 publisher 在 plan 前拒绝 | 证明已有防重入分支，不证明已越过者退休 |
| 越过 PREPARING 后插新 fence | 真实旧控制流仍写 worker-plan/PREPARED | 证明未识别的新 marker 不能追溯阻止旧代码，不证明真实 native build 成功 |
| 私有 named pipe 已释放且重新获取 | 独立 child 的已开文件 handle 仍可写 | 证明互斥 holder 消失/新持锁不等于独立 writer 被撤权，不证明现场 orphan 存在 |
| A→B→A | 两次真实 stableBytes+SHA 仍相等 | 相同字节 CAS 不检测中间历史；须有持久 epoch/ownership/消费协议 |
| opaque possible controller | 原 observer validator 拒绝 | owner/权限未知应保持阻塞，不能改为空集 |
| 新 sealed decision | 原 reader 拒绝 | 封存协议仍需明确定义与兼容采用，不是写文件即可生效 |

主负责人另外精确授权了 [private-open-handle-acl.ps1](private-open-handle-acl.ps1) 的单个私有临时叶 DACL 实验：先开 write handle，再对当前 SID 的该叶拒 WriteData/AppendData。新 write open 被拒，旧 handle 仍写成功；原 DACL 摘要恢复相同，生成目录删除，生产和父 ACL 未改。它证明**修改 DACL 也不会自动撤销已授予的打开 handle**，不能替代原执行退休。首轮对照读取因 ReadAllText 的共享模式冲突失败，finally 恢复并删除原私有目录；改成显式 ReadWrite sharing 的读取 handle 后通过。失败及最终结果保存在 [private-acl-check.json](private-acl-check.json)。这不是新身份 broker 可用性或完整 Windows 权限模型验证。

六项反例与语法检查的最终记录见 [boundary-checks.json](boundary-checks.json)。不建立“自填 retired=true 就通过”的正例，不生成可对生产使用的 retirement/proof/seal 工具。

## 退休边界仍需证明的兼容成本

普通调用者可以继续作为发起人；这不等于将同一普通 SID 的 wrapper 换名字就得到了新的权限边界。若选择由不同受控能力/身份负责写入，至少需要同时解决：

- 旧写入能力及既开 handle 的退休；全 boot 只对其真实覆盖的执行域有效。本案先按上文 a3 最小闭包判断，只有具体来源调用确实涉及进程外/远端执行域时才纳入相应持久意图与消费对账。此处不授权重启、注销、撤权或终止进程。
- 新 writer/broker 的真实最小权限、受控入口和批准绑定；既有 Django runtime 的 ACL 校验精确主体集合及 FullControl（`Get-AllowedAclSids/Assert-RuntimeAclHardened`）不会自动接受一个新 broker 角色。
- 现有普通 task/`assertOrdinaryIdentity` 固定原 SID、交互 session、medium integrity；新 writer 的会话/权限模型与普通 caller 必须分开验证，不能假装新身份已经通过旧 ordinary gate。
- 现有 DPAPI 凭据、原 owner 与当前运行服务/工具绑定。未经对应兼容证明，不能假定新身份能使用原密文或在不影响日常服务下接管根写权。
- 本案中相关 Worker/Django 消费入口一致识别被封存工件的失效/授权绑定，而不仅是新 queue；Pi 只属于未来确实含升级的泛化范围。原两个 decision、历史读取、原 unknown 和禁止原 target 重放继续保持。
- 崩溃只能留下有来源的未完成意图/unknown。多对象“撤权→盘点→拒消费→封存→新采用”不是一个目录 rename 或单文件 SHA CAS；部分完成不能先报告 seal 成功。

上述属于本轮尚未实现、未被原生验证的工程约束，不是指定必须进行整机身份重构。使用已有真实 batch ownership 能减少 Worker 门禁缺口；它仍需原协议及授权，不能借写一个 active 标记绕过资格，也没有覆盖已指出的本案 Django 工件边界。若独立 PLAN 选择更小方案，应只围绕本案真实可达的写入/消费条件给出充分否定证明。

PLAN 中保守隔离原候选寻址、隔离受支持旧入口并接管必要 helper 的较小路线仍可继续论证；本调查没有把 broker 新身份认定为唯一必要方案。现有的具体兼容边界是：Django installed app 的 DeployApp 自调会拒绝，不能误算成可自由覆盖的旧入口；Worker rotation 又需要执行 predecessor immutable release 自身 verifier（`:668`），当前启动/guard/manifest 不允许为隔离旧工具任意改运行包字节或路径。只替换 queue 的控制采用可绕开 unknown 前置，但它没有提供“保全原运行包、使原工件不可寻址/消费、接管其余本案相关入口”的现成退休操作。若方案要求先上线新 runtime helper 才能建立退休边界，还需解决 unknown 阻塞新 prepare 的引导顺序。此处需要精确对象/入口兼容实现与验证，不能用未实施的全局身份改造替代，也不能以改 manifest 或手造 active 文件捷径通过。

## 交接与停止点

已完成源码边界核验、20 件精确字节比对、六项离线反例及一个私有单叶权限反例。它们排除了若干不充分方案，没有完成 a3 退休/副作用对账/封存的可执行准入；S05d/S05b 状态由主报告据此保持真实边界。

本实施没有修改生产 tools/knownDecisions/controlFiles，没有 fetch 或更新 main 引用，没有 adopt、队列写入/新 dispatch、制品准备、任务/账户/服务变更、生产 ACL 修改、生产封存、数据库写入或上线。没有完整构建、全仓测试或完整 node_modules/大日志扫描；也没有自行提交/推送。
