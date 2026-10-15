# 市场轻进度后端交接

> 本页保留当时开发与交付事实；后续正式采用及 reader 边界修正见[生产记录](PRODUCTION.md)和[reader 修正](reader-fix.md)。

日期：2026-10-15。工作树基线 `eda935cf`，分支 `codex/market-progress-resume-20261015`。状态：本子任务源码及隔离验证完成，等待主代理集成和独立审查；未自行提交、推送或部署。

## 实现与契约

请求仍走签名 `POST /api/market/queries`，正文为：

```json
{"operation":"annotations","view":"progress_light","params":{"jobId":"<现有任务身份>"}}
```

`params` 只接受 `jobId`。成功响应顶层恰为 `job`、`activeClaims`、`cloudRun`、`sampledAt`；保持 `no-store` 与原 `X-Market-Data-Revision` 来源。

- `job` 沿用 `_job_value` 的既有字段。所有完成、失败、已复核、已提交、剩余计数均为任务记录数；`remainingInferenceCount` 包括仍可重试的 queued/failed（attempt < 3）与 claimed/inferencing，其他语义与旧进度一致。
- 计数使用一次按同一 `job_id`、status 分组的聚合，不读取 recognition mode，不扫描历史 audit，不调用 `_summarize_job`、`_queue_progress` 或 `_recognition_items`。`_job_value` 接收已计算的剩余数，避免再查一次。
- 复用纯 `_apply_job_counts` 保持旧 status 投影规则；旧 `_summarize_job` 仍按原查询和规则调用它，不改变既有刷新写路径。
- `activeClaims` 保持原定义：claimed/inferencing 且有效期严格大于采样时刻的记录数。它与总剩余记录数分别提供。
- `cloudRun` 复用 `_cloud_run_value`，包含 `controlVersion`、state、并发、冷却、心跳和既有脱敏错误字段；没有 run 时返回 null，坏控制版本仍拒绝。`sampledAt` 是本次轻投影计数使用的 UTC 时刻。
- 轻接口不提供 `uniqueInferenceUnits`、`remainingInferenceUnits`、queues、performance；跨月同图的三条记录仍是三条记录，不冒充三个去重推理单元。原 `view=progress` 继续提供详尽统计。

## 一致性、权限与边界

只有精确的 annotations/progress_light 路径使用 `_progress_light_read`。PostgreSQL 读取在独立 `REPEATABLE READ READ ONLY` 事务内执行，authority、revision、job、计数、run 和配置来自同一快照；不再用全域 revision 前后两次采样要求写入期间静止。其他查询仍使用原 `_consistent_read`。

保留原签名、viewer/analyst/operator/admin 与无 scope 契约，并在轻事务内核验既有 authority epoch/cutover。查询超时上限 3000ms、锁等待上限 1000ms、事务闲置上限 5000ms，只收紧调用连接原来更严格的非零限制。完整读取超过 5 秒拒绝返回成功。所有 SET 均局限本次事务，成功与失败后恢复连接设置。

发现已有 atomic/non-autocommit 事务时，在执行 SQL 前以 503 失败关闭，不改变父事务隔离级别或只读标志。当前设置无 ATOMIC_REQUESTS，现有 middleware 也未包 atomic；没有修改全域 middleware 或连接设置。

没有修改 models、migration、权限 grant、claim、complete、重试预算、未知隔离或自动暂停规则。本子任务没有真实模型请求、正式 5432 连接、正式凭据读取、生产数据写入、维护、部署、重启或外发。

## 隔离验证

复用 `tools/market-annotation-postgres-rehearsal.py`：只重用已安装 Python/PostgreSQL 可执行文件，独立工作树内创建随机测试凭据及临时 cluster，固定 `127.0.0.1:55447`，全部完成后正常停止。

主轮命令：

```powershell
$env:MARKET_PROGRESS_LIGHT_EVIDENCE='D:/codex-artifacts/market-progress-resume-20261015/backend'
& 'D:\teruisi-runtime\django-sales\venv\Scripts\python.exe' tools/market-annotation-postgres-rehearsal.py --test-label market.tests.test_annotation_progress_light --test-label market.tests.test_api.MarketApiContractTests.test_annotation_progress_is_read_only_and_derives_live_counts --test-label market.tests.test_annotation_queue --test-label market.tests.test_annotation_activity --test-label market.test_annotation_resume_round2
```

结果：41 项通过，19.591 秒。包含新轻读、旧只读进度、队列/未知隔离、原恢复控制回执、native activity barrier；部署 grant 合同的真实 `teruisi_market_reader`、`teruisi_market_writer` 探针通过，分别拒绝 5/4 条越权 SQL。另建最小 PostgreSQL reader 角色（六张必要市场表 SELECT），实际调用轻接口，验证 READ ONLY / REPEATABLE READ、拒写及禁止跨域读。

最后两项增量命令：

```powershell
& 'D:\teruisi-runtime\django-sales\venv\Scripts\python.exe' tools/market-annotation-postgres-rehearsal.py --tests-only --test-label market.tests.test_annotation_progress_light.ProgressLightTests.test_gate_created_after_final_check_is_rejected_by_actual_native_barrier --test-label market.tests.test_annotation_progress_light.ProgressLightTests.test_parent_transaction_is_unchanged_and_failure_rolls_back_settings
```

结果：2 项通过；共覆盖 42 个不同用例（父事务用例增补断言后复跑）。新增断言证明保留 1200ms statement / 700ms lock 更严限制、成功/失败还原、5 秒期限拒绝；以及最终 gate 检查之后、持久领取之前新建 gate 时，真实 native barrier 仍拒绝且 attempt 不增加。`git diff --check` 通过。

具体负向覆盖：缺签名、所有角色、scope 拒绝、400 参数、404、authority 不符、revision 不可用、坏控制版本、无 cloud run、queued/failed 封顶、有效/过期/无有效期租约、superseded 排除、终态保留、跨月重复身份、零持久写入、重函数禁调。并发用独立数据库连接在每次读取中提交元数据、item 状态、run 控制版本和 revision：旧 progress 持续版本变化返回原 503；轻读连续五次 200，revision、job、计数与 run 均属于同一旧快照。

真实 gate 用例仅在 TemporaryDirectory 创建协议合法的 gate，调用真实 `read_gate` 与 Windows `protected_activity`：helpers/requests 期间 dispatch/claim 拒绝；移除 gate 后原 running 意图可被原派发和领取自然消费，无 `_set_cloud_run` 自动恢复；手工 paused 与 unknown-paused 不恢复；派发表读取后手工暂停、领取前 gate 和最终检查后 gate 均不增加 attempt。此证据覆盖 Django 数据库与本机原生 barrier；主代理的 resolver/transport 合成测试覆盖另一边界，二者不能互相冒充完整生产维护演练。

首轮 9 项执行报 10 errors：新 TransactionTestCase 默认 flush 全域表，被现有 AI 原生保护表 FK 阻断，继而出现未清理夹具的重复主键。按现有市场并发夹具限定 `available_apps=["market"]` 后收口，未修改全域测试执行器或保护表。原失败日志保留，未改写为通过。

## 合成对照

同一冻结合成分布：6023 条当前 job 记录、18000 条历史 job 记录、18000 条历史 audit，当前身份包含跨三个月记录。先各一次预热，随后配对三个样本。每对 `job`、`activeClaims`、`cloudRun` 全等。

| API | 三次响应耗时 ms | 中位 ms | SELECT 数 |
| --- | --- | --- | --- |
| 旧 progress | 90.183 / 86.304 / 88.587 | 88.587 | 21 |
| progress_light | 18.526 / 18.068 / 18.026 | 18.068 | 10 |

轻接口 10 个 SELECT 包括 4 个限时设置读取、authority、revision 及四个投影查询，只有一次 item 聚合，没有 audit 查询。以上为隔离 Django 测试客户端局部样本，不含正式 Worker/鉴权完整传输、浏览器渲染或真实模型，不宣称生产 P95 或持续吞吐。

## 证据与交接

外部非敏感证据目录：`D:/codex-artifacts/market-progress-resume-20261015/backend/`。

- `attempt-1-tests-failed.log`：首轮原始失败。
- `attempt-2-tests-41-passed.log`、`attempt-2-result.json`：主轮及真实角色探针结果。
- `attempt-3-tests-2-passed.log`、`attempt-3-result.json`：最终增量。
- `synthetic-benchmark.json`：主轮配对计时。
- `source-hashes.json`：最终三份后端源文件绑定。

应用源码 `annotations.py` 与 `views.py` 自主轮开始后未变化；测试文件最后新增 native barrier 竞态及父事务时限断言，由增量两项验证。主代理负责独立审查、最终组合提交/推送、制品、是否部署及记忆统一收尾；本子任务未修改主代理前端或薄适配文件。
