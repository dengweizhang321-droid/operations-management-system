# 后端专项审查（2026-10-08）

受审源码固定 `a37b5ffdbe9e6705cf4daa9545231e93b4378c5d`。本分工未改业务代码，未构建、部署、启停服务、访问业务数据库、清缓存、导入或发消息。源码静态追踪到当前 Django 所有者；未把历史 TypeScript/D1 实现作为当前后端。

## 版本与证据资格

- 对本节引用的 15 份关键后端文件，本次逐字节 SHA-256 与 `D:\teruisi-runtime\django-sales\app\backend` 比对全部相同。详见 [backend-runtime-hashes.json](../evidence/backend-runtime-hashes.json)。这证明落盘部署字节，不单独证明常驻进程实际加载时间/完整 release 绑定；后者由主报告的运行版本核验说明。
- [cache-lock-probe.json](../evidence/cache-lock-probe.json) 是主代理串行运行当前实际缓存类的白盒内存实验；两个不同 key、一个已热值、一个受控阻塞 loader。没有数据库、HTTP 或生产负载。原 stdout 的中文错误消息经历 PowerShell 管道编码损坏，数字/错误码/源 SHA 完整保留；不将乱码说成产品错误。脚本后续支持 `--output` 直接 UTF-8 与 ASCII stdout，原样本保留。
- [market-scope-probe-reviewed.json](../evidence/market-scope-probe-reviewed.json) 执行当前真实 `comparison`、`item_trend`、`_official_price` 函数体，用最小内存 ORM seam 隔离业务逻辑。不是 PostgreSQL/完整 API/浏览器复现，也不作耗时结论。原 [market-scope-probe.json](../evidence/market-scope-probe.json) 保留初步日期假设；看到现行 UI 全历史说明后，该假设已撤回，正式结论仅使用 reviewed 文件。
- 本分工没有调用当前业务数据 MCP/数据库；合成记录不含真实客户/销售数据。

## 已存在且仍在当前可达路径中的保护

| 领域 | 本次核实 | 不能据此宣称 |
| --- | --- | --- |
| 销售 | `backend/sales/summary.py:378-395`：core 省略店铺/渠道/平台与日趋势，full 继续加载；公共当期/环比/同比 metrics 走 `reuse`。`calculation_cache.py:20-27,58-95`：32 项/4MiB/单项1MiB、至多30秒，完整范围、principal、数据库、authority、revision 绑定；32 stripe 单飞 | 不是每种冷查询/全页重入都变快；stripe 仍有碰撞等待 |
| 库存 | `regions.py:18-38`：summary/detail 共用完整 payload 计算，附 readScope/readSnapshot；`query.py:480-484`：完整当前库存+最新30销售日基行复用；`read_cache.py:76-98`：身份、权限、DB角色、authority、版本、日期隔离，事务内绕过 | summary 首次仍须等完整 loader，并非独立廉价 summary SQL；缓存身份隔离不代表锁隔离 |
| 商品 | `query.py:487-540,600-695`：initial-page/page/overview 仍分别工作；缓存完整基行后本范围重筛；page 不重复完整指标，overview 不执行排序和页行装饰；超容量 initial-page 内联 full 避免第二次重扫 | 冷日期/店铺仍要建立完整基行；翻页/排序仍重做内存筛选排序，是否足够慢须测量 |
| 市场 | `ranking_query.py:90-167`：统计、bands、取页共享 selected 关系，正式价格和影响排序的投影在分页之前；当前页关联销售；`query.py:238-262` full 有25万原始行上限；筛选选项独立可读 | 排名SQL/完整报告仍可能随范围变慢；有上限不等于低延迟 |
| BI | `bi-cockpit-view.tsx:43,62-75`：cockpit 请求 `deferFlow=1`，主结果回来后单独读 flow；`bi/cockpit.py:62-68` 非权限来源失败转 unavailable，非零值冒充 | 其他慢来源仍可推迟整个 cockpit；flow 本身仍串行当期/前期 |
| 网店 | `store_overview.py:216-226,258-267`：完整范围 token、来源revision、版本变化至多重试一次；`balanced-overview.tsx:118-128` abort+generation；详情检查 token/scope 和店铺身份 | 每次翻页/关闭重开详情不会复用全部公共计算；旧请求的浏览器abort不证明同步Django工作已停止 |

## A. 有本次隔离复现的问题

### B-01：库存与商品不同查询范围争用单个缓存锁，连热命中也可等5秒后503

- **页面/操作及影响**：库存各页/商品经营，某个新范围首次加载期间，另一页、另一筛选、另一账号进入已成功读过的范围。数据缓存 key 没有混淆，但无关读请求排队；用户看到重复等待或“公共数据正在更新”错误，再次点击重试可能继续等。
- **复现**：先在真实 `InventoryReadCache` / `SummaryCache` 中加载 `warm-scope`；另一线程持锁执行 `cold-scope` loader；此时读取 warm-scope。先释放冷 loader 于200ms，再执行保留锁直到热请求自行结束的负例。
- **预期与实际**：已热且身份/版本有效的独立范围不应因另一范围的loader被迫超时。库存热对照0.0247ms→争用201.608ms→5003.232ms后503；商品0.0283ms→200.624ms→5013.770ms后503。每域每条件n=1，数值只描述此内存机制实验；不是业务时延/P95。warm loader 各只运行一次，证明确实是热命中被挡。
- **证据/位置**：`backend/inventory/read_cache.py:27,34-60`；`backend/products/summary_cache.py:15,20-49`。锁包住loader、版本复验、序列化/解码。缓存都使用全局单实例；嵌套库存路径需要现有RLock可重入。源与落盘部署SHA相同。
- **根因可信度**：高（真实类白盒实测）；生产触发频度和对应页面损耗未知。
- **最小方向**：短全局锁仅保护字典/容量，计算放到锁外；独立 key 的有界单飞锁/状态，热命中读取独立不可变快照后复验版本。不能简单移走全部锁或扩大5秒；库存嵌套同线程路径须保持可重入，容量淘汰不能移除正在使用的单飞锁。
- **回归**：同 key 只算一次；不同 key 热/冷并发；principal/权限/日期/店铺/authority/revision隔离；源变化拒绝并不污染；超容量；失败后可重试；nested Guangdong→inventory调用不死锁；进程内存上限。
- **顺序建议**：P2，公共高频收益；中成本/中风险。当前不是跨销售/库存/商品共用同一把锁，而是每域进程内分别存在该问题。

### B-02：市场单品趋势用“月份数”与“原始行数”比较，实际缺月时仍称未截断

- **页面/操作及影响**：市场榜单打开单品趋势，或竞品比较查看趋势/截断标识。一个月可能有多条原始来源记录；60行窗口耗尽时可能漏掉旧月份，但界面不显示截断说明。
- **复现**：同 category+scope+dimension+SKU，2月60条原始记录、1月1条。调用当前 `item_trend`。
- **预期与实际**：完整月份有2，实际仅返回2月60行，`totalMonths=2` 且 `truncated=false`；预期至少明确还有被省略的历史，不能将该窗口表示为完整月份覆盖。
- **证据/位置**：`backend/market/query.py:1535-1538,1576`，`backend/market/admin.py:602-610,636-638`，`app/market-view.tsx:693`。既有 `test_complete_performance.py:24-40` 每月一条，没覆盖同月多行。
- **根因可信度**：高（真实函数体+最小ORM seam）；生产发生的具体SKU/比例未查。
- **最小方向**：先明确仍按原始行展示还是按月归一。保持现有行口径的最小修复是独立返回 `totalRows/returnedRows`，并以同一单位判断行窗口截断，同时补 `returnedMonths`，不能把60行改叫60月。若业务要月度图，须另外确认按来源去重/聚合规则，不能顺便改销量口径。
- **回归**：同月重复、连续/非连续月、60行边界、60月边界、不同scope/dimension同SKU、空集；trend drawer与比较说明一致。
- **顺序建议**：P2，结果完整性提示问题，低至中成本/低风险（若只补元数据）。

### B-03：竞品比较与已有正式价格校验规则不一致（条件性缺陷）

- **页面/操作及影响**：市场竞品对比显示“市场定位价/成交均价”；如果存在 `confirmed` 但价格类型/图片hash/金额不符合正式契约的历史快照，比较可能展示一个其他模块拒绝的正式价。
- **复现**：合成快照 `confirmation_status=confirmed`、`ai_price_type=定金`、合法64位图片hash、100分；当前 `_official_price` 返回None，当前 `comparison` 返回100分市场价并覆盖成交均价。
- **预期与实际**：同名正式价指标复用同一资格规则；比较仅检查confirmation_status，漏type/hash/positive条件。
- **证据/位置**：`backend/market/admin.py:611-635` 对照 `backend/market/query.py:295-305`；[reviewed负例](../evidence/market-scope-probe-reviewed.json)。
- **可信度与限制**：代码/合成分歧高可信；生产是否存在此数据形状未知，不能声称现有报表已发生错误或要求改生产数据。
- **最小方向/回归**：comparison直接复用已有 `_official_price`，保留原身份、月份和缺价展示；覆盖有效标准/到手/券后价、定金/分期、空/非法hash、非正金额、未confirmed。仅隔离验证，不自动回填历史快照。
- **顺序建议**：P2候选，先最小只读量化受影响数量；小成本/低风险，按实际受影响范围决定优先级。

## B. 尚缺本轮真实耗时归因的性能风险

这些是当前可达实现的确定行为，但本分工没有SQL/CPU/浏览器测量，不能与A类内存实验混称生产性能瓶颈。

| 候选 | 当前证据和具体操作负担 | 最小修复方向及回归 | 下一步量化 |
| --- | --- | --- | --- |
| B-04 网店只翻5条明细也重新整份计算 | `store_overview.py:229-294,389-430` 每次发现历史店铺、查当前/环比/同比商品和每7日推广聚合，再生成daily/trend/summary/均线，最后才切detailPage5条/shopPage10条。`balanced-overview.tsx:107-128` 页面翻页/grain变化请求同完整接口；首次成功125行自动打开第一店，71-88再发完整view=shop；关闭重开将重新挂载并读 | 同一权限+完整基础范围+来源revision复用不可变日级基础结果，再做page/grain投影，或窄分页响应契约。避免缓存本次请求ID/错误。详情仍须同token，不把不同店统计混用；自动展开行为先按测量收益评估 | 同范围第一页→第二页→仅改趋势粒度→关闭重开详情，分别记录请求数、SQL聚合次数、响应体、首批/全区域提交；新/热范围、多/单店分别测 |
| B-05 BI部分慢源仍卡住整体首屏 | `bi/cockpit.py:128-171` 先完整ERP，再并行targets/operations/inventory，等待所有后再读targets核验。`bi-cockpit-view.tsx:53-77` 主请求返回前无ERP卡片，flow到主请求后才发。targets完整重读是版本栅栏，不可直接删 | 测量后可先拆独立source区域，完整scope+revision绑定、各区域局部错/重试；目标源增加轻量revision见证仍须拥有方授权；保留销售revision复验、缺源未知、不改跨域原子性声明 | 每阶段计时/源请求开始与完成；注入慢源只能隔离，观察ERP新范围何时真实提交。不要把API时延当绘制 |
| B-06 市场完整报告仍有大范围物化和串行跨域成本 | `query.py:238-262` full读至25万原始行并Python去重；`265-291`大identity扫描同类目/月快照；`1171-1210`富化、排序、全部SKU关联销售；`437-505`最多2万SKU按1000个和730天分块串行RPC，未传共同deadline；`1285-1292`当前页每行再扫描enriched算期数。ranking已走不同SQL路径，不能拿full问题概括全部页面 | 先阶段探针和EXPLAIN；只优化确定性共用聚合/一次索引映射；分块共同期限可收敛迟到后台工作，但不扩大超时、不截断统计；任何缓存须完整身份/权限/版本/范围/容量 | 固定类目/scope/维度小月/多月与全报告，采原始/去重行数、distinctSKU、SQL ANALYZE/BUFFERS、Python阶段、RPC次数/耗时、序列化；必须隔离或适量生产正常只读 |
| B-07 销售stripe碰撞缺少明确锁等待deadline | `calculation_cache.py:27,67`32条stripe，不同key哈希碰撞也串行，`with Lock`无超时；而B-01两个域是全局单锁，不能混淆 | 在既有有界单飞方案中绑定请求剩余预算，避免锁等待绕开预算；短保护锁不包deepcopy；不放宽DB超时 | 隔离真实reuse两不同key命中同stripe，测试慢loader；无生产频率/耗时证据，当前低优先 |

## C. 已排除/降级的假设与操作体验建议

1. **市场比较“日期失效”不能直接列bug**：前端确实发送日期（`market-view.tsx:634-645`、`api/market/master/route.ts:46-67`），后端只按完整身份汇总全部历史（`admin.py:569-645`）。但实际UI `market-view.tsx:683` 明确披露此规则。负例只是证明现行行为；不能按个人偏好把主指标改成所选日期。现有操作负担是用户修改顶部周期仍触发同历史值重读，容易误以为按周期比较；建议保留口径，减少无效reload，靠近主指标加强范围说明，若要日期比较需用户明确决定。
2. **分页不等于必须把所有统计改当前页**：市场/库存/商品当前有“完整授权筛选集合统计”的业务要求。优化方向是复用完整范围计算或在数据库聚合，不返回不完整统计换速度。
3. **有多次调用不自动是N+1**：商品按当前页装饰、市场按页投影、网店每7日受控聚合各有边界。本轮没取得执行计划/逐请求SQL分布，不报告未被证明的N+1。
4. **浏览器取消≠后端查询取消**：公开Worker服务多数已透传 `request.signal`，并有输入/体积/期限门禁；同步Django loader与跨域任务是否继续消耗资源需要时间窗进程/SQL关联。没有把abort存在当端到端取消通过，也没有无证据认定其导致目前卡顿。

## 覆盖和未验证范围

静态纵向覆盖销售summary/cache、库存overview/cache/region、商品summary/cache、市场ranking/full/trend/compare、BI cockpit/owning RPC、网店均衡总览与前端触发。浏览器证据由主代理统一产生，后端分工不重复占用测量窗口。没有复核所有领域写入、导入、AI队列、后台调度、生产权限多账号、真实SQL执行计划、数据库锁/连接、长时间RSS、隐藏页签或生产失败注入；没有证明n8n/导入/AI/备份争用，也没有在生产制造这些负载。

本轮最小建议顺序：先复核真实用户最慢动作和B-01的生产触发程度；并行可做B-02/B-03小范围正确性方案；B-04/B-05为高频公共等待候选，取得对应阶段证据后再决定拆分范围；B-06须具体规模/计划支撑，B-07后置。所有实现均等待用户决定，不在本轮修改业务。
