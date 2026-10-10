# 1cae 实际 Unresponsive 运行阻断复核

这次失败真实保留，原因已缩小到原总控的三个健康探针，但现存材料仍不能区分 live、helper、ready 中哪一项失败。未发现该窄窗的 Worker/helper 退出、重启或 liveness termination；也不能由日志缺记录推断所有进程及网络状态都正常。

本报告只独立审查非作者的实际总控、Worker endpoint 源码和已保存运行材料。本 reviewer 是新的 readiness supplement 协议作者，不在此签署自己取证代码的独立通过；该部分的代码与实际真实性由 preparation_review 负责。机器证据见 [READINESS_SUPPLEMENT_RUNTIME_BLOCK_REVIEW.json](READINESS_SUPPLEMENT_RUNTIME_BLOCK_REVIEW.json)。没有调用 HTTP、Status、SQL、锁、生命周期或任何生产工具，没有重试、协调或释放 owner。

## 已确认的实际状态

范围为 `1cae786dfffa78b362e056ef2abffd889138106d6c3ce9d64add1f86b628aed7`。22:48:53.332Z 的准入原快照为 Running / Ready、12 域 true，原字节 SHA `89bd333de183aa4099b917a2e41fb2fb4bdda417b4f73460dbf5b63b94d8d1d3`。22:50:00.768Z 最终原快照为 **Unresponsive / Ready**，12 域仍 true、worker exact_release、releaseMatchesExpected=true，原快照 SHA `c0e6c1b1fe6dc25946a542314b909a4b7d650fc96d3d6c234c495c2bec6734dd`。

最终 native PowerShell PID71628 exit0，34557 ms，stdout603字节、SHA `707135c8d88aff9ebc06217bcaf573844871d70eaa51c20c1124d05428c59032`；之后原严格断言 STATUS_NOT_READY，retryable=false、一次。外层 caller 在22:50:01.130Z exit1。native exit0只证明查询执行完成，不表示状态就绪；34557 ms 是完整 Status 操作时间，不能当作某个健康探针的时长。完整原 Status body 和三探针分项结果未保全，不能重建原正文。

原 [operations-system-control.ps1](D:/运营管理系统/tools/operations-system-control.ps1:414) 的 exact_release + backend Ready 分支调用 Get-SystemHealthState。Status 本身使用 Refresh（699行），不能以5秒缓存解释此次失败。Get-SystemHealthState 初值为 Unresponsive，要求：

| 探针 | 原通过条件 |
| --- | --- |
| live3000 | HTTP200、ok=true、status=live |
| helper5791 | HTTP200、ok=true |
| ready3000 | 只有前两项通过后才查询；HTTP200、ok=true、status=ready |

ready 的唯一另分类为精确 HTTP503 / ok=false / status=degraded / code=django_unavailable，得到 BackendDegraded。其余 HTTP错误、连接/请求异常、空正文、JSON无法解析或条件不符均可留下 Unresponsive。由于分项数据不存在，ready 也可能根本没被执行。Aggregate 12 true 和版本正确不能覆盖这些健康条件。

## 现存窄窗日志

supervisor-lifecycle0 在22:48:07.571、22:49:07.578、22:50:07.582Z 仅有同 PID48744 heartbeat。lifecycle1无对应窄窗事件。最后 Worker child_spawn 仍是17:43:24.475Z/PID52084；现存 worker-process receipt 仍绑定 f4e537eb…/release20261010T014638Z-97833d2f2b7e7bc9 和 supervisor48744，创建时间06:26:26.791795Z。这些是既有日志/回执信息，没有新枚举或信号探测实际进程。

Worker stderr 最后写入时间早于本次窄窗。活动 Wrangler17:43:27_776日志虽在继续追加，22:49–22:51 的134行片段没有三个健康 endpoint 请求记录，也没有 Error inside ProxyWorker / Network connection lost / ECONNRESET / ECONNREFUSED / ETIMEDOUT / AbortError / TimeoutError 已知错误匹配。没有证明它记录了每个请求，因此不能据此称探针成功或失败不曾发生。具体日志读取时刻、长度、原始 SHA 和每条 heartbeat 摘要都在机器报告，原日志未改。

同一 Wrangler 片段有22:49:48.722Z、22:50:56.130Z 两个 error级别块（各121字符）。补充语义与隐私核验后，去 ANSI 的全文精确等于固定标签 `market netshop projection scheduled runner failed` 加公共文案“当前范围查询超时，请稍后重新读取。”，不含任何动态URL、secret或客户值。块 SHA `389ce384…` / `5d7569d5…` 已保存；不是健康 endpoint 报错。

真实 netshop-reader 现存日志同秒出现固定 `Netshop query exceeded statement timeout` 与紧邻 consumer/query Service Unavailable。日志本地时间11日06:49:48、06:50:56，installed settings.py181行固定 Asia/Shanghai，对应UTC10日22:49:48、22:50:56。原 [netshop/views.py](D:/teruisi-runtime/django-sales/app/backend/netshop/views.py:209) 只在非import请求的 OperationalError、cause.sqlstate=`57014` 且包含 statement timeout 时生成该固定503/source_not_ready文案。原 Worker [index.ts](D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9/source-snapshot/worker/index.ts:81) 的定时网店投影 runner 调用 consumer读取并由45–54行捕获打印公共错误，netshop-service.ts210–222行转递上游公共文案。

因此确认了背景投影查询 statement timeout。第一条与最终 Status窗口同时，第二条在 native查询结束后；没有具体查询文本/业务行、没有三健康探针的分项错误，不能断言该查询超时导致哪一个健康探针失败，也不能把它当成 Worker崩溃、连接错误或3/4秒预算失配的因果证明。此次只被动读取原日志和源码，未触发该定时任务或运行SQL。

该窗口48个入口样本均 HTTP200，目标是首页 GET `/`；它与三探针不同，不证明健康。另行被动读取到既有 watchdog22:54:25.9936527Z 为 Running、四 HTTP 探针200，但这发生于失败之后，不能覆盖22:50的 Unresponsive，且未由 reviewer 催触运行。不归因于入口观察器，也不猜测 CPU、资源争用、断线或 A 误杀树。

## 可验证的预算缺陷和最小修复要求

源码确有预算不一致：总控 Invoke-SystemHealthProbe 默认 **3000 ms**（370–383行），实际 f4 的 [backend-readiness.ts](D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9/source-snapshot/lib/django/backend-readiness.ts:30) 默认允许 **4000 ms**，对23个 reader/writer服务以6个并发工作循环检查，Worker ready route未传更短预算。[start-local-worker.mjs](D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9/tools/start-local-worker.mjs:27) 的监督健康预算为5000 ms。

因此，内部仍在其4秒许可内等待时，外层3秒可能先中断并折叠为 Unresponsive。这是静态确定的协议缺陷线索，**不是本次超时因果证据**；没有实际分项 elapsed/error 可确认本次是否发生这种路径。helper `/health` 也会 await options.health，但未取得本次 helper 响应或时长，不能推断它超时。

下一次可审修复应先把三个探针的固定类别、HTTP状态、parse/payload枚举、耗时及 timeout/connect/format 分项在汇总前可靠保全；不保留 raw body、reason、任意URL或客户信息。预算修复需用隔离夹具验证3.2～3.8秒合法 ready、共同期限耗尽、live/helper失败、错/缺/多域、错误版本、非法JSON、精确503django与其他503的区别，再选择一致且有界的内外期限。继续保持全部原断言，不能用首页或后来的 Ready 改旧失败成功。本报告没有修改源码、运行新测试、生成生产重试方案或扩展当前批准范围。

## 后续最小隔离候选设计（尚未实现）

可形成仅外置 readonly 的派生候选，前提是显式修正根路径依赖并给旧 B 识别器增加受精确新 scope 限定的分支；直接把 control 拷到 E 后运行不能成立。以下只是根任务要求的设计，不是可执行批准目标，也不据此再跑1cae。

1. 以实际 D control SHA `0e87b266…` 为基线，在新 artifact 中复制为 `readonly-control.ps1`，只增加 fixed per-probe 投影、统一有界期限、显式 `SourceScriptRoot` 和 Status-only 前置拒绝。不改 D dirty control、原 f4/E9 或4771旧 pins。封存差异逐行列出，原所有状态、后端、版本、12域及 live/helper/ready 成功/503分类保持原谓词。请求失败只输出固定 outcome 与 elapsed/status/parse/ok/status/code枚举，任意异常正文、URL、headers/body不输出。

2. `SourceScriptRoot` 明确且只接受原 `D:\运营管理系统\tools`，逐级拒绝 reparse，绑定原目录里的 `process-deadline.ps1` 与相关入口 SHA。把顶层12行 dot-source 从 `$PSScriptRoot` 改到该显式根，把17行 `$ProjectRoot` 从 E目录推导改为此根的父目录。24行 `$LocalWorkerStarter` 仍落原 D tools/worker-local-service.ps1；Django runtime 与 app237所有子入口保持原位置，Invoke-DeadlineProcess 的 cwd 仍原 D项目，所有 inner reader/aggregate/worker Status 参数原样。`$PSCommandPath` 在派生文件中可指派生本身，仅用于原 Panel/Start GUI启动路径；Status-only 前置拒绝保证该路径不可达，不替它创建 shortcut。

3. 实际 control 没有 `RepositoryRoot` 参数，也没有 `FunctionsOnly`/library-only 模式；不能编造这些 flags 来运行它。Worker 原入口有 `SourceRoot` 和 `FunctionsOnly`，其固定源根/保护根由原代码定义，不等于派生 E根；这次 control 调用它仍只 `-Action Status -Json`。原 Django installed service 的 ExecutionRoot 从自身 PSScriptRoot 得到 app237，仍不复制 Django入口。现有 B `productionCommandEnvironment` 清除 `TERUISI_DJANGO_SERVICE_LIBRARY_ONLY` 与 `TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY` 并固定 PS5模块目录，必须照旧使用，不能为了加载函数让真实 AggregateStatus 被 library-only跳过。隔离测试应 AST抽取目标健康函数到私有夹具/固定 fake 服务，并显式证明不启动正式入口；不得 dot-source 原 control 默认 Panel或传不存在的 FunctionsOnly。

4. 外层每个 HTTP预算可选与原监督相同的5000 ms，上限还须受继承总 deadline 的剩余时间限制；ready 内部仍原4000 ms，不改23服务/6并发及后端成功条件。每个 probe开始前核 remaining，正文结束后再核共同期限，不能因设置新的5秒刷新父期限。3.5秒正常 ready应在5秒外层内被完整解析；超过5秒、共同期限耗尽或错误 payload仍失败。五秒是修复候选的配置值，不是保证任何现场健康响应必通过的时间估算。

5. 原 B `isExactStatusOperation` 固定 PS5 + 原 D control路径 +7 argv，不能直接接受派生入口。如果明确传 `-SourceScriptRoot`，新 argv是精确9项；原 `productionCommandArguments` 的 JSON/UTF8/base64 adapter本来支持该字符串参数，但只读 recognizer与所有采用它的 validateOperation/runApprovedOperation必须新增一个 **scope-bound** 分支：新独立operationId、精确派生绝对路径/SHA、固定 SourceScriptRoot字符串、PS5/exact7项前缀加2项新参数、mutating=false、phase=closeout、原 assertions与四暂态/NotReady非retry。保留原7项分支用于验证旧不可变 batch，不能泛化 basename/目录/任意脚本白名单，也不能把派生 cmd冒充原21。新scope对派生 command/collector descriptor独立摘要并需新 human批准。

6. 准入 collector也要采用同一精确派生 Status：外置 admission copy只替换那个 Status调用的 script+SourceScriptRoot参数，其他 recovery/source/toolchain/permission/maintenance/ownership/完整动态门禁不变。外置 wrapper继续输入原E9、原Python闭包、原cwd/phase；原 batch.collectorSha256不换绑。新的 capture/projection需要显式保全三探针固定结果并通过 write-failure负例，不能仅给末查询换脚本而保留准入盲区。新scope保留4771旧闭包并增加派生文件/新helpers/新原WAL头全部 pins；等待旧1cae actual报告核准新准确head后才准备新scope，保留19、原21和本次1cae unknown，不重source88、20、生命周期或备份。

真实隔离验证至少需要随机 loopback端口与私有目录：live/helper即时正确，ready3.5秒后返回原正确 JSON；独立测 live/helper坏payload、非法JSON、503、超时；ready精确503django与其他503；父期限不足5秒、读取正文迟到、取证落盘失败；假的 Status/JSON marker不能代替真实子进程结果。fixture应设启动/停止/部署/写入子入口为立即拒绝，并对 child PID退出、网络目标只随机fixture端口、argv/cwd/原SourceScriptRoot使用证明留证。原正式Status、服务和调度不能用于测试。修改的 control/copies/helpers由非作者审查后才能封存，任何实际生产查询和 owner闭合仍需新的精确 scope批准。
