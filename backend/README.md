# Django 销售域后端

本目录承载销售域的 Django 后端。当前本机架构已经采用：销售事实、导入批次、导入幂等与尝试审计、上传/暂存元数据、查询和分析全部由 Django + PostgreSQL 单写并作为唯一权威来源。

2026-08-29/30，本机销售域迁移、单写切换与 D1 `0092` 退役已经完成；现场证据、动态水位和本机限制见 [迁移与切换手册](../docs/DJANGO_SALES_MIGRATION.md)。本文后续命令仍作为新环境重建、受控升级和恢复骨架，不能据此重复执行已经完成的不可逆切换。

## 组件边界

| 组件 | 责任 | 明确不负责 |
| --- | --- | --- |
| Cloudflare Worker | 公开鉴权、真实 principal 校验、HMAC principal 信封、Excel 解析、R2 短期分片、请求超时与体积边界和边缘协议适配 | 不保存销售事实、批次或幂等状态；不读写 D1 销售表；不把销售请求回退到 D1 |
| Django reader | 销售查询、分析和消费者查询，只读访问 PostgreSQL | 不执行导入写入 |
| Django writer | 导入、分片签收、暂存、校验和销售域写入 | 不对公网直接暴露 |
| PostgreSQL | 销售域唯一事实源和读写数据库；保存完整历史审计 | 不成为 ERP 主数据的上游权威 |
| ERP bridge | 独立消费 ERP-only outbox，将 D1 中的 ERP 主数据同步到 PostgreSQL；按 ERP 映射回填现有 `sales_order_lines.resolved_category` 派生分类 | 不消费或生成销售事件，不回写 D1；不新增/删除销售事实，不修改金额、成本、销量、`gross_profit`、其他销售字段或批次 |
| D1 | 继续作为 ERP 主数据权威来源及 ERP-only outbox 来源 | 不再承载销售事实、销售批次、销售导入审计或销售读路径 |

R2 分片只是有生命周期约束的传输材料，不是销售数据权威来源。销售写入成功必须以 PostgreSQL 中的原子发布、幂等审计和落库回查为准。

## 本机生产拓扑

所有服务只监听回环地址：

| 地址 | 进程 | PostgreSQL 运行角色 |
| --- | --- | --- |
| `127.0.0.1:5432` | PostgreSQL 17 | — |
| `127.0.0.1:8001` | Django reader | `teruisi_sales_reader` |
| `127.0.0.1:8002` | Django writer | `teruisi_sales_writer` |
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
python manage.py test
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

## 当前本机终态记录

本机 cutover `sales-pg-20260829T204417Z-d9896e904d8092cb` 已完成 PostgreSQL 单写激活及 D1 `0092` 销售对象退役；`0092` SHA-256 为 `f981a62efd0515a7f64dd9f174151b8cfeb0c4b071d8236c481b5459761a3b8f`。正式切换快照为 `572,015` 条销售事实、`88` 个销售批次、`8,443` 条 ERP 参照和 revision `8:5`。这些是切换时水位，不是代码常量；当前查询仍须动态核验新鲜度。

正式备份 manifest SHA-256 为 `b665eb7109b66127dbcd1507fe569910f80ab6a86ac085fed70b086cd6392901`，成功恢复演练 run ID 为 `5f2d0669317c`，结果 SHA-256 为 `f3b8f1e2efa59f50394e9f3efa1dc53b4adaad6428e104c6f3d84a1466ffb935`。Django 应用部署 fingerprint 为 `774936c5efe8365a370dc6b29a6110a3e97d3868a1a04e1ec879ff16a84f30c7`，最终 Worker effective head 为 `20260830T020314Z-16b6c1b89ed012a9`。最终全量回归、公开 API 冒烟、并发性能和完整的 D1/PostgreSQL/R2、attestation、forward-recovery、retirement 证据见[迁移与切换手册](../docs/DJANGO_SALES_MIGRATION.md#133-最终运行发布与复核补录)。该记录只适用于当前 Windows 主机和销售域。
