# unittest 测试类重复收集修复

状态：候选；仅在指定 `codex/fix-loader-collect-20261106` 工作树开发，未合并、推送、打包或上线。
基线：`77382b5fc4ad958e1c22e7d9f8431bffdafdb204`。

## 变更

独立核对现有 `D:/.codex/scripts-loader-count/count_loader.py` 与基线，实际发现 28 个 ai_assistant 模块存在外部 TestCase 绑定，超过最初估计的 15 个。直接导入测试类、以 fixture/prior 等名字导入类，以及 `reader_fixture = module.TestCase` 都会被 unittest 收集，别名是否以下划线开头无关。

改为导入夹具模块，使用 `module.Class.method` 复用原方法；移除一处模块级类赋值。保留本模块真实测试类、方法、装饰器及继承关系；SourceTicketRoleTests 继续继承原 PausedTopologyRoleTests，其原有禁用父类测试的方法绑定保持原样。没有修改全局 TestLoader 或测试发现机制。

新增 `backend/ai_assistant/test_collection.py`：逐模块使用真实 TestLoader 检查只收集本模块用例、ID 不重复。它不会执行被收集的业务测试。

## 验证

- Python 3.12；显式 test/development 配置，清空数据库 URL，SQLite 路径指向私有目录；只做 django.setup、测试发现和收集回归检查，不建立业务数据库、不执行业务测试。
- 全项目 `TestLoader.discover(backend, top_level_dir=backend)`：4945 次 / 4563 唯一 ID → 4639 次 / 4564 唯一 ID，前后发现错误均为 0。原 4563 个唯一 ID 全保留，新增 ID 只有本次 1 项回归；共移除 307 次重复收集。其余 75 次重复属于其他 app，未扩展修复范围。
- 每个既有 ai_assistant 模块的 `own_ids` 有序列表前后完全一致；28 个受影响模块修后总数等于原 own 数。独立再次运行原 count_loader.py 得到同样计数。
- 新增收集回归：1 test 通过。把基线 28 个模块的原外部类绑定在隔离 Python 进程内重新挂回后，恰好 28 个模块子检查失败、0 errors；证明回归会识别原故障。
- 将新模块引用反向映射为旧夹具名称后，28 个模块的非导入 AST 与基线完全相同（仅排除被移除的模块级类赋值），核对测试方法、类继承和装饰器未改。
- `git diff --check` 通过；修改的 Python 文件均经过 AST 解析及真实导入。核对 `tools/verify-release-candidate.mjs` profile 未引用这些修改文件。
- 本任务没有执行业务功能测试、数据库迁移、服务启停或生产操作。

机器可读计数、唯一 ID 摘要及差集见 [collection-summary.json](collection-summary.json)。原始全量快照保留于 `D:/.codex/scripts-loader-count/baseline-77382b5f.json` 和 `after.json`，独立逐模块计数为 `independent-before.json` / `independent-after.json`。

## 逐模块计数

下表计数来自真实 TestLoader；每行修复后的数量等于该模块修复前后的 own 数量。

| 模块（ai_assistant） | 修前总数 | 修后 / 原 own 数 |
| --- | ---: | ---: |
| test_business_budget | 18 | 7 |
| test_business_finance_v3_report_material | 16 | 5 |
| test_business_market_v6_source_ticket_role | 6 | 1 |
| test_business_reports | 16 | 5 |
| test_business_reports_snapshot_bytes | 14 | 3 |
| test_business_v4_claimed_read | 9 | 4 |
| test_business_v4_commit_consumption | 15 | 6 |
| test_business_v4_cross_ticket_replay | 6 | 1 |
| test_business_v4_finance_collection | 12 | 5 |
| test_business_v4_period_plan_candidate | 12 | 7 |
| test_business_v4_replay_read_cast | 5 | 2 |
| test_business_v4_report_link_role | 17 | 3 |
| test_business_v4_report_restricted_page_role | 6 | 3 |
| test_business_v4_report_stream_owning_role | 3 | 1 |
| test_business_v4_seal_admission | 13 | 8 |
| test_business_v4_seal_consumption_candidate | 17 | 5 |
| test_business_v4_seal_ticket | 20 | 5 |
| test_business_v4_seal_verify | 14 | 7 |
| test_business_v4_seal_writer_gate | 15 | 7 |
| test_business_v4_sealer_ledger_read | 13 | 6 |
| test_business_v4_sealer_narrow_stream | 13 | 6 |
| test_business_v4_validation | 12 | 5 |
| test_business_workbench_catalog_acceptance | 2 | 1 |
| test_dingtalk | 48 | 20 |
| test_dingtalk_schedules | 47 | 19 |
| test_dingtalk_settings | 56 | 8 |
| test_pi_business_boundaries | 28 | 8 |
| test_pi_live_acceptance_cancellation | 20 | 8 |
