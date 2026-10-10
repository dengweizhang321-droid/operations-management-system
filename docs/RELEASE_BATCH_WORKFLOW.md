# 按影响分级的发布批次与等待时间

本协议是开发候选。只有对精确候选和首次严格采用范围取得明确上线授权后，才改变生产发布入口的使用方式。合并源码、生成请求和检查批次不授权维护、部署、调度或数据写入。旧已安装入口在采用之前继续执行原门禁。

## v3 无数据影响批次

新 `makeBatch` 默认生成 `teruisi-release-batch-v3`，状态 `SEALED`。先分别推导组件切换、持久数据／部署影响和备份机制三条轴，再决定数据库策略；验证强度没有作为备份开关。完整前驱/候选清单和所有增删改字节必须绑定实际 source-snapshot、候选及现场完整清单，不能只交一份自选文件列表。独立复审继续绑定完整 closure；`readOnly`、`noData`、`effects:false` 或 HTTP GET 声明不能替代机器证明。

首版证明边界是既有 CSS 同选择器/属性/规则结构的受限展示值，以及完整静态被动、零参数、无导入/事件/表达式/自定义祖先的 `use client` TSX 组件中的原生被动标签文本、有限布局类字面值。另须比较实际前后原 preparation receipt 中全部非源码环境/运行配置/npmrc/工具链输入，并封存绑定精确制品/plan/closure 的独立副作用复审原报告，明确检查布局观察器、文本消费者、持久写入和启动/构建。CSS 语法本身不证明全应用既有观察器无副作用。自定义组件、局部事件改写、PNG、Markdown、查询/API、权限、迁移、依赖、启动钩子和备份工具变更尚无 v3 证明，返回逐路径缺口并保留 `full`。不能把某个目录或文件后缀本身视为无数据影响。

合格批次为 `recovery.mode=not-required`，`databaseOperations={required:false,operationIds:[]}`，操作列表必须为零 Backup/Restore，恢复证据必须为空。它不查询日常备份调度、26 小时恢复点、7 天同点演练或目录/保留资格，日常 PAUSED 也不是其前置条件。它证明的是本次变化和封存动作没有新增持久数据效果，既有正常业务可继续自然写入，不要求发布前后全库内容静止。未知数据/部署效果或备份机制变化仍为 `full`，新 v3 不以 `reuse` 代替缺失证明。

允许动作仅为原 worker-plan、排空、Stop、apply、Start、解除排空、原 VerifyStartup/AggregateStatus 和固定 no-data-observation；禁止任意外部命令标记 `mutating:false`。原生命周期适配器、系统 PowerShell、标准 in-process collector 及解析器完整直接闭包按精确路径和字节绑定，未支持参数和输入拒绝。观察器只接受候选 `dist/client/assets` 资源与声明式 DOM/样式断言；浏览器请求仅放行首页和精确资源 GET，其余 API/请求被阻断并记录，不把 GET 当无写证明。固定两个未签名 reader GET 必须返回鉴权拒绝。浏览器可执行文件及 Playwright 库也绑定；完整权限回归测试仍需绑定候选。自然 watchdog 只读两次新鲜健康观测并保全所有遇到的原记录，不触发任务。页面无法在该读取边界下验证时拒绝，不转用任意脚本。

顺序保持 BeginWorkerDrain → StopWorker → apply → StartWorker → EndWorkerDrain → 全部验收／收尾；完整字节、路径、硬链接、重解析点、ACL、精确进程/ready、唯一 mutex、active 所有权、动作前复验和原 CAS/fence/启动绑定仍由原引擎执行。观察失败保存原证据与 unknown，不自动重放或回滚。新机制自身包含工具变化，首次采用必须由原严格流程承担 full；旧 v1/v2 已批准批次和 WAL 不升级、不删除阶段，仍由其精确采用版本续接。v2 构造需显式指定原版本，原验证/恢复资格语义保持。

以下表格和恢复复用段落描述旧 v2 的保障，不是 v3 `not-required` 的日常备份前置条件。实现及隔离验证见[本次设计](release-no-data-policy-20261010/DESIGN.md)。

## 分类与保障

分类依据**实际生产前驱 source-snapshot 与最终组合源码**的完整文件集合、字节摘要、依赖闭包和独立行为复审，不能以当前 main、某个聊天分支或目录名替代前驱。批次携带完整前后文件摘要清单及变更字节，现场重新绑定原 tree-hash 和 inventory-hash；篡改分类后重新计算批次摘要也不能绕过结构与影响门禁。

| 分类 | 证明与验证 | 备份／恢复 | 切换和回滚 | 上线验收 |
| --- | --- | --- | --- | --- |
| 展示 | 客户端 JSX 文本、普通字面 className、明确范围 CSS 值、受限静态 PNG、纯局部布尔显示交互及文档；其他可执行结构、导入、事件、依赖保持。另有独立审查绑定完整闭包，确认无数据、权限、写入、导入、自动化、生命周期、备份及依赖行为影响。相关 UI／权限回归、边界、构建及完整制品校验 | 条件全部有效时复用同一精确恢复点的证据；否则完整前后备份及恢复 | 原 Worker-only Stop／apply／Start，仍排空 helper、队列及备份任务；原前驱／兼容应用回退 | 精确资源、真实交互、权限拒绝、组件、启动绑定、自然守护及原任务全部验收 |
| 后端业务 | 经闭包复审证明普通业务影响，且没有受保护路径或权限／写入等敏感行为；领域、契约、负例、权限、边界、构建 | 完整前后备份／恢复，失败保留原恢复点及批次 | 复用 PrepareApp，按已安装能力申请 KeepPostgres 应用维护；兼容回退，数据恢复单独审批 | 原任务业务深比较、权限、资源、组件、绑定、自然守护 |
| 严格 | 数据迁移、models／SQL、权限、导入、自动化、生命周期、备份、工具、依赖／构建配置，或无法证明的可执行影响。再加并发、迁移、生命周期及备份恢复验证 | 完整前后备份／恢复；迁移保护点继续占三份策略名额 | 审查精确维护范围，沿用原引擎；迁移兼容与 PNR／前向恢复约束不变 | 业务、迁移、写入、权限、全部原任务及组件／启动／守护验收 |

impact v2 仍保守：除客户端 JSX 文本与普通字面 className 外，只覆盖同规则/属性结构的明确展示 CSS 值、严格校验的既有静态 PNG 替换，以及无请求/效果/表单/自定义元素/任意执行的局部布尔显示交互。具体语法边界及负例见[展示证明设计](release-fastpath-evidence/DESIGN.md#分类边界)。API、服务端执行、权限/归属/过滤、写入、导入、自动化、生命周期、备份、依赖/配置/构建行为和未知变化仍不得通过目录或独立人员勾选放行。代码回滚不等于数据库回滚，也不得恢复已退役 D1 业务路径。

## 展示发布的恢复证据复用

实现见 `tools/release-impact.mjs`、`tools/release-batch-admission.mjs` 与原 PostgreSQL operator 的只读 `ReleaseEvidence`。允许条件必须同时满足：

- 当前唯一日常备份调度 ACTIVE；经原 installed Backup 完成、E 盘归档／轮换闭合的最近调度回执成功且不超过 26 小时。最新调度运行失败、结果未知、配置变化或没有回执均拒绝；手工备份不能冒充计划成功。
- 选定恢复点完成不超过 26 小时，仍是 E 根直接子目录，三文件／sidecar／dump、数据库身份及业务证据由原 Verify 重新完整核验。恢复点已被三份策略淘汰即失效，保留一个旧 JSON 不能恢复资格。
- 同一 manifest／dump 的原受保护隔离恢复回执不超过 7 天，完整内容、角色、权限、迁移和隔离清理通过；恢复后的全部 owned 序列下一值严格大于现存最大 ID。旧回执只有序列下界时不自动升级为新证据。
- 当前安装环境的七项软件绑定、schema／migration／owner／ACL／RLS／函数／触发器目录、角色契约、备份 operator、保留策略与调度摘要均匹配。`ReleaseEvidence` 只读目录及主键最大值，不扫描全库业务内容、不生成 dump、不启停服务。未拥有／循环／倒退序列或不支持的归档版本拒绝。
- 原始恢复回执、sidecar、恢复点和当前现场证据都保持有效；批准前、实际切换边界及收尾再查。复用失败时不能沿用原快批次，须在安全取消或闭合原批次后准备完整流程并批准新的精确范围。

满足这些条件时，**省掉本次前后两轮新完整 dump／归档及两次完整隔离恢复**；保留现场完整 Verify、当前目录／权限／序列复验、恢复点及调度检查。不会为获得复用资格自动恢复日常调度、解除保护或修改保留名额。涉及备份实现或生命周期的本次首次采用属于严格发布，不能用自己的新快路径给自己减免。

日常调度经另行批准采用后，可调用 `node <已采用 release>/tools/release-daily-backup.mjs`。此包装只调用原 installed Backup，并在受保护审计目录写入 started／result；不创建、恢复或修改调度。原调度暂停时拒绝启动。失败或进程中断保留未知状态，不重放。

## 提前准备与制品复用

确认上线之前完成最终组合源码、必要测试及独立复审、真实 immutable Worker 包、Django PrepareApp、发布／回滚计划和完整批次。先查当前生效谱系与组合范围，不顺带采用 main 内未获批准的其他功能。

多个尚未执行的改动可先用 `node tools/release-composition-review.mjs <request.json>` 检查离线组合资料。输入须声明实际已采用 source-snapshot 的完整源码／库存摘要、每项完整候选、依赖、原验收与回退资料及组合源码；工具拒绝摘要漂移、不同前驱、缺依赖／循环、重叠路径及组合增删改遗漏或夹带。`ready-for-combined-review` 仅表示资料及字节集合可进入联合复审，状态是调用方声明，不能替代实际就绪、兼容性审查、原 plan／batch 准备或现场准入；`blocked` 返回退出码 2。没有两项同时就绪的真实机会就停止合批，不等待未就绪功能。输入格式与本次调查见[组合检查交付](release-high-impact-execution-20261010/REPORT.md)。

原 `node tools/worker-local-release-rotation.mjs plan --prepare-online --json` 在原发布互斥内查找**相同完整源码、前驱和构建身份**的已验证候选，找到后完整复验并返回原 plan；没有匹配时沿用原 npm ci、构建、helper、合约与全部校验。可指定 `--reuse-plan-sha256 <精确摘要>`；指定绑定失效会拒绝，不能静默选择别的候选。

准备收据绑定原 tree-hash、完整 inventory-hash、锁文件及全部源码／构建配置、Node 可执行文件字节、bundled npm 闭包、实际 user/global npmrc 字节、继承环境摘要、运行配置摘要，以及 candidate manifest、产物、helper、合约和 guard 证据。不会打印配置值。任意现成 dist 不被接受；旧没有新准备收据的候选不能直接获得复用资格。

复用仍完整检查源／依赖／dist／helper／receipt／硬链接／重解析点和精确前驱，不发启动许可。切换保留原停止身份、完整 CAS、activation fence、startup 绑定和 consumption；Django 仍执行原维护、排空、权限、迁移与就绪门禁。前驱变化时生成新计划和重新批准；本版本不自动把旧计划换绑新前驱，即使制品本身相同。

## 一批批准范围、编排与续接

`tools/release-batch.mjs` 将源码、依赖、配置、工具链、制品、测试、前驱、完整影响证明、验收、回滚、live collector、全部操作及参数封入一个 batch SHA。`prepare <request.json> <batch.json>` 只读源码并写本次候选文件；`inspect <batch.json> <sha>` 可审查范围。

请求中的 `binding` 使用原源码 tree SHA、完整 source inventory SHA、精确 Worker plan／candidate manifest、包锁 SHA、工具链／配置复合 SHA 和测试证据 SHA；`tests` 需绑定同一源码和候选并满足分类检查。`collector` 使用标准 `release-batch-admission.mjs collect <batch.json> <tests.json>`，绑定 Node 与相关脚本／证据文件；`operations` 明确顺序、类型、参数、断言和 acceptance `covers`，不能只写“已验收”。第一轮采用的现场适配／任务验收脚本也在独立复审和批次批准范围内。

v2 批次另外封存 `databaseOperations.required` 和精确 operationIds，禁止用执行中跳过步骤取得快路径。旧批准不能换绑 v2；旧批次及未知结果继续使用原采用版本协调。标准 collector 可在新批准 `in-process-content-evidence-v1` transport 中复用同批准备身份的派生计算：10分钟/24次、私有内存、完整内容重新采样、变化失效和原动作前检查；无持久成功缓存。完整制品没有进入本轮新缓存，原大树阶段与实际 apply 边界仍完整核验，动态精确进程、权限、排空、维护与恢复继续现场检查。接口、计时子项及限制见[任务 C 设计](release-fastpath-evidence/DESIGN.md#有界证据复用)。

操作顺序为准备复验 → 前备份／恢复（如需）→ 原切换 → 原上线验收 → 经另行业务授权的真实执行／补数 → 后备份／恢复（如需）→ 收尾。展示模式也保留 `prepare`、`switch`、`acceptance`、`closeout`。备份／恢复阶段强制原 Action 和真实结果类型；恢复引用同批已确认 Backup 的目录、manifest、dump 与内容，不接受其他点或空标签。

参数可用 `{receipt:<已完成操作ID>:backupDirectory}`、`manifestSha256`、`maintenanceId` 引用已闭合的前一步输出。不能引用未知、未完成或其他批次。恢复操作还需 `backupOperationId`，输出必须对应该精确点。

固定 Windows PowerShell 5 操作在复验原声明 argv、脚本及可执行文件摘要后，使用该系统主机自己的内置 Modules 子环境并清除继承的 Django library-only 标志。Node 父进程及非 PS5 命令的完整环境保持，不能改全局模块路径或换主机绕过已绑定的构建身份。原 `-File` 参数通过 UTF-8 JSON/base64 数据及有界命名参数转交，控制台输入输出固定 UTF-8，避免中文恢复点路径在 Node 管道中损坏；拒绝相对入口、重复／位置参数与未支持的开关，不把路径／值拼成可执行代码。模块加载失败发生在原 operator 审计之前时，也先保留 unknown，由独立只读零效果证明闭合；不能因没有新 dump 就自动重试。

获得明确授权后才执行：

```powershell
node tools/release-batch.mjs execute '<精确 batch.json>' '<批准 batch SHA>' '<用户明确上线的实际 ISO UTC 时间>'
node tools/release-batch.mjs status '<同一 batch.json>' '<同一 SHA>'
```

全批复用原 `TERUISI.Worker.ReleaseRotation.v1` 互斥；嵌套 plan／apply 只能使用本轮有效内存 lease。互斥忙时仍立即拒绝；新 `_queue` 审计记录请求、获得互斥或阻断及原因，人工续接间隔保留在总批准区间内，并没有新增自动后台排队。持久 active 记录跨聊天保留唯一批次所有权；采用新版入口后，普通旧式 plan／apply 也拒绝抢占。每个操作先 fsync started，再调用原 operator，最后记录摘要及有限输出。正在进行的生产动作没有返回、阶段中断、输出断言失败，都留为 unknown／started；不靠退出码或重复调用猜测结果。

展示路径强制 `BeginWorkerDrain → StopForRelease → apply → Start → EndWorkerDrain`。前后新动作仍由唯一 Worker 引擎持有 Worker→Django 原互斥，复用已安装 Django 的 helper／备份／background／request lease 排空。持久 requests gate 在整个 Stop、apply、Start 区间阻止新任务；后端／PostgreSQL保持运行，精确新 helper 重新确认 gate、无在途且已启动后才解除。缺能力、错 owner、quarantine、备份未决或解除失败保留 gate；普通旧 Stop 不会被误称自动排空。严格路径使用原 EnterMaintenance 内的同一排空协议。

安全续接只跳过同批已确认 passed 的步骤。未知必须先对精确操作做独立只读回查；`reconcileOperation` 要求 batch／operation／观察摘要和不重放声明。只能在证明零效果时将未知收敛为 failed 允许重试；已确认完成则收敛 passed。已开始切换／业务执行的批次不得取消。未切换且无未知的批次可由 `cancelUnswitchedBatch` 在独立零切换证明下释放占用；已排空时必须先经原精确 owner 入口解除 gate 并独立确认。保留全部审计，再准备新批准范围。不得手工删除 active、任务记录或结果未知的日志来重跑。

所有原任务验收与收尾操作都通过后，才写 completed 并释放所有权。后备份失败不能先宣布发布全部完成。回滚是批次的受控异常方案，仍调用原 rollback／兼容发布／另行批准的恢复入口，不自动重放 apply 或业务写入。

## 计时口径

从用户明确“上线”的实际时间开始记录总等待，包含排队、现场复验、阶段间等待、备份、恢复、切换、验收、业务执行及收尾。准备前移单独报告，不从原记录中删掉。每阶段记录执行耗时和等待原因；失败／续接仍保留最早批准时间。`switchSpanMs` 是该批切换操作跨度，不能冒充 HTTP 精确停服；真实不可用窗口需另做请求可用性采样。

隔离比较使用相同源码、依赖、配置、工具链、候选、数据和验收，重资源步骤串行。原始失败、未知、清理和样本条件保留；合成小库、私有 HTTP fixture 和一次实际构建复用只能证明机制，不承诺生产分钟数。历史单次 63 分钟区间也不能作为当前稳定性能基线。

原发布能力见 [启动与发布](STARTUP_RELEASE_OPTIMIZATION.md)，原保留／恢复见 [备份约定](BACKUP_RETENTION.md) 和 [PostgreSQL 运维](DJANGO_POSTGRES_OPERATIONS.md)。本轮开发及证据见 [任务报告](release-wait-optimization-20261008/REPORT.md)。
