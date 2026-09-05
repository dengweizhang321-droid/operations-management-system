# AI 助理完整数据域 Django/PostgreSQL 迁移

## 状态与范围

本文件描述 `codex/django-ai-assistant` 的迁移候选。代码重构、隔离系统验证、历史数据采用与恢复演练已完成；**尚未执行本机正式切换、生产数据导入、D1 退役或服务重启**。正式运行状态必须以受控切换证据和实际 effective Worker head 为准，不能用本文件中的镜像 run 冒充正式证据。

迁移覆盖 AI 对话、模型、渠道与回调、知识、个人记忆、工具审计、表格产物与下载审计、确定性分析沙箱、Agent、DAG 与人工复核、AI 空间模板/图片配置/任务/资产/收藏/清理队列，以及全部历史派发账本、检查点和事件。39 张历史表进入 AI 自有 PostgreSQL app；新增 revision、authority、通用请求 receipt、mutation audit、migration run 5 张控制表，共 44 张表。

既有 React 六个工作区与公开 `/api/ai/*` 入口继续使用。`lib/ai/tool-registry.ts` 仍是唯一工具能力声明，领域读取继续进入各业务域的有界 consumer，不复制业务事实或获得其他域写权限。

## 权威与调用链

```text
React / MCP / 当前业务模块
  → Worker：真实 principal、权限、同源、输入大小、HMAC、超时、响应边界
  → AI reader 127.0.0.1:8111 / AI writer 127.0.0.1:8112
  → backend/ai_assistant：领域校验、模型循环、状态机、CAS、幂等、审计
  → PostgreSQL AI 自有表

Django AI → HMAC /api/ai/internal/edge
  → 中央只读工具执行器、各业务域 consumer，或私有 R2 图片字节适配
```

- reader 使用 `teruisi_ai_reader`，2 个线程，只读事务；writer 使用独立 `teruisi_ai_writer`，6 个线程。两者要求相同且已经激活的 AI epoch/cutover，并使用闭合表授权。
- writer 只写 AI 表；权限域用户表仅用于实时复核 principal。模型请求、图片请求和 R2 网络调用不持有 AI revision 行锁。同步主请求与嵌套 consumer 分别最多占用两个线程，另保留两个线程处理取消、工具审计等回调。
- 通用写请求绑定原方法、路径、query、body、request ID 与 principal 摘要。聊天、图片、Agent/DAG 另保留客户端业务幂等账本。已派发但结果未知的模型/图片调用不会自动重复付费。
- PostgreSQL 具有写权 fencing、不可变身份、追加式审计、延迟记忆审计约束、单向 authority 与 revision 约束。D1 `0113` 在激活前先冻结旧写入；`0114` 将 39 张事实表和 authority 变为 40 个空 tombstone view，安装 120 个永久写入 guard。
- 普通 Drizzle journal 不包含 `0113/0114`。旧 AI D1 实现隔离在 `tests/legacy/`，生产入口无 AI SQL/schema bootstrap/fallback。
- AI 空间只迁任务和资产元数据；私有 R2 图片字节保留原命名空间，按 owner/scope 授权，PNG 尺寸/内容摘要/对象元数据回查后才发布。取消、过期租约、未知派发不会发布迟到结果；清理队列拒绝删除已发布或仍可发布的对象。其他领域的 D1/R2 不受此退役影响。
- 上海业务日期、人民币分、净额与正向销量、大毛利率、`刷刷仓` 排除和市场 TOP 覆盖口径保留。

## 模型凭证与部署配置

历史 AES-GCM 密文原样迁移，不重新生成加密密钥。`django-ai.ps1 -Action ConfigureCredentials` 从固定、已确认的原 Worker `.dev.vars` 转存唯一 `AI_SECRET_ENCRYPTION_KEY` 到当前 Windows 用户 DPAPI 密文，分别生成 reader/writer 数据库密码。密钥与模型原文不进入日志、Git 或证据。

本次源配置的精确模型来源为 `https://apihub.agnes-ai.com` 与 `https://ark.cn-beijing.volces.com`。正式转存时必须原样显式传入这两个 origin；它们是本次配置清单，不是新增供应商授权。启动前 `ai_credentials_check` 离线复验全部模型与回调密文和 origin，不发起付费请求。

Worker 受控环境需增加：

```dotenv
TERUISI_DJANGO_AI_READER_BASE_URL=http://127.0.0.1:8111
TERUISI_DJANGO_AI_WRITER_BASE_URL=http://127.0.0.1:8112
```

内部 HMAC 继续使用既有部署 secret；AI reader/writer 的 epoch、cutover、加密密钥及 origin 由 runtime controller 注入。`ai-enabled.json` 绑定本次 authority、migration run 后加入总控、聚合 readiness 与 supervisor。启用 AI 后连接预算门槛为 128，不得降低其他域线程或连接配置以规避门禁。

## 可复现的隔离验证

先在独立 worktree 安装依赖。用 `tools/ai-domain-snapshot.py` 以 SQLite `mode=ro` 事务导出 39 张表到该 worktree 的 `.runtime/ai-source-rehearsal.sqlite`；快照不包含其他域事实，拒绝重复目标、重解析点、超界数据和缺表。

```powershell
.\.runtime\ai-test-venv\Scripts\python.exe tools/ai-postgres-rehearsal.py --all-backend-tests
npm run test:unit
npm run lint
npm run build
node --test tests/rendered-html.test.mjs
git diff --check
```

演练脚本仅接受 worktree，创建独立 PostgreSQL cluster，端口 55443、随机凭据和专用目录，finally 内关闭本次 cluster。AI PostgreSQL 测试与其他业务域的 SQLite 单元测试分别运行；后者包含依赖 SQLite 的历史夹具，不能改用超级用户 PostgreSQL 来冒充运行角色 readiness。真实 AI reader/writer HTTP 服务使用 18111/18112，测试结束后只终止本次创建的两个进程。

每次完整演练包括：39 表 dry-run → 精确批准 apply → 事务内外摘要复验 → 完整隔离数据库 dump → 隔离目标恢复 → 摘要复验 → D1 冻结与 PostgreSQL 激活 → 最小权限账号负向测试 → 19 项真实 HTTP 契约检查。provider/R2 使用有界测试替身，外部通知和付费模型请求为零。正式支付供应商的可用性仍需操作员在部署后通过既有“测试模型”动作验证。

2026-09-05 源快照为 536 行：模型 4、对话 1、消息 2、表格 3、删除审计 1、知识 6、系统设置 1、图片模板 3、图片 schema 标记 1、工具审计 514，其余 29 表为 0。规范化源/目标/恢复摘要均为：

```text
1218c81a9cc6a36ddc68b584bf82f35634b5154fbf6e0ef32150d87946358cca
```

4 个原模型密文离线解密成功；3 个历史表格的结构和摘要一致。缺失的历史 audit `invocation_id/provider_call_id` 使用显式空值兼容；历史 JSON、密文、时间戳含义与消息 rowid 顺序保留。详细脱敏验证结果见 [`AI_ASSISTANT_MIGRATION_VALIDATION.json`](AI_ASSISTANT_MIGRATION_VALIDATION.json)，原始快照和测试数据库只在忽略目录中。

## 本机正式切换的顺序与门禁

目标仅为当前 Windows 主机；尚未执行以下步骤。`AGENTS.md` 第 10 节要求用户明确批准服务停止/重启，且本次需部署共享 Django app，受控 DeployApp 要求全部应用进程停止。因此必须批准一个包含 Worker 和全部 Django reader/writer 的维护窗口。迁移不改其他业务域事实与 authority。

1. 核对最新 main、完整验证报告、候选提交和受控发布源，确认没有活动 AI 请求、Agent/DAG、图片派发或待处理结果。确认正式 PostgreSQL 备份与独立恢复演练可用，保留旧 AI 源快照和迁移审计。先记录各模块健康状态、effective Worker release 与启动绑定。
2. 通过既有总控受控停服，部署经审查 Django app。`django-ai-cutover.ps1 -Action PrepareRuntime` 只在全部应用进程停止时应用 Django 迁移。配置独立 AI DPAPI 凭据和闭合 reader/writer 授权；原加密密钥不旋转。
3. `Snapshot` 输出新的受保护快照，`MigrateDryRun` 生成正式 dry-run ID；`MigrateApply -ApprovedRunId <本次精确 dry-run ID>`，再 `MigrateVerify`。任何源/路径/摘要变化、目标非空、活动外部派发、约束错误均拒绝采用。
4. `InstallD1Authority` 安装 `0113`；`AuthorityPrepare` 在活源再次核对正式 apply，先冻结 D1。制作**绑定本次 AI apply 和当前部署**的 exported-snapshot PostgreSQL 正式备份，并在生产 cluster 之外完成恢复演练。保存精确备份 manifest SHA 和恢复 receipt。
5. `AuthorityActivate` 需要本次 apply/cutover、24 小时内备份 SHA、匹配的成功独立恢复 receipt。它先提交 PostgreSQL authority，再终结 D1 ownership；精确重入完成同一次激活，不生成第二个 epoch。此后只允许新架构前向修复或 PostgreSQL 备份/WAL/PITR 恢复。
6. Worker 停止时，用现有 append-only successor 工具执行 `plan`，以精确 plan SHA `apply`，立刻回读并重绑登录快捷方式。`plan` 会构建并写计划，不是无副作用 dry-run。受控启动所有 Django 服务和 AI 服务，启用绑定本次 authority 的 AI 启动项，再启动 effective Worker head。
7. `Smoke` 验证 8111/8112、全部公开 AI 页面、非法写入、跨站、未签名与未知账号、其他全部域 readiness；只接受当前经验证的 effective Worker head，前后 head 必须一致。维护窗口期间不接受真实 AI 业务写入，避免首次退休核对水位变化。
8. 再制作绑定**已激活 PostgreSQL authority** 的正式备份并完成独立恢复，确保跨过 PNR 后的备份能够恢复到新架构。受控停止 Worker 和 AI writer；`RetirementPlan` 绑定 30 分钟内 smoke、完整非 AI 保留摘要、SQL SHA、本次 apply/cutover/epoch；`RetirementApply` 仅接受精确 plan ID 和这份激活后的备份恢复证据，不接受步骤 4 的激活前备份。复验 40 空 tombstone、120 guard 和非 AI 保留摘要，再经统一入口恢复服务、验证公开 API 和所有模块。

`0113/0114` 及 PostgreSQL authority 不提供自动反向切换。激活前失败保持旧源冻结且新服务停止，由操作员处理；激活后失败保持新架构失败关闭。任何正式备份、restore receipt、采用 run、authority、smoke、intent 或退休证据不得清理。

当前仍待实际维护窗口生成正式 source/dry-run/apply/cutover/epoch、生产备份与恢复 receipt、Worker plan SHA、effective release、smoke 和 retirement receipt。镜像摘要只能用于核对候选，不得填入正式批准参数以跳过重新取证。
