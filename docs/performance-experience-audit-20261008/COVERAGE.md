# 本次覆盖范围与生产只读观察

本表依据 2026-10-08 的真实运行页面证据生成。共 **12 个主模块、55 个规范子页**，每行具备源码入口映射 S 与实际浏览器入口 B。B 仅表示进入页面并观察接口终态与 DOM，**不表示全部内嵌功能、指标正确性或完整操作链通过**。静态映射与候选问题见 [breadth-ux.md](notes/breadth-ux.md)，脱敏原始数值见 [production-summary.json](evidence/production-summary.json)。

受审静态源码为 `a37b5ffd`；本表浏览器目标为实际部署的本机 `:3000`，不能由静态 SHA 推定运行包相同，具体运行版本见总报告。Chrome 154.0.8037.98，桌面 1440×1000；部分默认页另观察 1024×768。三批入口调查因只读安全 routing 关闭了浏览器 HTTP 缓存；后续操作链使用正常浏览器缓存。服务端缓存未清理；同时间 CPU、数据库连接/锁及其他后台负载未知。

三批调查共 176 条已记录 API 请求，均为 GET/200，pageerror 0、被阻止写请求 0；统计仅含 `/api/` 路径，**不含全部代码、图片、iframe、helper 或外域流量**。API 字节统计包含 `/api/market/images/{hash}` 这类图片响应，不等于纯业务 JSON 大小。54 个入口探针完成；AI 对话因泛用模块 heading 不适用，原失败保留，另以真实聊天入口补验（1032ms），形成 55 个入口浏览器覆盖。后续 18 个只读步骤有 15 个终态观察、3 个未完成，不能称全绿。

表内“观察上界”是一次原始样本：入口 API 终态后等待超过 800ms 稳定并经过两帧 rAF，再读取 DOM；不是操作反馈、首批新内容或首绘时间。AI 补验及后续链使用“请求终态、距最近完成 >450ms、settle ≥600ms、双 rAF”的不同观察协议，不直接横比。网络耗时不等于 Worker/Django/SQL/解析/渲染的单独耗时。

| 模块 | 子页 | 实际组件（app/） | 覆盖 | 入口观察上界 ms | 代表操作实际证据 | 深层范围未覆盖 |
| --- | --- | --- | --- | ---: | --- | --- |
| BI 看板 | overview | dashboard-module-view.tsx / DashboardView | B入口 + S | 14606 | 重复入口、刷新、选择一个平台；均有终态观察。 | 来源局部失败/权限变化、所有卡片钻取未覆盖 |
| 销售分析 | overview | sales-module-view.tsx / SalesView | B入口 + S + 隔离交互 | 2505 | 生产入口；真实Home隔离文本Enter/连续多选/未确认草稿/迟到失败重试/自定义取消/分区首批均有证据。 | 真实生产完整筛选→排序→详情链未穷举 |
| 销售分析 | channel | sales-module-view.tsx / SalesView | B入口 + S + 隔离布局 | 1268 | 生产入口；隔离平台多选加载/取消、滚动几何通过。 | 真实明细详情/排序完整链未覆盖 |
| 销售分析 | category | sales-category-view.tsx / SalesCategoryView | B入口 + S + 隔离布局 | 1472 | 生产入口；隔离平台多选加载/取消、滚动几何通过。 | 真实品类详情/排序完整链未覆盖 |
| 销售分析 | finance | sales-finance-views.tsx / FinanceAnalysisView | B入口 + S + 隔离布局 | 1640 | 生产入口；隔离平台加载/取消几何通过。 | 全部月份弹层/费用编辑未覆盖 |
| 销售分析 | targets | sales-finance-views.tsx / FinanceTargetSettingsView | B入口 + S | 2353 | 仅进入与终态 DOM；页内代表操作未做。 | 文本/多选/日期/排序/详情完整链本表未覆盖 |
| 网店分析 | analysis | netshop/panorama/StorePanoramaView.tsx；可切 ClassicShopView | B入口 + S | 3616 | 仅进入与终态 DOM；页内代表操作未做。 | 单多店/日期/商品钻取/返回完整链未覆盖 |
| 网店分析 | outlets | netshop-overview/balanced-overview.tsx 或 ClassicShopView | B入口 + S | 3740 | 新视图进入与第2页；有终态观察。 | 单多店/日期/商品钻取/返回完整链未覆盖 |
| 网店分析 | platforms | netshop/comparison/ComparisonColumn.tsx | B入口 + S | 12005 | 仅进入与终态 DOM；页内代表操作未做。 | 单多店/日期/商品钻取/返回完整链未覆盖 |
| 网店分析 | products | netshop/products/ProductsColumn.tsx | B入口 + S | 13911 | 仅进入与终态 DOM；页内代表操作未做。 | 单多店/日期/商品钻取/返回完整链未覆盖 |
| 网店分析 | promotion | netshop/promotion/PromotionInsightsView.tsx | B入口 + S | 5465 | 仅进入与终态 DOM；页内代表操作未做。 | 单多店/日期/商品钻取/返回完整链未覆盖 |
| 市场分析 | ranking | market-view.tsx / RankingTable | B入口 + S + 补验操作 | 7082 | 后续生产第2页→趋势→关闭成功；隔离1024外溢几何复现。 | 大日期/排序/对比详情未穷举；初轮6秒探针失败保留 |
| 市场分析 | overview | market-view.tsx / 行业汇报区 | B入口 + S | 5059 | 仅进入与终态 DOM；页内代表操作未做。 | 大日期/排序/趋势/对比详情与设置内部操作未覆盖 |
| 市场分析 | compare | market-view.tsx / CompareWorkspace | B入口 + S | 1217 | 仅进入与终态 DOM；页内代表操作未做。 | 大日期/排序/趋势/对比详情与设置内部操作未覆盖 |
| 市场分析 | settings | market-view.tsx / MarketSettingsWorkspace | B入口 + S | 5252 | 仅进入与终态 DOM；页内代表操作未做。 | 大日期/排序/趋势/对比详情与设置内部操作未覆盖 |
| 客服分析 | conversations | customer-service-view.tsx | B入口 + S | 4247 | 打开现有会话与关闭返回已观察。 | 多店/多码/IME/权限/错误链未生产注入；另见隔离证据 |
| 商品经营 | overview | product-module-view.tsx / ProductView | B入口 + S | 2353 | 第2页、打开详情已观察；返回按钮点击受遮挡未完成，后续排序未完成。 | 返回与排序未完成；测算准确性/字段编辑未覆盖 |
| 商品经营 | calculator | product-module-view.tsx / 毛利测算区 | B入口 + S | 1568 | 仅进入与终态 DOM；页内代表操作未做。 | 返回与排序未完成；测算准确性/字段编辑未覆盖 |
| 库存管理 | overview | inventory-module-view.tsx / InventoryView | B入口 + S + 隔离交互 | 3995 | 生产入口；隔离输入/光标/IME/多选/旧请求/恢复默认与慢请求布局通过。 | 各分区详情/导出/备货写动作未覆盖 |
| 库存管理 | age | inventory-module-view.tsx / 库龄分区 | B入口 + S + 隔离布局 | 1469 | 生产入口；隔离风险多选加载/取消、焦点/菜单/滚动通过。 | 真实明细/导出完整链未覆盖 |
| 库存管理 | plan | inventory-module-view.tsx / 备货计划 | B入口 + S + 隔离交互 | 1845 | 生产入口；隔离状态自动加载/布局通过，单选IME误选择另复现。 | 创建/确认/导出/外发未执行 |
| 库存管理 | stale | inventory-module-view.tsx / 滞销分区 | B入口 + S | 1243 | 仅进入与终态 DOM；页内代表操作未做。 | 各分区详情/新条件完成/导出/备货动作未覆盖 |
| 库存管理 | inbound | inventory-module-view.tsx / 入仓监控分区 | B入口 + S | 1639 | 仅进入与终态 DOM；页内代表操作未做。 | 各分区详情/新条件完成/导出/备货动作未覆盖 |
| 库存管理 | guangdong | inventory-guangdong-view.tsx / GuangdongInventoryView | B入口 + S + 合成布局 | 2063 | 生产入口；明确合成区域DTO下品牌多选/取消几何通过。 | 未验真实备货创建；合成布局不等于真实范围验算 |
| 运营事务 | plan | operations-view.tsx / OperationsView | B入口 + S + 补验操作 | 1361 | 原泛用探针失败保留；后续正确“评论 · 提醒 · 附件”打开协作详情/Escape返回通过。 | 评论/附件写入、项目/周报/模板内部功能未覆盖 |
| 运营事务 | inspection | operations-view.tsx / OperationsRecordWorkspace | B入口 + S | 1222 | 仅进入与终态 DOM；页内代表操作未做。 | 实际协作详情、项目/周报/模板内部功能未覆盖 |
| 运营事务 | reviews | operations-view.tsx / OperationsRecordWorkspace | B入口 + S | 1179 | 仅进入与终态 DOM；页内代表操作未做。 | 实际协作详情、项目/周报/模板内部功能未覆盖 |
| 运营事务 | launch | new-product-launch-view.tsx | B入口 + S | 1236 | 仅进入与终态 DOM；页内代表操作未做。 | 实际协作详情、项目/周报/模板内部功能未覆盖 |
| 运营事务 | launch-followup | new-product-sales-followup-view.tsx | B入口 + S | 1249 | 仅进入与终态 DOM；页内代表操作未做。 | 实际协作详情、项目/周报/模板内部功能未覆盖 |
| 运营事务 | variables | operations-view.tsx / 模板设置区 | B入口 + S | 1217 | 仅进入与终态 DOM；页内代表操作未做。 | 实际协作详情、项目/周报/模板内部功能未覆盖 |
| 自动化中心 | jackyun | n8n-workflow-view.tsx / workflowConfigs.jackyun | B入口 + S + 补验操作 | 1324 | 后续从吉客云点击京东栏目成功；隔离外框溢出几何。 | 嵌入 n8n 内交互/运行未覆盖，API统计不含全部外域流量 |
| 自动化中心 | tmall | n8n-workflow-view.tsx / workflowConfigs.tmall | B入口 + S | 1381 | 仅进入与终态 DOM；页内代表操作未做。 | 嵌入 n8n 内交互/运行未覆盖，API统计不含全部外域流量 |
| 自动化中心 | jd | n8n-workflow-view.tsx / workflowConfigs.jd | B入口 + S + 补验操作 | 1391 | 后续真实点击切入，URL更新为view=jd。 | 嵌入 n8n 内交互/运行未覆盖，API统计不含全部外域流量 |
| 自动化中心 | jd_market | n8n-workflow-view.tsx / workflowConfigs.jd_market | B入口 + S | 1367 | 仅进入与终态 DOM；页内代表操作未做。 | 嵌入 n8n 内交互/运行未覆盖，API统计不含全部外域流量 |
| 自动化中心 | jd_promotion | n8n-workflow-view.tsx / workflowConfigs.jd_promotion | B入口 + S | 1351 | 仅进入与终态 DOM；页内代表操作未做。 | 嵌入 n8n 内交互/运行未覆盖，API统计不含全部外域流量 |
| 自动化中心 | jd_promotion_cut_meat | n8n-workflow-view.tsx / workflowConfigs.jd_promotion_cut_meat | B入口 + S | 1225 | 仅进入与终态 DOM；页内代表操作未做。 | 嵌入 n8n 内交互/运行未覆盖，API统计不含全部外域流量 |
| 数据导入 | files | import-module-view.tsx / ImportView | B入口 + S | 1236 | 切换 SKU 快递费率来源已观察；未选文件/上传。 | 批次展开/规则详情/文件读取校验/真实导入未覆盖 |
| 数据导入 | history | import-run-records-view.tsx | B入口 + S | 1463 | 仅进入与终态 DOM；页内代表操作未做。 | 批次展开/规则详情/文件读取校验/真实导入未覆盖 |
| 数据导入 | chains | import-chain-rules-view.tsx | B入口 + S | 1283 | 仅进入与终态 DOM；页内代表操作未做。 | 批次展开/规则详情/文件读取校验/真实导入未覆盖 |
| AI 助理 | assistant | ai-workspace-host.tsx → ai-assistant-view.tsx → ai-chat-workbench.tsx | B入口 + S；补验 | 1032（补验） | 真实入口、既有会话读取、侧栏收起/展开、详情开/关；未发送/切模型。 | 切历史会话原locator未命中；后台持续请求/长会话/模型/发送未覆盖 |
| AI 助理 | agents | ai-agent-workflow-view.tsx | B入口 + S | 1286 | 仅进入与终态 DOM；页内代表操作未做。 | 后台持续请求/长会话/模型/发送/所有管理内部操作未覆盖 |
| AI 助理 | memory | ai-memory-view.tsx | B入口 + S | 1223 | 仅进入与终态 DOM；页内代表操作未做。 | 后台持续请求/长会话/模型/发送/所有管理内部操作未覆盖 |
| AI 助理 | space | ai-space-view.tsx | B入口 + S | 1233 | 仅进入与终态 DOM；页内代表操作未做。 | 后台持续请求/长会话/模型/发送/所有管理内部操作未覆盖 |
| AI 助理 | management | ai-assistant-view.tsx(workspace=management) + ai-space-management-view.tsx | B入口 + S | 1442 | 仅进入与终态 DOM；页内代表操作未做。 | 后台持续请求/长会话/模型/发送/所有管理内部操作未覆盖 |
| AI 助理 | scheduled | ai-dingtalk-schedules-view.tsx | B入口 + S | 1323 | 仅进入与终态 DOM；页内代表操作未做。 | 后台持续请求/长会话/模型/发送/所有管理内部操作未覆盖 |
| AI 助理 | configuration | ai-prompt-settings-view.tsx | B入口 + S | 1477 | 仅进入与终态 DOM；页内代表操作未做。 | 后台持续请求/长会话/模型/发送/所有管理内部操作未覆盖 |
| AI 助理 | reports | ai-report-workbench-view.tsx(kind=templates) | B入口 + S | 1144 | 仅进入与终态 DOM；页内代表操作未做。 | 后台持续请求/长会话/模型/发送/所有管理内部操作未覆盖 |
| AI 助理 | skills | ai-report-workbench-view.tsx(kind=skills) | B入口 + S | 1221 | 仅进入与终态 DOM；页内代表操作未做。 | 后台持续请求/长会话/模型/发送/所有管理内部操作未覆盖 |
| AI 助理 | pipelines | ai-report-workbench-view.tsx(kind=pipelines) | B入口 + S | 1254 | 仅进入与终态 DOM；页内代表操作未做。 | 后台持续请求/长会话/模型/发送/所有管理内部操作未覆盖 |
| 系统设置 | parameters | settings-view.tsx / renderParameters | B入口 + S | 1227 | 只聚焦首个参数输入；未改值/保存，不能称编辑流程通过。 | 主数据三级页/修改校验/权限变更/备份动作/发送未覆盖 |
| 系统设置 | master | settings-view.tsx → market 主数据/导入/标注懒加载子组件 | B入口 + S | 8328 | 仅进入与终态 DOM；页内代表操作未做。 | 主数据三级页/修改校验/权限变更/备份动作/发送未覆盖 |
| 系统设置 | warehouses | warehouse-mapping-settings.tsx | B入口 + S | 1273 | 仅进入与终态 DOM；页内代表操作未做。 | 主数据三级页/修改校验/权限变更/备份动作/发送未覆盖 |
| 系统设置 | dingtalk | dingtalk-robot-settings.tsx | B入口 + S | 1443 | 仅进入与终态 DOM；页内代表操作未做。 | 主数据三级页/修改校验/权限变更/备份动作/发送未覆盖 |
| 系统设置 | backups | database-backups.tsx | B入口 + S + 隔离故障 | 1463 | 生产读取226ms；隔离6秒读取被轮询取消、失败恢复旧错误残留已复现。 | 真实备份/上传/恢复/保护变更未执行 |
| 系统设置 | permissions | access-control-management.tsx | B入口 + S | 1236 | 仅进入与终态 DOM；页内代表操作未做。 | 主数据三级页/修改校验/权限变更/备份动作/发送未覆盖 |

## 第一批实际操作链记录与该批未完成项

下列均为只读动作；未触发真实导入、模型任务、备份生成/恢复、工作流运行或外部发送。设置的“local-draft”脚本名实际只代表输入框获得焦点，未修改草稿。

| 步骤 | 结果 | 动作返回 ms | 终态观察上界 ms | 请求数 | 限制 |
| --- | --- | ---: | ---: | ---: | --- |
| bi-repeat-entry | 已观察 | 95 | 19058 | 3 | 仅对应动作与终态观察，未证明完整链/全部内部操作。 |
| bi-refresh | 已观察 | 86 | 11487 | 3 | 仅对应动作与终态观察，未证明完整链/全部内部操作。 |
| bi-single-platform | 已观察 | 27 | 3614 | 2 | 仅对应动作与终态观察，未证明完整链/全部内部操作。 |
| shop-balanced-entry | 已观察 | 45 | 1338 | 3 | 仅对应动作与终态观察，未证明完整链/全部内部操作。 |
| shop-balanced-page2 | 已观察 | 457 | 1326 | 2 | 仅对应动作与终态观察，未证明完整链/全部内部操作。 |
| product-entry | 已观察 | 45 | 1756 | 3 | 仅对应动作与终态观察，未证明完整链/全部内部操作。 |
| product-page2 | 已观察 | 88 | 745 | 1 | 仅对应动作与终态观察，未证明完整链/全部内部操作。 |
| product-detail | 已观察 | 50 | 2869 | 1 | 仅对应动作与终态观察，未证明完整链/全部内部操作。 |
| product-return | 未完成 | — | — | 0 | 6s click probe incomplete: product detail heading / shell masthead intercepted pointer events; return not completed. |
| product-sort | 未完成 | — | — | 0 | 6s sort locator timed out after preceding product-return failure; sorting not verified. |
| customer-entry | 已观察 | 32 | 2971 | 3 | 仅对应动作与终态观察，未证明完整链/全部内部操作。 |
| customer-detail | 已观察 | 61 | 701 | 1 | 仅对应动作与终态观察，未证明完整链/全部内部操作。 |
| customer-return | 已观察 | 43 | 705 | 0 | 仅对应动作与终态观察，未证明完整链/全部内部操作。 |
| workflow-entry | 已观察 | 39 | 1017 | 5 | 仅对应动作与终态观察，未证明完整链/全部内部操作。 |
| workflow-detail | 未完成 | — | — | 0 | 6s generic detail-button locator did not match the actual collaboration action; detail not verified by this sample. |
| ai-assistant-entry | 已观察 | 43 | 1032 | 3 | 仅对应动作与终态观察，未证明完整链/全部内部操作。 |
| import-source-select | 已观察 | 446 | 1108 | 1 | 仅对应动作与终态观察，未证明完整链/全部内部操作。 |
| settings-local-draft | 已观察 | 889 | 1555 | 2 | 仅对应动作与终态观察，未证明完整链/全部内部操作。 |

商品返回未完成样本含真实指针事件被详情标题区及 shell 顶栏拦截的日志，需结合专门几何/命中检测确定稳定复现条件；本表不把自动重试超时当成用户已成功返回。排序紧随失败返回，停留页面不符，不能独立认定排序控件坏。运营事务泛用“详情”locator 与实际协作按钮不匹配，不能把探针未命中解释为服务加载失败。AI 首次 heading 失败与后续成功补验同时保留，不追认原探针通过。

## 几何、长任务与内存观察的边界

54 个入口取得桌面根文档几何；其中 5 个观测到根宽超过视口：market/ranking +172px、market/overview +58px、workflow/launch-followup +11px、n8n_workflows/jackyun +190px、n8n_workflows/tmall +418px。11 个默认页取得 1024 宽几何，其中 market/ranking +588px、n8n_workflows/jackyun +606px。这能证明样本存在根级横向溢出，但不能证明所有固定列/下拉/弹窗重叠已经检查；AI 对话未取得该批 1024 几何。

成功入口的 longtask 与 layout-shift 条目保存在 JSON；后者为观察窗口原始累计，并非按 session window 计算的 CLS，也不等同于筛选加载时页面跳动。页面初次装载中的骨架/导航/内容布局均可能参与，根因需结合具体元素几何。DOM 节点、表格行数与 JS heap 仅是终态点值，不能据此认定内存泄漏或虚拟列表必要。部分无首绘/长任务/SQL 探针的阶段在 JSON 中为 null，不能当作 0。设置备份入口存在 3 个 alert 节点，仅记录数量，不把 200 响应当作所有任务健康。

## 仍未验证

- 所有 55 子页的完整“进入→日期/店铺/商品→汇总→分页/排序→详情→返回→改条件→跨模块”链；已做的步骤仅限上表。
- 原生 Windows 中文输入法候选窗、系统缩放、更多窄窗/浏览器、全部弹层/固定列/键盘焦点与返回锚点。
- 生产权限变化、乱序/故障/慢网/并发压力；这些不能在生产注入。隔离夹具结果须独立标注。
- 长时多模块会话、AI 后台既定持续语义、隐藏页签的实际连接/CPU/内存趋势，以及 n8n/导入/AI/备份与页面查询的同窗争用。
- Worker、Django、SQL、JSON 解析和 React 绘制的逐段耗时，真实小大范围/单多店/受控冷热缓存重复样本与稳定 P95。
- 真实写入、导入、模型调用、调度或外部发送功能；本轮未执行。

## 私有原始证据索引

### 本轮后续补验（不改写原失败）

| 模块/操作 | 本次结果 | 证据资格 |
| --- | --- | --- |
| 运营工作计划“评论 · 提醒 · 附件”→协作弹窗→Escape | 成功；详情GET55ms，关闭恢复列表 | 正常生产只读，修正了此前错误的泛用locator，不是业务修复 |
| 市场榜单第二页→商品趋势→关闭 | 补验成功，翻页请求914ms，趋势31ms | 初轮6秒等待不足的未完成记录保留；补验首榜单7254ms亦保留，未扩大业务API超时 |
| 自动化中心吉客云→京东栏目 | 正常切换并URL恢复为view=jd | 不运行工作流；不代表n8n内部编辑器全部通过 |
| AI对话侧栏收起/展开→对话详情开/关 | 成功，只有既有对话列表/chat GET | 未切换模型、发消息或创建会话；原旧历史class locator未命中仍未追认为成功 |
| 商品返回按钮 | 隔离中心坐标失败、键盘Enter成功；9命中点中6点被标题遮挡 | 结合生产原点击失败确认为B04；排序仍未单独补验 |

补验原始脱敏摘要：[第一轮](evidence/final-operations-summary.json)、[市场与AI后续](evidence/final-operations-followup.json)。公共输入/日期/搜索、布局与请求竞争另见总报告隔离验证，未混入本表的生产实测资格。

下列文件保留在未提交的 .runtime 中；公开 JSON 只含路由模板、数值时序/字节/计数/几何，去除了查询字符串、业务正文、姓名、编码、实体 ID、响应头和截图。原始失败日志仍在私有证据，不用脱敏摘要替换原样本。

- [production-survey-2026-10-08T14-21-45-018Z](../../.runtime/audit-private/production-survey-2026-10-08T14-21-45-018Z/results.json)
- [production-survey-2026-10-08T14-22-55-896Z](../../.runtime/audit-private/production-survey-2026-10-08T14-22-55-896Z/results.json)
- [production-survey-2026-10-08T14-24-48-924Z](../../.runtime/audit-private/production-survey-2026-10-08T14-24-48-924Z/results.json)
- [production-chains-1791469743694](../../.runtime/audit-private/production-chains-1791469743694/results.json)
