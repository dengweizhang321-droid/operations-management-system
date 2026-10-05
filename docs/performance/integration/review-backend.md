# 五项性能组合：后端与跨领域契约独立复核

日期：2026-10-06（Asia/Shanghai）。被审组合 `0b9636530e54d87830f8974edc1ba44fc892334c`，共同基线 `bab42d8ce836b4ee9acd82e80de085ff71f9f494`。本复核者没有实现本组合。仅检查本树源码、Git 差异、已提交测试与独立报告；没有启动数据库、构建、调用正式接口或修改业务代码。本文件是本复核唯一写入。

## 结论与合并边界

在本次检查范围内，未确认需要阻断五项源码组合的新后端契约或数据隔离缺陷。可以继续组合回归；这不是“全系统性能验收通过”，也不能替代组合版本的实际测试。未达 1—2 秒、原有已披露业务缺陷和尚未实施的性能方案分别保留，不改写成组合新增错误或已完成。

此前产品交接提出的销售批量会话、公共元数据复用，以及公共底座领域接入都没有因 Git 合并自动完成。若交付要求宣称这些能力已实现，应先补实施和组合证据，否则必须明确排除该声明。

## 已核验的组合兼容

1. **销售 core 是追加投影。** `backend/sales/views.py:193-232` 保留无 view 的 full、已有 dashboard，增加 core；expectedRevision 在重计算前及稳定返回后各校验一次，不匹配为 409。`backend/sales/summary.py:327-444` 的 full 仍生成趋势、平台、店铺及元数据；core 仅不计算未展示的分组/趋势。没有把其他 full 消费者改接 core。
2. **产品详情与销售来源见证可对接。** `backend/products/query.py:491-505,549-553,632-640` 的 salesSourceRevision 来自同次 sales:erp 修订，与原 snapshotToken 及读取前后检验并存。产品详情继续读取原 full sales summary；`app/product-module-view.tsx:289-335` 与 `lib/products/detail-contract.ts` 校验两份销售修订 header、商品来源见证、日期、唯一商品代码和数字。`backend/sales/views.py:133-139` 仍在成功响应发送两份相同修订 header。新产品前后端必须成套采用；本组合已包含两侧。
3. **原 shared summary consumer 的有效合同未缩水。** `backend/sales/consumers.py:528-572` 新增 include_metadata=False，只省掉原消费者返回 keys 以外的 filterOptions/latestBatch；其原指标、比较、分组和趋势仍返回。`product_performance`/`freshness` 的计算实现没有被此次 sales 改写。
4. **BI 原 dashboard 保持。** `backend/bi/query.py:108-158` 仍调用 get_sales_summary(projection="dashboard", principal=principal)，再调用 inventory_overview，整体前后比较 sales:erp 与 inventory 修订。此次组合未修改 BI 文件。销售计算缓存新读 ERP authority 所需 SELECT 已在原 `tools/django-bi-service.ps1:113-115`、`tools/django-local-service.ps1:3328`、`tools/django-products-service.ps1:141-143` 和 `tools/django-inventory-service.ps1:142-144` 表清单；未发现需要新增 reader 权限的依赖。
5. **库存区域协议保持旧消费者。** `backend/inventory/regions.py:18-38` 对无 section 的读取直接调用原 loader；有 section 时，同 kind/options 复用完整响应，summary 才去掉行明细并追加 readScope/readSnapshot。`lib/inventory/read-regions.ts` 对区域身份不一致清空并最多重读一轮。原 BI 与库存内部消费者不需要理解这两个新字段。库存响应外层版本检查现在覆盖库存、销售、ERP 与业务日期，旧 X-Inventory-Data-Revision 仍返回原库存修订格式。
6. **库存固定缓存范围不是漏掉用户日期。** `backend/inventory/query.py:480-484` 使用固定 current-stock/latest-30-days；复核 `:125-137` 的 _sales_period 明确从最新销售日期计算固定 30 天并忽略 options。文本、筛选和分页在缓存完整基行之后处理，不能把这一常量本身报告为串日期缺陷。age/inbound 已把读取到的实际 batch ID 纳入范围，避免旧批次内容落入新修订缓存键。

## 缓存、事务与隔离

- 销售计算缓存 `backend/sales/calculation_cache.py:37-93` 绑定数据库连接配置/alias、actor/role/scope、实际 sales:erp revision、运行 authority epoch/cutover 与既有 ERP authority 行；事务内与缓存关闭时绕过。最多 32 项、序列化总量 4 MiB、单项 1 MiB、30 秒；读取深拷贝，加载中修订变化不发布缓存。HTTP 响应缓存 `backend/sales/views.py:60-117` 在读取、锁后及返回前复验动态身份，加入业务日，并在事务中不读写缓存。
- 库存缓存 `backend/inventory/read_cache.py:66-98` 加入数据库配置、PostgreSQL actual current_user/role、actor/role/scope、固定长度范围摘要、三源修订、运行 authority 与业务日。无 principal 旧调用和未提交事务绕过；全局可重入锁允许 overview 内部广东计算，不形成自身死锁。值通过内部 pickle 字节保存和恢复，没有外部反序列化输入。
- 产品原缓存 `backend/products/summary_cache.py` 未被此组合修改；仍绑定数据库/authority/actor/role/scope/基础范围/snapshot，事务绕过，4 范围/16 MiB/120 秒/5 秒锁等待。新 _page_items 不修改缓存基行；overview 不读取仅供行展示的费率，full/page 在原产品修订校验前补当前页费率。
- 市场新图片总量缓存复用原 FilterCache，独立实例上限 256 字节，只缓存事实来源 distinct 总量；图片 ready/failed 状态仍逐次读取。已有事务绕过、数据库角色配置/authority/revision 身份保留。本组合没有扩大浏览器市场缓存 TTL 或共享身份范围。
- 上述 authority 隔离依赖现有运行时就绪校验及固定 reader 身份；未把设置 epoch 等同于每次读取实际所有权表。销售/产品缓存没有新增 PostgreSQL SET ROLE 场景支持，正式应用原固定 reader 路径没有因此新增权限。

## 必须保留的未闭合事项

1. **商品冷读取销售分块仍在。** `backend/products/query.py:295-315` 的 1000 规格块及每块 latestBatch/outletOptions 校验继续存在；`backend/sales/consumers.py:766-908` 没有新的 expected sales:erp revision 批量会话。产品 INTEGRATION 的两项批次一致性/查询次数要求不能标完成。现有前后完整修订检验仍失败关闭，未观察到组合破坏该机制。
2. **缓存不能证明端到端取消或压力稳定。** 新销售 `calculation_cache.py:66` 的固定条带锁为阻塞式、没有显式等待期限，不同 key 恰好落同条带时会串行；原 HTTP 层也已有阻塞锁。库存/产品则各有全局计算锁与 5 秒等待。此次未做并发实测，不能断言已造成生产超时，也不能宣称任何范围互不阻塞。组合压力验证应覆盖多范围冷读、暖读与取消后的占用；若完善有界等待，不放宽 SQL/HTTP 期限或绕过版本校验。
3. **公共底座是可接入能力。** `docs/performance/foundation/INTEGRATION.md` 仍说明公共进行中读取池、预加载及细阶段观测未自动接入所有领域。inventory 区域 helper 仍用自己的 fetch，销售/产品保留原领域读取。不要把基础库存在或源码组合当成减少所有领域权限往返、查询次数、后端排队的实证。
4. **市场比较两项缺陷属于基线。** `backend/market/admin.py:569-640` 仍按完整选中身份汇总全部历史，未使用外部日期等筛选，并直接累加原始价格段来源。本次在该函数只增加 latest.defer("raw_json")。与 `git diff bab42d8c..HEAD -- backend/market/admin.py` 及已提交独立报告的基线复现吻合，因此不能归因于本组合，也不能宣称比较范围/去重已修复。相关页面完整业务验收仍有限制。
5. **单任务测试不能替代组合运行。** 已提交 sales/inventory/products 的隔离报告提供原 full/dashboard/consumer 深等价及权限负例，但不是本组合 HEAD 的执行结果。组合至少应重跑 sales API/consumer/calculation cache、products progressive/source witness、inventory cache/regions 和 BI 旧响应回归；共享 summary 与原 full 详情应在同一套组合源码中覆盖。

本复核没有运行上述测试，没有产生新增数据库、构建或业务性能数字。源码可兼容、隔离测试历史通过、组合验收和生产采用是四个不同状态。
