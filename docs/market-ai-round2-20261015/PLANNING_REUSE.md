# 第二轮 P1 可信无价复用与 P2 计划创建批量化

2026-10-15。开发基线 `cabf97f1a29b097334cf91dcb1f1f8a55d385116`，独立 worktree `codex/market-ai-round2-20261015`。本报告覆盖候选实现与独立合成 PostgreSQL 验证；合并、制品和生产采用由总控另记。本子任务生产操作、真实模型调用、旧调用账本消耗均为 0。

## 实现与边界

`backend/market/annotation_planning.py` 提供 `build_job_items()`。真实 `_create_job` 已接入，保留原 Prompt 行锁、有效工作键复用、原子创建、批量插入、模式审计及云运行初始暂停状态。原完整候选 QuerySet 按 `-period_end, rank, id` 顺序持续扫描，以 256 条候选为一批；无图、已完成或受保护项跳过后继续扫描，直到获得上限内的有效候选。snapshot、图片缓存、正式标注、跨图分类、历史源、历史任务、人工审计、金标与封顶项均有界批读。精确 tuple 谓词按除 SKU 外的字段分组，单组 SKU 参数不超过 256；窗口查询仅返回每个精确身份的最新来源，不把全部历史加载到 Python。

身份保持当前模型的 `category + scope + sku_code + ranking_dimension + image_content_sha256`，snapshot 另外匹配目标月份。现行市场模型不含独立 `shop_name` 身份字段，本轮未自行新增。正式 `_candidate_rows` 仍仅允许 SKU；不跨类目、scope 或 SKU/SPU 借用分类或价格。同图允许跨月复用，换图只沿用当前字典中的有效分类并重新识别价格。图片缓存的当前内容哈希优先于 snapshot 旧哈希。

可信“明确无标价”必须源条目明确为该价格类型，价格、最低价、最高价均为 null，分类有效，并匹配相同 Prompt、执行器、模型及本地模型名。AI 输出、JSON 可解析、置信度和理由都不建立人工资格，也不要求它们与人工结论一致。资格来自以下任一证据：

- 真实 `review` / 明确 `select_filtered selected=true` 命令记录的人工审计。审计绑定真实 actor/角色、任务、Prompt、精确身份与图片以及复核字段摘要、精确版本。未入库的 `approved` / 人工保存的 `review_pending` 要求审计版本等于当前版本；`committed` 只允许入库随后递增一次。自动完成、自动复制、入库操作人或 history sentinel 本身都不建立资格。
- 当前正式 annotation 明确指向该已入库源条目，源条目仍明确无标价，金标源链接、分类、空价格都一致，且金标创建时间不早于 source/annotation 最新修订。金标 null 本身不能表达“无标价”。

源可以在正式入库前经有效人工复核建立无价复用资格。新候选只进入 `review_pending`，`selected=false`、价格保持 null，仍经过原人工选择与正式入库边界；不会自动批准、写正式价或清掉既有确认价。`无法判断`、定金、分期、起售价和 rejected 不获得无价资格。

归档或取消任务中的未入库 `approved/review_pending` 来源不再有效：其人工审计既不能提供无价复用，也不能把旧正式分类替换为新的固定分类。未真实复核的非 committed 模型草稿也不建立固定分类。已 committed 的正式历史事实仍允许原有归档复用规则。

较新的人工分类、价格或 unknown 修订优先。主数据编辑器不一定更新 `reviewed_at`，因此权威正式标注使用 `max(updated_at, reviewed_at)` 做修改栅栏，避免旧类旧价混入新分类。旧 source 不一致、策略不兼容、内容/版本变化或换图均使资格失效。较新的未解决人工 unknown 也不能把旧 `failed/attempt_count>=3` 身份重建为 attempt 0；晚到 sentinel 同样不能解封。原封顶行完全不修改。只有晚于封顶且无需模型的新有效已解决结果可直接复用；换图属于新图片身份。

旧 committed 记录的 `reviewed_by` 会被入库命令覆盖，无法据此证明当时真实人工复核，因此旧未证明人工、未有效金标的无价结果保守不给免模型资格。现行 `mark_gold` 更新已有 sample 不改 `created_at`；在新修订前创建的旧 sample 不因此自动成为新修订的可信无价证据，新的人工 review 审计仍可建立资格。未修改 schema、migration、分类字典、活 Prompt 或历史模型结果。

## 冻结实测

在专用 `127.0.0.1:55458` PostgreSQL 集群，固定 7,000 榜单候选和 27,000 历史归档条目，并包含缺图、scope、已确认价、同图历史与换图分类。旧实现从不可变 Git 提交完整提取，未以估算重写；新实现调用真实集成的 `annotations._create_job`。每个规模的旧/新函数在同一冻结事实集上创建并回读，随后各自事务回滚。计时包含计划创建的查询、插入及审计，不包含证据回读；SQL 使用执行 wrapper 完整计数。

| 计划有效候选数 | 旧 SQL | 新 SQL | 旧创建耗时 | 新创建耗时 | 完整候选内容 |
| --- | ---: | ---: | ---: | ---: | --- |
| 200 | 1,141 | 21 | 1,419.694 ms | 156.791 ms | SHA 一致 |
| 1,000 | 5,658 | 59 | 5,173.785 ms | 514.779 ms | SHA 一致 |
| 5,000 | 28,259 | 255 | 26,461.503 ms | 2,410.210 ms | SHA 一致 |

完整逐项比较包括所有业务、状态、租约、版本、错误及 AI/复核字段，仅剔除新生成的 item/job ID 和创建、更新、复用时钟字段。此冻结集合没有新增可信无价、后续人工修订或封顶项，故验证 P2 批量化结果等价；P1 新资格和封顶保护的预期行为差异由定向反例验证，未宣称所有历史集合在新 P1 规则下都与旧版完全相同。

5000 条创建约提速 10.98 倍，是本机合成单轮配对结果，不能外推生产 P95、持续吞吐或整批完成时间。该测量绑定 helper `6b9accf3…`；随后 P1 增量只统一归档草稿来源分支判断，未改批量查询。冻结正常集合仅含 committed 历史和原正式事实，其候选与 SQL 分支保持原含义，按总控要求复用原 P2 基准，没有将这些耗时冒称为最终 helper 重新测得的数值。最终源码与增量测试见 manifest。模型持续吞吐未在本子任务测量。全部测试不调用真实模型，没有真实人工金标集，不宣称业务准确率。

## 验证与证据

最终完整运行 21 项测试通过；新增真实人工 unknown+封顶组合和 category/SPU 隔离后，21 项规则/签名权限增量运行再次通过，合计 23 个不同测试。包含同图、换图、缓存变化、跨月/身份、Prompt/模型/执行器失效、较新人工修订、实际主数据编辑器、无价/unknown/非正式价、金标空值与旧链接、sentinel、未知封顶、完整候选扫描、有效任务复用、两线程并发唯一创建、事务回滚与 reader/writer 权限。

最终独审另复现归档未入库草稿可覆盖旧正式分类的来源缺口；统一来源 guard 后，7 项直接影响测试通过，其中新增实际 `delete_job` / 取消 × 两种未入库状态、归档 committed 事实保留、未复核模型分类三项回归，累计 26 个不同规划测试。原失败证据保持在 `review-newer-human-archived-source.json`，未追认旧 helper 已通过。

组合环境另发现 TransactionTestCase 全应用 teardown 会涉及无 Django model 的 AI 保护表。两规划 TransactionTestCase 现与既有队列测试一致，仅声明 `available_apps=['market']`，并在每次夹具显式幂等准备市场控制行；没有改变业务权限、保护表或生产 runner。规划并发与 P0 恢复测试的 12 项组合随后通过，确认 teardown 不污染后续恢复夹具。5000 条有效基准直接复用。

真实已部署角色配置的 Python grant 片段仅在私有 PG 执行。reader 能运行批量规划读取与原查询，5 类越权写入拒绝；writer 能运行批量规划读取、Prompt 分配、领取/回写、人工复核审计和既有 annotation 入库，4 类跨权限操作拒绝。应用签名 viewer/analyst 写入与 scoped admin 均拒绝，operator 真实人工 review hook 生效。原应用角色和当前授权范围未扩大。

执行命令：

```powershell
& 'D:\teruisi-runtime\django-sales\venv\Scripts\python.exe' 'docs\market-ai-round2-20261015\evidence\planning-rehearsal.py'
& 'D:\teruisi-runtime\django-sales\venv\Scripts\python.exe' 'docs\market-ai-round2-20261015\evidence\planning-rehearsal.py' --tests-only --test-label market.test_annotation_planning_round2.AnnotationPlanningRulesTests --test-label market.test_annotation_planning_round2.AnnotationPlanningPermissionsTests
git diff --check
```

全部私有 PG 集群已停止；只复用 runtime 中只读 Python/PG 可执行文件，未启动/停止正式服务、读取生产凭据或连接正式数据库。测试工具位于任务 evidence，不属于生产工具入口。

- [有效冻结基准](evidence/planning-benchmark.json)
- [完整运行与物理角色结果](evidence/planning-full-rehearsal-result.json) · [完整测试原日志](evidence/planning-full-tests.log)
- [增量结果](evidence/planning-incremental-rehearsal-result.json) · [增量测试原日志](evidence/planning-incremental-tests.log)
- [市场域 teardown 与 P0 恢复组合](evidence/planning-domain-combination-result.json) · [组合原日志](evidence/planning-domain-combination-tests.log)
- [归档来源增量 7 项结果](evidence/planning-archived-source-result.json) · [增量原日志](evidence/planning-archived-source-tests.log)
- [源码与集成函数摘要](evidence/planning-source-manifest.json)
- [基线窄集成补丁](evidence/planning-integration.patch)：总控实际已按 P0 后的函数位置串行集成，未直接覆盖 annotations.py。
- [初版截断计数证据](evidence/planning-benchmark-initial-invalid-sql-count.json)：5000 条 SQL 日志触 Django 9000 条 deque 上限，其 SQL 数无效，不能用于结论；有效执行 wrapper 计数保留在上述最终基准。
- [早期缺依赖失败](evidence/planning-initial-missing-dependency.log) · [早期夹具失败](evidence/planning-initial-fixture-failures.log)：原失败保持；后续使用具备依赖的 runtime 只读解释器，并修正历史唯一身份、review_ready 复用误期望、非法 request ID 夹具及既有严格隔离 PG runner 的准确库名，没有改生产门禁。

本子代理未切分支、提交、推送、转派或生产操作。合并与发布状态由总控交付报告确认。
