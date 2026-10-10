# 发布任务 A：进程完成协议与共同期限

2026-10-10，Asia/Shanghai。从启动时最新远端 main `99eaa0b90149a860d3e286c678ea4b2ab0a27160` 创建 `codex/release-process-deadline`，使用专用应用受管 worktree。主工作区已有的客服文档、release rotation、release/service 脚本及未跟踪材料均未修改、暂存或丢弃。

本任务仅开发、隔离验证、独立复审和 Git 交付。没有生产启停、部署、调度修改、业务数据写入、实际备份/恢复或外部发送；隔离构建产物不作生产采用。没有实现快路径或减免备份门禁。

## 证据与归因

已读取 [客服发布](../release-customer-ps5-fix-20261009/PRODUCTION.md)、[吉客云发布](../jackyun-download-recovery-20261009/PRODUCTION.md)、[交互发布](../priority-interactions-20261009/PRODUCTION.md)、[夜审](../runtime-risk-readonly-audit-20261009/REPORT.md)、[watchdog 调查](../runtime-risk-readonly-audit-20261009/WATCHDOG.md) 和 [批次协议](../RELEASE_BATCH_WORKFLOW.md)。

| 历史观察 | 启动主体 | 外围与协调证据 |
| --- | ---: | --- |
| 客服批次 | 252999ms，约4.217分钟 | start 到独立 passed 18.952分钟；约14.735分钟残差包含外壳等待、实际状态核验和协调，不能全称 EOF 等待实测 |
| 吉客云批次 | 221146ms，约3.686分钟 | 主体 completed 且退出，适配器仍等待；12:39:28独立完整 Status 后按精确外壳身份协调，报告未给纯 EOF 分段计时 |
| 交互批次 | 232290ms，约3.872分钟 | 原外围30分钟超时保留，独立状态/启动绑定/维护空支持协调；原 exit0 没有被观测 |

三份记录证实“主体完成而外围仍等待”，不具备原始句柄继承见证，不能认定它们与夜审 R02 完全同根因。R02 的 watchdog child/grandchild 实验则明确复现了直接进程退出后的无界 stdout EOF 消费。新夹具复现的是当前调用链机制，不会回写历史事故归因。

当前源码中实际定位到：

1. `release-lifecycle-step.ps1` 的 `@(& powershell.exe ... )` 等待原生管道完成，后台服务后代可能持有输出句柄。
2. `runProcess` 以 Node `close` 为成功信号，混合了直接退出和输出 EOF；超时后还引入独立5秒 kill grace。
3. Worker 已有 Django Start 文件重定向，但仍有 parameterless WaitForExit、Django Status、effective head resolver 和 verifier 原生管道，以及可重新等待900秒的启动互斥。
4. watchdog 在有期限 WaitForExit 后无界 `ReadToEndAsync().GetResult()`；非零退出/解析/期限诊断被压成泛化错误。

## 最小修复边界

`process-deadline.ps1` 统一 PowerShell 直接子进程传输。首版复用 Start-Process 重定向的真实试验发现转码及退出观察问题，因此底层改为 Windows CreateProcess：只允许继承 NUL/stdout文件/stderr文件三个句柄，隐藏窗口，保留创建时的内核进程句柄。文件共享删除权限允许读取固定长度快照并进行不等待的清理；保留原退出码，完全不等待服务后代 EOF。PS5/7 的 File 参数仍以 UTF-8 JSON/base64 数据转交，保留中文/引号/布尔开关和错误传播，系统 PS5 子环境仍固定自身 Modules 并清除 library-only 标志；父环境在 finally 恢复。

新 helper 同时加入原 guard 入口，复用原 apply 的受保护安装、回读与半安装恢复；旧11入口前驱至新12入口候选已验证，候选缺 helper 或文件外来字节继续拒绝。

Node 的原 `runProcess` 增加 `direct-exit-files` 协议和 preserve/direct/tree 清理策略；普通 pipe 使用仍要求 EOF，但到原期限返回明确失败。期限由入口确定并经 `TERUISI_PROCESS_DEADLINE_UNIX_MS` 传给嵌套调用，取较早值。直接退出、有限输出快照、JSON/断言、状态回查及清理均消费原预算，不新增超时后的等待期限。

生命周期和可能写入的 operator 使用 preserve：过期只返回未知并保留精确 PID/退出观察和批次占用。明确只读 Status/维护状态/聚合查询和 watchdog 探针只可终止自己创建并由内核句柄固定的直接进程。普通构建/隔离测试继续使用 tree 清理；在原总预算内预留清理窗口，记录 taskkill 退出及未确认状态，截止以精确直接进程句柄终止兜底，不把此能力套到服务树。

Worker 互斥、原生 resolver/verifier、Django 启停/Status、启动循环和 HTTP 门禁使用原剩余期限；预算耗尽不发起新的收尾 Status，不删除可能仍有服务引用的启动证据。原服务身份、ACL、完整逐文件校验、迁移、维护/排空及一次性启动收据没有被省略。

StartWorker 成功需要同时满足：原 Start 实际 exit0 且完成 JSON 有效；本批 Worker/Django manifest 精确；非空 release 和合法正整数 PID 一致；原 Control 返回 Running/Ready/exact_release；全部固定基础组件及实际启用的 AI 就绪；维护声明不存在，Worker-only 的精确 requests drain 保留或严格发布的 drain 已解除。HTTP 200 不替代任何条件。新候选、Django、维护参数和 helper 依赖 SHA 在封存批次时先检查，执行前再次检查。

失败继续记为 started/unknown，禁止重放未知 Start，独立 reconcile 规则保持。WAL 新增有限进程元数据、原引擎退出、期限类型、输出字节数/SHA及 engine/validation/adapter 计时；不保存原 stderr、URL、配置、身份或业务正文。watchdog 只补本次调用的安全阶段诊断，原 R03 状态保留问题不在本次范围。DWS sending/unknown/sent 仍不自动重发，测试只调用替身。

## 验证与失败保留

真实 Node、Windows PowerShell 5.1 和 PowerShell 7 child/grandchild 覆盖 stdout 单独、stderr 单独、两流同时继承、exit0仍有活后代、exit9、非法/不完整结果、错版本/身份/组件、维护和保留 drain、总预算耗尽、只读探针精确清理、普通隔离树清理及原嵌套适配链。独立复审与作者不同，详见 [复审报告](INDEPENDENT_REVIEW.md)。

- [首版失败](process-tests-initial.log)、[原生传输开发失败](process-tests-native.log)、[第三轮结果](process-tests-v3.log) 保留：未 detached 的 Node 后代没有真正持有 EOF、PS5/7 转码、包装脚本未显式传 exit9、测试 cwd 清理竞态及早期预算预留错误均已按实际证据修正。不能将这些失败写成已通过。
- [串行相关测试](targeted-final.log) 中九项失败来自新测试请求只补 Django candidate 而遗漏 predecessor，被原展示门禁正确拒绝；修正夹具后 [批次入口复验](batch-final.log) 通过。原 gate 没有放宽。
- 原600ms普通树测试曾另加5秒隐含 grace；新测试把同一5600ms总预算显式声明，保留全部后代零遗留断言。原10秒 process-receipt writer 时限保持，通过 [原条件复验](worker-release-focused-final.log)，没有提高其时限。
- [全量单测原日志](unit-full.log) 保留缺失 `.runtime/test-venv` 的五个文件/七个测试失败。在本 worktree 以 [仓库锁定依赖](../../backend/requirements.txt) 建立独立虚拟环境后，[五文件复验](python-fixture-recheck.log) 49项通过；不改业务断言，不反推首次运行成功。
- [watchdog 原回归](watchdog-regression.log) 36项、[无控制台回归](watchdog-no-console.log) 5项通过；[互斥期限](mutex-final.log)、[清理与通知替身](cleanup-and-notification.log) 均通过，真实外发为0。
- [隔离生产构建](build.log) 完成。构建前核对3000由既有服务占用，构建仅写本专用 worktree 的 dist，未触碰主目录或不可变运行包。
- [全仓 lint](lint.log) 0错误；最终修改文件 lint 0错误/0警告。所有初轮诊断及修正后日志保留。

## 计时与限制

计时必须分成直接启动引擎、完整状态校验和额外外壳等待。新 receipt/WAL 的 `engineMs` 是原 Start 调用从创建到直接退出的耗时；`validationMs` 是随后原 Status/Control/维护状态回查的累计耗时；`adapterMs` 是适配器预算内总耗时。准备环境指纹仅排除每次调用的保留预算标志，其他环境仍全部绑定；永久 supervisor 启动前清除此标志，并 finally 恢复控制器，避免完成调用的预算进入长期服务。

Node 外层 `elapsedMs` 还包含宿主启动、编译与消费；不能将差额全归为 EOF。

本轮合成嵌套样本可见 [全量日志](unit-full.log) 的 `ISOLATED_START_TIMING`：ready 约 engine980/validation2362/adapter3542/外层4543ms；drain 约 engine1095/validation2597/adapter3889/外层5043ms。配置后代60秒自然退出，在函数返回时实际确认仍活，随后由夹具精确清理；没有持续观察其持有60秒，也不是生产启动性能。

目标是消除同类事故额外15–30分钟外围等待及人工协调；原启动主体3.7–4.2分钟和必要完整状态校验仍保留，不承诺秒级启动或生产 SLA。

同步文件系统、编译、CIM和系统调用无法在 JavaScript/PowerShell 中硬实时抢占；返回后会复验预算并拒绝迟到成功。Windows taskkill 在独立1000ms总预算负例中未能确认后代全退出：直接根已清理，树状态未知并失败，夹具随后精确清理。3000ms真实普通树样本确认根和后代均退出；正常构建默认预算内最多预留5秒。不能把短预算限制掩成清理成功。

超时的生命周期主体可能仍在执行，必须通过原精确协调确认，不重新 Start，也不以页面健康取消批次占用。未决旧批次须保留其原固定代码/协调入口；新协议要求重新准备批次参数、依赖闭包与精确批准，不能改写既有 WAL 或借已合 main 授权生产采用。

## 集成与交付

最终 [200项必要回归](final-required.log) 全部通过；[guard首引入/恢复](helper-guard-final.log) 8项、[晚到健康拒绝](watchdog-late-final.log)、[预算/环境身份](deadline-metadata-final.log) 与最终原 watchdog 36/无控制台5回归通过。[最终隔离构建](build-integrated-final.log) exit0，[最终修改文件lint](lint-integrated-final.log) exit0且空诊断。

[组合全量](unit-integrated-final.log) 3578项：3555通过、21跳过、2失败。旧packer断言硬写11入口，在增加helper后正确失败，现补12入口期望；10秒单进程receipt writer在8534ms被普通tree预留窗截断，现为已证明不生成服务树的单进程写夹具使用direct清理，10秒时限和真实收据断言不变。[原条件两项复验](packer-and-receipt-final.log) 通过，随后包含这两项的最终200项也通过。不宣称本次全量一次全绿、不将争用归因为已测CPU瓶颈。

产品源码已与任务B `c9586ab8` 合并：保留其严格只读重试/尝试审计，传输复用A共同期限；[A/B组合66项](ab-focused-final.log) 通过。旧B的真实EOF calibration保持，新直接文件协议的预期变成真实exit0/有限快照/后代仍活，先前期望超时的失败保存在 [组合初验](ab-integration-final.log)。

见 [任务 D 说明](INTEGRATION_D.md)。任务 B 在开发期间进入远端 main；合并最新主线后必须保留其只读重试、验收和报告生成边界，同时复验共同期限。最终提交、合并、推送与全量状态写入交付收据，源码合并不代表已部署。
