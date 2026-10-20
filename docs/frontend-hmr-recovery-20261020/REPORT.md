# 前端热更新交付的限定准备恢复控制

本提交只增加控制工具兼容与历史准备终止分支，不修改已合并的 HMR A/B 实现，不执行控制采用、原生准备、生产发布或历史目标重放。

## 精确 native-tools 兼容

保留原 `teruisi-code-only-native-tools-update-v1`。新 `teruisi-successor-512-native-tools-update-v2` 只接受旧配置 SHA `49caa8d7a140fa614c2f28389029d07f6de6b503df499094d28e07793490200a`、旧 `65dcc585b16e7fd1db5fde4648dec81a114df00e1e5c578976e82bcac854414e` 三文件闭包及新 `d08a3c4de4bd04325bd8e63811775934e97a9f63f757e40b6afec4a3166ddf31` 闭包。仅原 rotation 的唯一 `const maximumSuccessors = 256;` 改成 `512`；另两文件字节不变，不复制其他 main 或运行包代码。输入 JSON 仍只包含 `version`、`oldConfigSha256`、`nativeToolsSource`。目录名称按原 canonical JSON（含末尾换行）的摘要计算。

新 closure 由发布负责人在复核后 create-only 准备；随后以同一干净冻结源码运行：

```powershell
node tools/install-main-prebuild.mjs --config D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json --native-tools-update <精确更新JSON绝对路径> --out <全新控制材料目录>
node tools/install-main-prebuild.mjs --adopt <同一控制材料目录>
```

两步均由唯一发布负责人执行，本提交未执行。

## 原 dispatch 0038 的有限终止

只接 `00385709-d354-4d39-9e7c-bc2b42dd90f1` / `d6742ea6-30d2-4e7c-b58e-3c6399a50ee1` / `c7b817989050ac5af8d989403a0f5cbbd053ce05` 的精确 ticket、dispatch、unknown result、原 adopted/intent/transition/actor 和旧十文件 control closure。82 个源码文件覆盖原 Python `CODE_FILES`、本地 import 闭包、recipe 与 mandatory-checks proof；实际 80 文件摘要 `cb23f567...` 与原 recipe/proof `70f93385...` 不同，固定 await 链在 binder 的 mandatory-checks 异常返回后终止。

保留原 worktree/分支和 `source`、空 `schema` 目录创建事实。仅允许追加 `failed-before-native` / `awaited-schema-binder-rejection` resolution，`nativePreparationStarted/prepared/publicationPerformed/retryOriginal` 全为 false。原 ticket/dispatch/unknown 不改写；旧 c7 目标永久禁止再次准备。新 reader 是 queue 的第七个有限分支，其余未知继续阻断。

原 dispatch 的 e523 前驱继续保留在原件中；当前现场另外绑定真实 20ee SUCCESS、完整 installed Worker chain、Django manifest 和同一干净 source，不假定现场仍是 e523。初末静态观察一致，动态独立见证与普通 writer 的 census/ACK 保持最终 60 秒窗口。请求等待预算 120 秒，整轮 epoch 上限 20 分钟。writer 按 queue → rotation 持锁；高权限 observer 只读现场，仅在外部证据目录写 observation。

控制采用完成后，普通权限从同一冻结源码调用：

```powershell
node tools/main-prebuild-queue.mjs --installer-0038-write <D:/codex-artifacts下全新目录>
```

writer 依次输出 initial/final 的 request 绝对路径和精确 SHA。负责人对每个 request 用独立高权限只读进程运行，并保持到 writer ACK：

```powershell
node tools/main-prebuild-queue.mjs --installer-0038-observe <REQUEST-initial或final.json绝对路径> <writer输出的requestSHA>
```

仅成功追加 resolution 后，负责人再通过原固定入口提交最新目标的准备。不得把该 resolution 当作 c7 已准备、已上线或可重放。

## 必需代码检查

- `node --check tools/install-main-prebuild.mjs`、`node --check tools/main-prebuild-queue.mjs`。
- `node --test tests/installer-0038-control.test.mjs`：精确闭包/逆向唯一 literal、旧配置及字节负例、原 99 对象闭包篡改、packet 非空/额外请求/重定向、见证过期/权限/任务/代际/原 actor、伪成功与混源负例。
- `node --test tests/main-prebuild-queue-v2.test.mjs tests/main-prebuild-eligibility.test.mjs`：15 项通过，包括真实私有锁、已有未知阻断与原 ordinary admission。
- `git diff --check`。未做业务功能测试，未运行 binder、原生准备或生产控制。

代码检查和源码提交不等于独立复核、控制采用、原生 PREPARED 或应用上线。后续事实由负责人在外部证据目录记录，不为回填准备结果再次推进 main。

## 控制材料准备的精确日志兼容增量

负责人报告：`eaae8e82` 的原生候选必需检查通过，但首次普通权限 `prepareControlUpgrade` 在 `nativeOperationBindings` 扫描历史 packet 时，将普通文件 `publish-main-check.log` 当作目录，报 `Release evidence directory is not ordinary`。错误在创建新的 `out` 之前，`out` 不存在；没有采用控制、修改固定配置或生产切换。已有历史 packet 与日志原件保留。

本增量只识别这一精确诊断日志叶：须为普通单链接文件、非重定向且 realpath 一致，才从 native operation **目录**扫描中排除；同名目录、symlink/junction、hardlink 及其它任意 `publish-*` 非目录仍拒绝。原 started 证据扫描、源码根与成熟依赖 junction 边界、完整目录清单及替换检查保持。

新增 `tests/native-operation-diagnostic-log.test.mjs` 的四组必要控制检查，覆盖日志正例仍返回原 native record，以及重定向、hardlink、错误类型与真正 publish-commit 文件负例；仅复用此前有效的控制和包检查，不重跑全候选检查或业务功能测试。此增量尚未声明控制材料准备成功或已采用。

## dispatch 391 的原生准备中断弃置

负责人确认：后续控制已采用，原 0038 已通过其限定协调；真正的 5beb 准备于 `2026-10-20T14:39:43.525Z` 留下新的 unknown。新 dispatch 为 `391ee25b-2c47-4c01-af96-36b9a10b8745`，请求 `01472067-94d1-4661-a14f-142687cbadd8`。它已进入原生准备，保留 `PREPARING.json`、source binding、空 invocations、advisory lease、构建日志及唯一 staging 内的源码复制与部分依赖；没有原 worker plan 或 PREPARED。原 EOF 输出在内存中丢失，不补造 direct-exit 或 FAILED。中断原因仍为 unknown，不据键盘操作推断取消者或具体被终止进程。

本增量只增加该 tuple 的第八个有限 reader/writer：原 52 个文件按精确 SHA 固化，包括旧十工具控制闭包、采用/执行记录、请求/范围计划、原生记录、lease/npm/progress、TaskExit 诊断及 23 个来源关键程序/lock 文件。原 packet、staging、lease、unknown 原件全部保留，后续也不复用这些半成品。resolution 仅可表述 `native-aborted-before-valid-candidate`，`nativePreparationStarted/partialArtifactsRetained=true`，`prepared/publicationPerformed/retryOriginal=false`，`interruptionCause=unknown`。

原 publisher PID29740 没有可信历史创建时间，lease.createdAt 只是租约时间。协议明确 `historicalPublisherCreationTimeUnavailable=true`，两次独立完整高权限 census 都要求该 PID 本身不存在，禁止 PID 复用豁免；潜在后代及原 packet/staging/npm 构建进程也必须退场。已知 manual/consumer 只按真实创建时间核对，严格拒绝旧后代。普通 writer 按 queue → rotation 持锁，绑定新采用代际、源码、task、nonce、20 分钟 epoch，初末独立见证及最终普通 census/ACK 至追加保持 60 秒；每个请求预算 120 秒。所有昂贵静态/Git 操作都在最终动态 census 之前完成。

staging 仅检查精确物理目录身份、浅层成员、缺 dist/manifest/有效回执及关键程序/lock，不对未信任 node_modules 或 source-snapshot 做完整 payload 哈希。权威 native state（含 sidecar）、所有 release manifest、current 与 Django prepared/deployment 元数据则完整哈希并拒绝本目标/packet/binding/staging 标记；初末保持一致。生产另行绑定原 20ee SUCCESS、installed chain、Django 和同源来源，不将旧 5beb 准备误认作上线。

独立复核、合并与同源码控制采用后，由唯一负责人分别运行：

```powershell
# 普通权限，外部全新目录；writer 自身只做限定 resolution 追加。
node tools/main-prebuild-queue.mjs --native-391-write <D:/codex-artifacts下全新目录>
# 对 writer 输出的每个 initial/final request，用独立高权限只读进程接续。
node tools/main-prebuild-queue.mjs --native-391-observe <REQUEST文件绝对路径> <精确requestSHA>
```

原 5beb 目标永久禁止重放；只有上述 resolution 完整通过，才可按原固定流程准备包含本次必要恢复代码的真正新 main。此处不删除租约，下一次合法准备由原 beginLease 机制处理。GUI 无窗口执行仅是后续执行方式调整，不作为历史中断原因证明。

新增 `tests/native-391-control.test.mjs` 六组必要控制检查通过，覆盖精确原件与元组篡改、partial/dist/PREPARED/lock、权威 metadata 缺项和标记、publisher PID 复用禁用及后代、晚到 namespace/构建/opaque cmd，以及见证权限/task/代际/时间。一次只读 metadata 检查为 3064 文件、108 目录，约 4.4 秒；不是最终现场独立见证。语法和 diff 检查通过。复用此前有效的候选、控制与 scanner 结果，不重跑整包或业务功能测试；本提交未采用、追加生产 resolution、准备或发布。

### 首次观察失败后的唯一同意图续接

首次 391 协调 writer 在 initial 观察阶段自然超时退出 1；原 request SHA 为 `6523f3e9...`。没有 OBS、ACK 或 resolution。五个短暂 PID 的身份未留存，不追认为无害，也不将该次协调失败变成原生准备成功或新的 native 失败。`failed-witness-391-1` 保全精确 request、writer 回执/输出、cafdd 控制代际及完整十工具闭包；固定 `PRIOR-OBJECTS.json` SHA `c4b188f0...` 绑定原 evidence root identity 和 3121 个排序对象，逐个复验内容摘要。

分类增量改为实际 Windows argv 的 executable/script 目标，不再按任意 cmd 名字或 PowerShell 正文中的 npm/正则文字判断构建。原 actor、父链、29740、原 namespace 与 opaque 门禁保持。相对或任意 inline 程序、不支持的 shell/重定向、引号及参数仍拒绝；通用 CMD 必须 `/d`，固定只读 PowerShell helper 必须 `-NoProfile` 并绑定固定代码、参数和实际父身份。高 observer 拒绝时只在外部目录 create-only 保存安全 REJECTION 投影，不生成成功 OBS、不保存任意 raw 命令。

只增加两项精确展开资格。第一项为独立 PG55873 的完整固定 CMD 模板、绝对 postgres 路径及 SHA；无 `/d` 时还须同轮只读证实 HKCU/HKLM Command Processor AutoRun 为空。其端口、独立 namespace、参数和重定向尾部不能改写，不支持其它重定向。第二项为原始 2397 字节、SHA `22234fbe...` 的 Node realpath bootstrap，以及固定 Node/父 node_repl.exe 字节和完整参数形态；只按源码 runMain 语义展开到实际绝对 kernel/trusted-worker entry，再将全部 tail 参数交回原 namespace/actor/opaque 分类，并保留 PID、创建时间、父身份及完整 argv 摘要。**该资格没有声称 kernel 本身只读，也不允许任意 eval。**

程序入口只读 census 已实测：单条 `login:false` Node 调用的诊断 PowerShell 父链正确归为固定只读 helper，四个实际 bootstrap 正确展开。并行工具出现的其它相对 Python、未知 shell 等仍拒绝；负责人在作者/审查任务静止后做新鲜见证，不终止其它任务，不为它们扩白名单。此观察不是最终现场见证。

新的协调只接受一次显式 `--native-391-resume <全新外部out>`。它复验原 writer 已退出、原 out 仅有 request、无旧 OBS/ACK/resolution 和上述 3121 对象完整原件后，create-only 写入 `failed-observation-resume.json` provenance；原 out、原对象和旧 request 都不覆盖。新 epoch/nonce 及初末见证重新生成，最终 resolution 绑定该 provenance，原 5beb 禁重放。当前采用链严格验证 `1711fc... → cafdd 546df6... → 本增量新采用` 每跳的 adopted/intent/transition/manifest/十文件、同 a90 配置与 task，拒绝更新字段或断链。

采用与现场操作仍由唯一负责人执行。高 observer 先取得 writer 输出的精确 request SHA，再用 **login:false、单条直接 Node 命令**执行 `--native-391-observe`；不在同一 PowerShell Command 中混入赋值、算 SHA 或其它诊断。新增七组 argv/PG/helper/shim/原件/provenance/链路负例，以及原见证 schema 的一项定向增量检查；不重跑整包或业务功能测试。本提交没有执行 resume、控制采用、原生准备或发布。

### 嵌套解释器的保守拒绝增量

独审复现了通用 CMD `/d /c` 后绝对 `cmd.exe /c npm` 被当作普通绝对目标的缺口。本增量对通用 CMD 目标的 cmd、PowerShell、pwsh、Node、Python、WSL 及 npm/npx/vite/vinext 命名包装直接拒绝，不递归解析或推断内层执行。PowerShell `-File` 仅接受绝对 `.ps1`，同类解释器/包管理器包装名及 `.exe/.cmd/.bat` 均拒绝；不读取任意 `.ps1` 正文。PG 唯一固定资格保持。

新增一组定向负例通过，覆盖 CMD→CMD/npm、CMD→绝对 Node 的 eval/相对 npm、其它解释器/包管理包装，以及错误 `-File` 类型；语法和 diff 检查通过。此前 7+1 有效结果复用，不重跑整包。本增量未采用或执行现场协调。

### 第二次观察失败的独立有限分支

原 resume writer27260 的 initial 观察因仍有其它任务活动被保守拒绝，随后自然 Observer deadline/退出1；旧 out 只有固定 REQUEST、REJECTION，没有 OBS/ACK/final/resolution。`failed-witness-391-2` 固定21原件及3133对象清单，SHA `55d57aba...`。未保存旧高 observer 的 PID/创建时间，不推造；后续须以完整新鲜 census 排除旧 request/out 调用及等待器，并核旧 writer/潜在后代退出。

新增分支只接受 `--native-391-resume-2 D:/codex-artifacts/frontend-hmr-recovery-20261020/witness-391-resume-2`（全新外部 out）。在同一 queue→rotation 锁内校验两次失败、3121⊆3133、全部对象 SHA 和原 evidence root identity，原 `failed-observation-resume.json` 及所有原件保持；只 create-only 追加 `failed-observation-resume-2.json`。p1 始终对照旧 c4 的 request/epoch/采用事实验证；p2 绑定当前新源码、writer/epoch/out/采用，并同时指向 p1 及两套清单。reader 独立复验两套清单及全部对象。采用链严格增加 `1711fc → 546df → c4 cdfec → 新采用`，配置 a90、native512 和 task 不变；没有循环或任意重试入口，也不重放原5beb准备。

分类器、白名单、原 actor 门禁及 native-tools 未修改；与 c4 的对应源码区间逐字节相同。仅新增四组第二分支负例，覆盖固定失败/p1绑定、3133最后对象损坏、旧 writer/后代/等待器、p2 source/adoption/epoch/旧 out 混用；全部通过，语法及 diff 检查通过。此前检查复用，本轮没有动态进程诊断、控制采用或现场写入。现场仍由唯一负责人在用户确认的稳定窗口执行，使用 `control-materials-391-resume-2` 及新的外部 out。
### 第三次观察失败与有界完整重采

本增量只接 `failed-witness-391-3` 的固定 REQUEST `364c6c26...`、writer8972、REJECTION 和22份原件；3146对象清单 SHA 为 `9cd087547a02bfb98905208ece827dfc4c3968ee3f22cc4d5bfa282783203e91`。reader独立复核3121⊆3133⊆3146及所有对象内容，保留p1、p2原字节，仅create-only追加 `failed-observation-resume-3.json`。固定采用链增加dd的 `76d33026...` 至新节点，配置a90、native512、task及分类器字节不变。工具回执转录明确不提供历史observer PID/birth或native child exit证明；原5beb的unknown、packet、staging和lease不修改、不重放。

同一request/nonce/epoch的observer先create-only领取固定phase claim，最多三次完整census，累计额外自然等待不超过20秒，原request120秒、首次dynamic起点60秒和epoch均不延长。只有birth完整但cmd/exe缺失的opaque集合及同样缺失、在本轮父链可核的后代可保留拒绝样本后重采；混入原actor、29740、namespace、完整但无法解释入口、task/代次/原件变化等硬拒绝立即停止。初次完整后仍须重核全部静态材料，再取得末次完整census；第三次才首次完整不能成功，也没有第四次采样或第四个续接入口。

每份失败样本均以安全投影create-only保存，唯一OBS或REJECTION引用样本。writer在原ACK前核全部claim和样本；归档reader独立验证SHA、顺序、类型、PID唯一性、父链、计数、等待、静态重核屏障和原时限；已有claim、样本或终态拒绝再次观察。当前无法区分枚举竞争与权限缺失，生产父进程归属不构成资格；最终仍要求完整分类通过，ordinary ACK门禁保持。

新增12项定向检查及直接受影响的1项OBS schema检查全部通过，原始工具输出chunk `f1879f`、exit0；覆盖有效二/三次trace接入OBS及reader、第三次首次完整、超限/时限、已有REJECTION、混合硬拒绝、opaque后代、primitive类型、并发claim、三套归档完整性及p3固定绑定。语法和diff检查通过；之前未变检查复用，本轮没有动态进程诊断、整包或业务功能测试，也未执行控制采用、现场resolution或原生准备/发布。普通入口为 `--native-391-resume-3 D:/codex-artifacts/frontend-hmr-recovery-20261020/witness-391-resume-3`，实际操作仍由唯一负责人执行，失败后停止推进。
### CMD 真实 PowerShell 入口识别的具体修复

第三次协调的 initial OBS/ACK 已成功，但 final 的完整样本对40320的相对 shell 入口作硬拒绝，writer34444随后自然超时退出1；没有final OBS/ACK或resolution。`failed-witness-391-4` 固定31原件及3166对象清单，SHA `b4bb61975767d139d75e9b89a0bf47248e054bfe553d2b2ce47f5093cc26a49f`。原材料只有40320/45440命令摘要及绝对脚本提示，没有完整尾参匹配证据；后续诊断时两进程已退场，不能追认为等价或无害。旧hard拒绝和全部旧样本不改，统一工具转录也不冒充native child exit证明。

新资格仅限系统CMD的 `/d`、可选 `/s`、唯一 `/c` 单命令相对 `powershell[.exe]` 和唯一绝对 `.ps1` File入口。必须在未来同一完整census取得唯一真实直接PS子进程，双方PID/birth/父ID完整且child严格晚生，实际PS host为现行task绑定的绝对路径和字节，完整参数尾部逐项精确匹配；不靠PATH、生产父归属或历史script hint。组合、重定向、展开、inline/encoded、相对script、缺失/opaque/多个child、参数不符和身份复用均拒绝。展开后仍由原PS分类器判断，子进程及后代继续独立分类；只记录参数SHA和安全身份投影。

唯一新入口为 `--native-391-cmd-entry-repair D:/codex-artifacts/frontend-hmr-recovery-20261020/witness-391-cmd-entry-repair`。同双锁内复核四套对象及p1/p2/p3原字节，create-only追加 `cmd-entry-repair.json`，固定d12的57c051采用至新一跳；a90配置、native512、task、其它分类规则与3次/20秒/120秒/60秒采样边界保持。旧initial只按精确SHA独立通过旧schema；新OBS必须包含host资格及CMD证明，使用新epoch/out重做两轮，不复用旧动态样本，不提供通用下一次续接。原5beb目标与partial仍不重放、不清理。

新增8项定向检查通过，原始工具输出chunk `1abfa1`、exit0；覆盖CMD还原、伪父链/PID复用、参数大小写、多child、错误host、相对script、无/opaque child、旧initial完整trace与新OBS要求、3166对象末字节破坏及固定修复provenance。仅更新两个直接受影响的测试fixture字段，复用之前未变结果，不运行整包或业务测试。冻结前只做语法、diff与物理LF/Git blob字节核对；未运行现场census、控制采用、resolution、原生准备或发布。
### 已绑定系统 PowerShell 的硬链接读取修复

eace控制已采用为b8c5cb3a/4f4c7ff4，但尚未启动CMD修复writer；只读预检在读取系统PowerShell时被证据文件的单链接规则拒绝。实际 `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe` 是ordinary file、非symlink、realpath一致、nlink=2，495616字节；SHA `8bb6fa8c283b4d92120b1ef249a9b311b0f804d4cabbe9981159976c8be76a5e` 与已采用task.hostSha一致（原始只读输出chunk `208db8`）。

本增量仅为固定系统host增加专用读取，要求固定路径/SHA、普通文件、无重定向及读取前后dev/ino/birth/size/mtime/ctime/nlink稳定，允许操作系统合法硬链接。原 `nativeRead` 及全部证据/状态文件链接规则逐字节保持，校验摘要为 `29eae39434b6c115f152bda11bca2eead069ec196b1cd4add26791dcf6bc3204`。`cmd-entry-host-qualification` 固定15原件和PREFLIGHT SHA `7b31b41daa3b637c240a0c4e259e973f090dda9ea67560c7df050ab6a50ffa1f`，将eace的 `0d4e1a7f...` 采用作为新一跳中间节点。PREFLIGHT中的out/provenance/resolution absent仅为归档时的历史事实；新writer仍使用原fresh-out、双锁和resolution门禁。四套失败材料、3166对象、原provenance、分类器及协调次数不改。

真实 `native391PgQualification` 已于 `2026-10-20T17:17:53.311Z` 只读实跑通过，原回执chunk `f1e3dd`、exit0；未运行census或业务。新增3项系统host及固定preflight/hop检查通过（chunk `f1c045`、exit0），覆盖真实OS硬链接、重定向/类型/链接数/identity/字节负例及错误归档/集合。语法和diff检查通过，不重复先前8项或整包。CLI与out继续使用原 `--native-391-cmd-entry-repair` 和 `witness-391-cmd-entry-repair`；本提交未采用、启动writer、准备或发布。
### 已退役 publisher 数值PID复用的精确身份修复

CMD协调的initial OBS/ACK成功，final先取得完整preliminary、重核静态图，随后完整样本因数值PID29740出现而硬拒绝；writer56436于 `2026-10-20T17:26:47.210Z` 自然超时退出1。`failed-witness-391-5` 固定33原件和3194对象，清单 SHA `85b74233bbb90e337de3bf93400857904ba7f6d5d0357cc70eeff192fd632368`。旧拒绝仍有效，不把后来诊断追认成旧现场资格；旧initial动态不复用，全部p1/p2/p3/CMD provenance原字节保留。

原租约、unknown和已钉住发布源码的 `ownerPid:process.pid` / beginLease记录，只能推出旧Node的**出生时间上界**：旧进程在14:33租约事件时已经存在，因此其birth不晚于保守上界 `2026-10-20T14:39:43.525Z`。unknown回执不是旧进程终止时间；不填写精确历史birth或exit，继续保留 `historicalPublisherCreationTimeUnavailable=true`。

每轮完整census独立生成封闭的 `absent` 或 `pg-reused` 资格，绑定request/nonce/epoch、observer身份、投影摘要及时间。出现29740时须完整可见、严格晚于旧birth上界、实际规范PG镜像与4125字节资格吻合；同census父PG须为32400的已知完整身份及规范三参数启动入口，并与本轮新鲜的postmaster.pid PID/startUnix/dataDir/5432/ready交叉核对。原生pidfile原字节和摘要随资格归档供reader复核；父进程归属、文件名或旧诊断不能替代资格。Node/其它镜像、opaque、过早、父不明或原生材料不符均硬拒绝。父PID29740的子进程仅在本轮父有此资格且child.birth不早于新父时排除旧后代可能性，每行继续原namespace/入口分类，不整树豁免。

资格逐sample重新生成，末sample资格必须等于OBS；下一轮PID不存在就记录absent，不能沿用先前PG身份。ordinary ACK从自己的新鲜census独立重建资格并归档安全投影；reader同核primitive类型、PID唯一性、图、时间和原生证据。新入口 `--native-391-retired-publisher-repair D:/codex-artifacts/frontend-hmr-recovery-20261020/witness-391-retired-publisher-repair` 仅接这次固定失败，create-only追加 `retired-publisher-identity-repair.json`；采用链固定增加238的c1ec901节点至新一跳。配置a90、native512、task、CMD资格及采样次数/时限保持，不提供通用下一次续接，不重放5beb或清理partial。

按本次明确范围，同步修正已有精确出生证据的failed writer44996/27260/8972/34444/56436数值PID永久唯一假设。各birth常量逐一对照固定REQUEST摘要核实；只有当前birth严格晚于旧值且身份元数据完整，才排除旧身份。各历史guard角色集合及旧OBS校验范围保持；指向这些父PID的child必须在本轮有完整新父且出生不早于新父，使用100ns精度比较，namespace及普通入口继续独立分类。29740未知历史birth的PG专项不因此扩展到Node或其它镜像。

新增10项定向检查通过（chunk `098af6`、exit0），覆盖真实身份结构、伪PG/镜像变化/过早/父错/opaque、同毫秒早子、q跨census/epoch混用、primitive类型、PG→absent trace、3194归档内容、固定新provenance、五个known writer复用及未来birth；两个直接受影响的OBS/trace正例通过（chunk `de07f9`）。真实只读PgQualification和postmaster读取通过（chunk `47ba4f`、exit0），未运行census、SQL或业务，未启动/停止服务。其余既有结果复用，不跑整包；本提交未采用、启动writer、准备或发布。
### 391 ACK 检查作用域回归修复

93控制采用后，ordinary retired-publisher writer在创建新provenance或REQUEST之前，经inventory读取旧0038 resolution时失败。原因是本任务上一轮全局文本替换，把391专属ACK的census/retiredPublisher读取误插入0038 reader，并同时污染了旧0038 writer的ACK构造。本增量精确恢复整个文件头至 `FIXED_NATIVE_391_BEGIN` 的340532字节为238原件，SHA `f4aa3711c96cbf586596ca63f45208b8fbadb1a783463eff5cdcc526c40ef551`；不补默认字段，不降低旧ACK校验，391新协议检查仅保留在391作用域。

真实公开 `readFixedInstallerCheckRejection0038Resolution` 对固定queue及实际dispatch/result返回true（chunk `d8333c`）；薄只读 `--native-391-inventory` 直接调用原同一inventory实现，不吞错、不调用writer、不创建out。另一个同轮替换遗留把原provenance两元对误成三元数组；现由Begin与只读inventory共用固定四对helper，实际核四个原hash，逐个坏bytes均拒绝。旧空out身份在唯一新provenance写入前及后续static核对，reader只复验归档事实。

`retired-publisher-inventory-qualification` 固定18原件和PREFLIGHT SHA `5c0731a69b17dc3d2e092e3f6ebb84ed708516a66989987f963ee20ab77edf49`；3194对象、四个旧provenance和无新观察事实保持，采用链仅加入93的 `41102692...` 节点。保留原空out不删除，未来同一限定flag使用精确新地址 `--native-391-retired-publisher-repair D:/codex-artifacts/frontend-hmr-recovery-20261020/witness-391-retired-publisher-repair-fixed`；唯一新capsule文件名及wx门禁不变，没有新观察失败续接次数。

四项直接回归/范围/归档/capsule检查通过（chunk `d61dab`），新fixed out的受影响provenance检查通过（chunk `eb8639`）；最终完整只读inventory回执为valid且 `verifiedPriorCapsules:4`（chunk `702170`、exit0）。原其它有效结果复用，不重跑整包或业务。本增量未修改已安装bundle，未采用、启动writer、运行census或准备/发布。
### sealed resolution 的 metadata 键名排序修复

两轮独立观察及ordinary ACK均已成功，唯一391 resolution已create-only封存，但最终reader把 `Object.keys(item).sort()` 与未排序的 `['path','size','sha256']` 比较而误拒绝。生产代码仅给此预期数组增加 `.sort()`，字段集合完全不变；不默认缺项、不改payload、不修改source/op/adoption绑定，也不增加provenance或观察次数。已逐项核对整个reader其它keys比较，无同类未排序错误。

真实公开 `readFixedNative391Resolution` 对实际queue/dispatch/result完整读回返回true（chunk `b14b02`、exit0），包括两轮OBS/ACK、全部对象与固定归档链。sealed resolution为1593字节，SHA `d8744634c940e118dd9883cd72fa0d2ae4f42a1a9efe78b6d8e075e2e4aa4dcc`，读取前后原字节完全一致。两个定向检查通过（chunk `faa90e`、exit0），覆盖实际reader字段断言的不同插入顺序正例、缺失/额外/错名负例及整个reader排序比较范围。语法和diff检查通过，之前未变结果复用；本增量未重写任何sealed记录、proof、capsule、OBS或ACK，未新观察、采用、准备或发布。
