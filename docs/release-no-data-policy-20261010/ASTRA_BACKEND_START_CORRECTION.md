# 原启动副作用缺口修复与九文件范围

2026-10-10。主代理在Git交付前继续核查真实部署调用链，发现先前审查遗漏；已停止沿用七文件就绪结论。旧7c01 prepared payload、f318来源、原AGY2～6及全部测试证据保持原字节，标为旧范围而非覆盖更新。

## 实际缺口与最小修复

原 `Invoke-WorkerSystemStart → Ensure-DjangoSystemReady` 在NotReady时会调用Django Start，其启动路径可以运行迁移/GRANT/角色设置。原Worker fresh/already-running两分支均调用 `Start-SystemDingTalkReceiver → AutoStartDingTalk`，可能启用接收并产生数据/外部副作用。Django manifest没变和事后ready验证不能证明这两个动作没有发生。

保留原生命周期，新增原Worker控制器枚举 `-BackendStartPolicy RequireReady`；默认EnsureReady继续普通启动，RequireReady仅可配Start。原适配器仅在 `ExpectedDrainId` 存在的Worker-only路径追加此参数，full维护Start不追加。参数使用原typed transport已有名称/值形式，避免额外修改process-deadline的封闭switch表。

- RequireReady + Ready：原Worker完整验证/启动继续，但不调用Django Start，不自动启动钉钉接收器。
- RequireReady + NotReady：在Invoke-DjangoStartProcess之前抛错，Worker/后端/接收器都不因本次动作启动；batch保持unknown、active及原drain，不继续EndDrain，也不自动重放。
- 普通EnsureReady：原NotReady启动后端、fresh/existing接收器自动启动行为保持。原维护/未知进程/owner拒绝和后置完整ready仍保持。

既有业务自然写入与相同配置的Worker计划任务并不被声明冻结；仍由原唯一进程所有权、Stop→Start及requests gate控制。没有新增cron、追赶任务、后端生命周期框架或业务归因白名单。

## 真实控制流验证

`tests/release-no-data-backend-start.test.ps1` 从原脚本解析并执行实际Ensure/Invoke-WorkerSystemStart函数及实际顶层Start分支；仅替换最低外部状态/启动primitive。覆盖Ready与NotReady、普通fallback、fresh/existing两条receiver分支、维护/未知owner先验。额外执行原脚本非法Action入口，验证参数在运行时初始化/锁前拒绝；执行原适配器StartWorker分支，核ExpectedDrainId对应的精确argv。

最后运行真正原Invoke-OriginalEngine与process-deadline，私有子文件使用原Worker完整参数块，仅回显已绑定值；PS5和PS7均确认枚举参数实际传入。此测试不执行任何固定生产控制器主体，不把mock计数当真实生产启停验证。两个原PS文件的UTF-8 BOM和行尾均保留。

原批次协调器另有真实WAL负例：Start拒绝后unknown/active保持，EndDrain未调用，再执行明确拒绝重放。旧原drain/错误owner用例继续复验。原始日志为 `astra-backend-guard-first.log`、`astra-backend-guard-transport.log`、`astra-backend-guard-final.log` 和 `astra-backend-guard-original-drain.log`，均保留；前两个并非最终全部组合结果，最终计数以主代理报告和原日志为准。

最终六文件相关组合以 `--test-concurrency=1` 执行 **137/137**，38.491秒（`astra-backend-guard-final-serial.log`）；其中包含PS5/PS7两个native控制流/transport测试。原Worker drain另组PS5/PS7 **2/2**；新JS测试ESLint通过，diff check无错误。之前并行组合 **136/137**，既有“missing config parent creation invalidates; unrelated ancestor siblings do not” watcher测试报Inputs changed；原失败保留，同一未改case定向复验和最终串行组合均通过。不修改原断言、不据此宣称已确定干扰根因，也不把原失败改记成功。

## 采用与审查

相对实际AB的运行源码变更为九文件：原impact、batch、admission、observer、worker-local-release和两个必要C依赖，再加worker-local-service与release-lifecycle-step。原后两文件已在既有bundled/key-file保护集合，不需放宽包清单或transport。机制自身依然由原已采用引擎strict/full首次采用，四DB阶段不省略。

主代理负责新的九文件源、正常构建、完整载荷、实际AGY第7轮与Git交付。旧在途AB继续其不可变原引擎；本次没有改生产入口、旧WAL、owner、调度或启动任何生产服务。此修复关闭这两条具体已知隐式启动路径，不代表一般运行代码不存在未知副作用。
