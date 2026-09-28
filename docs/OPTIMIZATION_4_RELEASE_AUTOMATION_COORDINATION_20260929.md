# 第 4 项：发布与自动化协调（独立候选）

日期：2026-09-29。范围：`SYSTEM_OPTIMIZATION_ASSESSMENT_20260928.md` 第 4.4 节。
基线：`e00d4a82b2480d05646f5e0b65b13e9a2cc6bb7e`；分支：`codex/release-automation-coordination`。

本轮只开发、隔离验证和推送分支，不合并 main，不修改在线工作流、调度、部署或维护状态，不运行真实下载、导入、恢复或发送。按本轮并行要求，总评估文档未改，由统一收尾对话更新。

## 核对结果

| 能力 | 原有行为 | 本项处理 |
| --- | --- | --- |
| 在线准备 | Worker `plan --prepare-online`、Django `PrepareApp` 已存在 | 复用，不新增发布引擎或变更构建门禁 |
| 维护 | Worker→Django 同线程生命周期锁、持久维护、精确 ID 退出、KeepPostgres 已存在 | 增加停服前分阶段排空；原入口和锁顺序保留 |
| helper | 同 execution 原子领取、天猫分店隔离、隔离线程异常隔离已存在 | 新领取读取持久 drain；已有 execution 继续原 A/B/C/P/M 链 |
| 导入 | 各域 PostgreSQL 幂等、批次回查、原始请求回执已存在 | Django 请求持共享执行锁；停止前等待其释放，不复制导入账本 |
| 备份页面 | state.lock 内准入、queued/running/unknown 阻止维护已存在 | drain 期间拒绝新任务；精确重复返回原回执；未知结果不自动清理 |
| 备份/隔离恢复 operator | 已共用 PostgreSQL 运维 mutex，但原维护入口未获取它 | 维护与退出阶段获取同一个 mutex；占用时保留 drain 并拒绝停服 |
| 重试 | helper 前最多 72 次、每 5 分钟等待；部分错误派生一小时完整 execution | 维护等待和等待耗尽不派生新 execution；候选同 execution 等待保留原时间 |
| 通知 | 已有发送前预留、unknown 不重发；过期 5 分钟槽不补发 | 定时器与 Stream 消费者持背景执行锁；过期自动槽补记 denied/missed_window |

原缺口确认来自入口调用顺序与隔离交错测试，未通过停止生产服务复现。

## 候选的实际行为

1. `EnterMaintenance` 创建 `run/automation-drain.json`（独立控制标记，不是业务事实源），绑定精确 ID、runtime 与 KeepPostgres 范围。阶段为 `helpers` 时禁止新 helper 执行和新后台发送；已有 helper、发送及其后端读取继续。
2. helper 必须在 `/health` 回读协议 `teruisi-automation-drain-v1` 和同一 drain ID。仅当 busy=false 且槽列表为空才进入下一阶段。隔离线程 quarantined、协议不匹配、离线或等待超时均拒绝停服。默认 helper/请求累计等待预算 900 秒，超时保留标记。
3. 备份控制台 queued/running 完成前继续等待，unknown/损坏记录停止。后台执行共享锁释放后，将阶段单调推进到 `requests`，Django 拒绝新的业务请求（503、accepted=false、Retry-After=300）。live/ready 健康接口保持原语义。已受理请求、导入事务及流式响应继续持锁至完成或关闭。
4. Python 使用 Windows `LockFileEx` 共享字节锁；PowerShell `FileStream.Lock` 获取排他锁证明已受理请求排空。不能使用 CRT 的 LK_NBRLCK 代替共享锁，隔离测试已发现其会错误串行化并拒绝并发请求。
5. 最后获取原 PostgreSQL 运维 mutex，并再次在备份 state.lock 内核验任务后写原 system-maintenance。之后才调用唯一 Worker/Django Stop。完成且复验停止后记录 `drainedStopped=true`；此前 operator 不得在请求排空与停服之间插入新的操作。完全停止后原获批 Backup/Verify/RestoreRehearsal 能力保留。重复 Enter 不重复停止已完成的维护。
6. `MaintenanceStatus` 同时返回 maintenance 与 automationDrain。停服前失败可按同一 ID 重试；精确 `CancelDrain -MaintenanceId <id>` 只撤销尚未进入 system-maintenance 的 drain，不停止或启动服务，不重放任何业务。进入维护后仍用原 `ExitMaintenance`；退出前再次检查备份/operator 排空。
7. Exit 后原 Start 恢复服务。服务就绪只证明可准入，原 execution、文件、批次、日期覆盖和发送账本的终验仍须分别完成。

普通显式 Stop/Restart 的既有语义未重写，本协议用于 EnterMaintenance 发布路径。市场 AI/图片队列等尚未接入本次执行锁的后台消费者，仍须按原发布前清单独立排空；本候选不宣称已统一保护所有后台线程。

## 等待、跨日和未知结果

- 新 helper 请求只有提供规范 `X-TERUISI-SCHEDULED-AT` 才能在维护中等待；未升级的调用者明确报人工处理错误，不能静默等到次日再按新的“昨天”建计划。同 execution 改时间锚点被拒绝。
- `tools/n8n-maintenance-coordination.mjs` 是离线候选转换函数，不连接 n8n。它在领取前增加一次计划时间初始化，将领取节点改为有界的同 execution 等待。只有领取节点的网络不确定可等；它没有业务副作用，绝不自动执行 A 或业务节点。4xx 拒绝、异常响应、72 次耗尽转人工。原工作流 ID、调度、业务节点、等待节点和渠道不变。
- JD 商品日、市场榜单、推广及天猫默认结束日期使用该锚点；现有显式范围和已持久计划仍按原契约验证。吉客云实时库存/库龄不能补采旧日快照，跨日明确停止核查，不把新采集事实标成旧日期。
- 原小时重试 webhook 必须提供经核验的 `originalScheduledAt`、originalExecutionId、failedExecutionId 和 workflowId。续工已在候选中完成这条接线：复用摘要固定的只读 n8n 元数据入口，从精确失败 execution 的唯一初始化节点提取原计划。非自动执行、非 error 终态、已被恢复、删除、跨工作流、时间不合法、缺失或重复节点结果均拒绝；不暴露其他节点输出。在线定义尚未采用，不能直接批量发布。
- 候选错误流程先读取原计划，再以正在运行的原共享错误流程 execution 身份申请一次性派发预留。预留使用 create-only 文件和 fsync，绑定源工作流、失败 execution、原计划时间及派发 owner；同一失败 execution 的重复申请（包括同 owner）均拒绝，不按时间过期释放。预留或派发响应未知转人工，不自动重发。记录位于原 helper mutable root 的 `outputs/n8n-retry-dispatch`，只表示控制意图，不表示导出、导入或发送成功；达到 4096 份后停止新增并要求人工核查保留策略。
- 本轮只更新仓库共享错误工作流的候选分类（未发布）：维护等待、计划时间变更、等待耗尽及 manual_action 不派生小时重试。其余原安全分类保留。
- 原错误流程的重试 Webhook POST 曾配置三次请求重试并在派发失败后再次等待派发。请求已受理但响应丢失时可能创建重复 execution；候选改为只派发一次，错误进入 stopAndError 明记 dispatch result unknown，禁止自动重发。网络失败也不臆断零效果。此修改只在仓库候选，正式定义未改变。
- 备份新任务被拒绝表示未受理，不记作成功或取消；精确重复请求返回旧回执，不能变更 actor/请求参数。已受理任务未知须人工核查。数据库请求响应丢失仍通过原业务回执处理，排空锁释放不证明业务失败或成功。
- 钉钉过期任务遵守原“不补发”策略，用原 scheduled_at 记录 denied/missed_window；sending/unknown 不重发。该跳过不冒充已发送，也不把恢复日生成新通知。

## 隔离验证

所有写入测试均使用本 worktree 下 `.codex-tmp` 或独立临时目录。无生产数据库连接、真实导入、浏览器导出或对外发送；无 PostgreSQL 恢复或压力测试。本轮未占用生产端口；原生互斥测试使用以独立 runtime 路径派生的名称。Django 中间件测试使用本任务独立 venv，Django 5.2.17；无数据库。

| 验证 | 结果 |
| --- | --- |
| 新协调、helper 隔离、小时重试、JD/市场/天猫原计划、原生命周期组合 | 66/66 通过 |
| 请求/背景执行锁、跨进程、Python↔PowerShell 原生锁、取消、异常、原过期槽分支 | 8/8 通过 |
| 原备份控制台与新增 drain/重复/跨 actor | 20/20 通过 |
| 实际 Django 中间件、503 前置拒绝、健康、流式响应关闭 | 2/2 通过 |
| 新 PowerShell 排空测试 | Windows PowerShell 5 与 PowerShell 7 均通过；含真实独立进程持备份/恢复 mutex |
| helper 不可变构建 | 独立输出目录构建成功；未启动 bundle |
| 原 PostgreSQL 运维 operator 回归 | 20/20 通过；与上方 66 项组合共 86 项 Node 测试通过 |
| lint、diff | 全库 lint 0 错误、12 警告；本项文件定向 lint 无输出；diff --check 通过 |

机器可读记录和 13 份离线 n8n 候选摘要见 [隔离证据](evidence/optimization-4-release-automation-isolated-20260929.json)。候选 JSON 位于本 worktree 的 `.codex-tmp/n8n-maintenance-candidates`，不进入正式 n8n；可从转换函数及仓库原模板再生成。

测试发现并修正：Windows CRT 读锁不共享；备份精确重试被过早维护门禁拦截；system-maintenance 写入到停止完成之间需额外禁止 operator 插入。原生命周期测试增加隔离 drain 桩，排空本身由新增原生测试独立覆盖。

以上表格为首轮验证。用户要求完成剩余任务后，已另行执行真实隔离 n8n 与 PostgreSQL 集成，续工证据见下方。没有执行生产压力测试。

## 续工：完成原计划接线与实际引擎验收

- PostgreSQL 17.11 使用本任务新建 cluster、端口 55884、独立随机凭据和合成数据；按原演练预建精确受限角色，不在生产 cluster 创建测试库。完整现行迁移及 **74 项 Django 测试通过**，包括定时器/通知队列、销售导入 API、内容幂等、事务回滚、请求回执和新增维护交错测试。该测试在导入请求已获准后关闭准入，原请求仍完成；新请求零回执/零业务写，恢复后丢失响应的原 request ID 返回相同完成回执，没有新上传。
- 原 PostgreSQL 通知测试已实际执行：原 scheduled_at 的 missed_window 记录、一次发送、sending/unknown 恢复不重发、后台独立锁均通过。所有发送器和模型为合成替身，并阻止非测试端口网络；未对外发送。临时 cluster 已停止，临时密码文件删除。
- 实际安装的 n8n **2.32.7** 使用本任务独立 SQLite、用户目录、主服务/runner/mock 端口和合成工作流。测试中只在此临时实例导入和发布夹具；生产 n8n 的定义、发布状态和进程均未修改。最终测试进程限制为测试 loopback 地址，外部注册表等背景请求被拒绝。
- 实际 Code 节点与 Wait 验证覆盖：领取接口短时不可用后同 execution 等待；409 立即停止且一次请求；大于 65 秒的 Wait 真正持久化后停止并重启隔离 n8n，同一 execution 恢复；跨日原计划不变；完整 Error Trigger → 原计划只读核验 → 派发预留 → Webhook → 新 execution 成功；Webhook 已受理后故意丢失响应，仅派发一次，派发流程记 unknown 而目标执行只产生一次合成效果；证据无效零派发、零效果。
- 为加速持久 Wait 演练，只在已停止的隔离 n8n 数据库中前移 waitTill，使用其原生 UTC 存储格式；原执行 ID、节点数据与计划时间不改。未前移生产调度或实际业务日期。
- 真实引擎发现并修正了模拟测试漏项：任务执行器序列化 HTTP 异常后不保证保留 statusCode，因此改为 `returnFullResponse + ignoreHttpStatusErrors` 后明确检查状态；readiness 成功早于 webhook 注册，验收等待实际激活完成；错误流程必须在隔离实例发布后才会被 Error Trigger 调用。
- `tools/generate-n8n-maintenance-candidates.mjs <绝对新目录>` 可离线、create-only 生成 13 个目标候选、共享错误流程及摘要 manifest，共 14 份定义。它拒绝覆盖源定义目录，不具有连接、发布或执行 n8n 的能力。真实采用仍需对精确候选与原 ID 成套确认。

续工结果见 [完成证据](evidence/optimization-4-release-automation-completion-20260929.json)，保留首轮证据的历史边界。独立前端生产构建与 helper 不可变构建均通过；547 模块后端边界检查通过，全库 lint 0 错误、12 警告。

串行全量 Node 回归首次结果为 2692 项：2662 通过、23 跳过、7 失败。7 处均为本 worktree 初始化遗漏：4 处缺少旧测试固定引用的 `.runtime/test-venv`；3 处因首次 `npm ci --ignore-scripts` 未安装原有摘要固定的 heap adapter。补齐独立 Python 环境并执行原 `npm run postinstall` 后，对应 6 个文件共 51 项复验全部通过。没有改动这些业务实现或放宽断言，没有尚未解决的测试失败；不把首次全量日志改记为零失败。另有 30 项文件锁/备份/真实中间件 Python 回归通过。

## 公共文件与合并分工

- 第 1 项：`tools/django-postgres-maintenance.ps1`、`backend/system_backups/storage.py`。本项只负责准入/排空及重复回执，第 1 项保留容量、轮换、调度和恢复点验证。
- 第 2/7 项：`tools/worker-local-service.ps1`、`tools/django-local-service.ps1`、原生命周期测试。本项只增加 drain 衔接及状态，不改 supervisor、启动并行度和诊断。
- 第 3 项若涉及 helper：`tools/tmall-isolated-helper.ts`、`tools/tmall-sycm-cookie-pipeline.ts` 需逐块合并。本项只负责准入和计划时间，不改资源上限、导出算法或内存策略。
- 后端共用 `backend/teruisi_backend/settings.py` 新增一条中间件配置。无数据库迁移、权限变更或新增服务端口。
- 续工复用 `lib/jackyun/n8n-preflight-evidence.ts`，增加固定、只读、参数化的原执行上下文/派发 owner 核验；原只读、固定路径、链接门禁、1 MiB 上限和 helper-only 可达边界保留，对应摘要固定规则同步更新并回归。没有扩大为通用 SQLite 读取器。

没有读取、修改或清理其他任务 worktree 和运行产物。合并时不能整文件覆盖上述公共文件。详细变更清单可用 `git diff --name-only e00d4a82...codex/release-automation-coordination` 核对。

## 待统一收尾与采用方案（未执行）

1. 用户指定统一收尾对话后，逐项合并公共文件并验证组合功能。保持现行调度及原 n8n ID，成套采用已隔离验证的原计划时间接线。缺少新协议锚点的历史失败 execution 转人工，不能伪造旧计划或按恢复日期重建。
2. 本项独立 n8n 与 PostgreSQL 验证已完成；统一合并后重做受公共文件冲突影响的组合测试，不把各分支独立通过当作组合验收通过。
3. 经确认后安排 PrepareApp、Worker 在线候选、备份及独立恢复错峰执行。保留原权限、角色、迁移、摘要、R2 自检和进程身份门禁。
4. **首次采用不能依赖新协议保护旧版进程。** 先只读确认原 n8n 非终态、helper、导入、备份/恢复及其他后台队列已排空，准备精确时间窗口、旧定义/版本摘要、前备份和兼容回退包，提交用户确认。方案还须明确旧版的新任务准入冻结方式及原计划补偿清单；不能仅凭一次空闲快照停止旧服务，也不能悄悄暂停调度漏掉任务。临时暂停正式触发器或补跑都须单独列入本次确认。获批后用已安装旧版唯一维护入口进入维护，成套采用后端+helper+控制器；不能在旧 backend 上跳过新能力检查。
5. 工作流改造与共享错误流程另以精确候选 diff、原 ID、active/current/published 状态和回滚定义送审；不得直接运行生成器后全量发布。新版本能力回读通过后才采用对应 n8n 接线。
   14 份候选包含历史未激活的对照模板；不得把这些模板一并激活。正式目标和原激活状态以切换前只读快照为准，原调度不因生成候选而恢复或变更。
6. 正式验收检查 12 组件、release/启动绑定、helper 协议、维护期间原 execution 等待、维护后按原计划范围完成及精确批次/通知账本。真实业务补跑与发送仍另需确认，优先观察原自然执行。

回退：未开始停服时用精确 CancelDrain 恢复准入；已进入维护则保留标记，在原门禁内使用已核验的兼容前驱/前向修复，不能手工删标记或降级业务事实。工作流回退前先核查所有候选 execution，不得让旧定义重算日期或重放未知导出/发送。数据库无新增迁移；本项不授权数据库反向恢复。

## 交付状态

本项作为独立候选提交并推送本分支，具体提交号与远端核验在本次交付消息中列出；未合并 main。worktree 和独立构建证据保留供统一收尾。源码/隔离测试完成不代表已采用，也不代表真实业务已补齐。总评估第 4.4 节应由统一收尾按上述待验收边界更新。

首轮实现提交：`de5de9e44b9b8db785de417f1688dbeb2b2ea944`；首轮交付记录 `0d45912d`，均已推送。首轮 26 个变更文件保存在首轮证据的 `changedFiles`。本次续工完成上一轮列出的开发与隔离验证缺口，当前仅保留统一合并、组合验收及获批生产采用事项。续工文件清单保存在完成证据中，实际提交号随本次交付列出。

续工实现提交：`2f9e0da7a607e91d1ca0695c91a81d6003f9beec`，17 个续工变更文件；已推送并与 origin 同名分支精确核对。此处后续仅更新交付记录，主工作区与总评估文档未改，分支/worktree 保留给用户指定的统一收尾对话。
