# 第二阶段精确发布方案

2026-10-10。两份候选已prepare-online。**本文为可审查的非执行方案；engine batch未封存，P01–P06尚未闭合，不能将scope文档SHA或Worker plan SHA当最终生产批准。**

## 精确候选与实际前驱

| 字段 | 默认第一批AB | ABC严格合并替代（仅AB尚未采用时） |
| --- | --- | --- |
| 来源提交 | 5faac8151f59d66de72c3caead8cad916ea547da | 9d41ce4fa2c7ee4d47ba1bfda0f0967d7727be9c |
| release | 20261010T014638Z-97833d2f2b7e7bc9 | 20261010T015810Z-ec9a7dfc12336d52 |
| manifest SHA | f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113 | 0153c677b7202ce6dbfbc08647450058693a8e1869ea8058db534b503f8281aa |
| Worker plan SHA | 266a8574000a90cbeb5baf12fcba7bc2f4a8a06f0262f3b47d4ad73b9d0ddaee | 1b8cd3f26b9e0ed386a32518077ca3f836414b737f1a7026593c9e1ff3f44107 |
| 完整变化 | 124路径：16tools/20tests/88docs | 164路径：18tools/22tests/124docs |
| 分类/恢复 | STRICT/FULL | STRICT/FULL；机制首次采用不自减保障 |
| engine batch/批准/采用 | null / false / false | null / false / false |

共同实际前驱D5 release20261009T080026Z-d5fb5b62de630ae2，manifest01590c5698c6b68e996c7d2963b94cbf35b109205bd4e0e3993e5a6d991c4d78，源码commit01a0ea6de9bfc1237a761f927fff068eb55d6e41。完整5050文件tree SHA8662394ff24c116685c1342ed6b8b9fa5dd58d8ffa7c0bb869be31e49e5e0646，sequence218/chain SHA a5e625cf64dfc10ad971485e3d9806145466f11ad3dc8b07061eeceae0370ebd。

Django前驱和候选同为安装拥有方D:/teruisi-runtime/django-sales/app/deployment.json SHA237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9，不DeployApp、不新增迁移。两份Worker的app/backend/lib/worker及依赖相对真实前驱零差异，明确排除主线其余未批准功能；这只建立源码范围，不能代替动态业务/权限验收。

[完整机器可读范围](candidate-scope.json)包含完整路径、来源/制品/guard/plan/依赖树及物理字节摘要，其SHA99c96bafc789d80b5bb52c8683f4ef14282f6e455cbe6e87bebc4b6408a7b506。只读核验检查完整前驱与候选tree、全部manifest keyFiles/四项receipt，以及ABC19份核心字节。AB限定v1差异另经独立范围复审。该SHA是范围文档摘要，不是engine batch SHA。

当前固定准备来源D:/运营管理系统-sales-django-release已恢复AB。ABC候选仍保全，旧plan当前不能通过可变源码身份；选择替代时须精确检出ABC并复验新鲜门禁。任何实际前驱、来源、权限、配置或未决批次变化都使旧绑定失效。AB采用后默认第二批C必须基于**新实际前驱**重新准备/测试/回滚/封存/批准，不能转换旧D5 ABC计划。

## 固定成本与保障比较

AB实际准备9.27分钟，ABC替代11.58分钟；第二批C没有新实际前驱，未生成它的计划和耗时。两个严格批需要两次候选/准入/维护排空切换/自然守护/收尾，各自两次Backup/Verify/Restore（共四次新备份、四次恢复）。一个ABC严格批只做一轮，同时集中变更风险，须用户在最终范围齐备后选择。

现存点一次镜像恢复11.77分钟只作样本，不能外推四次/两次成本或净节省。候选准备相差2.31分钟也不是同范围对照，不称C退化或两批节省。保留同源码/制品/数据规模/验收范围前后比较要求；30～60/80～120分钟仍为待验证预算。C机制首次采用本身严格，未来恢复复用资格当前拒绝。

## 最终批次必须具体封存的操作

下面是意图与断言要求，未形成可直接执行的参数/owner/批次。

1. 新鲜只读现场准备：实际有效前驱、已安装Django/Worker/helper/guard全身份，真实工具/依赖物理闭包、资源、权限、未决批次/lease/端口。冻结新业务/历史scope及cutoff行HMAC基线，原审计完整文件集合和started/unknown/failed/reconcile原字节。旧3299→3302聚合历史仍unprovable。
2. 原拥有方新Backup→Verify→独立RestoreRehearsal：精确ID/manifest/dump/完整profile/目录/角色/序列/sidecar，以及同点恢复原JSON/sidecar与清理。现存点演练不能替代该步，expected==restored必须进一步绑定原manifest/profile。
3. 原EnterMaintenance及全部启用域/后台/helper/队列排空，精确owner/WAL保留；正式PG按原严格能力边界。apply只接受精确plan/候选/前驱/guard。退出维护及Start明确双manifest、release、整数PID、真实12域、owner/drain及原引擎完成证据；HTTP200不能覆盖失败。
4. 切换后实际正常资源字节、UI精确只读请求审计，具体业务/权限拒绝/历史保全；该次AggregateStatus须断言全部域就绪及原VerifyStartup。隔离迁移/写路径负例与精确未变拥有方证据保持，不能靠source-assets长布尔标签补覆盖，也不在生产写业务做验证。
5. A独立watchdog采用单列原Install -Execute：复制已审script/helper/launcher/installation，核旧task XML后更新、Enable、Start TERUISI Operations Watchdog。task缺失/变化时拒绝，不能悄悄Register。Worker apply不更新此安装，若不批准该调度效果，A watchdog只记未采用。原Check -Execute可能按既有策略自动恢复/告警，通知边界必须明确；未调用TestNotification不证明零外发。此次未运行上述生产动作。
6. 两次自然守护同精确候选/同fence及完整协议，保全所有新观察原字节、SHA和中间失败/异常，不能只筛两成功。之后原新后Backup/Verify/Restore并同样绑定保全。
7. 原收尾前全12域/版本/权限/owner/active回读；仅精确只读Control Status使用B共同期限240秒重试，原错误/attempts保留。历史/行基线、离线完整报告、文档/Git与两截止分别闭合，任一失败保持incomplete/unknown，不能提前释放gate或宣布完整交付。

## 精确阻断与闭合要求

| ID | 位置、触发与当前结论 | 要求 |
| --- | --- | --- |
| P01 | [BD01–BD10草稿审查](BATCH_DRAFT_REVIEW.md)，原文见evidence/withdrawn-drafts/*.txt。PS argv与files.path不等、runtime UI文件不存在、Install缺Execute、恢复同点/sidecar不足等，均未执行 | 原草稿撤下，不能执行。沿原受审接口建立具体完整闭包或最小修复，真实隔离负例与非作者最后字节复审后才makeBatch；没有把撤下称已修好 |
| P02 | 全strict checks/covers不得自动赋passed；零业务源差异不等于业务/权限/迁移/写路径验收；Aggregate wrapper completed可包装not_ready | 真实证据逐项映射源码/制品/数据范围，通过/未覆盖分别表达；具体assertions涵盖完整12域、资源/只读路由及历史scope基线 |
| P03 | 实际安装Control的D:/运营管理系统/tools/process-deadline.ps1、native PG/Python/脚本/软件，独立watchdog工具/task闭包 | pin真实入口/直接依赖，不用候选同名文件冒充安装字节；只读绑定task XML/动作/主体/触发/设置，安装及通知效果明确精确批准。无法约束外发则阻断该采用步 |
| P04 | 可变来源、前驱、新未决批次、权限/维护/drain变化；旧成功不能代本次门禁 | 选定AB或ABC后新鲜准入，变化失效并重准备/重审/重批；started/unknown先原精确独立协调、不重放 |
| P05 | C reader lastResult=unknown/latestAttemptCoverageVerified=false；e历史PAUSED，native最后尝试来源未证明 | 快路径继续拒绝。未来另获配置授权，建立可信native全失败覆盖、连续真实日点及仍保留同点完整恢复；改ACTIVE/手工点不能代替。本次仍严格前后新备份恢复 |
| P06 | engine batch原字节/唯一owner/完整操作断言/回滚与证据尚未封存，无生产批准 | P01–P04闭合并独立复审，记录最终batch SHA、候选/前驱/Django/工具/task准确范围及回滚后，用户另行明确批准。范围文档/Worker plan不能充当它 |

[当前watchdog只读绑定](evidence/watchdog-installed-scope.json)：原script SHA99593a800321569257bf8e31fdd64dda8b558f9bacdeed316ca7000a301c162a，XML SHA23d9c262d28b7c0c18134afb8b9343e9d5e4d3b939adceab15d08243e0007a18。它是现场截点，最终不能复用失效批准。

## 回滚、停止与计时

D5不可变前驱包、guard、manifest及append-only successor历史保留。未开始切换且独立零效果证明齐备才用原cancelUnswitchedBatch；已drain须精确owner证明解除。started/unknown不自动重试Start/apply/备份/业务，独立只读回查按原reconcile追加观察SHA/noReplay，不改原失败。兼容代码回退走原受控路径，保留active/guard/authority/fence，不覆盖Django拥有方、不回D1。生产数据恢复另需精确点/库/维护窗口批准；现存点不保证未来仍保留。

后备份恢复、自然守护或最终状态/历史任一未闭合仍为未完成。统一计时批准→必要验收、批准→完整交付、其他批排队，准备/准入/备份/恢复/排空/切换/验收/文档，以及失败/协调/续接。入口不可用必须实际采样，不由切换跨度推导。当前生产指标均未测，预算尚未证明。
