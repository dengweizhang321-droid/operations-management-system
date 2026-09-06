# 全局 D1 控制链脱钩

## 状态与边界

2026-09-06：本变更实现了控制链脱钩协议，并在独立工作树完成合成数据库、配置兼容、发布链和构建验证。**尚未正式采用。** 本机当前 effective release 仍是 `20260905T180043Z-7364a22437c52ae1`，其启动控制器仍依赖历史 D1；不能据此移动、删除或销毁生产 D1。

业务权威继续是 Django/PostgreSQL，现有 React 前端和薄 Worker 保留。R2 市场/网店图片与运营事务附件字节不在本次范围内。本变更不新增数据库迁移、业务写权限、数据 revision、双写或回退路径。

此前已部署状态与只读核查记录见 [全局退役评估](GLOBAL_D1_RETIREMENT_ASSESSMENT.md)。下文描述待采用代码，不是新的生产采用记录。

## 替代证明

首次采用使用 `worker-local-release-rotation.mjs plan --adopt-d1-control-retirement`。这是受控构建和计划写入操作，要求 Worker 已停止，不能把它当成在线 dry-run。

计划阶段只读核验 12 个退役单元的历史终态，覆盖销售、财务、网店、市场、商品经营、库存、运营事务新品、运营事务全板块、客服、ERP、权限和 AI。核验使用各域 operator-only SQL 的精确对象定义、空 tombstone、永久 guard 和 completed receipt；财务额外核验 PostgreSQL owner。后续迁移将原共享表替换成终态 view 的情况，以最终 view 契约核验，不要求已经合法消失的旧表 trigger 复活。历史 migration SHA 只允许文件的精确 LF/CRLF 字节变体，不接受任意 SQL 等价改写。

对历史库的只读核验得到的最终 view/guard 数为：销售 9/9、财务 0/42、网店 15/9、市场 49/9、商品经营 3/18、库存 7/21、新品 2/0、运营事务 14/42、客服 5/18、ERP 7/18、权限 2/6、AI 40/120。库存和新品数量包含后续共享表终态替换，不能直接与最初单域迁移的数量相减判断异常。

同时核验固定回环地址上的 23 个 Django reader/writer/BI readiness 身份，并对部署清单、服务配置及各域 enabled 文件做前后摘要比较。证明只保存摘要、终态数量和 cutover ID，不保存凭据或业务明细。既有销售 attestation/forward-recovery 摘要与各域 receipt 中的保留证据摘要一起绑定；本操作不创建新的完整 D1 归档或 PostgreSQL 备份，不取代发布前备份与独立恢复门禁。

候选 release 的 `audit/global-d1-retirement.json` 由 manifest 精确绑定文件 SHA；内部同时绑定源码、构建、release ID、bootstrap authority、采用前任 manifest、历史路径身份及终态证据。初次 `apply` 在修改受保护入口之前，再从候选的不可变 source snapshot 和当前 D1/PostgreSQL 重新采集并比较证据。证据变化即拒绝采用，需要重做计划。

后续版本继承同一份原始证明，不再打开历史 D1。完整 successor 链拒绝删除证明、替换证明、跨链复用、过期 CAS、旧 release、分叉、篡改及孤立 sidecar。启动与自动子进程恢复只验证不可变证明和 effective head；已经安装受控 runtime 的机器永久拒绝旧源码启动器，即使历史 D1 或 authority 文件丢失也不能放行旧入口。

`worker-local-release.mjs` 保持独立可信验证器，不依赖旁边的源代码文件；Django 部署复制该单文件后的校验契约仍成立。D1 采集器只在明确的首次采用操作中动态加载。最初安装阶段的 D1 检查和历史审计工具仍是隔离材料，不是正式采用后正常发布或运行的依赖。

## 配置和自动化

- Django `service.json` v5 中的 `erpSourceD1` 只作为规范绝对路径元数据读取，不检查文件存在；v6 显式声明 `backend=django-postgresql`，允许没有该路径。显式历史退役操作仍严格检查源文件。固定端口、进程身份、ACL、authority、readiness 与启停协议不变。
- 天猫 helper/下载校验直接引用 `normalized-import`；市场图片修复引用独立 `image-repair-contract`，保留原解析和 URL 规则。旧 D1 实现不会随这些纯函数进入日常执行依赖图。
- `netshop:promotion:backfill` 及旧脚本的 CLI 入口永久拒绝执行；历史导出函数仅供隔离研究与夹具使用。普通 Drizzle 生成继续失败关闭，新结构使用 Django migrations。
- `check:backend-boundary` 自动扫描 `app/`、`worker/`、真实 helper 及 package 中的日常 Node 入口和传递动态导入；本次覆盖 366 个模块，违规 0。PowerShell 生命周期和首次采用的隔离审计协议由专门测试覆盖，不把它们冒充为此业务依赖图的一部分。

## 验证与尚未执行的门禁

新增测试覆盖完整退役单元、错误/重排的域、缺失 guard、额外 view 写入 trigger、未完成/错误摘要 receipt、历史 CRLF、文件篡改、跨版本/路径绑定、硬链接、非 canonical JSON、23 个 readiness 角色及部署文件中途变化。

发布夹具在首次采用后撤去其 SQLite 文件，再采用第二个 successor，两次启动门禁均通过；旧版本与篡改证明被拒绝。首次证据复验失败时受保护入口和发布链保持不变。PowerShell 5 配置夹具验证 v5 缺失 D1、v6 无 D1、错误 backend/端口及历史 operator 的拒绝行为。

仓库单元测试、lint、隔离 Vinext 构建与 rendered Worker 测试需全部通过。构建 Worker 在无 D1 binding、无 Django 服务配置的临时端口上能启动，readiness 返回缺失 23 个服务且不回退。helper 使用临时端口完成打包后健康检查。

本分支验证结果：全量单元测试共 1,868 项，1,848 通过、20 跳过、0 失败（`--test-concurrency=2`）；隔离构建成功，20 项 rendered Worker 测试全部通过；全量 lint 为 0 错误。默认高并发复跑曾出现两项既有短时序测试失败，降低并发后通过，未修改对应业务实现或放宽断言。

最终证明类型收紧后，27 项证明/发布协议测试再次全部通过。全库 TypeScript 检查仍有既有诊断，不能报告为通过：使用同一依赖环境、以 Git HEAD 源码作内存覆盖的对照检查，原基线为 160 项，本分支为 141 项，新增诊断 0 项，消除 19 项；本次新代码未增加诊断。

这些是合成数据库和协议层隔离测试，**不是完整 23 服务 PostgreSQL 镜像的冷启动、真实 supervisor 故障恢复或生产发布演练**。在正式宣布控制链脱钩前，仍需对应镜像联调、备份/独立恢复证据、必要复审，以及正式采用后的实际启动、恢复、快捷方式与 API 回读。当前不合并或部署本分支，不更改运行目录。

## 正式采用顺序

1. 按 [PostgreSQL 运维规范](DJANGO_POSTGRES_OPERATIONS.md) 核验备份与独立恢复证据；保留历史 D1、全部迁移 receipt、tombstone/guard 和既有采用链。核验镜像与生产契约及最新 main 集成结果。
2. 获得本机维护窗口授权后，按 [聚合切换发布门禁](DJANGO_AGGREGATE_CUTOVER.md#正式发布门禁) 通过现有受控 operator 更新 Django runtime 控制器和应用，完成 23 服务身份与 readiness 回读。必须先完成这一步，再采集 Worker 采用证明；手工复制 runtime 文件或重写旧 manifest 不被允许。
3. 在受控 Worker 停止状态，由固定干净集成工作树执行首次 `plan --adopt-d1-control-retirement --json`。检查完整候选、计划 SHA、前任 head、退役证明与当前 PostgreSQL 部署绑定，再使用精确 SHA 执行 `apply --approved-plan-sha256 <SHA> --json`。
4. 回读唯一连续 effective head，立即通过既有 `InstallStartup/VerifyStartup` 绑定并验证登录快捷方式；经唯一启动引擎启动，核验 23 服务、Worker/helper 健康及有权限的只读 API。保留真实采用证据后才能升级本文件的状态。
5. 后续 `plan --json` 自动继承证明，不再使用首次采用开关。任何旧 release/legacy/D1 业务恢复都禁止；恢复继续使用兼容代码、PostgreSQL 备份/WAL/PITR 或受控前向修复。

正式采用不包含物理销毁历史 D1。归档移动与销毁需要单独的数据保留决策，不能通过删除生产文件来代替隔离无 D1 验证。
