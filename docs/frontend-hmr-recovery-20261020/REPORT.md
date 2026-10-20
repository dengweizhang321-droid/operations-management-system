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
