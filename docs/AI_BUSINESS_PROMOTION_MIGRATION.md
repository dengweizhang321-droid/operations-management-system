# 词货多 Agent 报告的数据库迁移边界

2026-09-24，整合分支只读核验结论。当前没有可安全安装的 `ai_assistant.0026`。`business_promotion_runtime.prepare_candidate` 只读取旧报告及已发布筛查结果，返回 `registered=false`、`readiness=requires_new_persistent_profile` 的候选；它没有创建新报告、工作流或 Agent 任务。`business_promotion_runtime_contract.freeze_snapshot` 的 `business-promotion-runtime-snapshot-candidate-v1` 也只是候选选择合同，不能直接作为 `AiReportRun.snapshot_json` 插入。旧 `business_screening_creation.create` 仅创建 `business-agent-screening-reference-v1`。

## 先冻结可持久的完整写入协议

新创建入口须在同一原子事务内写入新的报告、工作流、预分配的 `screeningIntent`、固定的 `promotionSelector` 和现有预算/商品映射引用。创建前从真实已封存来源目录选定一个京东推广当前期 sourceKey、可选同店铺、同原日期范围的 `previous` 或 `yearAgo` baselineKey；拒绝猜测基期。持久报告应拥有自己的新 `executionProfile`，且明确列出 schemaVersion、全部允许字段、不可变 selector 的精确形状、两个固定视图、算法版本和 contextDigest。工作流 input 应精确说明如何复制或引用上述选择，必须绑定 reportId、证据 seal、筛查意图以及同一 owner/scope。新 profile 的允许工具目录、固定图和模型入场协议须与持久内容一致。

该完整结构及一次实际 ORM 创建路径、错身份/来源/基期的负例定下来以后，才能写数据库触发器。当前仅靠纯候选 JSON 或后端 if 分支放行新 profile，会让数据库接受一个无法独立核对的报告或孤儿工作流。

## 0026 报告与筛查 guard 的最小实现

从已经应用的 `0024_business_screening_runtime.py` 冻结常量派生，使用精确替换并断言每个锚点只出现一次；不修改旧迁移。旧 profile 继续调用其原有 guard 逻辑，新 profile 进入独立的严格式分支。必须一并覆盖：

1. `ai_business_screening_report_guard`：报告 snapshot 字段集合、JSON 原始类型和重复键、owner/scope、真实封存来源目录、selector 当前期与基期的同源关系、算法/contextDigest、预分配 screeningIntent、workflow input 与报告精确一致。不能只检查字符串属于新白名单。
2. `ai_business_screening_workflow_guard`：提交时拒绝带 selector 或筛查意图却没有对应新报告的孤儿工作流；旧报告不能混入新字段。新报告对应的图、工具策略和持久 input 需要由 owning 创建入口及 DB 可证明的字段共同绑定。
3. `ai_screen_initial_guard`：筛查发布必须属于该报告预分配 ID 和选择计划，不能复用另一报告或旧 profile 的 screening 结果。预算及映射字段仍沿原 guard 的权威引用和精确 SQL 复验。
4. 已存在的报告/工作流/筛查行不可改写。新 profile 的逆迁移只要发现任意新报告、工作流或预分配意图，即使尚未发布筛查，也必须拒绝；空逆迁移要恢复 0024 前驱函数体及触发器组合，并用 `pg_proc.prosrc` 和触发器回查实证。

只有数据库能从已保存的真实 seal、目录和选择计划验证的字段才进入 SQL；模型陈述、请求中的摘要、前端选择、候选 `authorityVerified=false` 均不能作为授权。

## renderer 7 的独立门槛

`promotionSelector` 应固定在新报告 snapshot 中，renderer 7 只接受该 profile，因而首版无需扩展 `AiBusinessFileRun` 字段或复用受约束为 `'null'` 的 `scope_json`。在报告 guard 和 owning 绑定就绪前，不扩 `ai_business_file_bound`。可在同一充分测试的 0026 加入 renderer 7，或者留到 0027；两种方式都须从 `0025_business_file_opc.NEW_SQL` 的五个函数精确派生并保持旧 1–6 路径：

- 单文件分片仍只允许 1/2/3/5；多卷分片和完整性检查只增加 7，父 run 的版本、attempt、status、stored_bytes 与分片链保持原规则。
- compact manifest 的 `rendererVersion` 必须为精确整数 7 且等于父 run。7 的父 run 必须指向精确新 profile 及其不可变 selector；不能由旧报告用 `deliveryMode=volumes` 自选 7。
- 新卷的完整 manifest 另绑定两种视图的 material manifest digest、每表 rowCount/NDJSON SHA、tableBindingDigest、source/baseline 和费用守恒证明；现有 `business-file-delivery-v2` compact 根字段集合保持，旧 4/6 manifest 不增加字段。
- 任意 7 文件任务（queued、paused、ready、cancelled）存在时，逆迁移拒绝；旧 1–6 文件的 manifest、attempt、历史 chunk、下载字节和暂停续跑行为必须保留。

## 分批实证与接受标准

第一批先实现真正的新报告创建、owning 复验和固定图/目录，不运行模型。随后编写 `0026` 与真实 PostgreSQL 测试：空库升级及逆迁移；旧 1–6 报告/文件行与摘要不变；新 profile 正确创建和筛查发布；错 actor、owner/scope、source、baseline、selector、contextDigest、意图 ID、孤儿工作流及重复 JSON 键原子拒绝；任意新报告存在时逆迁移拒绝。检查迁移前后数据库角色权限及独立 dump/restore，不能用纯 SQL 文本测试代替实际触发器验收。

第二批接 renderer 7 的 HTML/XLSX 全量两表、发布/恢复/下载及 0025 五函数扩展，按同样方式验证旧版本字节兼容和新版本分片完整性。词货材料本身不等于已交付文件；两张表是同一推广事实的不同分组，费用不可相加。正式业务模型效果及生产采用分别验收。
