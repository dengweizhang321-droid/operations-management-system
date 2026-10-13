# 集成续做：故障定位、归因与最小补验

本报告记录完整CI候选的续做截点，其证据不作为新子集HEAD的构建/全域验证结果。后续独立子集的实际范围与验证见[子集复核报告](FINAL-SUBSET-REPORT.md)；完整CI及所有原始记录继续保留在固定`dc94e6492ce34457529581239f2b682bb6d36264`，未合main、未生产采用。

2026-10-13，沿用`codex/release-pipeline-integration-20261012`，原五项不重做。原交付7ccb0f11与旧INTEGRATION-REPORT为前一截点，原失败不覆盖；本报告更新现在的阻断范围。未生产操作，main仍未合并。

## 本轮已处理的具体工程问题

| 问题 | 原实测 / 原因范围 | 修正和证据 |
| --- | --- | --- |
| 云端Windows夹具 | 529a/7ccb两次子夹具超原10秒；8fce追踪显示child已script-entered而尚未mutex-created，父启动只57ms，不能归为整个OS启动都慢 | 原`New-Object`/cmdlet发现接缝导致被测mutex未进入；改用同一.NET Mutex/Process构造及Console输出，锁名/WaitOne/exit7/输出断言/原10s及120s保持；8fce仅补profile仍失败，保原修正未闭合事实 |
| summary dirty HEAD | L0后完全干净；L1后唯一生成`Microsoft/Windows/PowerShell/ModuleAnalysisCache`，1263900字节；knownFolderLocalAppData实测为空。父/子私有环境没有固定该缓存文件，缓存落到仓库相对路径 | 父子显式PSModuleAnalysisCachePath指向随机私有root，保缓存而不设NUL；没有ignore或清扫仓库来让summary过。每级前后状态/路径/大小/hash输出；新增任意未跟踪文件实际被拒，删除仅自己的合成负例后回读clean |
| 制品下载失真 | 原独立build成功，下载后verifyArtifact拒完整payload；原upload-artifact默认include-hidden-files=false | 仅专用`.runtime/wp1-artifact`上传设true，whole-tree摘要算法不变；封存每成员清单、具体source/lock/payload不符，新增隐藏成员丢失/篡改拒绝负例。不删除隐藏成员或归一化字节求绿 |
| Docker机器身份 | 旧run把stderr拉镜像进度和stdout 64位CID拼成containerId；真实docker run exit0后combined output含多行，正则拒绝；finally又用该多行ID inspect，遮住初始身份错误 | 仍保combined诊断，另保存各自stdout/stderr；机器身份只用stdout且精确64位；原password在每路投影都脱敏；原ID/label/name及tmpfs存储校验和清理不放宽，原异常/清理异常分记。真实有限子进程模拟pull stderr＋CID通过，错误/非零/缺stdout仍拒绝 |
| PG准备误认临时服务 | 修正身份后，原pg_isready无host参数接受Docker初始化的临时Unix-socket服务；随后psql真实exit2，报database system is shutting down，尚未执行SQL；本次精确ID容器清理成功 | 只接受最终127.0.0.1 TCP，保原40轮/2秒/500ms预算；同随机密码按环境名传入，先核真实current_database/current_user/inet_server_port，再执行原SQL。不延时求绿、不重试已执行SQL或回退其他DB |
| Linux编译器存在性探测 | PG/浏览器阶段和精确容器清理完成后，tsx以全大写cwd探测大小写敏感性；该别名位于原native读许可外，authorization.ts在业务断言前报ERR_ACCESS_DENIED | 仅对Linux这个精确全大写cwd存在性查询返回false，不读取/映射别名、不增加grant；全大写文件读取及父目录查询仍拒绝，原网络/写/子进程限制保持。新增对应失败边界断言，原失败保留 |
| 旧生命周期夹具依赖真实profile | 清空继承环境后ProgramFiles/Startup GetFolderPath为空，库加载在真正锁断言之前失败 | 只在私有测试root准备已需目录、保留只读系统ProgramFiles路径，并使用原AllowTestRuntimeRoot＋StartupShortcutPath test-only入口。生产脚本不变、原锁/运行意图/超时/并发断言不变；两shell实际suite通过 |

缓存路径机制查核[Microsoft官方PS5说明](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables?view=powershell-5.1#powershell-environment-variables)；本机/云端空KnownFolder与生成路径仍以真实记录为准。没有测量模块发现的全部CPU/扫描分项，不把37秒全部认作单一缓存I/O。upload默认排除隐藏文件见[本次精确action源码](https://github.com/actions/upload-artifact/blob/ea165f8d65b6e75b540449e92b4886f43607fa02/action.yml)。

代码提交：8fce76be（补定位/私有profile）、fa33e587（模块缓存/构造器）、abc9043a（人工审查后精确重绑probe）、cc477e5f（完整制品与test-only加载接缝）、3a68e5b7（Docker两流及清理异常），随后追加最终PG TCP身份修正。每次只改对应接缝/必要测试/审查摘要；不是自动续签。完整SHA与执行证据在续做JSON清单。

## 基线问题分别归因、分别判断阻塞

**lint**：在固定b3c完整Git解包与候选上，用同一锁定依赖、ESLint完整范围/规则运行JSON输出，对每条相对路径、规则、severity、行/列和消息逐项比较。两边都是63错误/112警告，introduced=0、removed=0。62项为九份历史CJS证据脚本的no-require-imports，另1项为diagnose-exact-display的no-assign-module-variable，共十文件；不是本轮代码新增，亦不证明这些CJS不能运行。它们仍让原完整lint及默认L0失败，当前不满足main合并门槛。本轮没有关规则、忽略docs或改原失败脚本。十文件与逐条记录见`lint-attribution.json`。

**覆盖**：b3c没有本套tiers/audit；固定WP-1交付的15个准入条目只覆盖部分域，13个L0和11个L1空域不因本轮修正变化。现有业务测试并非不存在，而是未逐运行导入/资源审查，或需要真实PG/HTTP隔离。package仅6个新增verify脚本、2165个业务/前端/配置/资源文件及生产入口/锁/依赖无变，证明本次产品影响范围；仍不下调保守requiredLevel=3/18域。新设施的“可完成验证”缺口在本轮交付中存在，当前阻断的是全域切片汇总和正式L2/L3能力采用，不能伪装为既有业务功能坏了。具体域/条目见`coverage-attribution.json`。

**进程树负例**：旧失败在同一前轮隔离封装的固定b3c也出现，且原runProcess树清理函数和该case断言未被本组合修改；不能归因WP-5退出码修复或WP-3报告。现在原case在候选/固定base分别通过，精确原预算仍3秒，原实际树清理及独立taskkill私有探针均约0.4–1.4秒并确认自己root/后代不存在。当前13项deadline子集全部通过，关闭当前负例的验证阻断。旧失败根因/所有负载下树清理保证没有被证明，原失败仍留存，不将当前通过反写旧样本；也不再把“历史原因未知”无限扩大为本组合永不可交付。

两shell冷启动**协调接缝**各通过（44.075/44.564秒，合计88.983秒），复用原真实竞争进程/33秒持锁/超时与运行意图套件。它不是12组件全服务冷启动。WP-5两shell真实退出/锁选名4项通过；WP-3执行字节本轮未改，复用前轮原21+6+3/两批离线证据，不重复实现或不必要重跑。

## 云端与高层补验

fa33的[run38276565922](https://github.com/dengweizhang321-droid/operations-management-system/actions/runs/38276565922)：L1完整通过，子进程exit7/父锁确认仅约250ms；五个前后Git状态全部clean。summary正确exit2并列原L0/覆盖/L2/L3缺口，已修复dirty造成的前置退出。63错误继续让L0/workflow失败，不能把workflow宣称全绿。

真实高层首次执行先发现我传镜像参数未正确展开，runner WP1_IMAGE为空，在启动任何容器之前失败；随后精确Docker官方镜像`postgres:16@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d`实际传入，继续暴露上述运输/身份问题。原空参、制品失败、Docker原输出及清理失败分别保留，不计为PG执行成功。因workflow并发策略替换而cancelled的queued run无job，单列取消，不冒一次失败测试或人工停止生产。

后续最小补验及各源码SHA按[具体L3清单](L3-MINIMUM-CHECKLIST.md)逐项封存：独立构建/完整制品、原合成PG语义/隔离清理、浏览器阻断外发、真实Windows运输/生命周期协调与已有离线报告。**完整业务HTTP、实际Django PG角色/模型、四角色完整应用浏览器和12组件真实冷启动仍没有已验适配器**；原L2/L3强制pending不改变，不能从基础设施探针成功发正式passed。

## 真正需要选择的工程范围

用户已明确选择2：保留完整CI候选及全部失败，先拟已验证工具/资料精确子集；本轮不扩全域CI/完整应用冷启动/历史lint，也不自动合并或上线。具体范围已形成[子集方案](SUBSET-DELIVERY-PROPOSAL.md)，当前不再等待这一范围选择。

最终补验[run38280796678](https://github.com/dengweizhang321-droid/operations-management-system/actions/runs/38280796678)绑定`215b8f0cc03dfd8e737c1ae92f4838c808a45fb6`：独立build、完整164文件载荷复验、最终TCP数据库/用户/端口、原SQL语义、浏览器隔离和精确容器清理完成；Linux已审81项Node断言全通过，原Windows专属夹具不在Linux假跑。level3最终`status=pending-validation`、error=null、exit2，16.699秒；缺项仍为业务适配器/完整应用冷启动及Windows层对应证明，而非新的执行故障。Windows同源码baseline的L1完整60项Node＋PS5通过，summary正常列未完成门槛，不因dirty中断；完整lint仍63/112，workflow最终failure保持。

后来origin/main独立前进至5368e501（其他任务的京东前检修复/报告），没有由本任务合入。完整CI候选不悄悄夹带它；拟子集私有索引从最新5368构造，仅五源码/测试文件与资料闭包。原2165文件无变化证明仍是原b3→完整CI的截点，不能把它外推成所有之后main变化为零。

可独立推进的本轮云端/运输/私有夹具工程问题已继续修复并验证；原五包、历史故障和生产不扩大。当前剩下的是原完整lint十文件专项，以及新CI尚缺的资源准入和较大业务/完整冷启动设施。精确最小文件边界、复用runner、域断言和替代交付列在L3清单。

可以继续保留全部完整集成候选；或者授权先分阶段补审安全切片，再建设统一业务fixture/适配器/完整冷启动和角色浏览器，并单独处理十文件静态规范问题；也可以明确仅送审仓库资料/工具子集，CI继续留候选。任何选项都不包含降低原门禁、改旧失败、自动main放行或生产操作。此处请求的是新增工程范围，不是豁免未通过检查。
