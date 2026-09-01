# 市场分析 Django/PostgreSQL 迁移手册

## 1. 当前结论与生产边界

2026-09-01，市场分析已完成 Django/PostgreSQL 候选实现、全部公开市场路由的薄 Worker 改造、真实本机 D1 数据的隔离迁移演练、最小权限 reader/writer 系统测试和 D1 终态退役演练。现有 React/Next.js 市场页面保留，不改写为 Django template；浏览器不直接连接 PostgreSQL。

本次没有部署、停止、启动或修改生产服务，也没有修改生产 PostgreSQL、生产 D1、R2、Worker、n8n 或开机启动状态。**当前生产市场权威仍是 D1，不能把隔离演练写成正式生产切换。** 正式切换必须在新的受控维护窗口重新取得一致快照并完成本文全部门禁。

本次只读预检发现当前本机 D1 有 2 个分别始于 2026-08-12、2026-08-14 的历史 `processing` 市场导入批次，共有 8,000 条未发布 staging 行。它们没有活动 claim，但仍违反静默迁移契约。演练只在一次性副本中精确清理这两个批次，生产源未改动。正式切换前必须由操作者确认这些批次确属不可发布的陈旧状态，在维护窗口内受控处置，随后重新封存快照；迁移工具不会替操作者自动删除。

## 2. 目标拓扑

```text
浏览器
  -> 现有 React/Next.js 市场分析页面
  -> 同源公开 Worker /api/market/*
     - 真实 principal、角色和 unrestricted scope
     - 参数/文件解析、规范化、体积与超时边界
     - HMAC principal 信封和稳定错误响应
     -> market_reader 127.0.0.1:8031
        - overview、trend、master、annotation、image metadata、consumer
     -> market_writer 127.0.0.1:8032
        - 导入、主数据、价格、标注、图片任务、投影同步

PostgreSQL market_*
  - 市场事实、批次、revision、幂等/尝试审计、scope owner、任务和 authority
  <- netshop Django consumer 的有界投影，不读取网店旧 D1 事实

R2
  - 继续保存市场图片对象字节；PostgreSQL 只保存身份、哈希和缓存元数据

AI 配置域
  - 模型配置继续按自身现行权威读取，不成为市场事实的回退源
```

公开市场路由不得读取 D1 市场事实、批次、价格、标注、缓存或主数据。超时、HMAC、JSON、revision、reader/writer、authority 或权限异常全部失败关闭，不得回查旧 D1。旧 TypeScript/D1 市场领域文件只允许作为正式切换前的 D1 当前实现、迁移源、测试夹具和退役审计材料存在；正式退役后不得进入可达生产路径。

## 3. 已实现的 Django 契约

- `backend/market/` 独立拥有市场 app、模型、迁移、查询、导入、主数据、标注、图片、网店投影、revision、请求回放、迁移运行和单写 authority。
- reader 只接受固定版本的 `queries` 和 `consumers/query` 操作；writer 只接受 `commands` 和 `imports`。未知字段、未知操作、错误角色、受限 scope、非法日期/维度/金额、超限分页和超限请求体在数据库操作前拒绝。
- Worker 保留真实 `requireAppPrincipal()`、文件/图片/AI 边缘能力和版本化载荷；Django 再次验证 HMAC principal、时间窗、nonce、请求摘要、角色、scope 和操作 allowlist。
- 成功读取返回动态市场 revision；公开边缘响应使用 `X-Market-Data-Revision`。写请求以请求 ID、principal、载荷摘要和结果 receipt 防止同 ID 改载荷与迟到重放。
- 导入重复判定绑定“市场域 + 精确业务范围 + 解析清洗后的完整规范化内容”。文件名、工作簿元数据、对象键序和行序不决定重复；业务字段、行数或范围变化必须创建新批次。
- scope head、唯一 attempt owner、内容指纹、事实完整替换、派生数据刷新、revision 和完成回查在同一 PostgreSQL 事务中发布。过期 owner、迟到提交、冲突范围、零行和部分发布失败关闭。
- reader 数据库角色固定只读；writer 只能对明确的 `market_*` allowlist 做所需 DML，不能 DDL、不能修改 authority、不能写销售、财务、ERP、网店或其他域。authority 只允许 migration writer 修改。
- 网店投影同步使用完整分页、单一 owner、租约 fencing、行数回查和原子 active revision 切换；它只消费 Django 网店 consumer，不把市场库变成网店第二事实源。
- 图片抓取和视觉模型仍由受控边缘执行器完成；领取、租约、完成、失败、退避和正式标注结果全部由 PostgreSQL 市场 writer 持有。单个标注任务上限保持 10,000 条。

## 4. 业务口径门禁

- 所有汇总只能表述为“当前 TOP 榜单覆盖市场”，不能外推为完整行业大盘。
- 类目、榜单 scope、SKU/SPU 维度、SKU、经营模式、价格带与统计周期保持完整身份隔离；趋势必须携带 `category + scope + rankingDimension + skuCode`。
- 正式市场定位价只接受人工确认、正数、绑定当前 64 位图片内容哈希且类型为“标准售价”“到手价”或“券后价”的记录。
- “起售价”“价格区间”“最低规格价格”“定金”“分期金额”和“无法判断”不能升级为正式价。没有正式价的价格带固定归入“未确认价格”。
- 商品榜单有正式主图价时，展示成交均价使用同一正式主图价；没有正式价时才展示底层成交均价，两者来源仍独立保存。
- 行业机会矩阵只有在单一类目、单一 scope、单一维度、至少 12 个连续可比完整月、存在可比前期、相关商品正式图片栅栏价格完整且细分类目完整时，才允许输出“建议进入”或“谨慎回避”。任一条件缺失只能输出“持续观察”并披露缺口。
- 采购成本、推广、安装售后、退货、滤芯复购、评价/问大家、搜索词和合规准入仍是外部缺口，不能由 TOP 榜单静默推断。

## 5. 服务、凭据与最小权限

正式候选端口固定为：

| 服务 | 端口 | 数据库角色 | 边界 |
| --- | ---: | --- | --- |
| market_reader | `8031` | `teruisi_market_reader` | 只读事务、1 MiB 请求上限、固定查询和 consumer |
| market_writer | `8032` | `teruisi_market_writer` | 128 MiB 请求上限、市场表 allowlist DML、authority epoch 栅栏 |

受保护 runtime 入口为：

```powershell
$market = "D:\teruisi-runtime\django-sales\app\tools\django-market-service.ps1"

& $market -Action ConfigureCredentials
& $market -Action ProvisionRoles
& $market -Action Status -Json
```

凭据只允许存入当前 Windows 用户绑定的 DPAPI 文件 `secrets\market-credentials.dpapi.json`，不得进入仓库、日志、环境持久化、命令参数或本文。`ProvisionRoles` 必须在 `8031/8032` 无监听时执行并回查 reader 只读、writer allowlist、跨域拒绝、DDL 拒绝及序列权限。

`EnableStartup` 只能在 PostgreSQL authority 已激活、epoch/cutover ID 可回读且 reader/writer 均 ready 后执行。基础 Django 启动器只有看到 authority 绑定的 `market-service-enabled.json` 才能启动市场服务。正式切换前不得创建该文件。

## 6. 历史数据迁移

`drizzle/0097_market_write_authority.sql` 是 D1 市场写权准备迁移；`drizzle/0098_market_domain_retirement.sql` 是终态破坏性退役迁移。二者都是 operator-only，不进入普通 Drizzle journal，不得由 `db:generate`、日常启动或普通迁移自动应用。

迁移源必须是维护窗口中从当前权威 D1 生成的一致、封存、无相邻 `-wal/-shm` 的普通 SQLite 文件。源和 PostgreSQL 都必须静默；任何 processing batch、staging、claim、lease、执行中下载/标注、非 ready scope head 或投影同步都会拒绝。

以下命令展示受控顺序；正式值必须来自当轮输出，不能复制演练 ID：

```powershell
cd D:\teruisi-runtime\django-sales\app\backend

# 1. 对 owner=d1 的同一业务快照只读生成计划
python manage.py migrate_market_from_d1 --source <封存快照.sqlite>

# 2. 在所有市场写入口已冻结后，把权威源置为 pending
python manage.py market_write_authority --source <权威D1.sqlite> `
  --prepare --approved-run-id <market-run-id> --cutover-id <cutover-id>

# 3. 从 pending 权威源重新生成无 WAL/SHM 的封存副本，再原子迁移到空白 PostgreSQL 市场域
python manage.py migrate_market_from_d1 --source <pending封存快照.sqlite> `
  --apply --approved-run-id <market-run-id>

# 4. 独立逐节复算源/目标行数和规范化摘要
python manage.py migrate_market_from_d1 --source <pending封存快照.sqlite> `
  --verify-only --approved-run-id <market-run-id>
```

plan/apply/verify 覆盖 34 个持久化数据节和 1 个投影 control 节，计算排序无关的逐行规范化摘要及总摘要。PostgreSQL 目标必须保持 `d1` authority 且所有市场业务表为空；apply 在一个事务内写入、重置序列、回查每节摘要并记录 migration run，任一差异整体回滚。

历史 D1 中 `market_master_audit_logs.before_json` 的 JSON `null` 只允许按明确兼容规则规范化为空对象，并在 manifest 记录数量；数组、字符串或其他非法对象仍拒绝。本次镜像共记录 4,400 条该兼容规范化。

## 7. 正式切换、PNR 与 D1 退役

正式切换必须同时覆盖 React 页面、全部公开 `/api/market/*` 路由、AI/全局搜索 consumer、后台图片和标注 runner、网店投影、reader/writer、PostgreSQL、Worker release、启动链、监控、备份与 D1 退役。不得只迁数据库或长期双写。

推荐门禁顺序：

1. 停止市场导入、下载、标注、图片缓存、投影同步和公开市场写请求；不停止或重启销售、财务、网店、ERP、n8n 或其他模块。
2. 核验 D1 无 processing/staging/claim/lease，安装并回读 `0097`，生成一致快照、SHA-256、行数和 run ID。
3. 完成受控 PostgreSQL 预备份，迁移空白市场域，逐节 verify，并用最小权限 reader 做只读对比。
4. 将 D1 置为 `pending` 后，唯一允许的回退是使用同一 run/cutover 执行 `--abort-pending`；回退前 PostgreSQL authority 必须仍是 `d1` 且两端继续静默。
5. 构建并验签包含薄市场路由的不可变 Worker successor，完成 reader、writer 负向测试和全链路切换计划。
6. 执行 `market_write_authority --activate`。PostgreSQL 获得 `postgres` authority epoch 后即跨过 PNR；不得回到 D1、`legacy` 或 `shadow`。
7. 以激活后的 reader/writer 和公开 Worker 运行系统测试，生成不超过 30 分钟的严格 UTF-8 JSON smoke receipt。receipt 必须证明 reader、writer 负向、overview、trend、annotations、master、image、scheduled maintenance 和 legacy D1 rejection 全部通过，并绑定 Worker build SHA、cutover ID、run ID 和源/目标摘要。
8. 先只读生成 D1 retirement plan，再以精确 plan ID 执行：

```powershell
python manage.py retire_market_d1 --source <权威D1.sqlite> `
  --cutover-id <cutover-id> --approved-run-id <market-run-id> `
  --smoke-receipt <system-test-receipt.json>

python manage.py retire_market_d1 --source <权威D1.sqlite> `
  --cutover-id <cutover-id> --approved-run-id <market-run-id> `
  --smoke-receipt <system-test-receipt.json> `
  --apply --approved-plan-id <plan-id> --audit-output <retirement-audit.json>
```

`0098` 完成后，49 个 D1 市场对象必须成为带固定退役标识的空 tombstone view；共享导入表只删除市场域行，并安装 9 个 insert/update/delete 永久 guard，其他域行和摘要必须保持不变。retirement receipt、plan、smoke、迁移摘要和审计不得清理。

跨过 PNR 后，恢复只允许 PostgreSQL 备份/WAL/PITR、兼容代码或审批过的前向数据修复；不得把流量、读取或写入重新指向 D1。

## 8. 2026-09-01 隔离真实数据演练证据

由于 `teruisi_operations` MCP 在本任务环境不可用，本次按用户指定的本机系统范围，使用生产 D1 的一致只读副本作为替代源。源快照时间为 2026-09-01 16:34（Asia/Shanghai），市场榜单覆盖 2026-01-01 至 2026-08-24；没有按渠道、平台、店铺或 SKU 过滤，金额保持人民币分，销量保持榜单源定义。

| 项目 | 结果 |
| --- | --- |
| 原始封存快照 | 9,586,368,512 bytes；SHA-256 `2ba096ea9e84764615c9e6e2fae0796d67f92561d306a651a749608e4eff0c89` |
| 迁移 run | `market-4302d65ae56c1c17acb7e8c8` |
| 源/目标总摘要 | `4302d65ae56c1c17acb7e8c8d770c777b53aefdf650f3a5bc05a36534fc1c147`，完全一致 |
| 主要数据量 | 榜单 290,302；批次 190；主身份 44,402；价格快照 90,935；SKU 标注 39,488；图片缓存 41,535；网店投影 115,341 |
| 隔离服务 | PostgreSQL `55483`；reader `58331`；writer `58332`；销售 consumer stub `58401` |
| 权限与安全 | reader/writer 最小权限、HMAC、非法 HMAC、写入失败原子回滚、reader/writer 表面隔离全部通过 |
| 业务系统测试 | overview、trend、annotations、master、image、销售 consumer 隔离和 TOP 口径门禁全部通过 |
| 机会矩阵 | 3 个单元，0 个 decision-ready；因正式价格/连续月份等缺口，全部保持“持续观察” |
| 性能 | 候选计数 1,516 ms；完整 overview 5,561 ms；trend 228 ms；settings 101 ms；image metadata 65 ms |
| 仓库验证 | Vinext build；Node 1,703 通过/4 跳过；渲染 19/19；Django 四域 186/186；ESLint 0 error（9 个既有 warning） |
| 生产影响 | `false`；生产服务、数据库和启动状态均未改变 |

候选计数从逐行 N+1 改为 2 条集合查询后，真实镜像耗时由约 100,129 ms 降到 1,516 ms，下降约 98.5%，并保留精确图片身份。系统测试结束后再次复算全量源/目标摘要，仍完全一致。

机器可读的脱敏证据见 [`docs/evidence/market-django-rehearsal-20260901.json`](evidence/market-django-rehearsal-20260901.json)。该文件是隔离演练证据，不是生产 cutover receipt。

## 9. 测试与运维门禁

合并前至少执行：

```powershell
cd D:\运营管理系统-codex-market-django

& backend\.venv\Scripts\python.exe backend\manage.py test market
& backend\.venv\Scripts\python.exe backend\manage.py check
& backend\.venv\Scripts\python.exe backend\manage.py makemigrations --check --dry-run
npm test
npm run lint
```

还必须验证 PowerShell 脚本可解析、`0097/0098` 不在普通 Drizzle journal、所有市场公开路由不导入旧 D1 市场服务、Worker 定时任务只调用 Django-backed 市场 runner、备份/恢复证据覆盖全部 `market_*` 表、market revision、migration run 和 authority。

正式生产切换还需补齐：新的无陈旧 processing 状态快照、正式 cutover ID、正式 authority epoch、不可变 Worker build SHA、正式系统测试 receipt、D1 retirement plan/receipt、首次 PostgreSQL 全量备份及隔离恢复演练。任一证据缺失，不得宣称市场域迁移完成。
