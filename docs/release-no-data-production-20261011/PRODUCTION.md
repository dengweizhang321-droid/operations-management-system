# 精确首次采用执行记录

用户在统一对话回复“批准”，对应已交付的[精确19步范围](../release-site-blockers-20261011/FINAL_PRODUCTION_SCOPE.md)，批次 `f15d06a159073927ba3565712027aa645869333a3210c54e1858738756ca110f`，规格原字节 `960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b`。执行仍使用原入口 `69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99`；不改19步、collector、源码、候选或旧批准/WAL。

批准观测登记于2026-10-11 23:25:28（上海时间），是主任务收到明确批准后的时钟记录，不声称精确UI点击时间。原批准前规格里的 `productionApproved=false` 保持封存字节；本次实际授权单独以 `APPROVAL.json` 保存，通过原入口的显式批准时间argv执行。

本次开发/执行存证在从origin/main `a54e81da`创建的独立工作树及`codex/release-no-data-production-20261011`分支完成，主检出原改动保留。运行源码及外置guard仍指原冻结来源/工作树，不移动或清理引用。

## 启动与独立复核

审批/运输/日志目录为 `E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/`。启动包装仅用built-in Node API执行原6989入口一次，原 `execute` argv与f15/960c绑定、Windows相同SID+Administrator、Node9a/入口/规格/批准记录和包装器的5文件闭包均固定摘要，持FileShare.Read至结束；清NODE_*并固定模块目录，保留原引擎互斥、owner、WAL和每动作fresh采集。日志、STARTED/DIRECT_PROCESS/FINISHED均create-only；已有日志使重复启动在spawn前拒绝。

Astra只读静态复审未运行任何生产接口，指出spawn后异步写日志再注册退出监听可能漏极快失败。V1封装和binding保留；V2另生成，只把error/close监听立即注册并显式记录errorCode，原argv及生产引擎不变。第一次本地内联生成V2命令有JS解析错误，尚未运行或生成任何文件；改为文件形式后语法检查/生成通过。未将这一运输层错误解释为生产操作失败。

23:31:10.132启动原执行入口，直接Node PID52540；原bootstrap先执行完整依赖树、keyFiles、源/规格/路径及导入闭包验证，再进入原引擎队列，尚无WAL时不当作已经备份/进入维护。最终状态以原完整WAL、回执和独立核对为准，不能把wrapper exit0当生产验收。

## 可用性及成本口径

使用批准display范围内的固定静态资源 `/assets/index-BcwbDyNL.css`，每30秒一次GET、3秒共同期限、2MiB上限，不重定向或使用代理，不调用业务API。仅记录字节摘要/HTTP状态和时间；同步读取既有自然watchdog latest，不人工触发Check、重启、故障注入或告警发送。静态资源可达不代表完整业务页面就绪；看门狗可能已滞后，记录原at/completedAt及摘要，不用重复读同一文件冒充多轮成功。

入口尚无WAL时，看门狗23:32:26开始、23:33:10结束的一轮core=false/backend=NotReady；静态资源仍200且精确字节匹配。该记录早于任何批次生产操作，保留基线，不归因本次发布。后续自然轮23:34:09–23:34:46已全部12组件true/Ready；没有手动服务恢复。

批准观测到启动包装、入口bootstrap、每边界全量复验、备份、维护/切换、演练、必要验收和Git收尾分开计。原准备568.653秒属于批准前成本；当前实际发生的等待均计入批准后本次样本，不用历史50～55分钟毛池推算净收益。无原方案生产配对样本，不能宣称已经节省某分钟；恢复治理/日调度、三份保留和保护策略保持原范围。

本文件记录当前执行事实；最终完成、阻断、必要验收及全部交付以随后追加的原始证据和结论为准。

## 首次实际失败：准入环境绑定

23:36:50原入口在初始现场准入的 `source-and-toolchain-initial` 拒绝，stderr为 `Bound source/configuration/toolchain identity changed`。原WAL仅2条：approved及admission-failed，链头d6335eaa…；没有任何operationId或started。直接入口exit1，原active继续归本f15，维护/排空均不存在。备份、维护、切换、恢复及业务操作均未开始；不清active或审计，不修改候选和旧批准。

主任务正常环境的原完整 `workerPreparationIdentity` 只读实测14.431秒，所有字段完全一致（whole identity `18c8febbdbf211ba102d03e28447eb994b8b9718fd1f0154dd8b8d2751effad9`），原source dc1、environment bc79均保持；不是源码、配置或工具链字节漂移。原指纹除已声明deadline运输元数据外，绑定全部继承environment，不能临时增加忽略项。

执行过的bootstrap明确把 `PSModulePath` 强制为系统PowerShell路径。对当前原环境仅重现这一字面量赋值，完整env摘要便从原bc79变为1118e43b…，已足以违反绑定。记录只保存变量名及摘要，没有原值；未追认这份模型化字典是原Administrator进程的完整回溯快照。失败源于主任务启动封装未完整保留已封环境，原门禁正确拒绝；首次失败及此前静态审查遗漏均保留。

资源采样7点均HTTP200且精确CSS字节相符，窗口23:34:04–23:37:05；仅该范围观察，不推导任意短暂中断或全业务可用。看门狗曾一轮core未就绪、随后自然健康的基线原记录保留。当前没有发布维护窗口或生产配对收益。

后续修正仅限把原已绑定环境安全传入同SID管理员进程，拒任何新环境摘要，不修改SourceBinding或规格。任何同批恢复须先证明原入口已结束、原WAL仅已知准入失败而无生产步骤、当前owner仍本f15且gate-null，并再次通过原入口完整校验；这属于解决已知准入问题后的原协议恢复，不重放生产操作。尚未据本节宣称修正或恢复已通过。

## 已冻结的运输修正与同批恢复

Astra最小DPAPI/同批状态实现冻结handoff SHA `12b48404b6fabfbf1fcbf6991b0545d08694c210fc4421c25ef2e709e305fc96`。Astra和主任务各自跑同一最终10项隔离测试，10/10；不加总。真实同用户DPAPI保护/解密、私有Temp单链接且仅当前SID ACL、按已验证持有文件对象删除、错误nonce/hash不删不匹配文件、精确WAL/owner/gates/已退出状态反例均保留。首次合成env少了Windows/libuv必需字段而被系统补值，原失败保留；修正仅补合成数据、增加实际必需key存在检查，不把变量加入忽略项。

Root在正常环境先握持完整capture/helper闭包及Node，实际捕获的完整环境摘要仍是原bc79；全部值只在内存/管道，临时磁盘仅同用户DPAPI密文。公开manifest只有nonce、路径、cipherSHA、文件身份、SID及环境摘要。12项恢复闭包逐项固定摘要并持FileShare.Read，其中包含5helper、Node、公开manifest、原批准/规格/入口、原finished/direct记录；不长持active文件，避免阻止原引擎最终正常unlink。

2026-10-12 00:11:34.374（上海时间）同批恢复入口启动，直接Node14972。原批准时间、规格、入口及execute argv完全不变。解密前后均重新核实原2条WAL/head、owner-f15、gates-null、原52540已结束且不存在；未清active。恢复环境原bc79，原deadline运输元数据不携带旧值，NODE_*为空。主任务随后实际确认临时密文路径不存在、12项冻结绑定全部相符。

管理员父环境与恢复环境有34个不同字段名，包括Codex/终端变量、Path、PSModulePath等；只记录名称，不记录值。这是新实际父/恢复环境比较，不追认为首次进程全量回溯。原环境必须原样传入子Node；原入口仍重新做完整依赖、源、制品、身份及每动作现场准入。这里不把恢复入口启动或隔离10/10当生产采用/验收成功。

## 前备份已完成，但原批次输出仍待协调

00:20:40原完整collector现场准入15/15通过；00:27:23原op-prepare通过，用时307.608秒，复用精确原plan。00:29:07备份步骤开始，原installed运维审计明确记录新点 `daily-20261011T162958Z-49bdf7f519aa` 于00:37:27.884完成。manifest `a46097b7…`、dump `e88b7cbb…`、content `f261acde…`；三份数据库恢复点保留完成，原两保护不改。release-payload清理预检blocked/release_plan，原结果保留，不称执行清理成功。

00:39:07原PS返回exit1，原WAL000009正确留unknown/outputs:null，直接入口随后exit1。其实际code为nonzero_exit、timeoutType:null、elapsed600033ms；不能仅据接近600秒称为进程超时，也不能据审计completed称整批已成功。维护/排空仍null，服务尚未切换。原审计result按原字段顺序序列化加CRLF，恰1319bytes/SHA `114fc0d3…`，与失败过程真实捕获stdout证据一致，绑定实际结果而非按时间猜测。

主任务00:46:22–00:46:25用原installed工具对该点执行只读Verify，exit0/statuscompleted，manifest/dump/content全部一致、serviceStateChanged=false。它校验已有归档，不是新Backup或Restore；后续新installed消费链的隔离Restore仍必需。原失败及真实Verify保存在[evidence/pre-switch](evidence/pre-switch/)；完整dump和生产数据库manifest不进Git。

原reconcileOperation只追加passed/receiptSHA而不携带outputs，后续outputsFor却必须消费本批backupDirectory/id/manifest，单纯标passed无法继续。Astra固定V2适配器在原rotation lock下核原10事件/head/owner、null门、两旧PID实际缺席、原审计/原stdout/全dump及实际Verify，再一次性create-only追加原hash链passed事件及五个真实输出。原unknown永久保留，不重放Backup，不伪造maintenanceId，不减任何后续操作，不改原规格/候选。重复调用或漂移拒绝。首次V1的系统PS链接例外过宽被主任务指出，V2仅原路径/SHA/nlink2；原V1源和失败/纠正记录保全。

Astra28项补证与7项resume2状态验证、主任务独立35/35通过。主任务最终45/45包括原10环境/准入状态回归，原39文件语法检查及输出/被测摘要保存；后新增等待运输另经真实语法与独立静态复审，不追认属于这45个测试。模型认可及fixture不替代实际CAS/native查询/后续恢复。真正AGY两次同conversation非空复审及Astra回应见[交叉纠正](ASTRA_AGY_BACKUP_RECONCILIATION_V2_RESPONSE.md)，原stream/prompt/call保留；明确纠正其600秒超时及绝对安全措辞。

用户明确委托“过程中有什么问题，你帮我决策，这次的上线发布你帮我做”，随后再次要求验收上线。这覆盖同一精确范围的必要故障协调，不扩成任意WAL修改、旧批接管、业务写入、调度修改或生产库恢复。

## 管理员提前确认及固定续接

第一次补证启动请求被Windows取消，实际无管理员进程/新WAL记录。此后外层V3改为wx日志、Node启动前拒绝NODE_*，11文件完整FileShare.Read封存；原V2取消包保留。用户要求现在统一发起确认，实际V3补证入口01:07:40.209启动；等待包仅在其成功回执、固定binding/proof及实际000010链头相符后执行原runner，最多等30分钟。原runner再次核完整11事件/所有权/门/两旧PID缺席和完整bc79环境，原6989入口随后仍全面复验，绝不重做已补证Backup。

第二个管理员启动因旧PS5将无BOM UTF-8中文Set-Location误解码，未生成WAIT_STARTED便结束。真实PS5读取复现错误目录，非推测；主任务新增ASCII垫片，持有并核原boot SHA `27631c80…`，strict UTF-8读取原脚本，不改其字节或门禁。用户第三次确认后，01:08:51.772真实WAIT_STARTED存在。Astra补审承认此前静态复审未验证PS5解码边界；原失败/垫片/实际启动记录保全。两者目前仅确认启动，CAS、服务采用及最终验收须在后续原始结果闭合后追加。

已有resume1静态资源55次采样结束；完整计数、窗口和不同自然看门狗快照见[evidence/PRE_SWITCH_ARCHIVE.json](evidence/PRE_SWITCH_ARCHIVE.json)。它不是完整业务可用性证明。批准到必要验收/全部交付尚未完成；启动错误、补证设计及Windows确认等待均计入当前真实成本，不藏入批准前或后台。

01:12:38.480实际一次补证成功，新000010链头 `1dece550efb4af55b792426714af4338b0f95a400a77b7789af55e455f89be49`，原0–9字节保留，真实五输出指向原49b点。原审计及Verify/全dump、固定两PID的CIM+native缺席断言在本次封存代码内实际通过，不外推连续或全系统保证。外层exit0时间01:12:38.537；它仅证明补证，非发布验收。proof原字节086378…与canonical receipt `6ae20e1b…`分别记录，不混为同一个摘要。

01:12:42.210固定waiting自动启动原6989 execute入口，直接Node71332。原f15/960c和15:25:28Z批准时间不变；初始state11/head1dece，op-prepare与backup-pre两项passed，无unknown。完整环境仍bc79、未带旧deadline；主任务另核真实私有cipher路径已消失。实际原始回执见[evidence/actual-reconciliation](evidence/actual-reconciliation/)。后续仍须原完整准入、维护/切换、一次同点隔离Restore及所有必要验收；不由这一补证减免。

## 当前停止门禁阻断，采用及验收未完成

后续原15阶段现场准入于01:21:46通过，255.121秒。原EnterMaintenance于01:30:38.835完成，维护门自01:27:18.869建立并保留PostgreSQL；下一StopWorker在01:31:58.488因Worker-only入口拒绝完整维护而留unknown，原入口退出。前驱Worker/Django已维护停止，但候选未切换，Restore和最终验收未执行。原失败、有限补证准备、新Windows确认取消及永久源码修正详见[当前阻断与续接](STOP_BLOCKER.md)，此节更新此前“切换继续中”截点。

最新19条WAL/head290394…、active-f15及A483维护/排空门保留。3项passed，Stop目标虽有真实只读诊断支持，管理员锁内补证尚未执行，第20条不存在。最新V3管理员启动请求被Windows取消，未生成Stop STARTED。不删除门/owner、不重放、不称上线完成；聊天授权不能代点Windows系统安全确认。

本轮源码及执行证据已先交付f5b19c01。另独立永久选路修复最终97fa130…、54场景（2测试）通过并推远端main/分支070f2d61；只有工程源码采用到Git，未插入f15不可变候选或自动进行第二次发布。本任务的剩余补证/切换/演练/验收仍须原精确运行包按原协议完成。

## 08:39实际管理员续接，更新原停止截点

用户明确要求打开最新管理员执行包，08:39:46实际确认返回管理员launcher27476，08:39:47.723 V3封包启动有限补证Node52472。旧取消记录保持；此处更新当前执行状态，不把旧取消当作仍未确认。

08:44:37.078真正原reconcileOperation追加唯一000019，head `8a3a82a6c226b21bac6219a515db9227bffba31d0acbdc6fd262ae27f8dc9d4e`。原0–18逐字节未变，旧StopForRelease失败仍保留，目标由本批原已通过维护及当前停止状态确认，未重放Stop。proof canonical `7cd05e8f…`、observations canonical `7d0eee7d…`与事件/真实stdout互相绑定；锁内末native样本真实Admin/同SID、四PID均CIM缺席+Open87、唯一原5432/PID4080，距追加125ms。原门/旧Worker和Django清单相符，last-stop仅旁证，root_only_status不冒称完整ACL验收。Astra的[实际独立复审](ASTRA_ACTUAL_STOP_RECONCILIATION_REVIEW.md)与[原始存证](evidence/ACTUAL_STOP_ARCHIVE.json)分别留存。

08:44:41.695原6989/f15/960c/原15:25:28Z批准参数恢复执行，直接Node47844，state20、4项passed、无unknown，完整环境原bc79。私有环境密文实际已消失，未进Git。08:45:57原队列resumed，继续原完整现场准入及剩余15项；此时新候选切换、同点隔离Restore和最终验收仍未完成。原恢复点manifest本日再次只读匹配a46097，dump大小959949050不变；不是仅凭size代替完整dump复验。

原维护自01:27持续到本次续接，期间01:32至08:40没有连续静态资源采样；早/晚状态与保持的门不外推成逐秒测量。新资源观察在resume3单独开启，最终必须分别记录批准到验收/全部交付、协调/待确认、机器步骤及真实采样窗口，不将夜间等待隐藏或把历史50～55分钟毛池算净节省。

## 09:27实际确认，有限 NoVM 后置检查及原批次续接

08:51:37.457 Worker apply 通过，实际链为 sequence220、新候选 `20261011T090355Z-21c2645a63247749` / manifest6cff。08:53:08.518 原 previous-reference-guard 留 unknown，队列退出。09:00 已授权的管理员只读诊断独立重现：旧守卫在完整进程/任务循环前要求已经退出的固定 VM 实例仍存在；未据 stderr 长度推测原失败内容。旧守卫、spec、运行包和失败记录保持。

新增的有限接收器保留原 Django/CF、保全树、运行状态、所有进程/任务与物理引用检查，只支持本 f15 当前 28 条 WAL/head a40e、Worker220 和尚未切换的旧 Django237。两端完整 HCS 必须成功返回词法空数组，系统 WSL running 列表必须为空，旧 VM 具体 PID 须同时得到 CIM 和内核缺席证明；新实例、重用、读取拒绝或未知系统均阻断。现存解释器仍做原同出生实例及真实 CWD 检查。43 项隔离测试通过，真实 Astra/AGY 复审及分歧纠正见 [独立复审](ASTRA_NO_WSL_FINAL_REVIEW.md)；这些不代替实机检查。

09:27 首次 Windows 提升请求取消，未启动生产执行；用户明确要求再发后，09:27:41 实际确认，09:27:42.715 有限接收器启动。09:32:56.808 通过真正原 rotation lock / reconcileOperation 追加000028，head `c7dfd925caa08213507d7903abd700b2e0b1373cec472c2ccbe265cd3767cd75`，旧000027 unknown 保留。proof canonical `1480d10f…` / observations `32dda5ab…`与真实事件关联；两端 HCS 为完整 `[]`，运行 distro 为空，565 个进程中1个退出有内核证明，1183 状态文件扫描，引用和未知均0。现存解释器 CWD 检查保留。末 native 到事件约292.2373ms，末 HCS 到事件约273.6077ms；早先内部消息的“<250ms”已纠正。接收器 exit0 只确认该后置目标。

09:33:03.167 原6989/f15/960c/原批准时间及完整 bc79 环境恢复执行，实际 Node60880；初始29条 WAL、6项通过、无最新 unknown。09:36:24 初始15项准入全部通过（127815.9047ms）。09:38:46.599 Django 部署通过，Root 只读核实际 app/deployment.json 为批准85cf、app.previous 为原237。09:40:21.892 权限加固通过；新安装恢复消费链正在核验。此截点仍未完成隔离 Restore、服务启动和最终验收，不称全部上线完成。

本轮原不可变依赖共51项，固定 chain binding `e97351a1…`、ASCII bootstrap `683f7319…`，全程持有只读共享句柄。先前0–27与捕获 canonical 内容一致；源、制品、门禁和批准没有自动换绑。新采样从09:25:53开始，08:53至此没有连续采样，不回填；旧自然看门狗快照不当作当前健康。

## 10:05 完整启动门未通过，当前发布仍未完成

09:44:40.269 新 installed 消费链通过，实际为新应用中的只读 payload-retention planner，未执行清理。09:56:55.9417664 隔离 Restore 完成，09:56:56.034 原队列确认000042 passed（666825.6435ms），同49b/a460/e88/f261点；55433、生产数据库未触及、隔离数据清理、权限配置及序列健康均按原断言通过。Root 核真实 result 字节与 sidecar 同为 `0ab553b5…`。Astra [实机独立复审](ASTRA_ACTUAL_RESTORE_REVIEW.md)核74个执行文件及 audit/result/stdout摘要/WAL关联，归档见 evidence/actual-restore。可选 policySyntaxEquivalence=false，未建立完整 RLS 语法等价证明；非空 stderr 仅摘要可用，未恢复原临时正文。

09:58:57.974 本批 ExitMaintenance 通过，维护与排空门正常解除，active-f15保留。10:00:06.682 StartWorker开始。10:05:55.216 返回 unknown，49条WAL/head `1a614e58caf56a243ea8dead3ce1609993fd993c3ed39cac296bf83c64617bd4`；原入口10:05:55.352 exit1。真正 Start engine exit0、随后候选身份 Status通过，但完整 control 状态门未通过；此为非零退出/完成门错误，非超时。10:04:24.545 静态资源首次实测200/字节匹配，不能代替完整就绪与最终验收。

源码和日志随后揭示新的关联边界：本次批准的0afd rotation plan显式将 protected worker入口4c315更新为717408，旧978包、新21c包、当前主入口及安装链吻合。既有 watchdog 的不可变 add91…绑定仍为4c315；其它control/backend/transport三项实算匹配，但worker不符后它选择legacy而非拒绝。Root实际只读Task查询确认既有任务RunLevel0（普通角色），未修改任务、版本或绑定。

原 Django Get-ProcessSnapshot 会在image/cmd不可读时返回null；原 Resolve-OwnedProcess则删除该PID记录。日志真实有23条stale_process_record_removed，发生10:01/10:02启动期间；当前run目录23个域PID记录缺席。调用者与各进程当时活性不能只凭日志断定。Root10:07后曾调用普通角色原Status，10:09:26返回Supervisor创建身份不可读/改变、foreign_or_ambiguous，已保存原输出并停止再次调用；该原接口并非严格零文件写，不能继续以“只读”掩盖元数据清理风险。此前23条删除早于这次诊断，不归因于它，也不从674字节旧摘要反推具体组件。

原失败、实机输出、驱动绑定变化和独立复审见 [完整就绪失败](ASTRA_START_READINESS_FAILURE_REVIEW.md)、[角色与元数据边界](ASTRA_START_HOST_ROLE_REVIEW.md)、[watchdog绑定失配](ASTRA_WATCHDOG_BINDING_FAILURE_REVIEW.md)。当前不重放Start、不补填未知所有权、不改旧绑定/运行包/调度，不称发布完成。必要源码收严从最新origin/main65b建立独立 codex/startup-status-receipt-safety-20261012 工作树；生产修复须先形成精确现场与范围。既有1次Backup/1次Restore已完成，不机械重做。
