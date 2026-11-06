# Django 测试失败分类清单（2026-11-06）

## 跑测方法

```
cd D:/.codex/worktrees/django-test-failure-triage-20261106/backend
PYTHONDONTWRITEBYTECODE=1 PYTHONUTF8=1 \
  "D:/teruisi-runtime/django-sales/venv/Scripts/python.exe" manage.py test ai_assistant -v 2
```

工作树基线：`origin/main` @ `0886cd11`（六条 AI 分支刚合并：`knowledge.py`/`task_feedback.py`/
`skill_candidates.py`/`pi_sources.py`/`pi_views.py` 等）。数据库：sqlite 内存（Django 测试默认），
非 PostgreSQL。

## 实测结果

```
Ran 1934 tests in 3864.934s (64.4 分钟)
FAILED (failures=142, errors=236, skipped=209)
```

与独立勘查报的 `1871 / 142 / 236 / 209`（92:42）对比：

| 指标 | 勘查基线 | 本次实测 | 差异 |
| --- | --- | --- | --- |
| tests | 1871 | 1934 | +63 |
| failures | 142 | 142 | 0 |
| errors | 236 | 236 | 0 |
| skipped | 209 | 209 | 0 |
| 耗时 | 92:42 | 64:25 | -28 分 |

**failures/errors/skipped 三项完全一致，仅 tests 总数多 63。** 这说明六条 AI 分支合并带来的新测试
（`task_feedback`/`skill_candidates`/`pi_sources`/`knowledge` 等相关用例）全部通过或被跳过，**没有引入
新的失败或错误**——合并本身在这次测试口径下是干净的。耗时差异大概率是机器负载或并行度差异，不代表
测试集本身变化（另一个代理在自己的工作树上测的是更早的 main，仅多 `schedule_core.py`/
`dingtalk_schedules.py` 重构，与本次基线不同机器/负载条件下比较耗时没有意义）。

378 条失败+错误（142+236）已全部分类，覆盖率 100%。

## 现有 baseline 门禁机制的实情

`tests/catalog-baselines.py`**不是**「已知失败清单」机制——它只是 `tools/check_catalog_baselines.py`
（ACL OWNER 权限静态检查）这个 CI 门禁自身的单元测试，用 `unittest` 写的，没有「测试名 -> 已知失败」
的清单格式，也不消费任何外部清单文件。这份任务提示里说"CI 里有这个 step"是对的，但它的用途和「本次
触发语境里问的 baseline 门禁」完全不同，不适合作为本清单格式的参照对象。

真正符合"委托提到的同类机制"的是 `.github/workflows/check-lint-baseline.mjs`（CI 里叫
"Lint (baseline-gated)"）：
- 格式：不是逐测试清单，是**一个数字常量** `BASELINE_ERRORS = 56`，硬编码在脚本里，旁边一段注释写明
  记录日期、对照的 commit、交叉验证方法。
- 判定方式：拿 eslint `--format json` 的结构化输出算出当前 `errorCount`，**只比较总数**，不比较具体
  是哪条规则、哪个文件。
- 新增失败 vs 已知失败消失：`errorCount > BASELINE` 才 fail（新增即挡）；`errorCount < BASELINE` 只打
  一行提示「可以收紧基线」，不强制。两种情况都不需要逐条勾对清单。
- 清单维护：就是这一个脚本文件本身，由改动的人同时改注释、改常量、改同一次 commit。

**本清单格式判断**：Django 测试的失败原因是异质的（部分是环境必然失败、部分是真缺陷），用单一总数
做门禁会把"环境失败"和"真失败"混在一个阈值里，阈值松了放过真缺陷，紧了又会被环境噪音绑架。所以本
清单**没有完全照抄 lint 门禁的"纯数字"格式**，而是在同一个精神下扩展为"按类别分别计数+可累加":

- 每个类别一个数字基线（类似 `BASELINE_ERRORS`），而不是精确到测试名的清单（更贴近 lint 门禁"按结构
  化计数、不认具体规则"的哲学，避免逐测试清单在测试改名/重构时的脆弱性）。
- `sqlite-no-check` / `sqlite-no-pg-api` / `sqlite-no-role` 三类的基线数字本质是"预期在 sqlite 环境
  下必然失败"的数量，接 CI 时的现实选择是**排除 sqlite 环境执行**（跑 PostgreSQL service），而不是
  拿这三类数字做门禁——门禁只需要管 `real-defect` 的数字是否超过基线。`unknown` 经本次复查已清零（9
  条全部查明根因，分别并入 `sqlite-no-pg-api`/`sqlite-no-check`/`test-stale`，见下文"已查明根因"一
  节），不再作为独立门禁类别；新设的 `test-stale` 类别是否进门禁范围单独讨论（见下文"类别计数分布"
  后的表态），建议单列数字、不与 `real-defect` 合并。
- `frozen-baseline-drift` 不参与门禁数字本身，而是逐条列出，因为这类失败说明基线常量本身该更新，等
  同于 lint 门禁里"下调 BASELINE_ERRORS"的那一侧。

接 CI 时建议：改用真实 PostgreSQL service 容器跑 `manage.py test`，这样 `sqlite-no-check` /
`sqlite-no-pg-api` / `sqlite-no-role` 三类（351 条，占 92.9%）会直接消失或转化为真实通过/失败，届时
门禁盯 `real-defect`（18 条）的总数即可，用与 lint 门禁相同的"委托记录基线 + 超过即挡"写法。`unknown`
经本次复查已清零，不再是门禁要盯的类别。`test-stale`（5 条）是否纳入门禁范围：**建议纳入**，但单列
一个数字、不与 `real-defect` 合并计数——测试过时会掩盖真实回归（该测试本该捕捉的行为变化，因为测试
本身先坏了而测不出来），值得门禁盯住；但它的责任方是测试维护者而不是产品代码，和 `real-defect`
混在一个数字里会让两类问题的处理优先级和责任人都分不清。

## 类别计数分布

| 类别 | 数量 | 占比 | 精确核实 / 按特征批量 |
| --- | --- | --- | --- |
| `sqlite-no-pg-api` | 237 | 62.7% | 精确核实 14 个，其余 223 个按特征批量。较上版 +3，并入原 `unknown` 第一批
  `PromotionWorkbenchDetailTests` 3 条（子分类 `orm-lookup-dialect`，详见上文"已查明根因"一节）——
  已实测证明 PG 侧不坏，确定归类，不再是待定前提 |
| `sqlite-no-check` | 112 | 29.6% | 精确核实 7 个，其余 105 个按特征批量。较上版 +1，并入原 `unknown` 第二批
  `MarketV2ParkedCreationTests` 1 条 |
| `real-defect` | 18 | 4.8% | **全部 18 个逐一精确核实**（不变） |
| `test-stale` | 5 | 1.3% | **全部 5 个逐一精确核实**（新增类别，并入原 `unknown` 第二批
  `test_pi_export_http` 3 条 + `test_pi_workspace` 1 条 + `test_business_screening_http` 1 条）：
  测试本身过时或 stub 不完整，不是产品缺陷，也不是环境必然失败 |
| `unknown` | 0 | 0% | 原 9 条已全部查明根因，分别并入 `sqlite-no-pg-api`（3）、`sqlite-no-check`
  （1）、`test-stale`（5），详见"已查明根因（原列 `unknown`）"一节 |
| `frozen-baseline-drift` | 4 | 1.1% | **全部 4 个逐一精确核实**（不变） |
| `sqlite-no-role` | 2 | 0.5% | 精确核实 2 个（消息文本直接自证）（不变） |
| **总计** | **378** | 100% | 精确核实 50 个（13.2%），按特征批量 328 个（86.8%） |

按特征批量归类的依据：
- `sqlite-no-check`：异常消息是 `AssertionError: DatabaseError not raised` /
  `ProgrammingError not raised` / `... RuntimeError not raised`（测试断言"写入应该被拒绝"，sqlite 没
  有对应的 PG CHECK/触发器约束，所以永远不报错）。
- `sqlite-no-pg-api`：异常消息匹配以下任一特征：
  - `'sqlite3.Connection' object has no attribute 'transaction'`（psycopg 专有 API）
  - `no such function: to_regprocedure/to_regrole/pg_advisory_lock`、
    `no such table: pg_proc/pg_trigger/pg_catalog.*`、`no such column: session_user`（PG 系统目录/
    函数）
  - `near "SET"`/`near "DISABLE"` 语法错误（PG 专有 DDL 语句 sqlite 不认识）
  - 应用层 `ai_assistant.policy.AiError` 消息里显式出现"PostgreSQL"字样（如"文件构建需要 PostgreSQL
    互斥""并行派发需要 PostgreSQL 互斥""后台采集需要 PostgreSQL 互斥"），这些是业务代码自己的运行时
    守卫，在 sqlite 下必然触发。

精确核实的方法：对每条样本读取完整 traceback（不只是末行），定位到抛出异常的源码行，确认异常确实
来自 sqlite 后端限制或业务代码的 PG-only 守卫，而不是凭测试名猜测。

## `real-defect`（18 条，逐条列出）

与环境无关，在真实 PostgreSQL 下同样会失败（或行为本身有缺陷）的问题。

### 1. `workflow/pi_business_n8n.py` 缺失 `SHANGHAI` 时区常量（4 个测试）

- `test_native_complete_coverage_is_no_gap`
- `test_native_exact_graph_active_version_and_seven_day_scope`
- `test_native_node_admission_exact_execution_token_version_and_cancel`
- `test_native_success_requires_original_execution_batches_and_coverage`
  （均属 `ai_assistant.test_pi_business_boundaries.PiBusinessBoundaryTests`）

错误：`AttributeError: module 'workflow.pi_business_n8n' has no attribute 'SHANGHAI'`

根因：测试文件 `from workflow import pi_business_n8n as native` 后调用
`datetime.now(native.SHANGHAI)`。当前 `backend/workflow/pi_business_n8n.py` 全文搜索确认**不存在**
`SHANGHAI` 这个名字——模块内部已经改用 `datetime.now().astimezone()`（服务器本地时区）而不是固定的
`ZoneInfo("Asia/Shanghai")`。这是测试与实现之间的契约断裂：要么测试该同步改用
`datetime.now().astimezone()`，要么实现当初把 `SHANGHAI` 常量去掉是回归（如果服务器不在 UTC+8 运行，
行为会不一致）。两种可能都需要人判断，不是环境问题。

### 2. `ai_assistant/dingtalk_transport.py` 的 `send_media` 对 `before_send` 多调用一次（2 个测试）

- `test_caption_image_is_one_markdown_send_for_person_and_group`
  （`ai_assistant.test_dingtalk_transport.DingTalkTransportTests`）
- `test_post_upload_revocation_and_bad_receipt_never_fall_back_to_separate_messages`
  （同文件同类）

错误 1：`AssertionError: Expected 'mock' to have been called once. Called 2 times.`
错误 2：`AssertionError: 1 != 2`（`calls.call_count`，`_bounded_json` 的调用次数）

根因：`dingtalk_transport.py` 的 `send_media()` 函数里 `before_send()` 被调用了两次——第 109-110 行
（上传媒体文件之前）和第 137-138 行（最终发送消息之前）。从两个测试的设计意图看（函数名、注释"never
fall back to separate messages"），`before_send` 应该只在真正要把消息发给用户之前触发一次（第
137-138 行这次），上传媒体属于内部准备步骤，不该触发。第 109-110 行这次多余的调用是缺陷：它让
`before_send` 在 `revoked=True` 场景下过早抛出，使后续计数（`_bounded_json` 调用数）和另一测试的
`guard.assert_called_once()` 都不符合预期。

### 3. `ai_assistant/pi_gateway.py` 新增的 `"admission" not in payload` 必填校验，`test_pi_runtime.py`
   没有同步（11 个测试，同一根因）

- `test_bridge_stop_between_requests_does_not_admit_remaining_list`
- `test_known_tool_response_after_stop_is_saved_and_replayed_without_new_read`
- `test_model_dispatch_precedes_post_and_completed_round_replays_private_cache`
- `test_real_provider_adapter_accepts_large_pi_code_for_both_protocols`
- `test_stop_before_file_reader_does_not_fetch_new_bytes`
- `test_stop_during_model_catalog_prevents_provider_call_without_unknown`
- `test_stop_while_catalog_blocks_prevents_business_send_and_keeps_known_receipt`
- `test_model_transport_cancel_guard_reads_user_abort_while_in_flight`
- `test_model_unknown_post_is_not_repeated`
- `test_provider_diagnostics_survive_duplicate_freeze_and_refresh_without_replay`
- `test_worker_prioritizes_abort_over_pending_bridge_and_continues_same_environment`
  （均属 `ai_assistant.test_pi_runtime.PiRuntimeTests`）

错误样例：`ai_assistant.policy.AiError: 缺少代理树准入绑定，请升级Runner`（code=`pi_admission_required`）；
部分表现为 `model.call_count` 为 0（应为 1）、或命令序列缺了预期的 `"abort"` 步骤。

根因：`pi_gateway.py` 第 344-349 行，对非 `local_complete` 的 admission 操作要求 payload 必须带
`"admission"` 字段，否则 409 拒绝。`git log` 显示这条校验来自近期提交 `d359c0e2`（"wrap gateway
admission checks in authority transactions"）。`test_pi_runtime.py` 的测试 payload 构造没有带这个新
字段，是六条 AI 分支合并后测试契约没跟上实现变化——11 个测试全部卡在同一处 `AiError` 之后，是单一根
因的连锁反应，不是 11 个独立缺陷。

### 4. `ai_assistant/migrations/0084_pi_agent_independent_runtime.py` 的
   `RunPython(install)` 不可逆，被 `test_business_collection_upgrade.py` 的回滚路径打断（1 个测试）

- `test_old_rows_and_terminal_guard_survive_new_manual_defaults`
  （`ai_assistant.test_business_collection_upgrade.CollectionUpgradeTests`）

错误：`django.db.migrations.exceptions.IrreversibleError: Operation <RunPython <function install ...>>
in ai_assistant.0084_pi_agent_independent_runtime is not reversible`

根因：测试先把迁移状态拉回到 `0014_business_evidence`，验证完升级到 `0015_business_collection` 后的
行为，再在 `finally` 里调用 `MigrationExecutor(connection).migrate(latest)` 回到最新状态——但
`latest` 是测试一开始（在任何回滚之前）就取的 `executor.loader.graph.leaf_nodes()`，而 `0084` 是六条
AI 分支合并新增的迁移。Django 的迁移执行器在往回/往前调整依赖图状态时，碰到 `0084` 的
`RunPython(install)` 需要被反向应用，而它没有 `reverse_code`，于是抛出不可逆错误。

旁证：对整个仓库的 grep 显示，`ai_assistant/migrations/*.py` 里凡是 `RunPython(install)` 这个写法
（63 处）**没有一个**带 `reverse_code`——这不是 `0084` 自己的孤立疏漏，是项目里这一类迁移的统一写法，
问题出在"测试的回滚路径理论上会经过所有迁移"这个假设，被新迁移的加入打破了，而不是 `0084` 本身写错
了什么项目既有惯例之外的东西。

## `frozen-baseline-drift`（4 条，逐条列出）

### 1. `len(AI_TABLES) == 89`，实际 112（委托已提示的那条，已独立核实）

- `test_exact_history_and_new_table_inventory`
  （`ai_assistant.test_business_v4_report_link_contract.V4ReportLinkContractTests`）

断言位置：`backend/ai_assistant/test_business_v4_report_link_contract.py:21`
`self.assertEqual(len(AI_TABLES), 89)`，实测 `AssertionError: 112 != 89`。

`AI_TABLES` 定义在 `backend/ai_assistant/table_manifest.py`，是一串 `AI_TABLES_PRE_*` 元组逐步追加
拼接而成的最终元组，`table_manifest.py` 本身随每次新迁移持续更新（最近一次改动是
`9c909d25 feat(ai): distil a finished run into a reviewable Skill candidate`）。真正冻结在 89 的是
**测试里的断言数字**，自 `0071_business_v4_report_source_link` 迁移落地时写定（commit `bf1e8a05`/
`403cf27c`），此后没再跟着 `table_manifest.py` 的增长同步更新。89 → 112 的 23 张差额，是之后陆续新
增的 market v2 / promotion budget v10/v11 / pi runtime / pi business / pi native / task feedback /
skill candidate 等整批表。

是否阻塞发布链：在 `backend/` 和 `tools/` 范围内搜索 `len(AI_TABLES)`，命中的全部是测试文件本身，没
有任何生产代码或发布门禁脚本依赖这个具体数字；但 `AI_TABLES` 这个元组（不是它的长度）被 60+ 个
`tools/*-upgrade-rehearsal.py` 演练脚本广泛引用。按既有记忆（`new-ai-table-needs-provision-receipt-
gate.md`）的说法，每新增一张 AI 表都该同步补一道 provision 受理闸，漏加会打断历史演练——这条记忆是
否适用于这 23 张新表需要另外核实，不在本次任务授权范围内（本次只分类不改代码、不做额外核查）。

### 2. 同一份 `AI_TABLES` 还有两条更旧的冻结断言，都断言 78（比 89 更早冻结，漂移更大）

- `test_exact_models_tables_and_append_only_grants`
  （`ai_assistant.test_business_screening_storage.InventoryTests`，第 82 行
  `self.assertEqual(len(AI_TABLES), 78)`）

实测 `AssertionError: 112 != 78`。另有 `backend/ai_assistant/test_business_source_directory.py:72`
同样断言 `78`（该测试本身因为别的原因在 `sqlite-no-pg-api` 类别里失败，断言 78 那一行没被执行到，但
如果前面的失败被修掉，这条也会在真实环境里暴露同样的漂移，值得记录）。

两处 78 的断言比 89 更早冻结，说明 `AI_TABLES` 的测试断言已经至少经历了两轮"新增表后漏更新"——不是
单一事件，是重复出现的模式。

### 3. `pi_research` 依赖包清单的响应 payload 新增了 `admission` 字段，测试断言没跟上

- `test_dependency_bundle_uses_offline_resource_install`
  （`ai_assistant.test_pi_workspace.PiWorkspaceTests`）

错误：`AssertionError: {...} != {...}`，diff 显示实际返回的 `installed["payload"]` 比测试期望的
`{"bundle": bundle}` 多了一个完整的 `"admission"` 字典（`admissionEpoch`/`mode`/`modeRevision`/
`rootSessionId`/`scopeSha256`/`treeVersion`）。

这与上面"real-defect 第 3 条"（`pi_gateway.py` 新增 `admission` 必填字段）是同一波改动的另一面：
不是接口拒绝请求，而是响应体里多返回了一截内容，测试断言的"冻结 payload 形状"没有跟着更新。方向不同
但同源——都是 admission 机制落地后，旧测试契约没有整体同步。

### 4.（委托提到的另一类同形状 drift，Worker 侧，仅记录不处理）

委托消息里提到 `tests/business-agent-budget-tools.test.ts:35` 断言冻结的 surface 顺序，实际
`pi_agent`/`pi_business` 插入后没同步基线——这是 Worker/TypeScript 侧的测试，不在本次
`manage.py test ai_assistant` 的运行范围内，这里不重复验证，只记录"同类形状在 Worker 侧也存在"这一
事实，供以后统一处理冻结基线债务时参考。

## 已查明根因（原列 `unknown`，9 条）

原 9 条 `unknown` 已全部查明根因，分两批记录。

- `test_detail_reports_filter_exact_json_owner_and_bound_projection` 的姊妹问题已归入
  `sqlite-no-pg-api`（sqlite `malformed JSON`），不在此列。

### 第一批：3 条，`PromotionWorkbenchDetailTests`，判定 `sqlite-no-pg-api`（子分类 `orm-lookup-dialect`）

- `test_reader_enabled_writer_disabled_still_refuses_public_creation` /
  `test_signed_sealed_detail_exact_choice_and_disabled_flag` /
  `test_unsealed_legacy_and_other_actor_fail_closed`
  （`ai_assistant.test_business_promotion_workbench_detail.PromotionWorkbenchDetailTests`）

症状：均为 `503 != 200`，响应体 `{"error": "AI 服务暂时不可用", "code": "service_unavailable"}`。

掩盖层：`ai_assistant/views.py` 的兜底裸 `except Exception:` 把真实异常压扁成这句统一文案；真实异常
是 `django.db.utils.OperationalError: malformed JSON`，来自 `backend/ai_assistant/business_evidence.py:79`：

```
.annotate(evidence_id=KeyTextTransform("evidenceRunId", Cast("snapshot_json", JSONField())),
          report_schema=KeyTextTransform("schemaVersion", Cast("snapshot_json", JSONField())))
.filter(evidence_id=row.id, report_schema="business-report-v1")
```

真因是 Django ORM 对 `KeyTransformExact` 的方言分支差异，不是业务代码调了 PG-only API，也不是业务代码
没加方言守卫导致"PG 侧也会坏"——PG 侧已实测证明不坏。机制在 Django 源码
`django/db/models/fields/json.py:535-559` 的 `KeyTransformExact.process_rhs`：只有当
`connection.vendor == "sqlite"` 时才把 RHS 套进 `JSON_EXTRACT(%s,'$')`（判断用的
`jsonfield_datatype_values` 在 PG 上是 `None`、在 sqlite 上是
`frozenset({'true','null','false'})`）；sqlite 上编译出 `... = JSON_EXTRACT(%s, '$')`，参数
`'business-report-v1'` 不是合法 JSON，报 `malformed JSON`。PG 侧走的是另一条路径——
`KeyTextTransform.as_postgresql`（`json.py:432-434`，`output_field = TextField()`）编译成
`(("ai_report_runs"."snapshot_json")::jsonb ->> %s) = %s`，参数
`('schemaVersion', 'business-report-v1')`，右侧是裸 bind 参数、`->>` 本身返回文本，text = text 直接
比较，不会再套任何 JSON 函数。

仓库里另外三处相似写法**形状各不相同，不构成"同写法先例"**，不能作为"预期 PG 没问题"的类比依据：
- `configuration.py:143`：外层包了 `Cast(..., CharField())`，PG 编译成
  `((... ->> 'id'))::varchar IN (%s)`，走的是 `In` 查找而不是 `KeyTransformExact`，根本不经过上面那段
  sqlite 特判。
- `chat.py:526`：`_args__modelId` 是 JSONField 上的 key lookup（不是 `KeyTextTransform` 的结果），PG
  编译成 `(...::jsonb -> 'modelId') = Jsonb('mdl-1')`（`->` 不是 `->>`）；sqlite 侧参数是
  `'"mdl-1"'`（带引号、本身就是合法 JSON），所以在 sqlite 上也不报 `malformed JSON`。
- `policy.py:216-232`：显式 `if connection.vendor == "postgresql":` 分支，sqlite 分支走注册的
  `ai_scope_covers` 自定义函数——这是**正确处理方言差异的反例**，恰恰说明
  `business_evidence.py:79` 没有照这个模式加方言分支。

PG 侧另有一层风险已实测排除：`Cast(text, JSONField())` 在 PG 上如果传入非法 JSON，`migrations/
0012_report_library.py:11` 那道 CHECK 只管字节长度（`octet_length(snapshot_json) <= 32768`），不管
格式；但格式由触发器兜住——`ai_report_runs` 表上有 `ai_business_budget_report_binding`
（`0021:114`，函数体 `0021:82` 无条件执行 `NEW.snapshot_json::jsonb` 和 `::json`）和
`ai_market_v2_admitted_report_guard`（`0053:317`，函数体无条件 `::jsonb`，覆盖
INSERT/UPDATE/DELETE），两者都没有后续 migration DROP，非法 JSON 在 INSERT 时就会被 cast 失败拒绝；
写入侧全部走 `canonical()`（`policy.py:25`，`json.dumps(allow_nan=False)`）产出合法 JSON。

这 3 条不是"代码调了 PG-only API"这种典型 `sqlite-no-pg-api` 形状，是"测试在 sqlite 下跑一个只在 PG
下正确的 ORM 写法"，修法也不同：不是给 sqlite 加守卫跳过，而是像 `policy.py:216-232` 那样给
`business_evidence.py:79` 加 vendor 分支，或改用 `__contains` / 显式 `RawSQL` 绕开
`KeyTransformExact` 的 sqlite 特判。

### 第二批：6 条

| 测试 | 真实异常 | 判定 | 根因 |
| --- | --- | --- | --- |
| `ai_assistant.test_pi_export_http.PiExportHttpTests` 的 `test_each_export_observes_live_pages_and_file_with_same_status_call_id`、`test_status_keeps_writer_authority_owner_generation_scope_surface_and_signature_gates`、`test_two_datasets_keep_parent_and_distinct_stable_write_receipts`（3 条） | `KeyError: 'TERUISI_DJANGO_INTERNAL_SECRET'`，在 `test_pi_export_http.py:60` 的 `setUp` 里 | `test-stale` | 测试无保护地读 `os.environ["TERUISI_DJANGO_INTERNAL_SECRET"]`，而 `teruisi_backend/settings.py:110` 只在 `not DEBUG` 时**要求**该变量；sqlite 测试配置下它是可选且未设。测试自己的 docstring 写着"Run only with a private test database and Node/tsx available"却**没有 `skipUnless` 守卫**（全文唯一 `getenv` 是 `:63` 的 `PI_EXPORT_TSX_LOADER`）。它也不在 `.github/workflows/ci-unit-test-files.txt`（35 行、零命中）里——本就不该无人值守地跑，但没有任何机制强制。非产品缺陷。 |
| `ai_assistant.test_pi_workspace.PiWorkspaceTests.test_async_control_fences_reset_model_and_new_prompt` | `KeyError: 'action'`，在 `test_pi_workspace.py:33`；被吞后重抛成 `AiError: Pi 控制结果未知，禁止自动重发` | `test-stale` | 测试自己的 `runner` stub 不完整。`pi_workspace.py:596` 的 `needs_init = not active and (not operation or workspace.status == "uninitialized" or command == "model_set")` 让 `model_set` 总会建一个 `workspace:init` 操作（`:607`）并调 `_create_environment`（`:627`）→ `pi_worker.runner_dispatch(operation, "create", {...})`（`pi_workspace.py:496`）。那个 `create` 请求带 `admission`/`gateway`/`skillIds`/`model` 但**没有 `action` 键**，而测试的 stub（`test_pi_workspace.py:32-33`）无条件取 `value["action"]`。`KeyError` 被 `pi_workspace.py:704` 的裸 `except Exception` 捕获、把操作标 `unknown`、在 `:727` 重抛成 `AiError`——所以 `assertRaises(AiError)` 通过了，但泄漏出的第二个操作把 `:274` 的计数断言打破。同文件 `:210` 的兄弟测试做对了：它同时 patch 了 `workspace._create_environment`。`model_set` 子句和这个测试来自**同一个提交 `bf14afca`**，stub 从一开始就不完整。 |
| `ai_assistant.test_business_market_v2_parked_creation.MarketV2ParkedCreationTests.test_database_rejects_initial_wrong_graph_and_tool_catalog`（含 subTest `name='graph'`、`name='tools'`） | `AssertionError: DatabaseError not raised`（`:192`），父用例随后 `AssertionError: True is not false`（`:195`） | `sqlite-no-check` | 测试伪造 `graph_json`/`allowed_tools_json` 并期望 DB 拒绝。拒绝只存在于 PG plpgsql 触发器里，比对 `graph_digest`/`tool_policy_digest` 与 `encode(sha256(convert_to(...,'UTF8')),'hex')`：`0044:301`、`0053:100-104`、`0060:161`、`0064:135`，全部在 `if schema_editor.connection.vendor != "postgresql": return` 之后（`0044:334`、`0053:304`、`0064:514`、`0026:243`）。`0077:281` 的 `octet_length(graph_json) <= 32768` CHECK 同样 PG-only。没有守卫，伪造的行正常插入，所以 `:195` 的行数断言也跟着失败。 |
| `ai_assistant.test_business_screening_http.ScreeningReviewHttpTests.test_signed_review_prepares_outside_transaction_and_replays_without_content` | `AssertionError: 403 != 200 : {"error": "接口不属于当前读写进程", "code": "access_denied"}`，在 `:119` | `test-stale` | 测试在 `process_role("ai_reader")`（`:117`）下调 `GET /api/ai/reports/<id>`。提交 `e96882fb`（"Route exact report detail through protected writer read"，2026-09-26）把精确报告详情改成**writer-only**：`views.py:287-300` 把 `report_detail_read` 设为 `writer=True`，`views.py:312-314` 随即以那个 403 拒绝 `ai_reader`。测试写于 2026-09-17（`140d1ba7`），早九天，而 `e96882fb` 没碰它（它改的是 `test_report_detail_writer_read.py`、`lib/django/ai-service.ts`、`tests/django-ai-service.test.ts`、`tests/business-screening-view.test.ts`，`git show --stat` 确认）。生产与 Worker 两侧都与新行为一致（Worker `lib/django/ai-service.ts:67`、`:100` 强制走 writer；`tests/django-ai-service.test.ts:149-152` 断言显式传 `service: "reader"` 会被拒且不发 fetch；活调用方 `app/ai-report-workbench-view.tsx:104` 路由正确；`e96882fb` 是 `HEAD` 的祖先，已上线）。只有这个测试过时。 |

第二批 6 条里零个 `real-defect`：3 个 `test-stale`（export_http）+ 1 个 `test-stale`（pi_workspace）+ 1
个 `sqlite-no-check`（market_v2_parked_creation）+ 1 个 `test-stale`（screening_http）。

## 总结

- 92.9% 的失败（351/378 = `sqlite-no-check`(112) + `sqlite-no-pg-api`(237) + `sqlite-no-role`(2)）
  是 sqlite 环境本身造成的，换真实 PostgreSQL 跑应该会消失或转化为真正的通过/失败。
- 4.8%（18/378）是确认的真实缺陷，已逐条列出根因和涉及文件。其中 11 条（`pi_gateway.py` admission
  必填）和 1 条响应体 drift 共同指向同一波"admission 机制落地但部分旧测试/文档没跟上"的变更。
- 1.3%（5/378）是测试自身过时或 stub 不完整（`test-stale`），不是产品缺陷：3 条读未设置的环境变量
  （`test_pi_export_http`）、1 条 stub 缺字段（`test_pi_workspace`）、1 条测试早于接口契约变更
  （`test_business_screening_http`）。
- 1.1%（4/378）是冻结基线漂移（`AI_TABLES` 计数两代、一个响应 payload 形状），说明项目里"改了代码
  忘了同步冻结断言"不是孤立事件。
- 0%（0/378）`unknown`：原 9 条已全部查明根因，分别并入 `sqlite-no-pg-api`（3 条，
  `PromotionWorkbenchDetailTests`，子分类 `orm-lookup-dialect`）、`sqlite-no-check`（1 条，
  `MarketV2ParkedCreationTests`）、`test-stale`（5 条，见上一条）。其中 `PromotionWorkbenchDetailTests`
  3 条此前被生产代码的 `except Exception` 兜底处理器掩盖了真实异常类型，本次通过读 `business_evidence.py`
  源码和 Django ORM 方言分支定位到了真因，不再需要改代码加临时日志。

接 CI 的建议（不实施）：
1. 新增一个独立的 PostgreSQL service 的 CI job 跑 `manage.py test`，不要尝试在 sqlite 上门禁 Django
   测试——sqlite 环境下的失败基线噪音太大，不值得维护逐条清单。
2. 门禁数字盯 `real-defect`（本次是 18）单独一个基线常量，按 lint 门禁同款写法：硬编码基线常量、附注
   记录日期和对照 commit、结构化输出（不是文本 regex）、超过才 fail、低于则提示可下调。`unknown` 已
   清零，不再是门禁要盯的类别。`test-stale`（本次是 5）建议单列一个基线常量纳入门禁，不与
   `real-defect` 合并——测试过时会掩盖真实回归，值得盯住，但责任方是测试维护者不是产品代码，混在一
   个数字里会让处理优先级和责任人都分不清。
3. 先把本清单里 18 条 `real-defect` 和 4 条 `frozen-baseline-drift` 交给代码所有者处理（本次任务不
   做任何修复），处理完一批就相应下调门禁基线数字，避免基线一开始就带着已知缺陷。
4. `test-stale` 5 条的具体修法见下文"修法方向（不实施）"一节。

## 修法方向（不实施）

以下只记录修复思路，本次任务不修改 `backend/` 下任何代码。

- `test_pi_export_http`（3 条）：在 `setUp` 里加 `skipUnless`（检查
  `os.environ.get("TERUISI_DJANGO_INTERNAL_SECRET")` 存在 且 `shutil.which("node")` 非空），与测试
  docstring 已声明的"Run only with a private test database and Node/tsx available"对齐；或者在
  `setUp` 里设置一个一次性的 32+ 字节 secret，而不是依赖读取外部环境变量。
- `test_pi_workspace`（`test_async_control_fences_reset_model_and_new_prompt`）：让测试的 `runner`
  stub 容忍 `create` 请求缺 `action` 键（改成 `value.get("action")` 而不是 `value["action"]`），或者
  照同文件 `:210` 兄弟测试的做法，同时 patch `workspace._create_environment` 避免真的走到 `create`
  分支。另外值得单独考虑：收窄 `pi_workspace.py:704` 的裸 `except Exception`，不要把真的
  `KeyError`/`TypeError` 这类编程错误洗成 `pi_control_unknown`——这会掩盖下一次类似的契约断裂。
- `test_business_market_v2_parked_creation`（`MarketV2ParkedCreationTests`）：无需改代码，拒绝逻辑
  在 plpgsql 触发器里，sqlite 结构性测不到；建议标记为 PG-only 测试（`skipUnless(connection.vendor
  == "postgresql")`）或移到单独的 PG 演练套件，不在默认 sqlite 测试里跑。
- `test_business_screening_http`（`test_signed_review_prepares_outside_transaction_and_replays_
  without_content`）：`:117` 的 `process_role("ai_reader")` 改成 `"ai_writer"`，对齐 `e96882fb`
  之后"精确报告详情走 writer-only"的契约。

## 已知缺口（本次未修，仅记录）

- `ai_assistant/views.py:704` 附近的裸 `except Exception:` 兜底处理器会把任意未预期异常（包括编程
  错误）统一压扁成 503 `service_unavailable`，掩盖真实异常类型；`pi_workspace.py:704` 的同形兜底同理
  （见上文"修法方向"一节）。
- `views.py:679-684` 的**第二层** `except (ValueError, TypeError, KeyError):` → 400 `invalid_request`
  比第三层（`except Exception:` → 503）更隐蔽，且零日志。实测注入四组异常验证：
  `TypeError("'NoneType' object is not subscriptable")` → 400 / 0 条日志；
  `KeyError("missing_internal_key")` → 400 / 0 条日志；`json.JSONDecodeError` → 400 / 0 条日志；
  `AttributeError("boom")` → 503 / 1 条日志。第二层把内部编程错误误报成"客户端请求格式无效"，而 400
  在排障时通常被当成调用方传参错误直接跳过，503 至少会被当服务端问题去查。本次任务只核实了最外层
  （第三层，对应 `PromotionWorkbenchDetailTests` 3 条）的掩盖机制，第二层这道更隐蔽的缺口尚未修复。
- `pi_workspace.py:704` 的裸 `except Exception` 与 `views.py` 那处同形——会把编程错误（`KeyError`）
  转成 `AiError` 并把操作标 `unknown`。是潜在的可诊断性问题，但生产里 `runner_dispatch` 发的是真
  `create` 请求，仅通过读代码判断，未找到触发它的生产路径，也未验证生产行为。
