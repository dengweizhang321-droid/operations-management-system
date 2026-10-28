# 业务级发布后冒烟：独立端点（2026-10-28）

- 分支：`codex/post-release-business-smoke-20261028`，已变基到 `main` = `72d07ad7`
- 来源：2026-10-24 系统审查「阶段 1 安全网」第 7 项（冒烟 + 一键回滚）的冒烟部分
- 状态：**改动完成、必需代码检查通过；未合并、未推送、未准备制品、未发布**（AGENTS.md 规则 4）
- 范围：**只补业务级探测**，不做「失败自动切回」（那要改被字节钉死的三个发布工具文件）

## 一、为什么要做

发布末尾两步检查都不是业务请求：

| 检查 | 实际做的事 |
| --- | --- |
| `VerifyStartup`（`tools/worker-local-service.ps1:2125-2131`） | 只核对 Windows 启动快捷方式的 `TargetPath`/`Arguments`/`WorkingDirectory` |
| `ready()`（经 `publish-prepared-main.mjs:127-139`） | 探 11 个域的 reader/writer 连接与角色就绪，**不发真实业务查询** |

两者都能在「表结构、索引、权限、authority 元数据全对，但一个 ORM join 坏了、聚合注解回归了」的情况下通过。本次补的探测会真实执行销售汇总端点那条聚合查询与库存快照聚合。

## 二、改动内容

| 文件 | 改动 |
| --- | --- |
| `backend/teruisi_backend/health.py` | +143：两个探测函数 + 新端点 view；**从 `ready()` 的 4 处移除探测调用** |
| `backend/teruisi_backend/urls.py` | +1：注册 `health/business-smoke` |
| `backend/sales/tests/test_health.py` | +319/−81：新增 `BusinessSmokeEndpointTests`，并把三个 fixture 方法提到模块级供复用 |
| `backend/sales/tests/test_business_smoke.py` | 新增 69 行，5 测试 |
| `backend/inventory/tests/test_business_smoke.py` | 新增 57 行，3 测试 |

## 三、关键设计决定：探测不放在 `ready()` 里

最初实现把两个探测挂进 `ready()` 的 4 处分支。**审核时实测发现这会导致启动失败**，故改为独立端点。

实测数据：

```
ready() 当前耗时            0.69 / 0.75 / 0.79 / 0.88 / 0.94 秒
启动轮询 HTTP 超时          2 秒      ← tools/django-local-service.ps1:3953 的 -TimeoutSec 2
同形状聚合查询冷查          1.67 秒（单日窗口）/ 5.98 秒（两日窗口）
                           0.07-0.09 秒（热缓存重复请求）
reader statement_timeout    7 秒      ← django-local-service.ps1:124
```

`ready()` 已占用 2 秒预算的 35–47%，再加一个冷查 1.7–6 秒的聚合必然撞穿。撞穿后的行为不是「探测失败」这么干净：`Wait-DjangoReady`（`django-local-service.ps1:3944-3968`）把超时按连接失败处理，在 30 秒 deadline 内反复重试，**每次重试都再跑一遍这个重查询**，最终抛「Django reader 未在 N 秒内就绪」——启动失败，且报错信息看不出与数据库慢有关。

加重因素有二：

1. 同一个 `ready()` 还被发布流程以 **15 秒** 超时调用（`publish-prepared-main.mjs:128`），一个端点挂在两套差 7.5 倍的时间预算上；
2. 探测原本挂在 reader/writer 共 4 处分支，**每次启动、每个进程都会跑**，而启动恰是缓存最冷的时刻——是最坏情况而非边缘情况。

**启动探活要快（2 秒预算、反复轮询），发布后冒烟可以慢（已停站、15 秒预算、只跑一次）——本就是两件事。** 且本任务目标写的是「发布**后**冒烟」，挂进 `ready()` 反而变成「每次启动都跑」。

## 四、新端点契约

```
GET /health/business-smoke        （仅 GET，其他方法 405）

200  {"status": "ok", "service": "teruisi-django"}
503  {"status": "not_ready", "service": "teruisi-django",
      "code": <ReadinessError.code | "business_smoke_probe_error">}

Cache-Control: no-store
```

与 `/health/live`、`/health/ready` 共享同一套 `LoopbackOnlyMiddleware` 及请求头/体大小限制中间件（继承自中间件链，非逐视图添加）。数据库/驱动细节只进日志，不进 HTTP 响应，与 `ready()` 的纪律一致。

### 角色分派

端点按 `settings.DJANGO_PROCESS_ROLE` 分派，**精确镜像** `ready()` 里两个探测原本被调用的分支：

- `inventory_writer` / `inventory_reader` → 库存探测
- 不属于 `_NON_SALES_DOMAIN_PROCESS_ROLES`（20 个已命名专域角色）且非 inventory 角色 → 销售探测

用「集合排除」而非「等于某值」，是因为 `DJANGO_PROCESS_ROLE` 默认值是 `"development"`（`settings.py:192`）而非 `"reader"`，而 `ready()` 里销售探测真正的触发条件是「不是任何已命名角色的隐式 else 分支」。审核时按 `settings.py:268` 的生产角色全集逐一核对：`migration_writer`、`production`、`reader`、`sales_writer` 四个在两边都落入销售分支，20 个专域角色两边都不跑销售探测——**语义完全对齐**。

## 五、探测的只读性与正确性

两个探测函数经核实：

| 核查项 | 结果 |
| --- | --- |
| `sales_queryset` / `metric_aggregates` 签名 | 吻合（`backend/sales/query.py:176-187, 242`） |
| 8 个聚合键 | 与 `query.py:253-260` 逐个对上 |
| `principal=None` → `"unrestricted"` | 确认（`query.py:118`） |
| 与真实 `/summary` 的查询形状 | 同一 helper、同样日期区间风格（`summary.py:157-165`） |
| `InventoryImportBatch` / `InventoryStockLine` 字段 | `dataset`/`status`/`snapshot_date`/`completed_at`/`available_quantity` 全存在，且 `Meta.indexes` 有一条正好覆盖该查询 |
| 写操作 | **无**。只有 `.aggregate()` / `.values_list()` / `.first()` |
| 数据依赖断言 | **无**。不断言固定总额（真实销售数据每天变），只断言查询可执行且返回预期形状的非空整数 |
| 空库行为 | 销售探测在空表上通过；库存探测在无 completed 批次时退化为 no-op，不阻断全新部署 |

`SalesOrderLine` 有一条 `business_date` + `is_business_row=True` 的部分索引（`models.py:145-150`），与探测的过滤条件匹配。

## 六、测试

| 范围 | 结果 |
| --- | --- |
| 两个探测函数单测（8 个） | **8 通过** |
| 新端点测试（含 200/503+code/405、四种角色分派） | included |
| `sales.tests.test_health` 全量（原 16 + 新 10） | **26 通过** |
| 合计 | **34 通过 0 失败**，6.554s |
| `manage.py check` | no issues |
| `manage.py makemigrations --check --dry-run` | No changes detected |

**三条回归断言**：mock 两个探测函数后，分别以 sales 默认角色、`sales_writer`、`inventory_reader` 请求 `/health/ready`，断言探测未被调用。**防止以后有人又把它挂回 `ready()`。**

`test_health.py` 的重构经核实是纯重构：**原有 16 个测试方法名一个未少**（`comm -23` 比对为空），新增 10 个。

### 回归基线对照

全量 `manage.py test sales inventory finance`：

```
clean main 72d07ad7     586 tests   14 failures  30 errors  36 skipped
本分支（已变基）          604 tests   14 failures  30 errors  36 skipped
```

**三个失败数字完全一致，零回归。** 那 44 个既有失败与本改动无关（分布：sales 24、finance 15、inventory 5），典型如 `finance/tests/test_netshop_reserved_edge.py:87` 期望 403 实得 503 `source_not_ready`，是测试环境缺授权 PG 源所致。

## 七、硬约束遵守情况

**未触碰**被 `tools/preparation-producer-qualification.mjs` 三代闭包按 sha256 钉死的三个文件：`tools/worker-local-release-rotation.mjs`、`tools/publish-prepared-main.mjs`、`tools/worker-local-release.mjs`。**不需要追加第四代闭包。**

**未改 worker 侧**：`worker/index.ts:150-161` 的 `/_teruisi/local/health/ready` 走 `probeDjangoBackendReadiness`（`lib/django/backend-readiness.ts`），那是 worker 聚合 12 个域 reader/writer 探活，与本端点属不同层次，本次保持不变。

## 八、未决项

**发布流程要不要调这个新端点？** 本次没有改 `publish-prepared-main.mjs`（它被字节钉死），也没让发布链感知新端点。因此当前状态是：**端点已就绪，但没有任何自动调用方**，需要人工或后续独立任务接入。这是一个独立决定，留待用户定：

- 若要接入发布链，必须改 `publish-prepared-main.mjs` → **必须追加第四代闭包**并同步 `tests/preparation-resolution.test.mjs` 与 `tests/release-optimization-boundaries.test.mjs:141` 的包装点数断言；
- 也可由 `tools/worker-local-service.ps1` 或外部运维脚本在发布后调用，不触碰钉死文件。

## 变更记录

2026-10-28：建立。业务探测从 `ready()` 移至独立端点 `/health/business-smoke`，记录位置决定的实测依据与回归基线对照。
