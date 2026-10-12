# 按影响分级的发布批次与等待时间

本协议是开发候选。只有对精确候选和首次严格采用范围取得明确上线授权后，才改变生产发布入口的使用方式。合并源码、生成请求和检查批次不授权维护、部署、调度或数据写入。旧已安装入口在采用之前继续执行原门禁。

## 分类与保障规范入口

验证强度、full/reuse/not-required资格、v4精确首次采用、维护范围、切换和恢复边界统一见[验证与发布规范](规范/验证与发布.md#发布影响验证与恢复策略)。本页只保存准备、封存和续接操作，不再复制分类正文。旧文档中的“候选”是原写作时点；当前实现/采用/未验证范围以规范及精确采用回执分别核验。

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

## v4首次采用操作入口

限定资格与顺序见[精确批准的首次采用策略](规范/验证与发布.md#精确批准的首次采用策略)。原设计与失败证据保留在[首次采用设计](release-first-adoption-targeted-20261011/DESIGN.md)，不得用历史方案或批准替代新候选资格。

## 计时口径

从用户明确“上线”的实际时间开始记录总等待，包含排队、现场复验、阶段间等待、备份、恢复、切换、验收、业务执行及收尾。准备前移单独报告，不从原记录中删掉。每阶段记录执行耗时和等待原因；失败／续接仍保留最早批准时间。`switchSpanMs` 是该批切换操作跨度，不能冒充 HTTP 精确停服；真实不可用窗口需另做请求可用性采样。

隔离比较使用相同源码、依赖、配置、工具链、候选、数据和验收，重资源步骤串行。原始失败、未知、清理和样本条件保留；合成小库、私有 HTTP fixture 和一次实际构建复用只能证明机制，不承诺生产分钟数。历史单次 63 分钟区间也不能作为当前稳定性能基线。

原发布能力见 [启动与发布](STARTUP_RELEASE_OPTIMIZATION.md)，原保留／恢复见 [备份约定](BACKUP_RETENTION.md) 和 [PostgreSQL 运维](DJANGO_POSTGRES_OPERATIONS.md)。本轮开发及证据见 [任务报告](release-wait-optimization-20261008/REPORT.md)。
