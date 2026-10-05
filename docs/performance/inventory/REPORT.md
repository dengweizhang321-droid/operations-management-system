# 库存管理性能独立分支交付

2026-10-05。本轮完成库存领域开发、全部现有页面与详情的隔离验证，推送独立开发分支供统一集成。**整体性能目标尚未全部完成：总览和备货计划冷范围仍超过1–2秒，个别反馈样本超过200毫秒。** 不宣称整个库存板块全部性能达标。

基线 `bab42d8ce836b4ee9acd82e80de085ff71f9f494`，开始时从远端最新 main 创建；参考 d478 与当前905a工作区均无已有修改。本分支 `codex/inventory-performance`，worktree `D:\.codex\worktrees\inventory-performance\运营管理系统`。最终提交以远端同名分支和交付回执 `.runtime/inventory-delivery.json` 为准；源码文件摘要见 [独立复核](review/INDEPENDENT_REVIEW.md) 与 [最终HTTP实验](evidence/progressive-final.json)。本阶段不合并、不准备正式发布候选，分支、worktree、运行材料及预览保留。

## 实际修改

- `backend/inventory/query.py` 提取完整总览、库龄、京东入仓基行，`guangdong.py`复用完整型号投影。搜索、统计、排序、分页继续作用于授权完整集合；广东下单剩余库存继续只扫描当前页/导出筛选型号的历史。
- 库存专属 `read_cache.py`：进程内最多8条、32MiB序列化字节、60秒TTL/LRU；绑定数据库、实际PG角色、runtime authority epochs、principal/角色/权限scope、实际基行范围/批次、库存+销售+ERP版本与上海业务日。大型scope转SHA256，不以原始长配置作不计字节缓存键；超容量不保存，事务/未提交数据及无principal旧入口绕过。入缓存前和命中后复验，值以私有序列化字节保存并逐次复制，建议抑制/明细富化不污染其他请求。
- `regions.py` 和库存API增加可选 `section=summary|detail`。同完整查询两个区域复用一份完整结果，响应同时绑定 `readScope/readSnapshot`。旧请求不含section时字段、含义、日期窗及消费者契约保持原状。summary保留全量统计、分布与补货建议，省去明细数组；detail返回同口径完整DTO。请求数量和部分轻查询/元数据字节增加，工作量如实记录。
- 主六页面先显示框架/筛选，区域独立就绪、局部失败局部重试；同范围刷新保留已有结果并提示状态。换范围/页码/用户隐藏旧内容，取消及generation拒绝迟到响应；本次新来源与旧来源不混合，局部重试遇版本变化重建两区域，持续变化有界失败。增加只读刷新按钮；计划行memo减少刷新状态变化的重复渲染。广东重试同时绑定query与区域，主页面全量facet也隔离用户身份。
- 库存专属测试、现有广东UI夹具的分区标识适配及本目录的可复现实验/独立复核材料。没有修改其他业务域、`app/page.tsx`、shell、共享UI、HTTP/权限底座、全局样式、根README或AGENTS。

库存仓库计入/映射、明确零成本与缺失/无效成本、库存金额/覆盖、健康阈值、销量匹配、人工风险和健康跟进、补货门禁与人工数量等规则保持。库龄分类、全部筛选集合统计和固定权威排序均在完整响应深比较中验证。

## 完整页面覆盖

各行均有首次/再次进入及适用操作的测量和功能回归。完整入口、接口、边界及详情清单见 [独立清单](review/COVERAGE_CHECKLIST.md)，动作原值见 [UI全矩阵](evidence/ui-all-pages.json)。

| 页面/详情 | 数据读取 | 已验证与采用优化 | 剩余未完成 |
|---|---|---|---|
| 库存总览：健康、建议、近30天明细 | overview?view=overview | 首开/重入/公共+健康+仓型筛选/日期不变/刷新；全局质量、金额、统计/顺序/明细等价；基行与区域复用、迟到/失败/身份隔离 | 冷范围3.38s，1–2s目标未完成；无原UI分页/排序，另测权威page=2与固定排序 |
| 库龄分析：指标、分布、明细 | age-analysis | 全部公共/风险/10库龄区间/卡片筛选、分页/刷新、缺数据；完整分类与分布等价；完整基行和区域复用 | 所测HTTP冷范围0.77s；Home/真实鉴权/P95未验 |
| 备货计划：卡片、流程、列表 | overview?view=plan | 公共/状态筛选、分页/刷新、草稿数量人工修改、混选/全选、按钮状态、模板导入/补货服务回归；基行/完整区域与计划行复用 | 冷范围2.78s，1–2s目标未完成；旧439ms刷新样本保留，memo后49ms单样本不冒P95 |
| 滞销清理：指标、策略、明细 | age-analysis +原三风险范围 | 全部公共/风险/库龄/卡片筛选、分页/刷新、默认清理策略、缺销量和保存前权威复验；完整基行与区域复用 | 所测冷范围0.68s；共享入口/P95未验 |
| 京东入仓：指标、地区、行动、SKU | inbound-monitor | 公共/供应商/风险卡片、分页/刷新；7/30/90正向销量、成本/映射/供应商/地区、全集合排序等价；基行与区域复用 | 所测冷范围0.65s；不声称京东原生指标或真实生产P95 |
| 广东监控：分布、型号 | guangdong-monitor | 公共/供应商/风险、分页/刷新、版本变化、两区域失败重试、取消/身份隔离、剩余量来源；完整型号投影复用 | 所测冷范围0.31s；真实生产分布/P95未验 |
| 广东监控清单（二级）、搜索、导入预览 | watchlist/products/preview/file-preview/template/import | 首开/重入、清单搜索/分页、型号搜索、粘贴预览/幂等提交、启停/备注、模板解析/版本化导出、viewer拒绝写；沿用原有界5000型号SQL，无必要改查询 | XLSX解析/门禁定向测试与模拟UI链，未生产上传 |
| 广东供应商周期（二级） | suppliers | 首开/重入、生产/安全周期保存和回读、型号继承；现无筛选/排序/分页，沿用有界读取 | 无生产写入；单独功能/计时证据，不推断主查询提速自动适用 |
| 广东型号设置详情 | 当前型号 + items PATCH | 打开/关闭、周期/负责人/风险及原因成对字段、恢复默认、库存变化复位、版本fencing；原写链不改，私有PG与模拟UI回归 | 未生产保存 |
| 创建备货计划详情 | mapping.samples/warehouseOptions + replenishment | 打开/关闭、仓库/默认数量/人工覆盖、过期确认及权威质量门禁；私有数据库回归 | 未真实外部同步 |
| 采购任务、滞销清理任务详情 | 当前计划/库龄明细 + work-items | 两详情首次/重入/关闭、默认来源与字段、保存前原门禁；沿用原服务 | 未向正式运营事务落业务事项 |
| 钉钉备货群消息确认详情 | replenishment/dingtalk/group action=preview | 原/新组件打开/关闭、群/人员/正文与选中计划回归；仅隔离fixture模拟preview | 不调用真实DWS，不发送消息；原生预览所有POST仍405 |

总体未完成项明确保留：总览/计划冷首开参考目标、部分200ms反馈样本、共享Home/鉴权/Worker全链首开、真实生产数据分布、并发/P95及长期RSS。没有未验证页面冒作已验证；本轮全部实际子页面的隔离交互与所列业务回归已覆盖。

## 验证与证据

- 私有PostgreSQL规模配对：三轮108组原完整响应、3组库存/销售/ERP版本更新深等价；最终HTTP两区域36个动作的完整detail和全量summary等价。服务端/数据库/Python残差/序列化/传输、浏览器首次反馈/新内容/全页及总工作量在 [性能报告](PERFORMANCE.md)。
- 另一个私有库按现有BI17张SELECT表契约建立NOLOGIN最小权限角色，没有inventory authority SELECT或stock UPDATE：真实完整 `/api/bi/overview` 冷/暖与基线深等价；商品库存投影第1/2页、系统成本、freshness原消费者等价，共6项。[消费者证据](evidence/consumer-check.json)。
- 库存/销量消费/BI/商品相关私有PG定向132项（129通过、3项原可选角色环境测试跳过，实际BI角色另验）；Node定向75项通过，其中新增区域交错3项；库存相关构建、定向lint、生产后端边界检查与diff检查通过。migration dry-run无变化，无新增迁移候选。
- 全库TypeScript检查基线和候选均188项既有诊断，新增诊断0；没有修改范围外错误。[对照诊断](evidence/typescript-baseline-comparison.json)。
- 非作者8项缓存接缝、另一个私有PG实际角色/批次版本交错/有效零成本3项通过；六页面双版本81个检查，最终广东、计划、六页身份/空态、群消息详情分别复验；原广东模拟维护工具8类回归通过。[独立复核](review/INDEPENDENT_REVIEW.md)。
- 原始失败保留在.runtime：无关AI迁移专用角色阻断、隔离URL映射404、不合法大销量范围夹具的安全拒绝、独立PG夹具唯一约束拒绝及两次零API Vite启动超时。修正实验/隔离路由后通过，没有放宽业务门禁或归因未测原因。

## 预览与复现

可查看的只读合成预览：`http://127.0.0.1:49763/.runtime/inventory-independent-ui/index.html`。实际库存原组件/原CSS，六页面、二级和详情；原生GET smoke通过，外写405。页面注明合成，不能替代PG业务验证。对应进程保留；重启可运行下方serve命令，以输出的新端口为准。

```powershell
# 在本独立worktree内安装自己的依赖；不复制生产环境文件/连接。
npm ci --no-audit --no-fund
python -m venv .runtime/inventory-python
.\.runtime\inventory-python\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.runtime\inventory-python\Scripts\python.exe docs/performance/inventory/pg_runner.py
.\.runtime\inventory-python\Scripts\python.exe docs/performance/inventory/pg_runner.py benchmark
.\.runtime\inventory-python\Scripts\python.exe docs/performance/inventory/pg_runner.py regional
.\.runtime\inventory-python\Scripts\python.exe docs/performance/inventory/pg_runner.py consumers
node docs/performance/inventory/review/inventory-ui-lab.mjs
node docs/performance/inventory/review/inventory-ui-lab.mjs --serve
```

PG程序仅只读复用本机PG17二进制，运行目录、动态端口、库与随机凭据均独立；白名单环境不继承生产变量。测试cluster在finally停止，材料保留。.runtime保存所有原日志、合成数据库与截图；本目录只提交脱敏合成计时/复核JSON，不提交数据库、凭据或客户资料。材料摘要见 [manifest](evidence/manifest.json)。

## 公共依赖与集成边界

1. 冷总览/计划仍有销量规范化聚合和完整集合Python组装成本。销售消费原合同单批最多500货品、返回10000行，总览8000货品分16批；新安全批量/派生聚合能力需由销售/公共任务统一设计。必须保留正向销量、货品/规范仓库、排除行、固定截止与成本口径、principal及来源版本、结果上限和截断失败，不提高上限硬绕过。
2. 公共Home/导航的代码预载、角色/账号刷新和共享请求生命周期由公共底座处理。保留库存URL筛选/Tab协议，调用库存新section时必须同时绑定完整范围与readSnapshot，不能只用版本令牌证明范围。
3. 库存缓存是进程内有界复用，不能推断跨Django进程共享或长期RSS达标；32MiB是已保存序列化字节，不是全部Python瞬时内存。取消浏览器请求不保证立即抢占同步PG/Python计算；没有改生产SQL/RPC/体积/执行期限。
4. 不需要新权限、表、索引或迁移/回填；消费者默认full兼容。统一集成须保留区域协议两端、库/角色/authority身份与源版本检查及事务绕过，复验与其他并行分支的实际组合，不能仅按独立分支结果声称组合生产验收。
5. 本次不合并main、不准备发布候选、不启停/操作生产、不迁移/回填、不补跑或发消息。下一步是统一集成评审；本交付不授予后续生产操作。
