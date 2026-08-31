# Django 销售分析渐进迁移操作手册

> 状态（2026-08-28 18:58，Asia/Shanghai）：销售分析第一批读侧已完成本机部署、真实数据迁移、持续同步、影子契约、并发性能及正式切换验收。当前用户读取模式已由 `legacy` 切换为 `django`；D1 仍是唯一写入源，Django/PostgreSQL 仍是可重建只读投影。

## 1. 本批边界

本批 Django 5.2 LTS 服务只承接以下三个现有 `GET` 契约，React/Next.js 前端与公开 Worker 路由保持不变：

| 公开 API | Django 内部 API | 权限边界 |
| --- | --- | --- |
| `/api/sales/summary` | `/api/sales/summary` | `viewer/analyst/operator/admin`；沿用现有规则，仅允许无数据 scope 的账号读取汇总 |
| `/api/sales/category-analysis` | `/api/sales/category-analysis` | 同上角色；在 Django 中继续应用仓库、渠道、平台 scope |
| `/api/sales/category-analysis/detail` | `/api/sales/category-analysis/detail` | 同上角色；在 Django 中继续应用仓库、渠道、平台 scope |

以下能力明确不在本批切换范围内：

- 销售导入、分块上传、校验、批次与 D1 写入；这些仍由 Worker/D1 单写。
- `/api/finance/analysis`、`/api/finance/targets` 及经营目标写入；财务域暂留 Worker。
- 前端框架、Cloudflare binding、R2、其他业务域和生产任务队列。

业务契约必须原样保持：`Asia/Shanghai`、金额单位为人民币分、日期左闭右开、排除仓库“刷刷仓”、店铺身份使用 `platform + shop_name`，大毛利率为 `(分摊后金额合计 - 货品成本合计) / 分摊后金额合计`。不得把 Django 投影升级为新的写入事实源，也不得新旧后端双写。

## 2. 数据所有权与同步原则

迁移方向固定为：

```text
现有导入/自动化 -> Worker -> D1（唯一写入所有者）
                                 |
                                 | 受控、可验证的快照投影
                                 v
                            PostgreSQL
                                 |
                                 v
                         Django 三个只读 API
```

本机 PostgreSQL 已拆分为最小权限角色：投影迁移与持续消费者使用 `teruisi_sales_writer`，在线 Waitress/Django 使用 `teruisi_sales_reader`，并在 readiness 中验证连接处于只读事务模式。writer 凭据不交给在线服务；两类凭据与 Django/HMAC 密钥均由当前 Windows 用户绑定的 DPAPI 凭据库保存，不能写入命令、日志、审计或仓库。投影失败不能影响 D1 写入，也不能用 PostgreSQL 回写 D1。

每次同步都必须从源 D1 动态读取 `sales_overview_cache_state.sales_revision` 与 `erp_product_revision`，并让目标的 `sales`、`erp` 修订完全匹配。本机 2026-08-28 完成基线迁移时的真实水位为 `8:5`；这是该次验收事实，不是永久常量，仍不得写进配置、代码、告警阈值或迁移脚本。同步过程中源修订发生变化时，本轮必须失败关闭并重新执行。

基线之后使用 D1 事务 outbox 与 PostgreSQL 持续消费者：销售或 ERP 导入在发布事实和推进 revision 的同一 D1 事务内写入 outbox；消费者按 sequence、source epoch、来源批次、规范摘要与 revision 严格校验，在 PostgreSQL 单事务中发布事实、revision 和 checkpoint。进程以 15 秒间隔持续检查；无新事件时只刷新 checkpoint 心跳。当前 D1 outbox 为 0 条、head sequence 为 0，PostgreSQL checkpoint sequence 为 0、revision 为 `8:5`，心跳与 readiness 正常。

网关会在调用 Django 前读取当前 D1 修订作为期望值。Django 成功响应必须同时返回完全一致的 `x-sales-data-revision` 与 `x-sales-source-revision`；网关完整读取并验证 JSON 后，还会再次读取 D1 修订。前后两次 D1 修订、目标修订或两条响应头任一不一致，都说明请求期间数据已变化：`django` 模式返回 `503`，`shadow` 标记 `mismatch`，不会把旧投影视为新数据。

## 3. 环境准备

开发和测试仍可在仓库根目录使用独立虚拟环境，避免改动系统 Python：

```powershell
Set-Location "D:\运营管理系统"
python -m venv .runtime\django-venv
.runtime\django-venv\Scripts\python -m pip install --upgrade pip
.runtime\django-venv\Scripts\python -m pip install -r backend\requirements.txt
```

后端使用以下环境变量：

| 变量 | 用途 |
| --- | --- |
| `TERUISI_DJANGO_DATABASE_URL` | PostgreSQL 连接串；未设置时使用本地 SQLite |
| `TERUISI_DJANGO_SQLITE_PATH` | 本地/测试 SQLite 路径；生产不要使用 |
| `TERUISI_DJANGO_INTERNAL_SECRET` | Worker 与 Django 共用的 HMAC 密钥，至少 32 字节 |
| `TERUISI_DJANGO_SIGNATURE_MAX_AGE_SECONDS` | 签名有效窗口，默认 60 秒，代码限制为 1–300 秒 |
| `TERUISI_DJANGO_SALES_CACHE_SECONDS` | 按动态修订隔离的进程内只读缓存，默认 60 秒；0 关闭，最大 3600 |
| `TERUISI_DJANGO_DB_CONN_MAX_AGE` | PostgreSQL 连接复用秒数，默认 60 |
| `DJANGO_SECRET_KEY` | Django 自身密钥；生产必须使用独立强密钥 |
| `DJANGO_DEBUG` | 仅本地调试可为 `true`；生产必须关闭 |
| `DJANGO_ALLOWED_HOSTS` | 逗号分隔的精确 Host 白名单 |

本地示例只对当前 PowerShell 会话生效：

```powershell
$env:TERUISI_DJANGO_SQLITE_PATH = "D:\运营管理系统\.runtime\django\teruisi.sqlite3"
$env:TERUISI_DJANGO_INTERNAL_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
$env:DJANGO_SECRET_KEY = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
$env:DJANGO_ALLOWED_HOSTS = "127.0.0.1,localhost"
$env:DJANGO_DEBUG = "true"
```

本机常驻部署不使用上述开发 SQLite。当前受控运行根目录为 `D:\teruisi-runtime\django-sales`，其中安装 PostgreSQL 17.11、Python 虚拟环境、Django 5.2.17、Waitress 3.0.2、只读投影、日志、PID 所有权记录与 DPAPI 密文凭据；源码副本位于 `app\`。PostgreSQL 只监听 `127.0.0.1:5432`，Waitress 只监听 `127.0.0.1:8001`，不向 LAN 或公网开放。

外部 PostgreSQL 示例只展示格式，严禁把真实凭据提交到仓库：

```powershell
$env:TERUISI_DJANGO_DATABASE_URL = "postgresql://<user>:<password>@<host>:5432/<database>?sslmode=require"
```

## 4. 基线迁移、持续同步与本机服务

先确认 D1 精确源文件；不要依赖模糊的“最新文件”，不要修改、复制覆盖或删除源库。迁移命令会以 SQLite 只读模式打开源库。

```powershell
Set-Location "D:\运营管理系统"
$python = ".runtime\django-venv\Scripts\python.exe"
$sourceD1 = "<经只读核验的 D1 sqlite 绝对路径>"

& $python backend\manage.py migrate --plan
& $python backend\manage.py migrate
```

按以下顺序执行投影：

1. 预演，只读扫描并校验源结构、行数、摘要与修订，不改变目标业务事实。

   ```powershell
   $dryRunJson = & $python backend\manage.py migrate_sales_from_d1 --source $sourceD1 --dry-run --batch-size 1000
   $dryRun = $dryRunJson | ConvertFrom-Json
   $dryRun
   ```

2. 应用。命令以有界批次读取源数据，在目标单个事务中按稳定业务键更新投影、移除本快照已不存在的旧投影，并在提交前复核行数、规范 SHA-256 摘要和修订水位。

   ```powershell
   & $python backend\manage.py migrate_sales_from_d1 --source $sourceD1 --apply --approved-run-id $dryRun.runId --batch-size 1000
   ```

3. 独立复验。此步骤不应改变目标事实。

   ```powershell
   & $python backend\manage.py migrate_sales_from_d1 --source $sourceD1 --verify-only --batch-size 1000
   ```

apply 必须显式携带一次尚未消费的成功 dry-run ID；命令会在目标事务内复核同一解析路径、稳定文件身份、`sales-projection-v2` 摘要格式、动态修订、三张表行数与完整摘要，并原子消费该审批。文件身份使用卷与文件 ID，避免同一活动 D1 中无关业务表写入仅改变 mtime 就误拦截；销售/ERP 任一事实变化仍会由完整摘要或修订门禁拒绝。省略模式、缺审批、复用审批或任一材料变化都不会写业务投影。任一步非零退出、零行、源表缺失、源在迁移中变化、行数/摘要/修订不一致，都视为失败；不得进入 `shadow` 或 `django`。不要用手工 `UPDATE` 修正水位，也不要在失败后把 PostgreSQL 当成完整投影。

2026-08-28 已按上述门禁把真实 D1 基线迁移至本机 PostgreSQL：`sales_order_lines=572015`、`sales_import_batches=88`、`erp_product_master=8443`，源/目标 revision 均为 `8:5`。基线之后不再把人工全量迁移当作日常同步；D1 事务 outbox 和 `sync_sales_projection --watch --interval-seconds=15` 持续消费者负责增量发布，启动器会在启动在线读服务前先执行一次 one-shot 追平。

### 4.1 本机服务命令

以下命令适用于当前已预置 PostgreSQL、虚拟环境与 DPAPI 凭据的 Windows 主机。`Configure`、`DeployApp`、`HardenAcl` 从源码工作树执行；`Start` 必须从部署后的 runtime 脚本执行：

```powershell
$repo = "D:\运营管理系统"
$runtime = "D:\teruisi-runtime\django-sales"
$sourceD1 = "<当前权威 D1 sqlite 绝对路径>"
$sourceTool = Join-Path $repo "tools\django-local-service.ps1"
$runtimeTool = Join-Path $runtime "app\tools\django-local-service.ps1"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File $sourceTool -Action Configure -RuntimeRoot $runtime -SourceD1 $sourceD1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $sourceTool -Action DeployApp -RuntimeRoot $runtime
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $sourceTool -Action HardenAcl -RuntimeRoot $runtime
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runtimeTool -Action Start -RuntimeRoot $runtime
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runtimeTool -Action Status -RuntimeRoot $runtime
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runtimeTool -Action InstallStartup -RuntimeRoot $runtime
```

`Start` 依次核验部署指纹和 ACL，启动仅回环的 PostgreSQL，使用 writer one-shot 追平投影，启动只读 reader 的 Waitress，再启动持续消费者并检查 `/health/ready`。`Status` 应同时检查 PostgreSQL、Django、ProjectionSync、Readiness、RuntimeAcl 和 Startup；readiness 只有在投影结构、索引、revision、checkpoint 与最近心跳均正常，且在线连接确认为只读 PostgreSQL 时才返回 200。

`InstallStartup` 安装的是“当前 Windows 用户登录”快捷方式，不是 Windows Service，也不是崩溃监控器：用户登录时会尝试启动整套服务，但进程在登录后崩溃不会被自动拉起。此时应先查看脱敏日志和 `Status`，再由操作者显式执行 `Start`；不得把快捷方式表述为高可用守护。

### 4.2 备份与审计证据

本轮 D1 outbox DDL 前的可恢复备份和审计位于：

- 数据库备份：`D:\teruisi-runtime\django-sales\backups\d1-before-outbox-20260828T1759.sqlite`
- 备份审计：`D:\teruisi-runtime\django-sales\backups\d1-before-outbox-20260828T1759.json`
- 审计摘要：`D:\teruisi-runtime\django-sales\backups\d1-before-outbox-20260828T1759.json.sha256`
- DDL 审计：`D:\teruisi-runtime\django-sales\migration-d1-outbox-0089.json`

运行日志、备份和审计目录必须保持对当前用户、SYSTEM 与 Administrators 可写，并由 `HardenAcl` 限制继承权限；任何文件都不得记录数据库密码、HMAC secret、Django secret、完整连接串或其他凭据。失败的临时副本不是权威迁移材料，也不能替代以上备份、摘要和审计链。

## 5. Worker 到 Django 的身份签名契约

Django 不直接接受浏览器提供的角色或 scope。公开 Worker 先调用现有鉴权得到真实 `AppPrincipal`，完成公开查询参数校验，再用 `TERUISI_DJANGO_INTERNAL_SECRET` 生成短时 HMAC-SHA256 信封。两端密钥必须相同、至少 32 字节，且不得写入日志、错误响应、审计摘要或版本库。

请求头为：

- `X-Teruisi-Principal`：无填充 base64url JSON，字段固定为 `email`、`displayName`、`role`、`scope`；`scope` 为 `null` 或仅含 `warehouses/channels/platforms`。
- `X-Teruisi-Timestamp`：Unix 秒。
- `X-Teruisi-Request-Id`：1–128 位字母、数字、点、下划线、冒号或连字符。
- `X-Teruisi-Content-SHA256`：本批 GET 空正文固定为 SHA-256 `e3b0c442…b855` 的完整 64 位小写十六进制值。
- `X-Teruisi-Signature`：`v1=<64 位小写十六进制 HMAC>`。

签名原文使用 UTF-8，并按以下顺序以单个换行符连接，不能重排、重新编码查询串或补结尾换行：

```text
v1
<timestamp>
<request-id>
<UPPERCASE METHOD>
<path>
<原始 query string，不含 ?>
<body sha256>
<principal base64url>
```

Django 逐项核验签名时间、请求正文摘要、方法、路径、原始查询串、principal 结构、角色和 scope；缺失、过期或签名错误均失败关闭。Django 服务只应暴露给受控 Worker 网络，不能把内部签名头透传给浏览器。

## 6. 网关变量与灰度模式

Worker 使用以下变量：

| 变量 | 默认/限制 | 说明 |
| --- | --- | --- |
| `TERUISI_SALES_BACKEND` | 缺省 `legacy` | 仅允许 `legacy`、`shadow`、`django` |
| `TERUISI_DJANGO_SALES_BASE_URL` | 无 | Django 根地址，例如 `http://127.0.0.1:8001`；HTTP 仅允许精确回环主机，远端必须 HTTPS，且不能含账号密码、查询、fragment 或子路径 |
| `TERUISI_DJANGO_INTERNAL_SECRET` | 至少 32 字节 | 与 Django 完全相同 |
| `TERUISI_DJANGO_SALES_TIMEOUT_MS` | 默认 8000，最大 30000 | 上游请求超时 |
| `TERUISI_DJANGO_SALES_MAX_RESPONSE_BYTES` | 默认 4194304，最大 8388608 | 上游响应及影子比较上限 |

三种模式的行为固定如下：

| 模式 | 用户收到的响应 | Django 异常/水位不一致 |
| --- | --- | --- |
| `legacy` | Worker/D1 | 不请求 Django；这是缺省和回滚模式 |
| `shadow` | 始终为 Worker/D1 | 只比较有界 JSON，不输出响应正文到日志；响应头 `x-teruisi-sales-shadow-result` 为 `match`、`mismatch`、`comparison_skipped` 或 `upstream_error` |
| `django` | Django | 返回 `503 service_unavailable`，绝不静默回退 D1 |

所有模式均返回 `cache-control: no-store`，并用 `x-teruisi-sales-backend` 标明实际响应来源。Django 内部只读结果可按“完整请求身份 + 动态 sales/ERP 修订”使用有界进程内缓存；修订变化后旧键立即失效，不改变浏览器端 `no-store`。无效模式或缺少 Django 地址/密钥会失败关闭，而不是猜测配置。

推荐顺序：

1. 保持 `legacy`，完成投影预演、应用和独立复验。
2. 切为 `shadow`，覆盖三个端点及无筛选、日期、平台、渠道、店铺复合键、商品、品类、排序、分页、受限与非受限 principal 的样本矩阵。
3. 只有动态修订完全一致、影子结果持续 `match`、性能和错误率达标且正式检查清单签字后，才切为 `django`。
4. 切换后继续观察 D1 导入与投影刷新；每次 D1 新写入都会推进源修订，在新投影完成前 Django 会因水位不一致失败关闭。

截至 2026-08-28 18:58（Asia/Shanghai），前三步及正式切换已完成，实际读取配置为 `django`；三个端点均已验证 `x-teruisi-sales-backend: django`，且响应 revision 与动态 D1 水位一致。当前进入切换后持续观察阶段。

当前网关是模式开关，不是百分比流量分配器。若需要小流量试运行，应使用独立预览环境或经批准的边缘流量策略，不能在代码中临时随机分流。

## 7. 测试命令

在仓库根目录执行：

```powershell
$python = ".runtime\django-venv\Scripts\python.exe"

& $python backend\manage.py makemigrations --check --dry-run
& $python backend\manage.py test sales
node --import tsx --test tests/django-sales-gateway.test.ts
npm run test:unit
npm run lint
```

真实 D1 与已启动 Django 服务的逐字段影子对比可用下列工具；它只读 D1，不打印签名密钥，任一 JSON 字段或数组顺序不一致都会非零退出：

```powershell
$env:TERUISI_DJANGO_SALES_BASE_URL = "http://127.0.0.1:8001"
$env:TERUISI_DJANGO_INTERNAL_SECRET = "<与本地 Django 相同的测试密钥>"
node --import tsx tools/django-sales-shadow-check.ts $sourceD1 2026-08-01 2026-08-27
```

只读并发/性能验收工具会生成合法 HMAC principal，只允许精确回环 HTTP 或 HTTPS origin，限制并发、轮数、请求超时和响应体大小，并校验 HTTP 200、两条 revision header、同视图 JSON 摘要与全程 revision 一致；密钥只能从环境变量读取且不会输出：

```powershell
$env:TERUISI_DJANGO_INTERNAL_SECRET = "<与本机 Django 相同的临时进程级密钥>"
node --import tsx tools/django-sales-load-check.ts `
  --base-url http://127.0.0.1:8001 `
  --start-date 2025-08-28 --end-date 2026-08-28 `
  --concurrency 8 --rounds 2 `
  --view full,dashboard,category
Remove-Item Env:TERUISI_DJANGO_INTERNAL_SECRET
```

如执行完整构建，先按仓库约束确认本地 `3000` 端口没有被服务占用，再执行 `npm run build`。测试至少要证明：

- 三个 JSON 响应的状态码、字段、排序、分页、筛选和错误契约与 Worker 一致。
- restricted principal 不越过仓库/渠道/平台 scope；汇总端点继续拒绝受限 scope。
- “刷刷仓”、金额分、退款负值、销量口径、大毛利率、分类回退及 `platform + shop_name` 身份保持不变。
- HMAC 缺失、篡改、过期、正文摘要错误、角色或 scope 非法时失败关闭。
- `shadow` 只返回 legacy，能区分匹配、不匹配、超限和 Django 异常。
- `django` 在超时、重定向、非 JSON、超大响应、缺失/不一致修订时返回 503 且不回退。
- 迁移 dry-run 无业务写入；apply 必须显式绑定且单次消费审批；verify-only 能发现行数、摘要和修订漂移。

2026-08-28 的本机 PostgreSQL 验收结果：27 天与 366 天范围的五项影子契约（full summary、dashboard、category、受限 scope category、category detail）全部为 `match`。366 天、并发 8、2 轮的验收中，full 首次冷请求约 7.9 秒、warm 约 29–86 毫秒；dashboard 冷请求约 4.1 秒、warm 约 13–39 毫秒；category 冷请求约 3.0 秒、warm 约 86–188 毫秒；包含冷启动的整体 p95 约 7.96 秒。该结果证明当前本机部署通过本轮门禁，但不是其他机器、远程网络或未来数据规模的永久 SLA。

正式切换后的公开 Worker 在线复核中，三个端点均返回 200、`x-teruisi-sales-backend: django`、`x-sales-data-revision: 8:5`、`x-sales-source-revision: 8:5` 和 `cache-control: no-store`。366 天 dashboard 冷请求约 5.00 秒，随后缓存命中约 0.43 秒，均在本机 12 秒网关超时上限内。

## 8. 正式切换检查清单

本机技术门禁与用户流量切换均已完成，当前读取模式为 `django`。以下清单记录正式切换证据：

- [x] 本机 PostgreSQL 17、Waitress、只回环监听、备份审计、查询索引和运行目录 ACL 已验证。
- [x] 投影 writer 与 Django 在线只读 reader 已分离，最小权限和 reader 只读事务已实测。
- [x] 精确源 D1 的 dry-run、apply、verify-only 已成功并留存脱敏审计。
- [x] apply 使用同一源的单次 dry-run 审批与 `sales-projection-v2` 门禁。
- [x] 源/目标为 572,015 条销售事实、88 个销售批次、8,443 条 ERP 主数据，完整摘要一致。
- [x] 动态源、目标、checkpoint 和响应头 revision 均为本次真实 `8:5`，未把它固化为常量。
- [x] 27 天与 366 天五项影子契约全部 `match`，关键业务口径、scope 与 HMAC 负向测试通过。
- [x] 366 天并发 8×2 的 cold/warm、响应体上限和 revision/JSON 一致性验收通过。
- [x] D1 仍是唯一写入路径；事务 outbox、持续消费者和 checkpoint 心跳正常，财务域仍在 Worker。
- [ ] 监控、告警、切换负责人、回滚负责人和变更时间窗已确认。
- [x] 用户已于 2026-08-28 18:58（Asia/Shanghai）明确确认把 `TERUISI_SALES_BACKEND` 从 `legacy` 切换为 `django`。
- [x] 切换后已用三个端点的 `x-teruisi-sales-backend: django`、revision 和关键页面完成在线复核。

## 9. 秒级回滚

本批只有读路由切换且 D1 从未停止写入，因此回滚不需要反向迁移数据：

1. 把 Worker 的 `TERUISI_SALES_BACKEND` 改回 `legacy` 并发布配置。
2. 立即请求三个端点，确认 `x-teruisi-sales-backend: legacy`，关键页面恢复且 D1 最新数据可见。
3. 保留 PostgreSQL 投影和 Django 日志用于脱敏排查；不要删除目标库，不要重跑生产导入，不要停止 D1 自动化。
4. 记录触发时间、异常类型、动态源/目标修订和回滚验证结果。

该机制本身只有一个配置开关、无反向数据动作，平台配置发布生效后可以在秒级完成路由回退；实际生效时间仍以部署平台回执和上述请求验证为准，不能只凭控制台显示“成功”宣告回滚完成。

若需要停用本机 Django 栈，必须先把 `TERUISI_SALES_BACKEND` 回滚为 `legacy` 并验证三个端点已返回 `x-teruisi-sales-backend: legacy`；确认用户读取恢复到 Worker/D1 后，才能执行受控 runtime `Stop`。停服不删除 PostgreSQL 数据、备份或审计证据：

```powershell
$runtime = "D:\teruisi-runtime\django-sales"
$runtimeTool = Join-Path $runtime "app\tools\django-local-service.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runtimeTool -Action Stop -RuntimeRoot $runtime
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runtimeTool -Action Status -RuntimeRoot $runtime
```

若不希望下次登录自动启动，再显式执行 `-Action RemoveStartup`。不要删除 `postgres-data`、备份、审计或日志来代替回滚。恢复服务时执行 `-Action Start`；启动器会先追平投影并通过 readiness，失败则回滚本轮新启动的进程。

## 10. 当前本机部署与读取状态

截至 2026-08-28，本机 `D:\teruisi-runtime\django-sales` 已运行 PostgreSQL 17.11、Django 5.2.17、Waitress 3.0.2 和持续投影消费者；5432 与 8001 均严格监听 `127.0.0.1`。真实 PostgreSQL 投影为 572,015 条销售事实、88 个销售批次、8,443 条 ERP 主数据，revision `8:5`。D1 outbox/head 与 PostgreSQL checkpoint sequence 当前均为 0，持续消费者仍按 15 秒刷新心跳，`/health/ready` 返回 database/projection ready。

该部署的“生产”含义仅指当前受控 Windows 主机上的常驻本机服务，不代表已部署远程服务器、云数据库或高可用集群。当前用户请求已由 `TERUISI_SALES_BACKEND=django` 路由至 Django 只读投影，公开 Worker 继续负责鉴权、principal 签名、参数契约和动态 revision 栅栏；D1、销售导入、财务域及其他 Worker 自动化仍按原契约运行。`legacy` 保留为显式秒级回滚模式，Django 异常时仍失败关闭，不静默回退。

当前用户登录快捷方式可在下次登录时启动整套服务，但不具备进程崩溃后的自动拉起能力。日常应以 `Status`、`/health/ready`、checkpoint 心跳和脱敏日志共同判断运行状态，不能仅凭快捷方式存在或端口监听宣告服务健康。
