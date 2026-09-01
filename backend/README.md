# Django 领域后端

本目录承载按领域隔离的 Django 后端。当前本机销售、财务和网店域已完成 Django/PostgreSQL 正式单写切换；市场域已完成候选实现与真实数据隔离演练，但尚未部署或正式切换，生产市场权威仍是 D1。各领域必须使用独立 app、进程角色、最小权限数据库角色、revision、authority 和失败关闭边界。

2026-08-29/30，本机销售域迁移、单写切换与 D1 `0092` 退役已经完成；现场证据、动态水位和本机限制见 [迁移与切换手册](../docs/DJANGO_SALES_MIGRATION.md)。本文后续命令仍作为新环境重建、受控升级和恢复骨架，不能据此重复执行已经完成的不可逆切换。

## 组件边界

| 组件 | 责任 | 明确不负责 |
| --- | --- | --- |
| Cloudflare Worker | 公开鉴权、真实 principal 校验、HMAC principal 信封、Excel 解析、分片请求边界、请求超时与体积边界和边缘协议适配 | 不保存销售事实、批次、幂等状态或分片对象；不读写销售 D1/R2；不把销售请求回退到旧存储 |
| Django reader | 销售查询、分析和消费者查询，只读访问 PostgreSQL | 不执行导入写入 |
| Django writer | 导入、分片签收、暂存、校验和销售域写入 | 不对公网直接暴露 |
| PostgreSQL | 销售域唯一事实源和读写数据库；保存完整历史审计 | 不成为 ERP 主数据的上游权威 |
| ERP bridge | 独立消费 ERP-only outbox，将 D1 中的 ERP 主数据同步到 PostgreSQL；按 ERP 映射回填现有 `sales_order_lines.resolved_category` 派生分类 | 不消费或生成销售事件，不回写 D1；不新增/删除销售事实，不修改金额、成本、销量、`gross_profit`、其他销售字段或批次 |
| D1 | 继续作为 ERP 主数据权威来源及 ERP-only outbox 来源 | 不再承载销售事实、销售批次、销售导入审计或销售读路径 |

销售原始分片字节、元数据、owner fencing 和过期清理均由 PostgreSQL 管理，Worker 只经签名回环接口传输有界分片；销售生产路径不再使用 R2。销售写入成功必须以 PostgreSQL 中的原子发布、幂等审计和落库回查为准。全局 R2 binding 仍属于其他业务域，不能随销售切换删除。

## 本机生产拓扑

所有服务只监听回环地址：

| 地址 | 进程 | PostgreSQL 运行角色 |
| --- | --- | --- |
| `127.0.0.1:5432` | PostgreSQL 17 | — |
| `127.0.0.1:8001` | Django reader | `teruisi_sales_reader` |
| `127.0.0.1:8002` | Django writer | `teruisi_sales_writer` |
| `127.0.0.1:8011` | Django finance reader | `teruisi_finance_reader` |
| `127.0.0.1:8012` | Django finance writer | `teruisi_finance_writer` |
| `127.0.0.1:8021` | Django netshop reader | `teruisi_netshop_reader` |
| `127.0.0.1:8022` | Django netshop writer | `teruisi_netshop_writer` |
| `127.0.0.1:8031` | Django market reader（候选，正式切换前不启用） | `teruisi_market_reader` |
| `127.0.0.1:8032` | Django market writer（候选，正式切换前不启用） | `teruisi_market_writer` |
| 后台进程，无监听端口 | ERP bridge | `teruisi_erp_reference_sync` |

三种运行角色必须使用相互独立的当前 Windows 用户 DPAPI 密文，并按最小权限授权：

- reader 只读销售查询所需对象和 ERP 参照副本；
- writer 只写销售域对象，不得写 ERP 参照表或 ERP checkpoint；
- ERP bridge 只写 ERP 参照表、ERP revision、ERP checkpoint，以及现有 `sales_order_lines.resolved_category` 这一列派生分类；不得 INSERT/DELETE 销售事实，不得修改金额、成本、销量、`gross_profit`、其他销售字段、批次或导入审计。该最小例外不改变权威原始销售事实。

迁移 owner 仅用于 schema migration、授权和 RLS policy 管理，不作为长期服务身份。销售 revision 与 ERP revision/checkpoint 还必须通过 RLS 隔离，不能只依赖应用约定。

## 开发与检查

本地开发可使用 SQLite 运行单元测试，但 SQLite 不是生产销售权威来源：

```powershell
cd backend
python -m pip install -r requirements.txt
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py test sales finance netshop market
```

公开 Worker 与 Django 之间使用 HMAC principal 信封。浏览器传入的角色、scope、用户标识或内部签名头均不可信，必须由 Worker 重新生成并由 Django 验证时间窗、签名和规范化请求身份。

## 本机服务管理

受控脚本位于仓库 `tools/django-local-service.ps1`，部署副本位于运行目录 `D:\teruisi-runtime\django-sales\app\tools\django-local-service.ps1`。运行配置固定为 v3，并分别记录 reader、writer、PostgreSQL 与 ERP D1 来源。关键操作要求 reader、writer、ERP bridge 和 PostgreSQL 全部停止；脚本也会检查未登记的 ERP 同步进程并失败关闭。

首次准备的命令骨架如下。占位值必须由操作者在批准的变更窗口内填写，不能把密码、连接串或真实客户材料写入命令历史、文档、日志或 Git：

```powershell
$repo = "<运营管理系统仓库根目录>"
$sourceTool = Join-Path $repo "tools\django-local-service.ps1"
$runtimeTool = "D:\teruisi-runtime\django-sales\app\tools\django-local-service.ps1"
$erpSourceD1 = "<经核验的 ERP D1 路径>"

& $sourceTool Stop
& $sourceTool Configure -ErpSourceD1 $erpSourceD1
& $sourceTool DeployApp
& $sourceTool HardenAcl
& $runtimeTool ProvisionErpRole
```

`InitializeErpReference` 不是 ERP 基线复制工具。只有在 D1 ERP 基线与 PostgreSQL ERP 基线已经逐项核验一致后，才可用它绑定 source epoch、head、revision 和 checkpoint：

```powershell
& $runtimeTool InitializeErpReference
```

销售历史迁移、权限审计、单写所有权切换和 D1 销售对象退役在当前本机已有终态证据；新环境或灾难重建仍必须按迁移手册单独审批与留证。上述配置命令不能替代这些门禁，也不能把当前销售权威反向切回 D1。

新环境完成所有切换门禁后，或当前本机进行受控代码部署时，才可启动并检查：

```powershell
& $runtimeTool Start
& $runtimeTool Status
```

启动顺序固定为 PostgreSQL、迁移与授权校验、销售写入所有权校验、ERP 一次追平、ERP watch 新鲜心跳、reader、writer。ERP 未 caught up、没有启动后的新心跳、角色越权、schema/revision/checkpoint 异常或存在未登记进程时，启动与健康检查必须失败关闭。

## 回滚与恢复边界

`RollbackApp` 只回滚已验证的应用代码包，要求整套服务停止，并校验 current/previous manifest。它不会回滚 schema、PostgreSQL 数据、销售写入所有权或已退役的 D1 销售对象：

```powershell
& $runtimeTool Stop
& $runtimeTool RollbackApp
```

一旦 D1 销售写入所有权完成终态切换并退役，不支持把销售读写重新指向 D1。故障恢复只能使用兼容的代码版本、PostgreSQL 备份/WAL 和经审批的数据修复流程；ERP 主数据仍按 D1 权威 + ERP-only bridge 的独立链路恢复。

持续逻辑备份、备份复验、独立临时 PostgreSQL cluster 恢复演练和保留清理使用 `tools/django-postgres-maintenance.ps1`，详细门禁见[持续备份与隔离恢复手册](../docs/DJANGO_POSTGRES_OPERATIONS.md)。日常备份不会自动启停本机服务；恢复演练不得在生产 cluster 内创建、覆盖或删除数据库。

受控进程守护使用 `tools/django-runtime-supervisor.ps1`，其 desired-state、停止竞态 fencing、恢复预算、主动探针、告警 outbox、安装与回退门禁见[运行守护手册](../docs/DJANGO_RUNTIME_SUPERVISION.md)。它只对明确停止的本 runtime 进程调用既有 `Start`；数据分歧、readiness 失败、端口冲突和所有权异常都不会触发自动重启。

公开 Worker 的 `GET /api/sales/data-health` 只复用 reader 上已有的有界 `freshness` consumer，面向无数据 scope 的 `operator/admin` 返回动态 revision、业务日期、覆盖区间和最近成功批次。它不授予 reader 新表权限、不读取本机监控/备份目录，也不把机械 lag 天数静默解释为业务过期结论。

## 财务域正式单写实现

财务域使用独立 `finance_reader` 与 `finance_writer` 进程角色、独立数据库角色和独立回环端点；不能复用销售 reader/writer 的 URL 或数据库凭据。reader 只开放财报分析、导入历史、目标读取和有界消费者查询，writer 只开放规范化财报导入和目标增删改。writer readiness 必须核验财务 schema、revision、激活的 authority epoch/cutover ID、财务表写权限，以及对销售事实和 authority 表的越权拒绝；reader 连接必须为只读事务。

公开路径继续保持 `/api/imports/finance`、`/api/finance/analysis` 和 `/api/finance/targets`，Worker 只做鉴权、现有 Excel 解析、HMAC 和薄适配。内部 Django 路径为 `/api/finance/imports`、`/api/finance/analysis`、`/api/finance/targets` 和固定操作集合的 `/api/finance/consumers/query`。当前 `TERUISI_DJANGO_FINANCE_MODE` 必须保持 `django`；`legacy`/`shadow` 不再是生产回退路径，任何异常都失败关闭。

历史迁移和 D1 单写 authority 使用 `migrate_finance_from_d1`、`finance_write_authority` 与 operator-only `drizzle/0093_finance_write_authority.sql`。正式切换已跨过 PNR，完整证据和恢复边界见[财务后端迁移手册](../docs/DJANGO_FINANCE_MIGRATION.md)。

## 网店域正式单写实现

网店 reader/writer 固定使用 `8021/8022` 和独立最小权限角色，PostgreSQL 是网店事实、批次、SKU/SPU、推广、上传、revision 和审计的唯一权威。旧 D1 网店路径不得作为读取、写入或回滚来源；市场只通过固定 Django consumer 获取有界投影。完整证据见[网店后端迁移手册](../docs/DJANGO_NETSHOP_MIGRATION.md)。

## 市场域候选实现

市场 app 位于 `backend/market/`，候选 reader/writer 固定为 `8031/8032`。现有 React 页面和同源公开 API 保留；Worker 负责真实 principal、解析、HMAC、体积/超时边界和需要 R2/模型的边缘执行，Django 负责市场事实、批次、幂等、任务、revision、authority 与查询。当前生产市场仍由 D1 承载，`market-service-enabled.json` 不得在正式 cutover 前创建。真实数据隔离演练、当前陈旧 processing 批次门禁、`0097/0098`、PNR 和恢复步骤见[市场后端迁移手册](../docs/DJANGO_MARKET_MIGRATION.md)。

## 当前本机终态记录

本机 cutover `sales-pg-20260829T204417Z-d9896e904d8092cb` 已完成 PostgreSQL 单写激活及 D1 `0092` 销售对象退役；`0092` SHA-256 为 `f981a62efd0515a7f64dd9f174151b8cfeb0c4b071d8236c481b5459761a3b8f`。正式切换快照为 `572,015` 条销售事实、`88` 个销售批次、`8,443` 条 ERP 参照和 revision `8:5`。这些是切换时水位，不是代码常量；当前查询仍须动态核验新鲜度。

正式备份 manifest SHA-256 为 `b665eb7109b66127dbcd1507fe569910f80ab6a86ac085fed70b086cd6392901`，成功恢复演练 run ID 为 `5f2d0669317c`，结果 SHA-256 为 `f3b8f1e2efa59f50394e9f3efa1dc53b4adaad6428e104c6f3d84a1466ffb935`。Django 应用部署 fingerprint 为 `774936c5efe8365a370dc6b29a6110a3e97d3868a1a04e1ec879ff16a84f30c7`，最终 Worker effective head 为 `20260830T020314Z-16b6c1b89ed012a9`。最终全量回归、公开 API 冒烟、并发性能和完整的 D1/PostgreSQL/R2、attestation、forward-recovery、retirement 证据见[迁移与切换手册](../docs/DJANGO_SALES_MIGRATION.md#133-最终运行发布与复核补录)。该记录只适用于当前 Windows 主机和销售域。
