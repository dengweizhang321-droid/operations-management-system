# 吉客云销售预检与排除仓计数修复候选

本任务从 `origin/main` 的 `4a0a7764` 创建独立分支 `codex/jackyun-sales-preflight-20261029`。本次只完成开发与必需代码检查；尚未合并 main、准备制品、发布、执行正式迁移或恢复11026。未运行功能测试、业务接口验收或生产性能查询。

## 已确认问题与原证据

以下是本轮先前已独立复核的只读诊断交接，实施阶段没有重放生产请求：

- `D:/teruisi-runtime/django-sales/logs/postgresql-2026-10-29.log:163`：上海02:05:24，`sales_order_lines` 的 `2026-09-14 <= business_date < 2026-10-29 AND NOT is_business_row` 计数发生 statement timeout。
- `D:/teruisi-runtime/django-sales/logs/django-reader.20261028-220003-3ac4cfff.stderr.log:2` 至52：指向正式 `sales/write_views.py:420` 的排除仓计数。
- `D:/teruisi-runtime/teruisi-worker-sales/logs/worker-20261028-220226.stdout.log:2699`：销售预检GET返回503，耗时7585ms；同名stderr第601、602行记录11026线程错误与exit1。
- `D:/teruisi-runtime/teruisi-worker-sales/releases/20261028T125857Z-7f8e70a23ee72777/helper/tmall-workflow-helper.mjs:9998`：`readServerPeriodShops` 抛错。旧源码在创建请求Promise之后到文件解析与筛选完成才await，期间的提前拒绝可能逃逸为未处理拒绝。
- 原清单：`D:/运营管理系统/outputs/jackyun-import-runs/n8n-export-first-11026/run-manifest.json`。交接状态为前三模块completed、sales未上传、combos未开始；计划仍importing，slot quarantined且原锁保留。本次未改这些状态或原文件。

## 改动与保留的契约

1. 原销售verify接口增加显式 `preflightOnly=1`。Worker和Django均拒绝非法值、重复值，以及与任何 `policyOnly`/`batchId` 参数组合。原管理员、无限制数据范围、HMAC、reader路由、日期校验与no-store保持。
2. 预检只聚合该期间的白名单业务行，沿用 `channel + platform + shop_name` 分组、行数和人民币分净额。只读取501个分组作为有界哨兵；runner拒绝截断、缺少分页、范围/策略不符和旧服务响应。缺店判断本身继续使用既有 `findMissingPreviouslyLoadedChannels`。
3. 预检在解析前直接await。失败以 `PIPELINE_FAILED`、阶段 `read_server_period_shops` 写入销售子审计，并把审计路径带回原父runner的失败审计/manifest链；没有吞错或新增重试。
4. 完整导入后校验仍返回原统计字段并执行原检查。新增 `sales_excluded_date_idx`：只对 `is_business_row=False` 建立 `business_date` partial index，匹配原超时COUNT的日期与布尔谓词。新增 `sales.0012_excluded_business_date_index` 仅有一个AddIndex，旧迁移字节不改；启动必需索引列表同步要求该索引存在。
5. 为该唯一结构增量接入现有有限153→154发布链：recipe、candidate、catalog、原生installer、主线schema映射、Django准备复制清单与最前置gate、release/database完整性入口、迁移代际识别。复用原身份、维护、精确前驱/制品、源字节、install-intent及unknown协调规则。154保留153已有权限，不调用新角色配置，不引入业务数据处理。

## 必需代码检查

详情见 [CHECKS.json](CHECKS.json) 与 [153→154检查绑定](sales154-mandatory-code-checks.json)。

- 改动Python源码AST语法通过；三份PowerShell入口仅Parser解析通过；main-schema Node语法通过。
- 两处TypeScript入口及其直接编译依赖以esbuild内存编译通过，均0错误、0警告；没有执行入口或输出生产制品。
- `MigrationLoader(None)` 与dummy数据库配置只读取迁移state，无数据库连接；0012依赖0011、只含AddIndex、模型与迁移state一致。新增迁移之外163份父迁移文件保持原字节口径。
- 原生schema recipe/检查记录/源码与迁移摘要仅做离线绑定检查。没有运行正式binder、PrepareApp、安装器、迁移、服务启停或功能测试。

## 发布范围与限制

完整差异涉及Worker/API、helper、Django与迁移，按既有范围工具归为完整组件结构发布。后续依次取得合并、制品准备、发布各自明确授权；迁移只执行0012结构增量，不捆绑业务导入、清理、回填或全库备份/恢复。

普通AddIndex会扫描原销售表，并在建索引事务期间阻塞写入；它不是CONCURRENTLY，耗时和空间取决于真实表规模。应在既有应用维护与排空流程内执行，保持当前超时、互斥和失败即停规则。本轮没有生产EXPLAIN或性能实测，不能保证新聚合或完整校验的生产耗时，也不能据源码交付声称五表已恢复。

Worker、helper、Django与索引须按同一候选配套采用。新runner明确拒绝旧服务对预检模式的静默忽略。旧运行的客户端rules绑定整个执行bundle，领域rules又绑定appFingerprint；因此升级后可能触发规则变更门禁，不能承诺11026可直接续跑。本次不改旧baseline、不闭合、不解除隔离、不释放锁、不重发导出、不重跑导入。原运行升级兼容与受控恢复属于后续单独授权工作。
