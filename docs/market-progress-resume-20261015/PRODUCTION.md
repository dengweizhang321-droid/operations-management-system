# 三项优化生产发布

当前状态：2026-10-15 16:47:29（Asia/Shanghai）已上线。首页及三项任务progress_light均200，原Start/VerifyStartup回执通过。样本保持一项completed、两项paused，控制版本全相同、有效租约均0；没有手工恢复或模型实验。代码修复main c839aa28，最终Django source84345733；最终回执见[生产结果](evidence/production-20261015/final-PUBLICATION_RESULT.json)。

当前Worker为20261015T074548Z-58e44a5126de6bba（47eed428…），保留另一项已采用的AI更新；最终仅更新Django为prepared b538659808eb4511af1e396a2380addf，manifest d59fbd6a…、指纹b9a0713e…。原生维护ID66b302136b8b4cc5a8c62e307610991c在16:36:16建立、16:41:09正常解除，PostgreSQL保留运行。

用户授权后首轮现场取证为14:16:07，首轮制品就绪14:42:03，最终修正就绪16:32:15。期间真实发生首轮维护拒绝、reader修正和按用户选择等待另一项发布；不把就绪时间当授权时间，也不把总耗时包装成单次维护时间。

## 首轮来源与范围（历史保留）

应用提交33592f91，原26项行为/42个不同PG/9个React合成HTTP与独审结果复用。本轮保持三个范围：控制/执行/读取状态、轻进度查询、正常维护后原意图自然续接。未修改Prompt、模型、并发、unknown暂停或人工复核入库规则，无migration变化。

原AI调度发布现已闭合，当前Worker前驱改为20261015T031454Z-bfb561e8e06db72e，Django仍为已安装1e23af06组合。旧49fcdccf的Worker候选来源已失效，不使用旧前驱计划。

| 项目 | 首轮绑定（保留追溯） |
| --- | --- |
| 新Worker组合源码 | 323cc7b515adc79b87faef3e246b47be23922d31 |
| Django组合源码 | 83d4afa6ef598431556f0a4effde40d7d0778676 |
| Worker候选release | 20261015T062310Z-4259d14f596d2a40 |
| Worker manifest | 77c90b06278d6a66b8ba838e4a58c3ad72984e579d5d8cd5791b9ebd6d1d747e |
| Worker plan | ea72972dff9f1bcec0f2ac9776ef55a9ed585e8765f9c57aea90a4cd04dd2b5a |
| Django prepared ID | 7afb8bbba8fd45b0a0fe402ce66e51e6 |
| Django receipt | bc4dcc37a77a575a89f204d0c980fbab2a9f7f7c165739107022ebf9c7ff1a72 |
| Django候选manifest | f37675ee601fab50eaca916f38b265c9660446f1c3906829aa350024c417d2e3 |
| Django应用指纹 | 63514ca333d1c88ae88d1b5c1756e5722a6b5a8601cfc4d31af299b372ba3667 |
| READY SHA | a1075b7c2be534d03a7ab6577256c62425541b8d0e2f7d54a2cd869b252fa4dd |

新Worker实际8438源文件中8431保持，七个变化属本任务，新增文件也只在声明范围。Django1362个安装源文件中1360保持；准备后两端各2963个打包文件，只有两个市场业务文件、deployment元数据及CF六个原允许叶变化。源码SHA与受测main一致，migration及其余runtime字节保持。不倒退或顺带采用其他AI功能。

## 数据保护与动作

复用现有daily-20261015T041546Z-e45dddeb5a15恢复点，原Verify实际exit0/completed，manifest和sidecar与回执一致（d027dc04cfeb3cde06801b7f200ba355fb5afae84da311ca5fe295e2284fa34d），serviceStateChanged=false。未新建备份或执行恢复。

原scope工具固定输出中的migration-dry-run条目按当前“仅migration变化执行”记不适用，原plan保持，不冒称执行。只按原唯一入口EnterMaintenance KeepPostgres→Stop→DeployApp prepared→HardenAcl→精确plan apply→同IDExitMaintenance→Start→VerifyStartup。普通权限，保留原完整性、进程、authority、互斥、排空和收据检查。失败保持原门禁/输出，不自动恢复或重放。

READY同时绑定执行脚本、原controllers、来源、计划、比较、备份、正式状态采样和source-binding。发布后仅核原回执、目标组件、首页/必要轻进度接口与启动绑定；不另行综合验收或模型实验。未手动恢复任何识别任务。

## 原失败与时长边界

此前12:33/12:36准备阻塞原件保持。本次14:21首次Django准备因候选缺固定Wrangler CLI明确失败；补冻结lock依赖后另一次原PrepareApp成功，不改原失败为成功。Worker只执行一次生产构建及原完整校验；完整准备约14:22–14:40，期间未进入维护。就绪后发布及实际维护时段以后续原回执为准。

原始证据：D:/codex-artifacts/market-progress-production-20261015/。本文件后续仅填实际发布与收尾结果，制品和已审脚本保持冻结。

## 首次维护拒绝与一次受控续接

14:45:05以维护ID f4f1001a381149c582e4349f2b6d3ef9调用原EnterMaintenance，原管理子进程PID3892实际退出1，36518ms；引擎报告worker_gate_failed/unknown，没有原始异常文字。原unknown与PUBLICATION_FAILED保持，不能改写成成功。独立只读对账确认原进程/直接子进程与相关遗留执行器不存在、两门禁与active owner不存在、四份launcher无同ID事件、所有后续操作marker不存在；原Worker进程收据与出生身份、完整head/lineage和12个保护入口、Django全部指纹均原值，支持此次维护/停服/部署动作未发生。原PID历史CreationDate未记录，不补造。

原工作目录Django sibling与installed库不同，但两个纯前置只读检查均通过，不能把差异断言为首失败根因。同期RunWeeklyReport与发布共用Django mutex，原非Start只等30秒，时序吻合但仍只是线索，不改unknown结论。

独审允许同ID最多一次Recovery1：旧有效不可变Worker控制器Enter/Stop，apply后新有效不可变控制器Exit/Start/Verify；其原生分支自然选择installed Django库，无热改工具或工作区、无门禁/锁删除。新RECOVERY1_READY SHA8a5805cfbed626e5de4773e865b0e9d4f27462236adae38c7c4b0289e398d8dc绑定27项输入及独立对账原件，原READY继续冻结。预检末尾用installed库原canonical/hash名称观察mutex可用，忙则有界等候原持有者自然退出，abandoned失败关闭；不是调用Enter循环，释放后仍存在竞争，原引擎再失败即停止并保留现场。

最终绑定独审通过后，15:01首次申请原rotation锁在callback之前以EADDRINUSE拒绝；没有Recovery1Preflight、RECOVERY1_STARTED或生命周期marker，未消耗一次Enter续接。独立复核原输入、head/chain与Django均未变化，允许待现有prepare进程自然释放锁后，重新申请同一冻结adapter的原锁，不建立Recovery2。现场只读看到PID39436自14:52:20运行另一项AI schedule制品准备；未终止/干扰或删除锁。该等待不属于实际维护停服时间。

锁自然释放后15:11:00原冻结Recovery1获得锁，15:11:18原预检verified，supervisor/出生/收据、前驱manifest、门禁均精确通过，Django mutex观察7ms后立即释放。原Enter于15:11:54建立同ID维护门禁（KeepPostgres），随后原停服完成并标drainedStopped=true，15:15:46 Django原DeployApp完成。之后进度仅以原结果回执记录。

迁移边界：本需求没有新增migration，adapter未单独发起迁移或migration dry-run。原Start-ServiceStack固有流程仍调用Invoke-DjangoMigrations中的manage migrate --noinput与grants，不能为规避原流程而跳过，也不能把PUBLICATION_RESULT.explicitMigrationExecuted=false解释为“迁移命令从未运行”。最终以原Start日志说明是否实际应用迁移。

## 必要上线确认发现 reader 503

原Worker apply于15:21:27成功；ExitMaintenance、Start、VerifyStartup均成功，新supervisor21660于15:26:07启动。Start回执15:29:03，首页200且目标head/组件SHA正确，但首个progress_light GET在15:29:12返回503；原Recovery1依规则停止，未生成成功PUBLICATION_RESULT，RECOVERY1_FAILED及所有原回执保持。不能把组件已启动等同于本次上线完成。

原Start迁移日志仅记录migrate/grants各exit0及输出SHA，不保留输出正文，因此不能仅凭该日志声称“没有执行迁移命令”或给出实际应用条数；本次migration文件与前驱逐字节相同。

503确认为轻读事务误校验writer epoch/cutover，而实际reader启动两项均为空。原测试设置了writer身份，未覆盖正式进程配置。最小修复只移除轻读中这一行，写commands/控制回执guard与签名/scope/READ ONLY/RR/限时全部保持。修复前新增断言确实2fail，修复后13项定向PG通过并独审，见[reader修复](reader-fix.md)；main c839aa28已推送。后续仅Django修正包，不重建或轮换Worker。

第一份修正source组合84d0e513以实际83d4物理源为底，8441项仅views/test/.gitattributes三项物理变化；attrs仅声明五个既有CRLF文件-text whitespace=cr-at-eol保全（五项与installed原字节一致，包含的migration没有变），根attrs不由Django producer复制。原Git core.autocrlf=input导致新worktree刷新时把旧CRLF归一化报dirty，明确声明后源码保存原字节，完整diffcheck通过；初次CR判空白的失败输出保留，不隐藏业务修改。

15:45该修正pipeline仍在取得rotation锁前以EADDRINUSE拒绝，没有PrepareApp-started、READY或生命周期marker。原锁由AI schedule v2 deliver持有。用户15:48明确选择按发布锁顺序等待，未向其他聊天发消息。现有84d0/f376组合只是旧前驱草案；其他发布自然闭合后必须按实际新前驱重新组合、准备及独审，不能盲用。

## 按新实际前驱准备的最终修正包

另一项发布在16:26:08观察时已自然闭合。原resolver实际Worker为20261015T074548Z-58e44a5126de6bba，manifest47eed428f371f8d307282a90ed1cdff2472cfeeb714139a723575b423eee74a2，完整chain f31eff0b44d545b2e5e7ee31901341d4ba084cfd34406c34b1794cb43a2ac426；Django实际source5cfdc9e3，manifest212f87590e977ea66975abf84e7d53c7c11b044dbebf0f1875382737105498eb。旧f376组合不再采用。

新source843457334d767dce855db01bffa572c16a894e6b已推送，保留实际5cfd的8456项源码，物理变化仅受测views/test与不进入运行包的根attrs。43项既有CRLF源码均与实际base逐字节相同，原Git存储表示差异由明确attrs保全，不能把Git行尾物化误说成migration运行字节变化。原APPLICATION_SCOPE（895→c839，backend/migrate=false）及RAW_SOURCE_SCOPE原输出均保留；独审依据实际运行闭包批准仅Django，准备包仍强制拒绝任何未声明runtime/配置/依赖/migration字节变化。

16:27:52原PrepareApp成功，普通权限，pkg b538659808eb4511af1e396a2380addf，receipt1856c05d1cfc59154749a51fa238fd7e650e5e4dc04eb699e6da5810a85f328b，appFingerprint b9a0713e05be65b7207b1d6d30667ef47e4995900870e469d767db6a2d205d3b，候选manifest d59fbd6a08536aac62045cc0214b600c1b961c229c0f4a834f35ea8cdf57d175。两边各2964项（含deployment），只views、deployment与原工具生成CF cache变化，其他runtime/migration字节相同。

首次cache比较在额外clientTcpRtt数值2→1处明确拒绝，发生在READY与维护前；原日志、旧比较脚本及成功准备收据保持。独立复核确认完整键/容器/叶类型不变，总差异为原六叶加该精确数值叶，属于Miniflare CF请求元数据缓存。新compare-v2只接受本包该number2→1，不扩为任意CF键豁免；不改原pkg/cache/manifest，不重复PrepareApp。新封存适配器只复用原exit0准备结果。

16:32:15最终READY SHA ea87ac44eb4b289733e86e7b12ea6f831159cb67bc72abc416ae8e367cb0cf98绑定36项执行输入、原准备/比较失败、scope双计划与字节保全证据。原rotation lease从最终封存一直保留，待精确独审回执后才允许维护，不把制品就绪冒称已采用。证据目录D:/codex-artifacts/market-progress-reader-final-20261015/。

## 发布闭合

最终36项绑定与完整包指纹独审通过后，原维护/排空/停服、DeployApp、HardenAcl、同ID ExitMaintenance、Start、VerifyStartup均成功，管理进程最终exit0。16:47:29完成必要确认：实际Worker head/chain保持、Django目标manifest与受测views SHA匹配、首页200、三个progress_light均200，样本控制版本全与发布前一致（一项completed、两项paused，activeClaims均0）。原安全暂停未误恢复，没有手工重跑或模型实验。

本次没有新增migration文件、单独迁移步骤、数据库备份或恢复。原Start固有migrate/grants各exit0，原日志仅保留输出SHA，完整表述见[启动迁移元数据](evidence/production-20261015/final-NATIVE_START_MIGRATION_METADATA.json)。没有重新打包/轮换Worker，也未追加独立综合验收。原26行为、42不同PG及9 React合成HTTP证据复用，reader修复补13项直接相关PG；不称全仓测试通过。

回执与原始证据SHA清单随报告提交；完整失败/诊断/执行原件仍在两个外部证据目录保留，不把首失败或首次比较拒绝重写成成功。所有日期、状态与确认仅对应本次已观察事实，不作为未来发布授权。
