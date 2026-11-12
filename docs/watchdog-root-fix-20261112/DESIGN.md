# 看门狗失明根治：漂移后自动重新生成只读副本（2026-11-12）

用户 11-12 选定「方向二」：只改看门狗，源码漂移后由看门狗用已审的生成器自动重新生成只读诊断副本，
用机械证明代替「每次人工逐函数复核」；失明或事件未关闭期间每 24 小时提醒一次、不设上限。
不做短期重新资格化；不查钉钉 `dws profile list` 退出码 5。

## 背景（已核实）

- 看门狗不直接调生产控制器的 Status，而是跑生成的只读副本（`watchdog-status-control.ps1`、
  `watchdog-status-backend.ps1`、`watchdog-core-overlay.ps1`）。副本把 Django `Resolve-OwnedProcess`、Worker
  `Get-WorkerStatusInternal`、守护 `Resolve-SupervisorProcess` 等所有权判定函数从某一版源码拷出、挖掉删除分支、
  换上只读元数据补读（`tools/watchdog-native-metadata.ps1`）。
- 副本只对生成时那版源码成立，故在 `driver-binding.json` 钉死源码哈希；任何合并（主检出的
  `tools/operations-system-control.ps1`、`tools/worker-local-service.ps1`）或 Django 发布（现役 `app\tools\django-local-service.ps1`）
  都会触发 `diagnostic_predecessor_changed` → `alert_only`，恢复分支走不到。10-18 与 11-01 两次长期失明均为此。
- 10-11 复核（`docs/release-no-data-production-20261011/ASTRA_WATCHDOG_BINDING_FAILURE_REVIEW.md`）要求「不自动更新期望哈希」，
  它防的是：观察性 Status 在元数据不可读时把活进程当成已退出、删除进程记录（10-11 删了 23 条）。
  该风险现已在源头修掉：main 上 Django `Resolve-OwnedProcess`（`$ReadOnly = $ReadOnly -or $Action -imatch 'Status$'`）
  与守护 `Resolve-SupervisorProcess`（`$readOnly = $SupervisorRequest.Action -ceq "Status"`）的删除分支前都有只读闸。
  副本剩下的独有能力是受限权限下用原生接口补读进程元数据。
- 11-12 用当前生产源码试跑 `prepareSupervisorStatusDriver`（输出到临时目录）：所有锚点仍精确匹配。
  但产出的 `watchdog-status-control.ps1` dot-source 了 `$PSScriptRoot\native-isolation.ps1`、`$PSScriptRoot\process-deadline.ps1`，
  前者是 main 新增依赖、不在任何安装包里——按旧办法人工重新资格化也会装出跑不起来的驱动。
- 现役驱动的守护钉子指向主检出 `D:\运营管理系统\tools\django-runtime-supervisor.ps1`，而真正运行的守护是
  `D:\teruisi-runtime\django-sales\app\tools\django-runtime-supervisor.ps1`（看门狗自己的 `$SupervisorPath`）。应指向现役副本。
- 现役安装的 `operations-system-watchdog.ps1` 不是仓库原文，而是被守护生成器改写过（两处守护 Status 调用改走驱动），
  所以哈希对不上 main 任何提交。

### 告警永久静默的三条路径（`Send-WatchAlert`）

1. 升级上限 `$done -lt 3`，用完即永久 return。
2. 升级记录在身份阶段失败后 `notification=identity_failed`，下一轮重试的 `$suffix` 为空，读到的是最初的基础记录
   （状态 `unknown`），于是整个事件被改写为 `unknown`、升级记录从未被重试。
3. `identity_failed` 重试 3 次用完、或一次 `sent` 之后，只要事件不关闭就永远不再发。

## 设计

### A. 运行时自动生成驱动（取代安装时预生成 + 安装时钉哈希）

1. **源集合（固定路径，不接受外部输入）**：`control=$ControlPath`、`worker=$WorkerPath`、
   `transport=$ProjectRoot\tools\process-deadline.ps1`、`isolation=$ProjectRoot\tools\native-isolation.ps1`、
   `backend=$BackendRoot\app\tools\django-local-service.ps1`、`supervisor=$SupervisorPath`（现役副本）。
   主检出这几个文件是 Worker 轮换安装的受保护入口，即生产正在用的字节，跟随它们是对的。
2. **生成器套件随安装包冻结**：`prepare-watchdog-status-driver.mjs`、`prepare-watchdog-native-status-driver.mjs`、
   `prepare-watchdog-supervisor-status-driver.mjs`、`watchdog-native-metadata.ps1`，加一个新的 CLI 入口
   `watchdog-driver-generate.mjs`。信任点从「每次人工审输出」移到「安装时审一次生成器与规则」。
3. **摘要与缓存**：`digest = sha256(按名排序的 name=sha256 行，含源集合与生成器套件)`。驱动放在
   `$WatchdogRoot\drivers\<digest>\`，含 `driver-manifest.json`（源哈希、生成文件哈希、生成器套件哈希、生成器 proof、时间）。
   每轮：算摘要 → 目录存在且清单逐文件哈希相符、无多余文件、无重解析点 → 直接用；不存在 → 生成。
   已存在但校验不过（篡改/损坏）→ 失败关闭 `invalid_diagnostic_bundle`，不自动删除。
4. **生成流程**：在 `drivers\.staging-<guid>\` 里用安装时记录的 node 绝对路径跑 CLI（`Invoke-DeadlineProcess`，
   ≤ 30 秒，纳入快照 120 秒总预算）。生成器把副本里 `$PSScriptRoot` 相对 dot-source 的依赖
   （仅允许 `native-isolation.ps1`、`process-deadline.ps1`）从源集合拷进输出目录；发现其他相对依赖 → 拒绝。
   生成器不再改写看门狗脚本（`watchdogTemplateFile` 变为可选，运行时不传）。
   生成后依次：B 节的机械检查 → 所有 .ps1 用 PowerShell 解析器解析无错 → 重算源哈希确认生成期间未变
   （变了就丢弃、本轮记 `diagnostic_sources_changing`，下轮重来）→ 写清单 → 原子改名为 `drivers\<digest>`
   （已被并发生成则丢弃 staging）。任一步失败都清掉自己的 staging。
5. **拒绝是终态、要告警**：生成器自身 proof 失败（`*_source_shape_changed`、`original_predicate_changed`、
   `Supervisor ownership predicate changed`）或 B 节检查不过 → `diagnostic_regeneration_rejected`，按摘要缓存拒绝结果
   （`drivers\rejected-<digest>.json`，只含固定枚举原因），同一摘要不再每分钟重跑。告警文案：
   「源码结构变化超出自动生成的安全范围，监控需人工复核；这不代表服务异常」。
   node 缺失等生成器不可用 → `diagnostic_generator_unavailable`，同样失败关闭。
6. **永不回退 legacy 控制器**：新布局下删除 `driver_not_installed → legacy` 分支（10-11 复核第 1 条）。
7. **驱动自身的运行时校验保留**：驱动运行前后仍核对自己的 `driver-binding.json`；运行中源码变了就抛
   `diagnostic_predecessor_changed`，下一轮按新摘要重新生成。稳态下一次合并或发布最多造成 1–2 轮失明。
   为避免这 1–2 轮开事件：与现状一致，`failures<2` 为 `confirm_failure` 不告警。
8. **守护 Status 走驱动**：仓库版 `operations-system-watchdog.ps1` 本身在已解析出驱动时，对快照与
   `Restore-WatchSupervisor` 两处守护 Status 调用走 `<驱动目录>\watchdog-status-backend.ps1 -Action Status -DiagnosticTarget Supervisor`，
   安装包里的看门狗脚本就是仓库原文。生成 `-Action Run -Execute` 的启动路径不变（仍用现役守护脚本）。
9. **保留与清理**：`drivers\` 下保留正在用的和最近 4 个，其余删除（仅限 `drivers\` 内、路径包含校验、不跟重解析点）。
   拒绝缓存同样只留最近若干条。

### B. 机械安全检查（代替人工逐函数复核）

三层，任一不过即拒绝：

1. **生成器既有 proof**（不动）：每处改写必须恰好匹配一次，改写后逆向还原必须等于原文。保证生成的只读函数
   = 当前生产函数原文 − 固定几处删除分支。
2. **禁止写操作**（新，PowerShell AST）：对生成的只读函数体（overlay 里的 `Resolve-OwnedProcess`、
   `Get-WorkerStatusInternal`、`Resolve-SupervisorProcess`，以及 backend 包装里 Supervisor 分支的 Status 块），
   拒绝任何动词为 `Remove|Stop|Set|Clear|Move|Rename|Copy|New|Out|Add|Start|Restart|Register|Unregister|Kill|Save|Write`
   的命令（`Write-Output/Write-Verbose/Write-Debug` 除外）、`Remove-PreviousBootProcessRecordIfSafe`、
   `Remove-OwnSupervisorReceipt`、`taskkill`、`Invoke-Expression`，以及 `[IO.File]`/`[IO.Directory]` 的
   `Delete|Move|Replace|Write*|Create*|Append*` 静态方法和任何 `.Kill(` 调用。确需放行的现存调用列入显式例外，
   逐条写理由。
3. **调用名单钉语义不钉字节**（新）：上述函数体里出现的每个命令名，必须是 overlay 内定义的函数、
   只读内置命令（`Get-*`、`Test-Path`、`ConvertFrom-Json`、`Select-Object`、`Where-Object`、`ForEach-Object`、
   `Sort-Object`、`Measure-Object`、`Join-Path`、`Split-Path` 等显式列表），或本次审过的库函数白名单（按当前源码枚举、
   写入代码并在本文档记录）。出现新名字 → 拒绝。这是「人工复核」仍然必要的唯一情形：所有权判定函数
   开始调用从未审过的代码。这几个函数很少改，不会重新制造日常失明。

传递调用的安全性（白名单库函数内部写不写）不在本检查范围，靠两点：这些库函数本身在生产 Status 路径上被调用、
且 Status 的只读契约由仓库测试守护；以及异常时生成器 proof 会先失败。

### C. 告警不再永久静默

1. 去掉 3 次上限：事件未关闭、`Recover` 模式、决策可告警（保持现有 `failures -ge 2` 等条件）时，
   只要当前记录处于终态——`unknown`、`sent`、或 `identity_failed` 且重试次数用尽——且距上一次提醒
   （无则取基础记录最后一次尝试）满 24 小时，就发一条新记录 `-reminder<N>`（沿用计数，不重放旧记录）。
   恢复通知不变。
2. 新增状态字段记录「当前记录后缀」，身份失败重试对准当前记录，不再读回基础记录。
3. 兼容现役状态：`notificationEscalations=3`、`notification=unknown`、旧 `-escalation1..3` 记录存在时，
   下一次提醒编号从 4 起，不覆写任何旧记录。
4. 提醒文案写明「持续提醒（第 N 次）：该事件自 X 起未恢复」，其余原因段照旧。

### D. 安装

- 新布局安装包：看门狗脚本（仓库原文）、`process-deadline.ps1`、`watchdog-install.ps1`、启动器源码与 exe、生成器套件。
  不再包含预生成驱动。`Assert-WatchBundle` 继续接受旧布局（5/9 个文件）以校验前驱安装，并接受新布局。
- `installation.json` 增加 node 绝对路径（安装时解析、非重解析点）；不钉 node 哈希，升级 node 不应导致失明。
- 安装准入时的健康快照跑的是候选代码，它会自动生成驱动并健康，故本次安装正常通过准入；
  既有 `-RequalifyDriftedAssets` 准入保留不动，作备用。安装时的生成会写 `$WatchdogRoot\drivers\`，属于安装授权范围。
- 安装是生产写操作，合并后另求授权；不经发布器、不重启任何业务服务。

### E. 不动的东西

- 不改 Worker 受保护入口（`operations-system-control.ps1`、`worker-local-service.ps1`、`process-deadline.ps1` 等 12 个），
  不改 `django-local-service.ps1`、`django-runtime-supervisor.ps1`、`native-isolation.ps1`——改了会触发 Worker 守卫或控制器资格化。
- 不改恢复判定与预算（`Get-WatchDecision`、`Invoke-WatchRecovery`）。

## 与「发布后重新拉起 Django 守护」的分工

看门狗恢复视力后，发布停掉守护、`desiredState=running` 的情况下会在约 3 分钟后走 `recover` 并调
`Restore-WatchSupervisor`。建议：发布收尾确定性拉起是主路径，看门狗是兜底。两边都须先拿同一把
`Local\TERUISI-DjangoSales-<hash>` 互斥、并确认守护 Status 为 `stopped` 才启动（`Restore-WatchSupervisor` 已如此）。
该项的对话需要对齐这一点。

## 独立设计审查后的修订（11-12，优先于上文）

审查结论「修改后可采用」。以下条目覆盖上文对应内容。

1. **源集合补全**：加 `backendIsolation=$BackendRoot\app\tools\native-isolation.ps1`（Django 库第 34 行实际加载的那份）。
   主检出那份改名 `isolation`。生成器的 `coreTemplateFile` 固定等于 `backendFile`、`controlTemplateFile`
   固定等于 `controlFile`（不另收模板路径）；控制副本已含 `function Get-CoreReadinessDiagnostic(` 时不再重复注入。
2. **源字节先拷贝再生成**：生成前把全部源文件拷到 staging 下的 `sources\`，对拷贝算哈希与摘要；生成器从拷贝读，
   写进驱动的绑定路径（`$diagnosticSources`、`$diagnosticBackend`、`$diagnosticRoot` 等）仍是生产路径。
   生成器 API 增加「读取路径 / 绑定路径」两组参数，旧调用方式保持兼容。生成完成再对生产路径重算一次，
   与拷贝不符 → `diagnostic_sources_changing`（可重试）。
3. **拒绝缓存只收结构化失败**：只有生成器 proof 失败码与 B 节检查失败写 `rejected-<digest>.json`；超时、node 崩溃、
   IO 错误、解析器异常一律可重试、不缓存。
4. **生成放在快照 120 秒预算之外**：`Get-WatchSnapshot` 在准入为 running 后、设置快照截止时间之前调用
   新的「确保驱动」步骤（自己 ≤ 45 秒预算），结果交给 `Resolve-WatchStatusControl`。
5. **B 节扩展为传递闭包检查**（取代 B-2 的「只查几个函数体」）：
   - 把驱动运行时加载的全部脚本（控制副本、backend 包装、overlay、Django 库、Worker 库、守护库、两份
     native-isolation、process-deadline）解析成 AST，按「后定义覆盖先定义」建立函数表，从驱动入口
     （控制副本 Status 分支、backend 包装三个 DiagnosticTarget 分支）沿命令调用求传递闭包；各库在该加载模式下
     会执行的顶层语句也纳入。
   - 闭包内禁止「结束进程 / 删除或改写进程记录」一类原语：`Stop-Process`、`taskkill`、`Stop-Service`、
     `.Kill(`、`Remove-PreviousBootProcessRecordIfSafe`、`Remove-OwnSupervisorReceipt`，以及任何以 `$PidPath`、
     `$SupervisorPidPath` 或 `*.pid.json` 为目标的 `Remove-Item`/`Move-Item`/`[IO.File]::Delete|Move|Replace|Write*`。
     静态分析不区分分支，确需放行的现存命中按「函数名 + 命中原语 + 所在只读闸」列入显式例外表，
     每条写理由；例外表是安装时一次性人工审查的对象。闭包内出现动态调用（`Invoke-Expression`、
     `& $变量`、`. $变量`）同样走显式例外表，未列入即拒绝。
   - B-3（新名字拒绝）仍只作用于所有权判定函数体，不扩到整个闭包，以免日常合并重新制造失明。
   - 断言控制副本的能力标记回退分支（直接调 10 个域控制器 Status）在生成结果里走不到：生成时确认
     backend 包装含能力标记，否则拒绝。
6. **新错误码与资产名接入告警链路**：`Get-WatchSnapshot` 错误码白名单、`Get-WatchBindingDiagnostic` 的码表与资产白名单
   （加 `supervisor`、`isolation`、`backendIsolation`）、`Get-WatchFailureText` 文案、`Get-WatchInstall*` 准入识别。
   新码：`diagnostic_regeneration_rejected`（需人工复核）、`diagnostic_generator_unavailable`、
   `diagnostic_sources_changing`（短暂、自动重试）。拒绝原因用固定枚举，不输出路径和哈希。
7. **安装准入拿得到 node**：node 路径在安装上下文里解析（固定候选 `C:\Program Files\nodejs\node.exe`，存在、非重解析点），
   计入 planId，准入快照和运行时走同一个解析函数；运行时从 `installation.json` 读。
8. **告警终态补 `sending`**：C-1 的终态清单加入 `sending`（进程在写 sending 后被硬终止的遗留）。
   维护文件泄漏导致的 `suspended` 永久静默不在本次范围，记为残留风险。
9. **同一事件恢复次数上限**（修正 E 节「不改恢复判定」）：同一事件累计 3 次恢复尝试均未通过后，
   决策改为 `recovery_exhausted`（只告警，不再拉起），直到事件关闭。防止守护秒退时每 5 分钟拉一次
   （10-30、10-31 有先例）。现有 15 分钟 3 次预算和 5 分钟冷却保留。
10. **失明期文案**：事件若曾因诊断绑定失明（状态里记一个布尔位），恢复通知与提醒注明「其间包含监控失明时段，
    不等于服务故障」。
11. **未提交字节不单独拦截**（不采纳审查建议）：`Invoke-WatchRecovery` 本来就 dot-source 主检出的
    `$WorkerPath` 做真实恢复，状态读取跟随同一份字节不增加新的信任；主检出与 Worker 发布不一致由 Worker 守卫
    在重启时拦。记为残留风险。
12. **残留风险（不在本次范围）**：钉钉身份阶段退出码 5 仍会让每条提醒失败；本次只保证「每天会再试」。
13. **同步修改清单**：`watchdog-binding-alert-delivery.test.ps1`、`watchdog-diagnostics.test.ps1`、`watchdog-install.test.ps1`、
    `watchdog-safe-upgrade.test.ts`、`django-runtime-supervisor-library-mode.test.ps1`（引用守护生成器）、`watchdog-status-driver.test.mjs`、
    `watchdog-native-status-driver.test.mjs`；`n8n-manual-action-alert.ps1` 以 `-FunctionsOnly` dot-source 看门狗，新顶层代码不得有副作用。

## 演进契约的变化（需审查者重点看）

10-11 契约「永不自动更新期望哈希」被替换为：「自动更新仅在生成器 proof + 禁写检查 + 调用白名单三项全过时发生；
任一不过则按原契约失败关闭并告警」。仍保留的原契约部分：绝不回退 legacy、缺驱动即失败关闭、驱动运行前后自校。

## 实现记录（2026-11-12）

| 设计项 | 实现位置 |
|---|---|
| 运行时生成 + 摘要缓存 | `tools/operations-system-watchdog.ps1`：`Invoke-WatchDriverEnsure` / `New-WatchDriver` / `Initialize-WatchDriver`（45 秒独立预算）、`Remove-WatchStaleDrivers` |
| 生成器 CLI | `tools/watchdog-driver-generate.mjs`（退出码 0 成功、3 结构化拒绝、其余为瞬时失败）；`prepare-*.mjs` 增加 `sourcePath`/`readFiles` 以读暂存副本 |
| 机械安全检查 | `tools/watchdog-driver-closure.ps1`：`Invoke-WatchDriverClosureCheck`（4 个 profile 按加载顺序的静态绊线扫描 + 所有权函数调用白名单；见下文定位与盲区） |
| 拒绝缓存 | `Get-WatchDriverRejection` / `Set-WatchDriverRejection`（`rejected-<digest>.json`，固定枚举原因；瞬时失败不缓存） |
| 告警重设计 | `Send-WatchAlert`（`-reminder<N>`、24 小时、无次数上限）、`Get-WatchMessage` 的持续提醒与失明说明 |
| 恢复上限 | `Get-WatchDecision`：`incidentRecoveryFailures` ≥ 3 → `recovery_exhausted`（只告警） |
| 安装 | `tools/watchdog-install.ps1`：11 文件包（5 基础 + 6 生成器套件），套件全有或全无，`nodePath` 写入 `installation.json` 并计入 planId |
| 测试 | `tests/watchdog-driver-lifecycle.test.ps1`、`tests/watchdog-driver-closure.test.ps1`（新）；install / diagnostics / binding-alert-delivery / operations-system-watchdog 测试已更新 |

### 闭包检查的定位：静态绊线，不是证明

它只能挡住「已知写法」的误改，不能证明驱动副本安全。

**加载顺序**：按各脚本真实的 dot-source 顺序建函数表，同名函数以该 profile 下后加载的一份为准（PowerShell 语义）；先加载的被覆盖，不再扫描。所有权函数必须由 overlay 定义提供，否则 `ownership_function_missing`。扫描范围是所有会执行的顶层语句加调用传递闭包，并按各脚本门控（Worker `FunctionsOnly`、backend `TERUISI_DJANGO_SERVICE_LIBRARY_ONLY`、supervisor `$librarySupervisorMode`、控制脚本 `$Action -ne "Panel"` 分发、wrapper `DiagnosticTarget` 分支）取舍。

**已覆盖的形态**：
- 结束/启动进程：`Stop-Process`、`Start-Process`、`.Kill()`/`Terminate`、`[Diagnostics.Process]::Start`、`Invoke-Item`、taskkill/wmic/pskill 字符串常量、`Invoke-CimMethod`/`Remove-CimInstance`/`Set-CimInstance`/`Invoke-WmiMethod`/`Remove-WmiObject`（不论方法与实例）
- 删除/移动：`Remove-Item`、`Move-Item`、`Rename-Item`、`Clear-Content`、`.Delete()`/`.MoveTo()`、`[IO.File/Directory]::Delete|Move|Replace`
- 写入：`Set-Content`、`Add-Content`、`Out-File`、`Tee-Object`、`>` 重定向、`[IO.File]::Write*|Append*|Create*`、`New-Item`、`Copy-Item`（不论目标）
- 动态执行：`Invoke-Expression`、`Invoke-Command`、`& <非字面量>`、`. <非字面量>`、`[scriptblock]::Create`、`.InvokeScript(`、`$ExecutionContext`、`[powershell]::Create`、`.AddScript(`、`[runspacefactory]`；函数引用（`${function:X}`、`$function:X`、`Get-Command X`、`Get-Item function:X`）按对 X 的调用纳入闭包，引用到的删除/写入原语同样命中

**已知盲区**：
- 字符串 `.Replace(` 与文件 `Replace` 无法区分，只标记静态 `[IO.File]::Replace`
- COM 与其他 .NET 结束进程路径未逐一列名；`New-Object System.Diagnostics.Process` 未覆盖
- `Get-Command`/`Get-Item function:` 的参数不是字面量时无法解析被引用的函数，只有紧跟 `.ScriptBlock` 的形态会被标记为动态调用
- Python 等子程序内部行为不分析
- 动态构造的命令名或经例外放行的脚本块内容，只在调用点被扫描

`WriteScope` 取 `'any'`：任何写入原语都算命中，不依赖 pid 相关的豁免，因此没有「按 pid 放行」的兜底。

### 闭包检查例外表（共 12 条，上限 25）

每条按 `脚本|函数|原语` 钉住，并钉「命中文本（空白归一化）sha256 + 命中个数」。出现多余或改变的命中，该键的全部命中都按违规处理。行号为 2026-11-12 当前生产源码位置。

| # | 来源 | 函数 | 原语 | 钉住（sha256 前缀 ×个数） | 理由 |
|---|---|---|---|---|---|
| 1 | transport | `Invoke-DeadlineProcess` | `.kill()`（process-deadline.ps1:192） | `9bd9e6f7…2cb0` ×1 | 只终止本次调用自己拉起的 Process 对象 |
| 2 | transport | `Invoke-DeadlineProcess` | io-delete（:199-200） | `a8bd4f4a…cd75` ×1、`981e5176…ede4` ×1 | 只删除自己的临时文件/目录 |
| 3 | transport | `Invoke-DeadlineProcess` | io-write（:140） | `392faf6b…6ef` ×1 | 只创建自己的临时目录 |
| 4 | backend | `Invoke-BoundedNativeProcess` | dynamic-call（django-local-service.ps1:300，`& $Executable @Arguments`） | `e75ee646…c9d7` ×1 | 第一个参数是可执行文件路径而不是脚本块，内容无法静态验证，因此限制调用方：闭包内只允许 `Show-AggregateServiceStatus`、`Test-PostgresReady`、`Get-FinanceWriteAuthority` 调用（均为只读探测），新增调用方即失效 |
| 5 | backend | `Invoke-InProcessJsonStatus` | dynamic-call（:4867） | `a66f7ab9…0357` ×1 | 调用点为字面量只读状态块；调用点约束：参数 `Operation` 必须是字面量 `{ … }` |
| 6 | backend | `Invoke-WithDjangoEnvironment` | dynamic-call（:3758） | `a66f7ab9…0357` ×1 | 唯一调用点执行单条只读授权查询；调用点约束：参数 `Operation` 必须是字面量 `{ … }` |
| 7 | backend | `Rotate-LauncherLog` | remove-item（:403） | `d26f0011…278e` ×1 | 只丢弃最旧的轮转启动日志 |
| 8 | backend | `Rotate-LauncherLog` | move-item（:405、:409） | `eaedc451…c415` ×1、`54cbdcbb…b1d19` ×1 | 只轮转启动日志文件名 |
| 9 | backend | `Write-LauncherEvent` | io-write（:424） | `a017f5b0…ccea` ×1 | 追加一行启动日志 |
| 10 | overlay | `Invoke-ReadonlyMetadataObservation` | dynamic-call（约 :246） | `ef292c89…be88` ×1 | 调用 wrapper 传入的只读状态块；调用点约束：参数 `ReadStatus` 必须是字面量 `{ … }` |
| 11 | supervisor | `Move-SupervisorStatePreviousGeneration` | move-item（django-runtime-supervisor.ps1:364） | `874defdb…5fc0` ×1，另钉调用点（见下） | 归档 `state.json`；只经 `Read-SupervisorState` 第 327 行的 Mode 闸（`ArchivePreviousStopped`）到达。唯一传 Archive 的是 `Invoke-SupervisorRun`（:832），看门狗 Status 块（:1140）传 `AllowPreviousStopped` |
| 12 | backend | `Write-LauncherEvent` | new-item（:414） | `88038315…2133` ×1 | 追加启动日志前确保日志目录存在（`New-Item` 现按写入原语处理后新增的现存命中） |

**调用点约束（例外表条目的可选 `callsite` 字段，通用实现，不特判字符串）**：`onlyCallers`（命中函数只允许这些函数调用）、`hitParameter`（命中函数的该参数在每个可达调用点必须是脚本块字面量）、`target`+`parameter`+`allowed`（目标函数该参数缺省或为列出的字符串字面量）、`pinFunction`+`pinSha256`（整个函数定义原文钉哈希）。调用点的参数名按 PowerShell 规则绑定（大小写不敏感的唯一前缀，其余按声明顺序的位置绑定），无法确定绑定（splat、未知或有歧义的参数名）一律视为违反；函数引用（`${function:X}`、`Get-Command X`、`Get-Item function:X`）也是对 X 的引用点，使 X 的调用点条件失效。

第 11 条的具体约束：`Read-SupervisorState` 的所有可达调用，`-Mode`（含 `-Mo` 之类前缀）或第一个位置参数必须缺省，或是字面量 `Strict`/`AllowPreviousStopped`；变量、splat、`ArchivePreviousStopped` 都使例外失效、命中转为违规；`Move-SupervisorStatePreviousGeneration` 的唯一允许调用方是 `Read-SupervisorState`；并钉住整个 `Read-SupervisorState` 函数定义（含参数默认值与 Mode 闸）的原文 sha256 `8473c0eb…3a85`。**钉整个函数意味着守护脚本改动 `Read-SupervisorState` 的任何字节都会使该例外失效、触发失明告警，这是有意接受的代价**：这个函数决定守护是否归档状态文件，改动它应当重新审一次。测试 `watchdog-driver-closure.test.ps1` 3f/3g/3h 覆盖各种改写、合法写法、引用与新增原语，各自去掉对应检查都变红。

当前生产源码实测：`ok=True`，被例外放行 20 处命中；可达函数数 control 25 / wrapper-backend 58 / wrapper-worker 47 / wrapper-supervisor 36。`Invoke-DjangoSupervisorRelaunch`、`Invoke-DjangoSupervisorProcessCreate` 等新函数在四个 profile 里都不可达。

### 所有权调用白名单（2026-11-12 枚举）

所有权函数（`Get-WorkerStatusInternal`、`Resolve-OwnedProcess`、`Resolve-SupervisorProcess`）只允许调用：

- backend 库函数：`ConvertTo-CanonicalCreationDate`、`Get-CanonicalPath`、`Read-JsonFile`、`Test-CommandLineReferencesPath`、`Test-ExactStringArray`、`Test-ProcessRecordFromPreviousBoot`、`Get-FileSha256`、`Get-Sha256Text`
- worker 库函数：`Get-CreationIdentity`、`Get-HelperOwnershipContext`、`Get-PortProcessIds`、`Get-ProcessTree`、`Get-UniqueProcess`、`Read-ProcessReceipt`、`Test-AllowedTreeProcess`、`Test-MonotonicAncestor`
- supervisor 库函数：`Assert-SupervisorExactPropertySet`、`Get-SupervisorCanonicalPath`
- 内建：`Test-Path`、`ConvertFrom-Json`、`ConvertTo-Json`、`Select-Object`、`Where-Object`、`ForEach-Object`、`Sort-Object`、`Measure-Object`、`Join-Path`、`Split-Path`、`Write-Output`、`Out-Null`，以及任意 `Get-*` cmdlet

### 发布范围（只读核查 `tools/release-scope-plan.mjs --base f7e5713d`）

本分支改动文件按 `scope=non-production`、`components=[]` 归类（各 tools 文件在应用复制清单中均为「neither」），不会把下一次 Django/Worker 发布变成完整组件流程。
