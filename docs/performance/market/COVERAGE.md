# 市场全页面覆盖与验收清单

2026-10-05，基线 `bab42d8ce836b4ee9acd82e80de085ff71f9f494`，分支 `codex/market-performance-complete`。

清单来自当前 `app/shell/navigation-catalog.ts`、`app/market-view.tsx`、`app/market-master-admin-panel.tsx` 与 `app/market-annotation-view.tsx`。外链京东详情不属于系统页面。AI、导入、下载、正式调度和消息执行规则不作性能改造；读取、展示与既有正确性仍须回归。

## 所有入口与读取路径

| 入口/详情 | 实际 API | 适用动作与瓶颈 | 本次处理与证据范围 |
| --- | --- | --- | --- |
| 商品榜单 | overview(view=ranking)、filters | 日期/类目/品牌/维度/模式/价格段/搜索，固定业务排序，上一/下一页、刷新；全范围去重/正式价/统计和全局图片distinct | 保留SQL分页、投影先排序、页内销售；事实图片总量复用原版本缓存；35万事实对照和PG原功能回归 |
| 商品月度趋势抽屉 | trend（完整category/scope/dimension/sku） | 初开、再次进入、关闭取消；原先全历史模型及raw_json再截60行 | SQL全历史distinct月计数+原排序LIMIT60；原完整月份及截断语义不变；70月深等价和PG规模对照 |
| 行业执行摘要 | overview(view=full) | 同完整筛选、刷新、原25万原始行上限 | full不读取未消费的raw_json；完整响应深等价；不得将范围413称成功 |
| 行业KPI | 同上 | 完整授权集合产品/品牌/GMV/价格/经营模式 | 同完整报告响应，不用当前页重算 |
| 行业月度趋势 | 同上 | 连续月份、增长/同比、完整覆盖 | 同上；缺月份/不可比保持 |
| 行业价格带及价格带趋势 | 同上 | 正式价格、版本、完整分母 | 同上；未确认与零保持 |
| 行业品牌竞争/份额 | 同上 | 完整品牌分母、CR3/CR5、前30展示 | 同上；不截断完整统计 |
| 行业细分类目 | 同上 | 完整分类汇总、前60展示 | 同上 |
| 行业自营/POP结构 | 同上 | 完整集合按销售额占比 | 同上 |
| 行业流量×转化象限 | 同上 | 完整集合阈值及样例 | 同上 |
| 行业标题/产品信号 | 同上 | 完整身份去重和可复核信号 | 同上 |
| 行业机会矩阵 | 同上 | 价格/可比月份/完整身份/缺源门槛 | 同上；不改变“持续观察”门槛 |
| 行业外部补充清单 | 同上 | 真实缺源，不推断采购/利润/合规 | 同上 |
| 竞品对比及各商品趋势 | master(view=compare) | 2–5完整身份，删除/清空/返回、迟到取消 | latest不载raw_json，趋势复用同SQL窗口；两商品规模深等价，边界沿原PG回归 |
| 设置共享统计 | master(system_kpis/settings_status) | 首开/再次、刷新、局部失败；原status阻挡整工作区 | KPI与设置子页立即独立挂载；图片status SQL GROUP BY；未取得值显示—/等待，不冒零 |
| SKU数据库：主数据与价格卡片/表格 | master(database_primary/database_filters) | 多条件/页码/20–100页容量、排序、刷新，primary后分类富化 | 保留原primary/filters分离、scope及generation门禁，不另造缓存；PG非空主数据与对照 |
| SKU编辑弹窗/字段详情 | 同primary当前页实体 | 打开、取消、原字段校验 | 不改写路径；独立非空浏览器只读打开/关闭与原PG主数据更新回归 |
| 统一主列表价格筛选/编辑；旧隐藏待价协议 | master(database_primary/database_secondary) | 当前可见价格状态/候选来源筛选、分页及SKU编辑；旧独立表由既有全局CSS隐藏 | 可见入口按真实非空主列表验收；secondary只计协议/PG边界与性能，不将隐藏表mock当可见子页 |
| AI标注任务与候选入口 | annotations(workspace_fast/candidate_counts) | 类目/身份/候选筛选，首次、刷新 | 不改任务创建/执行规则；原PG队列及完整身份统计回归 |
| AI跨任务复核列表/大图/复核详情 | annotations(review) | 类目/入库状态/AI结果、分页、跨页选择、只读详情 | 不改500条入库上限、旧图校验或正式价契约；独立浏览器负例与原PG回归 |
| AI任务进度/Prompt/冻结验证/runner说明 | annotations(progress/workspace_fast/其他原query) | 任务切换、进度读取/取消、错误恢复 | 不改模型/并发/调度；原PG权限/状态回归。未实际执行外部模型 |
| 细分品类设置 | master(workspace,section=subcategory) | 类目切换、刷新、已有字典 | 非data工作区跳过返回本来为空的coverage；前端适配真实类目字符串，缺关联计数显示—；其余完整响应等价 |
| 品牌确认：词典/未知品牌/任务进度 | master(workspace,section=brand/brand_job) | 查询/类目/分页、刷新 | 同上；不改品牌识别任务规则 |
| 映射配置：别名/自有商品/价格带版本 | master(workspace,section=mapping) | 查询、已有配置详情、刷新 | 同上；不改发布/回滚/写权限 |
| 数据配置：导入/下载/覆盖/审计/批次 | master(workspace,section=data/settings_status) | 初次/再次、已有任务/审计详情、刷新 | coverage仍完整；导入表单等待权威日期后挂载；缺状态不冒“无记录” |

## 统一判定

全范围结果等价、数据库执行时间、HTTP/Worker、浏览器反馈、首批内容和全页完成是不同证据。性能表和实际未完成项见 `DELIVERY.md`；独立审查材料见 `independent-review/REVIEW.md`。

榜单没有任意前端排序开关，排序是服务端固定名次→投影后成交额→ID；不能为声称覆盖排序而增加新的业务排序。设置与标注的适用排序沿其既有接口；未提供排序、日期或刷新按钮的详情记为不适用，不能凭公共改动推断其获得提速。

有未测、阻断或超过目标的页须保持“未完成性能验收”，不以主页面局部成功宣称整个板块达标。小SQLite、mock和有限合成PG样本均不等同生产P95。
