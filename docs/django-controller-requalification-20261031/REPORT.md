# django-local-service.ps1 聚合状态快照缓存代际资格登记（候选，待用户审核）

本轮依据用户 2026-10-31 的明确授权，只补登记 `tools/django-local-service.ps1` 当前仓库字节的候选资格，并同步两处静态绊线测试。开发树 `.claude/worktrees/codex+django-controller-requalification`，分支 `codex/django-controller-requalification`，从最新 main `63d2d1eb` 建立。没有准备制品、没有采用、没有发布，也没有执行任何生命周期动作或访问生产。

## 缺口由来

两次提交改了控制器却没有同步资格化，候选清单因此不含仓库实际字节：

| 提交 | 控制器 SHA-256 | 登记状态 |
| --- | --- | --- |
| `d95852dd` | `98028cb4…580b` | 已登记（`sales154SchemaAdditionDjangoScriptSha256`） |
| `94312406` perf(status) 批量 CIM 枚举 | `4683e5cb…569f` | 未登记，且本轮**刻意不登记** |
| `3cf4927f` fix(status) `@()` 包住整个 if | `fbb62792…bddb` | 未登记，本轮登记对象 |

两次提交的文件清单里都只有控制器本身（及一个 `.ps1` 测试），`tools/manual-maintenance-continuation.mjs` 一行未动。后果是 `tests/maintenance-controller-qualification.test.mjs` 与 `tests/manual-maintenance-continuation.test.mjs` 同时失败关闭，main 近三次 CI 全红；按同一份清单取值的发布准入也会在 `maintenanceReadiness` 处拒绝。

## 改动面审阅

以已登记的 `98028cb4` 为基线，对当前 `fbb62792` 做函数级字节比对（`compare.py`，静态读取、不执行控制器）。原始输出见 [FUNCTION-LEVEL-DIFF.txt](FUNCTION-LEVEL-DIFF.txt)：

- 新增 2 个函数：`Initialize-ProcessSnapshotCache`、`Clear-ProcessSnapshotCache`
- 改动 2 个函数：`Get-ProcessSnapshot`、`Show-AggregateServiceStatus`
- 其余 158 个函数及函数定义以外的全部内容逐字节未变

比对输出把 `Remove-PreviousBootProcessRecordIfSafe` 也列为 changed，这是切分口径造成的：新增的 `$script:ProcessSnapshotCache` 顶层变量声明紧跟在该函数之后，被归入了它的切片。单独核验该函数自身的函数体，两代完全一致，见 [UNCHANGED-FUNCTION-BODY.txt](UNCHANGED-FUNCTION-BODY.txt)。因此真实改动面是「新增 2、改动 2」。

维护进出、维护锁、排空、STARTED/SUCCESS 回执、服务启停时序与进程树终止均未被触及。

### 为什么这些字节可以接受

改动动机是性能：聚合状态路径原先为每个 PID 单独查询 CIM，十个域的 reader/writer 合计约 20 次查询，实测约 8.7 秒，而一次性枚举全部进程约 0.7 秒。该开销曾把 watchdog 控制阶段顶出预算。

缓存的安全属性由以下几点保证，`Get-ProcessSnapshot` 的三种结果（可用快照、`$null` 真实缺失、元数据不可用抛出）保持不变：

- 默认关闭（`$script:ProcessSnapshotCache = $null`），未填充时逐 PID 实时查询，与原行为一致
- 仅在第一次尝试且已填充时查缓存；未命中或元数据为空即回落到同一条实时查询与重试循环，所以缓存永远不能单独确立「进程不存在」
- 枚举失败时置为空哈希表而非缺失状态，避免看起来像「不存在」
- 同一 PID 的重复行全部保留，歧义抛出仍会触发
- 唯一填充点是只读的 `Show-AggregateServiceStatus`，它不终止也不重挂它所观察的进程，并在 `finally` 中无条件清空，所以同进程内后续的生命周期动作看不到陈旧枚举
- 所有生命周期与进程树调用点都显式传 `Attempts = 1` 且从不填充缓存

### 为什么中间代际 `4683e5cb` 不登记

`94312406` 把 `@()` 放在 `$rows` if 表达式的各个分支内。PowerShell 在 if 表达式出口会拆包单元素数组，结果 `$rows` 退化为裸 `CimInstance`，其 `.Count` 为 `$null`，`-gt 1` 与 `-eq 1` 同时为假，每一次单行查询都报告「进程不存在」。`Assert-PostgresListenerOwnership` 据此判定「5432 端口的监听者不是本部署的 PostgreSQL 可执行文件」，`DeployApp` 在 PostgreSQL 健康的情况下拒绝发布。`3cf4927f` 把 `@()` 移到整个 if 表达式外层，在缓存与实时两条路径上都恢复了数组语义。

给一个已知会卡死发布的代际发通行证没有价值：它从未上线，登记它的唯一作用是让回退到该提交也能过闸，而没人应当回退到那一版。可回退的落点是清单里保留的 `98028cb4`。

## 精确变更

| 文件 | 改动 | 为什么 |
| --- | --- | --- |
| `tools/manual-maintenance-continuation.mjs` | 新增 `aggregateStatusSnapshotCacheDjangoScriptSha256`，追加到 Django 候选数组末尾；补审阅注释 | 登记当前仓库字节，不改准入函数、不移出任何控制器、不使用通配 |
| `tests/manual-maintenance-continuation.test.mjs` | 字节断言指向新常量；两处 `deepEqual` 数组期望追加第四项；新增本代际正反向用例 | 保留绊线语义与历史资格，覆盖前向采用、后向回退、中间代际被拒、单字符篡改失败关闭、跨控制器不泄漏 |
| 本目录文档与原始输出 | 比对脚本、函数级差异、函数体核验 | 把资格声明绑定到可复算的证据，而非结论陈述 |

旧常量原样保留，Django 数组顺序为：

```text
piNativeCandidateDjangoScriptSha256              65f05729…fb61
aDescendantCreationGuardDjangoScriptSha256       4ba1fcaf…723a
sales154SchemaAdditionDjangoScriptSha256         98028cb4…580b
aggregateStatusSnapshotCacheDjangoScriptSha256   fbb62792…bddb  （本轮新增）
```

`piMaintenancePredecessor` 等前驱实际字节（`djangoScriptSha256` = `d37902eb…74f2`）未改动——那描述生产现装的是什么，不属于候选侧。Worker 数组与 `process-deadline.ps1` 的空候选例外数组均未改。

## 检查结果

```text
node --test tests/maintenance-controller-qualification.test.mjs
  登记前：3 tests / 2 pass / 1 fail（复现 CI 同一失败）
  登记后：3 tests / 3 pass / 0 fail

node --test tests/manual-maintenance-continuation.test.mjs tests/maintenance-controller-qualification.test.mjs
  登记后：53 tests / 53 pass / 0 fail
```

绊线仍然失败关闭：把新登记值改动一个字符后重跑，53 tests / 50 pass / 3 fail；还原后回到 53/53。即不是通过放宽测试来转绿。

本轮未执行发布、未准备制品、未访问生产数据库或运行时。候选资格只证明准入函数接受这组字节，不代表已部署或已回滚。
