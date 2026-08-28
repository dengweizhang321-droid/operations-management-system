# Django 销售分析渐进迁移操作手册

> 状态：第一批仅迁移销售分析读侧。D1 继续是销售事实与 ERP 参照的唯一写入源，Django/PostgreSQL 只是可重建的只读投影。本文不代表已经执行生产部署、生产数据迁移或生产路由切换；这些动作仍需单独审批。

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

生产 PostgreSQL 应拆分权限：迁移命令使用受控的投影写入账号；Django 在线服务使用只读账号。不要把迁移账号凭据交给在线服务。投影失败不能影响 D1 写入，也不能用 PostgreSQL 回写 D1。

每次同步都必须从源 D1 动态读取 `sales_overview_cache_state.sales_revision` 与 `erp_product_revision`，并让目标的 `sales`、`erp` 修订完全匹配。当前本机曾观测到 `8:5`，它只说明当时 `sales=8`、`erp=5`，仅可用于理解格式；不得写进配置、代码、告警阈值或迁移脚本。正式同步过程中源修订发生变化时，本轮必须失败关闭并重新执行。

网关会在调用 Django 前读取当前 D1 修订作为期望值。Django 成功响应必须同时返回完全一致的 `x-sales-data-revision` 与 `x-sales-source-revision`；网关完整读取并验证 JSON 后，还会再次读取 D1 修订。前后两次 D1 修订、目标修订或两条响应头任一不一致，都说明请求期间数据已变化：`django` 模式返回 `503`，`shadow` 标记 `mismatch`，不会把旧投影视为新数据。

## 3. 环境准备

在仓库根目录使用独立虚拟环境，避免改动系统 Python：

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

生产 PostgreSQL 示例只展示格式，严禁把真实凭据提交到仓库：

```powershell
$env:TERUISI_DJANGO_DATABASE_URL = "postgresql://<user>:<password>@<host>:5432/<database>?sslmode=require"
```

## 4. 建库、迁移与验证

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

本地启动仅用于开发验证：

```powershell
& $python backend\manage.py check
& $python backend\manage.py runserver 127.0.0.1:8001
```

生产不能使用 `runserver`。生产进程、TLS、健康检查、只读数据库账号和部署拓扑尚未在本批执行，须在正式上线方案中单独确认。

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

如执行完整构建，先按仓库约束确认本地 `3000` 端口没有被服务占用，再执行 `npm run build`。测试至少要证明：

- 三个 JSON 响应的状态码、字段、排序、分页、筛选和错误契约与 Worker 一致。
- restricted principal 不越过仓库/渠道/平台 scope；汇总端点继续拒绝受限 scope。
- “刷刷仓”、金额分、退款负值、销量口径、大毛利率、分类回退及 `platform + shop_name` 身份保持不变。
- HMAC 缺失、篡改、过期、正文摘要错误、角色或 scope 非法时失败关闭。
- `shadow` 只返回 legacy，能区分匹配、不匹配、超限和 Django 异常。
- `django` 在超时、重定向、非 JSON、超大响应、缺失/不一致修订时返回 503 且不回退。
- 迁移 dry-run 无业务写入；apply 必须显式绑定且单次消费审批；verify-only 能发现行数、摘要和修订漂移。

本机没有可用的 PostgreSQL 服务时，只能完成 SQLite 投影的契约与真实数据验证；正式发布前仍必须在获批的 PostgreSQL 环境重跑迁移、摘要、索引、查询计划、并发和回滚测试，不能以 SQLite 结果替代该发布门禁。

## 8. 正式切换检查清单

以下各项必须全部完成；任一项为“否”都保持 `legacy`：

- [ ] 生产 PostgreSQL、备份恢复、容量、索引、连接池和部署拓扑已专项审批。
- [ ] 投影迁移账号与 Django 在线只读账号已分离，最小权限已实测。
- [ ] 精确源 D1 已只读确认，dry-run、apply、verify-only 全部成功并留存脱敏审计。
- [ ] apply 使用同一源的单次 dry-run 审批，`canonicalFormatVersion=sales-projection-v2`，未绕过 `--apply --approved-run-id` 门禁。
- [ ] 源/目标三张业务表的行数与规范 SHA-256 摘要一致。
- [ ] 动态读取的 `sales_revision:erp_product_revision` 与目标、两条 Django 响应头完全一致；未使用临时 `8:5` 常量。
- [ ] 三个端点的全量契约与关键业务口径对比通过。
- [ ] 四种角色、受限/非受限 principal、越权和 HMAC 负向测试通过。
- [ ] `shadow` 观察窗口内无未解释的 `mismatch`、`comparison_skipped` 或 `upstream_error`。
- [ ] 延迟、并发、响应体大小、数据库连接数与错误率达到经审批的上线阈值。
- [ ] D1 销售导入仍是唯一写入路径，财务域仍在 Worker，现有自动化未改写。
- [ ] 监控、告警、切换负责人、回滚负责人和变更时间窗已确认。
- [ ] 已在非生产环境演练 `django -> legacy`，并用响应头与关键页面复核回滚成功。

## 9. 秒级回滚

本批只有读路由切换且 D1 从未停止写入，因此回滚不需要反向迁移数据：

1. 把 Worker 的 `TERUISI_SALES_BACKEND` 改回 `legacy` 并发布配置。
2. 立即请求三个端点，确认 `x-teruisi-sales-backend: legacy`，关键页面恢复且 D1 最新数据可见。
3. 保留 PostgreSQL 投影和 Django 日志用于脱敏排查；不要删除目标库，不要重跑生产导入，不要停止 D1 自动化。
4. 记录触发时间、异常类型、动态源/目标修订和回滚验证结果。

该机制本身只有一个配置开关、无反向数据动作，平台配置发布生效后可以在秒级完成路由回退；实际生效时间仍以部署平台回执和上述请求验证为准，不能只凭控制台显示“成功”宣告回滚完成。

## 10. 当前生产状态

截至本手册编写时，生产 PostgreSQL 目标、生产 Django 运行环境、持续投影同步计划和生产路由尚未执行。当前投影同步仍是受控全量快照；D1 新导入推进修订后，在下一次审批迁移完成前 Django 读取会失败关闭，因此尚不具备生产 `django` 常态流量条件。现有 D1、Worker 写入与财务域均继续运行原契约。后续生产动作必须明确目标、影响范围、动态数据水位、增量或 staging 原子发布方案、真实 PostgreSQL 性能/并发、回滚方案和审批结果，不能把本地测试或 `shadow` 验证表述为生产已完成迁移。

2026-08-28 的本机 SQLite 真实规模验证包含 572,015 条销售事实：27 天冷查询的 dashboard、完整 summary、category 分别约为 2.03 秒、4.95 秒、1.83 秒，revision-keyed dashboard 缓存命中约 0.002 秒；366 天上限冷查询分别约为 25.67 秒、61.73 秒、23.09 秒，超过当前 8 秒默认网关超时，完整 summary 也超过 30 秒配置上限。这只是本机 SQLite 诊断而不是 PostgreSQL 基准，但已经构成明确的生产阻断项：在真实 PostgreSQL 上完成查询计划优化、性能阈值和冷启动/并发测试前必须保持 `legacy`，不得仅靠调高超时切换生产。
