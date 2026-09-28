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
- 原小时重试 webhook 若未提供 `originalScheduledAt`，候选拒绝自动新建计划，保留人工核查。**当前在线错误流程没有完成原锚点传递接线，候选转换结果不能直接批量发布。** 这是采用前依赖，不是已完成的端到端恢复。
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

现有 PostgreSQL `DingTalkScheduleTests` 的过期槽断言已更新，但本轮未启动 PostgreSQL 执行该集成类；过期逻辑通过实际函数体与合成 ORM 验证，不能替代数据库集成验收。未运行大型前端生产构建或全库压力测试，避免与并行项竞争。

## 公共文件与合并分工

- 第 1 项：`tools/django-postgres-maintenance.ps1`、`backend/system_backups/storage.py`。本项只负责准入/排空及重复回执，第 1 项保留容量、轮换、调度和恢复点验证。
- 第 2/7 项：`tools/worker-local-service.ps1`、`tools/django-local-service.ps1`、原生命周期测试。本项只增加 drain 衔接及状态，不改 supervisor、启动并行度和诊断。
- 第 3 项若涉及 helper：`tools/tmall-isolated-helper.ts`、`tools/tmall-sycm-cookie-pipeline.ts` 需逐块合并。本项只负责准入和计划时间，不改资源上限、导出算法或内存策略。
- 后端共用 `backend/teruisi_backend/settings.py` 新增一条中间件配置。无数据库迁移、权限变更或新增服务端口。

没有读取、修改或清理其他任务 worktree 和运行产物。合并时不能整文件覆盖上述公共文件。详细变更清单可用 `git diff --name-only e00d4a82...codex/release-automation-coordination` 核对。

## 待统一收尾与采用方案（未执行）

1. 用户指定统一收尾对话后，逐项合并公共文件并验证组合功能。保持现行调度及原 n8n ID，确认各来源节点能提供原 scheduledAt；小时重试从原 execution 的受验证计划/运行数据取原时间，而非恢复时 Date.now。
2. 在独立 n8n 实例、独立端口和合成 helper 上验收候选 Code 节点、持久 Wait、n8n 重启、跨日及错误响应契约。对首次触发、重试 webhook、原 execution 未决逐一验收。未通过不得发布。
3. 在独立 PostgreSQL 验证导入回执/事务和过期通知槽，再安排组合生产构建、PrepareApp、Worker 在线候选、备份及独立恢复错峰执行。保留原权限、角色、迁移、摘要、R2 自检和进程身份门禁。
4. **首次采用不能依赖新协议保护旧版进程。** 先只读确认原 n8n 非终态、helper、导入、备份/恢复及其他后台队列已排空，准备精确时间窗口、旧定义/版本摘要、前备份和兼容回退包，提交用户确认。获批后用已安装旧版唯一维护入口进入维护，成套采用后端+helper+控制器；不能在旧 backend 上跳过新能力检查。
5. 工作流改造与共享错误流程另以精确候选 diff、原 ID、active/current/published 状态和回滚定义送审；不得直接运行生成器后全量发布。新版本能力回读通过后才采用对应 n8n 接线。
6. 正式验收检查 12 组件、release/启动绑定、helper 协议、维护期间原 execution 等待、维护后按原计划范围完成及精确批次/通知账本。真实业务补跑与发送仍另需确认，优先观察原自然执行。

回退：未开始停服时用精确 CancelDrain 恢复准入；已进入维护则保留标记，在原门禁内使用已核验的兼容前驱/前向修复，不能手工删标记或降级业务事实。工作流回退前先核查所有候选 execution，不得让旧定义重算日期或重放未知导出/发送。数据库无新增迁移；本项不授权数据库反向恢复。

## 交付状态

本项作为独立候选提交并推送本分支，具体提交号与远端核验在本次交付消息中列出；未合并 main。worktree 和独立构建证据保留供统一收尾。源码/隔离测试完成不代表已采用，也不代表真实业务已补齐。总评估第 4.4 节应由统一收尾按上述待验收边界更新。
