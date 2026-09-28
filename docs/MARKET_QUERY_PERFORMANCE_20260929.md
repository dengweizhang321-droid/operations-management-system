# 第五项：市场筛选及榜单性能

## 范围、协作与状态

任务依据：`SYSTEM_OPTIMIZATION_ASSESSMENT_20260928.md` 第 4.5 节，以及用户 2026-09-29 的并行约束。
基线 `e00d4a82b2480d05646f5e0b65b13e9a2cc6bb7e`，独立分支 `codex/market-query-performance`，受管 worktree `D:/.codex/worktrees/market-query-performance/运营管理系统`。

本项证据先存本文件；总评估文档由统一收尾对话更新。开发/测试/推送不等于合并或上线。本轮不改正式数据库、索引、配置、调度、运行包或服务生命周期。

公共模块识别：`backend/market/query.py` 被市场页面及领域消费者共用，改动仅限已有 `_database_options`；`filter_cache.py`、`ranking_query.py`、`views.py` 是需要回归但不改写的依赖。其余优化项涉及的 Worker/Django 生命周期脚本、公共观测/配置、README、AGENTS、总评估文档不在本项修改范围。若收尾时另有分支修改 `_database_options`，须按完整统计语义人工合并，不能覆盖整份 query.py。

## 当前实现核对

源代码与正式安装 `D:/teruisi-runtime/django-sales/app/backend` 的四份文件 SHA-256 一致：

| 文件（backend 下） | SHA-256 |
| --- | --- |
| market/query.py | `63964994244e48ea308cf89ab6a94579c4c78e8a62839c1af8aabc00c112dce8` |
| market/filter_cache.py | `808f5e14379375913a600d619d7f22daa339beac2fd2005e195baa24b1bcc20b` |
| market/ranking_query.py | `3a552430c44e24da6f2deb7adf009ae2cb027beb5d40a3327dee1f5aa7182a42` |
| market/migrations/0005_filter_facet_indexes.py | `efffff7d1720fd6c32eb7d013bdba09009f27034fef31ed53dc7162c05919237` |

以上是已安装字节核对，索引实际有效性沿用既有生产采用证据，本轮没有对正式库重新执行目录查询或压测。独立筛选接口、六个标量字段聚合、category/brand 既有索引、0005 四个窄索引、五分钟/2 MiB 单条缓存均已具备，不重复开发。缓存包含数据库、角色、authority、revision；事务内绕过、构建后版本复验、短失败退避、锁等待均保留。公开读取仍由原鉴权与 `_consistent_read` 版本前后复验保护。

## 采样方案与目标（修改前确定）

- 仅在本 worktree 的独立临时 PostgreSQL 17.11 集群测试：`127.0.0.1:55485`，独立随机测试凭据、数据库、目录；只复用已安装二进制。32 MiB shared_buffers、4 MiB work_mem、禁用并行查询工作者；保持 7 秒单 SQL、原 20 秒六字段总预算。
- 42,000 条完全合成事实、60 天、7 类目、700 个循环商品编码、空值/重复值/低基数字段、宽 raw_json；不复制客户业务数据。仅应用既有 market migrations，未新增迁移或索引。
- 每条件每版本 20 个样本，并发 1，基线/候选逐样本交错且轮换先后次序；每请求后让出 25 ms。P50/P95 使用 nearest-rank（n=20 时 P95 为第 19 个值），保留全部原始样本。该样本量只支持初步尾延迟比较，不是稳定生产 SLA。
- 筛选、单日、7 天、30 天、全部范围、空范围、第二页分别覆盖应用冷读、预热后读取、revision 递增后首次读取。榜单没有响应缓存，因此其“热读”仅表示预热；最终脚本的失效场景在隔离事务内修改一条合成事实的品牌并递增 revision；每次读前恢复同一输入，再由基线/候选分别读取变更结果，保持严格可比。中断诊断轮仍仅递增 revision，不能替代此最终场景验收。
- 冷读仅清本实验进程缓存，不清 OS/正式数据库缓存、不重启正式服务，不将其称为物理冷盘。测量为 Django 领域读取加版本 fence，销售 consumer 使用固定无网络合成响应；不包含 Worker、HTTP、浏览器、真实销售 consumer 时延。
- 记录逻辑 CPU 数、各组整机 CPU 平均值、起止可用内存。开始各组前 CPU 必须低于 50%、可用内存至少 2.5 GiB；容量不足最多等 60 秒后退出，不与大型恢复/构建争抢。若组内负载再次偏高，结果标为有干扰，不冒充空闲条件。
- 初步目标：筛选冷读及失效后 P95 较基线下降至少 30%；热读无实质退化；榜单/分页响应逐字段摘要一致，排序、统计及结果边界不变。生产绝对目标及真实规模/并发验收留待用户确认窗口，不用小合成数据保证生产达标。

## 计划证据与最小改动

首轮 42,000 行、堆约 82 MiB 的 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` 显示 scope 的 `COUNT(id)` 读取较宽身份索引，访问 456 个共享块；`COUNT(*)` 使用已有 `mkt_facet_scope_idx`，访问 37 个共享块。该单次计划用于解释机制，不作 P95。

唯一业务源码修改：六字段计数从 `Count("pk")` 改为 `Count("*")`。主键非空，两者对同一筛选关系严格等价；空字符串排除、分组、计数降序和值升序不变。无需额外索引或持久统计表，不强迫规划器走特定计划。

榜单仍有全局图片 distinct 读取及完整范围数据库聚合。此次不改变其返回统计，也不增加易陈旧的新缓存。先记录其执行计划/重复读取成本，再由真实规模证据决定是否另行提出同属第五项的后续方案。

首轮对照采样遇到整机 CPU 65%–90% 干扰，中断且检查本项 PostgreSQL 已停止；该轮数字仅诊断使用，不作为验收。

## 验证与结果

当前状态：瓶颈已在合成 PostgreSQL 执行计划复现；源码已完成最小修改；未正式采用；完整性能验收尚未完成。

2026-09-29 00:46 轻量正确性回归：`market.tests.test_filter_count_performance`、`test_filter_cache`、`test_ranking_pagination`、`test_query`、`test_api` 共 40 项，SQLite 内存测试 37 通过、3 项 PostgreSQL 专用跳过。新增测试覆盖六字段独立精确计数、空值/重复/中文/计数同值排序、部分扫描失败、真实事实新增/删除与 revision 失效；7 秒预算的 SET LOCAL 恢复测试须在 PostgreSQL 续验。原用例保留价格、投影后排序、分页、跨范围、权限、失败缓存与并发复用覆盖。`git diff --check` 通过。

执行计划见 [plans.json](evidence/market-query-performance-20260929/plans.json)。除 scope 外，brand/operation_mode/subcategory 原计划分别访问 10,501 个共享块；`COUNT(*)` 候选分别降至 63/36/64 个块。全范围榜单单次计划约 353 ms、全局图片 distinct 单次约 41 ms，仅描述该合成分布，不能外推正式宽表/价格投影分布。

[中断诊断原始样本](evidence/market-query-performance-20260929/interrupted-diagnostic.json) 明确标为 `complete=false`、`not_accepted_interrupted_for_parallel_work`。筛选三组诊断 P95 分别为冷读 182→67 ms、热读 2.76→2.73 ms、仅 revision 失效 147→52 ms；部分日期组亦已读取且前后摘要一致，但全范围、空范围及翻页组尚未完成。**这些数字不是最终前后验收结果。**用户已选择等其他重任务结束后再测，本项测试集群已停止，保留证据，不清理其他任务资源。

续验入口：在本 worktree 将基线 `e00d4a82:backend/market/query.py` 原字节保存到 `.runtime/query-reference.py`，执行 `python tools/market-query-performance.py --reference .runtime/query-reference.py`。最终脚本还需补全实际事实变更后的读取、全部范围和第二页采样；之后串行执行真实 PostgreSQL 回归与最小角色探针。更大数据规模/并发压力、全库 Node 测试与构建按统一收尾安排错峰，不把 SQLite 通过等同 PostgreSQL 或组合版本通过。

## 后续生产方案与回滚边界（待用户确认）

1. 合并由用户指定的统一收尾对话完成，先对组合版本回归；无其他优化分支的源码依赖，既有 market 0005 与原缓存/权限协议是前置条件。
2. 大规模隔离验证安排独占测量窗口，使用有代表性的宽行/价格快照/网店投影分布与 1/2/4 并发；若需正式备份副本，先核对具体备份与受保护恢复边界，不自行恢复或导入。
3. 生产只读性能采样仍先确认时间、请求清单、数量和停止阈值。建议先一次仅一条，覆盖筛选、日/周/月/全范围及第二页；确认无在途导入/重任务，再讨论每条件不少于 100 个样本。SQL 原上限、API 边界不变；任一超时/服务退化即停止追加请求，保留失败样本，不用成功子集计算整体 P95。
4. 不为制造失效而写生产 revision 或业务数据；失效首次读取跟随原自然发布/导入，或仅在另获授权的测试副本执行。物理冷读需要独立方案，不清正式缓存、不停正式数据库制造冷盘。
5. 正式采用前完成原备份/独立恢复/组合候选/启动绑定准备，待具体上线确认后通过原唯一维护与发布入口切换 Django。无新迁移；不得原地编辑 runtime 文件。
6. 回滚为受控恢复兼容的前驱应用代码并复验查询摘要、权限、7 秒限制及全栈状态；不回滚业务数据，不恢复旧 D1、不删除既有索引。应用切换仍须原维护授权。
